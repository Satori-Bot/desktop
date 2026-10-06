# Verification record

Reviewed on October 6, 2026. This is a dated evidence record for [Draft PR #1](https://github.com/coding-tools-mcp/desktop/pull/1), not a release certification. Check the PR's current-head checks after later edits; a prior green run does not validate a new revision.

## Automated coverage

- **Rust manager:** 65 active tests on Unix: 12 unit/admission, 11 lifecycle, 22 persistence/install/tunnel, 7 ownership, 8 supervisor and 5 resource/probe/cleanup regressions. The external-core acceptance entry, real managed-install acceptance and private subprocess fixture are intentionally ignored in the default invocation. Windows runs the platform-applicable subset.
- **Frontend:** 77 rendered React/IPC tests, strict TypeScript, formatting and production Vite build. Tests cover interrupted forms, destructive-target confirmation, single-flight polling, stale results/copy cancellation, log rotation/truncation, OAuth reauthorization guidance and operation feedback. The core-version card explicitly labels the separate permission mode in both languages; it does not present “Safe” as a version-security assessment.
- **Browser:** 21 Playwright flows, including light/dark and narrow layouts, onboarding, settings, connection/activity/diagnostics, tunnel failure, visible success/error feedback after scrolling long settings, and both Connections action rows staying above Authentication at desktop/narrow widths. Mocked IPC screenshots are visibly labeled and are not native service evidence.
- **Python boundary:** 6 compatibility-launcher/fixture tests, Ruff, wheel/source-distribution builds and Twine validation. Packaging retains `mcp_desktop_client` and `coding-tools-mcp-desktop`; no Python core or Qt management implementation is bundled.
- **Native smoke harness:** local self-tests cover owned-process cleanup, private fixture handling and bounded diagnostic history. CI runs the actual Linux Tauri binary with WebKitGTK, not a mocked frontend or a development-server page.
- **Dependencies:** Rust formatting/Clippy with warnings denied, Windows GNU cross-target Clippy, and the actual Linux Tauri CLI build pass locally on the supported Rust 1.88.0 minimum. The patched lock audit has zero vulnerability-class findings and seven visible upstream informational warnings. See [dependency review](DEPENDENCIES.md); this is not a claim of zero security risk.

The render-heavy jsdom files are scheduled serially to avoid Windows CI CPU contention. The existing five-second per-test watchdog and all assertions remain enabled.

## Recovery and accessibility refinement (October 6, 2026, evening)

A further independent review found and corrected reproducible gaps, without changing the external Python core:

- Core and tunnel startup transfer process ownership before readiness. A failed start explicitly verifies cleanup and retains its handle if cleanup is still pending. A dedicated negative-control fixture deliberately detaches a short-lived output-pipe holder, proves edits/deletion remain blocked, and proves a later Stop can recover. It does not claim containment of arbitrary detached descendants.
- `cleanupPending` separately represents incomplete cleanup, so a dead PID is not presented as running and Stop remains available. Quit rechecks an unresolved Stop even after the owned handles are gone, and preserves an unrelated listener. Startup failure and crash refresh clear stale public readiness, resource values and uptime.
- Direct/Windows resource totals include owned subprocesses. A real 48 MiB worker fixture previously reported only the parent's approximately 8.7 MiB; the corrected aggregation is covered on every platform.
- Discovery and MCP initialize enforce a 1 MiB response bound before JSON deserialization, covering both declared lengths and streaming responses. All existing protocol and identity checks remain mandatory.
- Interrupted historical calls are distinct from in-progress calls in English and Chinese. Pristine settings/runtime drafts follow saved changes while real edits survive polling; a successful settings save stays applied even when its follow-on status read fails.
- Dismissed creation flows cannot launch follow-on work from a late result. Navigation, call-table cells, dialog close buttons and credential-reveal controls have localized semantics; reveal controls support pointer, Space, Enter and assistive-technology activation, with pressed state preserved.

Local validation on the fresh cloud workspace passed Rust 1.88.0 formatting, Clippy with warnings denied, all **65 manager tests**, **77 frontend tests**, TypeScript, formatting and production build; **6 Python tests**, **10 native-harness self-tests**, Ruff, compatibility distributions and Twine. Focused regressions were first observed failing on the previous implementation. The independently reviewed undrained-pipe and unresolved-port fixtures pass with cleanup/retry verified.

Both exact unchanged official-core acceptance fixtures passed again locally. The opt-in real managed installer also passed again: two independent published 0.5.0 environments, verified exact selections, rollback, genuine offline/no-cache failure preserving configuration, four real MCP cycles and full temporary/process cleanup. No live Cloudflare authorization or route was used.

The first hosted refinement pass also revealed a genuine focus-return gap after closing a conditionally mounted editor. The persistent parent now owns focus return; regressions cover repeated Escape/Cancel/close, confirmation dismissal, successful-save navigation, removed/replaced workspaces and disabled triggers. Existing strict browser focus checks remain enabled and now also exercise confirmation dismissal. Fixture corrections replace a fixed 100 ms crash assumption with accepted-signal and birth-identified exit/state observation, avoid deterministic cross-run test-port reuse, and explicitly set accepted HTTP fixture sockets to blocking mode before bounded reads/writes. Production port-conflict and cleanup behavior is unchanged by these test corrections. Independent lifecycle launch fixtures are serialized to avoid transient shared OS descriptor/port interference; the explicit two-workspace case and dedicated concurrency regressions remain unchanged. A possible fork/exec descriptor-inheritance window is an inference, not an established product defect. With the scoped fixture guard, 20 consecutive normal-runner lifecycle repeats passed (220 test executions); the preceding 25 serial-runner repeats also passed.

All **21 browser cases** are discovered; local Chromium still fails at its denied `socket()` call, and this workspace lacks native GTK/WebKit prerequisites. These local checks are not a native GUI or browser pass. The resulting commit must pass the hosted browser/native matrix and all four unsigned bundle jobs; the exact-head results are linked from [Draft PR #1](https://github.com/coding-tools-mcp/desktop/pull/1). Prior dated hosted runs below remain historical evidence only.

## Exact hosted evidence

At [`575243a`](https://github.com/coding-tools-mcp/desktop/commit/575243a0b449d8a827f0a79036e30ce46843f7ff), [CI run 37448830581](https://github.com/coding-tools-mcp/desktop/actions/runs/37448830581) passed **all 11 jobs**, including the complete real native Linux WebKit/core/clipboard/stop/quit flow:

- Linux/macOS/Windows manager/runtime checks and actual native Tauri CLI builds passed. Unix additionally passed all 10 lifecycle flows through the native executable's private supervision entry.
- All six official-core acceptance jobs passed, covering both fixtures below on Linux, macOS and Windows.
- Browser 14/14 and compatibility packaging passed. Nine authentic browser screenshots were inspected; the core-version card's explicit Mode label is readable in light/dark/narrow layouts.
- Nine authentic native screenshots and the completed summary were inspected. They prove actual local readiness, clipboard connection JSON and success/error tool history. A real Connections layout defect was found despite functional acceptance: sibling action rows escaped a 100%-height card wrapper and overlapped Authentication. The next revision reserves space for those rows and adds native/browser geometry regressions; it must receive its own exact-head result.

The same head passed [all three unsigned native bundle builds](https://github.com/coding-tools-mcp/desktop/actions/runs/37448830698): Linux **x86_64**, macOS **aarch64**, and Windows **x64**. Earlier `ec7a931` Debian/DMG/MSI/NSIS downloads had their artifact digests verified; its Debian executable architecture and exact LICENSE/NOTICE bytes were checked. These are build/archive checks, not installer execution. No signing, release or package publication occurred.

The matrix now also includes **macos-15-intel** for a separate native macOS **x86_64** build, manager/runtime checks and both core fixtures. This is an [official standard public runner](https://docs.github.com/en/actions/reference/runners/github-hosted-runners), preserving the prior Python/PySide desktop's Intel installation path. This new architecture's result is pending until its hosted checks complete; no universal binary or Windows ARM installer coverage is implied.

## Unchanged external-core integration

Both local and hosted tests use these exact fixtures:

1. Published `coding-tools-mcp==0.5.0`: initialize, tools/list, successful and failed read_file calls, explicit unsupported-history detection, restart, and confirmed stop/port release.
2. Unchanged official commit [`d7c2dda48bcedbd066c7dbc24a1b63205384d269`](https://github.com/xyTom/coding-tools-mcp/commit/d7c2dda48bcedbd066c7dbc24a1b63205384d269): the same protocol flow, actual journal entries/outcomes/durations, restart/history retention and diagnostics.

The workspace path contains Unicode characters and spaces. Version strings alone cannot distinguish these two core builds; capability detection uses the newly initialized journal. The desktop does not silently replace the selected published release with a Git build.

All launched core processes and integration tests set the documented `CODING_TOOLS_MCP_TELEMETRY=off` and `DO_NOT_TRACK=1` controls. No external core source was modified. Published 0.5.0 lacks structured tool events, so turnkey history still requires a future event-capable core release or an explicitly selected existing official executable.

The local HTTP fixture avoids reverse DNS. The unmodified Python core remains separately exercised on all three OS runners; macOS has a 60-second readiness budget for the documented CPython resolver startup delay (actions/setup-python#1223), with readiness still required for success.

## Real managed installation and rollback

The opt-in `official_managed_install_acceptance` passed on Linux on October 6, 2026 (10:31:01–10:31:26 UTC), using official uv and exactly published `coding-tools-mcp==0.5.0`:

- uv downloaded official CPython 3.11.16 into private temporary storage; both installs created distinct private environments and passed exact-version checks.
- Each launch's owned process argv was checked against the selected executable, so identical version strings could not hide a stale selection or PATH fallback.
- Rollback selected the first environment and preserved the second as the previous selection.
- A genuine offline/no-cache resolver failure created a separate failed attempt but preserved configuration bytes and both working selections.
- All four stages independently ran MCP initialize, tools/list and a synthetic read_file, then verified Stop and port release. The entire temporary directory and owned process trees were removed.

The test is ignored by default and adds no CI package-download dependency. To run it explicitly:

```sh
DESKTOP_MANAGED_ACCEPTANCE_UV=/absolute/path/to/uv \
cargo test -p desktop-manager --locked --test managed_install_acceptance \
  -- --ignored --exact official_managed_install_acceptance --nocapture
```

This cloud environment's normal network path requires an existing uncredentialed loopback proxy and an existing CA bundle. A narrow opt-in preserves those preconfigured values in the otherwise clean test subprocess environment; it never logs them, accepts credential-bearing proxy URLs, installs trust, or disables TLS verification. Initial clean-environment DNS/TLS failures and a test-only missing argv refresh were diagnosed before the successful full run. HOME, caches, Python installations, telemetry opt-out and all fixture data remain isolated. Interactive installation on every target OS is a separate acceptance gate.

## Native Linux UI acceptance

The harness uses the official `tauri-driver`, WebKitWebDriver, Selenium, Xvfb and a private D-Bus session. It isolates HOME/workspace, verifies the real IPC bridge and embedded frontend assets, and requires these real interactions:

1. Create the synthetic local workspace through onboarding.
2. Select the exact official core executable; require a viewport-visible Saved notice and persistence across leaving/reopening Settings.
3. Start the service and observe readiness through the UI.
4. Copy the connection config, require a viewport-visible Copied notice, then read the real private-Xvfb clipboard and compare its noauth JSON to the displayed loopback endpoint.
5. Make independent MCP initialize/list/read_file success and failure calls, then verify actual history outcomes and durations in the UI.
6. Stop the service and prove port release; confirm quit and prove the owned native application exited.

`ec7a931` diagnostic screenshots visibly show Saved at viewport `(844, 16)`, size `420 × 55`. Bounded DOM history records the correctly rendered fixed notice from 5.129 to 11.618 seconds, matching the embedded frontend asset; the click returned in 0.066 seconds. Therefore that failure was in the old Selenium `is_displayed()`/text predicate, not evidence that the application omitted the notice. Run [`11f7606`](https://github.com/coding-tools-mcp/desktop/actions/runs/37447644308) then proved visible Saved and runtime persistence, and its native screenshot showed the actual core running/READY after MCP initialize. Its diagnostic isolated the discrepancy: Selenium `is_displayed()` was true while `WebElement.text` returned an empty string. The remaining readiness text read hit the same issue. The harness uses read-only live `innerText` plus visibility/geometry checks and preserves the real persistence, clipboard and protocol gates. The subsequent `575243a` run completed every required native flow, including actual X11 clipboard JSON, both real tool outcomes, closed-port Stop and owned-process Quit. The current layout correction must preserve that complete acceptance on its own head.

Earlier harness issues were corrected without relaxing product behavior: same-host executable paths use Selenium's `UselessFileDetector` rather than a remote file-upload request, and Xvfb wraps D-Bus so activated desktop services inherit DISPLAY. An actual offscreen-feedback UX issue was fixed with a viewport-anchored, dismissible notice. Explicit safe-area CSS fallbacks have a browser regression; they are not claimed as the cause of the later native predicate mismatch.

Native artifacts contain synthetic-fixture screenshots and bounded redacted diagnostics only, not raw configuration, credentials, environment dumps or tool payloads. Cleanup tracks owned PIDs with their kernel birth identity before reparenting, preserves the primary failure, and separately records process exit, port release and temporary-data removal. All three cleanup checks passed on `ec7a931`, `11f7606` and the successful full-flow `575243a` run.

## Lifecycle/recovery review

Independent regressions cover root-exit cleanup (including unobserved ordinary children), migrated public/noauth rejection, crashed-workspace tunnel cleanup, credential-header redaction, busy-tunnel activity and responsive snapshots during slow rollback probes.

Unix tests verify abrupt desktop death, exact liveness-pipe non-inheritance, unrelated-pipe preservation, deliberate control-endpoint leakage as a negative control, independent instances, resistant descendants, supervisor death, exit codes and real resource metrics. The environment test compares the exact map against a raw-command baseline using the same helper/runtime, plus an isolated ambient-canary/HOME removal test; it does not guess a macOS allowlist. Ten earlier serial repeats of the 15 lifecycle/supervision cases passed locally.

Shutdown closes admission before enumerating services and preserves ownership on cleanup failures. Persistence/install/tunnel cases cover stale deletion/case aliases, failed writes and migrations, verify-before-switch/rollback, exact version validation, missing selected executables, tunnel retry identity, DNS validation and isolation from ambient Cloudflare configuration.

This is process lifecycle management, not a security sandbox. Deliberately detached unobserved Unix descendants and simultaneous SIGKILL of both desktop and supervisor remain outside the guarantee; see [architecture](ARCHITECTURE.md).

## Remaining acceptance gates

- Require terminal current-head CI and inspect its authentic native screenshots, including the corrected Connections layout and newly added Intel Mac checks; prior-head success does not waive these regressions.
- Run the unsigned installer, native folder picker, tray hide/restore and first-run smoke on the intended OS. Build success and headless runtime tests do not substitute for interactive macOS/Windows acceptance.
- Interactive managed-core install/rollback on each target OS remains manual. The real Linux headless install/rollback/offline-failure flow passed above; other boundary and concurrency checks also use local fixtures.
- No live Cloudflare login, certificate grant, tunnel, DNS route or token was exercised. Live validation needs an explicitly approved account/route; local cloudflared fixtures test failure and recovery safely.
- This cloud host cannot launch local Chromium (`socket() EPERM`) or supply WebKit's compiled-in system-helper path. Hosted browser/native evidence above is genuine; local screenshots were not invented or substituted.
