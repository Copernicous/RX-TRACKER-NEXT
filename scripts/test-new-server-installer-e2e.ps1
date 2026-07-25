[CmdletBinding()]
param(
    [string]$PackageRoot,
    [string]$PgBin = 'C:\Program Files\PostgreSQL\17\bin',
    [string]$DatabaseHost = '127.0.0.1',
    [int]$DatabasePort = 55432,
    [string]$TestSuperuser = 'rxnext_test',
    [int]$HttpPort = 3198
)

$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))
$expectedVersion = (Get-Content (Join-Path $repoRoot 'package.json') -Raw | ConvertFrom-Json).version

if (-not $PackageRoot) {
    $PackageRoot = Get-ChildItem (Join-Path $repoRoot 'database-work') `
        -Directory `
        -Filter 'portable-final-validation-*' |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1 -ExpandProperty FullName
}
if (-not $PackageRoot -or -not (Test-Path -LiteralPath $PackageRoot -PathType Container)) {
    throw 'Supply -PackageRoot with an extracted portable new-server package.'
}

$psql = Join-Path $PgBin 'psql.exe'
if (-not (Test-Path -LiteralPath $psql -PathType Leaf)) {
    throw "psql.exe was not found in $PgBin."
}

$stamp = Get-Date -Format 'MMddHHmmss'
$databaseName = "rx_next_portable_test_$stamp"
$maintenanceRole = "rx_portable_maint_$stamp"
$runtimeRole = ("rx_" + $databaseName + '_runtime').ToLowerInvariant()
$serviceName = "RXPortableTest$stamp"
$installRoot = Join-Path $repoRoot "database-work\portable-e2e-$stamp"
$alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
$adminAlphabet = $alphabet + '!@#'
$maintenancePassword = -join ((1..40) | ForEach-Object { $alphabet.ToCharArray() | Get-Random })
$adminPassword = -join ((1..24) | ForEach-Object { $adminAlphabet.ToCharArray() | Get-Random })
$serverProcess = $null
$savedDatabaseEnvironment = @{}

foreach ($identifier in @($databaseName, $maintenanceRole, $runtimeRole)) {
    if ($identifier -notmatch '^[a-z0-9_]{1,63}$') {
        throw "Unsafe generated PostgreSQL identifier: $identifier"
    }
}

function Invoke-Psql([string[]]$Arguments) {
    & $psql @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "psql failed with exit code $LASTEXITCODE."
    }
}

function Test-Scalar([string]$Sql) {
    $output = & $psql `
        -h $DatabaseHost `
        -p $DatabasePort `
        -U $TestSuperuser `
        -d postgres `
        -tA `
        -v ON_ERROR_STOP=1 `
        -c $Sql
    if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL scalar query failed.' }
    return ($output | Out-String).Trim()
}

try {
    Invoke-Psql @(
        '-h', $DatabaseHost,
        '-p', [string]$DatabasePort,
        '-U', $TestSuperuser,
        '-d', 'postgres',
        '-v', 'ON_ERROR_STOP=1',
        '-c', "CREATE ROLE $maintenanceRole LOGIN SUPERUSER CREATEDB CREATEROLE PASSWORD '$maintenancePassword';"
    )

    $env:RX_NEW_SERVER_DB_PASSWORD = $maintenancePassword
    $env:RX_NEW_SERVER_ADMIN_PASSWORD = $adminPassword
    $installer = Join-Path $PackageRoot 'scripts\Install-NewServer.ps1'
    & $installer `
        -Action Install `
        -InstallRoot $installRoot `
        -AppFolderName 'RX-APP-NEXT' `
        -ServiceName $serviceName `
        -NoService `
        -NonInteractive `
        -ServerAddress '127.0.0.1' `
        -Port $HttpPort `
        -DatabaseHost $DatabaseHost `
        -DatabasePort $DatabasePort `
        -DatabaseName $databaseName `
        -MaintenanceUser $maintenanceRole `
        -MaintenanceDatabase 'postgres' `
        -PgBin $PgBin `
        -AdminUsername 'admin' `
        -AdminEmail 'installer-test@rxsystem.local'
    if ($LASTEXITCODE -ne 0) {
        throw "Portable installer returned exit code $LASTEXITCODE."
    }

    $destination = Join-Path $installRoot 'RX-APP-NEXT'
    foreach ($name in @(
        'DB_HOST',
        'DB_PORT',
        'DB_USER',
        'DB_PASS',
        'DB_NAME',
        'DB_MAINTENANCE_NAME',
        'NODE_ENV'
    )) {
        $savedDatabaseEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
        [Environment]::SetEnvironmentVariable($name, $null, 'Process')
    }
    $serverProcess = Start-Process `
        -FilePath (Join-Path $destination 'server.exe') `
        -WorkingDirectory $destination `
        -WindowStyle Hidden `
        -PassThru `
        -RedirectStandardOutput (Join-Path $installRoot 'e2e-server.stdout.log') `
        -RedirectStandardError (Join-Path $installRoot 'e2e-server.stderr.log')

    $health = $null
    $deadline = (Get-Date).AddSeconds(60)
    do {
        Start-Sleep -Milliseconds 750
        try {
            $health = Invoke-RestMethod `
                -Uri "http://127.0.0.1:$HttpPort/api/healthz" `
                -TimeoutSec 3
        } catch { }
    } while (
        (-not $health -or $health.status -ne 'ok' -or $health.database -ne 'ok') -and
        (Get-Date) -lt $deadline
    )

    if (
        -not $health -or
        $health.status -ne 'ok' -or
        $health.database -ne 'ok' -or
        [string]$health.version -ne [string]$expectedVersion
    ) {
        throw 'Disposable installed server did not pass health and version checks.'
    }

    $login = Invoke-RestMethod `
        -Uri "http://127.0.0.1:$HttpPort/api/auth/login" `
        -Method Post `
        -ContentType 'application/json' `
        -Body (@{ username = 'admin'; password = $adminPassword } | ConvertTo-Json) `
        -TimeoutSec 10
    if (
        $login.message -ne 'Login successful' -or
        $login.user.username -ne 'admin' -or
        $login.user.isMaster -ne $true
    ) {
        throw 'Disposable first-administrator login verification failed.'
    }

    [pscustomobject]@{
        Installer = 'PASS'
        Health = 'PASS'
        Version = $health.version
        Database = $health.database
        FirstAdminLogin = 'PASS'
        EnvironmentGenerated = Test-Path -LiteralPath (Join-Path $destination '.env')
        ReceiptGenerated = Test-Path -LiteralPath (Join-Path $destination 'new-server-installation.json')
        TestDatabase = $databaseName
    } | Format-List
} finally {
    Remove-Item Env:RX_NEW_SERVER_DB_PASSWORD -ErrorAction SilentlyContinue
    Remove-Item Env:RX_NEW_SERVER_ADMIN_PASSWORD -ErrorAction SilentlyContinue
    foreach ($entry in $savedDatabaseEnvironment.GetEnumerator()) {
        [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, 'Process')
    }

    if ($serverProcess -and -not $serverProcess.HasExited) {
        Stop-Process -Id $serverProcess.Id -Force -ErrorAction SilentlyContinue
        Wait-Process -Id $serverProcess.Id -Timeout 10 -ErrorAction SilentlyContinue
    }

    if ((Test-Scalar "SELECT 1 FROM pg_database WHERE datname = '$databaseName';") -eq '1') {
        Invoke-Psql @(
            '-h', $DatabaseHost,
            '-p', [string]$DatabasePort,
            '-U', $TestSuperuser,
            '-d', 'postgres',
            '-v', 'ON_ERROR_STOP=1',
            '-c', "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$databaseName' AND pid <> pg_backend_pid();",
            '-c', "DROP DATABASE $databaseName;"
        )
    }
    if ((Test-Scalar "SELECT 1 FROM pg_roles WHERE rolname = '$runtimeRole';") -eq '1') {
        Invoke-Psql @(
            '-h', $DatabaseHost,
            '-p', [string]$DatabasePort,
            '-U', $TestSuperuser,
            '-d', 'postgres',
            '-v', 'ON_ERROR_STOP=1',
            '-c', "DROP ROLE $runtimeRole;"
        )
    }
    if ((Test-Scalar "SELECT 1 FROM pg_roles WHERE rolname = '$maintenanceRole';") -eq '1') {
        Invoke-Psql @(
            '-h', $DatabaseHost,
            '-p', [string]$DatabasePort,
            '-U', $TestSuperuser,
            '-d', 'postgres',
            '-v', 'ON_ERROR_STOP=1',
            '-c', "DROP ROLE $maintenanceRole;"
        )
    }
    Write-Host "[OK] Disposable PostgreSQL database and roles cleaned: $databaseName"
}
