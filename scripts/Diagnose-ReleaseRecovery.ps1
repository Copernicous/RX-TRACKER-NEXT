[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$AppRoot,
    [string]$ServiceName = 'PatientRXSystem'
)

# Read-only: no database connections, service changes, restores, or file writes.
$ErrorActionPreference = 'Stop'
$app = (Resolve-Path -LiteralPath $AppRoot).Path
$install = Split-Path $app -Parent
$statePath = Join-Path $install 'deployment-state\release-update.json'
$packagePath = Join-Path $app 'package.json'
$helperPath = Join-Path $app 'scripts\Invoke-ReleaseUpdate.ps1'
if (-not (Test-Path -LiteralPath $statePath -PathType Leaf)) { throw "Update state not found: $statePath" }
$state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
$version = if (Test-Path -LiteralPath $packagePath) { (Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json).version } else { 'missing' }
$helper = if (Test-Path -LiteralPath $helperPath) { Get-Content -LiteralPath $helperPath -Raw } else { '' }
$service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
Write-Output "Installed package version: $version"
Write-Output "Service status: $(if ($service) { $service.Status } else { 'not found' })"
foreach ($key in @('status', 'previousVersion', 'targetVersion', 'failure', 'recoveryFailure')) {
    $value = [string]$state.$key
    # Avoid echoing a credential-bearing URI or explicit password from an error.
    $value = $value -replace '(?i)(password|DB_PASS|PGPASSWORD)\s*[=:]\s*\S+', '$1=[redacted]'
    $value = $value -replace '(?i)(postgres(?:ql)?://)[^\s@]+@', '$1[redacted]@'
    Write-Output "${key}: $value"
}
Write-Output "Updater supports Region gap validation: $($helper.Contains('regionalAssignmentGaps'))"
Write-Output "Updater supports manifest normalization: $($helper.Contains('function Normalize-ReleaseEntries'))"
$dump = [string]$state.databaseBackup
$dumpExists = $dump -and (Test-Path -LiteralPath $dump -PathType Leaf)
Write-Output "Recorded database backup exists: $([bool]$dumpExists)"
if ($dumpExists -and $state.databaseBackupHash) {
    Write-Output "Recorded backup checksum matches: $((Get-FileHash -LiteralPath $dump -Algorithm SHA256).Hash -eq [string]$state.databaseBackupHash)"
}
$manifestPath = [string]$state.filesManifest
if ($manifestPath -and (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    $manifest = @($manifest)
    $combined = @($manifest | Where-Object { [string]$_.Path -match '\s+(server\.exe|rx-db\.exe|PROJECT-CONTROL\.bat|package\.json|README\.md|CHANGELOG\.md)(\s|$)' })
    Write-Output "Application manifest entries: $($manifest.Count); malformed combined entries: $($combined.Count)"
} else { Write-Output 'Application manifest missing.' }
if ($state.applicationBackup) {
    foreach ($phase in @('before', 'after')) {
        $fingerprintPath = Join-Path ([string]$state.applicationBackup) "business-$phase.json"
        if (Test-Path -LiteralPath $fingerprintPath -PathType Leaf) {
            $fingerprint = Get-Content -LiteralPath $fingerprintPath -Raw | ConvertFrom-Json
            Write-Output "${phase}: PatientTagAssignments=$($fingerprint.tableCounts.PatientTagAssignments); regionalAssignmentGaps=$($fingerprint.regionalAssignmentGaps)"
        } else { Write-Output "${phase}: fingerprint missing" }
    }
}
Write-Output 'Diagnostic complete. No database, service, application, or backup was changed.'
