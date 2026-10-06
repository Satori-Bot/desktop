# Desktop visual verification

`npm run test:e2e` contains real-DOM Playwright screenshot steps for:

- `browser-unavailable.png`: unmodified production browser entry, with no Tauri backend and no fabricated workspaces or telemetry.
- `dashboard-light-test-fixture.png`: light desktop dashboard with explicitly mocked Tauri IPC.
- `dashboard-dark-test-fixture.png`: dark desktop dashboard with explicitly mocked Tauri IPC.
- `public-failure-test-fixture.png`: public tunnel failure while the local fixture service remains online.
- `dashboard-narrow-test-fixture.png`: 390 × 844 viewport, also checked for horizontal document overflow.

Mock screenshots have a visible purple `TEST FIXTURE / MOCKED IPC` banner. Mock fixtures live under `src/test/` and `e2e/`; they are not imported by the production application.

## Current verification limit

No screenshot images have been fabricated or substituted. On the October 6, 2026 validation environment, system Chromium failed before creating a page:

```
FATAL:chrome/browser/process_singleton_posix.cc:297
Check failed: . socket() failed: Operation not permitted (1)
```

A separate browser rendering attempt rejected the local development URL with `net::ERR_BLOCKED_BY_CLIENT`. The full native Linux executable was also built, but this test host lacks WebKit's fixed system helper path; privately relocated development libraries could compile the app but could not render its webview.

Run the suite in a browser-capable environment to produce the five PNGs. The configuration uses Playwright's matching bundled Chromium by default. Install it with `npx playwright install --with-deps chromium`. An optional `PLAYWRIGHT_CHROMIUM_EXECUTABLE` environment variable selects an existing binary; the failed local launch used `/usr/bin/chromium`. These are frontend tests with mocked IPC, not proof of native Tauri process, credential, or tunnel behavior.
