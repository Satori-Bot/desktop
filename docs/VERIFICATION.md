# Verification record

Reviewed on October 6, 2026. This is a dated evidence record for [Draft PR #1](https://github.com/coding-tools-mcp/desktop/pull/1), not a release certification. Check the PR's current-head checks after later edits; a prior green run does not validate a new revision.

## Automated coverage

- **Rust manager:** 58 active tests on Unix: 11 unit/admission, 10 lifecycle, 22 persistence/install/tunnel, 7 ownership and 8 supervisor tests. The external-core acceptance entry and private subprocess fixture are intentionally ignored in the default invocation. Windows runs the platform-applicable subset.
- **Frontend:** 51 rendered React/IPC tests, strict TypeScript, formatting and production Vite build. Tests cover interrupted forms, destructive-target confirmation, single-flight polling, stale results/copy cancellation, log rotation/truncation, OAuth reauthorization guidance and operation feedback. The core-version card explicitly labels the separate permission mode in both languages; it does not present “Safe” as a version-security assessment.
- **Browser:** 14 Playwright flows, including light/dark and narrow layouts, onboarding, settings, connection/activity/diagnostics, tunnel failure, and visible success/error feedback after scrolling long settings. Mocked IPC screenshots are visibly labeled and are not native service evidence.
- **Python boundary:** 6 compatibility-launcher/fixture tests, Ruff, wheel/source-distribution builds and Twine validation. Packaging retains `mcp_desktop_client` and `coding-tools-mcp-desktop`; no Python core or Qt management implementation is bundled.
- **Native smoke harness:** local self-tests cover owned-process cleanup, private fixture handling and bounded diagnostic history. CI runs the actual Linux Tauri binary with WebKitGTK, not a mocked frontend or a development-server page.
- **Dependencies:** Rust formatting/Clippy with warnings denied, Windows GNU cross-target Clippy, and the actual Linux Tauri CLI build pass locally on the supported Rust 1.88.0 minimum. The patched lock audit has zero vulnerability-class findings and seven visible upstream informational warnings. See [dependency review](DEPENDENCIES.md); this is not a claim of zero security risk.

The render-heavy jsdom files are scheduled serially to avoid Windows CI CPU contention. The existing five-second per-test watchdog and all assertions remain enabled.

## Exact hosted evidence

At [`ec7a931`](https://github.com/coding-tools-mcp/desktop/commit/ec7a931a1caffaa7ed1734aefe7a0ebd5aaa3d99), [CI run 37446310642](https://github.com/coding-tools-mcp/desktop/actions/runs/37446310642) passed 10 of 11 jobs:

- macOS and Windows manager/runtime checks and actual native Tauri CLI builds passed. macOS additionally passed all 10 lifecycle flows through the native executable's private supervision entry.
- All six official-core acceptance jobs passed, covering both fixtures below on Linux, macOS and Windows.
- Browser 14/14 and compatibility packaging passed. Nine authentic browser screenshots, including the four desktop/narrow feedback cases, were visually inspected.
- Linux manager/build/native-entry checks passed; its real WebKit UI smoke failed at a **false-negative Saved feedback predicate**, before the core-start stage. The diagnostic evidence and retained acceptance gates are described below. This run is not an overall CI pass.

The same head passed [all three unsigned native bundle builds](https://github.com/coding-tools-mcp/desktop/actions/runs/37446310733): Linux **x86_64**, macOS **aarch64**, and Windows **x64**. No macOS Intel or Windows ARM installer coverage is implied. The Linux Debian package was downloaded, its artifact digest verified, and its executable architecture plus exact LICENSE/NOTICE bytes checked. macOS DMG and Windows MSI/NSIS are review artifacts, not an installer-execution claim. No signing, release or package publication occurred.

## Unchanged external-core integration

Both local and hosted tests use these exact fixtures:

1. Published `coding-tools-mcp==0.5.0`: initialize, tools/list, successful and failed read_file calls, explicit unsupported-history detection, restart, and confirmed stop/port release.
2. Unchanged official commit [`d7c2dda48bcedbd066c7dbc24a1b63205384d269`](https://github.com/xyTom/coding-tools-mcp/commit/d7c2dda48bcedbd066c7dbc24a1b63205384d269): the same protocol flow, actual journal entries/outcomes/durations, restart/history retention and diagnostics.

The workspace path contains Unicode characters and spaces. Version strings alone cannot distinguish these two core builds; capability detection uses the newly initialized journal. The desktop does not silently replace the selected published release with a Git build.

All launched core processes and integration tests set the documented `CODING_TOOLS_MCP_TELEMETRY=off` and `DO_NOT_TRACK=1` controls. No external core source was modified. Published 0.5.0 lacks structured tool events, so turnkey history still requires a future event-capable core release or an explicitly selected existing official executable.

The local HTTP fixture avoids reverse DNS. The unmodified Python core remains separately exercised on all three OS runners; macOS has a 60-second readiness budget for the documented CPython resolver startup delay (actions/setup-python#1223), with readiness still required for success.

## Native Linux UI acceptance

The harness uses the official `tauri-driver`, WebKitWebDriver, Selenium, Xvfb and a private D-Bus session. It isolates HOME/workspace, verifies the real IPC bridge and embedded frontend assets, and requires these real interactions:

1. Create the synthetic local workspace through onboarding.
2. Select the exact official core executable; require a viewport-visible Saved notice and persistence across leaving/reopening Settings.
3. Start the service and observe readiness through the UI.
4. Copy the connection config, require a viewport-visible Copied notice, then read the real private-Xvfb clipboard and compare its noauth JSON to the displayed loopback endpoint.
5. Make independent MCP initialize/list/read_file success and failure calls, then verify actual history outcomes and durations in the UI.
6. Stop the service and prove port release; confirm quit and prove the owned native application exited.

`ec7a931` diagnostic screenshots visibly show Saved at viewport `(844, 16)`, size `420 × 55`. Bounded DOM history records the correctly rendered fixed notice from 5.129 to 11.618 seconds, matching the embedded frontend asset; the click returned in 0.066 seconds. Therefore that failure was in the old Selenium `is_displayed()`/text predicate, not evidence that the application omitted the notice. Run [`11f7606`](https://github.com/coding-tools-mcp/desktop/actions/runs/37447644308) then proved visible Saved and runtime persistence, and its native screenshot showed the actual core running/READY after MCP initialize. Its diagnostic isolated the discrepancy: Selenium `is_displayed()` was true while `WebElement.text` returned an empty string. The remaining readiness text read hit the same issue. The harness uses read-only live `innerText` plus visibility/geometry checks and preserves the real persistence, clipboard and protocol gates. A subsequent native run must still establish the complete flow; these partial runs do not count as history/clipboard/stop/quit acceptance.

Earlier harness issues were corrected without relaxing product behavior: same-host executable paths use Selenium's `UselessFileDetector` rather than a remote file-upload request, and Xvfb wraps D-Bus so activated desktop services inherit DISPLAY. An actual offscreen-feedback UX issue was fixed with a viewport-anchored, dismissible notice. Explicit safe-area CSS fallbacks have a browser regression; they are not claimed as the cause of the later native predicate mismatch.

Native artifacts contain synthetic-fixture screenshots and bounded redacted diagnostics only, not raw configuration, credentials, environment dumps or tool payloads. Cleanup tracks owned PIDs with their kernel birth identity before reparenting, preserves the primary failure, and separately records process exit, port release and temporary-data removal. All three cleanup checks passed on `ec7a931`.

## Lifecycle/recovery review

Independent regressions cover root-exit cleanup (including unobserved ordinary children), migrated public/noauth rejection, crashed-workspace tunnel cleanup, credential-header redaction, busy-tunnel activity and responsive snapshots during slow rollback probes.

Unix tests verify abrupt desktop death, exact liveness-pipe non-inheritance, unrelated-pipe preservation, deliberate control-endpoint leakage as a negative control, independent instances, resistant descendants, supervisor death, exit codes and real resource metrics. The environment test compares the exact map against a raw-command baseline using the same helper/runtime, plus an isolated ambient-canary/HOME removal test; it does not guess a macOS allowlist. Ten earlier serial repeats of the 15 lifecycle/supervision cases passed locally.

Shutdown closes admission before enumerating services and preserves ownership on cleanup failures. Persistence/install/tunnel cases cover stale deletion/case aliases, failed writes and migrations, verify-before-switch/rollback, exact version validation, missing selected executables, tunnel retry identity, DNS validation and isolation from ambient Cloudflare configuration.

This is process lifecycle management, not a security sandbox. Deliberately detached unobserved Unix descendants and simultaneous SIGKILL of both desktop and supervisor remain outside the guarantee; see [architecture](ARCHITECTURE.md).

## Remaining acceptance gates

- Require terminal current-head CI and visually inspect its authentic native screenshots before calling the full automated native flow verified.
- Run the unsigned installer, native folder picker, tray hide/restore and first-run smoke on the intended OS. Build success and headless runtime tests do not substitute for interactive macOS/Windows acceptance.
- Interactive managed-core install/rollback across all three operating systems is not yet verified; boundary and concurrency tests use local fixtures.
- No live Cloudflare login, certificate grant, tunnel, DNS route or token was exercised. Live validation needs an explicitly approved account/route; local cloudflared fixtures test failure and recovery safely.
- This cloud host cannot launch local Chromium (`socket() EPERM`) or supply WebKit's compiled-in system-helper path. Hosted browser/native evidence above is genuine; local screenshots were not invented or substituted.
