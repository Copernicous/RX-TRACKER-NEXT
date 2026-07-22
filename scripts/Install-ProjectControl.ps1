[CmdletBinding()]
param([string]$TargetApp = '')

$ErrorActionPreference = 'Stop'
$source = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$target = if ([string]::IsNullOrWhiteSpace($TargetApp)) {
    'C:\RX-Tracker\RX-APP-NEXT'
} else { [IO.Path]::GetFullPath($TargetApp) }

function Fail([string]$Message) { throw $Message }

try {
    if (-not (Test-Path -LiteralPath $target -PathType Container)) { Fail "Target application folder not found: $target" }
    foreach ($required in @('server.exe', 'rx-db.exe', 'package.json', '.env')) {
        if (-not (Test-Path -LiteralPath (Join-Path $target $required) -PathType Leaf)) {
            Fail "Target does not look like the active compiled installation; missing $required."
        }
    }

    $files = @(
        'PROJECT-CONTROL.bat',
        'project-control.json',
        'scripts\project-control.ps1',
        'scripts\Invoke-ReleaseUpdate.ps1'
    )
    foreach ($file in $files) {
        if (-not (Test-Path -LiteralPath (Join-Path $source $file) -PathType Leaf)) {
            Fail "Bootstrap package is missing $file."
        }
    }

    if ($source -eq $target) {
        Write-Host 'Project Control 2.0 is already located in the target application folder.' -ForegroundColor Green
        exit 0
    }

    $installRoot = Split-Path $target -Parent
    $backup = Join-Path $installRoot ("control-backups\$(Get-Date -Format 'yyyyMMdd-HHmmss')")
    New-Item -ItemType Directory -Path $backup -Force | Out-Null
    foreach ($file in $files) {
        $existing = Join-Path $target $file
        if (Test-Path -LiteralPath $existing -PathType Leaf) {
            $backupFile = Join-Path $backup $file
            New-Item -ItemType Directory -Path (Split-Path $backupFile -Parent) -Force | Out-Null
            Copy-Item -LiteralPath $existing -Destination $backupFile -Force
        }
    }
    foreach ($file in $files) {
        $destination = Join-Path $target $file
        New-Item -ItemType Directory -Path (Split-Path $destination -Parent) -Force | Out-Null
        Copy-Item -LiteralPath (Join-Path $source $file) -Destination $destination -Force
    }

    Write-Host '[OK] Project Control 2.0 installed.' -ForegroundColor Green
    Write-Host "Target : $target"
    Write-Host "Backup : $backup"
    Write-Host 'No service, application executable, database, or .env value was changed.' -ForegroundColor Cyan
    Write-Host 'Run PROJECT-CONTROL.bat from the target folder and select option 15.' -ForegroundColor Yellow
} catch {
    Write-Host "[FAILED] $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
