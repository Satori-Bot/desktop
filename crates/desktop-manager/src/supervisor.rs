//! Private Unix parent-liveness mode, entered before native GUI initialization.
//!
//! This is process-group supervision, not a security sandbox. Ordinary children
//! stay in the owned group. Deliberately detached children can only be stopped
//! if their birth identity was observed; SIGKILL of the supervisor itself has
//! no cleanup handler. Windows instead uses its existing kill-on-close Job.

/// Private native argv prefix. Never contains credentials or serialized config.
pub const ARGUMENT: &str = "--desktop-supervise";

/// Call before Tauri (or any background threads). A return value means private
/// supervisor mode was requested and the caller must immediately exit with it.
pub fn run_if_requested() -> Option<i32> {
    #[cfg(unix)]
    {
        let mut args = std::env::args_os().skip(1);
        if args.next().as_deref() != Some(std::ffi::OsStr::new(ARGUMENT)) {
            return None;
        }
        if args.next().as_deref() != Some(std::ffi::OsStr::new("--")) {
            eprintln!("Invalid private supervisor invocation");
            return Some(2);
        }
        let Some(program) = args.next() else {
            eprintln!("Missing private supervisor executable");
            return Some(2);
        };
        let mut command = std::process::Command::new(program);
        command.args(args);
        Some(match run(command) {
            Ok(code) => code,
            Err(error) => {
                eprintln!("Desktop supervisor failed: {error:#}");
                1
            }
        })
    }
    #[cfg(not(unix))]
    None
}

#[cfg(unix)]
pub(crate) fn close_on_exec(fd: std::os::fd::RawFd) -> anyhow::Result<()> {
    use anyhow::Context;
    let flags = unsafe { libc::fcntl(fd, libc::F_GETFD) };
    if flags == -1 || unsafe { libc::fcntl(fd, libc::F_SETFD, flags | libc::FD_CLOEXEC) } == -1 {
        return Err(std::io::Error::last_os_error()).context("Could not protect liveness pipe");
    }
    Ok(())
}

#[cfg(unix)]
fn parent_alive(timeout_ms: i32) -> std::io::Result<bool> {
    let mut fd = libc::pollfd {
        fd: libc::STDIN_FILENO,
        events: libc::POLLIN,
        revents: 0,
    };
    let result = unsafe { libc::poll(&mut fd, 1, timeout_ms) };
    if result < 0 {
        let error = std::io::Error::last_os_error();
        return if error.kind() == std::io::ErrorKind::Interrupted {
            Ok(true)
        } else {
            Err(error)
        };
    }
    if fd.revents & (libc::POLLHUP | libc::POLLERR | libc::POLLNVAL) != 0 {
        return Ok(false);
    }
    if fd.revents & libc::POLLIN != 0 {
        let mut byte = 0u8;
        let count = unsafe { libc::read(libc::STDIN_FILENO, (&mut byte as *mut u8).cast(), 1) };
        if count < 0 {
            return Err(std::io::Error::last_os_error());
        }
        return Ok(count != 0);
    }
    Ok(true)
}

#[cfg(unix)]
fn run(mut command: std::process::Command) -> anyhow::Result<i32> {
    use crate::process::ManagedProcess;
    use anyhow::{bail, Context};
    use std::{
        sync::{
            atomic::{AtomicBool, Ordering},
            Arc,
        },
        time::{Duration, Instant},
    };

    // Reject interactive/manual invocation. The liveness read end is private,
    // CLOEXEC, and the actual command receives /dev/null instead of this stdin.
    let mut stat: libc::stat = unsafe { std::mem::zeroed() };
    if unsafe { libc::fstat(libc::STDIN_FILENO, &mut stat) } == -1
        || stat.st_mode & libc::S_IFMT != libc::S_IFIFO
    {
        bail!("Supervisor requires a private parent-liveness pipe");
    }
    close_on_exec(libc::STDIN_FILENO)?;
    let stopping = Arc::new(AtomicBool::new(false));
    for signal in [libc::SIGTERM, libc::SIGINT, libc::SIGHUP] {
        signal_hook::flag::register(signal, Arc::clone(&stopping))
            .context("Could not register supervisor shutdown handler")?;
    }
    if !parent_alive(0)? || stopping.load(Ordering::Relaxed) {
        return Ok(0);
    }
    let mut process = ManagedProcess::spawn_inherited(&mut command)?;
    let mut next_observation = Instant::now();
    while process.alive() && !stopping.load(Ordering::Relaxed) && parent_alive(50)? {
        if Instant::now() >= next_observation {
            process.metrics();
            next_observation = Instant::now() + Duration::from_millis(250);
        }
    }
    let exit_code = process.exit_code().unwrap_or(0);
    process
        .stop()
        .context("Could not stop supervised process group")?;
    Ok(exit_code)
}
