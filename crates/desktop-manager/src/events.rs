use crate::{
    model::{Activity, Logs, Secrets},
    storage::private_write,
};
use anyhow::Result;
use serde_json::Value;
use std::{
    collections::HashMap,
    fs::{self, File},
    io::{Read, Seek, SeekFrom},
    path::Path,
};
pub const LOG_LIMIT: u64 = 1024 * 1024;
const READ_LIMIT: u64 = 64 * 1024;

pub fn redact(text: &str, secrets: &Secrets) -> String {
    use std::sync::LazyLock;
    static AUTH: LazyLock<regex::Regex> = LazyLock::new(|| {
        regex::Regex::new(r#"(?i)(authorization[\"']?\s*[:=]\s*)(?:\"[^\"\r\n]*\"|'[^'\r\n]*'|(?:[a-z]+[ \t]+)?[^\s,;]+)"#).unwrap()
    });
    static FIELDS: LazyLock<regex::Regex> = LazyLock::new(|| {
        regex::Regex::new(r#"(?i)((?:token|password|secret)[\"']?\s*[:=]\s*)(?:\"[^\"\r\n]*\"|'[^'\r\n]*'|[^\s,;]+)"#).unwrap()
    });
    static BEARER: LazyLock<regex::Regex> =
        LazyLock::new(|| regex::Regex::new(r#"(?i)(bearer\s+)[^\s\"',;]+"#).unwrap());
    let mut value = text.to_string();
    let mut known = secrets.values();
    known.sort_by_key(|s| std::cmp::Reverse(s.len()));
    for secret in known {
        value = value.replace(secret, "[REDACTED]");
    }
    value = AUTH.replace_all(&value, "$1[REDACTED]").into_owned();
    value = FIELDS.replace_all(&value, "$1[REDACTED]").into_owned();
    BEARER.replace_all(&value, "$1[REDACTED]").into_owned()
}
pub fn append_log(path: &Path, text: &str) -> Result<()> {
    use std::io::Write;
    if path.exists() && fs::metadata(path)?.len() + text.len() as u64 > LOG_LIMIT {
        let old = path.with_extension("log.1");
        if old.exists() {
            fs::remove_file(&old)?;
        }
        fs::rename(path, old)?;
    }
    if !path.exists() {
        private_write(path, b"")?;
    }
    if path.is_symlink() {
        anyhow::bail!("Log file must not be a symlink");
    }
    let mut f = fs::OpenOptions::new().append(true).open(path)?;
    f.write_all(text.as_bytes())?;
    Ok(())
}
pub fn logs(path: &Path, cursor: u64, secrets: &Secrets) -> Result<Logs> {
    if !path.exists() {
        return Ok(Logs {
            text: String::new(),
            cursor: 0,
            truncated: false,
        });
    }
    let mut file = File::open(path)?;
    let metadata = file.metadata()?;
    let len = metadata.len();
    #[cfg(unix)]
    let generation = {
        use std::os::unix::fs::MetadataExt;
        metadata.ino() & 0xfffff
    };
    #[cfg(windows)]
    let generation = {
        use std::os::windows::fs::MetadataExt;
        metadata.creation_time() & 0xfffff
    };
    #[cfg(not(any(unix, windows)))]
    let generation = 0;
    let prior_generation = cursor >> 32;
    let previous = cursor & 0xffffffff;
    let rotated = cursor != 0 && (prior_generation != generation || previous > len);
    let offset = if cursor == 0 || rotated {
        len.saturating_sub(READ_LIMIT)
    } else {
        previous.max(len.saturating_sub(READ_LIMIT))
    };
    file.seek(SeekFrom::Start(offset))?;
    let mut data = vec![];
    file.take(READ_LIMIT).read_to_end(&mut data)?;
    let text = redact(&String::from_utf8_lossy(&data), secrets);
    Ok(Logs {
        text,
        cursor: (generation << 32) + offset + data.len() as u64,
        truncated: rotated || offset > previous,
    })
}
pub fn activity(directory: &Path, active_since_ms: Option<i64>) -> Result<Vec<Activity>> {
    let mut calls: HashMap<String, Activity> = HashMap::new();
    // Core owns a bounded four-file ring. Read oldest first so finishes update starts.
    for suffix in [".3", ".2", ".1", ""] {
        let path = directory.join(format!("events.jsonl{suffix}"));
        if !path.exists() {
            continue;
        }
        let mut file = File::open(path)?;
        let size = file.metadata()?.len();
        let offset = size.saturating_sub(LOG_LIMIT);
        file.seek(SeekFrom::Start(offset))?;
        let mut bytes = Vec::new();
        file.take(LOG_LIMIT).read_to_end(&mut bytes)?;
        // Only complete newline-terminated records are authoritative. A partial write is retried next poll.
        for line in bytes.split_inclusive(|b| *b == b'\n') {
            if !line.ends_with(b"\n") || line.len() > 4096 {
                continue;
            }
            let Ok(v) = serde_json::from_slice::<Value>(line) else {
                continue;
            };
            if v["schema_version"] != 1 {
                continue;
            }
            let (Some(call), Some(runtime), Some(tool), Some(timestamp), Some(event)) = (
                v["call_id"].as_str(),
                v["runtime_id"].as_str(),
                v["tool"].as_str(),
                v["timestamp"].as_str(),
                v["event"].as_str(),
            ) else {
                continue;
            };
            if !["tool_call_started", "tool_call_finished"].contains(&event) {
                continue;
            }
            let key = format!("{runtime}:{call}");
            let row = calls.entry(key.clone()).or_insert_with(|| Activity {
                id: key,
                tool: tool.chars().take(100).collect(),
                started_at: timestamp.into(),
                finished_at: None,
                outcome: if active_since_ms.is_some_and(|since| {
                    chrono::DateTime::parse_from_rfc3339(timestamp)
                        .map(|t| t.timestamp_millis() >= since)
                        .unwrap_or(false)
                }) {
                    "running"
                } else {
                    "interrupted"
                }
                .into(),
                duration_ms: None,
                error_category: None,
                runtime_id: runtime.into(),
            });
            if event == "tool_call_finished" {
                row.finished_at = Some(timestamp.into());
                row.outcome = v["outcome"].as_str().unwrap_or("unknown").into();
                row.duration_ms = v["duration_ms"].as_u64();
                row.error_category = v["error_category"].as_str().map(String::from);
            }
        }
    }
    let mut result: Vec<_> = calls.into_values().collect();
    result.sort_by(|a, b| {
        b.started_at
            .cmp(&a.started_at)
            .then_with(|| b.id.cmp(&a.id))
    });
    result.truncate(200);
    Ok(result)
}
/// Preserve the last three runs, so an old lock file cannot falsely advertise
/// journal support when the user switches to an older core build.
pub fn begin_run(state: &Path) -> Result<()> {
    use fs2::FileExt;
    let live = state.join("events");
    if live.is_symlink() {
        anyhow::bail!("Event directory must not be a symlink");
    }
    if !live.exists() {
        return Ok(());
    }
    let lock = live.join("journal.lock");
    let guard = if lock.exists() {
        let f = fs::OpenOptions::new().read(true).write(true).open(lock)?;
        f.try_lock_exclusive().map_err(|_|anyhow::anyhow!("A previous core still owns the activity journal. Stop that core before starting another."))?;
        Some(f)
    } else {
        None
    };
    let last = state.join("events.previous.3");
    if last.exists() {
        fs::remove_dir_all(&last)?;
    }
    for i in (1..3).rev() {
        let p = state.join(format!("events.previous.{i}"));
        if p.exists() {
            fs::rename(p, state.join(format!("events.previous.{}", i + 1)))?;
        }
    }
    // Release the old file lock before renaming its directory on Windows.
    drop(guard);
    fs::rename(live, state.join("events.previous.1"))?;
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_real_schema_rotation_and_partial_records() {
        let d = tempfile::tempdir().unwrap();
        fs::write(d.path().join("events.jsonl.1"),"{\"schema_version\":1,\"runtime_id\":\"r\",\"call_id\":\"c\",\"tool\":\"list_dir\",\"timestamp\":\"2026-01-01\",\"event\":\"tool_call_started\"}\n").unwrap();
        fs::write(d.path().join("events.jsonl"),"broken\n{\"schema_version\":1,\"runtime_id\":\"r\",\"call_id\":\"c\",\"tool\":\"list_dir\",\"timestamp\":\"2026-01-02\",\"event\":\"tool_call_finished\",\"outcome\":\"success\",\"duration_ms\":3}\n{\"partial\"").unwrap();
        let a = activity(d.path(), None).unwrap();
        assert_eq!(a.len(), 1);
        assert_eq!(a[0].outcome, "success");
        assert_eq!(a[0].duration_ms, Some(3));
        assert_eq!(a[0].started_at, "2026-01-01");
    }
    #[test]
    fn log_cursor_is_bounded_and_secrets_are_redacted() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("runtime.log");
        let s = Secrets {
            bearer_token: "very-private".into(),
            ..Default::default()
        };
        fs::write(&p, "Bearer very-private\n").unwrap();
        let l = logs(&p, 0, &s).unwrap();
        assert!(!l.text.contains("very-private"));
        assert!(logs(&p, l.cursor, &s).unwrap().text.is_empty());
        fs::write(&p, vec![b'x'; 100000]).unwrap();
        let l = logs(&p, 0, &s).unwrap();
        assert_eq!(l.text.len(), READ_LIMIT as usize);
        assert!(l.truncated);
    }
}
