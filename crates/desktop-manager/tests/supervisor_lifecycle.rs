#![cfg(unix)]

use desktop_manager::{
    model::Secrets,
    process::{command, ManagedProcess},
};
use serde_json::Value;
use std::{
    fs,
    os::unix::ffi::{OsStrExt, OsStringExt},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    thread,
    time::{Duration, Instant},
};
use sysinfo::{Pid, ProcessStatus, ProcessesToUpdate, System};

const CORE: &str = r#"
import json, os, signal, stat, subprocess, sys, time
from pathlib import Path
root = Path(os.environ['FIXTURE_DIR'])
child = subprocess.Popen([sys.executable, '-c', '''
import os, signal, time
from pathlib import Path
root = Path(os.environ['FIXTURE_DIR'])
if os.environ.get('RESIST_TERM') == '1':
    signal.signal(signal.SIGTERM, lambda *_: (root / 'child.term').write_text('term'))
(root / 'child.ready').write_text(str(os.getpid()))
while True: time.sleep(0.02)
'''], close_fds=False)
def stop(*_):
    (root / 'core.term').write_text('term')
    if os.environ.get('RESIST_TERM') != '1':
        child.wait(timeout=5)
        sys.exit(0)
signal.signal(signal.SIGTERM, stop)
# Allocate real memory so metrics cannot pass by reporting the tiny supervisor.
memory = bytearray(32 * 1024 * 1024)
extra_fifos = []
for fd in range(3, 256):
    try:
        if stat.S_ISFIFO(os.fstat(fd).st_mode): extra_fifos.append(fd)
    except OSError: pass
info = {'core': os.getpid(), 'child': child.pid, 'extra_fifos': extra_fifos,
        'cwd': os.getcwd(), 'args': [os.fsencode(x).hex() for x in sys.argv[1:]],
        'secret': os.environ.get('FIXTURE_SECRET'), 'removed': os.environ.get('HOME'),
        'environment': sorted(os.environ), 'stdin_is_null': os.fstat(0).st_rdev == os.stat('/dev/null').st_rdev}
(root / 'info.tmp').write_text(json.dumps(info))
os.replace(root / 'info.tmp', root / 'info.json')
while not (root / 'exit').exists(): time.sleep(0.02)
sys.exit(int(os.environ.get('EXIT_CODE', '0')))
"#;

fn python() -> std::ffi::OsString {
    let name = std::env::var("PYTHON").unwrap_or_else(|_| "python3".into());
    desktop_manager::core::find_program(&name)
        .expect("Python fixture executable must be available")
        .into_os_string()
}
fn supervisor() -> &'static Path {
    Path::new(env!("CARGO_BIN_EXE_desktop-process-supervisor"))
}
fn fixture_command(dir: &Path) -> Command {
    let mut cmd = command(python(), Some(supervisor()));
    cmd.args(["-c", CORE])
        .env("FIXTURE_DIR", dir)
        .current_dir(dir);
    cmd
}
fn poll(mut condition: impl FnMut() -> bool, timeout: Duration, message: &str) {
    let deadline = Instant::now() + timeout;
    while !condition() {
        assert!(Instant::now() < deadline, "{message}");
        thread::sleep(Duration::from_millis(20));
    }
}
fn info(dir: &Path) -> Value {
    let mut value = None;
    poll(
        || {
            value = fs::read(dir.join("info.json"))
                .ok()
                .and_then(|bytes| serde_json::from_slice(&bytes).ok());
            value.is_some() && dir.join("child.ready").exists()
        },
        Duration::from_secs(10),
        "fixture core and descendant did not become ready",
    );
    value.unwrap()
}
#[derive(Clone, Copy)]
struct Identity {
    pid: u32,
    birth: u64,
}
impl Identity {
    fn capture(pid: u32) -> Self {
        let system = System::new_all();
        let process = system
            .process(Pid::from_u32(pid))
            .expect("owned fixture vanished before identification");
        Self {
            pid,
            birth: process.start_time(),
        }
    }
    fn running(self) -> bool {
        let mut system = System::new();
        system.refresh_processes(ProcessesToUpdate::Some(&[Pid::from_u32(self.pid)]), true);
        system
            .process(Pid::from_u32(self.pid))
            .is_some_and(|p| p.start_time() == self.birth && p.status() != ProcessStatus::Zombie)
    }
    fn signal(self, signal: i32) {
        if self.running() {
            unsafe {
                libc::kill(self.pid as i32, signal);
            }
        }
    }
}
struct Fixture {
    dir: tempfile::TempDir,
    process: Option<ManagedProcess>,
    desktop: Option<Child>,
    identities: Vec<Identity>,
}
impl Fixture {
    fn new() -> Self {
        Self {
            dir: tempfile::tempdir().unwrap(),
            process: None,
            desktop: None,
            identities: vec![],
        }
    }
    fn start(&mut self, configure: impl FnOnce(&mut Command)) -> Value {
        let mut cmd = fixture_command(self.dir.path());
        configure(&mut cmd);
        let p = ManagedProcess::spawn_supervised(
            &mut cmd,
            self.dir.path().join("runtime.log"),
            Secrets::default(),
        )
        .unwrap();
        self.identities.push(Identity::capture(p.pid()));
        self.process = Some(p);
        self.capture_core()
    }
    fn capture_core(&mut self) -> Value {
        let info = info(self.dir.path());
        for key in ["core", "child"] {
            self.identities
                .push(Identity::capture(info[key].as_u64().unwrap() as u32));
        }
        info
    }
    fn assert_stopped(&self) {
        poll(
            || self.identities.iter().all(|p| !p.running()),
            Duration::from_secs(10),
            "owned fixture process still running",
        );
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        if let Some(mut desktop) = self.desktop.take() {
            let _ = desktop.kill();
            let _ = desktop.wait();
        }
        if let Some(mut process) = self.process.take() {
            let _ = process.stop();
        }
        for pid in self.identities.iter().rev() {
            pid.signal(libc::SIGKILL);
        }
        // Every fixture PID is birth-checked. Never signal an arbitrary PID read
        // from old state, and never leave a benign fixture executing after failure.
        let deadline = Instant::now() + Duration::from_secs(5);
        while self.identities.iter().any(|p| p.running()) && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(20));
        }
    }
}

#[test]
fn explicit_stop_allows_inner_group_cleanup_and_reports_real_resources() {
    let mut fixture = Fixture::new();
    fixture.start(|cmd| {
        cmd.env("RESIST_TERM", "1");
    });
    let p = fixture.process.as_mut().unwrap();
    poll(
        || p.metrics().1 >= 24 * 1024 * 1024,
        Duration::from_secs(5),
        "metrics only reported wrapper memory",
    );
    p.stop().unwrap();
    assert!(fixture.dir.path().join("core.term").exists());
    assert!(fixture.dir.path().join("child.term").exists());
    fixture.assert_stopped();
}

#[test]
fn normal_core_exit_stops_descendants_and_preserves_exit_status() {
    for code in [0, 37] {
        let mut fixture = Fixture::new();
        let mut command = fixture_command(fixture.dir.path());
        command
            .env("EXIT_CODE", code.to_string())
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let child = command.spawn().unwrap();
        fixture.identities.push(Identity::capture(child.id()));
        fixture.desktop = Some(child);
        fixture.capture_core();
        fs::write(fixture.dir.path().join("exit"), "exit").unwrap();
        let mut status = None;
        poll(
            || {
                status = fixture.desktop.as_mut().unwrap().try_wait().unwrap();
                status.is_some()
            },
            Duration::from_secs(10),
            "supervisor did not exit after core exit",
        );
        assert_eq!(status.unwrap().code(), Some(code));
        fixture.assert_stopped();
    }
}

#[test]
fn independent_supervisors_and_graceful_supervisor_termination() {
    let mut first = Fixture::new();
    let mut second = Fixture::new();
    first.start(|_| {});
    second.start(|_| {});
    first.identities[0].signal(libc::SIGTERM);
    let p = first.process.as_mut().unwrap();
    poll(
        || !p.alive(),
        Duration::from_secs(10),
        "TERM did not complete supervisor cleanup",
    );
    assert!(p.succeeded());
    p.stop().unwrap();
    first.assert_stopped();
    assert!(second.identities.iter().all(|p| p.running()));
    second.process.as_mut().unwrap().stop().unwrap();
    second.assert_stopped();
}

#[test]
fn killed_supervisor_uses_live_desktops_observed_identity_fallback() {
    let mut fixture = Fixture::new();
    fixture.start(|_| {});
    fixture.process.as_mut().unwrap().metrics();
    fixture.identities[0].signal(libc::SIGKILL);
    let p = fixture.process.as_mut().unwrap();
    poll(
        || !p.alive(),
        Duration::from_secs(5),
        "SIGKILL did not stop supervisor",
    );
    p.stop().unwrap();
    fixture.assert_stopped();
    // This does not promise cleanup after simultaneous desktop+helper SIGKILL,
    // or discovery of deliberately detached, previously unobserved processes.
}

#[test]
fn argv_environment_and_working_directory_survive_without_reconstruction() {
    let mut fixture = Fixture::new();
    let value = std::ffi::OsString::from_vec(b"spaces ; quotes ' $HOME \xff".to_vec());
    let expected = value
        .as_bytes()
        .iter()
        .fold(String::new(), |mut text, byte| {
            use std::fmt::Write;
            write!(text, "{byte:02x}").unwrap();
            text
        });
    let dir = fixture.dir.path().to_path_buf();
    let data = fixture.start(|cmd| {
        cmd.env_clear()
            .env("FIXTURE_DIR", &dir)
            .env("FIXTURE_SECRET", "private test value")
            .arg(value);
        // Python may set LC_CTYPE while initializing; it is not supplied by us.
    });
    assert_eq!(
        data["cwd"],
        fixture
            .dir
            .path()
            .canonicalize()
            .unwrap()
            .to_string_lossy()
            .as_ref()
    );
    assert_eq!(data["args"][0], expected);
    assert_eq!(data["secret"], "private test value");
    assert!(data["removed"].is_null());
    assert_eq!(data["stdin_is_null"], true);
    assert_eq!(data["extra_fifos"], serde_json::json!([]));
    let environment = data["environment"].as_array().unwrap();
    assert!(environment.iter().all(
        |name| ["FIXTURE_DIR", "FIXTURE_SECRET", "LC_CTYPE"].contains(&name.as_str().unwrap())
    ));
    fixture.process.as_mut().unwrap().stop().unwrap();
    fixture.assert_stopped();
}

#[test]
fn abrupt_desktop_death_closes_liveness_pipe_even_with_descendants_and_sibling() {
    let mut fixture = Fixture::new();
    let mut cmd = Command::new(std::env::current_exe().unwrap());
    cmd.args([
        "--ignored",
        "--exact",
        "desktop_process_fixture",
        "--nocapture",
    ])
    .env("SUPERVISOR_DESKTOP_FIXTURE", fixture.dir.path())
    .stdin(Stdio::null())
    .stdout(Stdio::null())
    .stderr(Stdio::null());
    fixture.desktop = Some(cmd.spawn().unwrap());
    poll(
        || fixture.dir.path().join("desktop-ready.json").exists(),
        Duration::from_secs(10),
        "desktop fixture did not launch",
    );
    let pids: Value =
        serde_json::from_slice(&fs::read(fixture.dir.path().join("desktop-ready.json")).unwrap())
            .unwrap();
    fixture.identities.push(Identity::capture(
        pids["supervisor"].as_u64().unwrap() as u32
    ));
    fixture.capture_core();
    let sibling = Identity::capture(pids["sibling"].as_u64().unwrap() as u32);
    // The unrelated sibling intentionally outlives the desktop. If the writer
    // leaked through exec, EOF could never arrive while this sibling survives.
    fixture.identities.push(sibling);
    fixture.desktop.as_mut().unwrap().kill().unwrap();
    fixture.desktop.as_mut().unwrap().wait().unwrap();
    poll(
        || fixture.identities[..3].iter().all(|p| !p.running()),
        Duration::from_secs(10),
        "parent death failed to stop supervised core/descendants",
    );
    assert!(
        sibling.running(),
        "supervision must not stop unrelated sibling"
    );
    sibling.signal(libc::SIGKILL);
    fixture.assert_stopped();
}

// Runs in a real second process so kill() simulates abrupt desktop death with
// no Rust destructors. It never runs during a normal integration-test pass.
#[test]
#[ignore = "private subprocess fixture"]
fn desktop_process_fixture() {
    let Some(root) = std::env::var_os("SUPERVISOR_DESKTOP_FIXTURE") else {
        return;
    };
    let root = PathBuf::from(root);
    let mut command = fixture_command(&root);
    let mut process = ManagedProcess::spawn_supervised(
        &mut command,
        root.join("runtime.log"),
        Secrets::default(),
    )
    .unwrap();
    let _ = info(&root);
    struct ReapOnDrop(Child);
    impl Drop for ReapOnDrop {
        fn drop(&mut self) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }
    let sibling = ReapOnDrop(
        Command::new(python())
            .args(["-c", "import time; time.sleep(60)"])
            .spawn()
            .unwrap(),
    );
    let ready = serde_json::json!({"supervisor": process.pid(), "sibling": sibling.0.id()});
    fs::write(root.join("desktop-ready.tmp"), ready.to_string()).unwrap();
    fs::rename(
        root.join("desktop-ready.tmp"),
        root.join("desktop-ready.json"),
    )
    .unwrap();
    // Bounded safety timeout if the controlling test itself fails unexpectedly.
    poll(
        || root.join("desktop-finish").exists(),
        Duration::from_secs(30),
        "desktop fixture timed out",
    );
    process.stop().unwrap();
    drop(sibling);
}
