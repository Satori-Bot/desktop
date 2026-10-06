# Desktop repository guide

This repository owns the Coding Tools MCP desktop application.

## Boundaries

- Preserve the `mcp_desktop_client` import/package name and the `coding-tools-mcp-desktop` console entry point.
- Treat `coding-tools-mcp` as an external runtime dependency. Do not import or duplicate core server implementation details here.
- Runtime contracts, tool schemas, security behavior, tunnels shared with non-desktop users, and protocol behavior belong in `xyTom/coding-tools-mcp`.
- User tutorials that are not desktop-specific belong in `coding-tools-mcp/docs`.
- UI is React/TypeScript/Mantine. Keep English and Simplified Chinese strings in sync.
- Rust owns process/configuration/diagnostic logic; never add a Python management layer.
- Run `npm run typecheck`, `npm test`, `cargo test -p desktop-manager`, and Python launcher tests.
- Exercise the official external core via the ignored acceptance test when available.
- Desktop-native builds require the Tauri platform prerequisites.
- When changing runtime discovery or process management, run `tests/test_desktop_client.py`.
- Run `make check` before release when all platform dependencies are available. Do not create releases or change core tags as part of a desktop refactor.
