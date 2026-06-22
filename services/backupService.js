'use strict';

const cron    = require('node-cron');
const { spawn } = require('child_process');
const path    = require('path');
const fs      = require('fs');

// ---- Config ----
const BACKUP_DIR   = path.join(__dirname, '..', 'backups');
const MAX_BACKUPS  = parseInt(process.env.BACKUP_RETAIN || '10');   // keep last N
const BACKUP_LOG   = path.join(BACKUP_DIR, 'backup.log.json');
const SETTINGS_PATH = path.join(__dirname, '..', 'data', 'settings.json');
const PROJECT_ROOT  = path.join(__dirname, '..');

// Ensure backup dir exists
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

// ---- Log helpers ----
function readLog() {
    try { return JSON.parse(fs.readFileSync(BACKUP_LOG, 'utf8')); }
    catch { return []; }
}
function writeLog(entries) {
    fs.writeFileSync(BACKUP_LOG, JSON.stringify(entries, null, 2));
}
function appendLog(entry) {
    const entries = readLog();
    entries.unshift(entry);          // newest first
    if (entries.length > 100) entries.splice(100); // keep last 100 log entries
    writeLog(entries);
}

// ---- pg_dump runner ----
function runBackup(triggeredBy = 'Scheduled') {
    return new Promise((resolve) => {
        const ts       = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const filename = 'backup_' + ts + '.dump';
        const filepath = path.join(BACKUP_DIR, filename);

        const env = process.env;
        const args = [
            '-h', env.DB_HOST || '127.0.0.1',
            '-U', env.DB_USER || 'postgres',
            '-d', env.DB_NAME || 'patient_rx_dev',
            '-F', 'c',   // custom compressed format
            '-f', filepath
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

            // Prune old backups (keep last MAX_BACKUPS)
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

// ---- Pruner ----
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

// ---- Sync log with actual files on disk ----
// Removes log entries whose .dump files no longer exist
function syncLogWithDisk() {
    const entries = readLog();
    const synced  = entries.filter(e => {
        // Keep failed entries (no file), keep if file exists
        if (!e.filename) return true;
        return fs.existsSync(path.join(BACKUP_DIR, e.filename));
    });
    if (synced.length !== entries.length) writeLog(synced);
    return synced;
}

// ---- Delete a specific DB backup ----
function deleteBackup(filename) {
    // Validate: must look like a real backup filename (prevent path traversal)
    if (!filename || !/^backup_[\w\-]+\.dump$/.test(filename)) {
        throw new Error('Invalid backup filename');
    }
    const filepath = path.join(BACKUP_DIR, filename);
    // Delete file if it exists
    if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
    // Remove from log
    const entries = readLog();
    writeLog(entries.filter(e => e.filename !== filename));
}

// ---- Cron scheduler ----
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

// ---- Default schedule from env ----
const DEFAULT_SCHEDULE = process.env.BACKUP_SCHEDULE || '0 2 * * *'; // daily at 2am
startScheduler(DEFAULT_SCHEDULE);

// ════════════════════════════════════════════════════════════════════════
// FULL SITE BACKUP — ZIP of code + fresh DB dump, saved OUTSIDE project
// Directory is configurable via Settings > Backup Folders
// ════════════════════════════════════════════════════════════════════════
const MAX_SITE_BACKUPS = parseInt(process.env.SITE_BACKUP_RETAIN || '5');

// Dynamic site backup dir — reads from settings.json, falls back to env/default
function readSettings() {
    try { return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')); } catch { return {}; }
}
function getSiteBackupDir() {
    const s = readSettings();
    return s.siteBackupPath || process.env.SITE_BACKUP_DIR || 'C:\\RX-SiteBackups';
}
function setSiteBackupDir(newDir) {
    const s = readSettings();
    s.siteBackupPath = newDir;
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(s, null, 2), 'utf8');
    // Ensure directory exists
    if (!fs.existsSync(newDir)) {
        try { fs.mkdirSync(newDir, { recursive: true }); } catch (e) {
            console.error('[SiteBackup] Could not create dir:', newDir, e.message);
            throw e;
        }
    }
    console.log('[SiteBackup] Directory updated to:', newDir);
}

// Ensure current site backup dir exists on startup
(function() {
    const dir = getSiteBackupDir();
    if (!fs.existsSync(dir)) {
        try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {
            console.error('[SiteBackup] Could not create dir:', dir, e.message);
        }
    }
})();

function readSiteLog() {
    try { return JSON.parse(fs.readFileSync(path.join(getSiteBackupDir(), 'site-backup.log.json'), 'utf8')); } catch { return []; }
}
function appendSiteLog(entry) {
    const entries = readSiteLog();
    entries.unshift(entry);
    if (entries.length > 50) entries.splice(50);
    try { fs.writeFileSync(path.join(getSiteBackupDir(), 'site-backup.log.json'), JSON.stringify(entries, null, 2)); } catch {}
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

// ---- Sync site log with actual files on disk ----
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

// ---- Delete a specific site backup ----
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
        const ts       = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const zipName  = 'RX_SiteBackup_' + ts + '.zip';
        const zipPath  = path.join(getSiteBackupDir(), zipName);

        // Step 1 — fresh DB dump inside the site backup dir (temp)
        const dbDump   = path.join(getSiteBackupDir(), '_temp_db_' + ts + '.dump');
        const env      = process.env;
        const pgEnv    = Object.assign({}, process.env, { PGPASSWORD: env.DB_PASS || '' });
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

            // Step 2 — Write a temp .ps1 script and run it (avoids all escaping issues)
            const psFile = path.join(getSiteBackupDir(), '_sitebackup_' + ts + '.ps1');
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

            const ps = spawn('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', psFile], {
                env: process.env
            });

            let psOut = '';
            let psErrOut = '';
            ps.stdout.on('data', d => { psOut += d.toString(); });
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
                // Clean temp dump if not cleaned by PS
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
                console.log('[SiteBackup]', entry.status, success ? zipName + ' (' + Math.round(size/1024) + ' KB)' : entry.error);
                resolve(entry);
            });
        });
    });
}

// ---- Weekly site backup scheduler (Sundays at 3 AM) ----
let _siteBackupJob = null;
let _siteBackupSchedule = null;

function startSiteBackupScheduler(cronExpression) {
    if (_siteBackupJob) { _siteBackupJob.stop(); _siteBackupJob = null; }
    if (!cronExpression || cronExpression === 'off') {
        _siteBackupSchedule = 'off';
        return;
    }
    if (!cron.validate(cronExpression)) return;
    _siteBackupSchedule = cronExpression;
    _siteBackupJob = cron.schedule(cronExpression, () => {
        console.log('[SiteBackup] Running scheduled full site backup...');
        runFullSiteBackup('Scheduled (Weekly)');
    });
    console.log('[SiteBackup] Weekly scheduler started:', cronExpression);
}

const DEFAULT_SITE_SCHEDULE = process.env.SITE_BACKUP_SCHEDULE || '0 3 * * 0'; // Sundays at 3 AM
startSiteBackupScheduler(DEFAULT_SITE_SCHEDULE);

module.exports = {
    runBackup,
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
    // Full site backup exports
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

