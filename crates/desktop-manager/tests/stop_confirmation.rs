use desktop_manager::{model::Workspace, Manager};
use serde_json::json;
use socket2::{Domain, Protocol, Socket, Type};
use std::{
    io::ErrorKind,
    net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, TcpListener, TcpStream},
    time::{Duration, Instant},
};

fn listener(address: IpAddr, ipv6_only: bool) -> TcpListener {
    listener_with_reuse(address, ipv6_only, false)
}

fn listener_with_reuse(address: IpAddr, ipv6_only: bool, reuse_address: bool) -> TcpListener {
    let socket = Socket::new(
        Domain::for_address(SocketAddr::new(address, 0)),
        Type::STREAM,
        Some(Protocol::TCP),
    )
    .unwrap();
    socket.set_reuse_address(reuse_address).unwrap();
    if address.is_ipv6() {
        socket.set_only_v6(ipv6_only).unwrap();
    }
    socket.bind(&SocketAddr::new(address, 0).into()).unwrap();
    socket.listen(1).unwrap();
    socket.into()
}

fn workspace(manager: &Manager, directory: &std::path::Path, port: u16) -> Workspace {
    let workspace = serde_json::from_value(json!({
        "name":"Unrelated port owner fixture", "path":directory, "port":port,
        "coreCommand":["desktop-missing-test-fixture"]
    }))
    .unwrap();
    manager.save_workspace(workspace, None).unwrap()
}

#[cfg(windows)]
fn log_windows_binding_evidence(listener: &TcpListener) {
    use std::io::Write;
    use std::os::windows::io::AsRawSocket;
    use windows_sys::Win32::Networking::WinSock::{
        setsockopt, WSAGetLastError, SOL_SOCKET, SO_EXCLUSIVEADDRUSE,
    };

    fn exclusive_bind(address: SocketAddr) -> std::io::Result<()> {
        let socket = Socket::new(
            Domain::for_address(address),
            Type::STREAM,
            Some(Protocol::TCP),
        )?;
        if address.is_ipv6() {
            socket.set_only_v6(false)?;
        }
        let enabled: i32 = 1;
        let result = unsafe {
            setsockopt(
                socket.as_raw_socket() as _,
                SOL_SOCKET,
                SO_EXCLUSIVEADDRUSE,
                (&enabled as *const i32).cast(),
                std::mem::size_of_val(&enabled) as i32,
            )
        };
        if result != 0 {
            return Err(std::io::Error::from_raw_os_error(unsafe {
                WSAGetLastError()
            }));
        }
        // Never listen on these probes or receive another listener's traffic.
        socket.bind(&address.into())
    }

    let endpoint = listener.local_addr().unwrap();
    let reference = socket2::SockRef::from(listener);
    // Direct stderr keeps the passing IPv6-only control's evidence in CI logs.
    let _ = writeln!(
        std::io::stderr(),
        "Windows fixture {endpoint}: reuse={:?}, only_v6={:?}",
        reference.reuse_address(),
        endpoint.is_ipv6().then(|| reference.only_v6())
    );
    let port = endpoint.port();
    for address in [
        SocketAddr::from((Ipv4Addr::UNSPECIFIED, port)),
        SocketAddr::from((Ipv6Addr::UNSPECIFIED, port)),
        SocketAddr::from((Ipv4Addr::UNSPECIFIED.to_ipv6_mapped(), port)),
    ] {
        let _ = writeln!(
            std::io::stderr(),
            "Windows fixture {endpoint}: exclusive bind-only {address}: {:?}",
            exclusive_bind(address)
        );
    }

    // Record original manager outcomes and bind-only evidence first: an
    // accepted IPv4 connection could itself affect later port reservations.
    let client = match TcpStream::connect_timeout(
        &SocketAddr::from((Ipv4Addr::LOCALHOST, port)),
        Duration::from_millis(250),
    ) {
        Ok(client) => client,
        Err(error) => {
            let _ = writeln!(
                std::io::stderr(),
                "Windows fixture {endpoint}: IPv4 connect: {error:?}"
            );
            return;
        }
    };
    let client_address = client.local_addr().unwrap();
    listener.set_nonblocking(true).unwrap();
    let deadline = Instant::now() + Duration::from_millis(500);
    loop {
        match listener.accept() {
            Ok((accepted, peer)) => {
                let peer_ipv4 = match peer.ip() {
                    IpAddr::V4(ip) => Some(ip),
                    IpAddr::V6(ip) => ip.to_ipv4_mapped(),
                };
                let matches_client =
                    peer_ipv4 == Some(Ipv4Addr::LOCALHOST) && peer.port() == client_address.port();
                let _ = writeln!(
                    std::io::stderr(),
                    "Windows fixture {endpoint}: accepted IPv4 client {client_address} as {peer}, matches_client={matches_client}, local={:?}",
                    accepted.local_addr(),
                );
                // Abort only this fixture-owned connection to avoid TIME_WAIT.
                socket2::SockRef::from(&accepted)
                    .set_linger(Some(Duration::ZERO))
                    .unwrap();
                drop(accepted);
                break;
            }
            Err(error) if error.kind() == ErrorKind::WouldBlock && Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(10));
            }
            Err(error) => {
                let _ = writeln!(
                    std::io::stderr(),
                    "Windows fixture {endpoint}: did not accept IPv4 client {client_address}: {error:?}"
                );
                break;
            }
        }
    }
    listener.set_nonblocking(false).unwrap();
    drop(client);
}

fn assert_unconfirmed(manager: &Manager, workspace: &Workspace) {
    let start = Instant::now();
    let result = manager.stop(&workspace.id);
    assert!(
        result.is_err(),
        "Stop claimed an occupied port was released"
    );
    assert!(
        start.elapsed() < Duration::from_secs(8),
        "Stop did not remain bounded"
    );
    let status = manager
        .snapshot()
        .statuses
        .into_iter()
        .find(|s| s.workspace_id == workspace.id)
        .unwrap();
    assert!(status.port_release_pending);
    assert!(
        !status.cleanup_pending,
        "Unrelated listeners are not owned process cleanup"
    );
    assert_eq!(status.pid, None);
    assert!(status
        .local_message
        .contains("no unrelated process was terminated"));
}

#[test]
fn saturated_accept_queue_does_not_confirm_port_release() {
    let directory = tempfile::tempdir().unwrap();
    let manager = Manager::open(directory.path().join("home")).unwrap();
    let listener = listener(Ipv4Addr::LOCALHOST.into(), false);
    let endpoint = listener.local_addr().unwrap();
    let workspace = workspace(&manager, directory.path(), endpoint.port());
    // Fill the real, bounded queue without accepting. A timeout is independent
    // evidence that failure to connect cannot prove this listener disappeared.
    let mut clients = Vec::new();
    let mut saturated = false;
    for _ in 0..32 {
        match TcpStream::connect_timeout(&endpoint, Duration::from_millis(100)) {
            Ok(client) => clients.push(client),
            Err(error) if matches!(error.kind(), ErrorKind::TimedOut | ErrorKind::WouldBlock) => {
                saturated = true;
                break;
            }
            Err(error) if cfg!(windows) && error.kind() == ErrorKind::ConnectionRefused => {
                // Some Windows stacks reject a full queue with RST instead of
                // a timeout. The still-bound socket must defeat either result.
                saturated = true;
                break;
            }
            Err(error) => panic!("Unexpected queue fixture error: {error}"),
        }
    }
    assert!(saturated, "fixture did not saturate its accept queue");
    assert_unconfirmed(&manager, &workspace);
    assert!(
        TcpListener::bind(endpoint).is_err(),
        "Stop disturbed an unrelated listener"
    );
    // A retry is still unconfirmed while the original listener is retained.
    assert_unconfirmed(&manager, &workspace);
    drop(clients);
    drop(listener);
    let stopped = manager.stop(&workspace.id).unwrap();
    assert_eq!(stopped.state, "stopped");
    assert!(!stopped.cleanup_pending && !stopped.port_release_pending);
    manager.shutdown().unwrap();
}

#[test]
fn rebound_port_allows_edit_and_removal_without_disturbing_its_owner() {
    let directory = tempfile::tempdir().unwrap();
    let manager = Manager::open(directory.path().join("home")).unwrap();
    let original = listener(Ipv4Addr::LOCALHOST.into(), false);
    let endpoint = original.local_addr().unwrap();
    let mut workspace = workspace(&manager, directory.path(), endpoint.port());
    drop(original);
    manager.stop(&workspace.id).unwrap();
    let replacement = TcpListener::bind(endpoint).unwrap();
    assert_unconfirmed(&manager, &workspace);
    workspace.port = 0;
    let changed = manager.save_workspace(workspace, None).unwrap();
    assert_ne!(changed.port, endpoint.port());
    manager.delete_workspace(&changed.id).unwrap();
    manager.shutdown().unwrap();
    assert!(TcpStream::connect_timeout(&endpoint, Duration::from_millis(200)).is_ok());
    drop(replacement);
}

#[test]
fn unowned_port_conflict_does_not_block_quit() {
    let directory = tempfile::tempdir().unwrap();
    let manager = Manager::open(directory.path().join("home")).unwrap();
    let listener = listener(Ipv4Addr::LOCALHOST.into(), false);
    let endpoint = listener.local_addr().unwrap();
    let workspace = workspace(&manager, directory.path(), endpoint.port());
    assert_unconfirmed(&manager, &workspace);
    assert!(
        manager.stop_all().is_err(),
        "Stop-all silently ignored an unconfirmed port"
    );
    manager.shutdown().unwrap();
    let status = manager.snapshot().statuses.remove(0);
    assert!(
        status.port_release_pending,
        "Quit must not fabricate a confirmed port check"
    );
    assert!(TcpStream::connect_timeout(&endpoint, Duration::from_millis(200)).is_ok());
}

#[test]
fn ipv4_wildcard_and_dual_stack_listeners_block_the_managed_endpoint() {
    for address in [
        IpAddr::V4(Ipv4Addr::UNSPECIFIED),
        IpAddr::V6(Ipv6Addr::UNSPECIFIED),
    ] {
        let directory = tempfile::tempdir().unwrap();
        let manager = Manager::open(directory.path().join("home")).unwrap();
        let listener = listener(address, false);
        let port = listener.local_addr().unwrap().port();
        let workspace = workspace(&manager, directory.path(), port);
        let start_error = manager.start(&workspace.id).unwrap_err();
        if !start_error.to_string().contains("Port is already in use") {
            // Keep the independent Stop result in a failed startup assertion:
            // an admission race differs from falsely confirming port release.
            let stop_result = manager.stop(&workspace.id);
            #[cfg(windows)]
            log_windows_binding_evidence(&listener);
            panic!("Listener {address} on port {port}: startup returned {start_error:#}; subsequent Stop returned {stop_result:?}");
        }
        assert_unconfirmed(&manager, &workspace);
        manager.shutdown().unwrap();
        assert!(TcpStream::connect_timeout(
            &SocketAddr::from((Ipv4Addr::LOCALHOST, port)),
            Duration::from_millis(200)
        )
        .is_ok());
    }
}

#[test]
fn reusable_wildcard_listeners_are_not_shadowed_by_the_availability_probe() {
    // BSD/macOS permits a same-user SO_REUSEADDR loopback bind alongside an
    // existing wildcard listener. Checking only 127.0.0.1 must not declare the
    // wildcard released or temporarily steal its loopback traffic.
    for address in [
        IpAddr::V4(Ipv4Addr::UNSPECIFIED),
        IpAddr::V6(Ipv6Addr::UNSPECIFIED),
    ] {
        let directory = tempfile::tempdir().unwrap();
        let manager = Manager::open(directory.path().join("home")).unwrap();
        let listener = listener_with_reuse(address, false, true);
        let port = listener.local_addr().unwrap().port();
        let workspace = workspace(&manager, directory.path(), port);
        let start_error = manager.start(&workspace.id).unwrap_err();
        if !start_error.to_string().contains("Port is already in use") {
            // Keep the independent Stop result in a failed startup assertion:
            // an admission race differs from falsely confirming port release.
            let stop_result = manager.stop(&workspace.id);
            #[cfg(windows)]
            log_windows_binding_evidence(&listener);
            panic!("Listener {address} on port {port}: startup returned {start_error:#}; subsequent Stop returned {stop_result:?}");
        }
        assert_unconfirmed(&manager, &workspace);
        manager.shutdown().unwrap();
        assert!(TcpStream::connect_timeout(
            &SocketAddr::from((Ipv4Addr::LOCALHOST, port)),
            Duration::from_millis(200)
        )
        .is_ok());
    }
}

#[test]
fn ipv6_only_listener_is_independent_of_the_managed_ipv4_endpoint() {
    let directory = tempfile::tempdir().unwrap();
    let manager = Manager::open(directory.path().join("home")).unwrap();
    let listener = listener(Ipv6Addr::LOCALHOST.into(), true);
    let endpoint = listener.local_addr().unwrap();
    let workspace = workspace(&manager, directory.path(), endpoint.port());
    let status = manager.stop(&workspace.id).unwrap();
    assert_eq!(status.state, "stopped");
    assert!(!status.port_release_pending);
    manager.shutdown().unwrap();
    #[cfg(windows)]
    log_windows_binding_evidence(&listener);
    assert!(TcpStream::connect_timeout(&endpoint, Duration::from_millis(200)).is_ok());
}

#[test]
fn normal_release_is_confirmed_promptly() {
    let directory = tempfile::tempdir().unwrap();
    let manager = Manager::open(directory.path().join("home")).unwrap();
    let listener = listener(Ipv4Addr::LOCALHOST.into(), false);
    let endpoint = listener.local_addr().unwrap();
    let workspace = workspace(&manager, directory.path(), endpoint.port());
    drop(listener);
    let start = Instant::now();
    let status = manager.stop(&workspace.id).unwrap();
    assert_eq!(status.state, "stopped");
    assert!(!status.port_release_pending && !status.cleanup_pending);
    assert!(start.elapsed() < Duration::from_secs(2));
    let replacement = TcpListener::bind(endpoint).unwrap();
    manager.shutdown().unwrap();
    drop(replacement);
}

#[cfg(unix)]
#[test]
fn released_listener_with_time_wait_uses_the_same_safe_reuse_as_start() {
    use std::{io::Read, net::Shutdown};
    let directory = tempfile::tempdir().unwrap();
    let manager = Manager::open(directory.path().join("home")).unwrap();
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
    let endpoint = listener.local_addr().unwrap();
    let workspace = workspace(&manager, directory.path(), endpoint.port());
    let mut client = TcpStream::connect(endpoint).unwrap();
    let (mut server, _) = listener.accept().unwrap();
    drop(listener);
    client
        .set_read_timeout(Some(Duration::from_secs(2)))
        .unwrap();
    server
        .set_read_timeout(Some(Duration::from_secs(2)))
        .unwrap();
    server.shutdown(Shutdown::Write).unwrap();
    let mut byte = [0u8; 1];
    assert_eq!(client.read(&mut byte).unwrap(), 0);
    client.shutdown(Shutdown::Write).unwrap();
    assert_eq!(server.read(&mut byte).unwrap(), 0);
    drop(client);
    drop(server);
    let exclusive = Socket::new(Domain::IPV4, Type::STREAM, Some(Protocol::TCP)).unwrap();
    assert_eq!(
        exclusive.bind(&endpoint.into()).unwrap_err().kind(),
        ErrorKind::AddrInUse
    );
    let stopped = manager.stop(&workspace.id).unwrap();
    assert!(!stopped.cleanup_pending && !stopped.port_release_pending);
    let ready_for_start = TcpListener::bind(endpoint).unwrap();
    manager.shutdown().unwrap();
    drop(ready_for_start);
}

#[cfg(windows)]
#[test]
fn windows_reusable_specific_listener_is_never_shared_by_the_probe() {
    let directory = tempfile::tempdir().unwrap();
    let manager = Manager::open(directory.path().join("home")).unwrap();
    let socket = Socket::new(Domain::IPV4, Type::STREAM, Some(Protocol::TCP)).unwrap();
    socket.set_reuse_address(true).unwrap();
    // A plain Windows wildcard bind can coexist with a same-user specific
    // listener. SO_EXCLUSIVEADDRUSE must reject that seemingly free wildcard.
    socket
        .bind(&SocketAddr::from((Ipv4Addr::LOCALHOST, 0)).into())
        .unwrap();
    socket.listen(1).unwrap();
    let port = socket.local_addr().unwrap().as_socket().unwrap().port();
    let workspace = workspace(&manager, directory.path(), port);
    assert_unconfirmed(&manager, &workspace);
    manager.shutdown().unwrap();
    assert!(socket.local_addr().is_ok());
}
