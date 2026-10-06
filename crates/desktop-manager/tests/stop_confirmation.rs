use desktop_manager::{model::Workspace, Manager};
use serde_json::json;
use std::{
    net::TcpListener,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread,
    time::{Duration, Instant},
};

struct PortOwner {
    accepting: Arc<AtomicBool>,
    worker: Option<thread::JoinHandle<()>>,
}

impl PortOwner {
    fn new(listener: TcpListener) -> Self {
        listener.set_nonblocking(true).unwrap();
        let accepting = Arc::new(AtomicBool::new(true));
        let active = accepting.clone();
        let worker = thread::spawn(move || {
            // Drain connections so two bounded Stop checks cannot fill the
            // listen backlog and misinterpret a connect timeout as release.
            let deadline = Instant::now() + Duration::from_secs(30);
            while active.load(Ordering::SeqCst) && Instant::now() < deadline {
                let _ = listener.accept();
                thread::sleep(Duration::from_millis(2));
            }
        });
        Self {
            accepting,
            worker: Some(worker),
        }
    }
}

impl Drop for PortOwner {
    fn drop(&mut self) {
        self.accepting.store(false, Ordering::SeqCst);
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

#[test]
fn shutdown_rechecks_unconfirmed_stop_even_without_a_process_handle() {
    let directory = tempfile::tempdir().unwrap();
    let manager = Manager::open(directory.path().join("home")).unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let workspace: Workspace = serde_json::from_value(json!({
        "name":"Unrelated port owner fixture",
        "path":directory.path(),
        "port":port
    }))
    .unwrap();
    let workspace = manager.save_workspace(workspace, None).unwrap();
    let owner = PortOwner::new(listener);

    // No manager-owned process exists. An explicit Stop still cannot confirm
    // port release, and Quit must preserve this unresolved result on retry.
    let stopped = manager.stop(&workspace.id);
    let after_stop = manager.snapshot().statuses.remove(0);
    let shutdown = manager.shutdown();
    let after_shutdown = manager.snapshot().statuses.remove(0);
    let port_was_preserved = std::net::TcpStream::connect(("127.0.0.1", port)).is_ok();
    drop(owner);

    // Both initial checks are bounded by 4s; after fixture cleanup the retry
    // completes immediately without another artificial timeout.
    let retried = manager.stop(&workspace.id);
    let final_shutdown = manager.shutdown();

    assert!(
        stopped.is_err(),
        "Stop claimed an occupied port was released"
    );
    assert!(after_stop.cleanup_pending);
    assert_eq!(after_stop.pid, None);
    assert!(
        shutdown.is_err(),
        "Quit silently skipped unconfirmed port cleanup"
    );
    assert!(after_shutdown.cleanup_pending);
    assert!(
        port_was_preserved,
        "Stop disturbed the unrelated fixture port owner"
    );
    let retried = retried.unwrap();
    assert_eq!(retried.state, "stopped");
    assert!(!retried.cleanup_pending);
    final_shutdown.unwrap();
}
