use crate::model::*;
use anyhow::{bail, Context, Result};
use fs2::FileExt;
use serde::Serialize;
use serde_json::Value;
use std::{
    collections::HashSet,
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};

pub struct Storage {
    pub home: PathBuf,
    _lock: File,
}
pub fn private_dir(path: &Path) -> Result<()> {
    if path
        .symlink_metadata()
        .map(|m| m.file_type().is_symlink())
        .unwrap_or(false)
    {
        bail!("Storage directory must not be a symlink");
    }
    fs::create_dir_all(path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}
pub fn private_write(path: &Path, data: &[u8]) -> Result<()> {
    let parent = path.parent().context("Missing parent directory")?;
    private_dir(parent)?;
    let mut tmp = tempfile::NamedTempFile::new_in(parent)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        tmp.as_file()
            .set_permissions(fs::Permissions::from_mode(0o600))?;
    }
    tmp.write_all(data)?;
    tmp.as_file().sync_all()?;
    tmp.persist(path).map_err(|e| e.error)?;
    Ok(())
}
pub fn private_json<T: Serialize>(path: &Path, data: &T) -> Result<()> {
    private_write(path, &serde_json::to_vec_pretty(data)?)
}
pub fn valid_id(id: &str) -> Result<()> {
    if id.len() != 32 || !id.bytes().all(|c| c.is_ascii_hexdigit()) {
        bail!("Invalid workspace ID");
    }
    Ok(())
}
fn validate_config(config: &Config) -> Result<()> {
    if config.schema_version != 2 {
        bail!("Unsupported configuration version; use a compatible desktop release");
    }
    let mut ids = HashSet::new();
    for w in &config.workspaces {
        valid_id(&w.id)?;
        if !ids.insert(w.id.to_ascii_lowercase()) {
            bail!("Configuration contains duplicate workspace IDs; original files were preserved");
        }
    }
    Ok(())
}
fn parse_legacy_command(command: &str, windows: bool) -> Result<Vec<String>> {
    if !windows {
        return shell_words::split(command)
            .context("Legacy custom command could not be parsed; original files preserved");
    }
    // Match legacy Windows quote grouping without interpreting path backslashes
    // as POSIX escapes. No command is ever passed to a shell.
    let mut result = Vec::new();
    let mut token = String::new();
    let mut quote = None;
    let mut started = false;
    for ch in command.chars() {
        if let Some(q) = quote {
            if ch == q {
                quote = None;
            } else {
                token.push(ch);
            }
            started = true;
        } else if ch == '\"' || ch == '\'' {
            quote = Some(ch);
            started = true;
        } else if ch.is_whitespace() {
            if started {
                result.push(std::mem::take(&mut token));
                started = false;
            }
        } else {
            token.push(ch);
            started = true;
        }
    }
    if quote.is_some() {
        bail!("Legacy custom command has an unmatched quote; original files preserved");
    }
    if started {
        result.push(token);
    }
    Ok(result)
}
pub const CONFIG_FILE: &str = "desktop-v2.json";
pub const CONFIG_BACKUP: &str = "desktop-v2.json.bak";

fn decode_config(bytes: &[u8]) -> Result<Config> {
    let config = serde_json::from_slice(bytes).context("Configuration is not valid JSON")?;
    validate_config(&config)?;
    Ok(config)
}

fn other_config_version(bytes: &[u8]) -> bool {
    serde_json::from_slice::<Value>(bytes)
        .is_ok_and(|value| value["schemaVersion"].as_u64().is_some_and(|n| n != 2))
}

impl Storage {
    pub fn open(home: PathBuf) -> Result<Self> {
        private_dir(&home)?;
        let lock_path = home.join("manager.lock");
        if lock_path.is_symlink() {
            bail!("Manager lock must not be a symlink");
        }
        let lock = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(lock_path)?;
        lock.try_lock_exclusive()
            .context("Another desktop manager is already using this configuration")?;
        Ok(Self { home, _lock: lock })
    }
    pub fn state_dir(&self, id: &str) -> Result<PathBuf> {
        valid_id(id)?;
        let path = self.home.join("state").join(id);
        private_dir(&path)?;
        Ok(path)
    }
    pub fn save(&self, config: &Config) -> Result<()> {
        validate_config(config)?;
        let main = self.home.join(CONFIG_FILE);
        let backup = self.home.join(CONFIG_BACKUP);
        let next = serde_json::to_vec_pretty(config)?;
        match fs::read(&main) {
            Ok(old) if decode_config(&old).is_ok() => {
                private_write(&backup, &old)
                    .context("Could not save previous desktop configuration")?;
            }
            Ok(_) => {
                bail!("Configuration changed on disk and is invalid; no files were overwritten")
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                if backup.exists() {
                    bail!("Main configuration is missing but a backup exists; restore it before saving");
                }
                // Even the initial v2 write has a recovery copy.
                private_write(&backup, &next)
                    .context("Could not create desktop configuration backup")?;
            }
            Err(error) => {
                return Err(error).context("Could not read the previous desktop configuration")
            }
        }
        private_write(&main, &next)?;
        // The primary commit succeeded. Updating the mirror is best effort:
        // if the disk fails here, keep the last validated recovery copy and
        // don't tell the caller to roll back a commit that already happened.
        if let Err(error) = private_write(&backup, &next) {
            eprintln!("Could not update the desktop configuration backup: {error}");
        }
        Ok(())
    }
    pub fn backup_preview(&self) -> Option<(std::time::SystemTime, usize)> {
        if !self.has_recoverable_backup() {
            return None;
        }
        let path = self.home.join(CONFIG_BACKUP);
        let time = fs::metadata(&path).ok()?.modified().ok()?;
        let config = decode_config(&fs::read(&path).ok()?).ok()?;
        Some((time, config.workspaces.len()))
    }
    pub fn has_recoverable_backup(&self) -> bool {
        let needs_recovery = match fs::read(self.home.join(CONFIG_FILE)) {
            Ok(bytes) => decode_config(&bytes).is_err() && !other_config_version(&bytes),
            Err(error) => error.kind() == std::io::ErrorKind::NotFound,
        };
        needs_recovery
            && fs::read(self.home.join(CONFIG_BACKUP))
                .is_ok_and(|bytes| decode_config(&bytes).is_ok())
    }
    /// Restore only a malformed or missing main file; never roll back a healthy one.
    pub fn restore_backup(&self) -> Result<()> {
        let main = self.home.join(CONFIG_FILE);
        let backup = fs::read(self.home.join(CONFIG_BACKUP)).context("No backup could be read")?;
        decode_config(&backup).context("Backup is invalid")?;
        match fs::read(&main) {
            Ok(old) => {
                // A newer schema may be healthy in a newer app. Do not replace it.
                if other_config_version(&old) {
                    bail!("This configuration needs a compatible desktop version; it was not replaced");
                }
                if decode_config(&old).is_ok() {
                    bail!("The main configuration is already valid; it was not replaced");
                }
                let saved = self.home.join(format!(
                    "desktop-v2.invalid-{}.json",
                    uuid::Uuid::new_v4().simple()
                ));
                private_write(&saved, &old)
                    .context("Could not preserve the damaged configuration")?;
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error).context("Could not read the damaged configuration"),
        }
        private_write(&main, &backup)
    }
    pub fn load(&self) -> Result<(Config, Option<String>)> {
        let path = self.home.join(CONFIG_FILE);
        match fs::read(&path) {
            Ok(bytes) => {
                return Ok((
                    decode_config(&bytes)
                        .context("Configuration is invalid; original files were preserved")?,
                    None,
                ))
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                if self.home.join(CONFIG_BACKUP).exists() {
                    bail!("The main desktop configuration is missing; restore it from backup");
                }
            }
            Err(error) => return Err(error).context("Could not read desktop configuration"),
        }
        let legacy = self.home.join("profiles.json");
        if !legacy.exists() {
            return Ok((Config::default(), None));
        }
        let bytes = fs::read(&legacy)?;
        let old: Value = serde_json::from_slice(&bytes)
            .context("Legacy profiles are invalid; no files were changed")?;
        let old_secrets = self.home.join("secrets.json");
        let secrets: Value = if old_secrets.exists() {
            serde_json::from_slice(&fs::read(&old_secrets)?)?
        } else {
            serde_json::json!({})
        };
        let mut config = Config::default();
        let mut ids = HashSet::new();
        for p in old
            .get("profiles")
            .and_then(Value::as_array)
            .context("Legacy profiles list is missing")?
        {
            let id = p["id"]
                .as_str()
                .context("Legacy workspace ID missing")?
                .to_string();
            valid_id(&id)?;
            if !ids.insert(id.to_ascii_lowercase()) {
                bail!("Legacy profiles contain duplicate workspace IDs; no files were changed");
            }
            let text = |key: &str| {
                p.pointer(key)
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string()
            };
            let command = text("/runtime/runtime_command");
            let core_command = if command.is_empty() {
                vec![]
            } else {
                parse_legacy_command(&command, cfg!(windows))?
            };
            let access = match text("/tunnel/type").as_str() {
                "cloudflare" => {
                    if text("/tunnel/cloudflare_mode") == "named" {
                        "named"
                    } else {
                        "quick"
                    }
                }
                "frp" => "frp",
                _ => "local",
            };
            let secret = |key: &str, fallback: &str| {
                secrets[&id][key]
                    .as_str()
                    .filter(|s| !s.is_empty())
                    .map(String::from)
                    .unwrap_or_else(|| text(fallback))
            };
            let mut s = Secrets::initialized();
            let bearer = secret("bearer_token", "/auth/bearer_token");
            if !bearer.is_empty() {
                s.bearer_token = bearer;
            }
            let password = secret("oauth_password", "/auth/oauth_password");
            if !password.is_empty() {
                s.oauth_password = password;
            }
            let oauth = secret("oauth_token_secret", "/auth/oauth_token_secret");
            if !oauth.is_empty() {
                s.oauth_token_secret = oauth;
            }
            s.cloudflare_token = secret("cloudflare_token", "/tunnel/cloudflare_token");
            let mut public_url = text("/tunnel/public_url").trim_end_matches('/').to_owned();
            if access == "frp"
                && !text("/tunnel/frp_subdomain").is_empty()
                && !text("/tunnel/frp_server").is_empty()
            {
                public_url = format!(
                    "https://{}.{}",
                    text("/tunnel/frp_subdomain"),
                    text("/tunnel/frp_server")
                );
            }
            config.workspaces.push(Workspace {
                id: id.clone(),
                name: text("/name"),
                path: text("/path"),
                port: p
                    .pointer("/runtime/local_port")
                    .and_then(Value::as_u64)
                    .and_then(|x| x.try_into().ok())
                    .unwrap_or(28766),
                access: access.into(),
                public_url,
                auth: if text("/auth/type").is_empty() {
                    "oauth".into()
                } else {
                    text("/auth/type")
                },
                permission_mode: if text("/runtime/permission_mode").is_empty() {
                    "trusted".into()
                } else {
                    text("/runtime/permission_mode")
                },
                core_command,
                core_version: "0.5.0".into(),
                tunnel_name: String::new(),
                credentials_file: String::new(),
                token_configured: !s.cloudflare_token.is_empty(),
            });
            config.secrets.insert(id, s);
        }
        // Keep both originals and immutable backups, then atomically commit the new format.
        let backup = self.home.join("profiles.v1.backup.json");
        if !backup.exists() {
            private_write(&backup, &bytes)?;
        }
        if old_secrets.exists() {
            let backup = self.home.join("secrets.v1.backup.json");
            if !backup.exists() {
                private_write(&backup, &fs::read(old_secrets)?)?;
            }
        }
        self.save(&config)?;
        Ok((config, Some("Existing workspaces were migrated. Original configuration and private backups are preserved. Old running processes are not adopted or terminated; stop them in the previous app before starting here.".into())))
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn last_good_backup_can_be_restored_without_overwriting_the_damaged_bytes() {
        let home = tempfile::tempdir().unwrap();
        let storage = Storage::open(home.path().to_owned()).unwrap();
        let first = Config::default();
        storage.save(&first).unwrap();
        let mut second = first.clone();
        second.settings.language = "zh".into();
        storage.save(&second).unwrap();
        assert!(
            storage.restore_backup().is_err(),
            "cannot replace a valid config"
        );
        let main = home.path().join(CONFIG_FILE);
        std::fs::write(&main, "{damaged").unwrap();
        assert!(storage.save(&second).is_err());
        assert!(storage.load().is_err());
        assert!(storage.has_recoverable_backup());
        assert_eq!(storage.backup_preview().unwrap().1, 0);
        storage.restore_backup().unwrap();
        assert_eq!(
            storage.load().unwrap().0.settings.language,
            second.settings.language
        );
        assert!(std::fs::read_dir(home.path())
            .unwrap()
            .flatten()
            .filter(|v| v
                .file_name()
                .to_string_lossy()
                .starts_with("desktop-v2.invalid-"))
            .any(|v| std::fs::read(v.path()).unwrap() == b"{damaged"));
    }

    #[test]
    fn does_not_offer_recovery_for_healthy_or_other_schema_configs() {
        let home = tempfile::tempdir().unwrap();
        let storage = Storage::open(home.path().to_owned()).unwrap();
        storage.save(&Config::default()).unwrap();
        assert!(!storage.has_recoverable_backup());
        let main = home.path().join(CONFIG_FILE);
        std::fs::write(&main, br#"{"schemaVersion":99,"workspaces":[]}"#).unwrap();
        assert!(!storage.has_recoverable_backup());
        assert!(storage.restore_backup().is_err());
        assert!(std::fs::read_to_string(&main).unwrap().contains("99"));
    }

    #[test]
    fn cannot_restore_invalid_backup_over_invalid_main() {
        let home = tempfile::tempdir().unwrap();
        let storage = Storage::open(home.path().to_owned()).unwrap();
        let main = home.path().join(CONFIG_FILE);
        std::fs::write(&main, b"bad main").unwrap();
        std::fs::write(home.path().join(CONFIG_BACKUP), b"bad backup").unwrap();
        assert!(!storage.has_recoverable_backup());
        assert!(storage.restore_backup().is_err());
        assert_eq!(std::fs::read(&main).unwrap(), b"bad main");
    }

    #[test]
    fn migrates_named_legacy_origin_with_a_trailing_slash() {
        let home = tempfile::tempdir().unwrap();
        let data = serde_json::json!({"profiles": [{
            "id": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "tunnel": {"type": "cloudflare", "cloudflare_mode": "named", "public_url": "https://mcp.example.com/"}
        }]});
        private_json(&home.path().join("profiles.json"), &data).unwrap();
        let storage = Storage::open(home.path().to_owned()).unwrap();
        assert_eq!(
            storage.load().unwrap().0.workspaces[0].public_url,
            "https://mcp.example.com"
        );
    }
    #[test]
    fn preserves_legacy_windows_paths_and_quoted_spaces() {
        assert_eq!(
            parse_legacy_command(
                r#"C:\Tools\coding-tools-mcp.exe --argument "two words""#,
                true
            )
            .unwrap(),
            vec![r"C:\Tools\coding-tools-mcp.exe", "--argument", "two words"]
        );
        assert_eq!(
            parse_legacy_command(r#""C:\Program Files\core.exe""#, true).unwrap(),
            vec![r"C:\Program Files\core.exe"]
        );
        assert!(parse_legacy_command("\"unterminated", true).is_err());
    }
    #[test]
    fn rejects_path_traversal_and_duplicate_managers() {
        let dir = tempfile::tempdir().unwrap();
        let s = Storage::open(dir.path().join("home")).unwrap();
        assert!(s.state_dir("../secret").is_err());
        assert!(Storage::open(s.home.clone()).is_err());
    }
    #[test]
    fn migrates_secrets_without_mutating_originals() {
        let d = tempfile::tempdir().unwrap();
        let id = "1234567890abcdef1234567890abcdef";
        let p = serde_json::json!({"profiles":[{"id":id,"name":"Example","path":"/tmp","auth":{"type":"bearer"},"runtime":{"local_port":4321},"tunnel":{"type":"cloudflare","cloudflare_mode":"named","public_url":"https://mcp.example.com"}}]});
        private_json(&d.path().join("profiles.json"), &p).unwrap();
        private_json(
            &d.path().join("secrets.json"),
            &serde_json::json!({id:{"bearer_token":"secret","cloudflare_token":"tunnel-secret"}}),
        )
        .unwrap();
        let s = Storage::open(d.path().to_path_buf()).unwrap();
        let (c, n) = s.load().unwrap();
        assert!(n.is_some());
        assert_eq!(c.secrets[id].bearer_token, "secret");
        assert_eq!(c.workspaces[0].access, "named");
        assert_eq!(
            fs::read(d.path().join("profiles.json")).unwrap(),
            fs::read(d.path().join("profiles.v1.backup.json")).unwrap()
        );
        assert!(s.load().unwrap().1.is_none());
    }
}
