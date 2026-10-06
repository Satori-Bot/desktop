use crate::{
    model::{Config, Secrets, Workspace},
    process::ManagedProcess,
    storage::{private_dir, Storage},
};
use anyhow::{bail, Context, Result};
use reqwest::blocking::Client;
use serde_json::{json, Value};
use std::{
    io::Read,
    path::{Path, PathBuf},
    process::Command,
    thread,
    time::{Duration, Instant},
};

pub fn is_executable_file(path: &Path) -> bool {
    let Ok(metadata) = path.metadata() else {
        return false;
    };
    if !metadata.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::ffi::OsStrExt;
        let Ok(path) = std::ffi::CString::new(path.as_os_str().as_bytes()) else {
            return false;
        };
        unsafe { libc::access(path.as_ptr(), libc::X_OK) == 0 }
    }
    #[cfg(not(unix))]
    {
        true
    }
}
// Finder/Dock launches do not inherit a shell's PATH. Search only established
// per-user/package-manager executable directories for the three managed tools;
// never source shell profiles or search the selected workspace for helpers.
fn standard_program_dirs(name: &str, home: Option<&Path>, os: &str, arch: &str) -> Vec<PathBuf> {
    if !matches!(name, "uv" | "cloudflared" | "coding-tools-mcp") {
        return vec![];
    }
    let mut directories = Vec::new();
    if let Some(home) = home.filter(|home| home.is_absolute()) {
        directories.push(home.join(".local/bin"));
    }
    match os {
        "macos" => {
            if arch == "aarch64" {
                directories.push("/opt/homebrew/bin".into());
                directories.push("/usr/local/bin".into());
            } else {
                directories.push("/usr/local/bin".into());
                directories.push("/opt/homebrew/bin".into());
            }
        }
        "linux" => {
            directories.push("/usr/local/bin".into());
            directories.push("/home/linuxbrew/.linuxbrew/bin".into());
        }
        _ => {}
    }
    directories
}

fn find_in_directories(
    name: &str,
    directories: impl IntoIterator<Item = PathBuf>,
    cwd: Option<&Path>,
) -> Option<PathBuf> {
    #[cfg(windows)]
    let suffixes = [".exe", ".cmd", ".bat", ".com", ""];
    #[cfg(not(windows))]
    let suffixes = [""];
    directories.into_iter().find_map(|directory| {
        // Freeze relative PATH entries at discovery time, before any child uses
        // a workspace cwd. Keep symlink spellings: venv launchers depend on them.
        let directory = if directory.is_absolute() {
            directory
        } else {
            cwd?.join(directory)
        };
        suffixes.iter().find_map(|suffix| {
            let path = directory.join(format!("{name}{suffix}"));
            is_executable_file(&path).then_some(path)
        })
    })
}

pub fn find_program(name: &str) -> Option<PathBuf> {
    let p = Path::new(name);
    if p.is_absolute() {
        return is_executable_file(p).then(|| p.to_path_buf());
    }
    let path = std::env::var_os("PATH");
    let standard = standard_program_dirs(
        name,
        dirs::home_dir().as_deref(),
        std::env::consts::OS,
        std::env::consts::ARCH,
    );
    find_in_directories(
        name,
        path.iter().flat_map(std::env::split_paths).chain(standard),
        std::env::current_dir().ok().as_deref(),
    )
}

fn workspace_program(program: &str, directory: &Path) -> Result<PathBuf> {
    let path = Path::new(program);
    if path.is_absolute() || path.components().count() == 1 {
        return Ok(path.to_path_buf());
    }
    // Command's relative-program/current_dir interaction is platform-specific.
    // Resolve explicit relative paths once, identically for launch and probes.
    let directory = if directory.is_absolute() {
        directory.to_path_buf()
    } else {
        std::env::current_dir()?.join(directory)
    };
    let path = directory.join(path);
    if !path.is_absolute() {
        bail!("Use an absolute or workspace-relative core executable path");
    }
    Ok(path)
}
pub fn resolve(w: &Workspace, config: &Config) -> Result<Vec<String>> {
    if !w.core_command.is_empty() {
        let mut command = w.core_command.clone();
        command[0] = workspace_program(&command[0], Path::new(&w.path))?
            .to_str()
            .context("Core executable path must use valid UTF-8 characters")?
            .into();
        return Ok(command);
    }
    if let Some(path) = &config.managed_core {
        if !Path::new(path).is_absolute() || !is_executable_file(Path::new(path)) {
            bail!("The selected managed core is missing or not executable. Reinstall it or roll back before starting; no other installation was selected.");
        }
        return Ok(vec![path.clone()]);
    }
    if let Some(path) = find_program("coding-tools-mcp") {
        return Ok(vec![path.to_string_lossy().into()]);
    }
    bail!("Python core was not found in PATH or standard user/Homebrew locations. Open Settings and install the pinned core, or select an existing coding-tools-mcp executable.")
}
pub fn command(w: &Workspace, secrets: &Secrets, config: &Config, state: &Path) -> Result<Command> {
    command_supervised(w, secrets, config, state, None)
}
pub fn command_supervised(
    w: &Workspace,
    secrets: &Secrets,
    config: &Config,
    state: &Path,
    supervisor: Option<&Path>,
) -> Result<Command> {
    let args = resolve(w, config)?;
    let mut c = crate::process::command(&args[0], supervisor);
    c.args(&args[1..]);
    c.args([
        "--workspace",
        &w.path,
        "--host",
        "127.0.0.1",
        "--port",
        &w.port.to_string(),
        "--permission-mode",
        &w.permission_mode,
    ]);
    c.current_dir(&w.path);
    // Inherited core-specific options must not silently override the workspace being displayed.
    for (key, _) in std::env::vars_os() {
        if key.to_string_lossy().starts_with("CODING_TOOLS_MCP_") {
            c.env_remove(key);
        }
    }
    // Desktop management and acceptance checks never send product analytics.
    // These are the unmodified official core's documented opt-out controls.
    c.env("CODING_TOOLS_MCP_TELEMETRY", "off")
        .env("DO_NOT_TRACK", "1");
    private_dir(&state.join("events"))?;
    c.env("CODING_TOOLS_MCP_EVENT_LOG_DIR", state.join("events"));
    c.env("CODING_TOOLS_MCP_AUTH_MODE", &w.auth);
    if !w.public_url.is_empty() {
        c.env("CODING_TOOLS_MCP_SERVER_URL", &w.public_url);
    }
    match w.auth.as_str() {
        "bearer" => {
            c.env("CODING_TOOLS_MCP_AUTH_TOKEN", &secrets.bearer_token);
        }
        "oauth" => {
            c.arg("--oauth-mode")
                .env("CODING_TOOLS_MCP_OAUTH_PASSWORD", &secrets.oauth_password)
                .env(
                    "CODING_TOOLS_MCP_OAUTH_TOKEN_SECRET",
                    &secrets.oauth_token_secret,
                );
        }
        _ => {}
    }
    Ok(c)
}
pub fn client() -> Result<Client> {
    Ok(Client::builder()
        .timeout(Duration::from_secs(2))
        .connect_timeout(Duration::from_millis(700))
        .redirect(reqwest::redirect::Policy::none())
        .no_proxy()
        .build()?)
}
// Discovery and initialize should be small control-plane responses. Bound both
// declared and streamed bodies, including configured public endpoints, before
// allocating/deserializing arbitrary server output.
const PROBE_BODY_LIMIT: u64 = 1024 * 1024;
fn probe_json(response: reqwest::blocking::Response) -> Result<Value> {
    let response = response.error_for_status()?;
    if response
        .content_length()
        .is_some_and(|size| size > PROBE_BODY_LIMIT)
    {
        bail!("MCP health response exceeds the 1 MiB maximum");
    }
    let mut bytes = Vec::new();
    response
        .take(PROBE_BODY_LIMIT + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > PROBE_BODY_LIMIT {
        bail!("MCP health response exceeds the 1 MiB maximum");
    }
    serde_json::from_slice(&bytes).context("MCP health endpoint returned invalid JSON")
}
pub fn probe(w: &Workspace, secrets: &Secrets, public: bool) -> Result<String> {
    let base = if public {
        w.public_url.clone()
    } else {
        format!("http://127.0.0.1:{}", w.port)
    };
    let c = client()?;
    let card = probe_json(c.get(format!("{base}/.well-known/mcp.json")).send()?)?;
    if card.pointer("/server/name").and_then(Value::as_str) != Some("coding-tools-mcp")
        || card.pointer("/transport/endpoint").and_then(Value::as_str) != Some("/mcp")
    {
        bail!("Endpoint is reachable but is not a Coding Tools MCP server");
    }
    let version = card
        .pointer("/server/version")
        .and_then(Value::as_str)
        .unwrap_or("unknown")
        .to_string();
    // Public diagnostics intentionally never send stored credentials to a configured domain.
    if public {
        return Ok(format!(
            "Core {version} discovery is reachable; client authentication still needs verification"
        ));
    }
    let mut request=c.post(format!("{base}/mcp")).header("Accept","application/json, text/event-stream").json(&json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"coding-tools-mcp-desktop-health","version":"0.2.0"}}}));
    if w.auth == "bearer" {
        request = request.bearer_auth(&secrets.bearer_token);
    }
    let response = request.send()?;
    if w.auth == "oauth" && response.status() == 401 {
        return Ok(format!(
            "Core {version} is reachable; OAuth authorization is required"
        ));
    }
    let payload = probe_json(response)?;
    if payload
        .pointer("/result/serverInfo/name")
        .and_then(Value::as_str)
        != Some("coding-tools-mcp")
    {
        bail!("MCP initialize did not return the expected server identity");
    }
    Ok(format!("Core {version}: MCP initialize succeeded"))
}
fn reported_version(output: &str) -> Option<&str> {
    output.lines().find_map(|line| {
        let mut fields = line.split_whitespace();
        (fields.next() == Some("coding-tools-mcp"))
            .then(|| fields.next())
            .flatten()
    })
}
pub fn version_output(args: &[String], dir: &Path) -> Result<String> {
    if args.is_empty() || args[0].is_empty() {
        bail!("Core executable is not configured");
    }
    let tmp = tempfile::tempdir()?;
    let log = tmp.path().join("probe.log");
    let mut command = Command::new(workspace_program(&args[0], dir)?);
    command
        .args(&args[1..])
        .arg("--version")
        .current_dir(dir)
        .env("CODING_TOOLS_MCP_TELEMETRY", "off")
        .env("DO_NOT_TRACK", "1");
    let mut p = ManagedProcess::spawn(&mut command, log.clone(), Secrets::default())?;
    let until = Instant::now() + Duration::from_secs(10);
    while p.alive() && Instant::now() < until {
        thread::sleep(Duration::from_millis(40));
    }
    if p.alive() {
        p.stop()?;
        bail!("Core version probe timed out");
    }
    let success = p.succeeded();
    p.stop()?;
    if !success {
        bail!("Core version probe failed");
    }
    let text = std::fs::read_to_string(log)
        .unwrap_or_default()
        .trim()
        .to_string();
    if reported_version(&text).is_none() || text.len() > 512 {
        bail!("Executable did not identify itself as coding-tools-mcp");
    }
    Ok(text)
}
pub fn install(storage: &Storage, version: &str) -> Result<String> {
    if !regex::Regex::new(r"^\d+\.\d+\.\d+(?:(?:a|b|rc)\d+)?$")
        .unwrap()
        .is_match(version)
    {
        bail!("Enter an exact published version such as 0.5.0");
    }
    let uv=find_program("uv").context("uv was not found in PATH or standard user/Homebrew locations. Install uv from https://docs.astral.sh/uv/getting-started/installation/ before installing a managed core")?;
    let env = storage
        .home
        .join("cores")
        .join(format!("{version}-{}", uuid::Uuid::new_v4().simple()));
    private_dir(&env)?;
    let python = env.join(if cfg!(windows) {
        "Scripts/python.exe"
    } else {
        "bin/python"
    });
    let executable = env.join(if cfg!(windows) {
        "Scripts/coding-tools-mcp.exe"
    } else {
        "bin/coding-tools-mcp"
    });
    let log = storage.home.join("core-install.log");
    for mut cmd in [
        {
            let mut c = Command::new(&uv);
            c.arg("venv").arg(&env).args(["--python", "3.11"]);
            c
        },
        {
            let mut c = Command::new(&uv);
            c.args(["pip", "install", "--python"])
                .arg(&python)
                .arg(format!("coding-tools-mcp=={version}"));
            c
        },
    ] {
        let mut process = ManagedProcess::spawn(&mut cmd, log.clone(), Secrets::default())?;
        let deadline = Instant::now() + Duration::from_secs(180);
        while process.alive() && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(100));
        }
        if process.alive() {
            process.stop()?;
            bail!("Installation timed out; previous core remains selected. See core-install.log.");
        }
        let success = process.succeeded();
        process.stop()?;
        if !success {
            bail!("Installation failed; previous core remains selected. See core-install.log.");
        }
    }
    let path = executable.to_string_lossy().into_owned();
    let output = version_output(std::slice::from_ref(&path), &storage.home)
        .context("New core failed verification; previous core remains selected")?;
    if reported_version(&output) != Some(version) {
        bail!("New core reported a different version than requested {version}; previous core remains selected");
    }
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn executable(directory: &Path, name: &str) -> PathBuf {
        std::fs::create_dir_all(directory).unwrap();
        let suffix = if cfg!(windows) { ".exe" } else { "" };
        let path = directory.join(format!("{name}{suffix}"));
        std::fs::write(&path, b"fixture, never executed").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700)).unwrap();
        }
        path
    }

    #[test]
    fn standard_tool_directories_are_bounded_and_platform_specific() {
        let home = tempfile::tempdir().unwrap();
        for name in ["uv", "cloudflared", "coding-tools-mcp"] {
            assert_eq!(
                standard_program_dirs(name, Some(home.path()), "macos", "aarch64"),
                vec![
                    home.path().join(".local/bin"),
                    PathBuf::from("/opt/homebrew/bin"),
                    PathBuf::from("/usr/local/bin")
                ]
            );
            assert_eq!(
                standard_program_dirs(name, Some(home.path()), "macos", "x86_64"),
                vec![
                    home.path().join(".local/bin"),
                    PathBuf::from("/usr/local/bin"),
                    PathBuf::from("/opt/homebrew/bin")
                ]
            );
            assert_eq!(
                standard_program_dirs(name, Some(home.path()), "linux", "x86_64"),
                vec![
                    home.path().join(".local/bin"),
                    PathBuf::from("/usr/local/bin"),
                    PathBuf::from("/home/linuxbrew/.linuxbrew/bin")
                ]
            );
            assert_eq!(
                standard_program_dirs(name, Some(home.path()), "windows", "x86_64"),
                vec![home.path().join(".local/bin")]
            );
        }
        for name in ["unrelated-helper", "./uv", "../cloudflared"] {
            assert!(standard_program_dirs(name, Some(home.path()), "macos", "aarch64").is_empty());
        }
        assert!(
            standard_program_dirs("uv", Some(Path::new("relative-home")), "windows", "x86_64")
                .is_empty()
        );
    }

    #[test]
    fn discovery_preserves_path_then_standard_directory_precedence() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("path");
        let user = directory.path().join("user");
        let native_brew = directory.path().join("native-brew");
        let other_brew = directory.path().join("other-brew");
        let ordered = vec![
            path.clone(),
            user.clone(),
            native_brew.clone(),
            other_brew.clone(),
        ];
        let expected: Vec<_> = ordered.iter().map(|d| executable(d, "uv")).collect();
        for selected in expected {
            assert_eq!(
                find_in_directories("uv", ordered.clone(), None),
                Some(selected.clone())
            );
            std::fs::remove_file(selected).unwrap();
        }
        assert_eq!(find_in_directories("uv", ordered, None), None);
        // Neither a missing search path nor standard fallback adds cwd.
        let untrusted = executable(directory.path(), "uv");
        assert_eq!(find_in_directories("uv", [], Some(directory.path())), None);
        assert_eq!(find_program(untrusted.to_str().unwrap()), Some(untrusted));
    }

    #[cfg(unix)]
    #[test]
    fn discovery_rejects_non_executable_and_preserves_symlink_spelling() {
        let directory = tempfile::tempdir().unwrap();
        let shadow = directory.path().join("shadow");
        std::fs::create_dir(&shadow).unwrap();
        std::fs::write(shadow.join("uv"), b"not executable").unwrap();
        let installed = executable(&directory.path().join("real"), "uv");
        let bin = directory.path().join("bin");
        std::fs::create_dir(&bin).unwrap();
        let symlink = bin.join("uv");
        std::os::unix::fs::symlink(installed, &symlink).unwrap();
        assert_eq!(
            find_in_directories("uv", [shadow, bin], None),
            Some(symlink)
        );
    }

    #[test]
    fn launched_core_has_documented_telemetry_opt_out() {
        let dir = tempfile::tempdir().unwrap();
        let w: Workspace = serde_json::from_value(
            json!({"name":"fixture","path":dir.path(),"coreCommand":["coding-tools-mcp"]}),
        )
        .unwrap();
        let cmd = command(&w, &Secrets::initialized(), &Config::default(), dir.path()).unwrap();
        let env: std::collections::HashMap<_, _> = cmd
            .get_envs()
            .map(|(k, v)| {
                (
                    k.to_string_lossy().into_owned(),
                    v.map(|v| v.to_string_lossy().into_owned()),
                )
            })
            .collect();
        assert_eq!(env["CODING_TOOLS_MCP_TELEMETRY"].as_deref(), Some("off"));
        assert_eq!(env["DO_NOT_TRACK"].as_deref(), Some("1"));
    }
}
