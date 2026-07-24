'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const installerPath = path.join(root, 'scripts', 'Install-NewServer.ps1');
const launcherPath = path.join(root, 'INSTALL-NEW-SERVER.bat');
const documentationPath = path.join(root, 'docs', 'NEW_SERVER_PORTABLE_INSTALLER.md');
const postBuildPath = path.join(root, 'scripts', 'post-build.js');

const installer = fs.readFileSync(installerPath, 'utf8');
const launcher = fs.readFileSync(launcherPath, 'utf8');
const documentation = fs.readFileSync(documentationPath, 'utf8');
const postBuild = fs.readFileSync(postBuildPath, 'utf8');

assert(installer.includes("'ValidatePackage'"), 'Installer must expose a non-mutating package validation action.');
assert(installer.includes("foreach ($forbidden in @('.env', '.env.staging'))"), 'Installer must reject reusable environment secret files.');
assert(installer.includes('Database $DatabaseName already exists'), 'Installer must refuse to touch an existing database.');
assert(installer.includes("[string]$DatabaseName = 'patient_rx_next'"), 'Interactive fresh-server installs must use the NEXT production database name by default.');
assert(installer.includes('Windows service $ServiceName already exists'), 'Installer must refuse to replace an existing Windows service.');
assert(installer.includes("'configure-runtime-role'"), 'Installer must create a restricted runtime database role.');
assert(installer.includes("'verify-runtime-role'"), 'Installer must verify the restricted runtime role.');
assert(installer.includes('SOFTPHONE_CREDENTIAL_KEY=$(New-RandomHex 48)'), 'Installer must generate a unique SIP credential encryption key.');
assert(installer.includes('SOFTPHONE_RELAY_SECRET=$(New-RandomHex 48)'), 'Installer must generate a unique relay secret.');
assert(installer.includes('JWT_SECRET=$(New-RandomHex 48)'), 'Installer must generate a unique session secret.');
assert(installer.includes('Protect-EnvironmentFile $EnvPath'), 'Installer must restrict access to the generated environment file.');
assert(installer.includes("if ($NoService)"), 'Installer must distinguish disposable no-service validation from a secured service installation.');
assert(installer.includes('Clear-ProcessDatabaseEnvironment'), 'Installer must verify the generated .env without inherited database overrides.');
assert(installer.includes('Wait-ForHealth $version'), 'Installer must require a healthy exact-version response.');
assert(installer.includes('new-server-installation.json'), 'Installer must write a non-secret installation receipt.');
assert(installer.includes('Administrator password must be at least 12 characters.'), 'Installer must enforce the database bootstrap password policy.');
assert(!installer.includes("return 'admin123'"), 'Installer must not inject a public default administrator password.');
assert(!installer.includes('exit 0') && !installer.includes('exit 1'), 'Installer must remain composable for end-to-end validation and automation.');
assert(!installer.includes('Remove-Item -LiteralPath $Destination -Recurse'), 'Installer must not recursively delete the destination.');
assert(!installer.includes('DB_PASS=your_db_password_here'), 'Installer must not contain a reusable database password.');

assert(launcher.includes('RunAs'), 'Launcher must request Windows Administrator elevation.');
assert(launcher.includes('scripts\\Install-NewServer.ps1'), 'Launcher must invoke the portable PowerShell installer.');

assert(documentation.includes('does **not** contain `.env`'), 'Documentation must explain that the portable ZIP carries no reusable .env.');
assert(documentation.includes('creates the real `.env`'), 'Documentation must explain generated .env behavior.');
assert(documentation.includes('option 8, then option 15'), 'Documentation must define the post-install update path.');

assert(postBuild.includes("'INSTALL-NEW-SERVER.bat'"), 'Release packaging must include the new-server launcher.');
assert(postBuild.includes("path.join('scripts', 'Install-NewServer.ps1')"), 'Release packaging must include the PowerShell installer.');
assert(postBuild.includes("path.join('docs', 'NEW_SERVER_PORTABLE_INSTALLER.md')"), 'Release packaging must include the installer guide.');
assert(postBuild.includes("'RX-Tracker-NEXT-New-Server-' + packageInfo.version + '.zip'"), 'Release build must create a named portable new-server ZIP.');

console.log('PASS portable new-server installer safety, secret generation, restricted runtime role, health gate, documentation, and packaging regression.');
