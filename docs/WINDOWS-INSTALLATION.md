# Windows installer acceptance

[Native bundles](../.github/workflows/native-bundles.yml) must build before this check. The `windows-quiet-install` jobs test the exact MSI and NSIS artifacts from that workflow on **separate disposable Windows runners**, so an MSI timeout cannot block or contaminate the NSIS test. Each records the artifact SHA-256, Windows version, elevation, WebView2 registration, the installed Core helper version, and the install/launch/uninstall results. MSI also writes immediately flushed verbose logs. Artifact names begin with `windows-quiet-install-`. A skipped or approval-pending job is not a pass.

The hosted test verifies that the installed process starts and remains alive, not that WebView2 rendered the first screen or that the installer can provision WebView2 on a missing-runtime machine. For release, use the same artifact on a clean interactive Windows VM snapshot:

```powershell
# Elevated PowerShell on a disposable VM, with Evergreen WebView2 already available.
./scripts/test-windows-installer.ps1 -Kind msi -BundlePath 'C:\qa\CodingTools.msi' `
  -LogDirectory 'C:\qa\msi-logs' -DisposableMachine -ExpectedWebView2 Present -RequireMainWindow

# Restore a clean snapshot and run from a normal user session for NSIS.
./scripts/test-windows-installer.ps1 -Kind nsis -BundlePath 'C:\qa\CodingTools-setup.exe' `
  -LogDirectory 'C:\qa\nsis-logs' -DisposableMachine -RequireMainWindow
```

Pass `-ExpectedBundledUvVersion (python scripts/prepare-bundled-uv.py --version)` when testing a bundle expected to ship that helper. Verify visually that the application renders the initial workspace screen. Exercise the default Core setup on an account without Python, then test the existing-Core choice independently. Take another snapshot with WebView2 absent **only on a Windows image that supports this scenario**; run with `-ExpectedWebView2 Absent` to exercise runtime provisioning rather than assuming it ran. Do not remove the machine's regular WebView2 installation just to create the fixture. After a timeout, collect the logs and revert the VM; do not kill all `msiexec` processes or start another install while the previous transaction may be active. Logs from manual VMs can contain paths or account names; review before sharing.

## Triaging the reported quiet MSI timeout

The default [Tauri CLI 2.11.5 WiX template](https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.11.5/crates/tauri-bundler/src/bundle/windows/msi/main.wxs) is a **per-machine** installer. Start from an already elevated shell: [Windows Installer quiet mode](https://learn.microsoft.com/windows/win32/msi/standard-installer-command-line-options) suppresses its UI. Use the same SHA-256, OS, user/elevation, WebView2 state, and network policy as the reproducing case. This harness uses `/qn /norestart /L*V!` and treats restart-required codes separately from failure, without accepting them as a no-reboot first-launch pass.

When Evergreen WebView2 is absent, the default Tauri MSI schedules `DownloadAndInvokeBootstrapper` before `InstallFinalize`. It runs hidden PowerShell to fetch the Microsoft bootstrapper, then waits for it. **This is one possible wait point, not a diagnosis of the QA report**. If the log last reaches that action, compare the exact bundle on clean snapshots with and without WebView2 and with the intended proxy policy, then evaluate Tauri's [offline WebView2 installer option](https://v2.tauri.app/distribute/windows-installer/#webview2-installation-options) for the supported bundle. If it stalls before this action or reproduces with WebView2 present, investigate the last entered installer action and Windows Installer events instead. A passing NSIS result does not clear MSI; do not publish MSI as working quietly until its required scenarios pass.

## Environment guidance

- **WebView2:** it is a Windows application prerequisite, not a component of Coding Tools MCP Core. Normal Tauri installers check it; for managed or network-restricted fleets, pre-provision the [official Evergreen runtime](https://developer.microsoft.com/microsoft-edge/webview2/#download-section) or use a tested offline installer package. Do not show an in-app warning before any failure.
- **CJK fonts on Linux:** if labels render as missing glyph boxes, install a CJK font such as Noto Sans CJK from the distro's package manager, then reopen the app. If fonts render but composing Chinese fails, that is a distinct input-method issue; test native WebKitGTK with the actual input method. Do not warn users on startup merely because an optional font package was not detected.
- **Cloudflare:** optional for remote connections. Explain the missing connector or authorization when the user chooses public access; local workspaces should not prompt for Cloudflare or require account setup.
