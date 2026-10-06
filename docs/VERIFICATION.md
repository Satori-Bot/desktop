# Verification record

Validation record on October 6, 2026. [Draft PR #1](https://github.com/coding-tools-mcp/desktop/pull/1) baseline `6f4a1f07c1f49abbd0a5785aef38713f226754aa` passed [all 11 CI jobs](https://github.com/coding-tools-mcp/desktop/actions/runs/37430644696). Later hardening is distinguished below; none of these checks claims a signed release or live Cloudflare setup.

## Passed

- Rust manager baseline: **20 tests** (6 unit/storage/history/privacy, 7 lifecycle, 7 independent review regressions). The external-core acceptance test is opt-in and was run separately below.
- Rust formatting and Clippy, all manager targets, `-D warnings`.
- **Windows GNU cross-target manager compilation and Clippy** passed, including the Windows suspended-process/job-object APIs. Native Windows runtime tests and full build also passed on the baseline CI.
- **Full Linux native Tauri compilation and executable build** passed. Signed Debian development packages were installed in a private build prefix because system package installation was unavailable.
- Python checks: **6 tests** (5 compatibility-launcher checks and 1 DNS-free HTTP fixture check), Ruff, wheel + source-distribution builds, and Twine package checks passed. The wheel retains the import/console-entrypoint/NOTICE boundary and contains no Python core or Qt implementation.
- React/TypeScript baseline: **19 rendered component/IPC flow tests**, strict TypeScript, formatting and Vite production build passed.
- External published `coding-tools-mcp==0.5.0`: real initialize, tools/list, successful and failed read_file calls, explicit unsupported-history detection and confirmed stop/port release passed.
- External unchanged official commit `d7c2dda48bcedbd066c7dbc24a1b63205384d269`: the same real MCP flow, actual per-call journal entries, outcomes, durations and diagnostics passed.

All final external-core tests and launched core processes use the official documented `CODING_TOOLS_MCP_TELEMETRY=off` and `DO_NOT_TRACK=1` controls. The external core source was not modified.

## Hosted browser review

The initial GitHub run produced authentic light/dark, narrow-screen and tunnel-failure screenshots. These were downloaded and visually inspected: text and controls were readable, narrow content stacked without horizontal overflow, and local/public status remained distinct. Mock screenshots are visibly labeled. All **12/12 Playwright flows** passed on the green baseline head, including the corrected harness checks. Subsequent heads `965e0ed` and `046bf6f` also passed all 12 browser flows; their five authentic screenshots were inspected. The latest revision still requires its own exact-head result.

## Prepared but not completed locally

- **12 real-browser Playwright flows** and five screenshot captures are implemented. Chromium failed before opening a page (`socket() EPERM`); a separate browser route rejected the local development URL. No screenshot was invented or substituted; later hosted-run screenshots are described above. See [visual verification instructions](../screenshots/README.md).
- Native Linux visual testing was attempted using the built executable, but this host lacks WebKit's compiled-in system helper path. Relocated libraries support compilation but cannot replace an installed WebKit runtime.
- macOS and Windows native builds/runtime tests and both external-core acceptance fixtures passed on the baseline CI. Native installer, tray and first-run interactive smoke testing remain separate; cross-compilation is not runtime acceptance.
- No live Cloudflare login, certificate grant, tunnel, DNS route, or token was exercised. The lifecycle edge cases use explicitly mocked local cloudflared processes.
- Managed version install/rollback logic is covered by command/verification and concurrency checks, but interactive installation across all three operating systems is not yet verified.

## Review regressions

The independent review added executable tests for root-exit process-tree cleanup (including unobserved children), migrated public/noauth rejection, crashed-workspace tunnel cleanup, credential-header redaction, in-flight activity during a busy tunnel startup and after stop, and responsive snapshots during a slow core rollback probe.

## Additional hardening under verification

The full current Rust suite passes **57 active tests** locally (11 unit/admission, 9 lifecycle, 22 persistence/install/tunnel, 7 ownership regressions and 8 supervisor lifecycle). Two intentional ignores are the external-core acceptance entry and a private subprocess fixture.

- Frontend: **39 tests** pass locally, adding destructive-target confirmation, single-flight polling, stale response/copy cancellation, log rotation/truncation and OAuth reauthorization guidance. Strict types, formatting, build and npm audit pass.
- Persistence/install/tunnel boundary: **22 regression cases** pass locally, using local mock executables only. They cover failed install/rollback/config writes, exact version validation, executable discovery, duplicate/case-alias IDs, tunnel retry identity and DNS validation, and ambient Cloudflare environment/config isolation.
- Unix supervision: **eight real-process lifecycle tests** pass locally, including abrupt desktop death, pipe non-inheritance, independent instances, resistant descendants, helper death, exact exit codes, argv/environment/cwd and real resource metrics. Independent review found no blocking issue; macOS verification is pending the next CI run. An overbroad descriptor test was reproduced with intentionally inherited unrelated pipes, then replaced by actual read/write endpoint-identity checks with unrelated-pipe and deliberate-control-leak cases; the parent-death/sibling behavioral test is retained.
- Manager lifecycle now runs through the actual supervisor helper on Unix. Stale-deleted saves, case aliases, busy-operation shutdown recovery, diagnostic admission and shutdown admission have additional regressions. Both real-core fixtures pass locally through the supervisor with documented telemetry opt-out; the real Linux native binary also passes the nine active lifecycle flows through its private headless entry.
- A native Linux WebKit/Selenium smoke is included in CI with the exact unchanged event-capable core, isolated HOME/workspace, real clipboard verification and genuine native screenshots. Head `046bf6f` rendered native onboarding and created-workspace Settings, but stopped at Selenium's mistaken automatic file-upload attempt when typing the executable path. Same-host file detection is corrected; start/history/clipboard/stop/quit still await a passing native run. OS picker/tray and installer checks remain manual gates.
- All three unsigned native review-bundle builds passed at `965e0ed`; macOS aarch64 .app/.dmg and Windows x64 MSI/NSIS artifacts were downloaded and integrity-checked. Linux x86_64 packages passed the CI license-resource check. Installer execution is still a separate acceptance gate.
- Full Linux build through the actual Tauri CLI passed. Native CI now runs that CLI instead of only Cargo; a separate PR workflow builds unsigned Linux/macOS/Windows review bundles without publishing a release. Exact matching Tauri npm minor versions prevent a packaging mismatch that a Cargo-only build did not detect.

The environment-preservation regression now compares a raw-command baseline using the same helper/runtime against the managed wrapper, including exact environment-map equality, an isolated ambient canary/HOME removal test and requested-value checks. It does not guess a Darwin environment allowlist; the earlier failing run did not expose the extra key.

Patched Rust dependencies remove three advisory findings and raise the compiler minimum to Rust 1.88.0. The actual patched lock audit reports zero vulnerability findings, with seven upstream informational warnings retained visibly. Rust 1.88.0 passed all 57 manager tests, Clippy, Windows GNU cross-target Clippy, the full Linux Tauri CLI build, native supervision-entry tests and both unchanged-core restart/history acceptance fixtures. See [dependency review](DEPENDENCIES.md) for reachability, limitations and exact sources.

## Next gate

Run the branch CI, inspect the browser screenshot artifact, and perform a native installer/tray/first-run smoke on the intended OS before marking the PR ready or creating a release. A published event-capable Python core remains an upstream release dependency for turnkey tool-call history; existing event-capable official executables can be selected explicitly now.

The fixture server avoids reverse DNS to keep lifecycle tests deterministic. The unmodified Python core is separately exercised on all three OS runners; macOS receives a 60-second readiness budget for the documented CPython resolver startup delay (actions/setup-python#1223), with readiness still required before success.
