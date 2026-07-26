/**
 * post-build.js
 * Runs after the EXE is compiled. Copies all files needed on the
 * production server into dist/ so it is a self-contained package.
 *
 * Files copied:
 *   .env.example        - environment template (copy to .env on the server)
 *   PROJECT-CONTROL.bat — production project/service control launcher
 *   project-control.json — project control configuration
 *   CHANGELOG.md        — version history / what changed
 *   Readme.txt          — release summary / verification notes
 *   DEFERRED-ITEMS.txt  — security / tech-debt tracking
 *   OPERATIONS_MANUAL.md — admin and recovery procedures
 *   NEW_SERVER_SETUP_RECOVERY.md — new server install and recovery runbook
 *   install-service.ps1 — Windows Service installer
 *   uninstall-service.ps1 — Windows Service remover
 */

'use strict';
const { execFileSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

const root    = path.join(__dirname, '..');
const distDir = path.join(root, 'dist');
const packageInfo = require(path.join(root, 'package.json'));

if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
}

const filesToCopy = [
    '.env.example',
    'PROJECT-CONTROL.bat',
    'INSTALL-PROJECT-CONTROL.bat',
    'INSTALL-NEW-SERVER.bat',
    path.join('scripts', 'project-control.ps1'),
    path.join('scripts', 'Invoke-ReleaseUpdate.ps1'),
    path.join('scripts', 'Invoke-TestCopyRestore.ps1'),
    path.join('scripts', 'Install-ProjectControl.ps1'),
    path.join('scripts', 'Install-NewServer.ps1'),
    'project-control.json',
    'package.json',
    'README.md',
    'CHANGELOG.md',
    'Readme.txt',
    'PRODUCTION_RELEASE_CHECKLIST.md',
    'DEFERRED-ITEMS.txt',
    'OPERATIONS_MANUAL.md',
    'NEW_SERVER_SETUP_RECOVERY.md',
    path.join('docs', 'PRODUCTION_MICROSIP_CHROME_POLICY.md'),
    path.join('docs', 'RX_SOFTPHONE_REMOTE_TESTING.md'),
    path.join('docs', 'KASM_RX_SOFTPHONE_REMOTE_DEPLOYMENT_GUIDE.md'),
    path.join('docs', 'database', 'STARTUP_MUTATION_INVENTORY.md'),
    path.join('docs', 'database', 'NEXT_DATABASE_OPERATIONS.md'),
    path.join('docs', 'database', 'SANITIZED_DUMP_REHEARSAL.md'),
    path.join('docs', 'database', 'CUTOVER_AND_ROLLBACK.md'),
    path.join('docs', 'database', 'COMPILED_RELEASE_UPDATES.md'),
    path.join('docs', 'database', 'TEST_COPY_RESTORE.md'),
    path.join('docs', 'database', 'REHEARSAL_RECORD_2026-07-21.md'),
    path.join('docs', 'database', 'PRODUCTION_DUMP_REHEARSAL_2026-07-21.md'),
    path.join('docs', 'database', 'RESTRICTED_RUNTIME_ROLE_EXPERIMENT.md'),
    path.join('docs', 'NEW_SERVER_PORTABLE_INSTALLER.md'),
    path.join('scripts', 'install-production-microsip-chrome-policy.ps1'),
    path.join('scripts', 'Invoke-NextProduction.ps1'),
    'install-service.ps1',
    'uninstall-service.ps1',
];

let copied = 0;
let skipped = 0;

for (const file of filesToCopy) {
    const src = path.join(root, file);
    const dst = path.join(distDir, file);
    if (fs.existsSync(src)) {
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.copyFileSync(src, dst);
        console.log('✓ ' + file + '  →  dist/' + file);
        copied++;
    } else {
        console.log('⚠ ' + file + '  (not found — skipped)');
        skipped++;
    }
}

const releaseNotesSource = path.join(root, '.github', 'releases', 'v' + packageInfo.version + '.md');
const releaseNotesTarget = 'RELEASE_NOTES-v' + packageInfo.version + '.md';
if (fs.existsSync(releaseNotesSource)) {
    fs.copyFileSync(releaseNotesSource, path.join(distDir, releaseNotesTarget));
    console.log('✓ ' + releaseNotesTarget + '  →  dist/' + releaseNotesTarget);
    copied++;
} else {
    console.log('⚠ ' + releaseNotesTarget + '  (not found — skipped)');
    skipped++;
}

console.log('');
console.log('dist/ is ready: ' + copied + ' file(s) copied' + (skipped ? ', ' + skipped + ' skipped' : '') + '.');
const updateFiles = ['server.exe', 'rx-db.exe', ...filesToCopy, releaseNotesTarget]
    .map(file => path.join(distDir, file))
    .filter(file => fs.existsSync(file));

const forbiddenPackageEntries = new Set(['.env', '.env.staging']);
for (const file of updateFiles) {
    const entryName = path.basename(file);
    if (forbiddenPackageEntries.has(entryName)) {
        throw new Error('Refusing to package secret environment file: ' + entryName);
    }
}

const updateZip = path.join(distDir, 'server-update-' + packageInfo.version + '.zip');
if (updateFiles.length > 0) {
    fs.rmSync(updateZip, { force: true });

    const expectedEntries = ['server.exe', 'rx-db.exe', ...filesToCopy, releaseNotesTarget]
        .filter(file => fs.existsSync(path.join(distDir, file)));
    const archiveEntryNames = expectedEntries.map(file => file.split(path.sep).join('/'));
    const psArray = updateFiles
        .map(file => "'" + file.replace(/'/g, "''") + "'")
        .join(',');
    const psExpected = expectedEntries
        .map(file => "'" + file.split(path.sep).join('/').replace(/'/g, "''") + "'")
        .join(',');
    const psEntryNames = archiveEntryNames
        .map(file => "'" + file.replace(/'/g, "''") + "'")
        .join(',');
    const psDestination = updateZip.replace(/'/g, "''");
    const command = [
        "$ErrorActionPreference = 'Stop'",
        "$files = @(" + psArray + ")",
        "$expected = @(" + psExpected + ")",
        "$entryNames = @(" + psEntryNames + ")",
        "$destination = '" + psDestination + "'",
        "Add-Type -AssemblyName System.IO.Compression",
        "Add-Type -AssemblyName System.IO.Compression.FileSystem",
        "for ($attempt = 1; $attempt -le 8; $attempt++) {",
        "  try {",
        "    if (Test-Path -LiteralPath $destination) { Remove-Item -LiteralPath $destination -Force }",
        "    $zip = [System.IO.Compression.ZipFile]::Open($destination, [System.IO.Compression.ZipArchiveMode]::Create)",
        "    try {",
        "      for ($i = 0; $i -lt $files.Count; $i++) {",
        "        $file = $files[$i]",
        "        $entryName = $entryNames[$i]",
        "        $entry = $zip.CreateEntry($entryName, [System.IO.Compression.CompressionLevel]::Optimal)",
        "        $entryStream = $entry.Open()",
        "        $fileStream = [System.IO.File]::Open($file, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)",
        "        try { $fileStream.CopyTo($entryStream) } finally { $fileStream.Dispose(); $entryStream.Dispose() }",
        "      }",
        "    } finally { $zip.Dispose() }",
        "    $zip = [System.IO.Compression.ZipFile]::OpenRead($destination)",
        "    try { $names = @($zip.Entries | ForEach-Object { $_.FullName }) } finally { $zip.Dispose() }",
        "    foreach ($entry in $expected) { if ($names -notcontains $entry) { throw \"Zip missing $entry\" } }",
        "    break",
        "  } catch {",
        "    if ($attempt -ge 8) { throw }",
        "    Start-Sleep -Milliseconds (500 * $attempt)",
        "  }",
        "}"
    ].join('; ');

    execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], {
        stdio: 'inherit'
    });
    const portableZip = path.join(distDir, 'RX-Tracker-NEXT-New-Server-' + packageInfo.version + '.zip');
    fs.copyFileSync(updateZip, portableZip);
    console.log('Created portable fresh-server installer: ' + portableZip);
    console.log('✓ server-update-' + packageInfo.version + '.zip  →  dist/server-update-' + packageInfo.version + '.zip');
}
console.log('Deploy dist\\server-update-' + packageInfo.version + '.zip or approved dist files only; keep production .env unchanged.');
