use desktop_manager::{core, model::*, Manager};
use serde_json::json;
use std::{
    net::TcpListener,
    sync::{Arc, Mutex, MutexGuard},
    time::Duration,
};

fn lifecycle_fixture_lock() -> MutexGuard<'static, ()> {
    // These process-launch fixtures share OS descriptor/port state. Keep
    // independent test cases from probing ports while another case forks;
    // dedicated concurrency tests and the two-workspace case remain intact.
    static LOCK: Mutex<()> = Mutex::new(());
    LOCK.lock().unwrap_or_else(|error| error.into_inner())
}
fn python() -> String {
    std::env::var("PYTHON")
        .unwrap_or_else(|_| if cfg!(windows) { "python" } else { "python3" }.into())
}
fn fixture() -> Vec<String> {
    vec![
        python(),
        format!("{}/tests/fixtures/fake_core.py", env!("CARGO_MANIFEST_DIR")),
    ]
}

#[cfg(unix)]
fn unused_port(port: u16) -> std::io::Result<()> {
    use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};

    // TcpListener enables SO_REUSEADDR on Unix, so its successful bind can
    // select a port with connections left by an earlier test invocation.
    // Probe without reuse: fixture allocation should skip all such TCP state.
    #[cfg(target_os = "linux")]
    let kind = libc::SOCK_STREAM | libc::SOCK_CLOEXEC;
    #[cfg(not(target_os = "linux"))]
    let kind = libc::SOCK_STREAM;
    let fd = unsafe { libc::socket(libc::AF_INET, kind, 0) };
    if fd < 0 {
        return Err(std::io::Error::last_os_error());
    }
    let socket = unsafe { OwnedFd::from_raw_fd(fd) };
    if unsafe { libc::fcntl(socket.as_raw_fd(), libc::F_SETFD, libc::FD_CLOEXEC) } == -1 {
        return Err(std::io::Error::last_os_error());
    }
    let mut address: libc::sockaddr_in = unsafe { std::mem::zeroed() };
    address.sin_family = libc::AF_INET as libc::sa_family_t;
    address.sin_port = port.to_be();
    address.sin_addr.s_addr = u32::from_ne_bytes([127, 0, 0, 1]);
    #[cfg(target_os = "macos")]
    {
        address.sin_len = std::mem::size_of_val(&address) as u8;
    }
    let result = unsafe {
        libc::bind(
            socket.as_raw_fd(),
            (&address as *const libc::sockaddr_in).cast(),
            std::mem::size_of_val(&address) as libc::socklen_t,
        )
    };
    if result == -1 {
        return Err(std::io::Error::last_os_error());
    }
    Ok(())
}

#[cfg(not(unix))]
fn unused_port(port: u16) -> std::io::Result<()> {
    TcpListener::bind(("127.0.0.1", port)).map(|_| ())
}

fn test_port() -> u16 {
    // Keep fixture listeners out of the OS outbound ephemeral range. Otherwise
    // readiness HTTP requests can allocate a just-released candidate as their
    // source port before its server starts, leaving a TIME_WAIT collision.
    // Independent/repeated invocations must not all probe the same first ports
    // while the previous invocation's sockets are still settling. Each run
    // starts elsewhere, and its monotonic index never repeats a candidate.
    const PORT_COUNT: u16 = 4000;
    static OFFSET: std::sync::OnceLock<u16> = std::sync::OnceLock::new();
    static NEXT: std::sync::atomic::AtomicU16 = std::sync::atomic::AtomicU16::new(0);
    let offset =
        *OFFSET.get_or_init(|| (uuid::Uuid::new_v4().as_u128() % PORT_COUNT as u128) as u16);
    for _ in 0..PORT_COUNT {
        let index = NEXT.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        assert!(
            index < PORT_COUNT,
            "Lifecycle fixture port range is exhausted"
        );
        let port = 20000 + (offset + index) % PORT_COUNT;
        match unused_port(port) {
            Ok(()) => return port,
            Err(error) if error.kind() == std::io::ErrorKind::AddrInUse => continue,
            Err(error) => panic!("Could not probe lifecycle fixture port {port}: {error}"),
        }
    }
    panic!("No unused lifecycle fixture port is available");
}

#[cfg(unix)]
#[test]
fn fixture_port_probe_rejects_prior_tcp_state() {
    use std::io::Read;
    use std::net::{Shutdown, TcpStream};

    let _test_guard = lifecycle_fixture_lock();
    // This in-process fixture keeps its listener bound while obtaining the
    // port, so it does not itself introduce the bind/drop allocation window.
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let mut client = TcpStream::connect(("127.0.0.1", port)).unwrap();
    let (mut server, _) = listener.accept().unwrap();
    drop(listener);
    client
        .set_read_timeout(Some(Duration::from_secs(2)))
        .unwrap();
    server
        .set_read_timeout(Some(Duration::from_secs(2)))
        .unwrap();

    // Make the server the active closer, putting its local port in TIME_WAIT.
    server.shutdown(Shutdown::Write).unwrap();
    let mut byte = [0u8; 1];
    assert_eq!(client.read(&mut byte).unwrap(), 0);
    client.shutdown(Shutdown::Write).unwrap();
    assert_eq!(server.read(&mut byte).unwrap(), 0);
    drop(client);
    drop(server);

    assert_eq!(
        unused_port(port).unwrap_err().kind(),
        std::io::ErrorKind::AddrInUse
    );
}
fn workspace(path: &std::path::Path) -> Workspace {
    serde_json::from_value(json!({"id":"","name":"Sample project","path":path,"port":test_port(),"access":"local","auth":"noauth","permissionMode":"safe","coreCommand":fixture()})).unwrap()
}
fn manager() -> (MutexGuard<'static, ()>, tempfile::TempDir, Arc<Manager>) {
    let guard = lifecycle_fixture_lock();
    let dir = tempfile::tempdir().unwrap();
    #[cfg(unix)]
    let m = Manager::open_supervised(
        dir.path().join("home"),
        std::env::var_os("DESKTOP_SUPERVISOR_BIN")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| {
                std::path::PathBuf::from(env!("CARGO_BIN_EXE_desktop-process-supervisor"))
            }),
    )
    .unwrap();
    #[cfg(not(unix))]
    let m = Manager::open(dir.path().join("home")).unwrap();
    (guard, dir, m)
}
#[test]
fn lifecycle_two_workspaces_and_configuration_lock() {
    let (_test_guard, d, m) = manager();
    let w = m.save_workspace(workspace(d.path()), None).unwrap();
    let mut second = workspace(d.path());
    second.name = "Second".into();
    let w2 = m.save_workspace(second, None).unwrap();
    assert_ne!(w.port, w2.port);
    let s = m.start(&w.id).unwrap();
    assert_eq!(s.local_state, "ready");
    assert_eq!(m.start(&w.id).unwrap().pid, s.pid);
    assert!(m.save_workspace(w.clone(), None).is_err());
    assert!(m.delete_workspace(&w.id).is_err());
    let s2 = m.start(&w2.id).unwrap();
    assert_ne!(s.pid, s2.pid);
    assert_eq!(m.stop(&w.id).unwrap().state, "stopped");
    assert_eq!(m.snapshot().statuses[1].state, "running");
    assert_eq!(m.restart(&w2.id).unwrap().state, "running");
    m.stop_all().unwrap();
    assert!(TcpListener::bind(("127.0.0.1", w.port)).is_ok());
}
#[test]
fn occupied_port_never_kills_unrelated_listener() {
    let (_test_guard, d, m) = manager();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let mut w = workspace(d.path());
    w.port = listener.local_addr().unwrap().port();
    let w = m.save_workspace(w, None).unwrap();
    assert!(m
        .start(&w.id)
        .unwrap_err()
        .to_string()
        .contains("Port is already in use"));
    assert!(listener.local_addr().is_ok());
    assert_eq!(m.snapshot().statuses[0].state, "error");
}
#[test]
fn crash_is_reported_and_can_restart() {
    let (_test_guard, d, m) = manager();
    let w = m.save_workspace(workspace(d.path()), None).unwrap();
    let s = m.start(&w.id).unwrap();
    let mut sys = sysinfo::System::new_all();
    sys.refresh_all();
    let pid = sysinfo::Pid::from_u32(s.pid.unwrap());
    let process = sys.process(pid).unwrap();
    let birth = process.start_time();
    assert!(process.kill(), "Fixture crash signal was not accepted");
    let deadline = std::time::Instant::now() + Duration::from_secs(10);
    let mut exited;
    let mut status;
    loop {
        sys.refresh_processes(sysinfo::ProcessesToUpdate::Some(&[pid]), true);
        exited = !sys.process(pid).is_some_and(|process| {
            process.start_time() == birth && process.status() != sysinfo::ProcessStatus::Zombie
        });
        // refresh intentionally skips a busy lifecycle lock. Wait for both
        // real process exit and the resulting manager state, rather than
        // assuming a single observation 100ms after kill must see the crash.
        m.refresh();
        status = m.snapshot().statuses.remove(0);
        if (exited && status.state == "error" && !status.cleanup_pending)
            || std::time::Instant::now() >= deadline
        {
            break;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    assert!(
        exited,
        "Fixture process did not exit after its crash signal"
    );
    assert_eq!(
        status.state, "error",
        "Manager never observed the fixture crash"
    );
    assert!(!status.cleanup_pending, "Crash cleanup did not finish");
    assert_eq!(m.start(&w.id).unwrap().state, "running");
    m.stop_all().unwrap();
}
#[test]
fn remote_requires_authentication_and_safe_url() {
    let (_test_guard, d, m) = manager();
    let mut w = workspace(d.path());
    w.access = "quick".into();
    assert!(m.save_workspace(w.clone(), None).is_err());
    w.auth = "oauth".into();
    assert!(m.save_workspace(w.clone(), None).is_err());
    w.access = "named".into();
    w.public_url = "https://user:password@example.com".into();
    assert!(m.save_workspace(w, None).is_err());
}
#[test]
fn tunnel_failure_does_not_stop_local_core() {
    if core::find_program("cloudflared").is_some() {
        return;
    }
    let (_test_guard, d, m) = manager();
    let mut w = workspace(d.path());
    w.access = "quick".into();
    w.auth = "bearer".into();
    let w = m.save_workspace(w, None).unwrap();
    let s = m.start(&w.id).unwrap();
    assert_eq!(s.state, "running");
    assert_eq!(s.local_state, "ready");
    assert_eq!(s.public_state, "error");
    assert!(m.connection_config(&w.id, true).is_err());
    assert!(m
        .connection_config(&w.id, false)
        .unwrap()
        .contains("Bearer"));
    m.stop_all().unwrap();
}
#[test]
fn oauth_requires_client_authorization_but_has_verified_core() {
    let (_test_guard, d, m) = manager();
    let mut w = workspace(d.path());
    w.auth = "oauth".into();
    let w = m.save_workspace(w, None).unwrap();
    let s = m.start(&w.id).unwrap();
    assert!(s.local_message.contains("OAuth authorization"));
    assert!(
        m.auth_details(&w.id).unwrap()["oauthPassword"]
            .as_str()
            .unwrap()
            .len()
            > 32
    );
    m.stop_all().unwrap();
}
#[test]
fn diagnostics_do_not_export_paths_credentials_or_urls() {
    let (_test_guard, d, m) = manager();
    let w = m
        .save_workspace(
            workspace(d.path()),
            Some(Secrets {
                bearer_token: "private-secret-value".into(),
                ..Default::default()
            }),
        )
        .unwrap();
    m.start(&w.id).unwrap();
    let report = m.export_diagnostics(&w.id).unwrap();
    assert!(!report.contains("private-secret-value"));
    assert!(!report.contains(&w.path));
    assert!(!report.contains("127.0.0.1"));
    m.stop_all().unwrap();
}

// Run explicitly against an installed, unmodified official core, never import its internals.
#[test]
#[ignore = "Set DESKTOP_CORE_COMMAND_JSON to the official external core command"]
fn official_core_mcp_acceptance() {
    let command: Vec<String> = serde_json::from_str(
        &std::env::var("DESKTOP_CORE_COMMAND_JSON").expect("set DESKTOP_CORE_COMMAND_JSON"),
    )
    .unwrap();
    let (_test_guard, d, m) = manager();
    let project = d.path().join("项目 空间 (MCP)");
    std::fs::create_dir(&project).unwrap();
    std::fs::write(project.join("hello.txt"), "desktop acceptance\n").unwrap();
    let mut w = workspace(&project);
    w.core_command = command;
    let w = m.save_workspace(w, None).unwrap();
    let status = m.start(&w.id).unwrap();
    assert_eq!(status.local_state, "ready");
    let c = core::client().unwrap();
    let endpoint = format!("http://127.0.0.1:{}/mcp", w.port);
    let rpc = |id: u32, method: &str, params: serde_json::Value| -> serde_json::Value {
        let response = c
            .post(&endpoint)
            .header("Accept", "application/json, text/event-stream")
            .header("MCP-Protocol-Version", "2025-11-25")
            .json(&json!({"jsonrpc":"2.0","id":id,"method":method,"params":params}))
            .send()
            .unwrap();
        let status = response.status();
        let text = response.text().unwrap();
        assert!(status.is_success(), "{method}: {status}: {text}");
        serde_json::from_str(&text).unwrap()
    };
    let init = rpc(
        1,
        "initialize",
        json!({"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"desktop-acceptance","version":"1"}}),
    );
    assert_eq!(init["result"]["serverInfo"]["name"], "coding-tools-mcp");
    let list = rpc(2, "tools/list", json!({}));
    assert!(list["result"]["tools"]
        .as_array()
        .unwrap()
        .iter()
        .any(|t| t["name"] == "read_file"));
    let ok = rpc(
        3,
        "tools/call",
        json!({"name":"read_file","arguments":{"path":"hello.txt"}}),
    );
    assert_ne!(ok["result"]["isError"], true);
    assert!(ok.to_string().contains("desktop acceptance"));
    let fail = rpc(
        4,
        "tools/call",
        json!({"name":"read_file","arguments":{"path":"missing-file.txt"}}),
    );
    assert_eq!(fail["result"]["isError"], true);
    let expect_activity = std::env::var("DESKTOP_EXPECT_ACTIVITY").as_deref() != Ok("false");
    let activity = m.activity(&w.id).unwrap();
    if expect_activity {
        assert_eq!(m.snapshot().statuses[0].activity_state, "available");
        assert_eq!(activity.len(), 2);
        assert!(activity
            .iter()
            .any(|a| a.outcome == "success" && a.duration_ms.is_some()));
        assert!(activity.iter().any(|a| a.outcome == "tool_error"));
        assert!(m
            .diagnose(&w.id)
            .unwrap()
            .iter()
            .any(|d| d.name == "Tool activity" && d.level == "ok"));
    } else {
        assert_eq!(m.snapshot().statuses[0].activity_state, "unavailable");
        assert!(activity.is_empty());
        assert!(m
            .diagnose(&w.id)
            .unwrap()
            .iter()
            .any(|d| d.name == "Tool activity"
                && d.level == "warning"
                && d.message
                    .contains("d7c2dda48bcedbd066c7dbc24a1b63205384d269")));
    }
    // A real restart must release the prior journal/process, preserve history,
    // and expose only the capabilities of the newly launched core.
    let restarted = m.restart(&w.id).unwrap();
    assert_eq!(restarted.local_state, "ready");
    assert_eq!(
        restarted.activity_state,
        if expect_activity {
            "available"
        } else {
            "unavailable"
        }
    );
    let restored = m.activity(&w.id).unwrap();
    assert_eq!(restored.len(), activity.len());
    let init = rpc(
        5,
        "initialize",
        json!({"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"desktop-restart-acceptance","version":"1"}}),
    );
    assert_eq!(init["result"]["serverInfo"]["name"], "coding-tools-mcp");
    let after_restart = rpc(
        6,
        "tools/call",
        json!({"name":"read_file","arguments":{"path":"hello.txt"}}),
    );
    assert_ne!(after_restart["result"]["isError"], true);
    assert!(after_restart.to_string().contains("desktop acceptance"));
    let combined = m.activity(&w.id).unwrap();
    if expect_activity {
        assert_eq!(combined.len(), 3);
        assert_eq!(
            combined
                .iter()
                .map(|row| &row.runtime_id)
                .collect::<std::collections::HashSet<_>>()
                .len(),
            2
        );
    } else {
        assert!(combined.is_empty());
    }
    m.stop_all().unwrap();
    assert!(TcpListener::bind(("127.0.0.1", w.port)).is_ok());
}

#[test]
fn deleted_workspace_cannot_be_resurrected_by_a_stale_save() {
    let (_test_guard, dir, manager) = manager();
    let workspace = manager.save_workspace(workspace(dir.path()), None).unwrap();
    manager.delete_workspace(&workspace.id).unwrap();
    let backup = std::fs::read(manager.storage.home.join("desktop-before-delete.json")).unwrap();
    assert!(manager
        .save_workspace(workspace.clone(), None)
        .unwrap_err()
        .to_string()
        .contains("removed"));
    assert!(manager.start(&workspace.id).is_err());
    assert!(manager.delete_workspace(&workspace.id).is_err());
    assert!(manager.snapshot().workspaces.is_empty());
    assert_eq!(
        backup,
        std::fs::read(manager.storage.home.join("desktop-before-delete.json")).unwrap()
    );
}

#[test]
fn successful_shutdown_closes_admission_but_stop_all_does_not() {
    let (_test_guard, dir, manager) = manager();
    let workspace = manager.save_workspace(workspace(dir.path()), None).unwrap();
    manager.start(&workspace.id).unwrap();
    manager.stop_all().unwrap();
    manager.start(&workspace.id).unwrap();
    manager.shutdown().unwrap();
    assert!(manager
        .start(&workspace.id)
        .unwrap_err()
        .to_string()
        .contains("shutting down"));
    assert!(manager.save_workspace(workspace.clone(), None).is_err());
    assert!(manager.delete_workspace(&workspace.id).is_err());
    assert!(manager
        .install_core("0.5.0")
        .unwrap_err()
        .to_string()
        .contains("shutting down"));
    assert!(manager
        .cloudflare_login()
        .unwrap_err()
        .to_string()
        .contains("shutting down"));
    assert_eq!(manager.snapshot().statuses[0].state, "stopped");
    assert!(TcpListener::bind(("127.0.0.1", workspace.port)).is_ok());
}

#[test]
fn workspace_name_limit_counts_unicode_characters_not_utf8_bytes() {
    let (_test_guard, dir, manager) = manager();
    let mut value = workspace(dir.path());
    value.name = "项目".repeat(40);
    let saved = manager.save_workspace(value, None).unwrap();
    assert_eq!(saved.name.chars().count(), 80);
    let mut too_long = saved.clone();
    too_long.name = "项".repeat(121);
    assert!(manager.save_workspace(too_long, None).is_err());
    assert_eq!(manager.snapshot().workspaces[0].name, saved.name);
}
