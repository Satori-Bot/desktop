use crate::{
    core, events,
    model::*,
    process::ManagedProcess,
    storage::{private_json, valid_id, Storage},
    tunnel,
};
use anyhow::{anyhow, bail, Context, Result};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant},
};

#[derive(Default)]
struct Session {
    runtime: Option<ManagedProcess>,
    tunnel: Option<ManagedProcess>,
    public_url: String,
}
struct Slot {
    session: Mutex<Session>,
    status: Mutex<Status>,
    run_started_ms: Mutex<Option<i64>>,
}
pub struct Manager {
    pub storage: Storage,
    config: Mutex<Config>,
    slots: Mutex<HashMap<String, Arc<Slot>>>,
    migration_notice: Option<String>,
    install_lock: Mutex<()>,
}
fn validate_access(w: &Workspace, starting: bool) -> Result<()> {
    if !["local", "quick", "named", "frp"].contains(&w.access.as_str()) {
        bail!("Unknown access mode");
    }
    if !["noauth", "bearer", "oauth"].contains(&w.auth.as_str()) {
        bail!("Unknown authentication mode");
    }
    if !["safe", "trusted"].contains(&w.permission_mode.as_str()) {
        bail!("Choose safe or trusted permissions before starting this workspace");
    }
    if w.access != "local" && w.auth == "noauth" {
        bail!("Public access requires bearer-token or OAuth authentication. Repair this workspace before starting it.");
    }
    if w.access == "quick" && w.auth == "oauth" {
        bail!("OAuth needs a fixed public address. Choose a named tunnel or bearer authentication for a temporary tunnel.");
    }
    if ["named", "frp"].contains(&w.access.as_str()) && (starting || !w.public_url.is_empty()) {
        tunnel::validate_public_url(&w.public_url)?;
    }
    if !w.core_command.is_empty() && w.core_command[0].trim().is_empty() {
        bail!("Custom core executable is empty");
    }
    Ok(())
}
impl Manager {
    pub fn open(home: PathBuf) -> Result<Arc<Self>> {
        let storage = Storage::open(home)?;
        let (config, migration_notice) = storage.load()?;
        let manager = Arc::new(Self {
            storage,
            config: Mutex::new(config),
            slots: Mutex::new(HashMap::new()),
            migration_notice,
            install_lock: Mutex::new(()),
        });
        let weak = Arc::downgrade(&manager);
        thread::spawn(move || loop {
            thread::sleep(Duration::from_secs(2));
            let Some(m) = weak.upgrade() else { break };
            m.refresh();
        });
        Ok(manager)
    }
    pub fn default_home() -> Result<PathBuf> {
        Ok(dirs::home_dir()
            .context("Home directory not found")?
            .join(".coding-tools-mcp-desktop"))
    }
    fn config(&self) -> Config {
        self.config.lock().unwrap().clone()
    }
    fn workspace(&self, id: &str) -> Result<(Workspace, Secrets)> {
        valid_id(id)?;
        let c = self.config();
        let w = c
            .workspaces
            .iter()
            .find(|w| w.id == id)
            .context("Workspace no longer exists")?
            .clone();
        let s = c.secrets.get(id).cloned().unwrap_or_default();
        Ok((w, s))
    }
    fn slot(&self, w: &Workspace) -> Arc<Slot> {
        self.slots
            .lock()
            .unwrap()
            .entry(w.id.clone())
            .or_insert_with(|| {
                Arc::new(Slot {
                    session: Mutex::new(Session::default()),
                    status: Mutex::new(Status::stopped(w)),
                    run_started_ms: Mutex::new(None),
                })
            })
            .clone()
    }
    fn update(&self, slot: &Slot, update: impl FnOnce(&mut Status)) {
        let mut s = slot.status.lock().unwrap();
        update(&mut s);
        s.checked_at = now();
    }
    pub fn snapshot(&self) -> Snapshot {
        let c = self.config();
        Snapshot {
            statuses: c
                .workspaces
                .iter()
                .map(|w| self.slot(w).status.lock().unwrap().clone())
                .collect(),
            workspaces: c.workspaces.clone(),
            settings: c.settings,
            migration_notice: self.migration_notice.clone(),
            core_available: c
                .managed_core
                .as_ref()
                .is_some_and(|p| Path::new(p).is_file())
                || core::find_program("coding-tools-mcp").is_some(),
            cloudflared_available: core::find_program("cloudflared").is_some(),
        }
    }
    pub fn save_workspace(&self, mut w: Workspace, input: Option<Secrets>) -> Result<Workspace> {
        if w.id.is_empty() {
            w.id = uuid::Uuid::new_v4().simple().to_string();
        }
        valid_id(&w.id)?;
        if w.name.trim().is_empty() || w.name.len() > 120 {
            bail!("Enter a workspace name of 1 to 120 characters");
        }
        let path = Path::new(&w.path)
            .canonicalize()
            .context("Choose an existing workspace folder")?;
        if !path.is_dir() {
            bail!("Workspace must be a folder");
        }
        w.path = path.to_string_lossy().into();
        validate_access(&w, false)?;
        if ["named", "frp"].contains(&w.access.as_str()) && !w.public_url.is_empty() {
            tunnel::validate_public_url(&w.public_url)?;
            w.public_url = w.public_url.trim_end_matches('/').into();
        }
        if w.access == "local" || w.access == "quick" {
            w.public_url.clear();
        }
        if w.core_command.iter().any(|a| a.contains('\0')) {
            bail!("Executable arguments contain invalid characters");
        }
        let slot = self.slot(&w);
        let session = slot
            .session
            .try_lock()
            .map_err(|_| anyhow!("Workspace operation is in progress"))?;
        if session.runtime.is_some() || session.tunnel.is_some() {
            bail!(
                "Stop this workspace before saving configuration changes, including after a crash"
            );
        }
        let mut c = self.config.lock().unwrap();
        if w.port == 0 {
            w.port = (28766..60000)
                .find(|p| {
                    !c.workspaces.iter().any(|x| x.id != w.id && x.port == *p)
                        && TcpListener::bind(("127.0.0.1", *p)).is_ok()
                })
                .context("No available local port")?;
        }
        if c.workspaces
            .iter()
            .any(|x| x.id != w.id && x.port == w.port)
        {
            bail!("Another workspace already uses this port; choose a different port");
        }
        let mut next = c.clone();
        let s = next
            .secrets
            .entry(w.id.clone())
            .or_insert_with(Secrets::initialized);
        if let Some(input) = input {
            if input.values().iter().any(|s| s.len() > 8192) {
                bail!("Credential exceeds maximum length");
            }
            s.merge(input);
        }
        w.token_configured = !s.cloudflare_token.is_empty();
        if let Some(old) = next.workspaces.iter_mut().find(|x| x.id == w.id) {
            *old = w.clone();
        } else {
            next.workspaces.push(w.clone());
        }
        self.storage.save(&next)?;
        *c = next;
        *slot.status.lock().unwrap() = Status::stopped(&w);
        Ok(w)
    }
    pub fn delete_workspace(&self, id: &str) -> Result<()> {
        let (w, _) = self.workspace(id)?;
        let slot = self.slot(&w);
        let session = slot
            .session
            .try_lock()
            .map_err(|_| anyhow!("Workspace operation is in progress"))?;
        if session.runtime.is_some() || session.tunnel.is_some() {
            bail!("Stop the workspace before removing it, including after a crash");
        }
        let mut c = self.config.lock().unwrap();
        private_json(&self.storage.home.join("desktop-before-delete.json"), &*c)?;
        let mut next = c.clone();
        next.workspaces.retain(|w| w.id != id);
        next.secrets.remove(id);
        self.storage.save(&next)?;
        *c = next;
        Ok(())
    }
    pub fn start(&self, id: &str) -> Result<Status> {
        let (w, secrets) = self.workspace(id)?;
        let slot = self.slot(&w);
        let mut session = slot
            .session
            .try_lock()
            .map_err(|_| anyhow!("Workspace operation is already in progress"))?;
        if session.runtime.as_mut().is_some_and(|p| p.alive()) {
            return Ok(slot.status.lock().unwrap().clone());
        }
        self.update(&slot, |s| {
            s.state = "starting".into();
            s.local_state = "starting".into();
            s.local_message = "Starting the external Python core".into();
        });
        let result = (|| -> Result<()> {
            validate_access(&w, true)?;
            if !Path::new(&w.path).is_dir() {
                bail!("Workspace folder no longer exists");
            }
            if w.port == 0 {
                bail!("Workspace port is not configured; save the workspace to allocate it");
            }
            if w.auth == "bearer" && secrets.bearer_token.is_empty() {
                bail!("Bearer credential is missing; save the workspace to generate one");
            }
            if w.auth == "oauth"
                && (secrets.oauth_password.is_empty() || secrets.oauth_token_secret.is_empty())
            {
                bail!("OAuth credentials are missing; repair the workspace configuration");
            }
            let port=TcpListener::bind(("127.0.0.1",w.port)).context("Port is already in use. Stop its owner or choose another port; no unrelated process was terminated.")?;
            drop(port);
            let state = self.storage.state_dir(id)?;
            events::begin_run(&state)?;
            let mut cmd = core::command(&w, &secrets, &self.config(), &state)?;
            let mut process =
                ManagedProcess::spawn(&mut cmd, state.join("runtime.log"), secrets.clone())?;
            // CPython's HTTPServer performs reverse-DNS lookup before listen.
            // Some macOS resolver configurations take >30s; keep protocol
            // readiness mandatory while allowing that supported core to finish.
            let startup_budget = if cfg!(target_os = "macos") { 60 } else { 20 };
            let deadline = Instant::now() + Duration::from_secs(startup_budget);
            let mut last = "Waiting for MCP readiness".to_string();
            let mut ready = false;
            while Instant::now() < deadline {
                if !process.alive() {
                    bail!("Python core exited during startup. Open runtime logs for details.");
                }
                match core::probe(&w, &secrets, false) {
                    Ok(message) => {
                        last = message;
                        ready = true;
                        break;
                    }
                    Err(e) => last = format!("{e:#}"),
                }
                if cfg!(target_os = "macos") && process.started.elapsed().as_secs() >= 10 {
                    self.update(&slot,|s|s.local_message="Waiting for the Python core to finish starting. macOS hostname lookup can take about 30 seconds; readiness is still being checked.".into());
                }
                thread::sleep(Duration::from_millis(150));
            }
            if !ready {
                process.stop()?;
                bail!("Core readiness check timed out: {last}");
            }
            let pid = process.pid();
            *slot.run_started_ms.lock().unwrap() = Some(
                chrono::Utc::now().timestamp_millis()
                    - process.started.elapsed().as_millis() as i64,
            );
            session.runtime = Some(process);
            let activity_available = state.join("events/journal.lock").is_file();
            self.update(&slot,|s|{s.activity_state=if activity_available{"available"}else{"unavailable"}.into();s.activity_message=if activity_available{"Reading real calls from this core's private event journal"}else{"This core build does not expose a tool-call journal. Published 0.5.0 supports launch and connection; history requires an event-capable official core executable."}.into();});
            self.update(&slot, |s| {
                s.state = "running".into();
                s.pid = Some(pid);
                s.local_state = "ready".into();
                s.core_version = last
                    .split_whitespace()
                    .nth(1)
                    .unwrap_or("unknown")
                    .trim_end_matches(':')
                    .into();
                s.local_message = last;
            });
            self.start_tunnel_inner(&w, &secrets, &slot, &mut session);
            Ok(())
        })();
        if let Err(e) = result {
            let mut message = events::redact(&format!("{e:#}"), &secrets);
            if let Ok(log) = self.logs(id, "runtime", 0) {
                let lines: Vec<_> = log.text.lines().rev().take(8).collect();
                let tail = lines.into_iter().rev().collect::<Vec<_>>().join("\n");
                if !tail.trim().is_empty() {
                    message.push_str("\nRecent runtime output:\n");
                    message.push_str(&tail.chars().take(4000).collect::<String>());
                }
            }
            self.update(&slot, |s| {
                s.state = "error".into();
                s.local_state = "error".into();
                s.local_message = message.clone();
            });
            return Err(anyhow!(message));
        }
        let result = slot.status.lock().unwrap().clone();
        Ok(result)
    }
    fn start_tunnel_inner(
        &self,
        w: &Workspace,
        secrets: &Secrets,
        slot: &Slot,
        session: &mut Session,
    ) {
        if let Some(mut old) = session.tunnel.take() {
            let _ = old.stop();
        }
        session.public_url.clear();
        if w.access == "local" {
            self.update(slot, |s| {
                s.public_state = "disabled".into();
                s.public_message = "Local access only".into();
                s.public_endpoint.clear();
            });
            return;
        }
        if w.access == "frp" {
            session.public_url = w.public_url.clone();
            self.update(slot, |s| {
                s.public_state = "unverified".into();
                s.public_message =
                    "FRP is externally managed. Run diagnostics to check its public address."
                        .into();
                s.public_endpoint = format!("{}/mcp", w.public_url);
            });
            return;
        }
        self.update(slot, |s| {
            s.public_state = "connecting".into();
            s.public_message = "Connecting Cloudflare; local MCP is ready".into();
            s.public_endpoint.clear();
        });
        let result = self
            .storage
            .state_dir(&w.id)
            .and_then(|dir| tunnel::start(w, secrets, &dir));
        match result {
            Ok((process, url)) => {
                session.tunnel = Some(process);
                session.public_url = url.clone();
                self.update(slot, |s| {
                    s.public_state = "connected".into();
                    s.public_message = if w.access == "quick" {
                        "Temporary tunnel connected. Address changes when restarted."
                    } else {
                        "Fixed tunnel connected. Run diagnostics to verify the public route."
                    }
                    .into();
                    s.public_endpoint = format!("{url}/mcp");
                });
            }
            Err(e) => self.update(slot, |s| {
                s.public_state = "error".into();
                s.public_message = events::redact(&e.to_string(), secrets);
                s.public_endpoint.clear();
            }),
        }
    }
    pub fn retry_tunnel(&self, id: &str) -> Result<Status> {
        let (w, s) = self.workspace(id)?;
        let slot = self.slot(&w);
        let mut session = slot
            .session
            .try_lock()
            .map_err(|_| anyhow!("Workspace operation is in progress"))?;
        if !session.runtime.as_mut().is_some_and(|p| p.alive()) {
            bail!("Start local MCP before retrying public access");
        }
        self.start_tunnel_inner(&w, &s, &slot, &mut session);
        let result = slot.status.lock().unwrap().clone();
        Ok(result)
    }
    pub fn stop(&self, id: &str) -> Result<Status> {
        let (w, _) = self.workspace(id)?;
        let slot = self.slot(&w);
        let mut session = slot.session.try_lock().map_err(|_| {
            anyhow!("Workspace operation is in progress; wait for startup to finish")
        })?;
        self.update(&slot, |s| {
            s.state = "stopping".into();
            s.local_message = "Stopping owned processes and verifying port release".into();
        });
        let result = (|| -> Result<()> {
            if let Some(p) = session.tunnel.as_mut() {
                p.stop()?;
            }
            session.tunnel = None;
            if let Some(p) = session.runtime.as_mut() {
                p.stop()?;
            }
            session.runtime = None;
            *slot.run_started_ms.lock().unwrap() = None;
            let until = Instant::now() + Duration::from_secs(4);
            while TcpStream::connect_timeout(
                &format!("127.0.0.1:{}", w.port).parse().unwrap(),
                Duration::from_millis(100),
            )
            .is_ok()
            {
                if Instant::now() >= until {
                    bail!("Managed process exited, but port is still in use. Stop is not confirmed; another process may own it.");
                }
                thread::sleep(Duration::from_millis(100));
            }
            Ok(())
        })();
        if let Err(e) = result {
            self.update(&slot, |s| {
                s.state = "error".into();
                s.local_state = "error".into();
                s.local_message = e.to_string();
            });
            return Err(e);
        }
        session.public_url.clear();
        let status = Status::stopped(&w);
        *slot.status.lock().unwrap() = status.clone();
        Ok(status)
    }
    pub fn restart(&self, id: &str) -> Result<Status> {
        self.stop(id)?;
        self.start(id)
    }
    pub fn refresh(&self) {
        let c = self.config();
        for w in c.workspaces {
            let slot = self.slot(&w);
            let Ok(mut session) = slot.session.try_lock() else {
                continue;
            };
            if let Some(p) = session.runtime.as_mut() {
                if !p.alive() {
                    session.runtime = None;
                    *slot.run_started_ms.lock().unwrap() = None;
                    if let Some(mut t) = session.tunnel.take() {
                        let _ = t.stop();
                    }
                    self.update(&slot, |s| {
                        s.state = "error".into();
                        s.local_state = "error".into();
                        s.local_message =
                            "Python core exited unexpectedly. Inspect logs and restart.".into();
                        s.pid = None;
                        s.cpu_percent = 0.;
                        s.memory_bytes = 0;
                        s.public_state = "stopped".into();
                        s.public_endpoint.clear();
                    });
                    continue;
                }
                let (cpu, memory) = p.metrics();
                let uptime = p.started.elapsed().as_secs();
                let secret = c.secrets.get(&w.id).cloned().unwrap_or_default();
                let health = core::probe(&w, &secret, false);
                self.update(&slot, |s| {
                    s.cpu_percent = cpu;
                    s.memory_bytes = memory;
                    s.uptime_seconds = uptime;
                    match health {
                        Ok(message) => {
                            s.local_state = "ready".into();
                            s.local_message = message
                        }
                        Err(e) => {
                            s.local_state = "unhealthy".into();
                            s.local_message = e.to_string()
                        }
                    }
                });
            }
            if let Some(t) = session.tunnel.as_mut() {
                if !t.alive() {
                    session.tunnel = None;
                    self.update(&slot,|s|{s.public_state="error".into();s.public_message="Cloudflare process exited. Local MCP is still available; retry public access.".into();s.public_endpoint.clear();});
                }
            }
        }
    }
    pub fn activity(&self, id: &str) -> Result<Vec<Activity>> {
        let (w, _) = self.workspace(id)?;
        let slot = self.slot(&w);
        let since = *slot.run_started_ms.lock().unwrap();
        {
            let dir = self.storage.state_dir(id)?;
            let mut rows = events::activity(&dir.join("events"), since)?;
            for i in 1..=3 {
                rows.extend(events::activity(
                    &dir.join(format!("events.previous.{i}")),
                    None,
                )?);
            }
            rows.sort_by(|a, b| b.started_at.cmp(&a.started_at));
            rows.truncate(200);
            Ok(rows)
        }
    }
    pub fn logs(&self, id: &str, kind: &str, cursor: u64) -> Result<Logs> {
        let (_, s) = self.workspace(id)?;
        let file = match kind {
            "runtime" => "runtime.log",
            "tunnel" => "tunnel.log",
            _ => bail!("Unknown log stream"),
        };
        events::logs(&self.storage.state_dir(id)?.join(file), cursor, &s)
    }
    pub fn diagnose(&self, id: &str) -> Result<Vec<Diagnostic>> {
        let (w, s) = self.workspace(id)?;
        let mut rows = vec![];
        let mut push = |name: &str, result: Result<String>| {
            rows.push(match result {
                Ok(message) => Diagnostic {
                    level: "ok".into(),
                    name: name.into(),
                    message,
                },
                Err(e) => Diagnostic {
                    level: "error".into(),
                    name: name.into(),
                    message: events::redact(&e.to_string(), &s),
                },
            })
        };
        push(
            "Workspace folder",
            if Path::new(&w.path).is_dir() {
                Ok("Folder exists".into())
            } else {
                Err(anyhow!("Folder no longer exists"))
            },
        );
        push(
            "Core executable",
            core::resolve(&w, &self.config())
                .and_then(|args| core::version_output(&args, &self.storage.home)),
        );
        push("Local MCP protocol", core::probe(&w, &s, false));
        if w.access != "local" {
            let mut active = w.clone();
            let slot = self.slot(&w);
            let session = slot.session.lock().unwrap();
            if !session.public_url.is_empty() {
                active.public_url = session.public_url.clone();
            }
            drop(session);
            let result = core::probe(&active, &s, true);
            self.update(&slot, |status| match &result {
                Ok(message) => {
                    status.public_state = "ready".into();
                    status.public_message = message.clone();
                }
                Err(error) => {
                    status.public_state = "error".into();
                    status.public_message = error.to_string();
                }
            });
            push("Public discovery", result);
        }
        let activity_state = self.slot(&w).status.lock().unwrap().activity_state.clone();
        let records = self.activity(id)?;
        if activity_state == "unavailable" {
            rows.push(Diagnostic{level:"warning".into(),name:"Tool activity".into(),message:"This running core build does not provide structured tool-call events. Published 0.5.0 lacks this capability; select an event-capable official core executable to enable history.".into()});
        } else if records.is_empty() {
            rows.push(Diagnostic{level:"warning".into(),name:"Tool activity".into(),message:"No tool records yet. Invoke a tool from an MCP client. The installed core must support CODING_TOOLS_MCP_EVENT_LOG_DIR; older builds cannot provide per-call history.".into()});
        } else {
            rows.push(Diagnostic {
                level: "ok".into(),
                name: "Tool activity".into(),
                message: format!(
                    "{} recent tool calls read from the core event journal",
                    records.len()
                ),
            });
        }
        Ok(rows)
    }
    pub fn export_diagnostics(&self, id: &str) -> Result<String> {
        let (w, _) = self.workspace(id)?;
        let slot = self.slot(&w);
        let status = slot.status.lock().unwrap().clone();
        let diagnostics = self.diagnose(id)?;
        // Intentionally exclude raw logs, credentials, paths, commands, URLs, workspace names and call payloads.
        Ok(serde_json::to_string_pretty(
            &json!({"desktopVersion":env!("CARGO_PKG_VERSION"),"platform":std::env::consts::OS,"state":status.state,"localState":status.local_state,"publicState":status.public_state,"cpuPercent":status.cpu_percent,"memoryBytes":status.memory_bytes,"uptimeSeconds":status.uptime_seconds,"checks":diagnostics.iter().map(|d|json!({"name":d.name,"level":d.level})).collect::<Vec<_>>(),"activity":self.activity(id)?.iter().map(|a|json!({"tool":a.tool,"outcome":a.outcome,"durationMs":a.duration_ms,"errorCategory":a.error_category})).collect::<Vec<_>>()}),
        )?)
    }
    pub fn connection_config(&self, id: &str, public: bool) -> Result<String> {
        let (w, s) = self.workspace(id)?;
        let slot = self.slot(&w);
        let status = slot.status.lock().unwrap();
        let endpoint = if public {
            if status.public_endpoint.is_empty() {
                bail!("No active public endpoint");
            }
            status.public_endpoint.clone()
        } else {
            status.local_endpoint.clone()
        };
        let mut entry = json!({"url":endpoint});
        if w.auth == "bearer" {
            entry["headers"] = json!({"Authorization":format!("Bearer {}",s.bearer_token)});
        }
        Ok(serde_json::to_string_pretty(
            &json!({"mcpServers":{w.name:entry}}),
        )?)
    }
    pub fn auth_details(&self, id: &str) -> Result<Value> {
        let (w, s) = self.workspace(id)?;
        Ok(match w.auth.as_str() {
            "oauth" => json!({"auth":"oauth","oauthPassword":s.oauth_password}),
            "bearer" => json!({"auth":"bearer","bearerToken":s.bearer_token}),
            _ => json!({"auth":"noauth"}),
        })
    }
    pub fn save_settings(&self, s: Settings) -> Result<Settings> {
        if !["en", "zh"].contains(&s.language.as_str()) {
            bail!("Unsupported language");
        }
        let mut c = self.config.lock().unwrap();
        let mut n = c.clone();
        n.settings = s.clone();
        self.storage.save(&n)?;
        *c = n;
        Ok(s)
    }
    pub fn settings(&self) -> Settings {
        self.config().settings
    }
    pub fn workspace_path(&self, id: &str) -> Result<String> {
        Ok(self.workspace(id)?.0.path)
    }
    pub fn install_core(&self, version: &str) -> Result<String> {
        let _guard = self
            .install_lock
            .try_lock()
            .map_err(|_| anyhow!("Core installation is already in progress"))?;
        let path = core::install(&self.storage, version)?;
        let mut c = self.config.lock().unwrap();
        let mut n = c.clone();
        n.previous_core = n.managed_core.clone();
        n.managed_core = Some(path);
        self.storage.save(&n)?;
        *c = n;
        Ok(format!("Core {version} installed and verified. Running workspaces keep their current core until restarted."))
    }
    pub fn rollback_core(&self) -> Result<String> {
        let _guard = self
            .install_lock
            .try_lock()
            .map_err(|_| anyhow!("Core installation is in progress"))?;
        let previous = self
            .config()
            .previous_core
            .context("No previous managed core is available")?;
        core::version_output(std::slice::from_ref(&previous), &self.storage.home)?;
        let mut c = self.config.lock().unwrap();
        let mut n = c.clone();
        n.previous_core = n.managed_core.clone();
        n.managed_core = Some(previous);
        self.storage.save(&n)?;
        *c = n;
        Ok("Previous core restored. Restart workspaces when ready to use it.".into())
    }
    pub fn cloudflare_login(&self) -> Result<String> {
        let _guard = self
            .install_lock
            .try_lock()
            .map_err(|_| anyhow!("Another installation or Cloudflare setup is in progress"))?;
        tunnel::login(&self.storage.home)
    }
    pub fn setup_named_tunnel(&self, id: &str, name: &str, hostname: &str) -> Result<Workspace> {
        let _guard = self
            .install_lock
            .try_lock()
            .map_err(|_| anyhow!("Another installation or Cloudflare setup is in progress"))?;
        let (mut w, _) = self.workspace(id)?;
        let slot = self.slot(&w);
        let session = slot
            .session
            .try_lock()
            .map_err(|_| anyhow!("Workspace operation is in progress"))?;
        if session.runtime.is_some() {
            bail!("Stop the workspace before configuring its fixed tunnel");
        }
        let (tunnel, credentials, url) = tunnel::setup(&w, name, hostname, &self.storage.home)?;
        w.access = "named".into();
        w.tunnel_name = tunnel;
        w.credentials_file = credentials.to_string_lossy().into();
        w.public_url = url;
        w.token_configured = false;
        if w.auth == "noauth" {
            w.auth = "oauth".into();
        }
        let mut config = self.config.lock().unwrap();
        let mut next = config.clone();
        next.secrets
            .entry(id.into())
            .or_default()
            .cloudflare_token
            .clear();
        *next
            .workspaces
            .iter_mut()
            .find(|x| x.id == id)
            .context("Workspace no longer exists")? = w.clone();
        self.storage.save(&next)?;
        *config = next;
        Ok(w)
    }
    pub fn stop_all(&self) -> Result<()> {
        let _guard=self.install_lock.try_lock().map_err(|_|anyhow!("An installation or Cloudflare setup is in progress. Wait for it to finish before quitting."))?;
        let mut errors = vec![];
        for w in self.config().workspaces {
            let slot = self.slot(&w);
            let managed = slot
                .session
                .try_lock()
                .map(|s| s.runtime.is_some() || s.tunnel.is_some())
                .unwrap_or(true);
            if managed {
                if let Err(e) = self.stop(&w.id) {
                    errors.push(e.to_string());
                }
            }
        }
        if !errors.is_empty() {
            bail!("{}", errors.join("; "));
        }
        Ok(())
    }
}
