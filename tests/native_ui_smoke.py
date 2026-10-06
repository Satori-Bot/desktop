"""Linux native-webview acceptance against the unchanged official event-capable core.

Prerequisites (installed by CI, not by this script):
  python -m pip install selenium==4.50.0 \
    'git+https://github.com/xyTom/coding-tools-mcp.git@d7c2dda48bcedbd066c7dbc24a1b63205384d269'
  cargo install tauri-driver --version 2.0.6 --locked
  apt packages: webkit2gtk-driver xvfb dbus-x11 xclip and normal Tauri prerequisites

Run after `npm run tauri build -- --debug --no-bundle -- --locked`:
  xvfb-run -a dbus-run-session -- python tests/native_ui_smoke.py \
    --binary target/debug/coding-tools-mcp-desktop-native \
    --core "$(command -v coding-tools-mcp)" --artifacts artifacts/native-ui

Xvfb wraps dbus-run-session so activated GTK portal services inherit DISPLAY.
All app mutations use visible controls and real Tauri IPC. No invoke mocks,
production instrumentation, or sandbox-disabling flags are used. The folder
path is typed: OS file-picker dialogs, tray menus, installers, and non-Linux
runtimes are explicitly outside this smoke test's coverage.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import os
import re
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from contextlib import suppress
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import ProxyHandler, Request, build_opener

OFFICIAL_COMMIT = "d7c2dda48bcedbd066c7dbc24a1b63205384d269"
FIXTURE_TEXT = "Native desktop acceptance: synthetic workspace content.\n"
WORKSPACE_NAME = "Native UI acceptance"
HTTP = build_opener(ProxyHandler({}))


def wait_until(predicate, timeout: float, label: str):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        result = predicate()
        if result:
            return result
        time.sleep(0.15)
    raise AssertionError(f"Timed out waiting for {label}")


def loopback_endpoint(value: str) -> tuple[str, int]:
    url = urlsplit(value.strip())
    if (
        url.scheme != "http"
        or url.hostname != "127.0.0.1"
        or not url.port
        or url.path != "/mcp"
        or url.username
        or url.password
        or url.query
        or url.fragment
    ):
        raise AssertionError("Native UI did not expose a plain loopback MCP endpoint")
    return value.strip(), url.port


def rpc_payload(text: str, request_id: int) -> dict:
    """Accept either JSON or standard SSE data frames without fabricating results."""
    try:
        candidates = [json.loads(text)]
    except json.JSONDecodeError:
        candidates = []
        for event in re.split(r"\r?\n\r?\n", text):
            lines = [
                line[5:].lstrip()
                for line in event.splitlines()
                if line.startswith("data:")
            ]
            if lines:
                try:
                    candidates.append(json.loads("\n".join(lines)))
                except json.JSONDecodeError:
                    continue
    for value in candidates:
        if isinstance(value, dict) and value.get("id") == request_id:
            if "error" in value:
                raise AssertionError(
                    f"MCP request {request_id} returned a protocol error"
                )
            return value
    raise AssertionError(f"No MCP response matched request {request_id}")


def verify_clipboard_config(text: str, endpoint: str) -> None:
    """Validate only this smoke's local/noauth client config; never log clipboard data."""
    loopback_endpoint(endpoint)
    try:
        value = json.loads(text)
    except json.JSONDecodeError as error:
        raise AssertionError(
            "Native clipboard did not contain MCP configuration JSON"
        ) from error
    expected = {"mcpServers": {WORKSPACE_NAME: {"url": endpoint}}}
    if value != expected:
        raise AssertionError(
            "Native clipboard did not match the test-created local/noauth configuration"
        )


class McpClient:
    def __init__(self, endpoint: str):
        self.endpoint, _ = loopback_endpoint(endpoint)
        self.session = None

    def call(self, request_id: int, method: str, params: dict) -> dict:
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            "MCP-Protocol-Version": "2025-11-25",
        }
        if self.session:
            headers["Mcp-Session-Id"] = self.session
        request = Request(
            self.endpoint,
            method="POST",
            headers=headers,
            data=json.dumps(
                {"jsonrpc": "2.0", "id": request_id, "method": method, "params": params}
            ).encode(),
        )
        with HTTP.open(request, timeout=15) as response:
            self.session = response.headers.get("Mcp-Session-Id") or self.session
            return rpc_payload(
                response.read(2 * 1024 * 1024).decode("utf-8"), request_id
            )


def port_closed(port: int) -> bool:
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.3):
            return False
    except OSError:
        return True


def process_record(pid: int):
    try:
        # comm may contain spaces/parentheses; fields after the last ')' are stable.
        fields = Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()
        return {
            "pid": pid,
            "state": fields[0],
            "parent": int(fields[1]),
            "birth": fields[19],
        }
    except (OSError, ValueError, IndexError):
        return None


def descendant_records(*root_pids: int) -> list[dict]:
    """Read identities only; callers retain descendants before they can be reparented."""
    records = {}
    for entry in Path("/proc").iterdir():
        if entry.name.isdigit():
            record = process_record(int(entry.name))
            if record:
                records[record["pid"]] = record
    queue = list(root_pids)
    visited = set()
    descendants = []
    while queue:
        parent = queue.pop(0)
        if parent in visited:
            continue
        visited.add(parent)
        for record in records.values():
            if record["parent"] == parent:
                descendants.append(record)
                queue.append(record["pid"])
    return descendants


def owned_app(driver_pid: int, binary: Path):
    for record in descendant_records(driver_pid):
        try:
            if Path(f"/proc/{record['pid']}/exe").resolve() == binary.resolve():
                return (
                    record  # Breadth-first chooses the GUI before supervisor children.
                )
        except OSError:
            continue
    return None


def exited(record: dict) -> bool:
    current = process_record(record["pid"])
    return not current or current["birth"] != record["birth"] or current["state"] == "Z"


def cleanup_owned_processes(records: list[dict]) -> bool:
    """Only signal previously observed descendants whose birth identity still matches."""
    for timeout, action in [(1.0, None), (3.0, signal.SIGTERM), (3.0, signal.SIGKILL)]:
        if action is not None:
            for record in records:
                if not exited(record):
                    with suppress(ProcessLookupError):
                        os.kill(record["pid"], action)
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if all(exited(record) for record in records):
                return True
            time.sleep(0.1)
    return all(exited(record) for record in records)


def remove_owned_temp(root: Path, timeout: float = 5) -> bool:
    """Retry a late native cache write without replacing the primary test failure."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            shutil.rmtree(root)
            return True
        except FileNotFoundError:
            return True
        except OSError:
            time.sleep(0.1)
    return not root.exists()


def retain_feedback(evidence: dict, stage: str, observed: list, elapsed: float) -> None:
    """Retain distinct, bounded DOM observations instead of erasing expired feedback."""
    evidence.setdefault("ui_feedback", {})[stage] = observed
    history = evidence.setdefault("ui_feedback_history", {}).setdefault(stage, [])
    if history and history[-1]["items"] == observed:
        return
    entry = {"elapsed_seconds": round(elapsed, 3), "items": observed}
    if len(history) < 16:
        history.append(entry)
    else:
        history[-1] = entry
        evidence["ui_feedback_history_clipped"] = True


def matches_visible_notice(observed: list, text: str) -> bool:
    """Require current rendered text, viewport containment, and unobscured painting."""
    return any(
        item.get("role") == "status"
        and item.get("renderedText", "").strip() == text
        and item.get("inViewport") is True
        and item.get("painted") is True
        and item.get("unobscured") is True
        for item in observed
    )


def sha256(path: Path) -> str:
    result = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(chunk)
    return result.hexdigest()


def redact_diagnostic(text: str) -> str:
    text = re.sub(r"(?i)(authorization\s*:\s*bearer\s+)\S+", r"\1[REDACTED]", text)
    text = re.sub(
        r"(?i)((?:token|password|secret|credential)\s*[=:]\s*)[^\s,;]+",
        r"\1[REDACTED]",
        text,
    )
    return re.sub(r"(?i)([?&](?:token|password|key)=)[^&\s]+", r"\1[REDACTED]", text)


def save_driver_tail(source: Path, destination: Path) -> None:
    with source.open("rb") as stream:
        stream.seek(0, os.SEEK_END)
        stream.seek(max(0, stream.tell() - 65536))
        data = stream.read(65536).decode("utf-8", errors="replace")
    destination.write_text(redact_diagnostic(data))


def verify_core_source() -> str:
    distribution = importlib.metadata.distribution("coding-tools-mcp")
    direct_url = json.loads(distribution.read_text("direct_url.json") or "{}")
    commit = direct_url.get("vcs_info", {}).get("commit_id")
    if commit != OFFICIAL_COMMIT:
        raise AssertionError(
            "Install the exact unchanged official event-capable core in this Python environment"
        )
    return commit


def run(args) -> None:
    if sys.platform != "linux":
        raise SystemExit("This smoke test supports native Linux WebKit only.")
    if not os.environ.get("DISPLAY"):
        raise SystemExit(
            "Run under xvfb-run (and dbus-run-session) so the native app has a display."
        )
    binary = Path(args.binary).absolute()
    core = Path(args.core).absolute()  # Preserve venv launcher symlink spelling.
    tauri_driver = shutil.which(args.tauri_driver)
    native_driver = shutil.which("WebKitWebDriver")
    clipboard_reader = shutil.which("xclip")
    for executable in [binary, core]:
        if not executable.is_file() or not os.access(executable, os.X_OK):
            raise SystemExit(f"Required executable is unavailable: {executable}")
    if not tauri_driver or not native_driver:
        raise SystemExit("Install tauri-driver==2.0.6 and the distro WebKitWebDriver.")
    if not clipboard_reader:
        raise SystemExit("Install xclip for the isolated native clipboard check.")
    installed_commit = verify_core_source()
    # Imported only in the native path so --self-test/--help need no Selenium install.
    from selenium import webdriver
    from selenium.common.exceptions import (
        NoSuchElementException,
        StaleElementReferenceException,
        WebDriverException,
    )
    from selenium.webdriver.common.by import By
    from selenium.webdriver.common.options import ArgOptions
    from selenium.webdriver.common.proxy import Proxy, ProxyType
    from selenium.webdriver.remote.client_config import ClientConfig
    from selenium.webdriver.remote.file_detector import UselessFileDetector
    from selenium.webdriver.support import expected_conditions as ec
    from selenium.webdriver.support.ui import WebDriverWait
    from urllib3.exceptions import HTTPError as TransportError

    artifacts = Path(args.artifacts).absolute()
    artifacts.mkdir(parents=True, exist_ok=True)
    evidence = {
        "status": "running",
        "engine": "native Tauri / WebKitGTK",
        "ipc": "real",
        "core_commit": installed_commit,
        "binary_sha256": sha256(binary),
        "checks": [],
        "outside_scope": [
            "OS folder picker",
            "tray interactions",
            "installer",
            "Windows/macOS",
        ],
    }
    (artifacts / "summary.json").write_text(json.dumps(evidence, indent=2))
    driver = None
    process = None
    app = None
    endpoint_port = None
    record_feedback = None
    session_started = time.monotonic()
    passed = False
    tracked_processes = {}

    def track_owned_processes():
        roots = []
        if process is not None and process.poll() is None:
            roots.append(process.pid)
        if app is not None and not exited(app):
            roots.append(app["pid"])
        for record in descendant_records(*roots):
            tracked_processes[(record["pid"], record["birth"])] = record
        if app is not None:
            tracked_processes[(app["pid"], app["birth"])] = app

    # Cleanup errors are recorded and fail an otherwise successful smoke below.
    # The context manager must never mask an existing UI/protocol failure.
    with tempfile.TemporaryDirectory(
        prefix="desktop-native-ui-", ignore_cleanup_errors=True
    ) as temporary:
        root = Path(temporary)
        home, workspace = root / "home", root / "workspace"
        home.mkdir(mode=0o700)
        workspace.mkdir(mode=0o700)
        (workspace / "hello.txt").write_text(FIXTURE_TEXT)
        env = os.environ.copy()
        env.update(
            {
                "HOME": str(home),
                "GDK_BACKEND": "x11",
                "CODING_TOOLS_MCP_TELEMETRY": "off",
                "DO_NOT_TRACK": "1",
                "NO_PROXY": "127.0.0.1,localhost",
                "no_proxy": "127.0.0.1,localhost",
            }
        )
        for name in [
            "XDG_CONFIG_HOME",
            "XDG_CACHE_HOME",
            "XDG_DATA_HOME",
            "XDG_STATE_HOME",
            "XDG_RUNTIME_DIR",
        ]:
            path = root / name.lower()
            path.mkdir(mode=0o700)
            env[name] = str(path)
        raw_log = root / "driver.raw.log"
        log = raw_log.open("wb")
        try:
            process = subprocess.Popen(
                [
                    tauri_driver,
                    "--port",
                    str(args.port),
                    "--native-port",
                    str(args.port + 1),
                    "--native-driver",
                    native_driver,
                ],
                env=env,
                stdout=log,
                stderr=subprocess.STDOUT,
                start_new_session=True,
            )

            def ready():
                if process.poll() is not None:
                    raise AssertionError(
                        "tauri-driver exited before session creation; inspect its log"
                    )
                try:
                    with HTTP.open(
                        f"http://127.0.0.1:{args.port}/status", timeout=1
                    ) as response:
                        return response.status == 200
                except OSError:
                    return False

            wait_until(ready, 30, "tauri-driver readiness")
            options = ArgOptions()
            options.set_capability("browserName", "wry")
            options.set_capability("tauri:options", {"application": str(binary)})
            server = f"http://127.0.0.1:{args.port}"
            direct = Proxy()
            direct.proxy_type = ProxyType.DIRECT
            client_config = ClientConfig(
                remote_server_addr=server, timeout=15, proxy=direct
            )
            driver = webdriver.Remote(
                command_executor=server,
                options=options,
                client_config=client_config,
                # Tauri and the client share this host. Existing executable paths
                # are text input, never Selenium Grid file-upload requests.
                file_detector=UselessFileDetector(),
            )
            app = wait_until(
                lambda: owned_app(process.pid, binary), 10, "the launched native PID"
            )
            driver.set_page_load_timeout(30)
            driver.set_script_timeout(10)
            wait = WebDriverWait(
                driver,
                60,
                poll_frequency=0.2,
                ignored_exceptions=(
                    NoSuchElementException,
                    StaleElementReferenceException,
                ),
            )

            def button(text):
                return wait.until(
                    ec.element_to_be_clickable(
                        (By.XPATH, f"//button[normalize-space(.)='{text}']")
                    )
                )

            def input_for_label(label):
                item = wait.until(
                    ec.presence_of_element_located(
                        (
                            By.XPATH,
                            f"//label[starts-with(normalize-space(.), '{label}')]",
                        )
                    )
                )
                return driver.find_element(By.ID, item.get_attribute("for"))

            def record_feedback(stage):
                observed = driver.execute_script("""
                    return Array.from(document.querySelectorAll('[role="status"], [role="alert"]'))
                      .slice(0, 8).map(el => {
                        const r = el.getBoundingClientRect();
                        const message = el.querySelector('.mantine-Alert-message') || el;
                        const messageRect = message.getBoundingClientRect();
                        const style = getComputedStyle(el);
                        const region = el.closest('.operation-feedback');
                        const regionStyle = region ? getComputedStyle(region) : null;
                        const regionRect = region ? region.getBoundingClientRect() : null;
                        let painted = message.getClientRects().length > 0 &&
                          messageRect.width > 0 && messageRect.height > 0;
                        for (let ancestor = message; ancestor; ancestor = ancestor.parentElement) {
                          const ancestorStyle = getComputedStyle(ancestor);
                          if (ancestorStyle.display === 'none' ||
                              ancestorStyle.visibility !== 'visible' ||
                              Number(ancestorStyle.opacity) === 0) painted = false;
                        }
                        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
                        const messageHit = document.elementFromPoint(
                          messageRect.x + messageRect.width / 2, messageRect.y + messageRect.height / 2);
                        return {role: el.getAttribute('role'), text: (el.textContent || '').slice(0, 1200),
                          renderedText: (message.innerText || '').slice(0, 1200),
                          painted, unobscured: hit !== null && el.contains(hit) &&
                            messageHit !== null && message.contains(messageHit),
                          rect: {x: r.x, y: r.y, width: r.width, height: r.height},
                          messageRect: {x: messageRect.x, y: messageRect.y,
                            width: messageRect.width, height: messageRect.height},
                          display: style.display, visibility: style.visibility,
                          regionTop: regionStyle ? regionStyle.top : null,
                          regionRight: regionStyle ? regionStyle.right : null,
                          regionPosition: regionStyle ? regionStyle.position : null,
                          regionRect: regionRect ? {x: regionRect.x, y: regionRect.y,
                            width: regionRect.width, height: regionRect.height} : null,
                          inViewport: r.width > 0 && r.height > 0 && r.top >= 0 && r.left >= 0 &&
                            r.bottom <= innerHeight && r.right <= innerWidth &&
                            messageRect.top >= 0 && messageRect.left >= 0 &&
                            messageRect.bottom <= innerHeight && messageRect.right <= innerWidth};
                      });
                """)
                safe_observed = [
                    {
                        **item,
                        "text": redact_diagnostic(item["text"]),
                        "renderedText": redact_diagnostic(item["renderedText"]),
                    }
                    for item in observed
                ]
                retain_feedback(
                    evidence, stage, safe_observed, time.monotonic() - session_started
                )
                return observed

            def visible_notice(text, stage):
                captured = False

                def found(_browser):
                    nonlocal captured
                    observed = record_feedback(stage)
                    if not captured and any(
                        item["role"] == "status" and text in item["text"]
                        for item in observed
                    ):
                        capture(f"native-{stage}-first-notice")
                        captured = True
                        legacy = []
                        try:
                            for item in driver.find_elements(
                                By.CSS_SELECTOR, '[role="status"]'
                            )[:3]:
                                legacy.append(
                                    {
                                        "is_displayed": item.is_displayed(),
                                        "text": redact_diagnostic(item.text[:1200]),
                                    }
                                )
                        except (WebDriverException, OSError, TransportError) as error:
                            legacy.append({"error_type": type(error).__name__})
                        evidence.setdefault("selenium_notice_diagnostics", {})[
                            stage
                        ] = legacy
                        observed = record_feedback(stage)
                    # Native screenshots and DOM measurements exposed a false-negative
                    # in the legacy WebKitWebDriver display/text gate. Require live
                    # rendering and hit testing; hidden/covered/offscreen text cannot pass.
                    return matches_visible_notice(observed, text)

                return wait.until(
                    found,
                    message=f"Expected viewport-visible {text} feedback for {stage}",
                )

            def fill(label, value):
                control = input_for_label(label)
                control.clear()
                control.send_keys(value)

            def text_present(text):
                return wait.until(
                    lambda browser: (
                        text in browser.find_element(By.TAG_NAME, "body").text
                    )
                )

            def capture(name):
                track_owned_processes()
                # DOM readiness can precede WebKit's composited pixels. Wait for
                # local fonts and two painted frames without changing the UI.
                driver.execute_async_script("""
                    const done = arguments[arguments.length - 1];
                    const ready = document.fonts ? document.fonts.ready : Promise.resolve();
                    ready.then(() => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done, 100))));
                """)
                path = artifacts / f"{name}.png"
                if not driver.save_screenshot(str(path)) or not path.is_file():
                    raise AssertionError(f"Native screenshot capture failed: {name}")

            button("Create your first workspace")
            if not driver.execute_script(
                "return !!window.__TAURI_INTERNALS__ && !window.__TEST_FIXTURE__"
            ):
                raise AssertionError(
                    "Expected the real native Tauri bridge without test mocks"
                )
            if "127.0.0.1:1420" in driver.current_url:
                raise AssertionError(
                    "The native acceptance binary must embed its built frontend"
                )
            evidence["frontend_assets"] = driver.execute_script("""
                return Array.from(document.scripts).filter(el => el.src).slice(0, 8)
                  .map(el => new URL(el.src).pathname);
            """)
            capture("native-onboarding")
            button("Create your first workspace").click()
            fill("Workspace name", WORKSPACE_NAME)
            fill("Folder path", str(workspace))
            button("Continue").click()
            text_present("Start local. Share when you are ready.")
            button("Continue").click()
            button("Create workspace").click()
            wait.until(
                ec.invisibility_of_element_located((By.CSS_SELECTOR, '[role="dialog"]'))
            )
            text_present(WORKSPACE_NAME)
            evidence["checks"].append(
                "native onboarding created the synthetic local workspace"
            )
            button("Settings").click()
            fill("Executable path", str(core))
            save_runtime = button("Save runtime selection")
            record_feedback("save-runtime")
            clicked_at = time.monotonic()
            save_runtime.click()
            evidence["save_runtime_click_seconds"] = round(
                time.monotonic() - clicked_at, 3
            )
            record_feedback("save-runtime")
            capture("native-runtime-after-click")
            visible_notice("Saved", "save-runtime")
            wait.until(
                lambda browser: (
                    input_for_label("Executable path").is_enabled()
                    and not browser.find_element(
                        By.XPATH,
                        "//button[normalize-space(.)='Save runtime selection']",
                    ).is_enabled()
                )
            )
            capture("native-runtime-saved")
            button("Dashboard").click()
            button("Settings").click()
            wait.until(
                lambda _browser: (
                    input_for_label("Executable path").get_attribute("value")
                    == str(core)
                )
            )
            evidence["checks"].append(
                "runtime selection persisted across UI navigation with viewport-visible Saved feedback"
            )
            button("Dashboard").click()
            button("Start workspace").click()
            button("Stop workspace")
            wait.until(
                lambda browser: (
                    "READY"
                    in browser.find_element(By.CSS_SELECTOR, ".local-card").text.upper()
                )
            )
            endpoint = driver.find_element(
                By.CSS_SELECTOR, ".local-card .endpoint-url"
            ).text
            endpoint, endpoint_port = loopback_endpoint(endpoint)
            evidence["checks"].append(
                "real onboarding, configuration persistence, native start, local readiness"
            )
            capture("native-running")

            button("Connections").click()
            local_copy = wait.until(
                ec.element_to_be_clickable(
                    (
                        By.XPATH,
                        "//*[contains(concat(' ', normalize-space(@class), ' '), ' local-card ')]/..//button[normalize-space(.)='Copy config']",
                    )
                )
            )
            local_copy.click()
            # Read only after this test's explicit copy succeeds, inside its private Xvfb display.
            # No clipboard stubs, browser permission grants, or direct clipboard writes are used.
            visible_notice("Copied", "copy-config")
            copied = subprocess.run(
                [clipboard_reader, "-o", "-selection", "clipboard"],
                check=True,
                capture_output=True,
                timeout=5,
                env=env,
            )
            if len(copied.stdout) > 65536:
                raise AssertionError(
                    "Test-created clipboard configuration exceeded its size bound"
                )
            verify_clipboard_config(copied.stdout.decode("utf-8"), endpoint)
            evidence["checks"].append(
                "real native Copy config produced the expected local/noauth JSON in X11 clipboard"
            )
            capture("native-connections")

            client = McpClient(endpoint)
            init = client.call(
                1,
                "initialize",
                {
                    "protocolVersion": "2025-11-25",
                    "capabilities": {},
                    "clientInfo": {
                        "name": "desktop-native-ui-acceptance",
                        "version": "1",
                    },
                },
            )
            assert init["result"]["serverInfo"]["name"] == "coding-tools-mcp"
            tools = client.call(2, "tools/list", {})
            assert any(tool["name"] == "read_file" for tool in tools["result"]["tools"])
            ok = client.call(
                3,
                "tools/call",
                {"name": "read_file", "arguments": {"path": "hello.txt"}},
            )
            assert ok["result"].get(
                "isError"
            ) is not True and FIXTURE_TEXT.strip() in json.dumps(ok)
            failed = client.call(
                4,
                "tools/call",
                {"name": "read_file", "arguments": {"path": "missing-file.txt"}},
            )
            assert failed["result"].get("isError") is True
            evidence["checks"].append(
                "independent initialize, tools/list, successful and failed real read_file"
            )
            button("Activity").click()

            def real_calls(browser):
                rows = [
                    row.text
                    for row in browser.find_elements(
                        By.CSS_SELECTOR, ".call-row:not(.call-header)"
                    )
                ]
                return (
                    any("read_file" in row and "SUCCESS" in row.upper() for row in rows)
                    and any(
                        "read_file" in row and "FAILED" in row.upper() for row in rows
                    )
                    and sum(
                        bool(re.search(r"\d+(?:\.\d+)?\s*(?:ms|s)\b", row))
                        for row in rows
                    )
                    >= 2
                )

            wait.until(real_calls)
            capture("native-real-activity")
            evidence["checks"].append(
                "real per-tool success/error history and durations visible through native IPC"
            )
            button("Stop workspace").click()
            button("Start workspace")
            wait.until(
                lambda browser: (
                    "STOPPED"
                    in browser.find_element(
                        By.CSS_SELECTOR, ".workspace-kicker"
                    ).text.upper()
                )
            )
            wait_until(
                lambda: port_closed(endpoint_port),
                15,
                "owned MCP port release after Stop",
            )
            capture("native-stopped")
            evidence["checks"].append(
                "UI Stop confirmed with independent closed-port check"
            )
            button("Settings").click()
            button("Quit application").click()
            checkbox_label = wait.until(
                ec.element_to_be_clickable(
                    (By.XPATH, "//label[normalize-space(.)='Quit and stop services?']")
                )
            )
            checkbox_label.click()
            checkbox = driver.find_element(By.ID, checkbox_label.get_attribute("for"))
            assert checkbox.is_selected()
            track_owned_processes()
            try:
                button("Quit").click()
            except WebDriverException:
                # Closing the real app may terminate the WebDriver response mid-click.
                pass
            wait_until(lambda: exited(app), 15, "native app exit after explicit Quit")
            assert port_closed(endpoint_port)
            evidence["checks"].append(
                "explicit UI Quit exited the owned native app and left MCP stopped"
            )
            evidence["status"] = "passed"
            passed = True
        except BaseException as error:
            evidence["status"] = "failed"
            evidence["failure"] = redact_diagnostic(f"{type(error).__name__}: {error}")[
                :8000
            ]
            if driver is not None:
                if record_feedback is not None:
                    with suppress(WebDriverException, OSError, TransportError):
                        record_feedback("failure")
                with suppress(WebDriverException, OSError, TransportError):
                    driver.save_screenshot(str(artifacts / "native-failure.png"))
            raise
        finally:
            # Leave enough time for bounded cleanup after the overall alarm fires.
            signal.alarm(45)
            track_owned_processes()
            if driver is not None:
                with suppress(WebDriverException, OSError, TransportError):
                    driver.quit()
            if app is None and process is not None:
                app = owned_app(process.pid, binary)
            if app and not exited(app):
                with suppress(ProcessLookupError):
                    os.kill(app["pid"], signal.SIGTERM)
                try:
                    wait_until(lambda: exited(app), 5, "test-owned app cleanup")
                except AssertionError:
                    if not exited(app):
                        with suppress(ProcessLookupError):
                            os.kill(app["pid"], signal.SIGKILL)
            if process is not None and process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
            evidence["cleanup_processes_exited"] = cleanup_owned_processes(
                list(tracked_processes.values())
            )
            log.close()
            save_driver_tail(raw_log, artifacts / "tauri-driver.log")
            evidence["cleanup_port_closed"] = endpoint_port is None or port_closed(
                endpoint_port
            )
            evidence["cleanup_temp_removed"] = remove_owned_temp(root)
            cleanup_ok = all(
                evidence[key]
                for key in [
                    "cleanup_processes_exited",
                    "cleanup_port_closed",
                    "cleanup_temp_removed",
                ]
            )
            if passed and not cleanup_ok:
                evidence["status"] = "failed"
                evidence["failure"] = (
                    "Test-owned native processes, MCP port, or temporary profile did not cleanly shut down"
                )
            (artifacts / "summary.json").write_text(
                json.dumps(evidence, indent=2) + "\n"
            )
            if passed and not cleanup_ok:
                raise AssertionError(evidence["failure"])
    print(
        json.dumps(
            {
                "status": "passed",
                "checks": evidence["checks"],
                "artifacts": str(artifacts),
            },
            indent=2,
        )
    )


class ProtocolHelpersTest(unittest.TestCase):
    def test_notice_requires_rendered_unobscured_viewport_text(self):
        visible = {
            "role": "status",
            "text": "Saved",
            "renderedText": "Saved\n\n",
            "inViewport": True,
            "painted": True,
            "unobscured": True,
        }
        self.assertTrue(matches_visible_notice([visible], "Saved"))
        for reason, changes in {
            "wrong role": {"role": "alert"},
            "DOM-only text": {"renderedText": ""},
            "wrong text": {"renderedText": "Not Saved"},
            "clipped outside viewport": {"inViewport": False},
            "hidden ancestor": {"painted": False},
            "zero-opacity ancestor": {"painted": False},
            "zero-opacity message child": {"painted": False},
            "occluded center": {"unobscured": False},
        }.items():
            with self.subTest(reason=reason):
                self.assertFalse(
                    matches_visible_notice([{**visible, **changes}], "Saved")
                )
        self.assertFalse(matches_visible_notice([], "Saved"))

    def test_feedback_history_keeps_transient_and_is_bounded(self):
        evidence = {}
        retain_feedback(evidence, "save", [], 0)
        retain_feedback(evidence, "save", [{"text": "Saved"}], 1)
        retain_feedback(evidence, "save", [{"text": "Saved"}], 2)
        retain_feedback(evidence, "save", [], 8)
        self.assertEqual(len(evidence["ui_feedback_history"]["save"]), 3)
        self.assertEqual(
            evidence["ui_feedback_history"]["save"][1]["items"], [{"text": "Saved"}]
        )
        for index in range(25):
            retain_feedback(evidence, "save", [{"text": str(index)}], index + 10)
        self.assertEqual(len(evidence["ui_feedback_history"]["save"]), 16)
        self.assertTrue(evidence["ui_feedback_history_clipped"])

    def test_endpoint_scope(self):
        self.assertEqual(loopback_endpoint("http://127.0.0.1:28766/mcp")[1], 28766)
        for value in [
            "https://example.com/mcp",
            "http://localhost:80/mcp",
            "http://x:y@127.0.0.1:80/mcp",
            "http://127.0.0.1:80/mcp?token=x",
        ]:
            with self.assertRaises(AssertionError):
                loopback_endpoint(value)

    def test_json_and_sse(self):
        expected = {"jsonrpc": "2.0", "id": 3, "result": {"ok": True}}
        self.assertEqual(rpc_payload(json.dumps(expected), 3), expected)
        self.assertEqual(
            rpc_payload(f"event: message\ndata: {json.dumps(expected)}\n\n", 3),
            expected,
        )
        with self.assertRaises(AssertionError):
            rpc_payload(json.dumps(expected), 4)
        with self.assertRaises(AssertionError):
            rpc_payload('{"id":3,"error":{"message":"failed"}}', 3)

    def test_clipboard_config(self):
        endpoint = "http://127.0.0.1:28766/mcp"
        verify_clipboard_config(
            json.dumps({"mcpServers": {WORKSPACE_NAME: {"url": endpoint}}}), endpoint
        )
        with self.assertRaises(AssertionError):
            verify_clipboard_config("not JSON", endpoint)
        with self.assertRaises(AssertionError):
            verify_clipboard_config(
                json.dumps(
                    {
                        "mcpServers": {
                            WORKSPACE_NAME: {"url": "https://example.invalid/mcp"}
                        }
                    }
                ),
                endpoint,
            )
        with self.assertRaises(AssertionError):
            verify_clipboard_config(
                json.dumps(
                    {
                        "mcpServers": {
                            WORKSPACE_NAME: {
                                "url": endpoint,
                                "headers": {"Authorization": "unexpected"},
                            }
                        }
                    }
                ),
                endpoint,
            )

    def test_owned_temp_cleanup(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "synthetic-cache").write_text("test data")
            self.assertTrue(remove_owned_temp(root))
            self.assertFalse(root.exists())

    @unittest.skipUnless(sys.platform == "linux", "Linux process identities only")
    def test_owned_descendant_cleanup(self):
        child = subprocess.Popen(
            [sys.executable, "-c", "import sys; sys.stdin.read()"],
            stdin=subprocess.PIPE,
        )
        try:
            record = wait_until(
                lambda: next(
                    (
                        item
                        for item in descendant_records(os.getpid())
                        if item["pid"] == child.pid
                    ),
                    None,
                ),
                3,
                "synthetic child identity",
            )
            # A reused PID must never signal a different process.
            self.assertTrue(
                cleanup_owned_processes([{**record, "birth": "not-this-process"}])
            )
            self.assertIsNone(child.poll())
            self.assertTrue(cleanup_owned_processes([record]))
            child.wait(timeout=3)
        finally:
            if child.stdin is not None:
                child.stdin.close()
            if child.poll() is None:
                child.terminate()
                child.wait(timeout=3)

    def test_diagnostic_redaction(self):
        value = redact_diagnostic(
            "Authorization: Bearer top-secret\npassword=hidden token=hidden https://example.invalid/?key=hidden"
        )
        self.assertNotIn("top-secret", value)
        self.assertNotIn("hidden", value)

    def test_current_process_identity(self):
        record = process_record(os.getpid())
        if sys.platform == "linux":
            self.assertIsNotNone(record)
            self.assertFalse(exited(record))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--self-test",
        action="store_true",
        help="Run pure harness checks without Selenium or GUI dependencies",
    )
    parser.add_argument(
        "--binary", default="target/debug/coding-tools-mcp-desktop-native"
    )
    parser.add_argument(
        "--core", default=shutil.which("coding-tools-mcp") or "coding-tools-mcp"
    )
    parser.add_argument("--tauri-driver", default="tauri-driver")
    parser.add_argument("--port", type=int, default=4444)
    parser.add_argument("--artifacts", default="artifacts/native-ui")
    arguments = parser.parse_args()
    if arguments.self_test:
        unittest.main(argv=[sys.argv[0]])
    else:
        if sys.platform != "linux":
            parser.error("Native UI acceptance currently supports Linux only")
        if not 1 <= arguments.port <= 65534:
            parser.error("--port must leave a valid adjacent port for WebKitWebDriver")

        def alarm_handler(_signal, _frame):
            raise TimeoutError(
                "Native smoke exceeded its bounded execution/cleanup deadline"
            )

        signal.signal(signal.SIGALRM, alarm_handler)
        signal.alarm(240)
        try:
            run(arguments)
        finally:
            signal.alarm(0)
