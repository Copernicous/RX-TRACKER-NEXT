[CmdletBinding()]
param(
    [ValidateSet('Install', 'ValidatePackage')]
    [string]$Action = 'Install',

    [string]$InstallRoot = 'C:\RX-Tracker',
    [string]$AppFolderName = 'RX-APP-NEXT',
    [string]$ServiceName = 'PatientRXSystem',
    [switch]$NoService,
    [switch]$NonInteractive,

    [string]$ServerAddress,
    [int]$Port = 3000,
    [string]$PublicOrigins,

    [string]$DatabaseHost = '127.0.0.1',
    [int]$DatabasePort = 5432,
    [string]$DatabaseName = 'patient_rx_next',
    [string]$MaintenanceUser = 'postgres',
    [string]$MaintenanceDatabase = 'postgres',
    [string]$PgBin,

    [string]$AdminUsername = 'admin',
    [string]$AdminEmail = 'admin@rxsystem.local'
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$PackageRoot = [System.IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))
$Destination = [System.IO.Path]::GetFullPath((Join-Path $InstallRoot $AppFolderName))
$LogRoot = [System.IO.Path]::GetFullPath((Join-Path $InstallRoot 'logs'))
$BackupRoot = [System.IO.Path]::GetFullPath((Join-Path $InstallRoot 'backups'))
$NssmExe = [System.IO.Path]::GetFullPath((Join-Path $InstallRoot 'nssm\win64\nssm.exe'))
$EnvPath = Join-Path $Destination '.env'
$ReceiptPath = Join-Path $Destination 'new-server-installation.json'
$RequiredPackageFiles = @(
    'server.exe',
    'rx-db.exe',
    'PROJECT-CONTROL.bat',
    'project-control.json',
    'scripts\project-control.ps1',
    'scripts\Invoke-ReleaseUpdate.ps1',
    'scripts\Install-NewServer.ps1'
)

function Write-Step([string]$Message) {
    Write-Host ''
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Write-Ok([string]$Message) {
    Write-Host "[OK] $Message" -ForegroundColor Green
}

function Fail([string]$Message) {
    throw $Message
}

function Test-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Assert-SafeDestination {
    $root = [System.IO.Path]::GetPathRoot($Destination)
    if (-not $root -or $Destination.TrimEnd('\') -eq $root.TrimEnd('\')) {
        Fail "Unsafe application destination: $Destination"
    }
    if ($Destination.TrimEnd('\') -eq [Environment]::GetFolderPath('UserProfile').TrimEnd('\')) {
        Fail 'The application destination cannot be the Windows user profile.'
    }
    if (-not $Destination.StartsWith([System.IO.Path]::GetFullPath($InstallRoot).TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) {
        Fail "Application destination must remain inside $InstallRoot."
    }
}

function Assert-Package {
    foreach ($relativePath in $RequiredPackageFiles) {
        $path = Join-Path $PackageRoot $relativePath
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
            Fail "Portable package is incomplete. Missing: $relativePath"
        }
    }
    foreach ($forbidden in @('.env', '.env.staging')) {
        if (Test-Path -LiteralPath (Join-Path $PackageRoot $forbidden)) {
            Fail "Portable package must not contain a reusable secret file: $forbidden"
        }
    }
    Write-Ok "Portable package payload verified at $PackageRoot."
}

function Read-Value([string]$Prompt, [string]$DefaultValue) {
    if ($NonInteractive) { return $DefaultValue }
    $suffix = if ($DefaultValue) { " [$DefaultValue]" } else { '' }
    $value = Read-Host "$Prompt$suffix"
    if ([string]::IsNullOrWhiteSpace($value)) { return $DefaultValue }
    return $value.Trim()
}

function Convert-SecureToPlain([Security.SecureString]$SecureValue) {
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureValue)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
}

function Read-Secret([string]$Prompt, [string]$EnvironmentName) {
    $fromEnvironment = [Environment]::GetEnvironmentVariable($EnvironmentName, 'Process')
    if (-not [string]::IsNullOrEmpty($fromEnvironment)) {
        return $fromEnvironment
    }
    if ($NonInteractive) {
        Fail "Set $EnvironmentName in the current process for non-interactive installation."
    }
    $secure = Read-Host $Prompt -AsSecureString
    $plain = Convert-SecureToPlain $secure
    if ([string]::IsNullOrEmpty($plain)) {
        Fail "$Prompt cannot be empty."
    }
    return $plain
}

function New-RandomHex([int]$ByteCount = 48) {
    $bytes = New-Object byte[] $ByteCount
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $rng.GetBytes($bytes)
    } finally {
        $rng.Dispose()
    }
    return ([BitConverter]::ToString($bytes) -replace '-', '').ToLowerInvariant()
}

function New-RandomPin {
    $bytes = New-Object byte[] 8
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $rng.GetBytes($bytes)
    } finally {
        $rng.Dispose()
    }
    $number = [BitConverter]::ToUInt64($bytes, 0) % 90000000
    return '{0:D8}' -f ($number + 10000000)
}

function Get-DefaultServerAddress {
    try {
        $address = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
            Where-Object {
                $_.IPAddress -notlike '127.*' -and
                $_.IPAddress -notlike '169.254.*' -and
                $_.PrefixOrigin -ne 'WellKnown'
            } |
            Sort-Object InterfaceMetric |
            Select-Object -First 1 -ExpandProperty IPAddress
        if ($address) { return $address }
    } catch { }
    return '127.0.0.1'
}

function Find-PgBin {
    if ($PgBin) {
        $resolved = [System.IO.Path]::GetFullPath($PgBin)
        if (Test-Path -LiteralPath (Join-Path $resolved 'psql.exe')) { return $resolved }
        Fail "psql.exe was not found in -PgBin $resolved."
    }

    $command = Get-Command psql.exe -ErrorAction SilentlyContinue
    if ($command) { return Split-Path $command.Source -Parent }

    $postgresRoot = Join-Path $env:ProgramFiles 'PostgreSQL'
    if (Test-Path -LiteralPath $postgresRoot) {
        $candidate = Get-ChildItem -LiteralPath $postgresRoot -Directory -ErrorAction SilentlyContinue |
            Sort-Object {
                $parsed = $null
                if ([version]::TryParse($_.Name, [ref]$parsed)) { $parsed } else { [version]'0.0' }
            } -Descending |
            ForEach-Object { Join-Path $_.FullName 'bin' } |
            Where-Object { Test-Path -LiteralPath (Join-Path $_ 'psql.exe') } |
            Select-Object -First 1
        if ($candidate) { return $candidate }
    }
    Fail 'PostgreSQL command-line tools were not found. Install PostgreSQL server/client tools first, or supply -PgBin.'
}

function Copy-PackageToDestination {
    if ($PackageRoot.TrimEnd('\') -eq $Destination.TrimEnd('\')) {
        Write-Ok 'Portable package is already in the final application folder.'
        return
    }

    if (Test-Path -LiteralPath $Destination) {
        $existing = @(Get-ChildItem -LiteralPath $Destination -Force -ErrorAction SilentlyContinue)
        if ($existing.Count -gt 0) {
            Fail "Destination is not empty: $Destination. This installer is for a new server; use Project Control option 15 for an existing NEXT installation."
        }
    } else {
        New-Item -ItemType Directory -Path $Destination -Force | Out-Null
    }

    Get-ChildItem -LiteralPath $PackageRoot -Force | ForEach-Object {
        if ($_.Name -in @('.env', '.env.staging')) { return }
        if ($_.Name -like 'RX-Tracker-NEXT-New-Server-*.zip') { return }
        Copy-Item -LiteralPath $_.FullName -Destination $Destination -Recurse -Force
    }
    Write-Ok "Portable application copied to $Destination."
}

function Invoke-Checked([string]$Executable, [string[]]$Arguments, [string]$Label) {
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) {
        Fail "$Label failed with exit code $LASTEXITCODE."
    }
}

function Assert-NewDatabase([string]$PgTools, [string]$MaintenancePassword) {
    $psql = Join-Path $PgTools 'psql.exe'
    $previousPgPassword = [Environment]::GetEnvironmentVariable('PGPASSWORD', 'Process')
    try {
        $env:PGPASSWORD = $MaintenancePassword
        $output = & $psql `
            -h $DatabaseHost `
            -p $DatabasePort `
            -U $MaintenanceUser `
            -d $MaintenanceDatabase `
            -tA `
            -v ON_ERROR_STOP=1 `
            -c "SELECT 1 FROM pg_database WHERE datname = '$DatabaseName';"
        if ($LASTEXITCODE -ne 0) {
            Fail 'Could not authenticate to PostgreSQL with the supplied maintenance account.'
        }
        if (($output | Out-String).Trim() -eq '1') {
            Fail "Database $DatabaseName already exists. Choose a new database name; this fresh installer will not alter or replace an existing database."
        }
        Write-Ok "Confirmed that database $DatabaseName does not already exist."
    } finally {
        if ($null -eq $previousPgPassword) {
            Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
        } else {
            $env:PGPASSWORD = $previousPgPassword
        }
    }
}

function Set-ProcessDatabaseEnvironment([string]$Password) {
    $script:SavedDbEnvironment = @{}
    $values = @{
        DB_HOST = $DatabaseHost
        DB_PORT = [string]$DatabasePort
        DB_USER = $MaintenanceUser
        DB_PASS = $Password
        DB_NAME = $DatabaseName
        DB_MAINTENANCE_NAME = $MaintenanceDatabase
        NODE_ENV = 'production'
    }
    foreach ($entry in $values.GetEnumerator()) {
        $script:SavedDbEnvironment[$entry.Key] = [Environment]::GetEnvironmentVariable($entry.Key, 'Process')
        [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, 'Process')
    }
}

function Restore-ProcessDatabaseEnvironment {
    if (-not $script:SavedDbEnvironment) { return }
    foreach ($entry in $script:SavedDbEnvironment.GetEnumerator()) {
        [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, 'Process')
    }
    $script:SavedDbEnvironment = $null
}

function Clear-ProcessDatabaseEnvironment {
    $script:SavedDbEnvironment = @{}
    foreach ($name in @(
        'DB_HOST',
        'DB_PORT',
        'DB_USER',
        'DB_PASS',
        'DB_NAME',
        'DB_MAINTENANCE_NAME',
        'NODE_ENV'
    )) {
        $script:SavedDbEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
        [Environment]::SetEnvironmentVariable($name, $null, 'Process')
    }
}

function Protect-EnvironmentFile([string]$Path) {
    try {
        $security = [Security.AccessControl.FileSecurity]::new()
        $security.SetAccessRuleProtection($true, $false)
        $rights = [Security.AccessControl.FileSystemRights]::FullControl
        $inheritance = [Security.AccessControl.InheritanceFlags]::None
        $propagation = [Security.AccessControl.PropagationFlags]::None
        $allow = [Security.AccessControl.AccessControlType]::Allow
        foreach ($sidValue in @('S-1-5-18', 'S-1-5-32-544')) {
            $sid = [Security.Principal.SecurityIdentifier]::new($sidValue)
            $rule = [Security.AccessControl.FileSystemAccessRule]::new($sid, $rights, $inheritance, $propagation, $allow)
            $security.AddAccessRule($rule)
        }
        Set-Acl -LiteralPath $Path -AclObject $security
        Write-Ok 'Restricted .env access to Local System and local Administrators.'
    } catch {
        Write-Warning "The .env was created, but its ACL could not be tightened automatically: $($_.Exception.Message)"
    }
}

function Write-EnvironmentFile(
    [string]$RuntimeRole,
    [string]$RuntimePassword,
    [string]$PgTools,
    [string]$LanOrigin,
    [string[]]$AllOrigins,
    [string]$PhonePin
) {
    $hasHttps = @($AllOrigins | Where-Object { $_ -like 'https://*' }).Count -gt 0
    $primaryOrigin = @($AllOrigins | Where-Object { $_ -like 'https://*' } | Select-Object -First 1)
    if (-not $primaryOrigin) { $primaryOrigin = $LanOrigin }
    $lines = @(
        '# Generated by RX Tracker NEXT portable new-server installer.',
        "# Generated at $((Get-Date).ToString('o')). Do not commit or share this file.",
        "PORT=$Port",
        'NODE_ENV=production',
        "DB_HOST=$DatabaseHost",
        "DB_PORT=$DatabasePort",
        "DB_USER=$RuntimeRole",
        "DB_PASS=$RuntimePassword",
        "DB_NAME=$DatabaseName",
        "DB_MAINTENANCE_NAME=$MaintenanceDatabase",
        "PGBIN=$PgTools",
        "JWT_SECRET=$(New-RandomHex 48)",
        "SOFTPHONE_CREDENTIAL_KEY=$(New-RandomHex 48)",
        "SOFTPHONE_RELAY_SECRET=$(New-RandomHex 48)",
        "SOFTPHONE_ACCOUNT_ADMIN_PIN=$PhonePin",
        'TZ=America/New_York',
        "APP_ORIGIN=$primaryOrigin",
        "APP_ORIGINS=$($AllOrigins -join ',')",
        "FORCE_HTTPS=$($hasHttps.ToString().ToLowerInvariant())",
        'HTTPS_ALLOW_LOCAL_HTTP=true',
        "HTTPS_ALLOW_BACKEND_HTTP=$($hasHttps.ToString().ToLowerInvariant())",
        "HTTPS_ASSUME_PROXY_HTTPS=$($hasHttps.ToString().ToLowerInvariant())",
        'ENABLE_HSTS=false',
        "SITE_BACKUP_DIR=$BackupRoot",
        'SMTP_HOST=smtp.gmail.com',
        'SMTP_PORT=587',
        'SMTP_USER=',
        'SMTP_PASS=',
        'SMTP_FROM_NAME=Patient RX System',
        'GOOGLE_DRIVE_ENABLED=false',
        'GOOGLE_DRIVE_AUTH_MODE=oauth',
        'GOOGLE_DRIVE_CLIENT_ID=',
        'GOOGLE_DRIVE_CLIENT_SECRET=',
        'GOOGLE_DRIVE_REFRESH_TOKEN=',
        'GOOGLE_DRIVE_ROOT_FOLDER_ID=',
        'GOOGLE_DRIVE_ROOT_FOLDER_NAME=Patient RX Documents',
        'GOOGLE_DRIVE_SCOPE=https://www.googleapis.com/auth/drive.file',
        'DOCUMENT_UPLOAD_MAX_MB=25',
        'DOCUMENT_STORAGE_LOCAL_DIR=uploads/documents',
        'DOCUMENT_STORAGE_REQUIRE_DRIVE=false',
        'DOCUMENT_STORAGE_ALLOW_LOCAL_FALLBACK=false'
    )
    [IO.File]::WriteAllLines($EnvPath, $lines, [Text.UTF8Encoding]::new($false))
    Write-Ok "Generated the server environment file: $EnvPath"
}

function Install-NssmService {
    if ($NoService) {
        Write-Ok 'Windows service installation was skipped by request.'
        return
    }
    if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
        Fail "Windows service $ServiceName already exists. Remove or rename the old test service before running this new-server installer."
    }

    if (-not (Test-Path -LiteralPath $NssmExe)) {
        Write-Step 'Downloading the NSSM Windows service wrapper'
        $temporaryRoot = Join-Path ([IO.Path]::GetTempPath()) ("rx-nssm-" + [guid]::NewGuid().ToString('N'))
        $zipPath = Join-Path $temporaryRoot 'nssm.zip'
        $extractPath = Join-Path $temporaryRoot 'extract'
        try {
            New-Item -ItemType Directory -Path $temporaryRoot -Force | Out-Null
            Invoke-WebRequest -Uri 'https://nssm.cc/release/nssm-2.24.zip' -OutFile $zipPath -UseBasicParsing
            Expand-Archive -LiteralPath $zipPath -DestinationPath $extractPath -Force
            $candidate = Get-ChildItem -LiteralPath $extractPath -Recurse -Filter nssm.exe |
                Where-Object { $_.FullName -like '*win64*' } |
                Select-Object -First 1
            if (-not $candidate) { Fail 'The downloaded NSSM archive did not contain win64\nssm.exe.' }
            New-Item -ItemType Directory -Path (Split-Path $NssmExe -Parent) -Force | Out-Null
            Copy-Item -LiteralPath $candidate.FullName -Destination $NssmExe -Force
        } finally {
            if (Test-Path -LiteralPath $temporaryRoot) {
                Remove-Item -LiteralPath $temporaryRoot -Recurse -Force -ErrorAction SilentlyContinue
            }
        }
        Write-Ok "NSSM installed at $NssmExe."
    }

    New-Item -ItemType Directory -Path $LogRoot -Force | Out-Null
    $server = Join-Path $Destination 'server.exe'
    Invoke-Checked $NssmExe @('install', $ServiceName, $server) 'Windows service installation'
    foreach ($setting in @(
        @('DisplayName', 'Patient RX System'),
        @('Description', 'Patient RX Delivery Management System'),
        @('AppDirectory', $Destination),
        @('Start', 'SERVICE_AUTO_START'),
        @('AppStdout', (Join-Path $LogRoot 'server-stdout.log')),
        @('AppStderr', (Join-Path $LogRoot 'server-stderr.log')),
        @('AppStdoutCreationDisposition', '4'),
        @('AppStderrCreationDisposition', '4'),
        @('AppRotateFiles', '1'),
        @('AppRotateSeconds', '86400'),
        @('AppRotateBytes', '10485760'),
        @('AppThrottle', '60000'),
        @('AppRestartDelay', '3000')
    )) {
        Invoke-Checked $NssmExe @('set', $ServiceName, $setting[0], $setting[1]) "Service setting $($setting[0])"
    }
    Invoke-Checked $NssmExe @('start', $ServiceName) 'Windows service start'
    Write-Ok "Windows service $ServiceName installed and started."
}

function Wait-ForHealth([string]$ExpectedVersion) {
    if ($NoService) { return }
    $uri = "http://127.0.0.1:$Port/api/healthz"
    $deadline = (Get-Date).AddSeconds(60)
    do {
        Start-Sleep -Seconds 1
        try {
            $health = Invoke-RestMethod -Uri $uri -Headers @{ 'X-Forwarded-Proto' = 'https' } -TimeoutSec 5
            if ($health.status -eq 'ok' -and $health.database -eq 'ok' -and [string]$health.version -eq $ExpectedVersion) {
                Write-Ok "Health check passed: version=$($health.version), database=$($health.database), port=$Port."
                return
            }
        } catch { }
    } while ((Get-Date) -lt $deadline)
    if (Test-Path -LiteralPath $NssmExe) {
        & $NssmExe stop $ServiceName confirm | Out-Null
    }
    Fail "The new service did not become healthy at $uri. It was stopped; inspect $LogRoot."
}

function Get-ExecutableVersion {
    $server = Join-Path $Destination 'server.exe'
    $output = & $server --v 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0 -or $output -notmatch 'Version\s+:\s+([^\s]+)') {
        Fail 'Could not determine the packaged server version.'
    }
    return $Matches[1]
}

function Write-InstallationReceipt([string]$Version, [string]$RuntimeRole, [string[]]$Origins) {
    $receipt = [ordered]@{
        schema = 1
        installedAt = (Get-Date).ToString('o')
        version = $Version
        applicationPath = $Destination
        serviceName = if ($NoService) { $null } else { $ServiceName }
        databaseHost = $DatabaseHost
        databasePort = $DatabasePort
        databaseName = $DatabaseName
        runtimeRole = $RuntimeRole
        httpPort = $Port
        origins = $Origins
        environmentFile = $EnvPath
        secretsIncluded = $false
    }
    [IO.File]::WriteAllText($ReceiptPath, ($receipt | ConvertTo-Json -Depth 4), [Text.UTF8Encoding]::new($false))
    Write-Ok "Non-secret installation receipt written to $ReceiptPath."
}

try {
    Assert-SafeDestination
    Assert-Package
    if ($Action -eq 'ValidatePackage') {
        Write-Ok 'New-server portable installer validation passed.'
        return
    }
    if (-not $NoService -and -not (Test-Administrator)) {
        Fail 'Run INSTALL-NEW-SERVER.bat as Administrator when installing the Windows service.'
    }
    if ($Port -lt 1 -or $Port -gt 65535) { Fail 'PORT must be between 1 and 65535.' }
    if ($DatabasePort -lt 1 -or $DatabasePort -gt 65535) { Fail 'DB_PORT must be between 1 and 65535.' }
    if ($DatabaseName -notmatch '^[A-Za-z0-9_]{1,63}$') { Fail 'DB_NAME must contain only letters, numbers, and underscores.' }
    if ($AdminUsername -notmatch '^[A-Za-z0-9._-]{3,64}$') { Fail 'Administrator username contains unsupported characters.' }

    Write-Host ''
    Write-Host 'RX Tracker NEXT - Portable New Server Installer' -ForegroundColor White
    Write-Host 'Creates a new database and refuses to touch an existing database or service.' -ForegroundColor DarkGray

    $InstallRoot = Read-Value 'Installation root' $InstallRoot
    $AppFolderName = Read-Value 'Application folder name' $AppFolderName
    $Destination = [System.IO.Path]::GetFullPath((Join-Path $InstallRoot $AppFolderName))
    $LogRoot = [System.IO.Path]::GetFullPath((Join-Path $InstallRoot 'logs'))
    $BackupRoot = [System.IO.Path]::GetFullPath((Join-Path $InstallRoot 'backups'))
    $NssmExe = [System.IO.Path]::GetFullPath((Join-Path $InstallRoot 'nssm\win64\nssm.exe'))
    $EnvPath = Join-Path $Destination '.env'
    $ReceiptPath = Join-Path $Destination 'new-server-installation.json'
    Assert-SafeDestination

    if (-not $ServerAddress) { $ServerAddress = Get-DefaultServerAddress }
    $ServerAddress = Read-Value 'Server LAN IP or hostname' $ServerAddress
    $Port = [int](Read-Value 'RX Tracker HTTP port' ([string]$Port))
    $PublicOrigins = Read-Value 'Optional public HTTPS origins, comma separated' $PublicOrigins
    $DatabaseHost = Read-Value 'PostgreSQL host' $DatabaseHost
    $DatabasePort = [int](Read-Value 'PostgreSQL port' ([string]$DatabasePort))
    $DatabaseName = Read-Value 'NEW PostgreSQL database name' $DatabaseName
    $MaintenanceUser = Read-Value 'PostgreSQL maintenance username' $MaintenanceUser
    $MaintenanceDatabase = Read-Value 'PostgreSQL maintenance database' $MaintenanceDatabase
    $AdminUsername = Read-Value 'First RX Tracker administrator username' $AdminUsername
    $AdminEmail = Read-Value 'First RX Tracker administrator email' $AdminEmail

    if ($DatabaseName -notmatch '^[A-Za-z0-9_]{1,63}$') { Fail 'DB_NAME must contain only letters, numbers, and underscores.' }
    if ($AdminUsername -notmatch '^[A-Za-z0-9._-]{3,64}$') { Fail 'Administrator username contains unsupported characters.' }
    if ($ServerAddress -match '[\s/,=]') { Fail 'Server address contains unsupported characters.' }

    $maintenancePassword = Read-Secret 'PostgreSQL maintenance password' 'RX_NEW_SERVER_DB_PASSWORD'
    $adminPassword = Read-Secret 'First administrator password (minimum 12 characters)' 'RX_NEW_SERVER_ADMIN_PASSWORD'
    if ($adminPassword.Length -lt 12) { Fail 'Administrator password must be at least 12 characters.' }

    $lanOrigin = "http://${ServerAddress}:$Port"
    $origins = @("http://localhost:$Port", "http://127.0.0.1:$Port", $lanOrigin)
    if ($PublicOrigins) {
        $origins += $PublicOrigins.Split(',') | ForEach-Object { $_.Trim().TrimEnd('/') } | Where-Object { $_ }
    }
    $origins = @($origins | Where-Object { $_ -match '^https?://[^,\s=]+$' } | Select-Object -Unique)
    if (-not $origins.Count) { Fail 'At least one valid HTTP or HTTPS application origin is required.' }

    $pgTools = Find-PgBin
    Write-Ok "PostgreSQL tools found at $pgTools."
    Assert-NewDatabase $pgTools $maintenancePassword

    if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
        Fail "Windows service $ServiceName already exists. This fresh installer will not replace it."
    }

    Write-Step 'Copying the portable NEXT package'
    Copy-PackageToDestination
    New-Item -ItemType Directory -Path $LogRoot, $BackupRoot -Force | Out-Null

    $runtimeRole = ("rx_" + $DatabaseName + "_runtime").ToLowerInvariant()
    if ($runtimeRole.Length -gt 63) { $runtimeRole = $runtimeRole.Substring(0, 63) }
    $runtimePassword = New-RandomHex 32
    $phonePin = New-RandomPin
    $rxDb = Join-Path $Destination 'rx-db.exe'

    Write-Step "Provisioning fresh database $DatabaseName"
    Set-ProcessDatabaseEnvironment $maintenancePassword
    try {
        Invoke-Checked $rxDb @('provision') 'Fresh database provision'

        $env:RX_BOOTSTRAP_ADMIN_PASSWORD = $adminPassword
        try {
            Invoke-Checked $rxDb @(
                'bootstrap-admin',
                '--username', $AdminUsername,
                '--email', $AdminEmail,
                '--first-name', 'System',
                '--last-name', 'Administrator',
                '--master'
            ) 'First administrator bootstrap'
        } finally {
            Remove-Item Env:RX_BOOTSTRAP_ADMIN_PASSWORD -ErrorAction SilentlyContinue
        }

        $env:RX_RUNTIME_DB_PASSWORD = $runtimePassword
        try {
            Invoke-Checked $rxDb @(
                'configure-runtime-role',
                '--role', $runtimeRole,
                '--confirm-database', $DatabaseName
            ) 'Restricted runtime role configuration'
            Invoke-Checked $rxDb @(
                'verify-runtime-role',
                '--role', $runtimeRole
            ) 'Restricted runtime role verification'
        } finally {
            Remove-Item Env:RX_RUNTIME_DB_PASSWORD -ErrorAction SilentlyContinue
        }
        Invoke-Checked $rxDb @('verify') 'Maintenance schema verification'
    } finally {
        Restore-ProcessDatabaseEnvironment
        $maintenancePassword = $null
        $adminPassword = $null
        Remove-Item Env:RX_NEW_SERVER_DB_PASSWORD -ErrorAction SilentlyContinue
        Remove-Item Env:RX_NEW_SERVER_ADMIN_PASSWORD -ErrorAction SilentlyContinue
    }

    Write-Step 'Generating the final least-privilege .env'
    Write-EnvironmentFile $runtimeRole $runtimePassword $pgTools $lanOrigin $origins $phonePin
    Clear-ProcessDatabaseEnvironment
    Push-Location $Destination
    try {
        Invoke-Checked $rxDb @('verify') 'Restricted runtime schema verification'
    } finally {
        Pop-Location
        Restore-ProcessDatabaseEnvironment
    }
    if ($NoService) {
        Write-Ok 'The disposable no-service validation kept the generated .env readable for its current test process.'
    } else {
        Protect-EnvironmentFile $EnvPath
    }

    $version = Get-ExecutableVersion
    Write-InstallationReceipt $version $runtimeRole $origins

    Write-Step 'Installing RX Tracker as a Windows service'
    Install-NssmService
    Wait-ForHealth $version

    Write-Host ''
    Write-Host '============================================================' -ForegroundColor Green
    Write-Host 'RX Tracker NEXT new-server installation completed.' -ForegroundColor Green
    Write-Host "Version     : $version"
    Write-Host "Application : $Destination"
    Write-Host "Database    : $DatabaseName"
    Write-Host "URL         : $lanOrigin"
    Write-Host "Admin user  : $AdminUsername"
    Write-Host "Phone PIN   : $phonePin" -ForegroundColor Yellow
    if ($NoService) {
        Write-Host "Start       : $Destination\server.exe"
    } else {
        Write-Host "Service     : $ServiceName (automatic)"
    }
    Write-Host 'Record the Phone PIN securely, change the test administrator password, and delete the extracted source package after acceptance.' -ForegroundColor Yellow
    Write-Host 'Future NEXT updates use PROJECT-CONTROL.bat option 8, then option 15.' -ForegroundColor Cyan
    Write-Host '============================================================' -ForegroundColor Green
    return
} catch {
    Restore-ProcessDatabaseEnvironment
    Remove-Item Env:RX_BOOTSTRAP_ADMIN_PASSWORD -ErrorAction SilentlyContinue
    Remove-Item Env:RX_RUNTIME_DB_PASSWORD -ErrorAction SilentlyContinue
    $installError = $_
    Write-Host ''
    Write-Host "[FAILED] $($installError.Exception.Message)" -ForegroundColor Red
    Write-Host 'No existing database or Windows service was intentionally replaced.' -ForegroundColor Yellow
    throw $installError
}
