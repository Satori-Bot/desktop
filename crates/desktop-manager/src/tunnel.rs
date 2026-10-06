use crate::{
    core::find_program,
    events,
    model::{Secrets, Workspace},
    process::ManagedProcess,
    storage::{private_dir, private_json, private_write, valid_id},
};
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    process::Command,
    thread,
    time::{Duration, Instant},
};

fn isolated_command(executable: &Path, supervisor: Option<&Path>) -> Command {
    let mut command = crate::process::command(executable, supervisor);
    // Ambient cloudflared options must never grant overwrite permission or
    // substitute a different account/tunnel for the workspace being displayed.
    for (key, _) in std::env::vars_os() {
        if key
            .to_string_lossy()
            .to_ascii_uppercase()
            .starts_with("TUNNEL_")
        {
            command.env_remove(key);
        }
    }
    command
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SetupIntent {
    schema_version: u32,
    name: String,
    tunnel_id: Option<String>,
}

fn credentials_id(path: &Path) -> Result<String> {
    let content: serde_json::Value = serde_json::from_slice(&std::fs::read(path).context(
        "Tunnel creation did not produce credentials. Check account authorization and tunnel name.",
    )?)
    .context("Saved Cloudflare credentials are invalid; restore them before retrying")?;
    let id = content["TunnelID"]
        .as_str()
        .context("Cloudflare credentials did not contain a tunnel ID")?;
    Ok(uuid::Uuid::parse_str(id)
        .context("Cloudflare credentials contain an invalid tunnel ID")?
        .hyphenated()
        .to_string())
}

pub fn validate_public_url(value: &str) -> Result<()> {
    let u =
        url::Url::parse(value).context("Enter an HTTPS origin such as https://mcp.example.com")?;
    if u.scheme() != "https"
        || u.host_str().is_none()
        || !u.username().is_empty()
        || u.password().is_some()
        || !matches!(u.path(), "" | "/")
        || u.query().is_some()
        || u.fragment().is_some()
    {
        bail!(
            "Public address must be an HTTPS origin with no path, credentials, query or fragment"
        );
    }
    Ok(())
}
pub fn start(w: &Workspace, secrets: &Secrets, state: &Path) -> Result<(ManagedProcess, String)> {
    start_supervised(w, secrets, state, None)
}
pub fn start_supervised(
    w: &Workspace,
    secrets: &Secrets,
    state: &Path,
    supervisor: Option<&Path>,
) -> Result<(ManagedProcess, String)> {
    let mut process = spawn_supervised(w, secrets, state, supervisor)?;
    let url = wait_connected(&mut process, w, secrets, state)?;
    Ok((process, url))
}

// Split spawning from readiness so the manager can persist ownership before
// any wait/log read fails. Convenience start callers still own their process.
pub(crate) fn spawn_supervised(
    w: &Workspace,
    secrets: &Secrets,
    state: &Path,
    supervisor: Option<&Path>,
) -> Result<ManagedProcess> {
    let executable=find_program("cloudflared").context("cloudflared is missing. Install it from Cloudflare, then retry public access. Local MCP remains available.")?;
    let mut cmd = isolated_command(&executable, supervisor);
    cmd.arg("tunnel").arg("--no-autoupdate");
    let config = state.join("cloudflared.json");
    // An explicit private config also prevents an unrelated ~/.cloudflared
    // config from converting a Quick Tunnel into an ad-hoc named setup.
    private_write(&config, b"{}")?;
    cmd.arg("--config").arg(&config);
    if w.access == "quick" {
        cmd.args(["--url", &format!("http://127.0.0.1:{}", w.port)]);
    } else if !secrets.cloudflare_token.is_empty() {
        // Environment avoids leaking the tunnel token in process command lines.
        cmd.args(["run"])
            .env("TUNNEL_TOKEN", &secrets.cloudflare_token);
    } else {
        if w.tunnel_name.is_empty() || !Path::new(&w.credentials_file).is_file() {
            bail!("Connect a Cloudflare account and create a fixed tunnel, or enter an existing tunnel token");
        }
        let hostname = url::Url::parse(&w.public_url)?
            .host_str()
            .context("Missing public hostname")?
            .to_string();
        let content = serde_json::json!({"tunnel":w.tunnel_name,"credentials-file":w.credentials_file,"ingress":[{"hostname":hostname,"service":format!("http://127.0.0.1:{}",w.port)},{"service":"http_status:404"}]});
        private_write(&config, &serde_json::to_vec(&content)?)?;
        cmd.arg("run").arg(&w.tunnel_name);
    }
    let log = state.join("tunnel.log");
    private_write(&log, b"")?;
    #[cfg(unix)]
    let process = if supervisor.is_some() {
        ManagedProcess::spawn_supervised(&mut cmd, log.clone(), secrets.clone())?
    } else {
        ManagedProcess::spawn(&mut cmd, log.clone(), secrets.clone())?
    };
    #[cfg(not(unix))]
    let process = ManagedProcess::spawn(&mut cmd, log.clone(), secrets.clone())?;
    Ok(process)
}

pub(crate) fn wait_connected(
    process: &mut ManagedProcess,
    w: &Workspace,
    secrets: &Secrets,
    state: &Path,
) -> Result<String> {
    let log = state.join("tunnel.log");
    let pattern = regex::Regex::new(r"https://[a-z0-9-]+\.trycloudflare\.com").unwrap();
    let deadline = Instant::now() + Duration::from_secs(25);
    let mut public = w.public_url.clone();
    while Instant::now() < deadline {
        if !process.alive() {
            bail!("Cloudflare process exited. See tunnel logs; local MCP remains available.");
        }
        let text = events::logs(&log, 0, secrets)?.text;
        if w.access == "quick" {
            if let Some(m) = pattern.find(&text) {
                public = m.as_str().to_string();
            }
        }
        if text.contains("Registered tunnel connection") && !public.is_empty() {
            // Preserve target birth identities before a ready helper is exposed
            // to the manager, including a helper failure before its next poll.
            process.metrics();
            return Ok(public);
        }
        thread::sleep(Duration::from_millis(150));
    }
    bail!("Cloudflare did not establish a connection within 25 seconds. Local MCP remains available; retry public access.")
}
fn run(executable: &Path, args: &[String], home: &Path, seconds: u64) -> Result<String> {
    let d = tempfile::tempdir_in(home)?;
    let log = d.path().join("cloudflare-setup.log");
    let mut cmd = isolated_command(executable, None);
    let config = d.path().join("cloudflared.json");
    private_write(&config, b"{}")?;
    let (subcommand, remaining) = args.split_first().context("Missing Cloudflare command")?;
    cmd.arg(subcommand)
        .arg("--config")
        .arg(config)
        .args(remaining);
    let mut p = ManagedProcess::spawn(&mut cmd, log.clone(), Secrets::default())?;
    let until = Instant::now() + Duration::from_secs(seconds);
    while p.alive() && Instant::now() < until {
        thread::sleep(Duration::from_millis(100));
    }
    if p.alive() {
        p.stop()?;
        bail!("Cloudflare operation timed out; complete browser authorization and retry");
    }
    let succeeded = p.succeeded();
    p.stop()?;
    let text = std::fs::read_to_string(log).unwrap_or_default();
    if !succeeded {
        bail!(
            "Cloudflare reported an error: {}",
            text.chars().take(2000).collect::<String>()
        );
    }
    Ok(text)
}
pub fn login(home: &Path) -> Result<String> {
    let exe = find_program("cloudflared").context("Install cloudflared first")?;
    run(&exe, &["tunnel".into(), "login".into()], home, 180)?;
    Ok("Cloudflare authorization finished. You can now create a fixed tunnel. The account certificate stays on this computer.".into())
}
pub fn setup(
    w: &Workspace,
    name: &str,
    hostname: &str,
    home: &Path,
) -> Result<(String, PathBuf, String)> {
    valid_id(&w.id)?;
    if !regex::Regex::new(r"^[a-zA-Z0-9][a-zA-Z0-9_-]{0,62}$")
        .unwrap()
        .is_match(name)
    {
        bail!("Tunnel name must contain only letters, numbers, hyphens and underscores");
    }
    let public = format!("https://{hostname}");
    validate_public_url(&public)?;
    let parsed = url::Url::parse(&public)?;
    if parsed.host_str() != Some(hostname) {
        bail!("Enter a hostname without a scheme, port or path");
    }
    if !matches!(parsed.host(), Some(url::Host::Domain(_)))
        || hostname.len() > 253
        || !hostname.contains('.')
        || hostname.split('.').any(|label| {
            label.is_empty()
                || label.len() > 63
                || label.starts_with('-')
                || label.ends_with('-')
                || !label
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || c == b'-')
        })
    {
        bail!("Enter a valid public DNS hostname such as mcp.example.com before creating a tunnel");
    }
    let exe = find_program("cloudflared").context("Install cloudflared first")?;
    let dir = home.join("tunnels");
    private_dir(&dir)?;
    let credentials = dir.join(format!("{}.json", w.id));
    let intent_path = dir.join(format!("{}.setup.json", w.id));
    let mut intent = if intent_path.exists() {
        let intent: SetupIntent = serde_json::from_slice(&std::fs::read(&intent_path)?)
            .context("Saved tunnel setup identity is invalid; original files were preserved")?;
        if intent.schema_version != 1 {
            bail!("Saved tunnel setup identity has an unsupported version");
        }
        if intent.name != name && intent.tunnel_id.as_deref() != Some(name) {
            bail!("This workspace already has a tunnel setup for '{}'. Retry with that name or its saved tunnel ID; a different tunnel was not created or routed.", intent.name);
        }
        intent
    } else if credentials.exists() {
        let id = credentials_id(&credentials)?;
        if name != id {
            bail!("Existing tunnel credentials have no saved name. Retry with tunnel ID {id} to reuse them explicitly; no DNS changes were made.");
        }
        SetupIntent {
            schema_version: 1,
            name: name.into(),
            tunnel_id: Some(id),
        }
    } else {
        SetupIntent {
            schema_version: 1,
            name: name.into(),
            tunnel_id: None,
        }
    };
    // Save intent before the first external action so an interrupted setup can
    // resume without silently interpreting a new name as the previous tunnel.
    private_json(&intent_path, &intent)?;
    if !credentials.exists() {
        if intent.tunnel_id.is_some() {
            bail!("Saved tunnel credentials are missing. Restore them or configure an existing tunnel token; no replacement tunnel was created.");
        }
        run(
            &exe,
            &[
                "tunnel".into(),
                "--credentials-file".into(),
                credentials.to_string_lossy().into(),
                "create".into(),
                name.into(),
            ],
            home,
            60,
        )?;
    }
    let id = credentials_id(&credentials)?;
    if intent
        .tunnel_id
        .as_ref()
        .is_some_and(|expected| *expected != id)
    {
        bail!("Saved tunnel credentials no longer match the recorded setup identity; no DNS changes were made");
    }
    intent.tunnel_id = Some(id.clone());
    private_json(&intent_path, &intent)?;
    // Idempotent on retry: reuse credentials and never silently overwrite another DNS route.
    run(
        &exe,
        &[
            "tunnel".into(),
            "route".into(),
            "dns".into(),
            "--overwrite-dns=false".into(),
            id.clone(),
            hostname.into(),
        ],
        home,
        60,
    ).context("Tunnel credentials are saved, but DNS setup failed. Retry with the same tunnel name or ID; the workspace configuration was not changed")?;
    Ok((id, credentials, public))
}
