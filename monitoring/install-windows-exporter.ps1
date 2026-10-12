<#
    CloudPulse - windows_exporter installer
    ---------------------------------------
    Installs windows_exporter as a Windows service on port 9182.
    This is what gives CloudPulse REAL host metrics (CPU, memory, disk,
    network) instead of simulated data.

    MUST be run from an ELEVATED (Administrator) PowerShell window:
        Right-click PowerShell -> "Run as Administrator"
        cd D:\cloudepluse\monitoring
        .\install-windows-exporter.ps1
#>

$ErrorActionPreference = 'Stop'

# --- Verify we are running as Administrator -------------------------------
$identity  = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "ERROR: This script must be run as Administrator." -ForegroundColor Red
    Write-Host "Close this window, open PowerShell as Administrator, and run it again."
    exit 1
}

# --- Already installed? ---------------------------------------------------
$existing = Get-Service -Name 'windows_exporter' -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "windows_exporter is already installed (status: $($existing.Status))." -ForegroundColor Yellow
    if ($existing.Status -ne 'Running') {
        Write-Host "Starting the service..."
        Start-Service -Name 'windows_exporter'
    }
    Write-Host "Done. Verify at: http://localhost:9182/metrics" -ForegroundColor Green
    exit 0
}

# --- Resolve the latest release from GitHub -------------------------------
Write-Host "Looking up the latest windows_exporter release..."
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$release = Invoke-RestMethod -Uri 'https://api.github.com/repos/prometheus-community/windows_exporter/releases/latest' `
                             -Headers @{ 'User-Agent' = 'CloudPulse-Setup' }

$asset = $release.assets | Where-Object { $_.name -like '*amd64.msi' } | Select-Object -First 1
if (-not $asset) {
    Write-Host "ERROR: Could not find an amd64 .msi in release $($release.tag_name)." -ForegroundColor Red
    Write-Host "Download it manually from: https://github.com/prometheus-community/windows_exporter/releases"
    exit 1
}

Write-Host "Found $($asset.name) (release $($release.tag_name))"

# --- Download -------------------------------------------------------------
$msiPath = Join-Path $env:TEMP $asset.name
Write-Host "Downloading to $msiPath ..."
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $msiPath -UseBasicParsing

# --- Install --------------------------------------------------------------
# Collectors chosen to cover exactly what CloudPulse monitors:
#   cpu           -> CPU utilisation
#   memory, cs,os -> memory utilisation (names vary by version; all three
#                    are enabled so the queries work on old and new builds)
#   logical_disk  -> disk utilisation
#   net           -> network throughput
#   system        -> uptime / server health
#   service       -> Windows service health
$collectors = 'cpu,cs,logical_disk,net,os,memory,system,service'

Write-Host "Installing windows_exporter service on port 9182..."
$args = @(
    '/i', "`"$msiPath`"",
    "ENABLED_COLLECTORS=`"$collectors`"",
    'LISTEN_PORT=9182',
    '/quiet', '/norestart'
)
$proc = Start-Process -FilePath 'msiexec.exe' -ArgumentList $args -Wait -PassThru
if ($proc.ExitCode -ne 0) {
    Write-Host "ERROR: msiexec failed with exit code $($proc.ExitCode)." -ForegroundColor Red
    exit 1
}

# --- Verify ---------------------------------------------------------------
Start-Sleep -Seconds 3
$svc = Get-Service -Name 'windows_exporter' -ErrorAction SilentlyContinue
if (-not $svc) {
    Write-Host "ERROR: Service was not registered. Check the MSI install log." -ForegroundColor Red
    exit 1
}
if ($svc.Status -ne 'Running') { Start-Service -Name 'windows_exporter' }

try {
    $resp = Invoke-WebRequest -Uri 'http://localhost:9182/metrics' -UseBasicParsing -TimeoutSec 10
    $count = ([regex]::Matches($resp.Content, '(?m)^windows_')).Count
    Write-Host ""
    Write-Host "SUCCESS - windows_exporter is running and exposing $count metric samples." -ForegroundColor Green
    Write-Host "Verify in a browser: http://localhost:9182/metrics"
} catch {
    Write-Host "Service installed, but scraping http://localhost:9182/metrics failed." -ForegroundColor Yellow
    Write-Host "Check Windows Firewall, then try the URL in a browser."
}

Remove-Item $msiPath -ErrorAction SilentlyContinue
