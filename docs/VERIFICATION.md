# Verification record

Validated locally on October 6, 2026. These checks are not a claim of completed CI, a tested signed release, or live Cloudflare setup.

## Passed

- Rust manager: **20 tests** (6 unit/storage/history/privacy, 7 lifecycle, 7 independent review regressions). The external-core acceptance test is opt-in and was run separately below.
- Rust formatting and Clippy, all manager targets, `-D warnings`.
- **Windows GNU cross-target manager compilation and Clippy** passed, including the Windows suspended-process/job-object APIs. Windows runtime execution was not performed.
- **Full Linux native Tauri compilation and executable build** passed. Signed Debian development packages were installed in a private build prefix because system package installation was unavailable.
- Python checks: **6 tests** (5 compatibility-launcher checks and 1 DNS-free HTTP fixture check), Ruff, wheel + source-distribution builds, and Twine package checks passed. The wheel retains the import/console-entrypoint/NOTICE boundary and contains no Python core or Qt implementation.
- React/TypeScript: **19 rendered component/IPC flow tests**, strict TypeScript, formatting and Vite production build passed.
- External published `coding-tools-mcp==0.5.0`: real initialize, tools/list, successful and failed read_file calls, explicit unsupported-history detection and confirmed stop/port release passed.
- External unchanged official commit `d7c2dda48bcedbd066c7dbc24a1b63205384d269`: the same real MCP flow, actual per-call journal entries, outcomes, durations and diagnostics passed.

All final external-core tests and launched core processes use the official documented `CODING_TOOLS_MCP_TELEMETRY=off` and `DO_NOT_TRACK=1` controls. The external core source was not modified.

## Hosted browser review

The initial GitHub run produced authentic light/dark, narrow-screen and tunnel-failure screenshots. These were downloaded and visually inspected: text and controls were readable, narrow content stacked without horizontal overflow, and local/public status remained distinct. Mock screenshots are visibly labeled. Three browser test-harness defects were corrected for the next run; final browser suite status must be checked on the latest head.

## Prepared but not completed locally

- **12 real-browser Playwright flows** and five screenshot captures are implemented. Chromium failed before opening a page (`socket() EPERM`); a separate browser route rejected the local development URL. No screenshot was invented or substituted; later hosted-run screenshots are described above. See [visual verification instructions](../screenshots/README.md).
- Native Linux visual testing was attempted using the built executable, but this host lacks WebKit's compiled-in system helper path. Relocated libraries support compilation but cannot replace an installed WebKit runtime.
- macOS runtime/build and Windows runtime/native-installer tests require their native CI runners. Cross-compilation is not runtime acceptance.
- No live Cloudflare login, certificate grant, tunnel, DNS route, or token was exercised. The lifecycle edge cases use explicitly mocked local cloudflared processes.
- Managed version install/rollback logic is covered by command/verification and concurrency checks, but interactive installation across all three operating systems is not yet verified.

## Review regressions

The independent review added executable tests for root-exit process-tree cleanup (including unobserved children), migrated public/noauth rejection, crashed-workspace tunnel cleanup, credential-header redaction, in-flight activity during a busy tunnel startup and after stop, and responsive snapshots during a slow core rollback probe.

## Next gate

Run the branch CI, inspect the browser screenshot artifact, and perform a native installer/tray/first-run smoke on the intended OS before marking the PR ready or creating a release. A published event-capable Python core remains an upstream release dependency for turnkey tool-call history; existing event-capable official executables can be selected explicitly now.

The fixture server avoids reverse DNS to keep lifecycle tests deterministic. The unmodified Python core is separately exercised on all three OS runners; macOS receives a 60-second readiness budget for the documented CPython resolver startup delay (actions/setup-python#1223), with readiness still required before success.
