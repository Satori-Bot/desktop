use desktop_manager::{core, model::*, process::ManagedProcess};
use serde_json::json;
use std::{
    io::{BufRead, BufReader, Read, Write},
    net::TcpListener,
    process::Command,
    thread,
    time::{Duration, Instant},
};

fn python() -> String {
    std::env::var("PYTHON")
        .unwrap_or_else(|_| if cfg!(windows) { "python" } else { "python3" }.into())
}

#[test]
fn direct_process_resources_include_owned_worker_memory() {
    let directory = tempfile::tempdir().unwrap();
    let marker = directory.path().join("worker-ready");
    let worker = format!(
        "import pathlib,time; data=bytearray(48*1024*1024); data[::4096]=b'x'*(len(data)//4096); pathlib.Path({}).write_text('ready'); time.sleep(60)",
        serde_json::to_string(marker.to_str().unwrap()).unwrap()
    );
    let mut command = Command::new(python());
    command.args([
        "-c",
        "import subprocess,sys,time; subprocess.Popen([sys.executable,'-c',sys.argv[1]]); time.sleep(60)",
        &worker,
    ]);
    let mut process = ManagedProcess::spawn(
        &mut command,
        directory.path().join("runtime.log"),
        Secrets::default(),
    )
    .unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    while !marker.exists() && Instant::now() < deadline {
        thread::sleep(Duration::from_millis(20));
    }
    let (_, memory) = process.metrics();
    process.stop().unwrap();
    assert!(marker.exists(), "fixture worker did not allocate memory");
    assert!(
        memory >= 48 * 1024 * 1024,
        "resource totals omitted the owned worker: {memory} bytes"
    );
}

fn probe_fixture(oversized_initialize: bool, advertised: bool) -> anyhow::Result<String> {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    listener.set_nonblocking(true).unwrap();
    let server = thread::spawn(move || {
        let count = if oversized_initialize { 2 } else { 1 };
        for index in 0..count {
            let deadline = Instant::now() + Duration::from_secs(3);
            let mut connection = loop {
                match listener.accept() {
                    Ok((connection, _)) => break connection,
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        if Instant::now() >= deadline {
                            return;
                        }
                        thread::sleep(Duration::from_millis(5));
                    }
                    Err(error) => panic!("fixture accept failed: {error}"),
                }
            };
            connection
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            connection
                .set_write_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            let mut request = BufReader::new(&mut connection);
            let mut length = 0;
            for _ in 0..100 {
                let mut line = String::new();
                request.read_line(&mut line).unwrap();
                if line == "\r\n" {
                    break;
                }
                if let Some((name, value)) = line.split_once(':') {
                    if name.eq_ignore_ascii_case("content-length") {
                        length = value.trim().parse::<u64>().unwrap();
                    }
                }
            }
            let mut body = Vec::new();
            request
                .take(length.min(4096))
                .read_to_end(&mut body)
                .unwrap();
            let mut body = if index == 0 {
                json!({"server":{"name":"coding-tools-mcp","version":"0.5.0"},"transport":{"endpoint":"/mcp"}}).to_string()
            } else {
                json!({"jsonrpc":"2.0","id":1,"result":{"serverInfo":{"name":"coding-tools-mcp","version":"0.5.0"}}}).to_string()
            };
            if !oversized_initialize || index == 1 {
                body.push_str(&" ".repeat(1024 * 1024 + 1));
            }
            let length = if advertised {
                format!("Content-Length: {}\r\n", body.len())
            } else {
                String::new()
            };
            let header = format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\n{length}\r\n");
            let _ = connection.write_all(header.as_bytes());
            // A bounded reader is expected to close before consuming everything.
            let _ = connection.write_all(body.as_bytes());
        }
    });
    let workspace: Workspace =
        serde_json::from_value(json!({"name":"Probe fixture","path":".","port":port})).unwrap();
    let result = core::probe(&workspace, &Secrets::default(), false);
    server.join().unwrap();
    result
}

#[test]
fn discovery_rejects_oversized_advertised_and_streamed_json() {
    for advertised in [true, false] {
        let error = probe_fixture(false, advertised).unwrap_err();
        assert!(error.to_string().contains("maximum"), "{error:#}");
    }
}

#[test]
fn initialize_rejects_oversized_advertised_and_streamed_json() {
    for advertised in [true, false] {
        let error = probe_fixture(true, advertised).unwrap_err();
        assert!(error.to_string().contains("maximum"), "{error:#}");
    }
}
