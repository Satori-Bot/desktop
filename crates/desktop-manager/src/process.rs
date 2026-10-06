use crate::{
    events::{append_log, redact},
    model::Secrets,
};
#[cfg(windows)]
use anyhow::bail;
use anyhow::{Context, Result};
use std::{
    io::Read,
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant},
};
#[cfg(unix)]
use sysinfo::Signal;
use sysinfo::{Pid, ProcessesToUpdate, System};

pub struct ManagedProcess {
    child: Child,
    pub started: Instant,
    reaped: bool,
    descendants: Vec<(u32, u64)>,
    system: System,
    readers: Vec<thread::JoinHandle<()>>,
    #[cfg(windows)]
    job: WindowsJob,
}
impl ManagedProcess {
    pub fn spawn(command: &mut Command, log: PathBuf, secrets: Secrets) -> Result<Self> {
        command
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            command.process_group(0);
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000 | 0x00000200 | 0x00000004);
        }
        let mut child = command
            .spawn()
            .context("Could not start executable; check its path and installation")?;
        #[cfg(windows)]
        let job = match WindowsJob::assign(&child) {
            Ok(j) => j,
            Err(e) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(e);
            }
        };
        let lock = Arc::new(Mutex::new(()));
        fn pipe(
            mut input: impl Read + Send + 'static,
            path: PathBuf,
            secrets: Secrets,
            lock: Arc<Mutex<()>>,
        ) -> thread::JoinHandle<()> {
            thread::spawn(move || {
                let mut buf = [0u8; 4096];
                let mut pending = Vec::new();
                let mut discard = false;
                loop {
                    let n = input.read(&mut buf).unwrap_or_default();
                    if n == 0 {
                        if !pending.is_empty() && !discard {
                            let text = redact(&String::from_utf8_lossy(&pending), &secrets);
                            if let Ok(_g) = lock.lock() {
                                let _ = append_log(&path, &text);
                            }
                        }
                        break;
                    }
                    for byte in &buf[..n] {
                        if !discard {
                            pending.push(*byte);
                        }
                        if *byte == b'\n' {
                            let text = if discard {
                                "[Overlong log line omitted]\n".into()
                            } else {
                                redact(&String::from_utf8_lossy(&pending), &secrets)
                            };
                            if let Ok(_g) = lock.lock() {
                                let _ = append_log(&path, &text);
                            }
                            pending.clear();
                            discard = false;
                        } else if pending.len() >= 65536 {
                            pending.clear();
                            discard = true;
                        }
                    }
                }
            })
        }
        let stdout = pipe(
            child.stdout.take().unwrap(),
            log.clone(),
            secrets.clone(),
            lock.clone(),
        );
        let stderr = pipe(child.stderr.take().unwrap(), log, secrets, lock);
        let mut system = System::new();
        system.refresh_processes(ProcessesToUpdate::All, true);
        Ok(Self {
            child,
            started: Instant::now(),
            reaped: false,
            descendants: vec![],
            system,
            readers: vec![stdout, stderr],
            #[cfg(windows)]
            job,
        })
    }
    #[cfg(unix)]
    fn exit_info(&mut self) -> Option<libc::siginfo_t> {
        if self.reaped {
            return None;
        }
        let mut info: libc::siginfo_t = unsafe { std::mem::zeroed() };
        // WNOWAIT keeps the dead group leader's PID reserved until stop() has
        // terminated its group, including children not observed before a crash.
        let result = unsafe {
            libc::waitid(
                libc::P_PID,
                self.child.id(),
                &mut info,
                libc::WEXITED | libc::WNOHANG | libc::WNOWAIT,
            )
        };
        if result == -1 {
            if std::io::Error::last_os_error().raw_os_error() == Some(libc::ECHILD) {
                self.reaped = true;
            }
            return None;
        }
        if unsafe { info.si_pid() } == 0 {
            None
        } else {
            Some(info)
        }
    }
    pub fn succeeded(&mut self) -> bool {
        #[cfg(unix)]
        {
            self.exit_info()
                .is_some_and(|s| s.si_code == libc::CLD_EXITED && unsafe { s.si_status() } == 0)
        }
        #[cfg(not(unix))]
        {
            self.child
                .try_wait()
                .ok()
                .flatten()
                .map(|s| s.success())
                .unwrap_or(false)
        }
    }
    pub fn pid(&self) -> u32 {
        self.child.id()
    }
    pub fn alive(&mut self) -> bool {
        #[cfg(unix)]
        {
            let exited = self.exit_info().is_some();
            !exited && !self.reaped
        }
        #[cfg(not(unix))]
        {
            self.child.try_wait().map(|s| s.is_none()).unwrap_or(false)
        }
    }
    pub fn metrics(&mut self) -> (f32, u64) {
        self.system.refresh_processes(ProcessesToUpdate::All, true);
        let mut parents = vec![self.pid()];
        let mut seen = vec![];
        while let Some(pid) = parents.pop() {
            for (id, p) in self.system.processes() {
                if p.parent().map(|p| p.as_u32()) == Some(pid)
                    && !seen.iter().any(|(x, _)| *x == id.as_u32())
                {
                    seen.push((id.as_u32(), p.start_time()));
                    parents.push(id.as_u32());
                }
            }
        }
        for identity in seen {
            if !self.descendants.contains(&identity) {
                self.descendants.push(identity);
            }
        }
        // Keep previously observed children even after reparenting, but drop
        // dead/reused identities to bound the tracking set.
        self.descendants.retain(|(pid, start)| {
            self.system
                .process(Pid::from_u32(*pid))
                .is_some_and(|p| p.start_time() == *start)
        });
        let p = self.system.process(Pid::from_u32(self.pid()));
        p.map(|p| (p.cpu_usage(), p.memory())).unwrap_or((0., 0))
    }
    fn identity_matches(&self, pid: u32, start: u64) -> bool {
        self.system
            .process(Pid::from_u32(pid))
            .map(|p| p.start_time() == start)
            .unwrap_or(false)
    }
    pub fn stop(&mut self) -> Result<()> {
        if !self.reaped {
            self.metrics();
            #[cfg(windows)]
            self.job.terminate()?;
            #[cfg(unix)]
            {
                // WNOWAIT reserves our child's PID and original group ID.
                // Darwin getpgid rejects zombie leaders, so it cannot validate
                // this ownership. Refresh wait ownership; ECHILD fails closed.
                let _ = self.exit_info();
                if !self.reaped {
                    unsafe {
                        libc::kill(-(self.pid() as i32), libc::SIGTERM);
                    }
                }
                for (pid, start) in self.descendants.iter().rev() {
                    if self.identity_matches(*pid, *start) {
                        if let Some(p) = self.system.process(Pid::from_u32(*pid)) {
                            let _ = p.kill_with(Signal::Term);
                        }
                    }
                }
            }
            let until = Instant::now() + Duration::from_secs(3);
            while self.alive() && Instant::now() < until {
                thread::sleep(Duration::from_millis(40));
            }
            if self.alive() {
                let _ = self.child.kill();
            }
            #[cfg(unix)]
            {
                let _ = self.exit_info();
                if !self.reaped {
                    unsafe {
                        libc::kill(-(self.pid() as i32), libc::SIGKILL);
                    }
                }
            }
            // Also clean children that left the original group but were observed.
            // Every independently signaled PID still requires its original birth time.
            self.system.refresh_processes(ProcessesToUpdate::All, true);
            for (pid, start) in self.descendants.iter().rev() {
                if self.identity_matches(*pid, *start) {
                    if let Some(p) = self.system.process(Pid::from_u32(*pid)) {
                        let _ = p.kill();
                    }
                }
            }
            let forced_deadline = Instant::now() + Duration::from_secs(2);
            while self.alive() && Instant::now() < forced_deadline {
                thread::sleep(Duration::from_millis(20));
            }
            if self.alive() {
                return Err(anyhow::anyhow!(
                    "Could not confirm child process exit after forced termination"
                ));
            }
            self.child
                .wait()
                .context("Could not confirm child process exit")?;
            self.reaped = true;
        }
        let deadline = Instant::now() + Duration::from_secs(2);
        while self.readers.iter().any(|r| !r.is_finished()) && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(10));
        }
        if self.readers.iter().any(|r| !r.is_finished()) {
            return Err(anyhow::anyhow!(
                "Child output pipes remained open after process cleanup"
            ));
        }
        for reader in self.readers.drain(..) {
            reader
                .join()
                .map_err(|_| anyhow::anyhow!("Log reader failed"))?;
        }
        Ok(())
    }
}
impl Drop for ManagedProcess {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}

#[cfg(windows)]
struct WindowsJob(windows_sys::Win32::Foundation::HANDLE);
#[cfg(windows)]
unsafe impl Send for WindowsJob {}
#[cfg(windows)]
impl WindowsJob {
    fn assign(child: &Child) -> Result<Self> {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::{Foundation::CloseHandle, System::JobObjects::*};
        unsafe {
            let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if handle.is_null() {
                bail!("Could not create process job");
            }
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const _,
                std::mem::size_of_val(&info) as u32,
            ) == 0
                || AssignProcessToJobObject(handle, child.as_raw_handle() as _) == 0
            {
                CloseHandle(handle);
                bail!("Could not contain child process in Windows job");
            }
            // std::process::Child does not retain the primary thread handle.
            // The process is still CREATE_SUSPENDED, so enumerate its initial
            // thread, contain first, and resume only after Job assignment.
            use windows_sys::Win32::Foundation::INVALID_HANDLE_VALUE;
            use windows_sys::Win32::System::{Diagnostics::ToolHelp::*, Threading::*};
            let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0);
            if snapshot == INVALID_HANDLE_VALUE {
                CloseHandle(handle);
                bail!("Could not enumerate suspended child thread");
            }
            let mut entry: THREADENTRY32 = std::mem::zeroed();
            entry.dwSize = std::mem::size_of_val(&entry) as u32;
            let mut threads = Vec::new();
            let mut more = Thread32First(snapshot, &mut entry);
            while more != 0 {
                if entry.th32OwnerProcessID == child.id() {
                    threads.push(entry.th32ThreadID);
                }
                more = Thread32Next(snapshot, &mut entry);
            }
            CloseHandle(snapshot);
            if threads.len() != 1 {
                CloseHandle(handle);
                bail!("Expected one suspended initial child thread");
            }
            let thread = OpenThread(THREAD_SUSPEND_RESUME, 0, threads[0]);
            if thread.is_null() {
                CloseHandle(handle);
                bail!("Could not open suspended child thread");
            }
            let resumed = ResumeThread(thread);
            CloseHandle(thread);
            if resumed == u32::MAX || resumed != 1 {
                CloseHandle(handle);
                bail!("Could not resume contained child process");
            }
            Ok(Self(handle))
        }
    }
    fn terminate(&self) -> Result<()> {
        if unsafe { windows_sys::Win32::System::JobObjects::TerminateJobObject(self.0, 1) } == 0 {
            bail!("Could not stop Windows process job");
        }
        Ok(())
    }
}
#[cfg(windows)]
impl Drop for WindowsJob {
    fn drop(&mut self) {
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(self.0);
        }
    }
}
