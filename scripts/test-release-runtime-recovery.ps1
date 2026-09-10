[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$PgBin)
$ErrorActionPreference = 'Stop'
if ($env:DB_HOST -ne '127.0.0.1' -or -not $env:DB_USER -or -not $env:DB_PASS) { throw 'Requires explicitly configured localhost PostgreSQL maintenance credentials.' }
$root = Split-Path $PSScriptRoot -Parent
$tokens=$null; $errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'Invoke-ReleaseUpdate.ps1'),[ref]$tokens,[ref]$errors)
if($errors.Count){throw ($errors|Out-String)}
foreach($fn in $ast.FindAll({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst]},$false)) {
    if($fn.Name -in @('Fail','Write-Ok','New-DatabaseBackup','Restore-DatabaseBackup','Restore-RuntimeDatabaseAccess')) { . ([scriptblock]::Create($fn.Extent.Text)) }
}
$suffix=[guid]::NewGuid().ToString('N').Substring(0,12)
$testDb="rx_recovery_test_$suffix"; $testRole="rx_recovery_role_$suffix"
$rolePassword=[guid]::NewGuid().ToString('N')
$script:ResolvedPgBin=$PgBin
$script:DatabaseBackupsPath=Join-Path $root "output/recovery-test-$suffix"
$config=@{DB_HOST=$env:DB_HOST;DB_PORT=$(if($env:DB_PORT){$env:DB_PORT}else{'5432'});DB_USER=$env:DB_USER;DB_PASS=$env:DB_PASS;DB_NAME=$testDb}
$runtime=$config.Clone();$runtime.DB_USER=$testRole;$runtime.DB_PASS=$rolePassword
$oldPassword=$env:PGPASSWORD;$env:PGPASSWORD=$config.DB_PASS
$dbCreated=$false;$roleCreated=$false
function Invoke-TestSql([string]$Database,[string]$Sql) {
    $lines=$Sql | & (Join-Path $PgBin 'psql.exe') -h 127.0.0.1 -p $config.DB_PORT -U $config.DB_USER -d $Database -X -w -v ON_ERROR_STOP=1 -At -f -
    if($LASTEXITCODE -ne 0){throw 'Test SQL failed.'};return $lines
}
try {
    Invoke-TestSql postgres "CREATE DATABASE $testDb;" | Out-Null;$dbCreated=$true
    Invoke-TestSql postgres "CREATE ROLE $testRole LOGIN PASSWORD '$rolePassword';" | Out-Null;$roleCreated=$true
    Invoke-TestSql $testDb 'CREATE TABLE "Patients" (id serial PRIMARY KEY, marker text); CREATE TABLE "SequelizeMeta" (name text); INSERT INTO "Patients"(marker) VALUES (''SYNTHETIC RESTORE SENTINEL'');' | Out-Null
    Restore-RuntimeDatabaseAccess $config $runtime | Out-Null
    $backup=New-DatabaseBackup $config 'with-acl'
    Restore-DatabaseBackup $config $backup.Path $backup.Hash $runtime | Out-Null
    $legacy=Join-Path $script:DatabaseBackupsPath 'legacy-no-acl.dump'
    & (Join-Path $PgBin 'pg_dump.exe') -h 127.0.0.1 -p $config.DB_PORT -U $config.DB_USER -Fc --no-owner --no-privileges -f $legacy $testDb
    if($LASTEXITCODE -ne 0){throw 'Legacy test dump failed.'}
    Restore-DatabaseBackup $config $legacy (Get-FileHash -LiteralPath $legacy).Hash $runtime | Out-Null
    $sql=@"
SELECT has_table_privilege('$testRole', 'public."Patients"', 'SELECT') AND has_sequence_privilege('$testRole','public."Patients_id_seq"','USAGE') AND has_table_privilege('$testRole','public."SequelizeMeta"','SELECT') AND NOT has_table_privilege('$testRole','public."SequelizeMeta"','INSERT') AND NOT has_schema_privilege('$testRole','public','CREATE');
SELECT marker FROM "Patients";
"@
    $result=@(Invoke-TestSql $testDb $sql)
    if($result -notcontains 't' -or $result -notcontains 'SYNTHETIC RESTORE SENTINEL'){throw 'Restored data or runtime permissions differ.'}
    $env:PGPASSWORD=$rolePassword
    'SELECT count(*) FROM "Patients";' | & (Join-Path $PgBin 'psql.exe') -h 127.0.0.1 -p $config.DB_PORT -U $testRole -d $testDb -X -w -v ON_ERROR_STOP=1 -At -f - | Out-Null
    if($LASTEXITCODE -ne 0){throw 'Runtime login/read failed after recovery.'}
    $env:PGPASSWORD=$config.DB_PASS
    $bad=$runtime.Clone();$bad.DB_NAME='different_test_database'
    $rejected=$false;try{Restore-RuntimeDatabaseAccess $config $bad}catch{$rejected=$true}
    if(-not $rejected){throw 'Mismatched database identity accepted.'}
    Write-Output 'PASS real PostgreSQL backup/restore with retained and legacy omitted ACLs, runtime login/read, ledger protection, and data preservation.'
} finally {
    $env:PGPASSWORD=$config.DB_PASS
    # Both exact names were minted above and only successfully created fixtures are removed.
    if($testDb -notmatch '^rx_recovery_test_[a-f0-9]{12}$' -or $testRole -notmatch '^rx_recovery_role_[a-f0-9]{12}$'){throw 'Unsafe fixture cleanup target.'}
    if($dbCreated){Invoke-TestSql postgres "DROP DATABASE $testDb;" | Out-Null}
    if($roleCreated){Invoke-TestSql postgres "DROP ROLE $testRole;" | Out-Null}
    $env:PGPASSWORD=$oldPassword
}
