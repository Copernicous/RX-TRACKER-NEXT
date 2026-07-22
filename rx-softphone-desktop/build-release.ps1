[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$root = [System.IO.Path]::GetFullPath($PSScriptRoot)
$project = Join-Path $root 'RxSoftphone.csproj'
[xml]$projectXml = Get-Content -Raw -LiteralPath $project
$version = [string]$projectXml.Project.PropertyGroup.Version
if ([string]::IsNullOrWhiteSpace($version)) {
    throw 'RxSoftphone.csproj does not contain a Version value.'
}

$portableDotnet = Join-Path $root '.dotnet\dotnet.exe'
$dotnet = if (Test-Path -LiteralPath $portableDotnet) {
    $portableDotnet
} else {
    (Get-Command dotnet -ErrorAction Stop).Source
}

$releaseRoot = [System.IO.Path]::GetFullPath((Join-Path $root 'release'))
$publishRoot = [System.IO.Path]::GetFullPath((Join-Path $releaseRoot $version))
$releasePrefix = $releaseRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
if (-not $publishRoot.StartsWith($releasePrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to clean unexpected release path: $publishRoot"
}

if (Test-Path -LiteralPath $publishRoot) {
    Remove-Item -LiteralPath $publishRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $publishRoot -Force | Out-Null

& $dotnet restore $project --runtime win-x64
if ($LASTEXITCODE -ne 0) { throw 'dotnet restore failed.' }
& $dotnet publish $project -c Release -r win-x64 --self-contained true -o $publishRoot --no-restore
if ($LASTEXITCODE -ne 0) { throw 'dotnet publish failed.' }

foreach ($name in @('README.md', 'CHANGELOG.md', 'Start-Softphone.cmd', 'THIRD-PARTY-NOTICES.md')) {
    Copy-Item -LiteralPath (Join-Path $root $name) -Destination (Join-Path $publishRoot $name) -Force
}

$archive = Join-Path $releaseRoot "RxSoftphone-$version-win-x64.zip"
if (Test-Path -LiteralPath $archive) {
    Remove-Item -LiteralPath $archive -Force
}
Compress-Archive -Path (Join-Path $publishRoot '*') -DestinationPath $archive -CompressionLevel Optimal

Write-Host "RX Softphone $version release created:" -ForegroundColor Green
Write-Host $archive
Get-FileHash -Algorithm SHA256 -LiteralPath $archive | Format-List Path, Hash
