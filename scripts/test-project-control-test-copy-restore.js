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

for (const file of [
  restorePath, controlPath, postBuildPath, installControlPath, installServerPath,
  updatePath, documentationPath
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

assert(restore.includes("[ValidateSet('Interactive', 'SelfTest')]"),
  'Guided restore must expose a non-mutating self-test.');
assert(restore.includes("(?i)(test|copy|sandbox|rehearsal|scratch)"),
  'Restore targets must be visibly marked non-production.');
assert(restore.includes("if ($Target -eq $Current"),
  'The active database must be rejected as the restore target.');
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
assert(restore.includes('Set-ServiceEnvironment') && restore.includes('Wait-ForHealth $version'),
  'Activation must synchronize NSSM and pass exact-version health.');
assert(!restore.includes('RX_DB_MAINTENANCE_PASS=') && !restore.includes('DB_PASS=postgres'),
  'No maintenance password may be embedded in the restore workflow.');

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
