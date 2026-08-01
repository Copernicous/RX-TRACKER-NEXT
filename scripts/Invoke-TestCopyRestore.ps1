[CmdletBinding()]
param(
    [ValidateSet('Interactive', 'SelfTest')]
    [string]$Action = 'Interactive',
    [string]$AppRoot = '',
    [string]$ServiceName = 'PatientRXSystem'
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$script:LockStream = $null

function Write-Step([string]$Message) { Write-Host "`n==> $Message" -ForegroundColor Cyan }
function Write-Ok([string]$Message) { Write-Host "[OK] $Message" -ForegroundColor Green }
function Fail([string]$Message) { throw $Message }

function Assert-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        Fail 'Run Project Control from an Administrator terminal.'
    }
}

function Initialize-Paths {
    $defaultRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
    $script:AppPath = [IO.Path]::GetFullPath($(if ($AppRoot) { $AppRoot } else { $defaultRoot }))
    $script:InstallPath = [IO.Path]::GetFullPath((Split-Path $script:AppPath -Parent))
    $script:EnvPath = Join-Path $script:AppPath '.env'
    $script:RxDbPath = Join-Path $script:AppPath 'rx-db.exe'
    $script:StateRoot = Join-Path $script:InstallPath 'deployment-state'
    $script:BackupRoot = Join-Path $script:InstallPath 'backups\test-copy-restore'
    $script:LockPath = Join-Path $script:StateRoot 'test-copy-restore.lock'
    $script:ReceiptPath = Join-Path $script:StateRoot 'test-copy-restore.json'

    foreach ($required in @($script:EnvPath, $script:RxDbPath)) {
        if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
            Fail "Required compiled installation file not found: $required"
        }
    }
}

function Acquire-Lock {
    New-Item -ItemType Directory -Path $script:StateRoot -Force | Out-Null
    try {
        $script:LockStream = [IO.File]::Open(
            $script:LockPath,
            [IO.FileMode]::OpenOrCreate,
            [IO.FileAccess]::ReadWrite,
            [IO.FileShare]::None
        )
    } catch {
        Fail 'Another test-copy restore operation is already running.'
    }
}

function Release-Lock {
    if ($script:LockStream) {
        $script:LockStream.Dispose()
        $script:LockStream = $null
    }
}

function Read-DotEnv([string]$PathValue) {
    $result = @{}
    foreach ($line in [IO.File]::ReadAllLines($PathValue)) {
        if ($line -notmatch '^\s*([^#][^=]*)=(.*)$') { continue }
        $key = $matches[1].Trim()
        $value = $matches[2].Trim()
        if (($value.StartsWith('"') -and $value.EndsWith('"')) -or
            ($value.StartsWith("'") -and $value.EndsWith("'"))) {
            if ($value.Length -ge 2) { $value = $value.Substring(1, $value.Length - 2) }
        }
        $result[$key] = $value
    }
    return $result
}

function Set-DotEnvValue([string]$PathValue, [string]$Name, [string]$Value) {
    $lines = [System.Collections.Generic.List[string]]::new()
    $found = $false
    foreach ($line in [IO.File]::ReadAllLines($PathValue)) {
        if ($line -match "^\s*$([regex]::Escape($Name))\s*=") {
            $lines.Add("$Name=$Value")
            $found = $true
        } else {
            $lines.Add($line)
        }
    }
    if (-not $found) { $lines.Add("$Name=$Value") }
    [IO.File]::WriteAllLines($PathValue, $lines, [Text.UTF8Encoding]::new($false))
}

function Assert-SafeTarget([string]$Target, [string]$Current) {
    if ($Target -notmatch '^[a-zA-Z0-9_]{1,63}$') {
        Fail 'The target database may contain only letters, numbers, and underscores.'
    }
    if ($Target -notmatch '(?i)(test|copy|sandbox|rehearsal|scratch)') {
        Fail 'The target database name must visibly contain test, copy, sandbox, rehearsal, or scratch.'
    }
    if ($Target -eq $Current -or $Target -in @('postgres', 'template0', 'template1')) {
        Fail "Refusing unsafe restore target: $Target"
    }
}

function ConvertTo-PlainText([Security.SecureString]$SecureValue) {
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureValue)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

function Find-PgBin([hashtable]$Config) {
    $candidates = @()
    if ($Config['PGBIN']) { $candidates += [string]$Config['PGBIN'] }
    $candidates += Get-ChildItem 'C:\Program Files\PostgreSQL' -Directory -ErrorAction SilentlyContinue |
        Sort-Object { [int]$(if ($_.Name -match '^\d+$') { $_.Name } else { 0 }) } -Descending |
        ForEach-Object { Join-Path $_.FullName 'bin' }
    foreach ($candidate in $candidates) {
        if ((Test-Path -LiteralPath (Join-Path $candidate 'pg_restore.exe')) -and
            (Test-Path -LiteralPath (Join-Path $candidate 'pg_dump.exe')) -and
            (Test-Path -LiteralPath (Join-Path $candidate 'psql.exe'))) {
            return [IO.Path]::GetFullPath($candidate)
        }
    }
    Fail 'PostgreSQL client tools were not found. Set PGBIN in .env.'
}

function Invoke-Pg([string]$Executable, [string[]]$Arguments, [string]$Password, [string]$Label) {
    $oldPassword = $env:PGPASSWORD
    try {
        $env:PGPASSWORD = $Password
        & $Executable @Arguments
        if ($LASTEXITCODE -ne 0) { Fail "$Label failed with exit code $LASTEXITCODE." }
    } finally {
        if ($null -eq $oldPassword) { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
        else { $env:PGPASSWORD = $oldPassword }
    }
}

function Invoke-RxDb([hashtable]$Config, [string[]]$Arguments, [hashtable]$Additional = @{}) {
    $names = @('DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASS', 'DB_NAME', 'PGBIN', 'RX_RUNTIME_DB_PASSWORD')
    $saved = @{}
    try {
        foreach ($name in $names) {
            $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
            [Environment]::SetEnvironmentVariable($name, $null, 'Process')
        }
        foreach ($name in @('DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASS', 'DB_NAME', 'PGBIN')) {
            if ($Config.ContainsKey($name)) {
                [Environment]::SetEnvironmentVariable($name, [string]$Config[$name], 'Process')
            }
        }
        foreach ($name in $Additional.Keys) {
            [Environment]::SetEnvironmentVariable($name, [string]$Additional[$name], 'Process')
        }
        & $script:RxDbPath @Arguments
        if ($LASTEXITCODE -ne 0) {
            Fail "rx-db $($Arguments[0]) failed with exit code $LASTEXITCODE."
        }
    } finally {
        foreach ($name in $names) {
            [Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process')
        }
    }
}

function Find-Nssm {
    $preferred = Join-Path $script:InstallPath 'nssm\win64\nssm.exe'
    if (Test-Path -LiteralPath $preferred -PathType Leaf) { return $preferred }
    $found = Get-ChildItem (Join-Path $script:InstallPath 'nssm') -Filter nssm.exe -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -match '(?i)win64' } | Select-Object -First 1
    if (-not $found) { Fail "nssm.exe was not found under $script:InstallPath\nssm." }
    return $found.FullName
}

function Get-EnvironmentPairs([string]$PathValue) {
    $pairs = @()
    foreach ($line in [IO.File]::ReadAllLines($PathValue)) {
        if ($line -match '^\s*([^#][^=]+)=(.*)$') {
            $pairs += "$($matches[1].Trim())=$($matches[2].Trim())"
        }
    }
    return $pairs
}

function Set-ServiceEnvironment {
    $nssm = Find-Nssm
    $pairs = @(Get-EnvironmentPairs $script:EnvPath)
    if (-not $pairs.Count) { Fail 'The application .env contains no service settings.' }
    & $nssm set $ServiceName AppEnvironmentExtra $pairs | Out-Null
    if ($LASTEXITCODE -ne 0) { Fail 'Could not synchronize the Windows service environment.' }
}

function Wait-ForHealth([string]$ExpectedVersion, [int]$TimeoutSeconds = 60) {
    $config = Read-DotEnv $script:EnvPath
    $port = if ($config['PORT']) { [int]$config['PORT'] } else { 3000 }
    $uri = "http://127.0.0.1:$port/api/healthz"
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        Start-Sleep 1
        try { $health = Invoke-RestMethod $uri -Headers @{ 'X-Forwarded-Proto' = 'https' } -TimeoutSec 5 }
        catch { $health = $null }
        if ($health -and $health.status -eq 'ok' -and $health.database -eq 'ok' -and
            [string]$health.version -eq $ExpectedVersion) {
            Write-Ok "Health check passed: version=$($health.version), database=ok, port=$port."
            return
        }
    } while ((Get-Date) -lt $deadline)
    Fail "RX Tracker did not become healthy at $uri."
}

function Stop-ServiceSafe {
    $service = Get-Service $ServiceName -ErrorAction Stop
    if ($service.Status -ne 'Stopped') {
        Stop-Service $ServiceName
        $service.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(30))
    }
}

function Start-ServiceSafe {
    $service = Get-Service $ServiceName -ErrorAction Stop
    if ($service.Status -ne 'Running') {
        Start-Service $ServiceName
        $service.WaitForStatus('Running', [TimeSpan]::FromSeconds(30))
    }
}

function Save-Receipt([hashtable]$Values) {
    New-Item -ItemType Directory -Path $script:StateRoot -Force | Out-Null
    [IO.File]::WriteAllText(
        $script:ReceiptPath,
        ($Values | ConvertTo-Json -Depth 6),
        [Text.UTF8Encoding]::new($false)
    )
}

function Invoke-SelfTest {
    Assert-SafeTarget 'patient_rx_restore_test' 'patient_rx_next'
    Assert-SafeTarget 'patient_rx_rehearsal_20260726' 'patient_rx_next'
    $failed = $false
    try { Assert-SafeTarget 'patient_rx_next' 'patient_rx_next' } catch { $failed = $true }
    if (-not $failed) { Fail 'Self-test failed to reject the active database.' }
    $failed = $false
    try { Assert-SafeTarget 'patient_rx_archive' 'patient_rx_next' } catch { $failed = $true }
    if (-not $failed) { Fail 'Self-test failed to reject an unmarked database name.' }
    Write-Ok 'Test-copy restore safety self-test passed.'
}

function Invoke-Interactive {
    Assert-Administrator
    Initialize-Paths
    Acquire-Lock
    $activated = $false
    $envBackup = $null
    $previousDatabase = $null
    $version = $null
    try {
        $runtime = Read-DotEnv $script:EnvPath
        foreach ($required in @('DB_HOST', 'DB_USER', 'DB_PASS', 'DB_NAME')) {
            if (-not $runtime[$required]) { Fail ".env is missing $required." }
        }
        $previousDatabase = [string]$runtime['DB_NAME']
        $version = [string]((Get-Content (Join-Path $script:AppPath 'package.json') -Raw | ConvertFrom-Json).version)
        Wait-ForHealth $version

        $dumpInput = Read-Host 'Complete path to the PostgreSQL .dump file'
        $dumpPath = [IO.Path]::GetFullPath($dumpInput.Trim().Trim('"'))
        if (-not (Test-Path -LiteralPath $dumpPath -PathType Leaf)) { Fail "Dump file not found: $dumpPath" }

        $defaultTarget = if ($previousDatabase -match '(?i)(_restore|_fresh|_test|_copy|_sandbox|_rehearsal|_scratch)$') {
            ($previousDatabase -replace '(?i)(_restore(?:_test|_\d+)?|_fresh|_test|_copy|_sandbox|_rehearsal|_scratch)$', '') + '_restore_test'
        } else { $previousDatabase + '_restore_test' }
        if ($defaultTarget -ieq $previousDatabase) { $defaultTarget = "${defaultTarget}_2" }
        $targetInput = Read-Host "Isolated target database [$defaultTarget]"
        $target = if ([string]::IsNullOrWhiteSpace($targetInput)) { $defaultTarget } else { $targetInput.Trim() }
        Assert-SafeTarget $target $previousDatabase

        $maintenanceInput = Read-Host 'PostgreSQL maintenance user [postgres]'
        $maintenanceUser = if ([string]::IsNullOrWhiteSpace($maintenanceInput)) { 'postgres' } else { $maintenanceInput.Trim() }
        $maintenancePassword = ConvertTo-PlainText (Read-Host "Password for PostgreSQL maintenance user $maintenanceUser" -AsSecureString)
        if (-not $maintenancePassword) { Fail 'A maintenance password is required.' }

        $pgBin = Find-PgBin $runtime
        $pgRestore = Join-Path $pgBin 'pg_restore.exe'
        $pgDump = Join-Path $pgBin 'pg_dump.exe'
        $psql = Join-Path $pgBin 'psql.exe'
        $createdb = Join-Path $pgBin 'createdb.exe'
        $dropdb = Join-Path $pgBin 'dropdb.exe'
        Invoke-Pg $pgRestore @('--list', $dumpPath) $maintenancePassword 'Dump validation'
        Write-Ok 'The selected file is a readable PostgreSQL custom-format dump.'

        $hostValue = [string]$runtime['DB_HOST']
        $portValue = if ($runtime['DB_PORT']) { [string]$runtime['DB_PORT'] } else { '5432' }
        $common = @('--host', $hostValue, '--port', $portValue, '--username', $maintenanceUser)
        $oldPgPassword = $env:PGPASSWORD
        try {
            $env:PGPASSWORD = $maintenancePassword
            $existsOutput = @(& $psql @common --dbname postgres --tuples-only --no-align `
                --command "SELECT 1 FROM pg_database WHERE datname = '$target';")
            if ($LASTEXITCODE -ne 0) { Fail 'Could not inspect the target database.' }
            $exists = (@($existsOutput | ForEach-Object { ([string]$_).Trim() }) -contains '1')
        } finally {
            if ($null -eq $oldPgPassword) { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
            else { $env:PGPASSWORD = $oldPgPassword }
        }

        New-Item -ItemType Directory -Path $script:BackupRoot -Force | Out-Null
        if ($exists) {
            $replacePhrase = "REPLACE:$target"
            Write-Host "Target $target already exists. It will be backed up before replacement." -ForegroundColor Yellow
            if ((Read-Host "Type $replacePhrase to continue") -cne $replacePhrase) {
                Fail 'Existing test-copy replacement was not confirmed.'
            }
            $backupPath = Join-Path $script:BackupRoot ("$target-before-replace-$(Get-Date -Format 'yyyyMMdd-HHmmss').dump")
            Invoke-Pg $pgDump (@($common) + @('--format', 'custom', '--file', $backupPath, $target)) $maintenancePassword 'Existing test-copy backup'
            Invoke-Pg $pgRestore @('--list', $backupPath) $maintenancePassword 'Existing test-copy backup validation'
            $hash = (Get-FileHash $backupPath -Algorithm SHA256).Hash
            [IO.File]::WriteAllText("$backupPath.sha256.txt", "$hash  $([IO.Path]::GetFileName($backupPath))`r`n", [Text.UTF8Encoding]::new($false))
            Invoke-Pg $psql (@($common) + @('--dbname', 'postgres', '--set', 'ON_ERROR_STOP=1',
                '--command', "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$target' AND pid <> pg_backend_pid();")) $maintenancePassword 'Target connection termination'
            Invoke-Pg $dropdb (@($common) + @('--if-exists', '--force', $target)) $maintenancePassword 'Existing test-copy removal'
        }
        Invoke-Pg $createdb (@($common) + @('--template', 'template0', $target)) $maintenancePassword 'Test-copy database creation'

        $maintenance = @{
            DB_HOST = $hostValue; DB_PORT = $portValue; DB_USER = $maintenanceUser
            DB_PASS = $maintenancePassword; DB_NAME = $target; PGBIN = $pgBin
        }
        Invoke-RxDb $maintenance @('restore-copy', '--dump', $dumpPath, '--confirm-database', $target)
        Invoke-RxDb $maintenance @('migrate')
        Invoke-RxDb $maintenance @('verify')
        Invoke-RxDb $maintenance @(
            'configure-runtime-role', '--role', [string]$runtime['DB_USER'], '--confirm-database', $target
        ) @{ RX_RUNTIME_DB_PASSWORD = [string]$runtime['DB_PASS'] }
        Invoke-RxDb $maintenance @('verify-runtime-role', '--role', [string]$runtime['DB_USER']) `
            @{ RX_RUNTIME_DB_PASSWORD = [string]$runtime['DB_PASS'] }
        Invoke-RxDb $maintenance @('business-fingerprint')
        Write-Ok "Restored and verified isolated database $target."

        $activate = Read-Host 'Activate this restored test copy for the RX Tracker service now? [Y/N]'
        if ($activate -notmatch '^(?i:y|yes)$') {
            Save-Receipt @{ status = 'restored_not_activated'; at = (Get-Date).ToString('o')
                sourceDumpSha256 = (Get-FileHash $dumpPath -Algorithm SHA256).Hash
                targetDatabase = $target; previousDatabase = $previousDatabase; version = $version }
            Write-Ok 'The verified copy was left inactive. No service or .env setting changed.'
            return
        }

        $envBackup = Join-Path $script:StateRoot ("env-before-test-copy-$(Get-Date -Format 'yyyyMMdd-HHmmss').backup")
        Copy-Item $script:EnvPath $envBackup -Force
        Stop-ServiceSafe
        Set-DotEnvValue $script:EnvPath 'DB_NAME' $target
        Set-ServiceEnvironment
        Start-ServiceSafe
        Wait-ForHealth $version
        $activated = $true
        Save-Receipt @{ status = 'active'; at = (Get-Date).ToString('o')
            sourceDumpSha256 = (Get-FileHash $dumpPath -Algorithm SHA256).Hash
            targetDatabase = $target; previousDatabase = $previousDatabase
            envBackup = $envBackup; version = $version }
        Write-Ok "Testing service is now using $target."
        Write-Host "Fallback database remains unchanged: $previousDatabase" -ForegroundColor DarkGray
    } catch {
        $failure = $_.Exception.Message
        Write-Host "[FAILED] $failure" -ForegroundColor Red
        if (-not $activated -and $envBackup -and (Test-Path $envBackup)) {
            Write-Host 'Attempting automatic service-configuration recovery...' -ForegroundColor Yellow
            try {
                Stop-ServiceSafe
                Copy-Item $envBackup $script:EnvPath -Force
                Set-ServiceEnvironment
                Start-ServiceSafe
                if ($version) { Wait-ForHealth $version }
                Write-Ok "Recovered the prior service database configuration: $previousDatabase"
            } catch {
                Write-Host "AUTOMATIC RECOVERY FAILED: $($_.Exception.Message)" -ForegroundColor Red
            }
        }
        throw
    } finally {
        $maintenancePassword = $null
        Release-Lock
    }
}

try {
    if ($Action -eq 'SelfTest') { Invoke-SelfTest }
    else { Invoke-Interactive }
} catch {
    Write-Host "[FAILED] $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
