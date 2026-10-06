# Coding Tools MCP Desktop

A local-first **Rust + Tauri 2** application with a **React, TypeScript and Mantine** interface. It manages an external [Coding Tools MCP](https://github.com/xyTom/coding-tools-mcp) Python process. The Python server, MCP protocol, tools, permissions and OAuth implementation remain unchanged in their own repository.

## First run

1. Install a native desktop bundle, or build one below.
2. Open **Settings → Install core** to create a private, versioned environment for the exact published Python core. This requires [uv](https://docs.astral.sh/uv/getting-started/installation/). You can instead select an existing official core executable and separate argument list.
3. Add a workspace folder. **Local only** is the default; no tunnel or account is needed.
4. Start it and copy its MCP connection configuration. Local and public health are shown independently.

The default `safe` core permission mode restricts command execution gates; it is **not a read-only workspace**. Switching to `trusted` is explicit.

### Tool-call history compatibility

The launcher sets the official core's documented telemetry opt-out (CODING_TOOLS_MCP_TELEMETRY=off and DO_NOT_TRACK=1). Local activity is separate from product analytics.

History displays the core's real structured events, including tool name, timestamps, duration and outcome. It never fabricates calls or captures tool arguments/results.

**The published PyPI `coding-tools-mcp==0.5.0` does not expose an event journal.** It supports launch/connect, but history is explicitly marked unavailable. An unchanged official core built from commit [`d7c2dda48bcedbd066c7dbc24a1b63205384d269`](https://github.com/xyTom/coding-tools-mcp/commit/d7c2dda48bcedbd066c7dbc24a1b63205384d269) supports `CODING_TOOLS_MCP_EVENT_LOG_DIR` and is covered by a separate integration test. To use that capability before a published release includes it, explicitly install your chosen official event-capable core and select its executable. The desktop does not silently substitute a Git build for the selected published release.

## Remote access

- **Local only:** loopback MCP, no public exposure.
- **Quick Tunnel:** temporary Cloudflare address; changes after a restart. Requires bearer authentication. It is not a stable OAuth endpoint.
- **Named Tunnel:** a reusable HTTPS hostname. Use an existing tunnel token/hostname, or explicitly authorize `cloudflared tunnel login`, then create a named tunnel and DNS route in the guided UI. The latter requires a domain on your Cloudflare account. The app confirms before creating DNS and never silently replaces another route.
- **FRP:** reuse an externally managed FRP route. The app does not manage `frpc`.

Install [cloudflared](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/) separately. A failed tunnel leaves local MCP running. “Connected” means cloudflared connected; run diagnostics to verify public discovery. An authenticated MCP client must still complete its own authorization.

A Cloudflare account certificate from browser login can manage that account's tunnels. Tunnel credentials are limited to one tunnel. These remain on the user's computer. Tokens are passed through the process environment rather than command-line arguments.

## Development

Requirements: Node.js 22.12+ (or supported newer LTS), Rust 1.85.1+, Python 3.11+ for the compatibility launcher/tests, and [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/). The lockfile pins versions compatible with Rust 1.85.

```sh
npm ci
npm run tauri dev
```

Build native bundles:

```sh
npm run tauri build
```

Headless manager tests do not require GTK/WebKit or a desktop session:

```sh
cargo test -p desktop-manager --locked
cargo clippy -p desktop-manager --all-targets --locked -- -D warnings
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
python -m pip install -e '.[dev]'
python -m unittest discover -s tests -p 'test_*.py'
make check
```

The browser-only development preview explicitly has **no native backend**. It never presents sample data as live service status.

### Real external-core acceptance

The ignored test starts the selected external executable in a temporary workspace, performs MCP initialize/tools-list/successful-and-failed read-file calls, checks real history or capability unavailability, and verifies process/port cleanup.

```sh
# Published release: launch/connect works; history must be unavailable.
DESKTOP_EXPECT_ACTIVITY=false \
DESKTOP_CORE_COMMAND_JSON='["/absolute/path/to/published/coding-tools-mcp"]' \
cargo test -p desktop-manager official_core_mcp_acceptance -- --ignored

# Explicitly selected, unchanged event-capable official core.
DESKTOP_EXPECT_ACTIVITY=true \
DESKTOP_CORE_COMMAND_JSON='["/absolute/path/to/event-capable/coding-tools-mcp"]' \
cargo test -p desktop-manager official_core_mcp_acceptance -- --ignored
```

CI covers Linux/macOS/Windows manager/native builds, Python packaging, frontend rendering/flows, and both exact official core fixtures. A green headless test is not a claim that native installers, tray integration or Cloudflare authorization were tested on every OS.

## Architecture and operations

- `crates/desktop-manager`: Rust configuration, core adapter, process lifecycle, structured history, bounded logs, diagnostics and tunnel management; independently testable without Tauri.
- `src-tauri`: a small typed IPC surface, native folder picker/opener, system tray, single instance and shutdown handling.
- `src`: React/TypeScript UI. Forms retain drafts across polling. Copy actions do not save configuration.
- `mcp_desktop_client`: compatibility package preserving `coding-tools-mcp-desktop` and `mcp_desktop_client.app:main`. It launches an already installed native executable and never downloads software. `pip install` alone does not install a GUI. Set `CODING_TOOLS_MCP_DESKTOP_BINARY` to a native executable if discovery cannot find it.

Configuration lives in `~/.coding-tools-mcp-desktop/desktop-v2.json`. On Unix the private directory uses mode 0700 and files use 0600; Windows uses the user's profile ACL. Existing v1 profiles/secrets are backed up before migration and originals are retained. Invalid/future configuration fails with a useful error rather than resetting workspaces. Old running processes are never adopted by PID or killed: stop them in the old app before starting the migrated workspace.

Closing the window hides it in the tray by default. **Stop services and quit** stops only owned processes and verifies port release. Crashes are detected, and retry/restart is explicit. Running workspaces cannot be reconfigured. Managed core installation verifies a new version before selecting it; failure leaves the prior environment selected. Rollback changes the selected environment without interrupting running workspaces.

Runtime/tunnel logs rotate at 1 MiB with one backup and are read with bounded cursors. Core history keeps the current and three previous launches, each using the core's bounded four-file journal. Diagnostics export excludes raw logs, paths, addresses, credentials, commands, tool inputs and outputs.

See [IPC contract](docs/IPC.md), [design and references](docs/ARCHITECTURE.md), and [verification](docs/VERIFICATION.md).

## License

Apache-2.0. Existing LICENSE and NOTICE are retained. Reference projects informed UX and separation of concerns; their server implementations are not copied or bundled.
