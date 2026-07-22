[CmdletBinding()]
param(
    [ValidateSet('Help', 'SelfTest', 'Status', 'Preflight', 'Rehearsal', 'StartRehearsal', 'StopRehearsal', 'Cutover', 'Rollback')]
    [string]$Action = 'Help',

    [string]$Root = 'C:\RX-Tracker',
    [string]$CurrentApp = '',
    [string]$NextApp = '',
    [string]$BackupDir = '',
    [string]$NextDatabase = 'patient_rx_next_cutover_copy',
    [string]$PgBin = '',
    [string]$ChecksumsFile = '',
    [int]$RehearsalPort = 3100,
    [string]$ServiceName = 'PatientRXSystem',
    [string]$Confirm = ''
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$script:State = $null
$script:StatePath = $null
$script:ResolvedPgBin = $null

function Write-Step([string]$Message) {
    Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Write-Ok([string]$Message) {
    Write-Host "[OK] $Message" -ForegroundColor Green
}

function Fail([string]$Message) {
    throw $Message
}

function Get-FullPath([string]$PathValue) {
    return [IO.Path]::GetFullPath($PathValue)
}

function Assert-PathUnderRoot([string]$PathValue, [string]$Label) {
    $rootPrefix = $script:RootPath.TrimEnd('\') + '\'
    $resolved = Get-FullPath $PathValue
    if (-not $resolved.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        Fail "$Label must stay under $script:RootPath. Received: $resolved"
    }
    return $resolved
}

function Initialize-Paths {
    $script:RootPath = Get-FullPath $Root
    $script:CurrentAppPath = Assert-PathUnderRoot `
        $(if ($CurrentApp) { $CurrentApp } else { Join-Path $script:RootPath 'RX-APP' }) `
        'Current application path'
    $script:NextAppPath = Assert-PathUnderRoot `
        $(if ($NextApp) { $NextApp } else { Join-Path $script:RootPath 'RX-APP-NEXT' }) `
        'NEXT application path'
    $script:BackupPath = Assert-PathUnderRoot `
        $(if ($BackupDir) { $BackupDir } else { Join-Path $script:RootPath 'backups' }) `
        'Backup path'

    if ($script:CurrentAppPath -eq $script:NextAppPath) {
        Fail 'CurrentApp and NextApp must be different folders.'
    }

    $stateDir = Assert-PathUnderRoot (Join-Path $script:RootPath 'deployment-state') 'State path'
    $script:StatePath = Join-Path $stateDir 'next-production.json'
}

function Assert-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        Fail 'Run PowerShell as Administrator for this action.'
    }
}

function Read-DotEnv([string]$PathValue) {
    if (-not (Test-Path -LiteralPath $PathValue -PathType Leaf)) {
        Fail ".env not found: $PathValue"
    }

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

function Set-DotEnvValue([string]$PathValue, [string]$Key, [string]$Value) {
    $lines = New-Object System.Collections.Generic.List[string]
    $found = $false
    foreach ($line in [IO.File]::ReadAllLines($PathValue)) {
        if ($line -match ('^\s*' + [Regex]::Escape($Key) + '\s*=')) {
            $lines.Add("$Key=$Value")
            $found = $true
        } else {
            $lines.Add($line)
        }
    }
    if (-not $found) { $lines.Add("$Key=$Value") }
    $utf8 = New-Object Text.UTF8Encoding($false)
    [IO.File]::WriteAllLines($PathValue, $lines, $utf8)
}

function Assert-RequiredEnvironment([hashtable]$Config, [string]$Label) {
    foreach ($key in @('DB_HOST', 'DB_USER', 'DB_PASS', 'DB_NAME', 'JWT_SECRET')) {
        if (-not $Config.ContainsKey($key) -or [string]::IsNullOrWhiteSpace([string]$Config[$key])) {
            Fail "$Label .env is missing required value $key."
        }
    }
}

function Get-AppVersion([string]$AppPath) {
    $packagePath = Join-Path $AppPath 'package.json'
    if (-not (Test-Path -LiteralPath $packagePath)) { return $null }
    return [string]((Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json).version)
}

function Get-ReleaseChecksums([string]$Version) {
    $content = $null
    if ($ChecksumsFile) {
        $resolved = Get-FullPath $ChecksumsFile
        if (-not (Test-Path -LiteralPath $resolved -PathType Leaf)) {
            Fail "Checksums file not found: $resolved"
        }
        $content = [IO.File]::ReadAllText($resolved)
    } else {
        $uri = "https://github.com/Copernicous/RX-TRACKER-NEXT/releases/download/v$Version/SHA256SUMS.txt"
        Write-Host "Downloading release checksums from $uri"
        $response = Invoke-WebRequest -Uri $uri -UseBasicParsing -TimeoutSec 45
        if ($response.Content -is [byte[]]) {
            $content = [Text.Encoding]::UTF8.GetString($response.Content)
        } else {
            $content = [string]$response.Content
        }
    }

    $checksums = @{}
    foreach ($line in ($content -split '\r?\n')) {
        if ($line -match '^([0-9a-fA-F]{64})\s+\*?(.+)$') {
            $checksums[$matches[2].Trim()] = $matches[1].ToLowerInvariant()
        }
    }
    return $checksums
}

function Assert-ReleaseFiles {
    $version = Get-AppVersion $script:NextAppPath
    if (-not $version) { Fail "package.json is missing from $script:NextAppPath" }

    $server = Join-Path $script:NextAppPath 'server.exe'
    $rxDb = Join-Path $script:NextAppPath 'rx-db.exe'
    foreach ($file in @($server, $rxDb)) {
        if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { Fail "Required executable missing: $file" }
    }

    $checksums = Get-ReleaseChecksums $version
    foreach ($name in @('server.exe', 'rx-db.exe')) {
        if (-not $checksums.ContainsKey($name)) {
            Fail "Official release checksum does not contain $name."
        }
        $actual = (Get-FileHash -LiteralPath (Join-Path $script:NextAppPath $name) -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actual -ne $checksums[$name]) {
            Fail "$name does not match the official v$version release checksum. Expected $($checksums[$name]); got $actual."
        }
        Write-Ok "$name matches the official v$version release."
    }

    $versionOutput = & $server --v 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0 -or $versionOutput -notmatch [Regex]::Escape($version)) {
        Fail "server.exe did not report expected version $version."
    }
    Write-Ok "NEXT executable version is $version."
    return $version
}

function Find-PgBin {
    $candidates = New-Object System.Collections.Generic.List[string]
    if ($PgBin) { $candidates.Add((Get-FullPath $PgBin)) }
    if ($env:PGBIN) { $candidates.Add((Get-FullPath $env:PGBIN)) }

    $services = Get-CimInstance Win32_Service -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match 'postgres' }
    foreach ($service in $services) {
        if ([string]$service.PathName -match '"?([^\"]+\\pg_ctl\.exe)"?') {
            $candidates.Add((Split-Path $matches[1] -Parent))
        }
    }

    $programFilesPostgres = Join-Path $env:ProgramFiles 'PostgreSQL'
    if (Test-Path -LiteralPath $programFilesPostgres) {
        Get-ChildItem -LiteralPath $programFilesPostgres -Directory -ErrorAction SilentlyContinue |
            Sort-Object { try { [version]$_.Name } catch { [version]'0.0' } } -Descending |
            ForEach-Object { $candidates.Add((Join-Path $_.FullName 'bin')) }
    }

    foreach ($candidate in ($candidates | Select-Object -Unique)) {
        if ((Test-Path -LiteralPath (Join-Path $candidate 'pg_dump.exe')) -and
            (Test-Path -LiteralPath (Join-Path $candidate 'pg_restore.exe'))) {
            $script:ResolvedPgBin = $candidate
            $env:PGBIN = $candidate
            Write-Ok "PostgreSQL tools: $candidate"
            return $candidate
        }
    }
    Fail 'PostgreSQL pg_dump.exe and pg_restore.exe were not found. Supply -PgBin explicitly.'
}

function Prepare-NextEnvironment {
    $currentEnv = Join-Path $script:CurrentAppPath '.env'
    $nextEnv = Join-Path $script:NextAppPath '.env'
    $current = Read-DotEnv $currentEnv
    Assert-RequiredEnvironment $current 'Current production'

    if ($NextDatabase -notmatch '(?i)(copy|qa|test|sandbox|rehearsal|scratch)') {
        Fail 'NextDatabase must contain copy, qa, test, sandbox, rehearsal, or scratch.'
    }
    if ($NextDatabase -eq [string]$current['DB_NAME']) {
        Fail 'NextDatabase must differ from the current production database.'
    }
    if ($NextDatabase -notmatch '^[A-Za-z0-9_-]{1,63}$') {
        Fail 'NextDatabase contains unsupported characters.'
    }

    Copy-Item -LiteralPath $currentEnv -Destination $nextEnv -Force
    Set-DotEnvValue $nextEnv 'DB_NAME' $NextDatabase
    $next = Read-DotEnv $nextEnv
    Assert-RequiredEnvironment $next 'NEXT'

    foreach ($key in @('DB_HOST', 'DB_USER', 'DB_PASS', 'JWT_SECRET', 'SETTINGS_ENCRYPTION_KEY',
        'SOFTPHONE_CREDENTIAL_KEY', 'SOFTPHONE_RELAY_SECRET', 'SOFTPHONE_ACCOUNT_ADMIN_PIN', 'APP_ORIGINS')) {
        if ($current.ContainsKey($key) -and [string]$current[$key] -ne [string]$next[$key]) {
            Fail "Protected configuration $key changed while preparing NEXT."
        }
    }

    Write-Ok "Copied production .env and changed only DB_NAME to $NextDatabase."
    return @{ Current = $current; Next = $next }
}

function Get-SafeConfigSummary([hashtable]$Config) {
    return "host=$($Config['DB_HOST']):$(if ($Config['DB_PORT']) { $Config['DB_PORT'] } else { '5432' }) database=$($Config['DB_NAME']) user=$($Config['DB_USER'])"
}

function Invoke-WithEnvironment([hashtable]$Config, [scriptblock]$Operation) {
    $previous = @{}
    foreach ($key in $Config.Keys) {
        $previous[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
        [Environment]::SetEnvironmentVariable($key, [string]$Config[$key], 'Process')
    }
    try {
        & $Operation
    } finally {
        foreach ($key in $Config.Keys) {
            [Environment]::SetEnvironmentVariable($key, $previous[$key], 'Process')
        }
    }
}

function Invoke-RxDb([hashtable]$NextConfig, [string[]]$Arguments) {
    $exe = Join-Path $script:NextAppPath 'rx-db.exe'
    Push-Location $script:NextAppPath
    try {
        Invoke-WithEnvironment $NextConfig {
            & $exe @Arguments
            if ($LASTEXITCODE -ne 0) {
                Fail "rx-db.exe $($Arguments -join ' ') failed with exit code $LASTEXITCODE."
            }
        }
    } finally {
        Pop-Location
    }
}

function New-DatabaseBackup([hashtable]$CurrentConfig, [string]$Label) {
    if (-not (Test-Path -LiteralPath $script:BackupPath)) {
        New-Item -ItemType Directory -Path $script:BackupPath | Out-Null
    }
    $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $database = [string]$CurrentConfig['DB_NAME']
    $fileName = "$database-$Label-$timestamp.dump"
    $dumpPath = Join-Path $script:BackupPath $fileName
    if (Test-Path -LiteralPath $dumpPath) { Fail "Backup target already exists: $dumpPath" }

    $pgDump = Join-Path $script:ResolvedPgBin 'pg_dump.exe'
    $pgRestore = Join-Path $script:ResolvedPgBin 'pg_restore.exe'
    $port = if ($CurrentConfig['DB_PORT']) { [string]$CurrentConfig['DB_PORT'] } else { '5432' }
    $oldPgPassword = [Environment]::GetEnvironmentVariable('PGPASSWORD', 'Process')
    [Environment]::SetEnvironmentVariable('PGPASSWORD', [string]$CurrentConfig['DB_PASS'], 'Process')
    try {
        & $pgDump `
            --host ([string]$CurrentConfig['DB_HOST']) `
            --port $port `
            --username ([string]$CurrentConfig['DB_USER']) `
            --format custom `
            --no-owner `
            --no-privileges `
            --file $dumpPath `
            $database
        if ($LASTEXITCODE -ne 0) { Fail "pg_dump failed with exit code $LASTEXITCODE." }

        & $pgRestore --list $dumpPath | Out-Null
        if ($LASTEXITCODE -ne 0) { Fail 'pg_restore could not validate the new backup.' }
    } finally {
        [Environment]::SetEnvironmentVariable('PGPASSWORD', $oldPgPassword, 'Process')
    }

    $item = Get-Item -LiteralPath $dumpPath
    if ($item.Length -le 0) { Fail 'The new database backup is empty.' }
    $hash = (Get-FileHash -LiteralPath $dumpPath -Algorithm SHA256).Hash
    $hashPath = "$dumpPath.sha256.txt"
    [IO.File]::WriteAllText($hashPath, "$hash  $fileName`r`n", (New-Object Text.UTF8Encoding($false)))
    Write-Ok "Backup created: $dumpPath"
    Write-Ok "Backup SHA-256: $hash"
    return @{ Path = $dumpPath; Hash = $hash; Size = $item.Length }
}

function Invoke-TargetRestoreAndMigration([hashtable]$CurrentConfig, [hashtable]$NextConfig, [string]$DumpPath) {
    Write-Step "Creating/restoring isolated NEXT database $NextDatabase"
    Invoke-RxDb $NextConfig @('create')
    Invoke-RxDb $NextConfig @('restore-copy', '--dump', $DumpPath, '--confirm-database', $NextDatabase)
    Invoke-RxDb $NextConfig @('inspect-v331')
    Invoke-RxDb $NextConfig @('adopt-v331', '--confirm-database', $NextDatabase)
    Invoke-RxDb $NextConfig @('migrate')
    Invoke-RxDb $NextConfig @('verify')
    Invoke-RxDb $NextConfig @('seed-reference')
    Invoke-RxDb $NextConfig @('verify')

    $comparisonConfig = $NextConfig.Clone()
    $comparisonConfig['SOURCE_DB_HOST'] = [string]$CurrentConfig['DB_HOST']
    $comparisonConfig['SOURCE_DB_PORT'] = if ($CurrentConfig['DB_PORT']) { [string]$CurrentConfig['DB_PORT'] } else { '5432' }
    $comparisonConfig['SOURCE_DB_USER'] = [string]$CurrentConfig['DB_USER']
    $comparisonConfig['SOURCE_DB_PASS'] = [string]$CurrentConfig['DB_PASS']
    $comparisonConfig['SOURCE_DB_NAME'] = [string]$CurrentConfig['DB_NAME']
    Invoke-RxDb $comparisonConfig @('compare-copy')
}

function Load-State {
    if (Test-Path -LiteralPath $script:StatePath) {
        $script:State = Get-Content -LiteralPath $script:StatePath -Raw | ConvertFrom-Json
    } else {
        $script:State = [pscustomobject]@{}
    }
    return $script:State
}

function Save-State([hashtable]$Values) {
    $stateDir = Split-Path $script:StatePath -Parent
    if (-not (Test-Path -LiteralPath $stateDir)) {
        New-Item -ItemType Directory -Path $stateDir | Out-Null
    }
    $existing = @{}
    if (Test-Path -LiteralPath $script:StatePath) {
        $loaded = Get-Content -LiteralPath $script:StatePath -Raw | ConvertFrom-Json
        foreach ($property in $loaded.PSObject.Properties) { $existing[$property.Name] = $property.Value }
    }
    foreach ($key in $Values.Keys) { $existing[$key] = $Values[$key] }
    $json = $existing | ConvertTo-Json -Depth 6
    [IO.File]::WriteAllText($script:StatePath, $json, (New-Object Text.UTF8Encoding($false)))
    $script:State = Get-Content -LiteralPath $script:StatePath -Raw | ConvertFrom-Json
}

function Invoke-Preflight {
    Write-Step 'Running production deployment preflight'
    foreach ($path in @($script:RootPath, $script:CurrentAppPath, $script:NextAppPath)) {
        if (-not (Test-Path -LiteralPath $path -PathType Container)) { Fail "Required folder missing: $path" }
    }
    $version = Assert-ReleaseFiles
    $configs = Prepare-NextEnvironment
    Find-PgBin | Out-Null
    Write-Ok "Current DB: $(Get-SafeConfigSummary $configs.Current)"
    Write-Ok "NEXT DB:    $(Get-SafeConfigSummary $configs.Next)"
    Write-Ok 'Preflight made no database or service changes.'
    return @{ Version = $version; Configs = $configs }
}

function Get-ServiceInfo {
    $service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if (-not $service) { Fail "Windows service $ServiceName was not found." }
    return $service
}

function Find-Nssm {
    $preferred = Join-Path $script:RootPath 'nssm\win64\nssm.exe'
    if (Test-Path -LiteralPath $preferred) { return $preferred }
    $found = Get-ChildItem -LiteralPath (Join-Path $script:RootPath 'nssm') -Filter nssm.exe -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -match '(?i)win64' } | Select-Object -First 1
    if (-not $found) { Fail "nssm.exe was not found under $script:RootPath\nssm." }
    return $found.FullName
}

function Select-FirstNativeValue([object[]]$OutputLines) {
    foreach ($line in @($OutputLines)) {
        $clean = ([string]$line).Replace([string][char]0, '').Trim().Trim('"').Trim()
        if ($clean) { return $clean }
    }
    return $null
}

function Get-ServiceApplication {
    $nssm = Find-Nssm
    $outputLines = @(& $nssm get $ServiceName Application 2>$null)
    $nssmExitCode = $LASTEXITCODE
    $application = Select-FirstNativeValue $outputLines
    if ($nssmExitCode -ne 0 -or -not $application) {
        Fail "Could not read the configured NSSM application for $ServiceName."
    }
    return $application
}

function Invoke-SelfTest {
    $expected = 'C:\RX-Tracker\RX-APP\server.exe'
    $sample = @($expected, '', ([string][char]0), '')
    $actual = Select-FirstNativeValue $sample
    if ($actual -ne $expected) {
        Fail "NSSM output parser self-test failed. Expected $expected; got $actual."
    }
    Write-Ok 'NSSM multiline/control-record parser self-test passed.'
}

function Set-ServiceApplication([string]$AppPath) {
    $nssm = Find-Nssm
    $server = Join-Path $AppPath 'server.exe'
    if (-not (Test-Path -LiteralPath $server)) { Fail "server.exe missing: $server" }

    & $nssm set $ServiceName Application $server | Out-Null
    if ($LASTEXITCODE -ne 0) { Fail 'Failed to set NSSM Application.' }
    & $nssm set $ServiceName AppDirectory $AppPath | Out-Null
    if ($LASTEXITCODE -ne 0) { Fail 'Failed to set NSSM AppDirectory.' }
    & $nssm reset $ServiceName AppEnvironmentExtra | Out-Null
    if ($LASTEXITCODE -ne 0) { Fail 'Failed to reset stale NSSM environment values.' }

    $logDir = Join-Path $script:RootPath 'logs'
    if (-not (Test-Path -LiteralPath $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
    & $nssm set $ServiceName AppStdout (Join-Path $logDir 'server-stdout.log') | Out-Null
    & $nssm set $ServiceName AppStderr (Join-Path $logDir 'server-stderr.log') | Out-Null
}

function Wait-ForHealth([string]$ExpectedVersion, [string]$AppPath = $script:NextAppPath, [int]$TimeoutSeconds = 45) {
    $appConfig = Read-DotEnv (Join-Path $AppPath '.env')
    $port = if ($appConfig['PORT']) { [int]$appConfig['PORT'] } else { 3000 }
    $uri = "http://127.0.0.1:$port/api/healthz"
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        Start-Sleep -Seconds 1
        try {
            $health = Invoke-RestMethod -Uri $uri -Headers @{ 'X-Forwarded-Proto' = 'https' } -TimeoutSec 5
            $versionMatches = -not $ExpectedVersion -or [string]$health.version -eq $ExpectedVersion
            if ($health.status -eq 'ok' -and $versionMatches -and $health.database -eq 'ok') {
                Write-Ok "Health check passed: $uri version=$($health.version) database=$($health.database)"
                return $health
            }
        } catch { }
    } while ((Get-Date) -lt $deadline)
    Fail "RX Tracker did not become healthy at $uri within $TimeoutSeconds seconds."
}

function Invoke-Status {
    Write-Host 'RX Tracker NEXT production deployment status' -ForegroundColor Cyan
    Write-Host "Root        : $script:RootPath"
    Write-Host "Current app : $script:CurrentAppPath"
    Write-Host "NEXT app    : $script:NextAppPath"
    Write-Host "Backups     : $script:BackupPath"
    Write-Host "Current ver : $(Get-AppVersion $script:CurrentAppPath)"
    Write-Host "NEXT ver    : $(Get-AppVersion $script:NextAppPath)"
    $service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    Write-Host "Service     : $(if ($service) { $service.Status } else { 'not found' })"
    if (Test-Path -LiteralPath (Join-Path $script:CurrentAppPath '.env')) {
        $current = Read-DotEnv (Join-Path $script:CurrentAppPath '.env')
        Write-Host "Current DB  : $(Get-SafeConfigSummary $current)"
    }
    if (Test-Path -LiteralPath (Join-Path $script:NextAppPath '.env')) {
        $next = Read-DotEnv (Join-Path $script:NextAppPath '.env')
        Write-Host "NEXT DB     : $(Get-SafeConfigSummary $next)"
    }
    if (Test-Path -LiteralPath $script:StatePath) {
        Write-Host "State       : $script:StatePath"
        Get-Content -LiteralPath $script:StatePath
    }
}

function Invoke-Rehearsal {
    Assert-Administrator
    $preflight = Invoke-Preflight
    $currentDb = [string]$preflight.Configs.Current['DB_NAME']
    $required = "REHEARSE:$currentDb->$NextDatabase"
    if ($Confirm -ne $required) {
        Fail "Rehearsal confirmation required: -Confirm '$required'"
    }
    $service = Get-ServiceInfo
    if ($service.Status -ne 'Running') { Fail 'Current production service must be running for the online rehearsal snapshot.' }
    $state = Load-State
    if ($state.cutoverComplete -eq $true) { Fail 'NEXT cutover is already recorded; rehearsal cannot overwrite the active NEXT database.' }
    $serviceApplication = Get-ServiceApplication
    if ((Get-FullPath $serviceApplication) -ne (Get-FullPath (Join-Path $script:CurrentAppPath 'server.exe'))) {
        Fail "Production service does not point to the current application: $serviceApplication"
    }

    Write-Step 'Creating online rehearsal backup; production remains running'
    $backup = New-DatabaseBackup $preflight.Configs.Current 'next-rehearsal'
    Invoke-TargetRestoreAndMigration $preflight.Configs.Current $preflight.Configs.Next $backup.Path
    Save-State @{
        releaseVersion = $preflight.Version
        sourceDatabase = $currentDb
        targetDatabase = $NextDatabase
        rehearsalReady = $true
        rehearsalAt = (Get-Date).ToString('o')
        rehearsalBackup = $backup.Path
        rehearsalBackupHash = $backup.Hash
        cutoverComplete = $false
    }
    Write-Ok 'Rehearsal completed. Production service was not stopped or changed.'
    Write-Host "Next optional step: run -Action StartRehearsal to test NEXT locally on port $RehearsalPort."
}

function Invoke-StartRehearsal {
    Assert-Administrator
    $preflight = Invoke-Preflight
    $state = Load-State
    if ($state.rehearsalReady -ne $true -or [string]$state.targetDatabase -ne $NextDatabase) {
        Fail 'A successful Rehearsal for this target database is required first.'
    }
    $existing = Get-NetTCPConnection -LocalPort $RehearsalPort -State Listen -ErrorAction SilentlyContinue
    if ($existing) { Fail "Port $RehearsalPort is already in use." }

    $config = $preflight.Configs.Next.Clone()
    $config['PORT'] = [string]$RehearsalPort
    $config['HTTPS_ALLOW_LOCAL_HTTP'] = 'true'
    $origins = [string]$config['APP_ORIGINS']
    $localOrigin = "http://127.0.0.1:$RehearsalPort"
    if ($origins -notmatch [Regex]::Escape($localOrigin)) {
        $config['APP_ORIGINS'] = ($origins.TrimEnd(',') + ',' + $localOrigin).TrimStart(',')
    }

    $stdout = Join-Path $script:BackupPath 'next-rehearsal-server.stdout.log'
    $stderr = Join-Path $script:BackupPath 'next-rehearsal-server.stderr.log'
    $server = Join-Path $script:NextAppPath 'server.exe'
    $process = Invoke-WithEnvironment $config {
        Start-Process -FilePath $server -WorkingDirectory $script:NextAppPath `
            -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
    }
    Start-Sleep -Seconds 2
    if ($process.HasExited) { Fail "Rehearsal server exited. Review $stderr" }
    Save-State @{ rehearsalPid = $process.Id; rehearsalPort = $RehearsalPort }

    $deadline = (Get-Date).AddSeconds(45)
    $uri = "http://127.0.0.1:$RehearsalPort/api/healthz"
    do {
        Start-Sleep -Seconds 1
        try {
            $health = Invoke-RestMethod -Uri $uri -Headers @{ 'X-Forwarded-Proto' = 'https' } -TimeoutSec 4
        } catch { $health = $null }
        if ($health -and $health.status -eq 'ok' -and $health.database -eq 'ok') {
            Write-Ok "Rehearsal server is ready: http://127.0.0.1:$RehearsalPort"
            Write-Host 'Stop it after testing with -Action StopRehearsal.' -ForegroundColor Yellow
            return
        }
    } while ((Get-Date) -lt $deadline)
    Fail "Rehearsal server did not become healthy. Review $stderr"
}

function Invoke-StopRehearsal {
    Assert-Administrator
    $state = Load-State
    $pidValue = 0
    if ($state.rehearsalPid) { $pidValue = [int]$state.rehearsalPid }
    if ($pidValue -le 0) {
        Write-Host 'No rehearsal PID is recorded.' -ForegroundColor Yellow
        return
    }
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$pidValue" -ErrorAction SilentlyContinue
    if ($process) {
        $expected = (Join-Path $script:NextAppPath 'server.exe')
        if (-not [string]$process.ExecutablePath -or
            (Get-FullPath $process.ExecutablePath) -ne (Get-FullPath $expected)) {
            Fail "Refusing to stop PID $pidValue because it is not the NEXT server executable."
        }
        Stop-Process -Id $pidValue
        Write-Ok "Stopped rehearsal server PID $pidValue."
    }
    Save-State @{ rehearsalPid = $null; rehearsalPort = $null }
}

function Stop-ProductionService {
    $service = Get-ServiceInfo
    if ($service.Status -ne 'Stopped') {
        Stop-Service -Name $ServiceName
        $service.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(30))
    }
    Write-Ok "Service $ServiceName is stopped."
}

function Start-ProductionService {
    Start-Service -Name $ServiceName
    (Get-Service -Name $ServiceName).WaitForStatus('Running', [TimeSpan]::FromSeconds(30))
    Write-Ok "Service $ServiceName is running."
}

function Invoke-Cutover {
    Assert-Administrator
    $preflight = Invoke-Preflight
    $state = Load-State
    $currentDb = [string]$preflight.Configs.Current['DB_NAME']
    $required = "CUTOVER:$currentDb->$NextDatabase"
    if ($Confirm -ne $required) { Fail "Production cutover confirmation required: -Confirm '$required'" }
    if ($state.rehearsalReady -ne $true -or [string]$state.targetDatabase -ne $NextDatabase -or
        [string]$state.releaseVersion -ne [string]$preflight.Version) {
        Fail 'A successful rehearsal of this release and target database is required before cutover.'
    }
    if ($state.cutoverComplete -eq $true) { Fail 'NEXT cutover is already recorded. Refusing to run it twice.' }
    if ($state.rehearsalPid) { Fail 'Stop the rehearsal server before production cutover.' }
    $serviceApplication = Get-ServiceApplication
    if ((Get-FullPath $serviceApplication) -ne (Get-FullPath (Join-Path $script:CurrentAppPath 'server.exe'))) {
        Fail "Production service does not point to the current application: $serviceApplication"
    }

    $serviceStopped = $false
    $serviceSwitched = $false
    try {
        Write-Step 'Beginning production downtime'
        Stop-ProductionService
        $serviceStopped = $true

        Write-Step 'Creating final stopped-system production backup'
        $backup = New-DatabaseBackup $preflight.Configs.Current 'before-next-cutover'
        Invoke-TargetRestoreAndMigration $preflight.Configs.Current $preflight.Configs.Next $backup.Path

        Write-Step 'Switching PatientRXSystem service to RX-APP-NEXT'
        $serviceSwitched = $true
        Set-ServiceApplication $script:NextAppPath
        Start-ProductionService
        Wait-ForHealth $preflight.Version | Out-Null

        Save-State @{
            cutoverComplete = $true
            cutoverAt = (Get-Date).ToString('o')
            cutoverBackup = $backup.Path
            cutoverBackupHash = $backup.Hash
            activeApp = $script:NextAppPath
        }
        Write-Ok 'Production cutover completed.'
        Write-Host 'Complete controlled acceptance before reopening the system to all users.' -ForegroundColor Yellow
    } catch {
        Write-Host "Cutover failed: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host 'Restoring the service to the unchanged 3.3.1 application.' -ForegroundColor Yellow
        try {
            if ((Get-Service -Name $ServiceName -ErrorAction SilentlyContinue).Status -ne 'Stopped') {
                Stop-Service -Name $ServiceName -Force
            }
            if ($serviceSwitched) { Set-ServiceApplication $script:CurrentAppPath }
            if ($serviceStopped) {
                Start-ProductionService
                Wait-ForHealth (Get-AppVersion $script:CurrentAppPath) $script:CurrentAppPath | Out-Null
            }
        } catch {
            Write-Host "Automatic service recovery also failed: $($_.Exception.Message)" -ForegroundColor Red
        }
        throw
    }
}

function Invoke-Rollback {
    Assert-Administrator
    $state = Load-State
    $required = "ROLLBACK:$NextDatabase"
    if ($Confirm -ne $required) { Fail "Rollback confirmation required: -Confirm '$required'" }
    if ($state.cutoverComplete -ne $true) { Fail 'No completed NEXT cutover is recorded.' }

    Write-Host 'WARNING: records created after NEXT cutover are not copied back to the old database.' -ForegroundColor Red
    Stop-ProductionService
    Set-ServiceApplication $script:CurrentAppPath
    Start-ProductionService
    Wait-ForHealth (Get-AppVersion $script:CurrentAppPath) $script:CurrentAppPath | Out-Null

    Save-State @{
        cutoverComplete = $false
        rolledBackAt = (Get-Date).ToString('o')
        activeApp = $script:CurrentAppPath
    }
    Write-Ok 'Service returned to the unchanged 3.3.1 application and database.'
}

function Show-Help {
    @'
RX Tracker NEXT guarded production deployment

Run from an Administrator PowerShell terminal. Recommended order:

  1. Preflight
     .\scripts\Invoke-NextProduction.ps1 -Action Preflight

  2. Rehearsal while production remains online
     .\scripts\Invoke-NextProduction.ps1 -Action Rehearsal `
       -Confirm 'REHEARSE:patient_rx_dev->patient_rx_next_cutover_copy'

  3. Optional local UI test on port 3100
     .\scripts\Invoke-NextProduction.ps1 -Action StartRehearsal
     .\scripts\Invoke-NextProduction.ps1 -Action StopRehearsal

  4. Scheduled production cutover
     .\scripts\Invoke-NextProduction.ps1 -Action Cutover `
       -Confirm 'CUTOVER:patient_rx_dev->patient_rx_next_cutover_copy'

  5. Early acceptance-window rollback if required
     .\scripts\Invoke-NextProduction.ps1 -Action Rollback `
       -Confirm 'ROLLBACK:patient_rx_next_cutover_copy'

Preflight verifies official GitHub release checksums, copies the current .env,
changes only DB_NAME in the NEXT copy, locates PostgreSQL tools, and makes no
database or service changes. Rehearsal and Cutover create custom-format backups
and SHA-256 records. The original application and database are never migrated.

Use -PgBin when PostgreSQL tools are in a nonstandard location. Use
-ChecksumsFile for an offline copy of the release SHA256SUMS.txt file.
'@ | Write-Host
}

if ($Action -eq 'Help') {
    Show-Help
    exit 0
}

if ($Action -eq 'SelfTest') {
    Invoke-SelfTest
    exit 0
}

Initialize-Paths

try {
    switch ($Action) {
        'Status' { Invoke-Status }
        'Preflight' { Invoke-Preflight | Out-Null }
        'Rehearsal' { Invoke-Rehearsal }
        'StartRehearsal' { Invoke-StartRehearsal }
        'StopRehearsal' { Invoke-StopRehearsal }
        'Cutover' { Invoke-Cutover }
        'Rollback' { Invoke-Rollback }
    }
} catch {
    Write-Host "`n[FAILED] $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
