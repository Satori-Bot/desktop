# Exercise one exact Tauri bundle on a clean, disposable Windows machine.
# Do not run this against an ordinary workstation or an installed copy.
[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateSet('msi', 'nsis')][string]$Kind,
    [Parameter(Mandatory)][string]$BundlePath,
    [Parameter(Mandatory)][string]$LogDirectory,
    [Parameter(Mandatory)][switch]$DisposableMachine,
    [ValidateSet('Any', 'Present', 'Absent')][string]$ExpectedWebView2 = 'Any',
    [ValidateRange(30, 600)][int]$TimeoutSeconds = 180,
    [ValidatePattern('^\d+\.\d+\.\d+$')][string]$ExpectedBundledUvVersion,
    [switch]$RequireMainWindow
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT -or -not $DisposableMachine) {
    throw 'Run on a disposable Windows machine only, with -DisposableMachine.'
}

$product = 'Coding Tools MCP'
$binary = 'coding-tools-mcp-desktop-native.exe'
$bundle = Get-Item -LiteralPath $BundlePath
$extension = if ($Kind -eq 'msi') { '.msi' } else { '.exe' }
if ($bundle.PSIsContainer -or $bundle.Extension -ne $extension) {
    throw "Expected a $Kind installer file ($extension)."
}
$logs = (New-Item -ItemType Directory -Force -Path $LogDirectory).FullName
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$isAdministrator = ([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator
)
$msiexec = Join-Path $env:SystemRoot 'System32\msiexec.exe'
$machineRoots = @($env:ProgramFiles, ${env:ProgramFiles(x86)}) | Where-Object { $_ } | Select-Object -Unique
$allRoots = @($machineRoots) + @($env:LOCALAPPDATA)
$uninstallBranches = @(
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*'
)

function Get-ProductEntries {
    foreach ($branch in $uninstallBranches) {
        Get-ItemProperty -Path $branch -Name DisplayName -ErrorAction SilentlyContinue |
            Where-Object { $_.PSObject.Properties['DisplayName'] -and $_.DisplayName -eq $product }
    }
}

function Get-WebViewVersion {
    # Same Evergreen runtime product and scopes used by the Tauri WiX search.
    $guid = '{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
    foreach ($root in @('HKLM:\SOFTWARE\WOW6432Node', 'HKLM:\SOFTWARE', 'HKCU:\SOFTWARE')) {
        $value = Get-ItemPropertyValue -LiteralPath "$root\Microsoft\EdgeUpdate\Clients\$guid" -Name pv -ErrorAction SilentlyContinue
        if ($value -and $value -ne '0.0.0.0') { $value }
    }
}

function Invoke-Installer(
    [string]$Phase,
    [string]$Executable,
    [string[]]$Arguments,
    [string]$OutputPath
) {
    $step = [ordered]@{ pid = $null; elapsedSeconds = $null; exitCode = $null; timedOut = $false }
    $result[$Phase] = $step
    $watch = [Diagnostics.Stopwatch]::StartNew()
    $parameters = @{ FilePath = $Executable; ArgumentList = $Arguments; PassThru = $true }
    $limit = $TimeoutSeconds
    if ($OutputPath) {
        $parameters.RedirectStandardOutput = $OutputPath
        $limit = 15
    }
    $worker = Start-Process @parameters
    $step.pid = $worker.Id
    try {
        if (-not $worker.WaitForExit($limit * 1000)) {
            $step.timedOut = $true
            if ($OutputPath) {
                # The standalone version probe is ours, not an installer/service.
                if (-not $worker.HasExited) { $worker.Kill() }
                throw "$Phase did not finish after $limit seconds."
            }
            # Do not kill the Windows Installer service or start a second transaction.
            # A timeout leaves the VM tainted; collect logs, then discard/reset it.
            throw "$Phase timed out after $TimeoutSeconds seconds. Preserve the logs and reset the disposable VM."
        }
        $step.exitCode = $worker.ExitCode
        if ($Kind -eq 'msi' -and $worker.ExitCode -in @(1641, 3010)) {
            throw "$Phase succeeded but requested a restart ($($worker.ExitCode)); first-launch/uninstall verification did not pass without reboot."
        }
        if ($worker.ExitCode -ne 0) {
            throw "$Phase failed (exit $($worker.ExitCode))."
        }
    } finally {
        $step.elapsedSeconds = [Math]::Round($watch.Elapsed.TotalSeconds, 2)
        $worker.Dispose()
    }
}

$result = [ordered]@{
    kind = $Kind
    bundle = $bundle.Name
    sha256 = (Get-FileHash -LiteralPath $bundle.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    os = [Runtime.InteropServices.RuntimeInformation]::OSDescription
    architecture = [Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
    isAdministrator = $isAdministrator
    expectedScope = $(if ($Kind -eq 'msi') { 'perMachine' } else { 'currentUser' })
    webViewBefore = @(Get-WebViewVersion)
    webViewAfter = @()
    install = $null
    bundledUvProbe = $null
    bundledUvVersion = $null
    launch = $null
    uninstall = $null
    errors = @()
    passed = $false
}
$app = $null
$installed = $false
$installedPath = $null

try {
    if ($Kind -eq 'msi' -and -not $isAdministrator) {
        throw 'This MSI is per-machine. Run the test from an already elevated PowerShell; /qn cannot prompt.'
    }
    if ($ExpectedWebView2 -eq 'Present' -and $result.webViewBefore.Count -eq 0) {
        throw 'WebView2 was expected on this VM, but Evergreen was not registered.'
    }
    if ($ExpectedWebView2 -eq 'Absent' -and $result.webViewBefore.Count -ne 0) {
        throw 'WebView2 is present; this VM cannot verify the missing-runtime path.'
    }
    if (@(Get-ProductEntries).Count -ne 0 -or (Get-Process -Name 'coding-tools-mcp-desktop-native' -ErrorAction SilentlyContinue) -or
        (Test-Path -LiteralPath (Join-Path $env:USERPROFILE '.coding-tools-mcp-desktop'))) {
        throw 'Existing app, process, or configuration found. Use a fresh Windows VM snapshot.'
    }
    foreach ($root in $allRoots) {
        if (Test-Path -LiteralPath (Join-Path $root $product)) {
            throw 'An existing installation directory was found. Use a fresh Windows VM snapshot.'
        }
    }

    if ($Kind -eq 'msi') {
        Invoke-Installer -Phase install -Executable $msiexec -Arguments @(
            '/i', "`"$($bundle.FullName)`"", '/qn', '/norestart', '/L*V!', "`"$logs\install-msi.log`""
        )
    } else {
        Invoke-Installer -Phase install -Executable $bundle.FullName -Arguments @('/S')
    }
    $installed = $true
    $candidateRoots = if ($Kind -eq 'msi') { $machineRoots } else { @($env:LOCALAPPDATA) }
    $candidates = @($candidateRoots | ForEach-Object {
        Join-Path (Join-Path $_ $product) $binary
    } | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf })
    if ($candidates.Count -ne 1 -or @(Get-ProductEntries).Count -ne 1) {
        throw 'Installer exited successfully but did not put exactly one registered executable in its default install scope.'
    }

    $installedPath = $candidates[0]
    if ($ExpectedBundledUvVersion) {
        $uv = Join-Path (Split-Path -Parent $installedPath) 'coding-tools-mcp-uv.exe'
        if (-not (Test-Path -LiteralPath $uv -PathType Leaf)) {
            throw 'Installed application is missing its bundled Core helper.'
        }
        $uvOutput = Join-Path $logs 'bundled-uv-version.txt'
        Invoke-Installer -Phase bundledUvProbe -Executable $uv -Arguments @('--version') -OutputPath $uvOutput
        $result.bundledUvVersion = (Get-Content -LiteralPath $uvOutput -Raw).Trim()
        if ($result.bundledUvVersion -notmatch ("^uv " + [regex]::Escape($ExpectedBundledUvVersion) + '(\s|$)')) {
            throw "Bundled Core helper did not report the pinned uv version $ExpectedBundledUvVersion."
        }
    }
    $result.launch = [ordered]@{ stayedRunning = $false; mainWindowObserved = $false }
    $app = Start-Process -FilePath $installedPath -PassThru
    $deadline = [datetime]::UtcNow.AddSeconds(30)
    while ([datetime]::UtcNow -lt $deadline) {
        if ($app.WaitForExit(500)) {
            throw "The installed desktop executable exited on first launch (exit $($app.ExitCode))."
        }
        $app.Refresh()
        if ($app.MainWindowHandle -ne [IntPtr]::Zero -and $app.MainWindowTitle -eq $product) {
            $result.launch.mainWindowObserved = $true
        }
        if (([datetime]::UtcNow -ge $deadline.AddSeconds(-25)) -and
            (-not $RequireMainWindow -or $result.launch.mainWindowObserved)) {
            $result.launch.stayedRunning = $true
            break
        }
    }
    if (-not $result.launch.stayedRunning) {
        throw 'The expected desktop window did not appear. An interactive Windows session is required for this check.'
    }
} catch {
    $result.errors += $_.Exception.Message
} finally {
    if ($app) {
        try {
            if (-not $app.HasExited) {
                # This application normally closes to tray. Terminate only the launch we own.
                $app.Kill()
                if (-not $app.WaitForExit(10000)) { throw 'Desktop process did not exit after termination.' }
            }
        } catch {
            $result.errors += $_.Exception.Message
        } finally {
            $app.Dispose()
        }
    }
    if ($installed) {
        try {
            if ($Kind -eq 'msi') {
                Invoke-Installer -Phase uninstall -Executable $msiexec -Arguments @(
                    '/x', "`"$($bundle.FullName)`"", '/qn', '/norestart', '/L*V!', "`"$logs\uninstall-msi.log`""
                )
            } elseif ($installedPath) {
                $uninstaller = Join-Path (Split-Path -Parent $installedPath) 'uninstall.exe'
                if (-not (Test-Path -LiteralPath $uninstaller -PathType Leaf)) { throw 'NSIS uninstaller was not found.' }
                Invoke-Installer -Phase uninstall -Executable $uninstaller -Arguments @('/S')
            }
            # NSIS may finish its copied uninstaller after the original launcher exits.
            $deadline = [datetime]::UtcNow.AddSeconds(20)
            do {
                $remaining = @($allRoots | ForEach-Object {
                    $directory = Join-Path $_ $product
                    Join-Path $directory $binary
                    if ($ExpectedBundledUvVersion) { Join-Path $directory 'coding-tools-mcp-uv.exe' }
                } | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf })
                if ($remaining.Count -eq 0 -and @(Get-ProductEntries).Count -eq 0) { break }
                if ([datetime]::UtcNow -ge $deadline) { throw 'Uninstall did not remove the app executable and registration.' }
                Start-Sleep -Milliseconds 250
            } while ($true)
        } catch {
            $result.errors += $_.Exception.Message
        }
    }
    $result.webViewAfter = @(Get-WebViewVersion)
    $result.passed = $result.errors.Count -eq 0 -and $null -ne $result.uninstall
    $result | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $logs 'windows-installer-result.json') -Encoding UTF8
}
$result | ConvertTo-Json -Depth 5
if (-not $result.passed) { exit 1 }
