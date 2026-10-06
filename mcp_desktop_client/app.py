"""Compatibility entry point for the native desktop app.

Process management and UI live in Rust/Tauri. This shim never imports the core,
starts an MCP server, installs software, or downloads an executable.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path


def find_native_app() -> Path | None:
    override = os.environ.get("CODING_TOOLS_MCP_DESKTOP_BINARY")
    if override:
        path = Path(override).expanduser()
        return path if path.is_file() else None
    executable = shutil.which("coding-tools-mcp-desktop-native")
    if executable:
        return Path(executable)
    candidates = [
        Path.home() / "Applications/Coding Tools MCP.app/Contents/MacOS/coding-tools-mcp-desktop-native",
        Path("/Applications/Coding Tools MCP.app/Contents/MacOS/coding-tools-mcp-desktop-native"),
        Path.home() / ".local/bin/coding-tools-mcp-desktop-native",
    ]
    if sys.platform == "win32":
        for variable in ("LOCALAPPDATA", "PROGRAMFILES"):
            if value := os.environ.get(variable):
                candidates.append(Path(value) / "Coding Tools MCP/coding-tools-mcp-desktop-native.exe")
    return next((path for path in candidates if path.is_file()), None)


def main() -> int:
    executable = find_native_app()
    if executable is None:
        print(
            "The Rust/Tauri desktop app is not installed. Install a native bundle from "
            "https://github.com/coding-tools-mcp/desktop/releases or build it with "
            "npm ci && npm run tauri build. You can also set "
            "CODING_TOOLS_MCP_DESKTOP_BINARY to the native executable. "
            "The Python package is only a compatibility launcher.",
            file=sys.stderr,
        )
        return 1
    try:
        subprocess.Popen([str(executable), *sys.argv[1:]], close_fds=True)
    except OSError as exc:
        print(f"Could not launch the native desktop app: {exc}", file=sys.stderr)
        return 1
    return 0
