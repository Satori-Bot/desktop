# Coding Tools MCP Desktop

Desktop application for running and managing [Coding Tools MCP](https://github.com/xyTom/coding-tools-mcp).

The app provides a GUI for:

- managing multiple workspaces
- starting and stopping the local Coding Tools MCP runtime
- configuring OAuth, bearer-token, or no-auth modes
- exposing a runtime through Cloudflare Tunnel or an externally managed FRP client
- checking runtime/tunnel health and logs
- copying connection details for MCP clients
- switching between English and Simplified Chinese

## Install from source

Requires Python 3.11+.

```bash
python -m pip install -e .
coding-tools-mcp-desktop
```

The desktop package depends on `coding-tools-mcp`, so a normal installation also installs the core runtime. The app can also launch the runtime through `uvx coding-tools-mcp` when `uvx` is available.

## Development

```bash
python -m pip install -e ".[dev]"
make test
make lint
make i18n-check
python -m build
```

To refresh the Simplified Chinese Qt catalog after changing user-facing strings:

```bash
make i18n-update
make i18n-release
make i18n-check
```

## Runtime boundary

This repository owns only the desktop application. Runtime behavior, MCP protocol support, tool schemas, security policy, and the `coding-tools-mcp` executable are owned by the core repository:

https://github.com/xyTom/coding-tools-mcp

The desktop app invokes the core runtime as an external executable. It does not import or duplicate the core server implementation.

## Remote access

Cloudflare quick tunnels are managed directly by the app. Named Cloudflare tunnels require a tunnel token and an already configured hostname.

FRP is currently externally managed: the app generates configuration and connection details, but it does not start or reload `frpc`.

## Documentation

User guides and client setup are published at:

https://coding-tools-mcp.github.io/docs/

Documentation source:

https://github.com/coding-tools-mcp/docs

## License

Apache-2.0.
