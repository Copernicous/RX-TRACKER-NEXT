[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$MaintenanceEnv,
    [Parameter(Mandatory=$true)][string]$OutputDirectory,
    [Parameter(Mandatory=$true)][string]$DotnetDirectory,
    [Parameter(Mandatory=$true)][string]$CodeqlExe,
    [string]$PgBin = 'C:\Program Files\PostgreSQL\17\bin'
)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))
Set-Location -LiteralPath $root
$output = [IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $output) { throw 'Use a new output directory; existing release evidence is never overwritten.' }
if (@(git status --porcelain).Count -ne 0) { throw 'Release preparation requires a clean checkout, including untracked files.' }
if (Test-Path -LiteralPath (Join-Path $root '.env')) { throw 'Use a clean release worktree without local configuration.' }
$sha = (git rev-parse HEAD).Trim()
$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
$notes = Join-Path $root ".github/releases/v$version.md"
if (-not (Test-Path -LiteralPath $notes)) { throw 'Missing version-specific release notes.' }
if ((Get-Content $notes -Raw) -notmatch [regex]::Escape($version)) { throw 'Release notes version mismatch.' }
$lockVersions = @(& node.exe -p "JSON.stringify([require('./package-lock.json').version,require('./package-lock.json').packages[''].version])") | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or $lockVersions[0] -ne $version -or $lockVersions[1] -ne $version) { throw 'Lockfile version mismatch.' }
foreach ($tool in @((Join-Path $DotnetDirectory 'dotnet.exe'), $CodeqlExe, (Join-Path $PgBin 'pg_dump.exe'))) {
    if (-not (Test-Path -LiteralPath $tool)) { throw "Missing local tool: $tool" }
}
New-Item -ItemType Directory -Path $output | Out-Null
$env:PATH = "$DotnetDirectory;$PgBin;$env:PATH"
$env:DOTNET_ROOT = $DotnetDirectory
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
$env:DOTNET_NOLOGO = '1'
function Invoke-Checked([string]$Label, [string]$Executable, [string[]]$Arguments) {
    Write-Host "RUN $Label"
    $ErrorActionPreference = 'Continue'
    & $Executable @Arguments *> (Join-Path $output "$Label.log")
    $exitCode = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    if ($exitCode -ne 0) { throw "$Label failed; inspect its local log. No release may be published." }
    Write-Host "PASS $Label"
}
Invoke-Checked 'locked-dependencies' 'npm.cmd' @('ci')
Invoke-Checked 'lifecycle' 'node.exe' @('scripts/local-release-checks.js','--env-file',$MaintenanceEnv,'--output',(Join-Path $output 'lifecycle'),'--pg-bin',$PgBin)
$validation = Get-Content (Join-Path $output 'lifecycle/validation.json') -Raw | ConvertFrom-Json
if (-not $validation.passed -or $validation.sourceCommit -ne $sha) { throw 'Exact-source local lifecycle validation is missing.' }
Invoke-Checked 'softphone-compile' (Join-Path $DotnetDirectory 'dotnet.exe') @('build','rx-softphone-desktop/RxSoftphone.csproj','-c','Release','-r','win-x64')
foreach ($language in @('javascript','csharp')) {
    $dbPath = Join-Path $output "codeql-$language"
    Invoke-Checked "codeql-$language-create" $CodeqlExe @('database','create',$dbPath,"--language=$language","--source-root=$root",'--build-mode=none','--threads=2')
    Invoke-Checked "codeql-$language-analyze" $CodeqlExe @('database','analyze',$dbPath,"codeql/$language-queries:codeql-suites/$language-code-scanning.qls",'--format=sarif-latest',"--output=$(Join-Path $output "$language.sarif")",'--threads=2')
    $sarif = Get-Content (Join-Path $output "$language.sarif") -Raw | ConvertFrom-Json
    foreach ($run in $sarif.runs) {
        foreach ($result in $run.results) {
            $rule = $run.tool.driver.rules | Where-Object id -eq $result.ruleId | Select-Object -First 1
            if ([double]$rule.properties.'security-severity' -ge 7 -or $result.level -eq 'error') { throw "CodeQL blocking finding: $($result.ruleId). Review SARIF before release." }
        }
    }
}
Invoke-Checked 'server-build' 'npx.cmd' @('--yes','--package=@yao-pkg/pkg@6.23.0','pkg','app.js','--target','node22-win-x64','--output','dist/server.exe','--compress','GZip')
Invoke-Checked 'database-cli-build' 'npx.cmd' @('--yes','--package=@yao-pkg/pkg@6.23.0','pkg','scripts/db-lifecycle.js','--target','node22-win-x64','--output','dist/rx-db.exe','--compress','GZip')
Invoke-Checked 'server-packaging' 'node.exe' @('scripts/post-build.js')
Invoke-Checked 'softphone-packaging' 'powershell.exe' @('-NoProfile','-ExecutionPolicy','Bypass','-File','rx-softphone-desktop/build-release.ps1')
$softphone = @(Get-ChildItem rx-softphone-desktop/release -Filter 'RxSoftphone-*-win-x64.zip' -File)
if ($softphone.Count -ne 1) { throw 'Expected one Softphone ZIP in clean checkout.' }
Copy-Item -LiteralPath $softphone[0].FullName -Destination dist
Invoke-Checked 'server-version' (Join-Path $root 'dist/server.exe') @('--v')
if ((Get-Content (Join-Path $output 'server-version.log') -Raw) -notmatch [regex]::Escape($version)) { throw 'Compiled version mismatch.' }
Invoke-Checked 'database-cli-help' (Join-Path $root 'dist/rx-db.exe') @('help')
$assets = @("server-update-$version.zip", "RX-Tracker-NEXT-New-Server-$version.zip", $softphone[0].Name)
$hashes = @{}
foreach ($name in @('server.exe','rx-db.exe') + $assets) {
    $hashes[$name] = (Get-FileHash -LiteralPath (Join-Path $root "dist/$name") -Algorithm SHA256).Hash.ToLowerInvariant()
}
$lines = @($hashes.Keys | Sort-Object | ForEach-Object { "$($hashes[$_]) *$_" })
[IO.File]::WriteAllLines((Join-Path $root 'dist/SHA256SUMS.txt'), $lines, (New-Object Text.UTF8Encoding($false)))
Add-Type -AssemblyName System.IO.Compression.FileSystem
foreach ($name in $assets) {
    $zip = [IO.Compression.ZipFile]::OpenRead((Join-Path $root "dist/$name"))
    try {
        $names = @($zip.Entries | ForEach-Object { $_.FullName.Replace('\','/') })
        foreach ($entry in $names) {
            if ($entry -match '(^/|(^|/)\.\.(/|$)|:|(^|/)\.env($|\.(?!example$))|(^|/)(node_modules|logs|backups|uploads)/)') { throw "Unsafe ZIP entry: $entry" }
        }
        if ($name -notlike 'RxSoftphone-*') {
            foreach ($required in @('server.exe','rx-db.exe','.env.example','package.json','PROJECT-CONTROL.bat','UPDATE-EXISTING-SERVER.bat','INSTALL-NEW-SERVER.bat',"RELEASE_NOTES-v$version.md",'scripts/Invoke-ReleaseUpdate.ps1','scripts/Install-NewServer.ps1')) {
                if ($names -notcontains $required) { throw "Missing package entry: $required" }
            }
            foreach ($entry in $zip.Entries) {
                $relative = $entry.FullName.Replace('\','/')
                $source = if ($relative -in @('server.exe','rx-db.exe')) { Join-Path $root "dist/$relative" } elseif ($relative -eq "RELEASE_NOTES-v$version.md") { $notes } else { Join-Path $root $relative }
                if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Unexpected package file: $relative" }
                $stream = $entry.Open()
                try { $algorithm = [Security.Cryptography.SHA256]::Create(); $embedded = [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-','').ToLowerInvariant(); $algorithm.Dispose() }
                finally { $stream.Dispose() }
                if ($embedded -ne (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()) { throw "Package/source mismatch: $relative" }
            }
        }
    } finally { $zip.Dispose() }
    Copy-Item -LiteralPath (Join-Path $root "dist/$name") -Destination $output
}
Copy-Item -LiteralPath (Join-Path $root 'dist/SHA256SUMS.txt') -Destination $output
if ((git rev-parse HEAD).Trim() -ne $sha -or @(git status --porcelain).Count -ne 0) { throw 'Source changed during validation/build; rerun from clean checkout.' }
$manifest = @{ version=$version; sourceCommit=$sha; finishedAt=[DateTime]::UtcNow.ToString('o'); localValidationPassed=$true; checksums=$hashes; lifecycleChecks=@($validation.checks).Count; codeql=@('javascript','csharp'); pkgVersion='6.23.0'; nodeVersion=(& node.exe --version); dotnetVersion=(& (Join-Path $DotnetDirectory 'dotnet.exe') --version) }
$manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $output 'LOCAL_VALIDATION.json') -Encoding UTF8
Write-Host "PASS local release $version from $sha. Assets: $output"
Write-Host 'No source, tag, draft or release was pushed/published. Installation remains a separate operator action.'
