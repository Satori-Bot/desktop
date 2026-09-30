# Desktop repository guide

This repository owns the Coding Tools MCP desktop application.

## Boundaries

- Preserve the `mcp_desktop_client` import/package name and the `coding-tools-mcp-desktop` console entry point.
- Treat `coding-tools-mcp` as an external runtime dependency. Do not import or duplicate core server implementation details here.
- Runtime contracts, tool schemas, security behavior, tunnels shared with non-desktop users, and protocol behavior belong in `xyTom/coding-tools-mcp`.
- User tutorials that are not desktop-specific belong in `coding-tools-mcp/docs`.
- When changing UI strings, refresh and validate the Qt translation catalog.
- When changing runtime discovery or process management, run `tests/test_desktop_client.py`.
- Run `make check` before release when all platform dependencies are available.
