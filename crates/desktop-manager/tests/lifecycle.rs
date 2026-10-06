use desktop_manager::{core, model::*, Manager};
use serde_json::json;
use std::{net::TcpListener, sync::Arc, time::Duration};
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
fn test_port() -> u16 {
    // Keep fixture listeners out of the OS outbound ephemeral range. Otherwise
    // readiness HTTP requests can allocate a just-released candidate as their
    // source port before its server starts, leaving a TIME_WAIT collision.
    static NEXT: std::sync::atomic::AtomicU16 = std::sync::atomic::AtomicU16::new(20000);
    loop {
        let port = NEXT.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        if TcpListener::bind(("127.0.0.1", port)).is_ok() {
            return port;
        }
    }
}
fn workspace(path: &std::path::Path) -> Workspace {
    serde_json::from_value(json!({"id":"","name":"Sample project","path":path,"port":test_port(),"access":"local","auth":"noauth","permissionMode":"safe","coreCommand":fixture()})).unwrap()
}
fn manager() -> (tempfile::TempDir, Arc<Manager>) {
    let dir = tempfile::tempdir().unwrap();
    let m = Manager::open(dir.path().join("home")).unwrap();
    (dir, m)
}
#[test]
fn lifecycle_two_workspaces_and_configuration_lock() {
    let (d, m) = manager();
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
    let (d, m) = manager();
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
    let (d, m) = manager();
    let w = m.save_workspace(workspace(d.path()), None).unwrap();
    let s = m.start(&w.id).unwrap();
    let mut sys = sysinfo::System::new_all();
    sys.refresh_all();
    sys.process(sysinfo::Pid::from_u32(s.pid.unwrap()))
        .unwrap()
        .kill();
    std::thread::sleep(Duration::from_millis(100));
    m.refresh();
    assert_eq!(m.snapshot().statuses[0].state, "error");
    assert_eq!(m.start(&w.id).unwrap().state, "running");
    m.stop_all().unwrap();
}
#[test]
fn remote_requires_authentication_and_safe_url() {
    let (d, m) = manager();
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
    let (d, m) = manager();
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
    let (d, m) = manager();
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
    let (d, m) = manager();
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
    let (d, m) = manager();
    std::fs::write(d.path().join("hello.txt"), "desktop acceptance\n").unwrap();
    let mut w = workspace(d.path());
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
            .any(|d| d.name == "Tool activity" && d.level == "warning"));
    }
    m.stop_all().unwrap();
    assert!(TcpListener::bind(("127.0.0.1", w.port)).is_ok());
}
