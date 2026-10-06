use crate::{
    core::find_program,
    events,
    model::{Secrets, Workspace},
    process::ManagedProcess,
    storage::{private_dir, private_write},
};
use anyhow::{bail, Context, Result};
use std::{
    path::{Path, PathBuf},
    process::Command,
    thread,
    time::{Duration, Instant},
};

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
    let executable=find_program("cloudflared").context("cloudflared is missing. Install it from Cloudflare, then retry public access. Local MCP remains available.")?;
    let mut cmd = Command::new(executable);
    cmd.arg("tunnel").arg("--no-autoupdate");
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
        let config = state.join("cloudflared.json");
        let hostname = url::Url::parse(&w.public_url)?
            .host_str()
            .context("Missing public hostname")?
            .to_string();
        let content = serde_json::json!({"tunnel":w.tunnel_name,"credentials-file":w.credentials_file,"ingress":[{"hostname":hostname,"service":format!("http://127.0.0.1:{}",w.port)},{"service":"http_status:404"}]});
        private_write(&config, &serde_json::to_vec(&content)?)?;
        cmd.arg("--config")
            .arg(config)
            .arg("run")
            .arg(&w.tunnel_name);
    }
    let log = state.join("tunnel.log");
    private_write(&log, b"")?;
    let mut process = ManagedProcess::spawn(&mut cmd, log.clone(), secrets.clone())?;
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
            return Ok((process, public));
        }
        thread::sleep(Duration::from_millis(150));
    }
    process.stop()?;
    bail!("Cloudflare did not establish a connection within 25 seconds. Local MCP remains available; retry public access.")
}
fn run(executable: &Path, args: &[String], home: &Path, seconds: u64) -> Result<String> {
    let d = tempfile::tempdir_in(home)?;
    let log = d.path().join("cloudflare-setup.log");
    let mut cmd = Command::new(executable);
    cmd.args(args);
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
    if !regex::Regex::new(r"^[a-zA-Z0-9][a-zA-Z0-9_-]{0,62}$")
        .unwrap()
        .is_match(name)
    {
        bail!("Tunnel name must contain only letters, numbers, hyphens and underscores");
    }
    let public = format!("https://{hostname}");
    validate_public_url(&public)?;
    if url::Url::parse(&public)?.host_str() != Some(hostname) {
        bail!("Enter a hostname without a scheme, port or path");
    }
    let exe = find_program("cloudflared").context("Install cloudflared first")?;
    let dir = home.join("tunnels");
    private_dir(&dir)?;
    let credentials = dir.join(format!("{}.json", w.id));
    if !credentials.exists() {
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
    let content:serde_json::Value=serde_json::from_slice(&std::fs::read(&credentials).context("Tunnel creation did not produce credentials. Check account authorization and tunnel name.")?)?;
    let id = content["TunnelID"]
        .as_str()
        .context("Cloudflare credentials did not contain a tunnel ID")?
        .to_string();
    // Idempotent on retry: reuse credentials and never silently overwrite another DNS route.
    run(
        &exe,
        &[
            "tunnel".into(),
            "route".into(),
            "dns".into(),
            id.clone(),
            hostname.into(),
        ],
        home,
        60,
    )?;
    Ok((id, credentials, public))
}
