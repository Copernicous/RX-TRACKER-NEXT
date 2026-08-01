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
    $script:ServerPath = [IO.Path]::GetFullPath((Join-Path $script:AppPath 'server.exe'))
    $script:StateRoot = Join-Path $script:InstallPath 'deployment-state'
    $script:BackupRoot = Join-Path $script:InstallPath 'backups\test-copy-restore'
    $script:LockPath = Join-Path $script:StateRoot 'test-copy-restore.lock'
    $script:ReceiptPath = Join-Path $script:StateRoot 'test-copy-restore.json'

    foreach ($required in @($script:EnvPath, $script:RxDbPath, $script:ServerPath)) {
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
    if ($Target -notmatch '(?i)(?:^|_)(?:test|copy|sandbox|rehearsal|scratch)(?:_|$)') {
        Fail 'The target database name must contain a delimited test, copy, sandbox, rehearsal, or scratch token.'
    }
    if ($Target -match '(?i)(?:^|_)(?:prod|production|live)(?:_|$)') {
        Fail 'The target database name must not contain a production or live token.'
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

function Select-FirstNativeValue([object[]]$OutputLines) {
    foreach ($line in @($OutputLines)) {
        $clean = ([string]$line).Replace([string][char]0, '').Trim().Trim('"').Trim()
        if ($clean) { return $clean }
    }
    return $null
}

function Get-NssmEnvironmentPairs {
    $nssm = Find-Nssm
    $output = @(& $nssm get $ServiceName AppEnvironmentExtra 2>$null)
    if ($LASTEXITCODE -ne 0) { Fail 'Could not read the NSSM service environment.' }
    $pairs = @()
    foreach ($line in $output) {
        $expanded = ([string]$line).Replace([string][char]0, "`n")
        foreach ($entry in ($expanded -split "`r?`n")) {
            $clean = $entry.Trim()
            if ($clean) { $pairs += $clean }
        }
    }
    return $pairs
}

function Assert-ServiceTargetsApp {
    $service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if (-not $service) { Fail "Windows service $ServiceName was not found." }
    $nssm = Find-Nssm
    $configured = Select-FirstNativeValue @(& $nssm get $ServiceName Application 2>$null)
    if ($LASTEXITCODE -ne 0 -or -not $configured) { Fail 'Could not read the NSSM service application.' }
    if ([IO.Path]::GetFullPath($configured) -ine $script:ServerPath) {
        Fail "Service points to $configured instead of $($script:ServerPath)."
    }
    return $service
}

function Get-ServiceEnvironmentValue([string[]]$Pairs, [string]$Name) {
    $values = @()
    foreach ($pair in $Pairs) {
        if ($pair -match "(?i)^$([regex]::Escape($Name))=(.*)$") {
            $value = $matches[1].Trim()
            if (($value.StartsWith('"') -and $value.EndsWith('"')) -or
                ($value.StartsWith("'") -and $value.EndsWith("'"))) {
                if ($value.Length -ge 2) { $value = $value.Substring(1, $value.Length - 2) }
            }
            $values += $value
        }
    }
    return $values
}

function Assert-ServiceEnvironmentPairValues(
    [string[]]$Pairs,
    [string]$ExpectedDatabase,
    [string]$ExpectedToken = '',
    [switch]$AllowDotEnvFallback
) {
    $databaseValues = @(Get-ServiceEnvironmentValue $Pairs 'DB_NAME')
    $usesDotEnvFallback = $AllowDotEnvFallback -and -not $ExpectedToken -and $databaseValues.Count -eq 0
    if (-not $usesDotEnvFallback -and
        ($databaseValues.Count -ne 1 -or $databaseValues[0] -cne $ExpectedDatabase)) {
        Fail "NSSM service environment does not target the exact database $ExpectedDatabase."
    }
    $tokenValues = @(Get-ServiceEnvironmentValue $pairs 'RX_LOCAL_HEALTH_TOKEN')
    if ($ExpectedToken) {
        if ($tokenValues.Count -ne 1 -or $tokenValues[0] -cne $ExpectedToken) {
            Fail 'NSSM service environment does not contain the expected one-time health token.'
        }
    } elseif ($tokenValues.Count -ne 0) {
        Fail 'NSSM service environment retained a local health token.'
    }
}

function Assert-ServiceEnvironmentTargetsDatabase(
    [string]$ExpectedDatabase,
    [string]$ExpectedToken = '',
    [switch]$AllowDotEnvFallback
) {
    $pairs = @(Get-NssmEnvironmentPairs)
    Assert-ServiceEnvironmentPairValues $pairs $ExpectedDatabase $ExpectedToken `
        -AllowDotEnvFallback:$AllowDotEnvFallback
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

function Set-ServiceEnvironment([string]$ExpectedDatabase, [string]$VerificationToken = '') {
    Assert-ServiceTargetsApp | Out-Null
    $nssm = Find-Nssm
    $pairs = @(Get-EnvironmentPairs $script:EnvPath | Where-Object { $_ -notmatch '(?i)^RX_LOCAL_HEALTH_TOKEN=' })
    if ($VerificationToken) { $pairs += "RX_LOCAL_HEALTH_TOKEN=$VerificationToken" }
    if (-not $pairs.Count) { Fail 'The application .env contains no service settings.' }
    & $nssm reset $ServiceName AppEnvironmentExtra | Out-Null
    if ($LASTEXITCODE -ne 0) { Fail 'Could not clear the previous Windows service environment.' }
    & $nssm set $ServiceName AppEnvironmentExtra $pairs | Out-Null
    if ($LASTEXITCODE -ne 0) { Fail 'Could not synchronize the Windows service environment.' }
    Assert-ServiceEnvironmentTargetsDatabase $ExpectedDatabase $VerificationToken
}

function Get-TestCopyBaseDatabase([string]$DatabaseName) {
    $markers = 'restore|fresh|test|copy|sandbox|rehearsal|scratch'
    $pattern = "(?i)_(?:$markers)(?:_(?:$markers|[0-9]+))*$"
    return [regex]::Replace([string]$DatabaseName, $pattern, '')
}

function New-LocalHealthToken {
    $bytes = New-Object byte[] 32
    $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $generator.GetBytes($bytes) } finally { $generator.Dispose() }
    return ([BitConverter]::ToString($bytes)).Replace('-', '').ToLowerInvariant()
}

function Assert-HealthProcessBinding([object]$Health, [int]$Port) {
    $pidValue = 0
    if (-not [int]::TryParse([string]$Health.pid, [ref]$pidValue) -or $pidValue -le 0) {
        Fail 'Health response did not contain a valid process ID.'
    }
    $listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
        Where-Object { [int]$_.OwningProcess -eq $pidValue } | Select-Object -First 1
    if (-not $listener) { Fail "Health process $pidValue does not own listening port $Port." }

    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $pidValue" -ErrorAction Stop
    if (-not $process -or -not $process.ExecutablePath -or
        [IO.Path]::GetFullPath([string]$process.ExecutablePath) -ine $script:ServerPath) {
        Fail "Health process $pidValue is not the intended executable $($script:ServerPath)."
    }
    $escapedServiceName = $ServiceName.Replace("'", "''")
    $serviceInstance = Get-CimInstance Win32_Service -Filter "Name = '$escapedServiceName'" -ErrorAction Stop
    if (-not $serviceInstance -or [int]$serviceInstance.ProcessId -le 0 -or
        [int]$process.ParentProcessId -ne [int]$serviceInstance.ProcessId) {
        Fail "Health process $pidValue is not the child of Windows service $ServiceName."
    }
}

function Wait-ForHealth(
    [string]$ExpectedVersion,
    [string]$ExpectedDatabase = '',
    [string]$VerificationToken = '',
    [int]$TimeoutSeconds = 60
) {
    $config = Read-DotEnv $script:EnvPath
    $port = if ($config['PORT']) { [int]$config['PORT'] } else { 3000 }
    $uri = "http://127.0.0.1:$port/api/healthz"
    $headers = @{ 'X-Forwarded-Proto' = 'https' }
    if ($VerificationToken) { $headers['X-RX-Local-Health-Token'] = $VerificationToken }
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        Start-Sleep 1
        try { $health = Invoke-RestMethod $uri -Headers $headers -TimeoutSec 5 }
        catch { $health = $null }
        if ($health -and $health.status -eq 'ok' -and $health.database -eq 'ok' -and
            [string]$health.version -eq $ExpectedVersion) {
            if ($VerificationToken) {
                if (-not $health.localVerification) {
                    continue
                }
                if ([string]$health.localVerification.databaseName -cne $ExpectedDatabase) {
                    Fail "Health verification did not confirm exact database $ExpectedDatabase."
                }
                $reportedExecutable = [string]$health.localVerification.executablePath
                if (-not $reportedExecutable -or
                    [IO.Path]::GetFullPath($reportedExecutable) -ine $script:ServerPath) {
                    Fail 'Health verification did not confirm the intended server executable.'
                }
            }
            Assert-HealthProcessBinding $health $port
            Write-Ok "Health check passed: version=$($health.version), database=ok, port=$port."
            return $health
        }
    } while ((Get-Date) -lt $deadline)
    Fail "RX Tracker did not become healthy at $uri."
}

function Stop-ServiceSafe {
    $service = Assert-ServiceTargetsApp
    if ($service.Status -ne 'Stopped') {
        Stop-Service $ServiceName
        $service.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(30))
    }
}

function Start-ServiceSafe {
    $service = Assert-ServiceTargetsApp
    if ($service.Status -ne 'Running') {
        Start-Service $ServiceName
        $service.WaitForStatus('Running', [TimeSpan]::FromSeconds(30))
    }
    Assert-ServiceTargetsApp | Out-Null
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
    Assert-SafeTarget 'patient_rx_copy_2' 'patient_rx_next'
    foreach ($case in @(
        @{ Name = 'patient_rx_restore_restore_test'; Expected = 'patient_rx' },
        @{ Name = 'patient_rx_restore_restore_restore_test'; Expected = 'patient_rx' },
        @{ Name = 'patient_rx_restore_restore_test_2'; Expected = 'patient_rx' },
        @{ Name = 'patient_rx_restore_3_restore'; Expected = 'patient_rx' },
        @{ Name = 'patient_rx_restore_test_2_restore_test'; Expected = 'patient_rx' },
        @{ Name = 'patient_rx_test_2_restore_3_copy_9'; Expected = 'patient_rx' },
        @{ Name = 'patient_rx_2026_restore_test_2'; Expected = 'patient_rx_2026' },
        @{ Name = 'patient_rx_contest_restore_test_2'; Expected = 'patient_rx_contest' },
        @{ Name = 'patient_rx'; Expected = 'patient_rx' }
    )) {
        $actual = Get-TestCopyBaseDatabase $case.Name
        if ($actual -cne $case.Expected) {
            Fail "Restore base normalization failed for $($case.Name): expected $($case.Expected), received $actual."
        }
    }
    foreach ($unsafe in @(
        'patient_rx_next', 'patient_rx_archive', 'patient_rx_contest', 'patient_rx_copycat',
        'patient_rx_testdata', 'patient_rx_sandboxed', 'patient_rx_scratchpad',
        'patient_rx_rehearsal2', 'patient_rx_production_test', 'patient_rx_live_copy'
    )) {
        $failed = $false
        try { Assert-SafeTarget $unsafe 'patient_rx_next' } catch { $failed = $true }
        if (-not $failed) { Fail "Self-test failed to reject unsafe target $unsafe." }
    }
    $tokens = @($(New-LocalHealthToken), $(New-LocalHealthToken))
    if ($tokens[0] -notmatch '^[a-f0-9]{64}$' -or $tokens[0] -ceq $tokens[1]) {
        Fail 'One-time local health token generation failed.'
    }
    Assert-ServiceEnvironmentPairValues @() 'patient_rx_next' -AllowDotEnvFallback
    foreach ($case in @(
        @{ Pairs = @(); AllowFallback = $false },
        @{ Pairs = @('DB_NAME=patient_rx_other'); AllowFallback = $true },
        @{ Pairs = @('DB_NAME=patient_rx_next', 'DB_NAME=patient_rx_next'); AllowFallback = $true },
        @{ Pairs = @('RX_LOCAL_HEALTH_TOKEN=stale'); AllowFallback = $true }
    )) {
        $failed = $false
        try {
            Assert-ServiceEnvironmentPairValues $case.Pairs 'patient_rx_next' '' `
                -AllowDotEnvFallback:$case.AllowFallback
        } catch { $failed = $true }
        if (-not $failed) { Fail 'Service-environment fallback self-test accepted an unsafe database source.' }
    }
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
        Assert-ServiceTargetsApp | Out-Null
        Assert-ServiceEnvironmentTargetsDatabase $previousDatabase -AllowDotEnvFallback
        Wait-ForHealth $version | Out-Null

        $dumpInput = Read-Host 'Complete path to the PostgreSQL .dump file'
        $dumpPath = [IO.Path]::GetFullPath($dumpInput.Trim().Trim('"'))
        if (-not (Test-Path -LiteralPath $dumpPath -PathType Leaf)) { Fail "Dump file not found: $dumpPath" }

        $baseDatabase = Get-TestCopyBaseDatabase $previousDatabase
        $defaultTarget = "${baseDatabase}_restore_test"
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
        $verificationToken = New-LocalHealthToken
        Set-ServiceEnvironment $target $verificationToken
        Start-ServiceSafe
        Set-ServiceEnvironment $target
        Wait-ForHealth $version $target $verificationToken | Out-Null
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
                $recoveryToken = New-LocalHealthToken
                Set-ServiceEnvironment $previousDatabase $recoveryToken
                Start-ServiceSafe
                Set-ServiceEnvironment $previousDatabase
                if ($version) { Wait-ForHealth $version $previousDatabase $recoveryToken | Out-Null }
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
