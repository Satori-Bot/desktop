//! A deliberately detached pipe holder is a negative-control fixture: Unix
//! process groups do not promise to contain an unobserved setsid descendant.
//! The manager must preserve its cleanup error and ownership, however, rather
//! than forget the handle and permit edits while readers remain undrained.
#![cfg(unix)]

use desktop_manager::{core, model::Workspace, Manager};
use serde_json::json;
use std::{
    path::{Path, PathBuf},
    thread,
    time::{Duration, Instant},
};
use sysinfo::{Pid, ProcessRefreshKind, ProcessStatus, ProcessesToUpdate, System, UpdateKind};

struct PipeHolder {
    marker: PathBuf,
    release: PathBuf,
    identity: Option<(u32, u64)>,
}

impl PipeHolder {
    fn new(directory: &Path) -> Self {
        Self {
            marker: directory.join("detached-holder.pid"),
            release: directory.join("release-holder"),
            identity: None,
        }
    }

    fn script(&self) -> String {
        let marker = serde_json::to_string(self.marker.to_str().unwrap()).unwrap();
        let release = serde_json::to_string(self.release.to_str().unwrap()).unwrap();
        format!(
            r#"import os, pathlib, time
read_end, write_end = os.pipe()
child = os.fork()
if child == 0:
    os.close(read_end)
    os.setsid()
    pathlib.Path({marker}).write_text(str(os.getpid()))
    os.write(write_end, b'ready')
    os.close(write_end)
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline and not pathlib.Path({release}).exists():
        time.sleep(0.02)
    os._exit(0)
os.close(write_end)
os.read(read_end, 5)
os.close(read_end)
os._exit(2)
"#
        )
    }

    fn observe(&mut self) -> bool {
        let Some(pid) = std::fs::read_to_string(&self.marker)
            .ok()
            .and_then(|text| text.trim().parse::<u32>().ok())
        else {
            return false;
        };
        let mut system = System::new();
        system.refresh_processes_specifics(
            ProcessesToUpdate::Some(&[Pid::from_u32(pid)]),
            true,
            ProcessRefreshKind::nothing().with_cmd(UpdateKind::Always),
        );
        let Some(process) = system.process(Pid::from_u32(pid)) else {
            return false;
        };
        // The private marker and unique path in the inherited Python argv bind
        // this identity to our fixture before any independent signal is sent.
        let owned = process.status() != ProcessStatus::Zombie
            && process.cmd().iter().any(|argument| {
                argument
                    .to_string_lossy()
                    .contains(self.marker.to_str().unwrap())
            });
        if owned {
            self.identity = Some((pid, process.start_time()));
        }
        owned
    }

    fn cleanup(&mut self) -> bool {
        // A release gate and a self-imposed 30s deadline also bound cleanup if
        // observation failed or an assertion unwinds before identity capture.
        let _ = std::fs::write(&self.release, b"finish");
        let Some((pid, birth)) = self.identity else {
            return false;
        };
        let mut system = System::new();
        system.refresh_processes(ProcessesToUpdate::Some(&[Pid::from_u32(pid)]), true);
        if let Some(process) = system.process(Pid::from_u32(pid)) {
            if process.start_time() == birth && process.status() != ProcessStatus::Zombie {
                let _ = process.kill();
            }
        }
        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            system.refresh_processes(ProcessesToUpdate::Some(&[Pid::from_u32(pid)]), true);
            let still_running = system.process(Pid::from_u32(pid)).is_some_and(|process| {
                process.start_time() == birth && process.status() != ProcessStatus::Zombie
            });
            if !still_running {
                return true;
            }
            if Instant::now() >= deadline {
                return false;
            }
            thread::sleep(Duration::from_millis(20));
        }
    }
}

impl Drop for PipeHolder {
    fn drop(&mut self) {
        let _ = self.cleanup();
    }
}

fn between_refreshes<T>(mut action: impl FnMut() -> anyhow::Result<T>) -> anyhow::Result<T> {
    let deadline = Instant::now() + Duration::from_secs(6);
    loop {
        let result = action();
        if !result
            .as_ref()
            .err()
            .is_some_and(|error| error.to_string().contains("operation is in progress"))
            || Instant::now() >= deadline
        {
            return result;
        }
        thread::sleep(Duration::from_millis(10));
    }
}

#[test]
fn failed_start_retains_ownership_until_undrained_output_is_cleaned_up() {
    let directory = tempfile::tempdir().unwrap();
    let manager = Manager::open(directory.path().join("home")).unwrap();
    let mut holder = PipeHolder::new(directory.path());
    let python = core::find_program(&std::env::var("PYTHON").unwrap_or_else(|_| "python3".into()))
        .expect("Python fixture executable");
    let workspace: Workspace = serde_json::from_value(json!({
        "name":"Failed startup ownership fixture",
        "path":directory.path(),
        "coreCommand":[python, "-c", holder.script()]
    }))
    .unwrap();
    let workspace = manager.save_workspace(workspace, None).unwrap();

    let launched = manager.start(&workspace.id);
    let holder_was_live = holder.observe();
    let after_failure = manager.snapshot().statuses.remove(0);
    manager.refresh();
    let after_refresh = manager.snapshot().statuses.remove(0);
    let edited = between_refreshes(|| manager.save_workspace(workspace.clone(), None));
    let deleted = between_refreshes(|| manager.delete_workspace(&workspace.id));
    let quit_with_owned_cleanup = between_refreshes(|| manager.shutdown());

    // Collect observations before asserting so even the original broken
    // behavior releases the fixture-owned child and its inherited pipes.
    let cleaned = holder.cleanup();
    let stopped = between_refreshes(|| manager.stop(&workspace.id));
    let shutdown = manager.shutdown();

    assert!(
        launched.is_err(),
        "fixture unexpectedly passed MCP readiness"
    );
    assert!(
        holder_was_live,
        "fixture did not retain an unobserved output pipe"
    );
    assert!(cleaned, "fixture-owned pipe holder did not exit");
    assert!(
        after_failure.cleanup_pending,
        "startup error hid pending cleanup"
    );
    assert!(after_refresh.cleanup_pending, "refresh hid pending cleanup");
    assert!(
        !after_refresh.port_release_pending,
        "owned cleanup became an unrelated port warning"
    );
    assert!(
        quit_with_owned_cleanup.is_err(),
        "Quit discarded an owned cleanup failure"
    );
    assert_eq!(
        after_failure.pid, None,
        "startup error advertised a dead leader"
    );
    assert_eq!(after_refresh.pid, None, "refresh advertised a dead leader");
    let edit_error = edited.expect_err("failed startup forgot ownership and allowed an edit");
    assert!(
        edit_error.to_string().contains("Stop this workspace"),
        "{edit_error:#}"
    );
    let delete_error = deleted.expect_err("failed startup forgot ownership and allowed deletion");
    assert!(
        delete_error.to_string().contains("Stop the workspace"),
        "{delete_error:#}"
    );
    let stopped = stopped.unwrap();
    assert_eq!(stopped.state, "stopped");
    assert!(
        !stopped.cleanup_pending,
        "successful Stop retained the warning"
    );
    shutdown.unwrap();
}
