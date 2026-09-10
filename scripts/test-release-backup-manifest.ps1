$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$source = Join-Path $PSScriptRoot 'Invoke-ReleaseUpdate.ps1'
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($source, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw ($errors | Out-String) }
$names = @('Fail', 'Write-Ok', 'Normalize-ReleaseEntries', 'Assert-PathInside', 'Backup-ApplicationFiles', 'Assert-ApplicationBackup', 'Restore-ApplicationFiles')
foreach ($function in $ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst]}, $false)) {
    if ($names -contains $function.Name) { . ([scriptblock]::Create($function.Extent.Text)) }
}
$fixture = Join-Path $root ('output\manifest-test-' + [guid]::NewGuid().ToString('N'))
$script:AppPath = Join-Path $fixture 'app'
$backup = Join-Path $fixture 'backup'
New-Item -ItemType Directory -Path $script:AppPath,$backup -Force | Out-Null
foreach ($file in @('server.exe', 'rx-db.exe', 'package.json', '.env')) {
    [IO.File]::WriteAllText((Join-Path $script:AppPath $file), "SYNTHETIC $file")
}
$entries = New-Object 'System.Collections.Generic.List[string]'
foreach ($file in @('server.exe', 'rx-db.exe', 'package.json', 'new-file.txt')) { $entries.Add($file) }
$manifest = Backup-ApplicationFiles -Entries (Normalize-ReleaseEntries $entries.ToArray()) -Folder $backup
$originalManifest = [IO.File]::ReadAllText($manifest)
$parsedManifest = $originalManifest | ConvertFrom-Json
if (@($parsedManifest).Count -ne 4) { throw 'File list collapsed during backup.' }
[IO.File]::WriteAllText((Join-Path $script:AppPath 'server.exe'), 'CHANGED')
[IO.File]::WriteAllText((Join-Path $script:AppPath 'new-file.txt'), 'NEW')
Restore-ApplicationFiles -BackupFolder $backup -ManifestPath $manifest
if ([IO.File]::ReadAllText((Join-Path $script:AppPath 'server.exe')) -ne 'SYNTHETIC server.exe') { throw 'Restore failed.' }
if (Test-Path -LiteralPath (Join-Path $script:AppPath 'new-file.txt')) { throw 'New release file was not removed.' }
function Assert-RejectedBeforeWrite([object[]]$Records) {
    [IO.File]::WriteAllText($manifest, ($Records | ConvertTo-Json))
    [IO.File]::WriteAllText((Join-Path $script:AppPath 'server.exe'), 'UNCHANGED SENTINEL')
    $rejected = $false
    try { Restore-ApplicationFiles -BackupFolder $backup -ManifestPath $manifest } catch { $rejected = $true }
    if (-not $rejected) { throw 'Unsafe manifest accepted.' }
    if ([IO.File]::ReadAllText((Join-Path $script:AppPath 'server.exe')) -ne 'UNCHANGED SENTINEL') { throw 'Manifest failure caused partial writes.' }
}
Assert-RejectedBeforeWrite @([pscustomobject]@{Path='server.exe rx-db.exe package.json';Existed=$false})
$records = $originalManifest | ConvertFrom-Json
Assert-RejectedBeforeWrite ($records + [pscustomobject]@{Path='missing.txt';Existed=$true})
Assert-RejectedBeforeWrite ($records + [pscustomobject]@{Path='..\outside.txt';Existed=$false})
Assert-RejectedBeforeWrite ($records + $records[0])
Write-Output 'PASS application backup roundtrip, list preservation, and pre-write rejection of combined/missing/traversal/repeated entries.'
