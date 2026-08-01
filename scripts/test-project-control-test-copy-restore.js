'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const restorePath = path.join(root, 'scripts', 'Invoke-TestCopyRestore.ps1');
const controlPath = path.join(root, 'scripts', 'project-control.ps1');
const postBuildPath = path.join(root, 'scripts', 'post-build.js');
const installControlPath = path.join(root, 'scripts', 'Install-ProjectControl.ps1');
const installServerPath = path.join(root, 'scripts', 'Install-NewServer.ps1');
const updatePath = path.join(root, 'scripts', 'Invoke-ReleaseUpdate.ps1');
const documentationPath = path.join(root, 'docs', 'database', 'TEST_COPY_RESTORE.md');
const appPath = path.join(root, 'app.js');

for (const file of [
  restorePath, controlPath, postBuildPath, installControlPath, installServerPath,
  updatePath, documentationPath, appPath
]) {
  assert(fs.existsSync(file), `Missing guided restore artifact: ${path.relative(root, file)}`);
}

const restore = fs.readFileSync(restorePath, 'utf8');
const control = fs.readFileSync(controlPath, 'utf8');
const postBuild = fs.readFileSync(postBuildPath, 'utf8');
const installControl = fs.readFileSync(installControlPath, 'utf8');
const installServer = fs.readFileSync(installServerPath, 'utf8');
const update = fs.readFileSync(updatePath, 'utf8');
const documentation = fs.readFileSync(documentationPath, 'utf8');
const app = fs.readFileSync(appPath, 'utf8');

assert(restore.includes("[ValidateSet('Interactive', 'SelfTest')]"),
  'Guided restore must expose a non-mutating self-test.');
assert(restore.includes("(?:^|_)(?:test|copy|sandbox|rehearsal|scratch)(?:_|$)"),
  'Restore targets must contain a delimited non-production marker.');
assert(restore.includes("(?:^|_)(?:prod|production|live)(?:_|$)"),
  'Explicit production/live target tokens must be rejected.');
assert(restore.includes("if ($Target -eq $Current"),
  'The active database must be rejected as the restore target.');
for (const normalizationCase of [
  'patient_rx_restore_restore_restore_test',
  'patient_rx_restore_restore_test_2',
  'patient_rx_restore_test_2_restore_test',
  'patient_rx_test_2_restore_3_copy_9',
  'patient_rx_2026_restore_test_2'
]) {
  assert(restore.includes(normalizationCase),
    `Restore self-test must cover repeated suffix sequence ${normalizationCase}.`);
}
for (const unsafeTarget of [
  'patient_rx_contest', 'patient_rx_copycat', 'patient_rx_testdata',
  'patient_rx_production_test', 'patient_rx_live_copy'
]) {
  assert(restore.includes(unsafeTarget),
    `Restore self-test must reject unsafe target ${unsafeTarget}.`);
}
assert(restore.includes("'--list', $dumpPath"),
  'The dump must be validated before target mutation.');
assert(restore.includes('before-replace-'),
  'An existing test copy must be backed up before replacement.');
assert(restore.includes('configure-runtime-role') && restore.includes('verify-runtime-role'),
  'The restricted runtime role must be configured and verified.');
assert(restore.includes('business-fingerprint'),
  'Restored business data must be fingerprinted.');
assert(restore.includes('Copy-Item $envBackup $script:EnvPath -Force'),
  'Failed activation must restore the prior environment file.');
assert(restore.includes('Assert-ServiceTargetsApp') &&
  restore.includes("get $ServiceName Application") &&
  restore.includes("Join-Path $script:AppPath 'server.exe'"),
  'Activation must reuse the guarded NSSM executable-path verification pattern.');
assert(restore.includes('Assert-ServiceEnvironmentTargetsDatabase') &&
  restore.includes("get $ServiceName AppEnvironmentExtra"),
  'Activation must verify the exact NSSM DB_NAME environment value.');
const resetEnvironmentIndex = restore.indexOf('& $nssm reset $ServiceName AppEnvironmentExtra');
const setEnvironmentIndex = restore.indexOf('& $nssm set $ServiceName AppEnvironmentExtra $pairs');
assert(resetEnvironmentIndex >= 0 && setEnvironmentIndex > resetEnvironmentIndex,
  'Activation and recovery must clear stale NSSM environment values before writing the exact snapshot.');
const dotEnvFallbackCalls = restore.match(
  /Assert-ServiceEnvironmentTargetsDatabase[^\r\n]*-AllowDotEnvFallback/g
) || [];
assert(dotEnvFallbackCalls.length === 1 &&
  dotEnvFallbackCalls[0].includes('$previousDatabase') &&
  restore.includes("@('RX_LOCAL_HEALTH_TOKEN=stale')"),
  'Only initial preflight may accept an empty NSSM DB_NAME and fall back to the validated .env.');
const tokenEnvironmentIndex = restore.indexOf('Set-ServiceEnvironment $target $verificationToken');
const tokenStartIndex = restore.indexOf('Start-ServiceSafe', tokenEnvironmentIndex);
const tokenRemovalIndex = restore.indexOf('Set-ServiceEnvironment $target', tokenStartIndex);
const tokenHealthIndex = restore.indexOf('Wait-ForHealth $version $target $verificationToken', tokenRemovalIndex);
assert(restore.includes('RX_LOCAL_HEALTH_TOKEN') &&
  restore.includes('New-LocalHealthToken') &&
  tokenEnvironmentIndex >= 0 && tokenStartIndex > tokenEnvironmentIndex &&
  tokenRemovalIndex > tokenStartIndex && tokenHealthIndex > tokenRemovalIndex,
  'Activation must inject an unguessable token, start, remove it from NSSM, then verify health.');
assert(restore.includes('Get-NetTCPConnection -State Listen -LocalPort $Port') &&
  restore.includes('Get-CimInstance Win32_Process') &&
  restore.includes('Get-CimInstance Win32_Service') &&
  restore.includes('ParentProcessId'),
  'Health must be bound to the configured port, intended process, and NSSM service parent.');
assert(restore.includes('Wait-ForHealth $version $target $verificationToken'),
  'Activation must verify the exact target database through one-time local health detail.');
assert(!restore.includes('RX_DB_MAINTENANCE_PASS=') && !restore.includes('DB_PASS=postgres'),
  'No maintenance password may be embedded in the restore workflow.');

assert(app.includes("process.env.RX_LOCAL_HEALTH_TOKEN") &&
  app.includes("delete process.env.RX_LOCAL_HEALTH_TOKEN"),
  'The app must keep the one-time health token out of its continuing process environment.');
assert(app.includes('req.socket && req.socket.remoteAddress') &&
  app.includes('requestSecurity.isLoopbackHost(req)') &&
  app.includes("req.headers['x-rx-local-health-token']") &&
  app.includes('crypto.timingSafeEqual') &&
  app.includes('localHealthVerificationInFlight'),
  'Local health detail must require loopback socket/host and constant-time token validation.');
assert(app.includes('SELECT current_database() AS "databaseName"') &&
  app.includes('executablePath: process.execPath'),
  'Local health detail must report the actual connected database and running executable.');
assert(app.includes('if (localVerification) payload.localVerification = localVerification;'),
  'Database/executable details must not be added to ordinary public health responses.');
assert(app.includes("res.once('finish'") &&
  app.includes("if (localVerificationReady) localHealthVerificationToken = '';"),
  'The token must be consumed only after verified local health is delivered successfully.');
assert(restore.includes('if (-not $health.localVerification)') && restore.includes('continue'),
  'Project Control must retry when a prior local verification request is still completing.');

assert(control.includes('25. Restore verified dump into isolated test copy'),
  'Project Control must expose the guided restore option.');
assert(control.includes("'restore-test-copy'"),
  'Project Control must route the guided restore action.');
assert(postBuild.includes("path.join('scripts', 'Invoke-TestCopyRestore.ps1')"),
  'Official server ZIPs must include the guided restore script.');
assert(postBuild.includes("path.join('docs', 'database', 'TEST_COPY_RESTORE.md')"),
  'Official server ZIPs must include the operator guide.');
assert(installControl.includes("'scripts\\Invoke-TestCopyRestore.ps1'"),
  'Project Control bootstrap installs must include guided restore.');
assert(installServer.includes("'scripts\\Invoke-TestCopyRestore.ps1'"),
  'Portable new-server installs must require guided restore.');
assert(update.includes("'scripts/Invoke-TestCopyRestore.ps1'"),
  'Official releases must require the guided restore artifact.');
assert(documentation.includes('option 16 remains'),
  'The guide must distinguish test-copy restore from production rollback.');

console.log('PASS guided test-copy restore safety, Project Control routing, packaging, recovery, and documentation regression.');
