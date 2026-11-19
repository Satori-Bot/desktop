#!/usr/bin/env python3
"""Stage a pinned Astral uv sidecar and licenses for native packaging."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import tarfile
import tempfile
import urllib.request
import zipfile
from pathlib import Path, PurePosixPath

UV_VERSION = "0.13.7"
UV_SOURCE_COMMIT = "316c827e058c16b71d5c507a20729c2995a7bcce"
RELEASE = f"https://github.com/astral-sh/uv/releases/download/{UV_VERSION}"
SOURCE = f"https://raw.githubusercontent.com/astral-sh/uv/{UV_SOURCE_COMMIT}"
# Digests from the immutable release asset manifest:
# https://api.github.com/repos/astral-sh/uv/releases/tags/0.13.7
ARCHIVES = {
    "aarch64-apple-darwin": (
        "tar.gz",
        "81b811b57e4624df7ed3aac148e0359100d9962f3d9dce00aec533dc2e086731",
    ),
    "x86_64-apple-darwin": (
        "tar.gz",
        "20c47e4c1f630b8abaff8c291fa9b9aa300fef92c4fbff95adf198b55287cda7",
    ),
    "x86_64-pc-windows-msvc": (
        "zip",
        "0cdc5b38fe5a8168ed6a25814f5ba43c21d313dd3187314fccb37b7cec46e021",
    ),
    "x86_64-unknown-linux-gnu": (
        "tar.gz",
        "c5221ff41b7892bfc223543883600125f6a47fe845093e0f5bdff4f359196d83",
    ),
}
LICENSES = {
    "LICENSE-MIT": "860e3d7a86b84e6a7012c7a635fc64df475cebc6cce34dfeb73a5982ec58176c",
    "LICENSE-APACHE": "c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4",
}
SIDECAR = "coding-tools-mcp-uv"
STAGING = PurePosixPath("gen/runtime-installer")
ROOT = Path(__file__).resolve().parent.parent
STAGING_DIR = ROOT / "src-tauri" / STAGING


def verify(path: Path, digest: str) -> None:
    with path.open("rb") as stream:
        actual = hashlib.file_digest(stream, "sha256").hexdigest()
    if actual != digest:
        raise ValueError(f"SHA-256 mismatch for {path.name}")


def download(url: str, path: Path, digest: str, limit: int) -> None:
    with urllib.request.urlopen(url, timeout=30) as response, path.open("wb") as out:
        if not response.geturl().startswith("https://"):
            raise ValueError("Refusing a non-HTTPS redirect")
        size = 0
        for chunk in iter(lambda: response.read(1024 * 1024), b""):
            size += len(chunk)
            if size > limit:
                raise ValueError(f"Pinned download exceeded size limit: {path.name}")
            out.write(chunk)
    verify(path, digest)


def extract_executable(archive: Path, triple: str, suffix: str, output: Path) -> None:
    """Read only the expected executable, never extract arbitrary archive paths."""
    if suffix == "zip":
        with zipfile.ZipFile(archive) as source:
            with source.open("uv.exe") as payload, output.open("wb") as out:
                shutil.copyfileobj(payload, out)
    else:
        with tarfile.open(archive, "r:gz") as source:
            member = source.getmember(f"uv-{triple}/uv")
            if not member.isfile():
                raise ValueError("Expected a regular uv executable in the release archive")
            payload = source.extractfile(member)
            if payload is None:
                raise ValueError("The uv executable is missing")
            with payload, output.open("wb") as out:
                shutil.copyfileobj(payload, out)
    output.chmod(0o755)


def prepare(triple: str, staged_archive: Path | None = None) -> Path:
    if triple not in ARCHIVES:
        raise ValueError(f"No verified uv release for {triple}")
    suffix, checksum = ARCHIVES[triple]
    name = f"uv-{triple}.{suffix}"
    target = f"{SIDECAR}-{triple}" + (".exe" if suffix == "zip" else "")
    STAGING_DIR.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=STAGING_DIR) as work:
        temporary = Path(work)
        archive = temporary / name
        if staged_archive is None:
            download(f"{RELEASE}/{name}", archive, checksum, 35 * 1024 * 1024)
        else:
            shutil.copyfile(staged_archive, archive)
            verify(archive, checksum)
        executable = temporary / target
        extract_executable(archive, triple, suffix, executable)
        resources = {}
        for license_file, digest in LICENSES.items():
            asset = temporary / f"uv-{license_file}"
            download(f"{SOURCE}/{license_file}", asset, digest, 64 * 1024)
            resources[str(STAGING / asset.name)] = f"third-party/uv/{license_file}"
            asset.replace(STAGING_DIR / asset.name)
        executable.replace(STAGING_DIR / target)
        overlay = temporary / "tauri-runtime.json"
        overlay.write_text(
            json.dumps(
                {"bundle": {"externalBin": [str(STAGING / SIDECAR)], "resources": resources}},
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        return overlay.replace(STAGING_DIR / overlay.name)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", action="version", version=UV_VERSION)
    parser.add_argument("--target", help="Rust target triple (defaults to the active Rust host)")
    parser.add_argument(
        "--archive", type=Path, help="Reuse the official release archive, still verifying its SHA-256"
    )
    args = parser.parse_args()
    triple = args.target or subprocess.check_output(
        ["rustc", "--print", "host-tuple"], text=True
    ).strip()
    print(prepare(triple, args.archive).relative_to(ROOT).as_posix())


if __name__ == "__main__":
    main()
