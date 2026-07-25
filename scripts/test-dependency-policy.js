'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const packageInfo = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const stagingMigration = fs.readFileSync(path.join(root, 'scripts', 'migrate-staging.js'), 'utf8');
const windowsSetup = fs.readFileSync(path.join(root, 'scripts', 'setup-windows.js'), 'utf8');

assert(
  !packageInfo.devDependencies || !packageInfo.devDependencies['sequelize-cli'],
  'The obsolete Sequelize CLI must not return to the audited release dependency graph.'
);
assert.strictEqual(
  packageInfo.overrides && packageInfo.overrides.gaxios,
  '7.3.0',
  'The Google API client must remain pinned to the audited compatible gaxios release.'
);
assert(
  stagingMigration.includes("path.resolve(__dirname, 'db-lifecycle.js')"),
  'Staging migrations must use the audited NEXT database lifecycle engine.'
);
assert(
  !stagingMigration.includes('sequelize-cli'),
  'Staging migrations must not call the removed Sequelize CLI.'
);
assert(
  windowsSetup.includes("path.join(ROOT_DIR, 'scripts', 'db-lifecycle.js')"),
  'Windows source setup must use the audited NEXT database lifecycle engine.'
);

console.log('PASS audited dependency and migration-runner policy.');
