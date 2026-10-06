#[cfg(unix)]
use desktop_manager::process::ManagedProcess;
use desktop_manager::{model::*, storage::private_json, Manager};
use serde_json::json;
use std::net::TcpListener;
#[cfg(unix)]
use std::{
    process::Command,
    thread,
    time::{Duration, Instant},
};

#[cfg(unix)]
static MOCK_PATH_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[test]
fn authorization_header_redacts_scheme_and_credential() {
    let redacted = desktop_manager::events::redact(
        "Authorization: Bearer upstream-token-not-in-workspace-secrets\n",
        &Secrets::default(),
    );
    assert!(
        !redacted.contains("upstream-token-not-in-workspace-secrets"),
        "generic Authorization redaction retained its credential: {redacted}"
    );
}

#[cfg(unix)]
#[test]
fn rollback_probe_does_not_block_status_reads() {
    use std::os::unix::fs::PermissionsExt;
    let d = tempfile::tempdir().unwrap();
    let marker = d.path().join("probing");
    let gate = d.path().join("finish-probe");
    let previous = d.path().join("previous-core");
    std::fs::write(&previous, format!("#!/bin/sh\ntouch {}\nwhile [ ! -f {} ]; do sleep 0.05; done\necho 'coding-tools-mcp 0.5.0'\n", shell_words::quote(&marker.to_string_lossy()), shell_words::quote(&gate.to_string_lossy()))).unwrap();
    std::fs::set_permissions(&previous, std::fs::Permissions::from_mode(0o700)).unwrap();
    let home = d.path().join("home");
    let config = Config {
        previous_core: Some(previous.to_string_lossy().into_owned()),
        ..Config::default()
    };
    private_json(&home.join("desktop-v2.json"), &config).unwrap();
    let manager = Manager::open(home).unwrap();
    let rolling = manager.clone();
    let rollback = thread::spawn(move || rolling.rollback_core());
    let until = Instant::now() + Duration::from_secs(3);
    while !marker.exists() && Instant::now() < until {
        thread::sleep(Duration::from_millis(10));
    }
    let snapshot_manager = manager.clone();
    let (sender, receiver) = std::sync::mpsc::channel();
    let reader = thread::spawn(move || {
        let _ = sender.send(snapshot_manager.snapshot());
    });
    let snapshot_was_responsive = receiver.recv_timeout(Duration::from_millis(250)).is_ok();
    std::fs::write(&gate, b"finish").unwrap();
    let restored = rollback.join().unwrap();
    reader.join().unwrap();
    assert!(restored.is_ok(), "fixture rollback failed");
    assert!(
        snapshot_was_responsive,
        "slow rollback held the global configuration lock and blocked all status reads"
    );
}

#[cfg(unix)]
#[test]
fn stopped_exited_root_also_stops_previously_observed_descendant() {
    assert_exited_root_stops_descendant(true);
}

#[cfg(unix)]
#[test]
fn exited_root_reserves_process_group_for_unobserved_descendant_cleanup() {
    assert_exited_root_stops_descendant(false);
}

#[cfg(unix)]
fn assert_exited_root_stops_descendant(observe: bool) {
    let d = tempfile::tempdir().unwrap();
    let child_pid_file = d.path().join("child.pid");
    let exit_gate = d.path().join("exit");
    let mut cmd = Command::new("/bin/sh");
    cmd.args([
        "-c",
        "sleep 60 & echo $! > \"$PID_FILE\"; while [ ! -f \"$EXIT_GATE\" ]; do sleep 0.05; done",
    ])
    .env("PID_FILE", &child_pid_file)
    .env("EXIT_GATE", &exit_gate);
    let mut process =
        ManagedProcess::spawn(&mut cmd, d.path().join("log"), Secrets::default()).unwrap();
    let until = Instant::now() + Duration::from_secs(3);
    while !child_pid_file.exists() && Instant::now() < until {
        thread::sleep(Duration::from_millis(10));
    }
    let child_pid: u32 = std::fs::read_to_string(&child_pid_file)
        .unwrap()
        .trim()
        .parse()
        .unwrap();
    struct Cleanup(u32);
    impl Drop for Cleanup {
        fn drop(&mut self) {
            unsafe {
                libc::kill(self.0 as i32, libc::SIGKILL);
            }
        }
    }
    let _cleanup = Cleanup(child_pid);
    if observe {
        process.metrics();
    }
    std::fs::write(&exit_gate, b"exit").unwrap();
    while process.alive() && Instant::now() < until {
        thread::sleep(Duration::from_millis(10));
    }
    assert!(!process.alive(), "fixture root did not exit");
    assert!(
        process.succeeded(),
        "fixture root did not exit successfully"
    );
    process.stop().unwrap();
    thread::sleep(Duration::from_millis(50));
    let system = sysinfo::System::new_all();
    let child_still_running = system
        .process(sysinfo::Pid::from_u32(child_pid))
        .is_some_and(|p| p.status() != sysinfo::ProcessStatus::Zombie);
    assert!(
        !child_still_running,
        "owned descendant survived root exit and managed stop"
    );
}

#[test]
fn migrated_public_noauth_workspace_is_rejected_before_launch() {
    let d = tempfile::tempdir().unwrap();
    let home = d.path().join("home");
    let id = "1234567890abcdef1234567890abcdef";
    let python = std::env::var("PYTHON")
        .unwrap_or_else(|_| if cfg!(windows) { "python" } else { "python3" }.into());
    let fixture = format!("{}/tests/fixtures/fake_core.py", env!("CARGO_MANIFEST_DIR"));
    let port = TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port();
    private_json(&home.join("profiles.json"), &json!({"profiles":[{"id":id,"name":"Legacy public noauth","path":d.path(),"auth":{"type":"noauth"},"runtime":{"local_port":port,"runtime_command":format!("{} {}", shell_words::quote(&python), shell_words::quote(&fixture))},"tunnel":{"type":"frp","public_url":"https://mcp.example.invalid"}}]})).unwrap();
    let manager = Manager::open(home).unwrap();
    let started = manager.start(id);
    let _ = manager.stop_all();
    assert!(started.is_err(), "migration bypassed the public-authentication validation and launched an unauthenticated core");
}

#[cfg(unix)]
#[test]
fn deleting_crashed_workspace_cannot_leave_its_tunnel_running() {
    let _path_lock = MOCK_PATH_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    use std::os::unix::fs::PermissionsExt;
    let d = tempfile::tempdir().unwrap();
    let executable = d.path().join("cloudflared");
    let tunnel_pid_file = d.path().join("tunnel.pid");
    std::fs::write(&executable, format!("#!/bin/sh\necho $$ > {}\necho 'Registered tunnel connection'\nwhile :; do sleep 1; done\n", shell_words::quote(&tunnel_pid_file.to_string_lossy()))).unwrap();
    std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o700)).unwrap();
    struct RestorePath(Option<std::ffi::OsString>);
    impl Drop for RestorePath {
        fn drop(&mut self) {
            match self.0.take() {
                Some(path) => std::env::set_var("PATH", path),
                None => std::env::remove_var("PATH"),
            }
        }
    }
    let restore = RestorePath(std::env::var_os("PATH"));
    let mut paths = vec![d.path().to_path_buf()];
    if let Some(path) = &restore.0 {
        paths.extend(std::env::split_paths(path));
    }
    std::env::set_var("PATH", std::env::join_paths(paths).unwrap());
    let manager = Manager::open(d.path().join("home")).unwrap();
    let python = std::env::var("PYTHON").unwrap_or_else(|_| "python3".into());
    let fixture = format!("{}/tests/fixtures/fake_core.py", env!("CARGO_MANIFEST_DIR"));
    let port = TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port();
    let w: Workspace = serde_json::from_value(json!({"id":"","name":"Mocked named tunnel","path":d.path(),"port":port,"access":"named","publicUrl":"https://mcp.example.invalid","auth":"bearer","permissionMode":"safe","coreCommand":[python,fixture]})).unwrap();
    let w = manager
        .save_workspace(
            w,
            Some(Secrets {
                cloudflare_token: "fake-local-test-token".into(),
                ..Default::default()
            }),
        )
        .unwrap();
    let status = manager.start(&w.id).unwrap();
    assert_eq!(status.public_state, "connected");
    let tunnel_pid: u32 = std::fs::read_to_string(&tunnel_pid_file)
        .unwrap()
        .trim()
        .parse()
        .unwrap();
    unsafe {
        libc::kill(status.pid.unwrap() as i32, libc::SIGKILL);
    }
    thread::sleep(Duration::from_millis(50));
    let deleted = manager.delete_workspace(&w.id);
    manager.stop_all().unwrap();
    let system = sysinfo::System::new_all();
    let tunnel_alive = system
        .process(sysinfo::Pid::from_u32(tunnel_pid))
        .is_some_and(|p| p.status() != sysinfo::ProcessStatus::Zombie);
    drop(manager);
    assert!(
        !(deleted.is_ok() && tunnel_alive),
        "deletion forgot a live tunnel, and stop_all did not visit it"
    );
}

#[cfg(unix)]
#[test]
fn activity_during_tunnel_startup_does_not_mark_calls_interrupted() {
    use std::os::unix::fs::PermissionsExt;
    let _path_lock = MOCK_PATH_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let d = tempfile::tempdir().unwrap();
    let executable = d.path().join("cloudflared");
    let marker = d.path().join("tunnel-started");
    let gate = d.path().join("connect");
    std::fs::write(&executable, format!("#!/bin/sh\ntouch {}\nwhile [ ! -f {} ]; do sleep 0.05; done\necho 'Registered tunnel connection'\nwhile :; do sleep 1; done\n", shell_words::quote(&marker.to_string_lossy()), shell_words::quote(&gate.to_string_lossy()))).unwrap();
    std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o700)).unwrap();
    struct RestorePath(Option<std::ffi::OsString>);
    impl Drop for RestorePath {
        fn drop(&mut self) {
            match self.0.take() {
                Some(path) => std::env::set_var("PATH", path),
                None => std::env::remove_var("PATH"),
            }
        }
    }
    let restore = RestorePath(std::env::var_os("PATH"));
    let mut paths = vec![d.path().to_path_buf()];
    if let Some(path) = &restore.0 {
        paths.extend(std::env::split_paths(path));
    }
    std::env::set_var("PATH", std::env::join_paths(paths).unwrap());
    let manager = Manager::open(d.path().join("home")).unwrap();
    let python = std::env::var("PYTHON").unwrap_or_else(|_| "python3".into());
    let fixture = format!("{}/tests/fixtures/fake_core.py", env!("CARGO_MANIFEST_DIR"));
    let port = TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port();
    let w: Workspace = serde_json::from_value(json!({"id":"","name":"Mocked delayed tunnel","path":d.path(),"port":port,"access":"named","publicUrl":"https://mcp.example.invalid","auth":"bearer","permissionMode":"safe","coreCommand":[python,fixture]})).unwrap();
    let w = manager
        .save_workspace(
            w,
            Some(Secrets {
                cloudflare_token: "fake-local-test-token".into(),
                ..Default::default()
            }),
        )
        .unwrap();
    let starting = manager.clone();
    let id = w.id.clone();
    let start = thread::spawn(move || starting.start(&id));
    let until = Instant::now() + Duration::from_secs(3);
    while !marker.exists() && Instant::now() < until {
        thread::sleep(Duration::from_millis(10));
    }
    let journal = manager
        .storage
        .state_dir(&w.id)
        .unwrap()
        .join("events/events.jsonl");
    let record = json!({"schema_version":1,"runtime_id":"fixture-runtime","call_id":"fixture-call","tool":"read_file","timestamp":desktop_manager::model::now(),"event":"tool_call_started"});
    std::fs::write(journal, format!("{record}\n")).unwrap();
    let rows = manager.activity(&w.id);
    std::fs::write(&gate, b"connect").unwrap();
    let launched = start.join().unwrap();
    manager.stop_all().unwrap();
    let after_stop = manager.activity(&w.id).unwrap();
    assert!(launched.is_ok(), "mock tunnel startup failed");
    let rows = rows.unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(
        rows[0].outcome, "running",
        "session lock contention falsely classified a current call as interrupted"
    );
    assert_eq!(
        after_stop[0].outcome, "interrupted",
        "normal stop must clear cached run ownership"
    );
}
