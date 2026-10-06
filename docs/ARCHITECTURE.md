# Desktop rewrite design

## Reference review

The following repositories were cloned and inspected, without importing their core runtimes:

- [lengsukq/coding-tools-mcp](https://github.com/lengsukq/coding-tools-mcp): workspace navigation, grouped settings and connection/activity presentation. Its all-Rust MCP core and global workspace routing are intentionally not adopted.
- [lifei6671/serena-desktop](https://github.com/lifei6671/serena-desktop): subprocess ownership, bounded output, cancellation/cleanup and native app behavior. See its `src-tauri/src/mcp/process.rs`; this app instead uses an independently testable synchronous Rust manager behind non-blocking Tauri workers.
- [yyjeqhc/webcodex](https://github.com/yyjeqhc/webcodex): adapter boundary, exact external versions and recovery on failed transitions. Its broker/runner/multi-device platform is outside the launcher scope.

Implementation here is original and retains the existing Apache license and NOTICE.

## Four phases covered

1. Local-only first run; distinct process/protocol/public health; refusal of port conflicts; owned-process cleanup and stop confirmation; independent workspaces; crash detection/retry.
2. Rust modules for configuration, core executable adaptation, process lifecycle, journal reading, diagnostics and Cloudflare; React/Mantine UI issues typed operations. External Python code is untouched.
3. Automatic status/resource refresh, bounded incremental logs with rotation-aware cursors, real per-call history with capability gating, single instance, tray hide, explicit stop-and-quit.
4. Native Tauri build configuration and cross-platform CI; a versioned managed official core installation with verify-before-switch and rollback; backup-first migration; compatibility Python launcher with unchanged package and console command.

## Boundaries and trust

One core instance continues to own one workspace. The app binds it only to loopback and passes authentication through environment variables. It does not implement an MCP server or mirror tool schemas. Discovery and initialize requests verify the expected external server instead of guessing a `/health` endpoint.

Tauri grants no remote-content IPC, arbitrary shell, HTTP or filesystem plugin access. The bundled frontend uses explicit commands with validated workspace IDs. Opening folders uses a saved, validated path. Custom core arguments are an array, never a shell command string. Secrets are not returned in snapshots, history or diagnostic exports; reveal/copy are explicit actions.

Session operations are serialized per workspace, while other workspaces remain interactive. Status reads use a separate cached status lock so startup/tunnel timeouts do not freeze the frontend. Process ownership begins at spawn; stored legacy PIDs are never trusted. Unix native launches re-enter the same binary in a private headless supervisor mode before Tauri initialization. A close-on-exec parent-liveness pipe lets each supervisor stop its owned core/tunnel group if the desktop exits abruptly; descendants receive null stdin and never inherit the pipe. Process groups plus recorded child birth times support cleanup. The displayed managed PID identifies that supervisor, while resource metrics aggregate its core/tunnel descendants. Windows uses a kill-on-close job object plus owned-child tracking.

Startup stores owned core/tunnel handles before waiting for readiness. A readiness failure explicitly confirms cleanup; an unconfirmed cleanup preserves the handle for Stop/Quit retry. The snapshot's `cleanupPending` is distinct from a live PID, so recovery remains available without advertising an exited process. Quit revisits unresolved Stop results, including a still-bound port after process exit, and never terminates an unrelated listener. Resource metrics include owned workers for direct/Windows launches as well as supervised Unix launches. Discovery/initialize response parsing is bounded to 1 MiB for both declared and streamed HTTP bodies.

Ordinary core/tunnel descendants are covered on Unix. A malicious or deliberately detached descendant that was never observed, or simultaneous SIGKILL of both the desktop and supervisor, is outside this process-lifecycle guarantee. It is not a security sandbox. Bounded maintenance operations (version probes, installation and interactive Cloudflare setup) remain direct children; normal quit refuses while installation/setup is in progress. The supervisor protects long-running services, not interrupted remote account/DNS transactions.

Quit closes admission before enumerating services and only exits after confirmed cleanup; failed shutdown reopens admission for recovery. Workspace configuration is revalidated under its lifecycle lock, and deleted workspace IDs stay tombstoned for that app session so a delayed save cannot resurrect an old editor. Selected missing managed-core executables fail closed instead of silently falling back to a different PATH version.

A tunnel failure does not roll back a healthy local core. Stable named tunnels persist their credentials and hostname, while Quick Tunnel is visibly temporary. Browser authorization and DNS creation are interactive setup steps; development tests never request real Cloudflare access or create a live tunnel/domain route.

## Compatibility limit

Published `coding-tools-mcp==0.5.0` predates structured tool-event logging. The exact unchanged upstream commit `d7c2dda48bcedbd066c7dbc24a1b63205384d269` implements it. Version strings alone cannot distinguish those builds. Capability detection checks whether the launched core initialized its new private journal, preventing an old retained log from making an older core look supported. CI tests both. The app never swaps the user's published release for Git main automatically.
