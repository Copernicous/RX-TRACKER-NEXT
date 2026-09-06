[CmdletBinding()]
param(
    [ValidateSet('Help', 'SelfTest', 'Status', 'Check', 'Update', 'Rollback')]
    [string]$Action = 'Help',
    [string]$AppRoot = '',
    [string]$PackagePath = '',
    [string]$ServiceName = 'PatientRXSystem',
    [string]$PgBin = '',
    [string]$Confirm = ''
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$script:LockStream = $null
$script:StagingPath = $null
$script:Repository = 'Copernicous/RX-TRACKER-NEXT'

function Write-Step([string]$Message) { Write-Host "`n==> $Message" -ForegroundColor Cyan }
function Write-Ok([string]$Message) { Write-Host "[OK] $Message" -ForegroundColor Green }
function Fail([string]$Message) { throw $Message }

function Initialize-Paths {
    $defaultRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
    $script:AppPath = [IO.Path]::GetFullPath($(if ($AppRoot) { $AppRoot } else { $defaultRoot }))
    if (-not (Test-Path -LiteralPath $script:AppPath -PathType Container)) {
        Fail "Application folder was not found: $script:AppPath"
    }
    $script:InstallPath = [IO.Path]::GetFullPath((Split-Path $script:AppPath -Parent))
    $script:UpdatesPath = Join-Path $script:InstallPath 'updates'
    $script:ReleaseBackupsPath = Join-Path $script:InstallPath 'release-backups'
    $script:DatabaseBackupsPath = Join-Path $script:InstallPath 'backups'
    $script:DeploymentStatePath = Join-Path $script:InstallPath 'deployment-state'
    $script:StatePath = Join-Path $script:DeploymentStatePath 'release-update.json'
    $script:LockPath = Join-Path $script:DeploymentStatePath 'release-update.lock'
    $script:StagingRoot = Join-Path $script:InstallPath 'update-staging'
}

function Assert-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        Fail 'Run Project Control from an Administrator terminal.'
    }
}

function Acquire-UpdateLock {
    New-Item -ItemType Directory -Path $script:DeploymentStatePath -Force | Out-Null
    try {
        $script:LockStream = [IO.File]::Open(
            $script:LockPath,
            [IO.FileMode]::OpenOrCreate,
            [IO.FileAccess]::ReadWrite,
            [IO.FileShare]::None
        )
    } catch {
        Fail 'Another RX Tracker update or rollback operation is already running.'
    }
}

function Release-UpdateLock {
    if ($script:LockStream) {
        $script:LockStream.Dispose()
        $script:LockStream = $null
    }
}

function Assert-PathInside([string]$PathValue, [string]$ParentPath, [string]$Label) {
    $resolved = [IO.Path]::GetFullPath($PathValue)
    $parent = [IO.Path]::GetFullPath($ParentPath).TrimEnd('\') + '\'
    if (-not $resolved.StartsWith($parent, [StringComparison]::OrdinalIgnoreCase)) {
        Fail "$Label must stay inside $ParentPath. Received: $resolved"
    }
    return $resolved
}

function Remove-StagingPath {
    if (-not $script:StagingPath -or -not (Test-Path -LiteralPath $script:StagingPath)) { return }
    $resolved = Assert-PathInside $script:StagingPath $script:StagingRoot 'Staging cleanup path'
    Remove-Item -LiteralPath $resolved -Recurse -Force
    $script:StagingPath = $null
}

function Read-DotEnv([string]$PathValue) {
    if (-not (Test-Path -LiteralPath $PathValue -PathType Leaf)) { Fail ".env not found: $PathValue" }
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

function Assert-RequiredEnvironment([hashtable]$Config) {
    foreach ($key in @('DB_HOST', 'DB_USER', 'DB_PASS', 'DB_NAME', 'JWT_SECRET')) {
        if (-not $Config.ContainsKey($key) -or [string]::IsNullOrWhiteSpace([string]$Config[$key])) {
            Fail "Production .env is missing required value $key."
        }
    }
    if ([string]$Config['DB_NAME'] -notmatch '^[A-Za-z0-9_-]{1,63}$') {
        Fail 'DB_NAME contains unsupported characters.'
    }
}

function ConvertTo-PlainText([Security.SecureString]$SecureValue) {
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureValue)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

function Get-MaintenanceDatabaseConfig([hashtable]$RuntimeConfig) {
    $maintenance = @{}
    foreach ($key in $RuntimeConfig.Keys) { $maintenance[$key] = $RuntimeConfig[$key] }

    $user = [string]$env:RX_DB_MAINTENANCE_USER
    $password = [string]$env:RX_DB_MAINTENANCE_PASS
    if (($user -and -not $password) -or ($password -and -not $user)) {
        Fail 'Set both RX_DB_MAINTENANCE_USER and RX_DB_MAINTENANCE_PASS, or neither.'
    }

    if (-not $user) {
        if ([string]$RuntimeConfig['DB_USER'] -eq 'postgres') {
            $user = [string]$RuntimeConfig['DB_USER']
            $password = [string]$RuntimeConfig['DB_PASS']
        } else {
            $enteredUser = Read-Host 'Database maintenance user [postgres]'
            $user = if ([string]::IsNullOrWhiteSpace($enteredUser)) { 'postgres' } else { $enteredUser.Trim() }
            $securePassword = Read-Host "Password for PostgreSQL maintenance user $user" -AsSecureString
            $password = ConvertTo-PlainText $securePassword
        }
    }

    if ([string]::IsNullOrWhiteSpace($user) -or [string]::IsNullOrWhiteSpace($password)) {
        Fail 'Database maintenance credentials are required for backup, migrations, and recovery.'
    }

    $maintenance['DB_USER'] = $user
    $maintenance['DB_PASS'] = $password
    Write-Ok "Database maintenance identity ready: user=$user database=$($maintenance['DB_NAME'])."
    return $maintenance
}

function Get-AppVersion([string]$RootPath = $script:AppPath) {
    $package = Join-Path $RootPath 'package.json'
    if (-not (Test-Path -LiteralPath $package -PathType Leaf)) { Fail "package.json not found: $package" }
    return [string]((Get-Content -LiteralPath $package -Raw | ConvertFrom-Json).version)
}

function Compare-SemVer([string]$Left, [string]$Right) {
    $pattern = '^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$'
    if ($Left -notmatch $pattern) { Fail "Unsupported installed version: $Left" }
    $leftParts = @([int]$matches[1], [int]$matches[2], [int]$matches[3]); $leftPre = [string]$matches[4]
    if ($Right -notmatch $pattern) { Fail "Unsupported release version: $Right" }
    $rightParts = @([int]$matches[1], [int]$matches[2], [int]$matches[3]); $rightPre = [string]$matches[4]
    for ($index = 0; $index -lt 3; $index++) {
        if ($leftParts[$index] -lt $rightParts[$index]) { return -1 }
        if ($leftParts[$index] -gt $rightParts[$index]) { return 1 }
    }
    if (-not $leftPre -and $rightPre) { return 1 }
    if ($leftPre -and -not $rightPre) { return -1 }
    if ($leftPre -eq $rightPre) { return 0 }
    $leftTokens = @($leftPre -split '\.'); $rightTokens = @($rightPre -split '\.')
    for ($index = 0; $index -lt [Math]::Max($leftTokens.Count, $rightTokens.Count); $index++) {
        if ($index -ge $leftTokens.Count) { return -1 }
        if ($index -ge $rightTokens.Count) { return 1 }
        $leftNumber = 0; $rightNumber = 0
        $leftNumeric = [int]::TryParse($leftTokens[$index], [ref]$leftNumber)
        $rightNumeric = [int]::TryParse($rightTokens[$index], [ref]$rightNumber)
        if ($leftNumeric -and $rightNumeric) {
            if ($leftNumber -lt $rightNumber) { return -1 }
            if ($leftNumber -gt $rightNumber) { return 1 }
        } elseif ($leftNumeric -ne $rightNumeric) {
            return $(if ($leftNumeric) { -1 } else { 1 })
        } else {
            $comparison = [string]::Compare($leftTokens[$index], $rightTokens[$index], $true)
            if ($comparison -ne 0) { return [Math]::Sign($comparison) }
        }
    }
    return 0
}

function Get-LatestRelease {
    $headers = @{ 'User-Agent' = 'RX-Tracker-Project-Control' }
    $uri = "https://api.github.com/repos/$($script:Repository)/releases?per_page=20"
    $releases = @(Invoke-RestMethod -Uri $uri -Headers $headers -TimeoutSec 45)
    foreach ($release in ($releases | Where-Object { $_.draft -ne $true } | Sort-Object published_at -Descending)) {
        $zip = @($release.assets | Where-Object { $_.name -match '^server-update-.+\.zip$' } | Select-Object -First 1)
        $checksums = @($release.assets | Where-Object { $_.name -eq 'SHA256SUMS.txt' } | Select-Object -First 1)
        if ($zip.Count -and $checksums.Count) {
            return [pscustomobject]@{
                Tag = [string]$release.tag_name
                Version = ([string]$release.tag_name).TrimStart('v')
                ZipUrl = [string]$zip[0].browser_download_url
                ChecksumsUrl = [string]$checksums[0].browser_download_url
                PublishedAt = [string]$release.published_at
            }
        }
    }
    Fail 'No official RX Tracker release with a server ZIP and checksums was found.'
}

function Get-ChecksumMap([string]$Version, [string]$PreferredUrl = '') {
    $uri = if ($PreferredUrl) { $PreferredUrl } else {
        "https://github.com/$($script:Repository)/releases/download/v$Version/SHA256SUMS.txt"
    }
    Write-Host "Downloading official checksums from $uri"
    $response = Invoke-WebRequest -Uri $uri -UseBasicParsing -TimeoutSec 45
    $content = if ($response.Content -is [byte[]]) {
        [Text.Encoding]::UTF8.GetString($response.Content)
    } else { [string]$response.Content }
    $map = @{}
    foreach ($line in ($content -split '\r?\n')) {
        $clean = $line.Trim().TrimStart([char]0xFEFF)
        if ($clean -match '^([0-9a-fA-F]{64})\s+\*?(.+)$') {
            $map[$matches[2].Trim()] = $matches[1].ToLowerInvariant()
        }
    }
    return $map
}

function New-StagingPath {
    New-Item -ItemType Directory -Path $script:StagingRoot -Force | Out-Null
    $candidate = Join-Path $script:StagingRoot ([guid]::NewGuid().ToString('N'))
    $script:StagingPath = Assert-PathInside $candidate $script:StagingRoot 'Staging path'
    New-Item -ItemType Directory -Path $script:StagingPath | Out-Null
    return $script:StagingPath
}

function Inspect-ReleasePackage([string]$ZipPath) {
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [IO.Compression.ZipFile]::OpenRead($ZipPath)
    $totalLength = [int64]0
    $packageJson = $null
    try {
        foreach ($entry in $zip.Entries) {
            $name = ([string]$entry.FullName).Replace('\', '/')
            if (-not $name -or $name.EndsWith('/')) { continue }
            $segments = @($name -split '/')
            if ([IO.Path]::IsPathRooted($name) -or $segments -contains '..' -or $segments -contains '.') {
                Fail "Unsafe ZIP entry: $name"
            }
            $leaf = $segments[-1]
            if (($leaf -like '.env*' -and $leaf -ne '.env.example') -or
                $leaf -match '(?i)\.(dump|sql|bak|log)$') {
                Fail "Release ZIP contains forbidden file: $name"
            }
            if ([int64]$entry.Length -gt 536870912) { Fail "Release ZIP entry is unexpectedly large: $name" }
            $totalLength += [int64]$entry.Length
            if ($totalLength -gt 1073741824) { Fail 'Release ZIP expands beyond the allowed package size.' }
            if ($name -eq 'package.json') {
                $reader = [IO.StreamReader]::new($entry.Open(), [Text.Encoding]::UTF8, $true)
                try { $packageJson = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
            }
        }
    } finally { $zip.Dispose() }
    if (-not $packageJson -or -not [string]$packageJson.version) { Fail 'Release ZIP has no valid package.json version.' }
    return [string]$packageJson.version
}

function Expand-ValidatedPackage([string]$ZipPath, [string]$Destination) {
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [IO.Compression.ZipFile]::OpenRead($ZipPath)
    $files = New-Object System.Collections.Generic.List[string]
    try {
        foreach ($entry in $zip.Entries) {
            $name = ([string]$entry.FullName).Replace('\', '/')
            if (-not $name -or $name.EndsWith('/')) { continue }
            $segments = @($name -split '/')
            if ([IO.Path]::IsPathRooted($name) -or $segments -contains '..' -or $segments -contains '.') {
                Fail "Unsafe ZIP entry: $name"
            }
            $leaf = $segments[-1]
            if (($leaf -like '.env*' -and $leaf -ne '.env.example') -or
                $leaf -match '(?i)\.(dump|sql|bak|log)$') {
                Fail "Release ZIP contains forbidden file: $name"
            }
            $target = Assert-PathInside (Join-Path $Destination ($name.Replace('/', '\'))) $Destination 'ZIP entry'
            $directory = Split-Path $target -Parent
            if (-not (Test-Path -LiteralPath $directory)) { New-Item -ItemType Directory -Path $directory -Force | Out-Null }
            [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $target, $true)
            $files.Add($name)
        }
    } finally { $zip.Dispose() }
    foreach ($required in @('server.exe', 'rx-db.exe', 'package.json', 'PROJECT-CONTROL.bat',
        'project-control.json', 'scripts/project-control.ps1', 'scripts/Invoke-ReleaseUpdate.ps1',
        'scripts/Invoke-TestCopyRestore.ps1')) {
        if ($files -notcontains $required) { Fail "Release ZIP is missing required file: $required" }
    }
    return @($files)
}

function Resolve-ReleasePackage {
    $release = $null
    if ([string]::IsNullOrWhiteSpace($PackagePath)) {
        $release = Get-LatestRelease
        $versionFolder = Join-Path $script:UpdatesPath ("v" + $release.Version)
        New-Item -ItemType Directory -Path $versionFolder -Force | Out-Null
        $resolvedZip = Join-Path $versionFolder ("server-update-" + $release.Version + '.zip')
        Write-Step "Downloading official release v$($release.Version)"
        Invoke-WebRequest -Uri $release.ZipUrl -OutFile $resolvedZip -UseBasicParsing -TimeoutSec 180
    } else {
        $resolvedZip = [IO.Path]::GetFullPath($PackagePath)
        if (-not (Test-Path -LiteralPath $resolvedZip -PathType Leaf)) { Fail "Release ZIP not found: $resolvedZip" }
    }

    $version = Inspect-ReleasePackage $resolvedZip
    if ($release -and $version -ne $release.Version) {
        Fail "Downloaded package version $version does not match release tag $($release.Version)."
    }
    $checksums = Get-ChecksumMap $version $(if ($release) { $release.ChecksumsUrl } else { '' })
    $officialZipName = "server-update-$version.zip"
    foreach ($required in @($officialZipName, 'server.exe', 'rx-db.exe')) {
        if (-not $checksums.ContainsKey($required)) { Fail "Official checksums do not contain $required." }
    }

    $zipHash = (Get-FileHash -LiteralPath $resolvedZip -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($zipHash -ne $checksums[$officialZipName]) { Fail 'Release ZIP does not match the official GitHub checksum.' }
    $staging = New-StagingPath
    $entries = Expand-ValidatedPackage $resolvedZip $staging
    foreach ($name in @('server.exe', 'rx-db.exe')) {
        $actual = (Get-FileHash -LiteralPath (Join-Path $staging $name) -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actual -ne $checksums[$name]) { Fail "$name does not match the official GitHub checksum." }
    }
    $versionOutput = (& (Join-Path $staging 'server.exe') --v 2>&1 | Out-String)
    if ($LASTEXITCODE -ne 0 -or $versionOutput -notmatch [Regex]::Escape($version)) {
        Fail "server.exe did not report release version $version."
    }
    & (Join-Path $staging 'rx-db.exe') help | Out-Null
    if ($LASTEXITCODE -ne 0) { Fail 'rx-db.exe validation failed.' }
    Write-Ok "Official release v$version passed ZIP, executable, and version validation."
    return [pscustomobject]@{ Version = $version; Zip = $resolvedZip; Staging = $staging; Entries = $entries }
}

function Invoke-WithEnvironment([hashtable]$Config, [scriptblock]$Operation) {
    $previous = @{}
    foreach ($key in $Config.Keys) {
        $previous[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
        [Environment]::SetEnvironmentVariable($key, [string]$Config[$key], 'Process')
    }
    try { & $Operation } finally {
        foreach ($key in $Config.Keys) { [Environment]::SetEnvironmentVariable($key, $previous[$key], 'Process') }
    }
}

function Invoke-RxDb([string]$Exe, [hashtable]$Config, [string[]]$Arguments) {
    Push-Location (Split-Path $Exe -Parent)
    try {
        Invoke-WithEnvironment $Config {
            & $Exe @Arguments
            if ($LASTEXITCODE -ne 0) { Fail "rx-db.exe $($Arguments -join ' ') failed with exit code $LASTEXITCODE." }
        }
    } finally { Pop-Location }
}

function Get-BusinessFingerprint([string]$Exe, [hashtable]$Config) {
    $lines = @()
    Push-Location (Split-Path $Exe -Parent)
    try {
        Invoke-WithEnvironment $Config {
            $script:fingerprintOutput = @(& $Exe business-fingerprint 2>&1)
            if ($LASTEXITCODE -ne 0) { Fail 'Could not read the business-data fingerprint.' }
        }
        $lines = @($script:fingerprintOutput)
    } finally { Pop-Location; Remove-Variable fingerprintOutput -Scope Script -ErrorAction SilentlyContinue }
    $marker = @($lines | Where-Object { [string]$_ -like 'RX_BUSINESS_FINGERPRINT=*' } | Select-Object -Last 1)
    if (-not $marker.Count) { Fail 'rx-db.exe did not return a business-data fingerprint.' }
    return ([string]$marker[0]).Substring('RX_BUSINESS_FINGERPRINT='.Length) | ConvertFrom-Json
}

function Assert-BusinessDataUnchanged([object]$Before, [object]$After) {
    $differences = New-Object System.Collections.Generic.List[string]
    $allowedRegionalBackfill = $false
    foreach ($property in $Before.tableCounts.PSObject.Properties) {
        $previous = $property.Value
        $currentProperty = $After.tableCounts.PSObject.Properties[$property.Name]
        $current = if ($currentProperty) { $currentProperty.Value } else { $null }
        if ($null -ne $previous -and [string]$previous -ne [string]$current) {
            if ($property.Name -eq 'PatientTagAssignments') {
                $beforeGaps = Get-NumericProperty $Before 'regionalAssignmentGaps'
                $afterGaps = Get-NumericProperty $After 'regionalAssignmentGaps'
                $delta = ([int64]$current) - ([int64]$previous)
                if ($beforeGaps -gt 0 -and $delta -eq $beforeGaps -and $afterGaps -eq 0) {
                    $allowedRegionalBackfill = $true
                    continue
                }
            }
            $differences.Add("$($property.Name): $previous -> $current")
        }
    }
    $beforeWorkflow = $Before.workflowActions | ConvertTo-Json -Depth 8 -Compress
    $afterWorkflow = $After.workflowActions | ConvertTo-Json -Depth 8 -Compress
    if ($beforeWorkflow -ne $afterWorkflow) { $differences.Add('WorkflowActions configuration changed') }
    if ($differences.Count) {
        Fail "Business-data validation failed: $($differences -join '; '). Database rollback is required."
    }
    if ($allowedRegionalBackfill) {
        Write-Ok 'Business-data fingerprints are unchanged except the audited missing Region patient-tag assignment backfill.'
    } else {
        Write-Ok 'Patient, RX, workflow, user, call, and patient-tag assignment fingerprints are unchanged.'
    }
}

function Get-NumericProperty([object]$Object, [string]$Name) {
    if (-not $Object -or -not $Object.PSObject.Properties[$Name]) { return 0 }
    $value = $Object.PSObject.Properties[$Name].Value
    if ($null -eq $value -or [string]::IsNullOrWhiteSpace([string]$value)) { return 0 }
    return [int64]$value
}

function Normalize-ReleaseEntries([object]$Entries) {
    $normalized = New-Object System.Collections.Generic.List[string]
    foreach ($entry in @($Entries)) {
        if ($null -eq $entry) { continue }
        $text = [string]$entry
        if ([string]::IsNullOrWhiteSpace($text)) { continue }
        if ($text -match "`r|`n") { Fail 'Release entry list contains an invalid newline.' }
        if ($text -match '\s+(server\.exe|rx-db\.exe|PROJECT-CONTROL\.bat|package\.json|README\.md|CHANGELOG\.md)(\s|$)') {
            Fail "Release entry list contains a combined file list: $text"
        }
        $normalized.Add($text)
    }
    if ($normalized.Count -eq 0) { Fail 'Release entry list is empty.' }
    return [string[]]$normalized.ToArray()
}

function Find-PgBin {
    $candidates = New-Object System.Collections.Generic.List[string]
    if ($PgBin) { $candidates.Add([IO.Path]::GetFullPath($PgBin)) }
    if ($env:PGBIN) { $candidates.Add([IO.Path]::GetFullPath($env:PGBIN)) }
    Get-CimInstance Win32_Service -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'postgres' } | ForEach-Object {
        if ([string]$_.PathName -match '"?([^\"]+\\pg_ctl\.exe)"?') { $candidates.Add((Split-Path $matches[1] -Parent)) }
    }
    $postgresRoot = Join-Path $env:ProgramFiles 'PostgreSQL'
    if (Test-Path -LiteralPath $postgresRoot) {
        Get-ChildItem -LiteralPath $postgresRoot -Directory -ErrorAction SilentlyContinue |
            Sort-Object { try { [version]$_.Name } catch { [version]'0.0' } } -Descending |
            ForEach-Object { $candidates.Add((Join-Path $_.FullName 'bin')) }
    }
    foreach ($candidate in ($candidates | Select-Object -Unique)) {
        $required = @('pg_dump.exe', 'pg_restore.exe', 'psql.exe', 'dropdb.exe', 'createdb.exe')
        if (@($required | Where-Object { -not (Test-Path -LiteralPath (Join-Path $candidate $_)) }).Count -eq 0) {
            return $candidate
        }
    }
    Fail 'PostgreSQL client tools were not found. Use -PgBin when PostgreSQL is installed in a custom folder.'
}

function New-DatabaseBackup([hashtable]$Config, [string]$Label) {
    New-Item -ItemType Directory -Path $script:DatabaseBackupsPath -Force | Out-Null
    $database = [string]$Config['DB_NAME']
    $path = Join-Path $script:DatabaseBackupsPath ("$database-$Label-$(Get-Date -Format 'yyyyMMdd-HHmmss').dump")
    $pgDump = Join-Path $script:ResolvedPgBin 'pg_dump.exe'
    $pgRestore = Join-Path $script:ResolvedPgBin 'pg_restore.exe'
    $port = if ($Config['DB_PORT']) { [string]$Config['DB_PORT'] } else { '5432' }
    $oldPassword = $env:PGPASSWORD; $env:PGPASSWORD = [string]$Config['DB_PASS']
    try {
        & $pgDump --host ([string]$Config['DB_HOST']) --port $port --username ([string]$Config['DB_USER']) `
            --format custom --no-owner --no-privileges --file $path $database
        if ($LASTEXITCODE -ne 0) { Fail "pg_dump failed with exit code $LASTEXITCODE." }
        & $pgRestore --list $path | Out-Null
        if ($LASTEXITCODE -ne 0) { Fail 'The database backup could not be validated.' }
    } finally { $env:PGPASSWORD = $oldPassword }
    $hash = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
    [IO.File]::WriteAllText("$path.sha256.txt", "$hash  $([IO.Path]::GetFileName($path))`r`n", (New-Object Text.UTF8Encoding($false)))
    Write-Ok "Verified database backup: $path"
    return [pscustomobject]@{ Path = $path; Hash = $hash }
}

function Restore-DatabaseBackup([hashtable]$Config, [string]$DumpPath, [string]$ExpectedHash) {
    $database = [string]$Config['DB_NAME']
    if ($database -notmatch '^[A-Za-z0-9_-]{1,63}$' -or $database -in @('postgres', 'template0', 'template1')) {
        Fail "Refusing to restore unsafe database target: $database"
    }
    $resolvedDump = [IO.Path]::GetFullPath($DumpPath)
    if (-not (Test-Path -LiteralPath $resolvedDump -PathType Leaf)) { Fail "Rollback backup is missing: $resolvedDump" }
    $actualHash = (Get-FileHash -LiteralPath $resolvedDump -Algorithm SHA256).Hash
    if ($ExpectedHash -and $actualHash -ne $ExpectedHash) { Fail 'Rollback database backup checksum does not match.' }
    $port = if ($Config['DB_PORT']) { [string]$Config['DB_PORT'] } else { '5432' }
    $common = @('--host', [string]$Config['DB_HOST'], '--port', $port, '--username', [string]$Config['DB_USER'])
    $oldPassword = $env:PGPASSWORD; $env:PGPASSWORD = [string]$Config['DB_PASS']
    try {
        & (Join-Path $script:ResolvedPgBin 'psql.exe') @common --dbname postgres --set ON_ERROR_STOP=1 `
            --command "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$database' AND pid <> pg_backend_pid();" | Out-Null
        if ($LASTEXITCODE -ne 0) { Fail 'Could not terminate database connections for rollback.' }
        & (Join-Path $script:ResolvedPgBin 'dropdb.exe') @common --if-exists $database
        if ($LASTEXITCODE -ne 0) { Fail 'Could not drop the exact rollback database.' }
        & (Join-Path $script:ResolvedPgBin 'createdb.exe') @common --template template0 $database
        if ($LASTEXITCODE -ne 0) { Fail 'Could not recreate the exact rollback database.' }
        & (Join-Path $script:ResolvedPgBin 'pg_restore.exe') @common --dbname $database --no-owner --no-privileges $resolvedDump
        if ($LASTEXITCODE -ne 0) { Fail 'Could not restore the rollback database backup.' }
    } finally { $env:PGPASSWORD = $oldPassword }
    Write-Ok "Restored database $database from the verified pre-update backup."
}

function Find-Nssm {
    $preferred = Join-Path $script:InstallPath 'nssm\win64\nssm.exe'
    if (Test-Path -LiteralPath $preferred) { return $preferred }
    $found = Get-ChildItem -LiteralPath (Join-Path $script:InstallPath 'nssm') -Filter nssm.exe -Recurse -File -ErrorAction SilentlyContinue |
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

function Assert-ServiceTargetsApp {
    $service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if (-not $service) { Fail "Windows service $ServiceName was not found." }
    $nssm = Find-Nssm
    $configured = Select-FirstNativeValue @(& $nssm get $ServiceName Application 2>$null)
    if ($LASTEXITCODE -ne 0 -or -not $configured) { Fail 'Could not read the NSSM service application.' }
    $expected = [IO.Path]::GetFullPath((Join-Path $script:AppPath 'server.exe'))
    if ([IO.Path]::GetFullPath($configured) -ne $expected) {
        Fail "Service points to $configured instead of $expected."
    }
    return $service
}

function Stop-ManagedService {
    $service = Assert-ServiceTargetsApp
    if ($service.Status -ne 'Stopped') {
        Stop-Service -Name $service.Name
        $service.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(30))
    }
    Write-Ok "Service $($service.Name) is stopped."
}

function Start-ManagedService {
    $service = Get-Service -Name $ServiceName -ErrorAction Stop
    if ($service.Status -ne 'Running') {
        Start-Service -Name $service.Name
        $service.WaitForStatus('Running', [TimeSpan]::FromSeconds(30))
    }
    Write-Ok "Service $($service.Name) is running."
}

function Wait-ForHealth([string]$ExpectedVersion, [int]$TimeoutSeconds = 45) {
    $config = Read-DotEnv (Join-Path $script:AppPath '.env')
    $port = if ($config['PORT']) { [int]$config['PORT'] } else { 3000 }
    $uri = "http://127.0.0.1:$port/api/healthz"
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        Start-Sleep -Seconds 1
        try { $health = Invoke-RestMethod -Uri $uri -Headers @{ 'X-Forwarded-Proto' = 'https' } -TimeoutSec 5 } catch { $health = $null }
        if ($health -and $health.status -eq 'ok' -and $health.database -eq 'ok' -and
            [string]$health.version -eq $ExpectedVersion) {
            Write-Ok "Health check passed: version=$($health.version), database=$($health.database), port=$port."
            return $health
        }
    } while ((Get-Date) -lt $deadline)
    Fail "RX Tracker v$ExpectedVersion did not become healthy at $uri."
}

function Backup-ApplicationFiles([string[]]$Entries, [string]$Folder) {
    $Entries = Normalize-ReleaseEntries $Entries
    $filesRoot = Join-Path $Folder 'files'
    New-Item -ItemType Directory -Path $filesRoot -Force | Out-Null
    $manifest = New-Object System.Collections.Generic.List[object]
    foreach ($entry in $Entries) {
        $relative = $entry.Replace('/', '\')
        $source = Assert-PathInside (Join-Path $script:AppPath $relative) $script:AppPath 'Application backup source'
        $existed = Test-Path -LiteralPath $source -PathType Leaf
        if ($existed) {
            $destination = Assert-PathInside (Join-Path $filesRoot $relative) $filesRoot 'Application backup target'
            New-Item -ItemType Directory -Path (Split-Path $destination -Parent) -Force | Out-Null
            Copy-Item -LiteralPath $source -Destination $destination -Force
        }
        $manifest.Add([pscustomobject]@{ Path = $entry; Existed = $existed })
    }
    Copy-Item -LiteralPath (Join-Path $script:AppPath '.env') -Destination (Join-Path $Folder 'protected.env') -Force
    $manifestPath = Join-Path $Folder 'files-manifest.json'
    [IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 4), (New-Object Text.UTF8Encoding($false)))
    return $manifestPath
}

function Install-ApplicationFiles([string]$SourceRoot, [string[]]$Entries) {
    $Entries = Normalize-ReleaseEntries $Entries
    $ordered = @($Entries | Where-Object { $_ -notin @('server.exe', 'rx-db.exe') }) + @('rx-db.exe', 'server.exe')
    foreach ($entry in ($ordered | Select-Object -Unique)) {
        $relative = $entry.Replace('/', '\')
        $source = Assert-PathInside (Join-Path $SourceRoot $relative) $SourceRoot 'Release source'
        if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { Fail "Staged release file is missing: $entry" }
        $destination = Assert-PathInside (Join-Path $script:AppPath $relative) $script:AppPath 'Release destination'
        New-Item -ItemType Directory -Path (Split-Path $destination -Parent) -Force | Out-Null
        Copy-Item -LiteralPath $source -Destination $destination -Force
    }
    Write-Ok 'Installed approved release files; production .env was not replaced.'
}

function Restore-ApplicationFiles([string]$BackupFolder, [string]$ManifestPath) {
    $filesRoot = Join-Path $BackupFolder 'files'
    $manifest = @(Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json)
    foreach ($item in $manifest) {
        $relative = ([string]$item.Path).Replace('/', '\')
        $destination = Assert-PathInside (Join-Path $script:AppPath $relative) $script:AppPath 'Application rollback target'
        if ($relative -match '\s+(server\.exe|rx-db\.exe|PROJECT-CONTROL\.bat|package\.json|README\.md|CHANGELOG\.md)(\s|$)') {
            Fail "Application rollback manifest entry is not a single release file: $relative"
        }
        if ($item.Existed -eq $true) {
            $source = Assert-PathInside (Join-Path $filesRoot $relative) $filesRoot 'Application rollback source'
            New-Item -ItemType Directory -Path (Split-Path $destination -Parent) -Force | Out-Null
            Copy-Item -LiteralPath $source -Destination $destination -Force
        } elseif (Test-Path -LiteralPath $destination -PathType Leaf) {
            Remove-Item -LiteralPath $destination -Force
        }
    }
    Write-Ok 'Restored the previous application files; production .env remained unchanged.'
}

function Save-State([hashtable]$Values) {
    New-Item -ItemType Directory -Path $script:DeploymentStatePath -Force | Out-Null
    $current = @{}
    if (Test-Path -LiteralPath $script:StatePath) {
        $loaded = Get-Content -LiteralPath $script:StatePath -Raw | ConvertFrom-Json
        foreach ($property in $loaded.PSObject.Properties) { $current[$property.Name] = $property.Value }
    }
    foreach ($key in $Values.Keys) { $current[$key] = $Values[$key] }
    [IO.File]::WriteAllText($script:StatePath, ($current | ConvertTo-Json -Depth 8), (New-Object Text.UTF8Encoding($false)))
}

function Load-State {
    if (-not (Test-Path -LiteralPath $script:StatePath -PathType Leaf)) { return $null }
    return Get-Content -LiteralPath $script:StatePath -Raw | ConvertFrom-Json
}

function Invoke-Check {
    $installed = Get-AppVersion
    $latest = Get-LatestRelease
    Write-Host "Installed : $installed"
    Write-Host "Latest    : $($latest.Version)"
    Write-Host "Published : $($latest.PublishedAt)"
    if ((Compare-SemVer $installed $latest.Version) -lt 0) {
        Write-Host 'Update available.' -ForegroundColor Yellow
    } else { Write-Ok 'No newer official release is available.' }
}

function Invoke-Status {
    Write-Host 'RX Tracker compiled release status' -ForegroundColor Cyan
    Write-Host "Application : $script:AppPath"
    Write-Host "Version     : $(Get-AppVersion)"
    $service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    Write-Host "Service     : $(if ($service) { $service.Status } else { 'not installed' })"
    Write-Host "State       : $script:StatePath"
    $state = Load-State
    if ($state) { $state | ConvertTo-Json -Depth 8 }
}

function Invoke-Update {
    Assert-Administrator
    Acquire-UpdateLock
    $serviceStopped = $false; $migrationAttempted = $false; $filesInstalled = $false
    $previousVersion = $null; $config = $null; $maintenanceConfig = $null
    $backup = $null; $appBackupFolder = $null; $manifestPath = $null
    try {
        Assert-ServiceTargetsApp | Out-Null
        $envPath = Join-Path $script:AppPath '.env'
        $config = Read-DotEnv $envPath; Assert-RequiredEnvironment $config
        $previousVersion = Get-AppVersion
        $currentHealth = Wait-ForHealth $previousVersion
        $release = Resolve-ReleasePackage
        if ((Compare-SemVer $previousVersion $release.Version) -ge 0) {
            Fail "Release v$($release.Version) is not newer than installed v$previousVersion."
        }
        $script:ResolvedPgBin = Find-PgBin
        Write-Ok "PostgreSQL tools: $script:ResolvedPgBin"
        $maintenanceConfig = Get-MaintenanceDatabaseConfig $config
        Get-BusinessFingerprint (Join-Path $script:AppPath 'rx-db.exe') $maintenanceConfig | Out-Null
        Write-Ok 'Database maintenance login verified before downtime.'

        Write-Step "Installing RX Tracker v$($release.Version) over v$previousVersion"
        Stop-ManagedService; $serviceStopped = $true
        $backup = New-DatabaseBackup $maintenanceConfig "before-v$($release.Version)"
        $appBackupFolder = Join-Path $script:ReleaseBackupsPath ("$(Get-Date -Format 'yyyyMMdd-HHmmss')-v$previousVersion-before-v$($release.Version)")
        New-Item -ItemType Directory -Path $appBackupFolder -Force | Out-Null
        $manifestPath = Backup-ApplicationFiles -Entries (Normalize-ReleaseEntries $release.Entries) -Folder $appBackupFolder
        $targetDbExe = Join-Path $release.Staging 'rx-db.exe'
        $beforeFingerprint = Get-BusinessFingerprint $targetDbExe $maintenanceConfig
        [IO.File]::WriteAllText((Join-Path $appBackupFolder 'business-before.json'),
            ($beforeFingerprint | ConvertTo-Json -Depth 12), (New-Object Text.UTF8Encoding($false)))
        Save-State @{
            status = 'in_progress'; previousVersion = $previousVersion; targetVersion = $release.Version
            startedAt = (Get-Date).ToString('o'); applicationBackup = $appBackupFolder
            filesManifest = $manifestPath; databaseBackup = $backup.Path; databaseBackupHash = $backup.Hash
            database = [string]$config['DB_NAME']; package = $release.Zip
        }

        $migrationAttempted = $true
        Invoke-RxDb $targetDbExe $maintenanceConfig @('migrate')
        Invoke-RxDb $targetDbExe $maintenanceConfig @('verify')
        Invoke-RxDb $targetDbExe $maintenanceConfig @('seed-reference')
        Invoke-RxDb $targetDbExe $maintenanceConfig @('verify')
        $afterFingerprint = Get-BusinessFingerprint $targetDbExe $maintenanceConfig
        [IO.File]::WriteAllText((Join-Path $appBackupFolder 'business-after.json'),
            ($afterFingerprint | ConvertTo-Json -Depth 12), (New-Object Text.UTF8Encoding($false)))
        Assert-BusinessDataUnchanged $beforeFingerprint $afterFingerprint

        Install-ApplicationFiles -SourceRoot $release.Staging -Entries (Normalize-ReleaseEntries $release.Entries); $filesInstalled = $true
        $envHashBefore = (Get-FileHash -LiteralPath (Join-Path $appBackupFolder 'protected.env') -Algorithm SHA256).Hash
        $envHashAfter = (Get-FileHash -LiteralPath $envPath -Algorithm SHA256).Hash
        if ($envHashBefore -ne $envHashAfter) { Fail 'Production .env changed during the update.' }
        Start-ManagedService
        Wait-ForHealth $release.Version | Out-Null
        Save-State @{ status = 'complete'; completedAt = (Get-Date).ToString('o'); activeVersion = $release.Version }
        Write-Ok "RX Tracker update completed: v$previousVersion -> v$($release.Version)."
        Write-Host "Rollback assets: $appBackupFolder" -ForegroundColor DarkGray
    } catch {
        $failure = $_.Exception.Message
        Write-Host "Update failed: $failure" -ForegroundColor Red
        if ($serviceStopped) {
            Write-Host 'Attempting automatic application and database recovery...' -ForegroundColor Yellow
            try {
                $running = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
                if ($running -and $running.Status -ne 'Stopped') { Stop-Service -Name $ServiceName -Force; $running.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(30)) }
                if ($migrationAttempted -and $backup) { Restore-DatabaseBackup $maintenanceConfig $backup.Path $backup.Hash }
                if ($manifestPath) { Restore-ApplicationFiles -BackupFolder $appBackupFolder -ManifestPath $manifestPath }
                Start-ManagedService
                if ($previousVersion) { Wait-ForHealth $previousVersion | Out-Null }
                Save-State @{ status = 'failed_recovered'; failedAt = (Get-Date).ToString('o'); failure = $failure }
                Write-Ok 'Automatic recovery restored the previous application and database.'
            } catch {
                Save-State @{ status = 'recovery_failed'; failedAt = (Get-Date).ToString('o'); failure = $failure; recoveryFailure = $_.Exception.Message }
                Write-Host "AUTOMATIC RECOVERY FAILED: $($_.Exception.Message)" -ForegroundColor Red
                Write-Host 'Keep the service stopped and use the recorded database/application backups.' -ForegroundColor Red
            }
        }
        throw
    } finally {
        Remove-StagingPath
        Release-UpdateLock
    }
}

function Invoke-Rollback {
    Assert-Administrator
    if ($Confirm -ne 'ROLLBACK') { Fail "Rollback requires -Confirm 'ROLLBACK'." }
    Acquire-UpdateLock
    $safetyBackup = $null; $currentFilesBackup = $null; $currentManifest = $null
    try {
        $state = Load-State
        if (-not $state -or [string]$state.status -ne 'complete') { Fail 'No completed release update is available for rollback.' }
        $config = Read-DotEnv (Join-Path $script:AppPath '.env'); Assert-RequiredEnvironment $config
        $maintenanceConfig = Get-MaintenanceDatabaseConfig $config
        $currentVersion = Get-AppVersion
        if ($currentVersion -ne [string]$state.targetVersion) { Fail 'Installed version does not match the recorded update target.' }
        $script:ResolvedPgBin = Find-PgBin
        Get-BusinessFingerprint (Join-Path $script:AppPath 'rx-db.exe') $maintenanceConfig | Out-Null
        Write-Ok 'Database maintenance login verified before downtime.'
        Write-Host 'WARNING: rollback restores the pre-update database. Newer records will leave the active database.' -ForegroundColor Red
        Stop-ManagedService
        $safetyBackup = New-DatabaseBackup $maintenanceConfig "before-rollback-v$currentVersion"
        $previousManifest = @(Get-Content -LiteralPath ([string]$state.filesManifest) -Raw | ConvertFrom-Json)
        $entries = @($previousManifest | ForEach-Object { [string]$_.Path })
        $currentFilesBackup = Join-Path $script:ReleaseBackupsPath ("$(Get-Date -Format 'yyyyMMdd-HHmmss')-rollback-safety-v$currentVersion")
        New-Item -ItemType Directory -Path $currentFilesBackup -Force | Out-Null
        $currentManifest = Backup-ApplicationFiles -Entries $entries -Folder $currentFilesBackup

        Restore-DatabaseBackup $maintenanceConfig ([string]$state.databaseBackup) ([string]$state.databaseBackupHash)
        Restore-ApplicationFiles -BackupFolder ([string]$state.applicationBackup) -ManifestPath ([string]$state.filesManifest)
        Start-ManagedService
        Wait-ForHealth ([string]$state.previousVersion) | Out-Null
        Save-State @{
            status = 'rolled_back'; rolledBackAt = (Get-Date).ToString('o'); activeVersion = [string]$state.previousVersion
            forwardDatabaseBackup = $safetyBackup.Path; forwardDatabaseBackupHash = $safetyBackup.Hash
            forwardApplicationBackup = $currentFilesBackup; forwardFilesManifest = $currentManifest
        }
        Write-Ok "Rolled back RX Tracker v$currentVersion -> v$($state.previousVersion)."
    } finally { Release-UpdateLock }
}

function Invoke-SelfTest {
    if ((Compare-SemVer '4.0.0-next.4' '4.0.0-next.5') -ge 0) { Fail 'Prerelease version comparison failed.' }
    if ((Compare-SemVer '4.0.0-next.5' '4.0.0') -ge 0) { Fail 'Stable version comparison failed.' }
    if ((Compare-SemVer '4.0.1' '4.0.0') -le 0) { Fail 'Patch version comparison failed.' }
    $before = [pscustomobject]@{
        tableCounts = [pscustomobject]@{ Patients = 10; RXRecords = 6; PatientTagAssignments = 4 }
        workflowActions = @([pscustomobject]@{ id = 1; name = 'Configured'; isActive = $true })
        regionalAssignmentGaps = 0
    }
    $same = $before | ConvertTo-Json -Depth 8 | ConvertFrom-Json
    Assert-BusinessDataUnchanged $before $same
    $tagSeedChange = [pscustomobject]@{
        tableCounts = [pscustomobject]@{ Patients = 10; RXRecords = 6; PatientTags = 3; PatientTagAssignments = 4 }
        workflowActions = $same.workflowActions
        regionalAssignmentGaps = 0
    }
    Assert-BusinessDataUnchanged $before $tagSeedChange
    $regionalBackfillBefore = [pscustomobject]@{
        tableCounts = [pscustomobject]@{ Patients = 10; RXRecords = 6; PatientTagAssignments = 4 }
        workflowActions = $same.workflowActions
        regionalAssignmentGaps = 2
    }
    $regionalBackfillAfter = [pscustomobject]@{
        tableCounts = [pscustomobject]@{ Patients = 10; RXRecords = 6; PatientTagAssignments = 6 }
        workflowActions = $same.workflowActions
        regionalAssignmentGaps = 0
    }
    Assert-BusinessDataUnchanged $regionalBackfillBefore $regionalBackfillAfter
    try {
        $changedAssignments = $before | ConvertTo-Json -Depth 8 | ConvertFrom-Json
        $changedAssignments.tableCounts.PatientTagAssignments = 5
        Assert-BusinessDataUnchanged $before $changedAssignments
        Fail 'Patient tag assignment fingerprint change was not rejected.'
    } catch {
        if ($_.Exception.Message -notmatch 'Business-data validation failed') { throw }
    }
    try {
        $changed = $before | ConvertTo-Json -Depth 8 | ConvertFrom-Json
        $changed.workflowActions[0].name = 'Unexpected default'
        Assert-BusinessDataUnchanged $before $changed
        Fail 'Business fingerprint change was not rejected.'
    } catch {
        if ($_.Exception.Message -notmatch 'Business-data validation failed') { throw }
    }
    $expected = 'C:\RX-Tracker\RX-APP-NEXT\server.exe'
    if ((Select-FirstNativeValue @($expected, '', ([string][char]0))) -ne $expected) { Fail 'NSSM parser self-test failed.' }
    $releaseEntries = Normalize-ReleaseEntries @('server.exe', 'rx-db.exe', 'scripts/project-control.ps1')
    if ($releaseEntries.Count -ne 3 -or $releaseEntries[2] -ne 'scripts/project-control.ps1') {
        Fail 'Release entry normalization self-test failed.'
    }
    try {
        Normalize-ReleaseEntries @("server.exe rx-db.exe package.json") | Out-Null
        Fail 'Combined release entry self-test failed.'
    } catch {
        if ($_.Exception.Message -notmatch 'combined file list') { throw }
    }
    try {
        Normalize-ReleaseEntries @("server.exe`nrx-db.exe") | Out-Null
        Fail 'Newline release entry self-test failed.'
    } catch {
        if ($_.Exception.Message -notmatch 'invalid newline') { throw }
    }
    $oldMaintenanceUser = $env:RX_DB_MAINTENANCE_USER
    $oldMaintenancePass = $env:RX_DB_MAINTENANCE_PASS
    try {
        $env:RX_DB_MAINTENANCE_USER = 'maintenance_test'
        $env:RX_DB_MAINTENANCE_PASS = 'maintenance-test-password'
        $runtime = @{ DB_HOST = '127.0.0.1'; DB_USER = 'runtime_test'; DB_PASS = 'runtime-test-password'; DB_NAME = 'runtime_test_db' }
        $maintenance = Get-MaintenanceDatabaseConfig $runtime
        if ($maintenance['DB_USER'] -ne 'maintenance_test' -or $maintenance['DB_PASS'] -ne 'maintenance-test-password') {
            Fail 'Maintenance credential separation self-test failed.'
        }
        if ($runtime['DB_USER'] -ne 'runtime_test' -or $runtime['DB_PASS'] -ne 'runtime-test-password') {
            Fail 'Runtime configuration was modified by maintenance credential selection.'
        }
    } finally {
        $env:RX_DB_MAINTENANCE_USER = $oldMaintenanceUser
        $env:RX_DB_MAINTENANCE_PASS = $oldMaintenancePass
    }
    Write-Ok 'Compiled release updater self-test passed.'
}

function Show-Help {
    @'
RX Tracker compiled release updater

  PROJECT-CONTROL.bat check-update
  PROJECT-CONTROL.bat update
  PROJECT-CONTROL.bat update "C:\path\server-update-VERSION.zip"
  PROJECT-CONTROL.bat rollback ROLLBACK

Update verifies the official GitHub checksums, stops the service, creates a
verified PostgreSQL backup, records a business-data fingerprint, applies
audited migrations, preserves .env, installs the release, starts the service,
and requires a healthy response. Any failure before reopening traffic attempts
to restore both the prior application and the stopped-system database backup.

When DB_USER is a restricted runtime identity, Project Control requests a
separate PostgreSQL maintenance login before downtime. The maintenance password
is held only in the Project Control process and is not written to .env or disk.

Rollback is destructive to records created after the update. It first preserves
the current application and database in a separate safety backup.
'@ | Write-Host
}

Initialize-Paths
try {
    switch ($Action) {
        Help { Show-Help }
        SelfTest { Invoke-SelfTest }
        Status { Invoke-Status }
        Check { Invoke-Check }
        Update { Invoke-Update }
        Rollback { Invoke-Rollback }
    }
} catch {
    Write-Host "[FAILED] $($_.Exception.Message)" -ForegroundColor Red
    exit 1
} finally {
    Remove-StagingPath
    Release-UpdateLock
}
