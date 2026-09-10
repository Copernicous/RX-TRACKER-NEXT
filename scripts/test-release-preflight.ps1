param([string]$Fixture = '')
$ErrorActionPreference = 'Stop'
$script:UpdaterPath = Join-Path $PSScriptRoot 'Invoke-ReleaseUpdate.ps1'
$script:UpdaterVersion = 'test'
$tokens=$null; $errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($script:UpdaterPath,[ref]$tokens,[ref]$errors)
if($errors.Count){throw ($errors|Out-String)}
foreach($fn in $ast.FindAll({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst]},$false)) {
    if($fn.Name -in @('Fail','Write-Ok','Get-NumericProperty','Assert-BusinessDataUnchanged','Assert-UpdaterMatchesPackage')) { . ([scriptblock]::Create($fn.Extent.Text)) }
}
function Assert-Rejected([scriptblock]$Action) {
    $rejected=$false; try { & $Action } catch { $rejected=$true }
    if(-not $rejected){throw 'Unsafe change was accepted.'}
}
Assert-UpdaterMatchesPackage (Split-Path $PSScriptRoot -Parent)
$folder=Join-Path (Split-Path $PSScriptRoot -Parent) ('output/preflight-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path (Join-Path $folder 'scripts') -Force | Out-Null
Assert-Rejected { Assert-UpdaterMatchesPackage $folder }
[IO.File]::WriteAllText((Join-Path $folder 'scripts/Invoke-ReleaseUpdate.ps1'),'OLD HELPER')
Assert-Rejected { Assert-UpdaterMatchesPackage $folder }
# The identity check must run before service stop or database maintenance.
$update=$ast.FindAll({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Invoke-Update'},$false)[0].Extent.Text
if($update.IndexOf('Assert-UpdaterMatchesPackage') -gt $update.IndexOf('Stop-ManagedService') -or $update.IndexOf('Assert-UpdaterMatchesPackage') -lt 0){throw 'Updater identity check is not before downtime.'}
if($Fixture){
    $before=Get-Content -LiteralPath (Join-Path $Fixture 'before.json') -Raw | ConvertFrom-Json
    $after=Get-Content -LiteralPath (Join-Path $Fixture 'after.json') -Raw | ConvertFrom-Json
    Assert-BusinessDataUnchanged $before $after
    $after.tableCounts.PatientTagAssignments++
    Assert-Rejected { Assert-BusinessDataUnchanged $before $after }
    $after.tableCounts.PatientTagAssignments--
    $after.tableCounts.Patients--
    Assert-Rejected { Assert-BusinessDataUnchanged $before $after }
}
Write-Output 'PASS updater package identity; strict business checks when database fixtures supplied.'
