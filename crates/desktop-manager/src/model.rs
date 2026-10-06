use serde::{Deserialize, Serialize};
use std::collections::HashMap;

fn local() -> String {
    "local".into()
}
fn noauth() -> String {
    "noauth".into()
}
fn safe() -> String {
    "safe".into()
}
fn version() -> String {
    "0.5.0".into()
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    #[serde(default)]
    pub id: String,
    pub name: String,
    pub path: String,
    #[serde(default)]
    pub port: u16,
    #[serde(default = "local")]
    pub access: String,
    #[serde(default)]
    pub public_url: String,
    #[serde(default = "noauth")]
    pub auth: String,
    #[serde(default = "safe")]
    pub permission_mode: String,
    #[serde(default)]
    pub core_command: Vec<String>,
    #[serde(default = "version")]
    pub core_version: String,
    #[serde(default)]
    pub tunnel_name: String,
    #[serde(default)]
    pub credentials_file: String,
    #[serde(default)]
    pub token_configured: bool,
}
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Secrets {
    #[serde(default)]
    pub bearer_token: String,
    #[serde(default)]
    pub oauth_password: String,
    #[serde(default)]
    pub oauth_token_secret: String,
    #[serde(default)]
    pub cloudflare_token: String,
}
impl Secrets {
    pub fn initialized() -> Self {
        let secret = || {
            format!(
                "{}{}",
                uuid::Uuid::new_v4().simple(),
                uuid::Uuid::new_v4().simple()
            )
        };
        Self {
            bearer_token: secret(),
            oauth_password: secret(),
            oauth_token_secret: secret(),
            cloudflare_token: String::new(),
        }
    }
    pub fn merge(&mut self, input: Self) {
        if !input.bearer_token.is_empty() {
            self.bearer_token = input.bearer_token;
        }
        if !input.oauth_password.is_empty() {
            self.oauth_password = input.oauth_password;
        }
        if !input.cloudflare_token.is_empty() {
            self.cloudflare_token = input.cloudflare_token;
        }
    }
    pub fn values(&self) -> Vec<&str> {
        [
            &self.bearer_token,
            &self.oauth_password,
            &self.oauth_token_secret,
            &self.cloudflare_token,
        ]
        .into_iter()
        .map(String::as_str)
        .filter(|s| !s.is_empty())
        .collect()
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub language: String,
    pub close_to_tray: bool,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            language: "en".into(),
            close_to_tray: true,
        }
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    pub schema_version: u32,
    pub workspaces: Vec<Workspace>,
    #[serde(default)]
    pub settings: Settings,
    #[serde(default)]
    pub secrets: HashMap<String, Secrets>,
    #[serde(default)]
    pub managed_core: Option<String>,
    #[serde(default)]
    pub previous_core: Option<String>,
}
impl Default for Config {
    fn default() -> Self {
        Self {
            schema_version: 2,
            workspaces: vec![],
            settings: Settings::default(),
            secrets: HashMap::new(),
            managed_core: None,
            previous_core: None,
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub workspace_id: String,
    pub state: String,
    pub pid: Option<u32>,
    pub local_state: String,
    pub public_state: String,
    pub local_message: String,
    pub public_message: String,
    pub local_endpoint: String,
    pub public_endpoint: String,
    pub cpu_percent: f32,
    pub memory_bytes: u64,
    pub uptime_seconds: u64,
    pub checked_at: String,
    pub core_version: String,
    pub activity_state: String,
    pub activity_message: String,
}
impl Status {
    pub fn stopped(w: &Workspace) -> Self {
        Self {
            workspace_id: w.id.clone(),
            state: "stopped".into(),
            pid: None,
            local_state: "stopped".into(),
            public_state: if w.access == "local" {
                "disabled"
            } else {
                "stopped"
            }
            .into(),
            local_message: "Not running".into(),
            public_message: if w.access == "local" {
                "Local access only"
            } else {
                "Not connected"
            }
            .into(),
            local_endpoint: format!("http://127.0.0.1:{}/mcp", w.port),
            public_endpoint: String::new(),
            cpu_percent: 0.,
            memory_bytes: 0,
            uptime_seconds: 0,
            checked_at: now(),
            core_version: w.core_version.clone(),
            activity_state: "unknown".into(),
            activity_message: "Start the core to check tool-call history support".into(),
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Activity {
    pub id: String,
    pub tool: String,
    pub started_at: String,
    pub finished_at: Option<String>,
    pub outcome: String,
    pub duration_ms: Option<u64>,
    pub error_category: Option<String>,
    pub runtime_id: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub workspaces: Vec<Workspace>,
    pub statuses: Vec<Status>,
    pub settings: Settings,
    pub migration_notice: Option<String>,
    pub core_available: bool,
    pub cloudflared_available: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Logs {
    pub text: String,
    pub cursor: u64,
    pub truncated: bool,
}
#[derive(Serialize)]
pub struct Diagnostic {
    pub level: String,
    pub name: String,
    pub message: String,
}
pub fn now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}
