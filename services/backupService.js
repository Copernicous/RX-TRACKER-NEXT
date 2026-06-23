'use strict';

const cron      = require('node-cron');
const { spawn } = require('child_process');
const path      = require('path');
const fs        = require('fs');

// ── Writable root ─────────────────────────────────────────────────────────────
// When running as a pkg .exe, __dirname points inside the read-only snapshot.
// path.dirname(process.execPath) gives the real folder containing server.exe.
// In dev (plain node), process.execPath is the node binary so we fall back to __dirname/../.
const IS_PKG        = typeof process.pkg !== 'undefined';
const WRITABLE_ROOT = IS_PKG
    ? path.dirname(process.execPath)           // dir containing server.exe  e.g. C:\RX-Tracker\RX-APP
    : path.join(__dirname, '..');              // dev: project root

// ── Config ────────────────────────────────────────────────────────────────────
const BACKUP_DIR    = path.join(WRITABLE_ROOT, 'backups');
const MAX_BACKUPS   = parseInt(process.env.BACKUP_RETAIN || '10');
const BACKUP_LOG    = path.join(BACKUP_DIR, 'backup.log.json');
const SETTINGS_PATH = path.join(WRITABLE_ROOT, 'data', 'settings.json');
const PROJECT_ROOT  = IS_PKG ? path.dirname(process.execPath) : path.join(__dirname, '..');

// ── Lazy dir creation (never at module load time inside pkg snapshot) ─────────
function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        try { fs.mkdirSync(dir, { recursive: true }); }
        catch (e) { console.error('[Backup] Could not create dir:', dir, e.message); }
    }
}

// ── Log helpers ───────────────────────────────────────────────────────────────
function readLog() {
    try { return JSON.parse(fs.readFileSync(BACKUP_LOG, 'utf8')); }
    catch { return []; }
}
function writeLog(entries) {
    ensureDir(BACKUP_DIR);
    fs.writeFileSync(BACKUP_LOG, JSON.stringify(entries, null, 2));
}
function appendLog(entry) {
    const entries = readLog();
    entries.unshift(entry);
    if (entries.length > 100) entries.splice(100);
    writeLog(entries);
}

// ── pg_dump runner ────────────────────────────────────────────────────────────
function runBackup(triggeredBy = 'Scheduled') {
    return new Promise((resolve) => {
        ensureDir(BACKUP_DIR);

        const ts       = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const filename = 'backup_' + ts + '.dump';
        const filepath = path.join(BACKUP_DIR, filename);

        const env  = process.env;
        const args = [
            '-h', env.DB_HOST || '127.0.0.1',
            '-U', env.DB_USER || 'postgres',
            '-d', env.DB_NAME || 'patient_rx_dev',
            '-F', 'c', '-f', filepath
        ];

        const pgEnv = Object.assign({}, process.env, { PGPASSWORD: env.DB_PASS || '' });
        const child = spawn('pg_dump', args, { env: pgEnv });

        let stderr = '';
        child.stderr.on('data', d => { stderr += d.toString(); });

        child.on('close', code => {
            let size = 0;
            try { size = fs.statSync(filepath).size; } catch {}

            const entry = {
                id:          Date.now(),
                filename,
                timestamp:   new Date().toISOString(),
                triggeredBy,
                status:      code === 0 ? 'success' : 'failed',
                size,
                error:       code !== 0 ? stderr.trim() : null
            };

            appendLog(entry);
            pruneOldBackups();
            resolve(entry);
        });

        child.on('error', err => {
            const entry = {
                id:          Date.now(),
                filename:    null,
                timestamp:   new Date().toISOString(),
                triggeredBy,
                status:      'failed',
                size:        0,
                error:       'pg_dump not found or failed to start: ' + err.message
            };
            appendLog(entry);
            resolve(entry);
        });
    });
}

// ── Pruner ────────────────────────────────────────────────────────────────────
function pruneOldBackups() {
    try {
        const files = fs.readdirSync(BACKUP_DIR)
            .filter(f => f.startsWith('backup_') && f.endsWith('.dump'))
            .map(f => ({ name: f, mtime: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
            .sort((a, b) => b.mtime - a.mtime);
        files.slice(MAX_BACKUPS).forEach(f => {
            try { fs.unlinkSync(path.join(BACKUP_DIR, f.name)); } catch {}
        });
    } catch {}
}

// ── Sync log with actual files on disk ────────────────────────────────────────
function syncLogWithDisk() {
    const entries = readLog();
    const synced  = entries.filter(e => {
        if (!e.filename) return true;
        return fs.existsSync(path.join(BACKUP_DIR, e.filename));
    });
    if (synced.length !== entries.length) writeLog(synced);
    return synced;
}

// ── Delete a specific DB backup ───────────────────────────────────────────────
function deleteBackup(filename) {
    if (!filename || !/^backup_[\w\-]+\.dump$/.test(filename)) {
        throw new Error('Invalid backup filename');
    }
    const filepath = path.join(BACKUP_DIR, filename);
    if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
    const entries = readLog();
    writeLog(entries.filter(e => e.filename !== filename));
}

// ── Cron scheduler ────────────────────────────────────────────────────────────
let _cronJob = null;
let _currentSchedule = null;

function startScheduler(cronExpression) {
    if (_cronJob) { _cronJob.stop(); _cronJob = null; }
    if (!cronExpression || cronExpression === 'off') {
        _currentSchedule = 'off';
        console.log('[Backup] Scheduler disabled.');
        return;
    }
    if (!cron.validate(cronExpression)) {
        console.error('[Backup] Invalid cron expression:', cronExpression);
        return;
    }
    _currentSchedule = cronExpression;
    _cronJob = cron.schedule(cronExpression, () => {
        console.log('[Backup] Running scheduled backup...');
        runBackup('Scheduled').then(r => {
            console.log('[Backup] Scheduled backup', r.status, r.filename || r.error);
        });
    });
    console.log('[Backup] Scheduler started with expression:', cronExpression);
}

const DEFAULT_SCHEDULE = process.env.BACKUP_SCHEDULE || '0 2 * * *';
startScheduler(DEFAULT_SCHEDULE);

// ════════════════════════════════════════════════════════════════════════════
// FULL SITE BACKUP
// ════════════════════════════════════════════════════════════════════════════
const MAX_SITE_BACKUPS = parseInt(process.env.SITE_BACKUP_RETAIN || '5');

function readSettings() {
    try { return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')); } catch { return {}; }
}
function getSiteBackupDir() {
    const s = readSettings();
    return s.siteBackupPath || process.env.SITE_BACKUP_DIR || 'C:\\RX-SiteBackups';
}
function setSiteBackupDir(newDir) {
    ensureDir(path.dirname(SETTINGS_PATH));
    const s = readSettings();
    s.siteBackupPath = newDir;
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(s, null, 2), 'utf8');
    ensureDir(newDir);
    console.log('[SiteBackup] Directory updated to:', newDir);
}

function readSiteLog() {
    try { return JSON.parse(fs.readFileSync(path.join(getSiteBackupDir(), 'site-backup.log.json'), 'utf8')); }
    catch { return []; }
}
function appendSiteLog(entry) {
    const dir     = getSiteBackupDir();
    ensureDir(dir);
    const entries = readSiteLog();
    entries.unshift(entry);
    if (entries.length > 50) entries.splice(50);
    try { fs.writeFileSync(path.join(dir, 'site-backup.log.json'), JSON.stringify(entries, null, 2)); } catch {}
}
function pruneOldSiteBackups() {
    try {
        const files = fs.readdirSync(getSiteBackupDir())
            .filter(f => f.startsWith('RX_SiteBackup_') && f.endsWith('.zip'))
            .map(f => ({ name: f, mtime: fs.statSync(path.join(getSiteBackupDir(), f)).mtimeMs }))
            .sort((a, b) => b.mtime - a.mtime);
        files.slice(MAX_SITE_BACKUPS).forEach(f => {
            try { fs.unlinkSync(path.join(getSiteBackupDir(), f.name)); } catch {}
        });
    } catch {}
}
function syncSiteLogWithDisk() {
    const entries = readSiteLog();
    const synced  = entries.filter(e => {
        if (!e.filename) return true;
        return fs.existsSync(path.join(getSiteBackupDir(), e.filename));
    });
    if (synced.length !== entries.length) {
        try { fs.writeFileSync(path.join(getSiteBackupDir(), 'site-backup.log.json'), JSON.stringify(synced, null, 2)); } catch {}
    }
    return synced;
}
function deleteSiteBackup(filename) {
    if (!filename || !/^RX_SiteBackup_[\w\-]+\.zip$/.test(filename)) {
        throw new Error('Invalid site backup filename');
    }
    const filepath = path.join(getSiteBackupDir(), filename);
    if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
    const entries = readSiteLog();
    const synced  = entries.filter(e => e.filename !== filename);
    try { fs.writeFileSync(path.join(getSiteBackupDir(), 'site-backup.log.json'), JSON.stringify(synced, null, 2)); } catch {}
}

function runFullSiteBackup(triggeredBy = 'Manual') {
    return new Promise((resolve) => {
        const siteDir  = getSiteBackupDir();
        ensureDir(siteDir);

        const ts       = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const zipName  = 'RX_SiteBackup_' + ts + '.zip';
        const zipPath  = path.join(siteDir, zipName);
        const dbDump   = path.join(siteDir, '_temp_db_' + ts + '.dump');

        const env    = process.env;
        const pgEnv  = Object.assign({}, process.env, { PGPASSWORD: env.DB_PASS || '' });
        const dumpArgs = [
            '-h', env.DB_HOST || '127.0.0.1',
            '-U', env.DB_USER || 'postgres',
            '-d', env.DB_NAME || 'patient_rx_dev',
            '-F', 'c', '-f', dbDump
        ];

        console.log('[SiteBackup] Starting full site backup:', zipName);
        const pg = spawn('pg_dump', dumpArgs, { env: pgEnv });
        let pgErr = '';
        pg.stderr.on('data', d => { pgErr += d.toString(); });

        pg.on('error', err => {
            const entry = { id: Date.now(), filename: null, timestamp: new Date().toISOString(),
                triggeredBy, status: 'failed', size: 0, error: 'pg_dump error: ' + err.message };
            appendSiteLog(entry);
            resolve(entry);
        });

        pg.on('close', code => {
            if (code !== 0) {
                const entry = { id: Date.now(), filename: null, timestamp: new Date().toISOString(),
                    triggeredBy, status: 'failed', size: 0, error: 'pg_dump failed: ' + pgErr.trim() };
                appendSiteLog(entry);
                resolve(entry);
                return;
            }

            const psFile    = path.join(siteDir, '_sitebackup_' + ts + '.ps1');
            const srcEsc    = PROJECT_ROOT.replace(/\\/g, '\\\\');
            const destEsc   = zipPath.replace(/\\/g, '\\\\');
            const dumpEsc   = dbDump.replace(/\\/g, '\\\\');

            const psContent = [
                'Add-Type -Assembly System.IO.Compression.FileSystem',
                '$src    = "' + srcEsc + '"',
                '$dest   = "' + destEsc + '"',
                '$dbDump = "' + dumpEsc + '"',
                '$exclude = @("node_modules", ".git", "logs")',
                '',
                '$files = Get-ChildItem -Path $src -Recurse -File | Where-Object {',
                '    $rel   = $_.FullName.Substring($src.Length + 1)',
                '    $parts = $rel -split "[\\\\/]"',
                '    $skip  = $false',
                '    foreach ($ex in $exclude) { if ($parts -contains $ex) { $skip = $true; break } }',
                '    -not $skip',
                '}',
                '',
                'if (Test-Path $dest) { Remove-Item $dest -Force }',
                '$zip = [System.IO.Compression.ZipFile]::Open($dest, "Create")',
                'foreach ($f in $files) {',
                '    $entry = $f.FullName.Substring($src.Length + 1)',
                '    try {',
                '        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $f.FullName, $entry) | Out-Null',
                '    } catch {}',
                '}',
                '# Include DB dump inside the ZIP',
                'try {',
                '    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $dbDump, "db_backup.dump") | Out-Null',
                '} catch {}',
                '$zip.Dispose()',
                'Remove-Item $dbDump -Force -ErrorAction SilentlyContinue',
                'Write-Host "DONE"'
            ].join('\r\n');

            try { fs.writeFileSync(psFile, psContent, 'utf8'); } catch (e) {
                try { fs.unlinkSync(dbDump); } catch {}
                const entry = { id: Date.now(), filename: null, timestamp: new Date().toISOString(),
                    triggeredBy, status: 'failed', size: 0, error: 'Could not write PS script: ' + e.message };
                appendSiteLog(entry);
                resolve(entry);
                return;
            }

            const ps = spawn('powershell',
                ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', psFile],
                { env: process.env });

            let psOut = '', psErrOut = '';
            ps.stdout.on('data', d => { psOut    += d.toString(); });
            ps.stderr.on('data', d => { psErrOut += d.toString(); });

            ps.on('error', err => {
                try { fs.unlinkSync(dbDump); } catch {}
                const entry = { id: Date.now(), filename: null, timestamp: new Date().toISOString(),
                    triggeredBy, status: 'failed', size: 0, error: 'PowerShell error: ' + err.message };
                appendSiteLog(entry);
                resolve(entry);
            });

            ps.on('close', psCode => {
                let size = 0;
                try { size = fs.statSync(zipPath).size; } catch {}
                try { if (fs.existsSync(dbDump)) fs.unlinkSync(dbDump); } catch {}

                const success = psCode === 0 && psOut.includes('DONE') && size > 0;
                const entry = {
                    id:          Date.now(),
                    filename:    success ? zipName : null,
                    filepath:    success ? zipPath : null,
                    timestamp:   new Date().toISOString(),
                    triggeredBy,
                    status:      success ? 'success' : 'failed',
                    size,
                    error:       !success ? (psErrOut.trim() || 'Unknown error') : null
                };
                appendSiteLog(entry);
                if (success) pruneOldSiteBackups();
                console.log('[SiteBackup]', entry.status,
                    success ? zipName + ' (' + Math.round(size / 1024) + ' KB)' : entry.error);
                resolve(entry);
            });
        });
    });
}

// ── Weekly site backup scheduler ──────────────────────────────────────────────
let _siteBackupJob = null;
let _siteBackupSchedule = null;

function startSiteBackupScheduler(cronExpression) {
    if (_siteBackupJob) { _siteBackupJob.stop(); _siteBackupJob = null; }
    if (!cronExpression || cronExpression === 'off') { _siteBackupSchedule = 'off'; return; }
    if (!cron.validate(cronExpression)) return;
    _siteBackupSchedule = cronExpression;
    _siteBackupJob = cron.schedule(cronExpression, () => {
        console.log('[SiteBackup] Running scheduled full site backup...');
        runFullSiteBackup('Scheduled (Weekly)');
    });
    console.log('[SiteBackup] Weekly scheduler started:', cronExpression);
}

const DEFAULT_SITE_SCHEDULE = process.env.SITE_BACKUP_SCHEDULE || '0 3 * * 0';
startSiteBackupScheduler(DEFAULT_SITE_SCHEDULE);

// ── Restore from a .dump file ─────────────────────────────────────────────────
// 1. Auto-safety-backup current DB first
// 2. Run pg_restore --clean --if-exists -d DB_NAME -F c dumpFilePath
// Returns { status:'success'|'failed', log, error }
function restoreBackup(dumpFilePath, triggeredBy) {
    triggeredBy = triggeredBy || 'Manual restore';
    return new Promise(function(resolve) {
        ensureDir(BACKUP_DIR);
        var env    = process.env;
        var pgEnv  = Object.assign({}, process.env, { PGPASSWORD: env.DB_PASS || '' });
        var dbName = env.DB_NAME || 'patient_rx_dev';

        // Step 1: safety backup of current state
        runBackup('Pre-restore auto-safety-backup').then(function() {

            // Step 2: pg_restore
            var args = [
                '--clean', '--if-exists',
                '-h', env.DB_HOST || '127.0.0.1',
                '-p', env.DB_PORT  || '5432',
                '-U', env.DB_USER  || 'postgres',
                '-d', dbName,
                '-F', 'c',
                dumpFilePath
            ];

            var child = require('child_process').spawn('pg_restore', args, { env: pgEnv });
            var log = '', errLog = '';
            child.stdout.on('data', function(d) { log    += d.toString(); });
            child.stderr.on('data', function(d) { errLog += d.toString(); });

            child.on('error', function(err) {
                resolve({ status: 'failed', log: '', error: 'pg_restore not found: ' + err.message });
            });

            child.on('close', function(code) {
                var success = code === 0;
                var entry = {
                    id:          Date.now(),
                    filename:    null,
                    timestamp:   new Date().toISOString(),
                    triggeredBy: triggeredBy,
                    status:      success ? 'success' : 'failed',
                    size:        0,
                    error:       success ? null : (errLog.trim() || ('Exit code ' + code))
                };
                appendLog(entry);
                resolve({
                    status: success ? 'success' : 'failed',
                    log:    log + (errLog ? '\n[stderr]\n' + errLog : ''),
                    error:  success ? null : (errLog.trim() || ('Exit code ' + code))
                });
            });
        });
    });
}

module.exports = {
    runBackup,
    restoreBackup,
    readLog,
    deleteBackup,
    startScheduler,
    getDbBackupDir: () => BACKUP_DIR,
    getStatus: () => ({
        schedule:      _currentSchedule || DEFAULT_SCHEDULE,
        backupDir:     BACKUP_DIR,
        maxBackups:    MAX_BACKUPS,
        recentBackups: syncLogWithDisk().slice(0, 20)
    }),
    runFullSiteBackup,
    readSiteLog,
    deleteSiteBackup,
    setSiteBackupDir,
    getSiteBackupDir,
    startSiteBackupScheduler,
    getSiteBackupStatus: () => ({
        schedule:      _siteBackupSchedule || DEFAULT_SITE_SCHEDULE,
        backupDir:     getSiteBackupDir(),
        maxBackups:    MAX_SITE_BACKUPS,
        recentBackups: syncSiteLogWithDisk().slice(0, 10)
    })
};
