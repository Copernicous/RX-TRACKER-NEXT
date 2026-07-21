'use strict';

const cron      = require('node-cron');
const { spawn, spawnSync } = require('child_process');
const path      = require('path');
const fs        = require('fs');
const { getAppRoot, getWritableRoot } = require('../utils/runtimePaths');
const securityAlertService = require('./securityAlertService');

// ── Writable root ─────────────────────────────────────────────────────────────
// Defaults to the app/exe folder. Staging/test copies can set APP_WRITABLE_ROOT
// so backups, settings, logs, and local uploads never mix with production data.
const WRITABLE_ROOT = getWritableRoot();

// ── Config ────────────────────────────────────────────────────────────────────
const DEFAULT_BACKUP_DIR = path.join(WRITABLE_ROOT, 'backups');
const MAX_BACKUPS        = parseInt(process.env.BACKUP_RETAIN || '10');
const SETTINGS_PATH      = path.join(WRITABLE_ROOT, 'data', 'settings.json');
const PROJECT_ROOT       = getAppRoot();

// readSettings is used here before its definition below — forward-declare it
// so getDbBackupDir() is available to log helpers without a circular reference.
// Full definition is at line ~275 (beside getSiteBackupDir).
function _readSettingsEarly() {
    try { return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')); } catch { return {}; }
}

// ── DB backup dir (configurable, persisted to settings.json) ──────────────────
function getDbBackupDir() {
    const s = _readSettingsEarly();
    return s.dbBackupPath || DEFAULT_BACKUP_DIR;
}
function setDbBackupDir(newDir) {
    ensureDir(path.dirname(SETTINGS_PATH));
    const s = _readSettingsEarly();
    s.dbBackupPath = newDir;
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(s, null, 2), 'utf8');
    ensureDir(newDir);
    console.log('[Backup] DB backup directory updated to:', newDir);
}

// ── PostgreSQL tool locator ───────────────────────────────────────────────────
// Finds pg_dump / pg_restore even when PostgreSQL bin is not in PATH.
// Search order:
//   1. PGBIN env var  (set explicitly by user)
//   2. PATH  (works on dev machines where psql is in PATH)
//   3. Common Windows PostgreSQL install directories (newest version first)
var _pgToolCache = Object.create(null);
function sqlIdentifier(value) { return '"' + String(value).replace(/"/g, '""') + '"'; }
function sqlStringLiteral(value) { return "'" + String(value).replace(/'/g, "''") + "'"; }

function findPgTool(toolName) {
    var lookupCmd = process.platform === 'win32' ? 'where' : 'which';

    // Return cached tool result
    if (_pgToolCache[toolName]) return _pgToolCache[toolName];

    // 1. Explicit env var
    if (process.env.PGBIN) {
        var explicit = process.platform === 'win32'
            ? path.join(process.env.PGBIN, toolName + '.exe')
            : path.join(process.env.PGBIN, toolName);
        if (fs.existsSync(explicit)) { _pgToolCache[toolName] = explicit; return explicit; }
    }

    // 2. Try PATH (lookup on current platform)
    try {
        var found = spawnSync(lookupCmd, [toolName], { encoding: 'utf8', timeout: 3000 });
        if (found.status === 0 && found.stdout) {
            var first = String(found.stdout || '').trim().split(/\r?\n/)[0];
            if (fs.existsSync(first)) {
                _pgToolCache[toolName] = first;
                console.log('[Backup] Found PostgreSQL tool via PATH:', first);
                return first;
            }
        }
    } catch {}

    // 3. Scan common Windows install paths (Program Files, versions 10-20)
    var bases = [
        process.env['ProgramFiles'],
        process.env['ProgramFiles(x86)'],
        'C:\\Program Files',
        'C:\\Program Files (x86)',
        'C:\\PostgreSQL',
        'C:\\pgsql'
    ].filter(Boolean);

    var candidates = [];
    bases.forEach(function(base) {
        var pgDir = path.join(base, 'PostgreSQL');
        if (!fs.existsSync(pgDir)) return;
        try {
            fs.readdirSync(pgDir).forEach(function(ver) {
                var exe = process.platform === 'win32'
                    ? path.join(pgDir, ver, 'bin', toolName + '.exe')
                    : path.join(pgDir, ver, 'bin', toolName);
                if (fs.existsSync(exe)) candidates.push({ ver: parseFloat(ver) || 0, exe });
            });
        } catch {}
    });

    if (candidates.length) {
        // Pick highest version
        candidates.sort(function(a, b) { return b.ver - a.ver; });
        _pgToolCache[toolName] = candidates[0].exe;
        console.log('[Backup] Found PostgreSQL tool at:', _pgToolCache[toolName]);
        return candidates[0].exe;
    }

    // Fallback — return bare name/path and let the OS decide
    console.warn('[Backup] pg tool not found — tried PATH and common dirs. Set PGBIN in .env');
    return toolName;
}
function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        try { fs.mkdirSync(dir, { recursive: true }); }
        catch (e) { console.error('[Backup] Could not create dir:', dir, e.message); }
    }
}

// ── Log helpers ───────────────────────────────────────────────────────────────
function readLog() {
    try { return JSON.parse(fs.readFileSync(path.join(getDbBackupDir(), 'backup.log.json'), 'utf8')); }
    catch { return []; }
}
function writeLog(entries) {
    const dir = getDbBackupDir();
    ensureDir(dir);
    fs.writeFileSync(path.join(dir, 'backup.log.json'), JSON.stringify(entries, null, 2));
}
function appendLog(entry) {
    const entries = readLog();
    entries.unshift(entry);
    if (entries.length > 100) entries.splice(100);
    writeLog(entries);
    if (entry && entry.status === 'failed') {
        securityAlertService.recordBackupFailure({ kind: 'database', entry }).catch(() => {});
    }
}

// ── pg_dump runner ────────────────────────────────────────────────────────────
function runBackup(triggeredBy = 'Scheduled') {
    return new Promise((resolve) => {
        const dir      = getDbBackupDir();
        ensureDir(dir);

        const ts       = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const filename = 'backup_' + ts + '.dump';
        const filepath = path.join(dir, filename);

        const env  = process.env;
        const args = [
            '-h', env.DB_HOST || '127.0.0.1',
            '-p', env.DB_PORT || '5432',
            '-U', env.DB_USER || 'postgres',
            '-d', env.DB_NAME || 'patient_rx_dev',
            '-F', 'c', '-f', filepath
        ];

        const pgEnv = Object.assign({}, process.env, { PGPASSWORD: env.DB_PASS || '' });
        const child = spawn(findPgTool('pg_dump'), args, { env: pgEnv });

        let stderr = '';
        child.stderr.on('data', d => { stderr += d.toString(); });

        child.on('close', code => {
            let size = 0;
            try { size = fs.statSync(filepath).size; } catch {}

            const entry = {
                id:          Date.now(),
                filename,
                filepath:    code === 0 ? filepath : null,
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
        const dir = getDbBackupDir();
        const files = fs.readdirSync(dir)
            .filter(f => f.startsWith('backup_') && f.endsWith('.dump'))
            .map(f => ({ name: f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
            .sort((a, b) => b.mtime - a.mtime);
        files.slice(MAX_BACKUPS).forEach(f => {
            try { fs.unlinkSync(path.join(dir, f.name)); } catch {}
        });
    } catch {}
}

// ── Sync log with actual files on disk ────────────────────────────────────────
function syncLogWithDisk() {
    const dir     = getDbBackupDir();
    const entries = readLog();
    const synced  = entries.filter(e => {
        if (!e.filename) return true;
        return fs.existsSync(path.join(dir, e.filename));
    });
    if (synced.length !== entries.length) writeLog(synced);
    return synced;
}

// ── Delete a specific DB backup ───────────────────────────────────────────────
function deleteBackup(filename) {
    if (!filename || !/^backup_[\w\-]+\.dump$/.test(filename)) {
        throw new Error('Invalid backup filename');
    }
    const filepath = path.join(getDbBackupDir(), filename);
    if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
    const entries = readLog();
    writeLog(entries.filter(e => e.filename !== filename));
}

// ── Delete a history entry by ID (for failed entries with no file) ────────────
function deleteBackupHistoryEntry(id) {
    const entries = readLog();
    const filtered = entries.filter(e => String(e.id) !== String(id));
    if (filtered.length === entries.length) throw new Error('Entry not found: ' + id);
    writeLog(filtered);
}

// ── Delete a site backup history entry by ID ──────────────────────────────────
function deleteBackupSiteHistoryEntry(id) {
    const entries = readSiteLog();
    const filtered = entries.filter(e => String(e.id) !== String(id));
    if (filtered.length === entries.length) throw new Error('Site entry not found: ' + id);
    const logPath = path.join(getSiteBackupDir(), 'site-backup.log.json');
    try { fs.writeFileSync(logPath, JSON.stringify(filtered, null, 2)); } catch {}
}

// ── Cron scheduler ────────────────────────────────────────────────────────────
let _cronJob = null;
let _currentSchedule = null;

// BUG-27: returns { ok, error } so API route can detect rejection.
// BUG-28: persists accepted schedule to settings.json for restart survival.
function startScheduler(cronExpression, options = {}) {
    const persist = options.persist !== false;
    if (_cronJob) { _cronJob.stop(); _cronJob = null; }
    if (!cronExpression || cronExpression === 'off') {
        _currentSchedule = 'off';
        // Persist disabled state
        if (persist) {
            try {
                ensureDir(path.dirname(SETTINGS_PATH));
                const s = readSettings();
                s.backupSchedule = 'off';
                fs.writeFileSync(SETTINGS_PATH, JSON.stringify(s, null, 2), 'utf8');
            } catch {}
        }
        console.log('[Backup] Scheduler disabled.');
        return { ok: true, schedule: 'off' };
    }
    if (!cron.validate(cronExpression)) {
        console.error('[Backup] Invalid cron expression:', cronExpression);
        return { ok: false, error: 'Invalid cron expression: ' + cronExpression };
    }
    _currentSchedule = cronExpression;
    _cronJob = cron.schedule(cronExpression, () => {
        console.log('[Backup] Running scheduled backup...');
        runBackup('Scheduled').then(r => {
            console.log('[Backup] Scheduled backup', r.status, r.filename || r.error);
        });
    });
    // Persist accepted schedule
    if (persist) {
        try {
            ensureDir(path.dirname(SETTINGS_PATH));
            const s = readSettings();
            s.backupSchedule = cronExpression;
            fs.writeFileSync(SETTINGS_PATH, JSON.stringify(s, null, 2), 'utf8');
        } catch {}
    }
    console.log('[Backup] Scheduler started with expression:', cronExpression);
    return { ok: true, schedule: cronExpression };
}

const DEFAULT_SCHEDULE = process.env.BACKUP_SCHEDULE || '0 2 * * *';
// BUG-28: read persisted schedule from settings.json before falling back to .env
const _persistedSchedule = (() => { try { return readSettings().backupSchedule; } catch { return null; } })();
startScheduler(_persistedSchedule || DEFAULT_SCHEDULE, { persist: false });

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
    if (entry && entry.status === 'failed') {
        securityAlertService.recordBackupFailure({ kind: 'site', entry }).catch(() => {});
    }
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
        const pg = spawn(findPgTool('pg_dump'), dumpArgs, { env: pgEnv });
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

            const psFile = path.join(siteDir, '_sitebackup_' + ts + '.ps1');
            const psPayload = JSON.stringify({
                sourceRoot: PROJECT_ROOT,
                destinationZip: zipPath,
                databaseDump: dbDump,
                excludes: ['node_modules', '.git', 'logs']
            });
            const psContent = [
                'param([string]$payload)',
                '$payloadObj = $null',
                'try {',
                '    $payloadObj = $payload | ConvertFrom-Json',
                '} catch {',
                '    Write-Error "Invalid site backup payload: $($_.Exception.Message)"',
                '    exit 1',
                '}',
                '$src            = $payloadObj.sourceRoot',
                '$dest           = $payloadObj.destinationZip',
                '$dbDump         = $payloadObj.databaseDump',
                '$excludeTargets = $payloadObj.excludes',
                'if (-not $src -or -not $dest -or -not $dbDump) {',
                '    Write-Error "Missing one or more required payload values."',
                '    exit 1',
                '}',
                'if (-not (Test-Path $src)) {',
                '    Write-Error "Source path not found: $src"',
                '    exit 1',
                '}',
                'Add-Type -Assembly System.IO.Compression.FileSystem',
                'if (Test-Path $dest) { Remove-Item $dest -Force }',
                '$zip = [System.IO.Compression.ZipFile]::Open($dest, "Create")',
                'try {',
                '    $files = Get-ChildItem -Path $src -Recurse -File -ErrorAction SilentlyContinue',
                '    foreach ($f in $files) {',
                '        $rel   = $f.FullName.Substring($src.Length + 1)',
                '        $parts = $rel -split "[\\\\/]"',
                '        $skip  = $false',
                '        foreach ($ex in $excludeTargets) {',
                '            if ($parts -contains $ex) {',
                '                $skip = $true',
                '                break',
                '            }',
                '        }',
                '        if (-not $skip) {',
                '            $entry = $f.FullName.Substring($src.Length + 1)',
                '            try {',
                '                [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $f.FullName, $entry) | Out-Null',
                '            } catch {}',
                '        }',
                '    }',
                '',
                '    # Include DB dump inside the ZIP',
                '    try {',
                '        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $dbDump, "db_backup.dump") | Out-Null',
                '    } catch {}',
                '    Write-Host "DONE"',
                '} catch {',
                '    Write-Error $_.Exception.Message',
                '    exit 1',
                '} finally {',
                '    $zip.Dispose()',
                '}'
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
                ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', psFile, '-Payload', psPayload],
                { env: process.env });

            let psOut = '', psErrOut = '';
            ps.stdout.on('data', d => { psOut    += d.toString(); });
            ps.stderr.on('data', d => { psErrOut += d.toString(); });

            ps.on('error', err => {
                try { fs.unlinkSync(dbDump); } catch {}
                try { fs.unlinkSync(psFile); } catch {}
                const entry = { id: Date.now(), filename: null, timestamp: new Date().toISOString(),
                    triggeredBy, status: 'failed', size: 0, error: 'PowerShell error: ' + err.message };
                appendSiteLog(entry);
                resolve(entry);
            });

            ps.on('close', psCode => {
                let size = 0;
                try { size = fs.statSync(zipPath).size; } catch {}
                try { if (fs.existsSync(dbDump)) fs.unlinkSync(dbDump); } catch {}
                try { fs.unlinkSync(psFile); } catch {}

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

// BUG-27: returns { ok, error }. BUG-28: persists accepted schedule to settings.json.
function startSiteBackupScheduler(cronExpression, options = {}) {
    const persist = options.persist !== false;
    if (_siteBackupJob) { _siteBackupJob.stop(); _siteBackupJob = null; }
    if (!cronExpression || cronExpression === 'off') {
        _siteBackupSchedule = 'off';
        if (persist) {
            try {
                ensureDir(path.dirname(SETTINGS_PATH));
                const s = readSettings();
                s.siteBackupSchedule = 'off';
                fs.writeFileSync(SETTINGS_PATH, JSON.stringify(s, null, 2), 'utf8');
            } catch {}
        }
        return { ok: true, schedule: 'off' };
    }
    if (!cron.validate(cronExpression)) {
        return { ok: false, error: 'Invalid cron expression: ' + cronExpression };
    }
    _siteBackupSchedule = cronExpression;
    _siteBackupJob = cron.schedule(cronExpression, () => {
        console.log('[SiteBackup] Running scheduled full site backup...');
        runFullSiteBackup('Scheduled (Weekly)');
    });
    if (persist) {
        try {
            ensureDir(path.dirname(SETTINGS_PATH));
            const s = readSettings();
            s.siteBackupSchedule = cronExpression;
            fs.writeFileSync(SETTINGS_PATH, JSON.stringify(s, null, 2), 'utf8');
        } catch {}
    }
    console.log('[SiteBackup] Weekly scheduler started:', cronExpression);
    return { ok: true, schedule: cronExpression };
}

const DEFAULT_SITE_SCHEDULE = process.env.SITE_BACKUP_SCHEDULE || '0 3 * * 0';
// BUG-28: read persisted site schedule from settings.json before falling back to .env
const _persistedSiteSchedule = (() => { try { return readSettings().siteBackupSchedule; } catch { return null; } })();
startSiteBackupScheduler(_persistedSiteSchedule || DEFAULT_SITE_SCHEDULE, { persist: false });

function isBackupScheduleEnabled(schedule) {
    return !!schedule && schedule !== 'off';
}

function latestSuccessfulBackup(entries) {
    return (entries || [])
        .filter(entry => entry && entry.status === 'success' && entry.timestamp)
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0] || null;
}

function maybeAlertMissingBackup(kind, schedule, entries, expectedWindowHours) {
    if (!isBackupScheduleEnabled(schedule)) return;
    const latest = latestSuccessfulBackup(entries);
    const now = Date.now();
    const latestTime = latest ? new Date(latest.timestamp).getTime() : 0;
    const missing = !latest || !Number.isFinite(latestTime) || (now - latestTime) > expectedWindowHours * 60 * 60 * 1000;
    if (!missing) return;
    securityAlertService.recordBackupMissing({
        kind,
        schedule,
        lastSuccessAt: latest ? latest.timestamp : null,
        expectedWindowHours
    }).catch(() => {});
}

function checkMissingBackups() {
    try {
        maybeAlertMissingBackup('database', _currentSchedule || DEFAULT_SCHEDULE, syncLogWithDisk(), 26);
    } catch {}
    try {
        maybeAlertMissingBackup('site', _siteBackupSchedule || DEFAULT_SITE_SCHEDULE, syncSiteLogWithDisk(), 8 * 24);
    } catch {}
}

if (process.env.SECURITY_ALERT_BACKUP_MONITOR !== 'false') {
    const firstCheck = setTimeout(checkMissingBackups, 5 * 60 * 1000);
    const interval = setInterval(checkMissingBackups, 60 * 60 * 1000);
    if (firstCheck.unref) firstCheck.unref();
    if (interval.unref) interval.unref();
}

// ── Restore from a .dump file ─────────────────────────────────────────────────
// Strategy: DROP the target DB entirely, recreate it empty, then pg_restore.
// This avoids all FK cascade errors from --clean trying to drop tables in wrong order.
// Steps:
//   1. Auto-safety-backup current DB
//   2. Connect to 'postgres' default DB → DROP DATABASE → CREATE DATABASE
//   3. pg_restore into the fresh empty database (no --clean needed)
function restoreBackup(dumpFilePath, triggeredBy) {
    triggeredBy = triggeredBy || 'Manual restore';
    return new Promise(function(resolve) {
        if (!dumpFilePath) {
            return resolve({ status: 'failed', log: '', error: 'Restore file path is required.' });
        }
        if (!fs.existsSync(dumpFilePath)) {
            return resolve({ status: 'failed', log: '', error: 'Restore file not found: ' + dumpFilePath });
        }
        ensureDir(getDbBackupDir());
        var env    = process.env;
        var pgEnv  = Object.assign({}, process.env, { PGPASSWORD: env.DB_PASS || '' });
        var dbName = env.DB_NAME    || 'patient_rx_dev';
        var host   = env.DB_HOST   || '127.0.0.1';
        var port   = env.DB_PORT   || '5432';
        var user   = env.DB_USER   || 'postgres';

        function validateDump(cb) {
            var finished = false;
            var stderr = '';
            var child;
            try {
                child = spawn(findPgTool('pg_restore'), ['--list', dumpFilePath], { env: pgEnv });
            } catch (err) {
                cb(err);
                return;
            }
            child.stderr.on('data', function(d) { stderr += d.toString(); });
            child.on('error', function(err) {
                if (finished) return;
                finished = true;
                cb(err);
            });
            child.on('close', function(code) {
                if (finished) return;
                finished = true;
                cb(code === 0 ? null : new Error(stderr.trim() || ('pg_restore --list exited with code ' + code)));
            });
        }

        // Validate the archive before taking any destructive action.
        validateDump(function(validationError) {
            if (validationError) {
                return resolve({
                    status: 'failed',
                    log: '',
                    error: 'The uploaded file is not a valid PostgreSQL custom-format dump: ' + validationError.message
                });
            }

            // Step 1: safety backup. Never drop the database unless this succeeds.
            runBackup('Pre-restore auto-safety-backup').then(function(safetyBackup) {
                if (!safetyBackup || safetyBackup.status !== 'success') {
                    return resolve({
                        status: 'failed',
                        log: '',
                        error: 'Restore stopped because the automatic safety backup failed: '
                            + ((safetyBackup && safetyBackup.error) || 'unknown backup error')
                    });
                }

                // Step 2: drop + recreate DB via psql connecting to 'postgres'
                // We run two psql commands: one DROP, one CREATE
                var psqlTool = findPgTool('psql');

                function runPsql(sql, cb) {
                    var args = [
                        '-h', host, '-p', port, '-U', user,
                        '-d', 'postgres',
                        '-c', sql
                    ];
                    var finished = false;
                    var proc = spawn(psqlTool, args, { env: pgEnv });
                    var out = '', err = '';
                    proc.stdout.on('data', function(d) { out += d.toString(); });
                    proc.stderr.on('data', function(d) { err += d.toString(); });
                    proc.on('error', function(e) {
                        if (finished) return;
                        finished = true;
                        cb(e, '', '', null);
                    });
                    proc.on('close', function(code) {
                        if (finished) return;
                        finished = true;
                        cb(null, out, err, code);
                    });
                }

                var logLines = '[SAFETY BACKUP] ' + safetyBackup.filename + '\n';
                var safeDbName = sqlIdentifier(dbName);

                // Terminate all connections first (required before DROP)
                var terminateSql = 'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ' + sqlStringLiteral(dbName) + ' AND pid <> pg_backend_pid();';
                runPsql(terminateSql, function(e1, o1, err1, c1) {
                    if (e1) {
                        return resolve({ status: 'failed', log: logLines, error: 'psql not found: ' + e1.message + '\nMake sure PostgreSQL bin is in PATH or set PGBIN in .env' });
                    }
                    logLines += '[TERMINATE CONNECTIONS] ' + (c1 === 0 ? 'OK' : 'exit ' + c1) + (err1 ? ' ' + err1.trim() : '') + '\n';
                    if (c1 !== 0) {
                        return resolve({ status: 'failed', log: logLines, error: 'Failed to terminate existing database connections: ' + (err1.trim() || ('exit ' + c1)) });
                    }

                    runPsql('DROP DATABASE IF EXISTS ' + safeDbName + ';', function(e2, o2, err2, c2) {
                        if (e2) {
                            return resolve({ status: 'failed', log: logLines, error: 'Failed to start database drop: ' + e2.message });
                        }
                        logLines += '[DROP] ' + (c2 === 0 ? 'OK' : 'exit ' + c2) + (err2 ? ' ' + err2.trim() : '') + '\n';
                        if (c2 !== 0) {
                            return resolve({ status: 'failed', log: logLines, error: 'Failed to drop database: ' + (err2.trim() || ('exit ' + c2)) });
                        }

                        runPsql('CREATE DATABASE ' + safeDbName + ' TEMPLATE template0;', function(e3, o3, err3, c3) {
                            if (e3) {
                                return resolve({ status: 'failed', log: logLines, error: 'Failed to start database creation: ' + e3.message });
                            }
                            logLines += '[CREATE] ' + (c3 === 0 ? 'OK' : 'exit ' + c3) + (err3 ? ' ' + err3.trim() : '') + '\n';

                            if (c3 !== 0) {
                                return resolve({ status: 'failed', log: logLines, error: 'Failed to recreate database: ' + err3.trim() });
                            }

                            // Step 3: pg_restore into fresh empty DB
                            var args = [
                                '-h', host, '-p', port, '-U', user,
                                '-d', dbName,
                                '-F', 'c',
                                '--no-owner', '--no-privileges',
                                dumpFilePath
                            ];

                            var child = spawn(findPgTool('pg_restore'), args, { env: pgEnv });
                            var restoreOut = '', restoreErr = '';
                            child.stdout.on('data', function(d) { restoreOut += d.toString(); });
                            child.stderr.on('data', function(d) { restoreErr += d.toString(); });

                            child.on('error', function(err) {
                                resolve({ status: 'failed', log: logLines, error: 'pg_restore not found: ' + err.message });
                            });

                            child.on('close', function(code) {
                                var success = code === 0;
                                var fullLog = logLines + restoreOut + (restoreErr ? '\n[stderr]\n' + restoreErr : '');
                                var entry = {
                                    id:          Date.now(),
                                    filename:    null,
                                    timestamp:   new Date().toISOString(),
                                    triggeredBy: triggeredBy,
                                    status:      success ? 'success' : 'failed',
                                    size:        0,
                                    error:       success ? null : (restoreErr.trim() || ('Exit code ' + code))
                                };
                                appendLog(entry);
                                resolve({
                                    status: success ? 'success' : 'failed',
                                    log:    fullLog,
                                    error:  success ? null : (restoreErr.trim() || ('Exit code ' + code))
                                });
                            });
                        });
                    });
                });
            }).catch(function(err) {
                resolve({
                    status: 'failed',
                    log: '',
                    error: 'Restore stopped because the automatic safety backup could not run: ' + err.message
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
    deleteBackupHistoryEntry,
    deleteBackupSiteHistoryEntry,
    startScheduler,
    getDbBackupDir,
    setDbBackupDir,
    getStatus: () => ({
        schedule:      _currentSchedule || DEFAULT_SCHEDULE,
        backupDir:     getDbBackupDir(),
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
