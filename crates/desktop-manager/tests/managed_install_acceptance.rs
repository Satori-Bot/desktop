//! Opt-in, networked acceptance for the desktop's real managed installer.
//!
//! Run with an existing official uv executable (no mocked installer):
//! DESKTOP_MANAGED_ACCEPTANCE_UV=/absolute/path/to/uv cargo test -p desktop-manager \
//!   --locked --test managed_install_acceptance -- --ignored --exact \
//!   official_managed_install_acceptance --nocapture
//! If this environment requires its existing loopback egress proxy, explicitly
//! set DESKTOP_MANAGED_ACCEPTANCE_USE_ENV_PROXIES=1. Only credential-free proxy
//! URLs and an existing SSL_CERT_FILE are forwarded; values are never logged
//! or changed globally. TLS certificate verification remains enabled.
//!
//! Installs only coding-tools-mcp==0.5.0 into disposable private environments.
//! uv may download its required Python 3.11 into the same disposable directory.
//! There are no global installs, shell/profile edits, inherited credentials, or
//! real user workspaces. PATH is changed only for the isolated child processes.
//! The complete run is bounded to 15 minutes, plus bounded process cleanup.

use anyhow::{bail, ensure, Context, Result};
use desktop_manager::{
    core,
    model::{Config, Secrets, Workspace},
    process::{self, ManagedProcess},
    storage::private_dir,
    Manager,
};
use serde_json::{json, Value};
use std::{
    collections::BTreeSet,
    fs,
    net::TcpListener,
    path::{Path, PathBuf},
    process::Command,
    sync::Arc,
    thread,
    time::{Duration, Instant},
};

const VERSION: &str = "0.5.0";
const TEST_NAME: &str = "official_managed_install_acceptance";
const STAGE_ENV: &str = "DESKTOP_MANAGED_ACCEPTANCE_STAGE";
const ROOT_ENV: &str = "DESKTOP_MANAGED_ACCEPTANCE_ROOT";
const UV_ENV: &str = "DESKTOP_MANAGED_ACCEPTANCE_UV";
const PROXY_ENV: &str = "DESKTOP_MANAGED_ACCEPTANCE_USE_ENV_PROXIES";
const FIXTURE_CONTENT: &str = "Managed core acceptance: synthetic workspace only.\n";

#[test]
#[ignore = "Opt-in real uv/PyPI install; set DESKTOP_MANAGED_ACCEPTANCE_UV to an official uv executable"]
fn official_managed_install_acceptance() -> Result<()> {
    if let Ok(stage) = std::env::var(STAGE_ENV) {
        return run_stage(&stage);
    }

    let uv = PathBuf::from(std::env::var_os(UV_ENV).context(
        "Set DESKTOP_MANAGED_ACCEPTANCE_UV to the absolute path of an existing official uv executable",
    )?);
    ensure!(
        uv.is_absolute() && core::is_executable_file(&uv),
        "The opt-in uv path must be absolute and executable"
    );
    let root = tempfile::Builder::new()
        .prefix("desktop-managed-install-")
        .tempdir()?;
    let root_path = root.path().to_path_buf();
    eprintln!("Isolated acceptance directory: {}", root_path.display());
    for name in [
        "home",
        "storage",
        "workspace",
        "tmp",
        "cache",
        "config",
        "data",
        "state",
        "uv-cache",
        "uv-empty-cache",
        "uv-python",
        "uv-python-bin",
        "uv-tools",
        "uv-tool-bin",
    ] {
        private_dir(&root_path.join(name))?;
    }
    fs::write(root_path.join("workspace/hello.txt"), FIXTURE_CONTENT)?;

    // Re-exec just this test with a clean environment, rather than mutating the
    // Rust test runner's process-wide environment or leaking setup to siblings.
    let deadline = Instant::now() + Duration::from_secs(15 * 60);
    let result = (|| {
        for stage in [
            "first-install",
            "second-install",
            "rollback",
            "failed-install",
        ] {
            let mut command = isolated_command(&uv, &root_path, stage)?;
            let log = root_path.join(format!("{stage}.log"));
            #[cfg(unix)]
            let mut child =
                ManagedProcess::spawn_supervised(&mut command, log.clone(), Secrets::default())?;
            #[cfg(not(unix))]
            let mut child = ManagedProcess::spawn(&mut command, log.clone(), Secrets::default())?;
            while child.alive() && Instant::now() < deadline {
                // Keep birth-identified descendants tracked even if uv/core
                // starts a separately owned process group.
                child.metrics();
                thread::sleep(Duration::from_millis(250));
            }
            let timed_out = child.alive();
            let success = !timed_out && child.succeeded();
            let cleanup = child.stop();
            let output = log_tail(&log);
            eprintln!("{stage}:\n{output}");
            cleanup.with_context(|| format!("{stage}: process cleanup failed"))?;
            if timed_out || !success {
                bail!(
                    "{stage}: {}\nInstaller log:\n{}",
                    if timed_out {
                        "15-minute acceptance deadline exceeded"
                    } else {
                        "acceptance subprocess failed"
                    },
                    log_tail(&root_path.join("storage/core-install.log"))
                );
            }
        }
        Ok(())
    })();
    // All workers have stopped, including their real MCP services and uv trees.
    // Check cleanup explicitly instead of relying only on TempDir's best effort.
    root.close()
        .context("Could not remove isolated acceptance files")?;
    ensure!(!root_path.exists(), "Acceptance directory survived cleanup");
    eprintln!(
        "Isolated acceptance directory removed: {}",
        root_path.display()
    );
    result?;
    eprintln!("Two private {VERSION} installs, rollback, offline failure preservation, real MCP calls and cleanup passed.");
    Ok(())
}

fn isolated_command(uv: &Path, root: &Path, stage: &str) -> Result<Command> {
    #[cfg(unix)]
    let supervisor = Some(Path::new(env!("CARGO_BIN_EXE_desktop-process-supervisor")));
    #[cfg(not(unix))]
    let supervisor = None;
    let mut command = process::command(std::env::current_exe()?, supervisor);
    command
        .args([
            "--ignored",
            "--exact",
            TEST_NAME,
            "--nocapture",
            "--test-threads=1",
        ])
        .env_clear()
        .current_dir(root)
        .env(STAGE_ENV, stage)
        .env(ROOT_ENV, root)
        .env(UV_ENV, uv);
    // No package indexes, tokens, Python paths, uv config or user HOME is
    // inherited. Existing credential-free loopback proxies require opt-in.
    let ambient_path = std::env::var_os("PATH").unwrap_or_default();
    let path = std::env::join_paths(
        std::iter::once(
            uv.parent()
                .context("uv has no parent directory")?
                .to_path_buf(),
        )
        .chain(std::env::split_paths(&ambient_path)),
    )?;
    command.env("PATH", path);
    forward_opted_in_proxies(&mut command)?;
    #[cfg(windows)]
    for key in ["SYSTEMROOT", "WINDIR", "PATHEXT", "COMSPEC"] {
        if let Some(value) = std::env::var_os(key) {
            command.env(key, value);
        }
    }
    for (key, directory) in [
        ("HOME", "home"),
        ("USERPROFILE", "home"),
        ("APPDATA", "config"),
        ("LOCALAPPDATA", "data"),
        ("XDG_CONFIG_HOME", "config"),
        ("XDG_CACHE_HOME", "cache"),
        ("XDG_DATA_HOME", "data"),
        ("XDG_STATE_HOME", "state"),
        ("TMPDIR", "tmp"),
        ("TMP", "tmp"),
        ("TEMP", "tmp"),
        ("UV_CACHE_DIR", "uv-cache"),
        ("UV_PYTHON_INSTALL_DIR", "uv-python"),
        ("UV_PYTHON_BIN_DIR", "uv-python-bin"),
        ("UV_TOOL_DIR", "uv-tools"),
        ("UV_TOOL_BIN_DIR", "uv-tool-bin"),
    ] {
        command.env(key, root.join(directory));
    }
    command
        .env("CODING_TOOLS_MCP_TELEMETRY", "off")
        .env("DO_NOT_TRACK", "1")
        .env("PYTHONNOUSERSITE", "1")
        .env("UV_NO_CONFIG", "1")
        .env("UV_DEFAULT_INDEX", "https://pypi.org/simple")
        .env("UV_KEYRING_PROVIDER", "disabled")
        .env("UV_HTTP_TIMEOUT", "30")
        .env("UV_HTTP_RETRIES", "1")
        .env("NO_COLOR", "1");
    if stage == "failed-install" {
        // A real resolver failure for the *same* published version: no network,
        // no cached wheels, and a fresh venv. Reuse only the already-provisioned
        // private Python interpreter so this tests pip installation failure.
        command
            .env("UV_OFFLINE", "1")
            .env("UV_NO_CACHE", "1")
            .env("UV_CACHE_DIR", root.join("uv-empty-cache"))
            .env("UV_PYTHON_DOWNLOADS", "never");
    }
    Ok(command)
}

fn forward_opted_in_proxies(command: &mut Command) -> Result<()> {
    match std::env::var(PROXY_ENV).as_deref() {
        Err(std::env::VarError::NotPresent) => return Ok(()),
        Ok("1") => {}
        _ => bail!("{PROXY_ENV} must be absent or exactly 1"),
    }
    let mut count = 0;
    for key in [
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "ALL_PROXY",
        "http_proxy",
        "https_proxy",
        "all_proxy",
    ] {
        let Some(value) = std::env::var_os(key) else {
            continue;
        };
        // Do not interpolate raw values, even on malformed/credential-bearing
        // input. This option preserves the existing execution egress only.
        let parsed = value
            .to_str()
            .and_then(|value| url::Url::parse(value).ok())
            .with_context(|| format!("Configured {key} is not a valid proxy URL"))?;
        ensure!(
            parsed.username().is_empty()
                && parsed.password().is_none()
                && parsed.query().is_none()
                && parsed.fragment().is_none()
                && matches!(parsed.path(), "" | "/"),
            "Configured {key} contains credentials or unsupported URL components"
        );
        ensure!(
            matches!(parsed.scheme(), "http" | "https" | "socks5" | "socks5h"),
            "Configured {key} uses an unsupported proxy scheme"
        );
        let loopback = match parsed.host() {
            // Non-special schemes such as socks5h can represent a numeric IP
            // as Domain rather than Ipv4, despite using a literal loopback IP.
            Some(url::Host::Domain(host)) => {
                host.eq_ignore_ascii_case("localhost")
                    || host
                        .parse::<std::net::IpAddr>()
                        .is_ok_and(|address| address.is_loopback())
            }
            Some(url::Host::Ipv4(address)) => address.is_loopback(),
            Some(url::Host::Ipv6(address)) => address.is_loopback(),
            None => false,
        };
        ensure!(
            loopback,
            "Configured {key} is not an execution-environment loopback proxy"
        );
        command.env(key, value);
        count += 1;
    }
    ensure!(
        count > 0,
        "Proxy opt-in requested but no environment proxy is configured"
    );
    command
        .env("NO_PROXY", "127.0.0.1,localhost,::1")
        .env("no_proxy", "127.0.0.1,localhost,::1");
    // Preserve only the existing CA bundle used by this execution environment.
    // Never install trust, accept an insecure host, or forward client keys.
    if let Some(certificate_file) = std::env::var_os("SSL_CERT_FILE") {
        let path = Path::new(&certificate_file);
        ensure!(
            path.is_absolute() && path.is_file(),
            "Configured SSL_CERT_FILE is not an existing absolute regular file"
        );
        command.env("SSL_CERT_FILE", certificate_file);
    }
    Ok(())
}

fn run_stage(stage: &str) -> Result<()> {
    let root = PathBuf::from(std::env::var_os(ROOT_ENV).context("Missing isolated test root")?);
    ensure!(
        root.is_absolute() && root.is_dir(),
        "Invalid isolated test root"
    );
    let expected_uv = PathBuf::from(std::env::var_os(UV_ENV).context("Missing official uv path")?);
    ensure!(
        core::find_program("uv")
            .context("uv unavailable in isolated PATH")?
            .canonicalize()?
            == expected_uv.canonicalize()?,
        "Manager would execute a different uv than the explicit opt-in executable"
    );
    let home = root.join("storage");
    #[cfg(unix)]
    let manager = Manager::open_supervised(
        home.clone(),
        PathBuf::from(env!("CARGO_BIN_EXE_desktop-process-supervisor")),
    )?;
    #[cfg(not(unix))]
    let manager = Manager::open(home.clone())?;
    let manager = StopOnDrop(manager);
    let before = manager.0.storage.load()?.0;
    let before_bytes = fs::read(home.join("desktop-v2.json")).ok();

    match stage {
        "first-install" | "second-install" => {
            if stage == "first-install" {
                ensure!(before.managed_core.is_none() && before.previous_core.is_none());
            } else {
                ensure!(before.managed_core.is_some() && before.previous_core.is_none());
            }
            manager.0.install_core(VERSION)?;
            let after = manager.0.storage.load()?.0;
            ensure!(
                after.previous_core == before.managed_core,
                "Previous selection was not preserved"
            );
            ensure!(
                after.managed_core != before.managed_core,
                "Install reused the previous venv"
            );
            verify_selection(&manager.0, &after)?;
            if let Some(previous) = &after.previous_core {
                ensure!(
                    Path::new(previous).is_file(),
                    "Second install removed the first executable"
                );
            }
        }
        "rollback" => {
            ensure!(before.managed_core.is_some() && before.previous_core.is_some());
            manager.0.rollback_core()?;
            let after = manager.0.storage.load()?.0;
            ensure!(
                after.managed_core == before.previous_core,
                "Rollback selected the wrong executable"
            );
            ensure!(
                after.previous_core == before.managed_core,
                "Rollback lost the newer executable"
            );
            verify_selection(&manager.0, &after)?;
        }
        "failed-install" => {
            ensure!(before.managed_core.is_some() && before.previous_core.is_some());
            let attempts_before = install_attempts(&home)?;
            fs::rename(
                home.join("core-install.log"),
                home.join("successful-installs.log"),
            )?;
            let error = manager
                .0
                .install_core(VERSION)
                .expect_err("Offline/no-cache installation unexpectedly succeeded");
            ensure!(
                error.to_string().contains("Installation failed"),
                "Unexpected failure: {error:#}"
            );
            ensure!(
                fs::read(home.join("desktop-v2.json"))?
                    == before_bytes.context("Missing selected configuration")?,
                "Failed install changed the persisted configuration"
            );
            let attempts_after = install_attempts(&home)?;
            let failed_attempts: Vec<_> = attempts_after.difference(&attempts_before).collect();
            ensure!(
                failed_attempts.len() == 1,
                "Real installer did not create one isolated attempt"
            );
            ensure!(
                failed_attempts[0].join("pyvenv.cfg").is_file(),
                "Failure occurred before uv created the real venv"
            );
            ensure!(
                !failed_attempts[0]
                    .join(if cfg!(windows) {
                        "Scripts/coding-tools-mcp.exe"
                    } else {
                        "bin/coding-tools-mcp"
                    })
                    .exists(),
                "Failed install unexpectedly supplied a core executable"
            );
            let log = fs::read_to_string(home.join("core-install.log"))?;
            ensure!(
                log.contains("offline") || log.contains("network is disabled"),
                "Failure did not establish the offline resolver boundary: {log}"
            );
            let after = manager.0.storage.load()?.0;
            ensure!(
                after.managed_core == before.managed_core
                    && after.previous_core == before.previous_core,
                "Failed install changed a core selection"
            );
            verify_selection(&manager.0, &after)?;
            eprintln!("Expected offline installer failure preserved both selections: {error}");
        }
        _ => bail!("Unknown private acceptance stage: {stage}"),
    }
    let mut workspace = if let Some(saved) = manager.0.snapshot().workspaces.into_iter().next() {
        saved
    } else {
        serde_json::from_value(json!({
            "id":"", "name":"Managed acceptance", "path":root.join("workspace"),
            "access":"local", "auth":"noauth", "permissionMode":"safe"
        }))?
    };
    workspace.port = test_port()?;
    ensure!(
        workspace.core_command.is_empty(),
        "Acceptance bypassed managed-core selection"
    );
    let workspace = manager.0.save_workspace(workspace, None)?;
    verify_mcp_cycle(&manager.0, &workspace)?;
    manager.0.shutdown()?;
    eprintln!(
        "{stage}: exact {VERSION}, real initialize/read_file, stop and port release verified"
    );
    Ok(())
}

struct StopOnDrop(Arc<Manager>);
impl Drop for StopOnDrop {
    fn drop(&mut self) {
        let _ = self.0.stop_all();
    }
}

fn verify_selection(manager: &Manager, config: &Config) -> Result<()> {
    let selected = config
        .managed_core
        .as_ref()
        .context("No managed core selected")?;
    let path = Path::new(selected);
    ensure!(path.is_absolute() && core::is_executable_file(path));
    ensure!(
        path.canonicalize()?
            .starts_with(manager.storage.home.join("cores").canonicalize()?),
        "Managed executable escaped private storage"
    );
    let venv = path
        .parent()
        .and_then(Path::parent)
        .context("Missing private venv")?;
    ensure!(
        venv.join("pyvenv.cfg").is_file(),
        "Selected executable is not in the new venv"
    );
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        ensure!(
            fs::metadata(venv)?.permissions().mode() & 0o077 == 0,
            "Managed venv is not private"
        );
    }
    let output = core::version_output(std::slice::from_ref(selected), &manager.storage.home)?;
    ensure!(
        output.lines().any(|line| {
            let mut fields = line.split_whitespace();
            fields.next() == Some("coding-tools-mcp") && fields.next() == Some(VERSION)
        }),
        "Unexpected core version: {output}"
    );
    eprintln!("Selected private executable: {selected}; {output}");
    Ok(())
}

fn verify_mcp_cycle(manager: &Manager, workspace: &Workspace) -> Result<()> {
    let selected = manager
        .storage
        .load()?
        .0
        .managed_core
        .context("Missing managed selection")?;
    let status = manager.start(&workspace.id)?;
    ensure!(
        status.state == "running" && status.local_state == "ready",
        "Managed server was not ready: {status:?}"
    );
    let result = (|| {
        // Both installations have the same pinned version. Inspect only our
        // owned process to prove which distinct executable actually launched,
        // catching a stale in-memory selection or an accidental PATH fallback.
        let pid = sysinfo::Pid::from_u32(status.pid.context("Ready server has no owned PID")?);
        let mut processes = sysinfo::System::new();
        processes.refresh_processes_specifics(
            sysinfo::ProcessesToUpdate::Some(&[pid]),
            true,
            sysinfo::ProcessRefreshKind::nothing().with_cmd(sysinfo::UpdateKind::Always),
        );
        let owned = processes
            .process(pid)
            .context("Ready managed process disappeared")?;
        ensure!(
            owned
                .cmd()
                .iter()
                .any(|arg| Path::new(arg) == Path::new(&selected)),
            "Running process did not launch the selected managed executable"
        );
        let client = core::client()?;
        let endpoint = format!("http://127.0.0.1:{}/mcp", workspace.port);
        let rpc = |id: u32, method: &str, params: Value| -> Result<Value> {
            let response = client
                .post(&endpoint)
                .header("Accept", "application/json, text/event-stream")
                .header("MCP-Protocol-Version", "2025-11-25")
                .json(&json!({"jsonrpc":"2.0", "id":id, "method":method, "params":params}))
                .send()?
                .error_for_status()?;
            let value: Value = response.json()?;
            ensure!(value["error"].is_null(), "{method}: {value}");
            Ok(value)
        };
        let init = rpc(
            1,
            "initialize",
            json!({
                "protocolVersion":"2025-11-25", "capabilities":{},
                "clientInfo":{"name":"desktop-managed-install-acceptance", "version":"1"}
            }),
        )?;
        ensure!(init["result"]["serverInfo"]["name"] == "coding-tools-mcp");
        ensure!(
            init["result"]["serverInfo"]["version"] == VERSION,
            "MCP selected a different core version: {init}"
        );
        let tools = rpc(2, "tools/list", json!({}))?;
        ensure!(tools["result"]["tools"]
            .as_array()
            .context("Missing tools")?
            .iter()
            .any(|tool| tool["name"] == "read_file"));
        let read = rpc(
            3,
            "tools/call",
            json!({"name":"read_file", "arguments":{"path":"hello.txt"}}),
        )?;
        ensure!(
            read["result"]["isError"] != true
                && read["result"].to_string().contains(FIXTURE_CONTENT.trim()),
            "Synthetic read_file did not succeed: {read}"
        );
        Ok(())
    })();
    let stopped = manager.stop(&workspace.id)?;
    ensure!(
        stopped.state == "stopped" && stopped.pid.is_none(),
        "Stop retained a managed process"
    );
    ensure!(
        TcpListener::bind(("127.0.0.1", workspace.port)).is_ok(),
        "Stopped server retained its port"
    );
    result
}

fn install_attempts(home: &Path) -> Result<BTreeSet<PathBuf>> {
    Ok(fs::read_dir(home.join("cores"))?
        .map(|entry| entry.map(|entry| entry.path()))
        .collect::<std::io::Result<_>>()?)
}

fn test_port() -> Result<u16> {
    // Avoid the usual outbound ephemeral range, as in the lifecycle tests.
    for port in 24000..28000 {
        if TcpListener::bind(("127.0.0.1", port)).is_ok() {
            return Ok(port);
        }
    }
    bail!("No free isolated loopback test port")
}

fn log_tail(path: &Path) -> String {
    let text = fs::read_to_string(path).unwrap_or_default();
    let start = text
        .char_indices()
        .rev()
        .nth(16_384)
        .map(|(index, _)| index)
        .unwrap_or(0);
    let mut tail = text[start..].to_owned();
    // uv diagnostics must not make opted-in environment values part of a
    // retained acceptance report, even when a network operation fails.
    for key in [
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "ALL_PROXY",
        "http_proxy",
        "https_proxy",
        "all_proxy",
        "SSL_CERT_FILE",
    ] {
        if let Ok(value) = std::env::var(key) {
            if !value.is_empty() {
                tail = tail.replace(&value, "[redacted environment setting]");
            }
        }
    }
    tail
}
