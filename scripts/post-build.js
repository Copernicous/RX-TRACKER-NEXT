/**
 * post-build.js
 * Runs after the EXE is compiled. Copies all files needed on the
 * production server into dist/ so it is a self-contained package.
 *
 * Files copied:
 *   .env                — environment config (required to run)
 *   RX-Manager.bat      — production management menu
 *   CHANGELOG.md        — version history / what changed
 *   DEFERRED-ITEMS.txt  — security / tech-debt tracking
 *   OPERATIONS_MANUAL.md — admin and recovery procedures
 *   install-service.ps1 — Windows Service installer
 *   uninstall-service.ps1 — Windows Service remover
 */

'use strict';
const fs   = require('fs');
const path = require('path');

const root    = path.join(__dirname, '..');
const distDir = path.join(root, 'dist');

if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
}

const filesToCopy = [
    '.env',
    'RX-Manager.bat',
    'CHANGELOG.md',
    'DEFERRED-ITEMS.txt',
    'OPERATIONS_MANUAL.md',
    'install-service.ps1',
    'uninstall-service.ps1',
];

let copied = 0;
let skipped = 0;

for (const file of filesToCopy) {
    const src = path.join(root, file);
    const dst = path.join(distDir, file);
    if (fs.existsSync(src)) {
        fs.copyFileSync(src, dst);
        console.log('✓ ' + file + '  →  dist/' + file);
        copied++;
    } else {
        console.log('⚠ ' + file + '  (not found — skipped)');
        skipped++;
    }
}

console.log('');
console.log('dist/ is ready: ' + copied + ' file(s) copied' + (skipped ? ', ' + skipped + ' skipped' : '') + '.');
console.log('Deploy the entire dist\\ folder to the production server.');
