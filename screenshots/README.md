# Desktop visual verification

`npm run test:e2e` contains real-DOM Playwright screenshot steps for:

- `browser-unavailable.png`: unmodified production browser entry, with no Tauri backend and no fabricated workspaces or telemetry.
- `dashboard-light-test-fixture.png`: light desktop dashboard with explicitly mocked Tauri IPC.
- `dashboard-dark-test-fixture.png`: dark desktop dashboard with explicitly mocked Tauri IPC.
- `public-failure-test-fixture.png`: public tunnel failure while the local fixture service remains online.
- `dashboard-narrow-test-fixture.png`: 390 × 844 viewport, also checked for horizontal document overflow.

Mock screenshots have a visible purple `TEST FIXTURE / MOCKED IPC` banner. Mock fixtures live under `src/test/` and `e2e/`; they are not imported by the production application.

## Hosted-browser evidence

GitHub-hosted Chromium passed all 12 browser flows for commit `6f4a1f07c1f49abbd0a5785aef38713f226754aa` on October 6, 2026 ([successful browser job](https://github.com/coding-tools-mcp/desktop/actions/runs/37430644696/job/112160445224)). This includes onboarding/back/cancel/retry, repeated actions, independent local/public failure states, filtering, language changes, incremental logs, diagnostics export, and the narrow-viewport overflow check.

The five PNGs in the [browser artifact](https://github.com/coding-tools-mcp/desktop/actions/runs/37430644696/artifacts/11396717236) were retrieved through the supported GitHub artifact API and visually inspected. Light, dark, narrow, public-failure, and backend-unavailable screens have clear status separation, readable controls, and no observed clipping or horizontal overflow. Mock runtime screenshots retain their visible fixture banner.

This evidence applies to that exact commit. Later source changes require their own hosted run before claiming equivalent browser coverage.

## Local native verification limit

No screenshot images have been fabricated or substituted. On the October 6, 2026 validation environment, system Chromium failed before creating a page:

```
FATAL:chrome/browser/process_singleton_posix.cc:297
Check failed: . socket() failed: Operation not permitted (1)
```

A separate browser rendering attempt rejected the local development URL with `net::ERR_BLOCKED_BY_CLIENT`. The full native Linux executable was also built, but this test host lacks WebKit's fixed system helper path; privately relocated development libraries could compile the app but could not render its webview.

Run the suite in a browser-capable environment to regenerate the five PNGs. The configuration uses Playwright's matching bundled Chromium by default. Install it with `npx playwright install --with-deps chromium`. An optional `PLAYWRIGHT_CHROMIUM_EXECUTABLE` environment variable selects an existing binary; the failed local launch used `/usr/bin/chromium`. These are frontend tests with mocked IPC, not proof of native Tauri process, credential, or tunnel behavior.
