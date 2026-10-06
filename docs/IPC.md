# Desktop IPC contract

All Tauri commands return JSON or reject with a human-readable error string. Rust owns configuration, secrets, processes and diagnostics. Commands execute on blocking worker threads, never on the UI thread. No shell plugin or unrestricted filesystem permissions.

Types (camelCase):
- Workspace: { id: string, name: string, path: string, port: number, access: 'local'|'quick'|'named'|'frp', publicUrl: string, auth: 'noauth'|'bearer'|'oauth', permissionMode: 'safe'|'trusted', coreCommand: string[], coreVersion: string, tunnelName: string, credentialsFile: string, tokenConfigured: boolean }
- Settings: { language: 'en'|'zh', closeToTray: boolean }
- Status: { workspaceId: string, state: 'stopped'|'starting'|'running'|'error'|'stopping', pid: number|null, localState: string, publicState: string, localMessage: string, publicMessage: string, localEndpoint: string, publicEndpoint: string, cpuPercent: number, memoryBytes: number, uptimeSeconds: number, checkedAt: string, coreVersion: string, activityState: 'available'|'unavailable'|'unknown', activityMessage: string }
- Activity: { id: string, tool: string, startedAt: string, finishedAt: string|null, outcome: string, durationMs: number|null, errorCategory: string|null, runtimeId: string }
- Snapshot: { workspaces: Workspace[], statuses: Status[], settings: Settings, migrationNotice: string|null, coreAvailable: boolean, cloudflaredAvailable: boolean }
- Diagnostic: { level: 'ok'|'warning'|'error', name: string, message: string }
- Logs: { text: string, cursor: number, truncated: boolean }

Commands:
- snapshot() -> Snapshot
- save_workspace({ workspace: Workspace, secrets?: { bearerToken?: string, oauthPassword?: string, cloudflareToken?: string } }) -> Workspace. New ID may be empty; port 0 auto-assigns. Empty secret inputs preserve existing values. Running workspaces cannot be reconfigured.
- delete_workspace({ id }) -> null. Requires stopped; frontend asks confirmation. Keeps backup and logs.
- start_workspace({ id }) / stop_workspace({ id }) / restart_workspace({ id }) / retry_tunnel({ id }) -> Status
- activity({ id }) -> Activity[] (latest 200 calls, newest first)
- logs({ id, kind: 'runtime'|'tunnel', cursor: number }) -> Logs (bounded incremental cursor; cursor 0 gives tail)
- diagnose({ id }) -> Diagnostic[]
- export_diagnostics({ id }) -> string (redacted JSON text; UI can download it with a Blob)
- connection_config({ id, public: boolean }) -> string (JSON configuration; explicit copy/show action only, may contain bearer token)
- save_settings({ settings: Settings }) -> Settings
- pick_directory() -> string|null (native dialog)
- open_workspace({ id }) -> null
- install_core({ version: string }) -> string (uses uv to install exactly coding-tools-mcp==VERSION in versioned private venv, probes it before switching; UI explicit Install button)
- rollback_core() -> string (switch to previous verified environment, does not restart running services)
- cloudflare_login() -> string (explicit UI action; launches cloudflared browser authorization, output/error returned)
- setup_named_tunnel({ id, name: string, hostname: string }) -> Workspace (explicit UI action requiring confirmation that it creates tunnel+DNS; saves reusable local credentials)
- quit_app() -> null (stops managed services then exits; UI should warn if any services running)

Defaults: first workspace local, safe, noauth, port 0, no custom core command. Remote access requires bearer or OAuth. Quick Tunnel is temporary and suitable for bearer; OAuth requires stable HTTPS publicUrl. Named fixed domain via existing token OR browser login + create tunnel + DNS. Never imply a copied URL is online before diagnostic verification. Failed tunnel leaves local service running. First-run flow: choose folder, local/remote, create, start, copy endpoint. No mock statuses in production; browser-only preview must explicitly say it is a preview with no backend.

- auth_details({ id }) -> { auth: string, bearerToken?: string, oauthPassword?: string }; explicit reveal only.

Capability note: published PyPI core 0.5.0 lacks tool events. The desktop never synthesizes records or silently installs a Git checkout. Exact official commit d7c2dda48bcedbd066c7dbc24a1b63205384d269 supports the event journal and is separately validated. Each launched core receives a fresh journal directory; the previous three runs are retained.
