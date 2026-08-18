'use strict';

const cron      = require('node-cron');
const { spawn, spawnSync } = require('child_process');
const path      = require('path');
const fs        = require('fs');
const crypto    = require('crypto');
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

function envFlagEnabled(name, fallback) {
    const value = process.env[name];
    if (value === undefined || value === null || String(value).trim() === '') return fallback;
    return !['0', 'false', 'no', 'off'].includes(String(value).trim().toLowerCase());
}

const DB_BACKUP_SCHEDULER_ENABLED = envFlagEnabled('BACKUP_SCHEDULER_ENABLED', true);
const SITE_BACKUP_SCHEDULER_ENABLED = envFlagEnabled('SITE_BACKUP_SCHEDULER_ENABLED', true);

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
        const configuredDatabaseIdentity = getDatabaseIdentity(env);
        const args = [
            '-h', configuredDatabaseIdentity.host,
            '-p', configuredDatabaseIdentity.port,
            '-U', env.DB_USER || 'postgres',
            '-d', configuredDatabaseIdentity.databaseName,
            '-F', 'c', '-f', filepath
        ];

        const pgEnv = Object.assign({}, process.env, { PGPASSWORD: env.DB_PASS || '' });
        const child = spawn(findPgTool('pg_dump'), args, { env: pgEnv });

        let stderr = '';
        let settled = false;
        child.stderr.on('data', d => { stderr += d.toString(); });

        child.on('close', async code => {
            if (settled) return;
            settled = true;

            let identity = null;
            let fingerprint = null;
            let sourceDatabaseIdentity = configuredDatabaseIdentity;
            let verificationError = null;
            if (code === 0) {
                try {
                    identity = await getFileIdentity(filepath);
                    fingerprint = await _queryApplicationFingerprint(configuredDatabaseIdentity.databaseName);
                    sourceDatabaseIdentity = getDatabaseIdentity(env, fingerprint);
                    if (!databaseIdentitiesMatch(sourceDatabaseIdentity, sourceDatabaseIdentity)
                        || sourceDatabaseIdentity.actualDatabaseName !== sourceDatabaseIdentity.databaseName) {
                        throw new Error('Backup source database identity could not be verified.');
                    }
                } catch (error) {
                    verificationError = error && error.message ? error.message : String(error);
                }
            }

            const entry = {
                kind:        'database-backup',
                id:          Date.now(),
                filename,
                filepath:    code === 0 ? filepath : null,
                timestamp:   new Date().toISOString(),
                triggeredBy,
                status:      code === 0 ? 'success' : 'failed',
                size:        identity ? identity.sizeBytes : 0,
                sha256:      identity ? identity.sha256 : null,
                sizeBytes:   identity ? identity.sizeBytes : 0,
                mtimeMs:     identity ? identity.mtimeMs : null,
                sourceDatabaseIdentity,
                fingerprint,
                verificationError,
                error:       code !== 0 ? stderr.trim() : null
            };

            appendLog(entry);
            pruneOldBackups();
            resolve(entry);
        });

        child.on('error', err => {
            if (settled) return;
            settled = true;
            const entry = {
                kind:        'database-backup',
                id:          Date.now(),
                filename:    null,
                timestamp:   new Date().toISOString(),
                triggeredBy,
                status:      'failed',
                size:        0,
                sourceDatabaseIdentity: configuredDatabaseIdentity,
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
    if (!DB_BACKUP_SCHEDULER_ENABLED) {
        if (_cronJob) { _cronJob.stop(); _cronJob = null; }
        _currentSchedule = 'off';
        return { ok: true, schedule: 'off', disabledByEnvironment: true };
    }
    if (!cronExpression || cronExpression === 'off') {
        if (_cronJob) { _cronJob.stop(); _cronJob = null; }
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
    let cronIsValid = false;
    try { cronIsValid = cron.validate(cronExpression); } catch {}
    if (!cronIsValid) {
        console.error('[Backup] Invalid cron expression:', cronExpression);
        return {
            ok: false,
            schedule: _currentSchedule === null ? 'off' : _currentSchedule,
            error: 'Invalid cron expression: ' + cronExpression
        };
    }
    let replacementJob;
    try {
        replacementJob = cron.schedule(cronExpression, () => {
            console.log('[Backup] Running scheduled backup...');
            runBackup('Scheduled').then(r => {
                console.log('[Backup] Scheduled backup', r.status, r.filename || r.error);
            });
        });
    } catch (error) {
        return {
            ok: false,
            schedule: _currentSchedule === null ? 'off' : _currentSchedule,
            error: 'Unable to start backup scheduler: ' + error.message
        };
    }
    const previousJob = _cronJob;
    _cronJob = replacementJob;
    _currentSchedule = cronExpression;
    if (previousJob) previousJob.stop();
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
if (DB_BACKUP_SCHEDULER_ENABLED) {
    startScheduler(_persistedSchedule || DEFAULT_SCHEDULE, { persist: false });
} else {
    _currentSchedule = 'off';
    console.log('[Backup] Scheduler disabled by BACKUP_SCHEDULER_ENABLED.');
}

function getFileIdentity(filePath) {
    return new Promise(function(resolve, reject) {
        fs.stat(filePath, function(statError, stat) {
            if (statError) return reject(statError);
            if (!stat.isFile()) return reject(new Error('Backup path is not a regular file.'));

            var hash = crypto.createHash('sha256');
            var stream = fs.createReadStream(filePath);
            stream.on('error', reject);
            stream.on('data', function(chunk) { hash.update(chunk); });
            stream.on('end', function() {
                resolve({
                    sha256: hash.digest('hex'),
                    sizeBytes: Number(stat.size || 0),
                    mtimeMs: Math.round(Number(stat.mtimeMs || 0))
                });
            });
        });
    });
}

function getBackupFileIdentity(filename) {
    var safeName = path.basename(String(filename || ''));
    if (!safeName || safeName !== String(filename || '') || !safeName.endsWith('.dump')) {
        return Promise.reject(new Error('Invalid backup filename.'));
    }
    return getFileIdentity(path.join(getDbBackupDir(), safeName));
}

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
                excludes: ['node_modules', '.git', 'logs'],
                excludeRelativePaths: ['administration/delivery-log-archives']
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
                '$excludeRelativePaths = $payloadObj.excludeRelativePaths',
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
                '            $normalizedRel = $rel.Replace([char]92, [char]47).TrimStart([char]47).ToLowerInvariant()',
                '            foreach ($excludedRelativePath in $excludeRelativePaths) {',
                '                $normalizedExcluded = ([string]$excludedRelativePath).Replace([char]92, [char]47).Trim([char]47).ToLowerInvariant()',
                '                if ($normalizedExcluded -and ($normalizedRel -eq $normalizedExcluded -or $normalizedRel.StartsWith($normalizedExcluded + "/"))) {',
                '                    $skip = $true',
                '                    break',
                '                }',
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
    if (!SITE_BACKUP_SCHEDULER_ENABLED) {
        if (_siteBackupJob) { _siteBackupJob.stop(); _siteBackupJob = null; }
        _siteBackupSchedule = 'off';
        return { ok: true, schedule: 'off', disabledByEnvironment: true };
    }
    if (!cronExpression || cronExpression === 'off') {
        if (_siteBackupJob) { _siteBackupJob.stop(); _siteBackupJob = null; }
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
    let cronIsValid = false;
    try { cronIsValid = cron.validate(cronExpression); } catch {}
    if (!cronIsValid) {
        return {
            ok: false,
            schedule: _siteBackupSchedule === null ? 'off' : _siteBackupSchedule,
            error: 'Invalid cron expression: ' + cronExpression
        };
    }
    let replacementJob;
    try {
        replacementJob = cron.schedule(cronExpression, () => {
            console.log('[SiteBackup] Running scheduled full site backup...');
            runFullSiteBackup('Scheduled (Weekly)');
        });
    } catch (error) {
        return {
            ok: false,
            schedule: _siteBackupSchedule === null ? 'off' : _siteBackupSchedule,
            error: 'Unable to start site backup scheduler: ' + error.message
        };
    }
    const previousJob = _siteBackupJob;
    _siteBackupJob = replacementJob;
    _siteBackupSchedule = cronExpression;
    if (previousJob) previousJob.stop();
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
if (SITE_BACKUP_SCHEDULER_ENABLED) {
    startSiteBackupScheduler(_persistedSiteSchedule || DEFAULT_SITE_SCHEDULE, { persist: false });
} else {
    _siteBackupSchedule = 'off';
    console.log('[SiteBackup] Scheduler disabled by SITE_BACKUP_SCHEDULER_ENABLED.');
}

function isBackupScheduleEnabled(schedule) {
    return !!schedule && schedule !== 'off';
}

function isDatabaseBackupLogEntry(entry) {
    if (!entry || typeof entry !== 'object') return false;
    if (entry.kind === 'database-restore') return false;
    if (entry.kind === 'database-backup') return true;
    if (entry.filename && String(entry.filename).toLowerCase().endsWith('.dump')) return true;

    const actor = String(entry.triggeredBy || '').toLowerCase();
    return !(actor.includes('restore') && !actor.includes('backup'));
}

function latestSuccessfulBackup(entries) {
    return (entries || [])
        .filter(function(entry) {
            if (!entry || entry.status !== 'success' || !entry.filename) return false;
            return Number.isFinite(new Date(entry.timestamp).getTime());
        })
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0] || null;
}

function getReadOnlyStatus() {
    const backupDir = getDbBackupDir();
    const configuredDatabaseIdentity = getDatabaseIdentity(process.env);
    const recentBackups = readLog()
        .filter(isDatabaseBackupLogEntry)
        .filter(function(entry) {
            if (!entry.filename) return true;
            return fs.existsSync(path.join(backupDir, entry.filename));
        })
        .map(function(entry) {
            if (!entry.filename) return entry;
            try {
                const stat = fs.statSync(path.join(backupDir, entry.filename));
                return Object.assign({}, entry, {
                    fileSizeBytes: Number(stat.size || 0),
                    fileMtimeMs: Math.round(Number(stat.mtimeMs || 0)),
                    configuredDatabaseMatches: configuredDatabaseIdentitiesMatch(
                        entry.sourceDatabaseIdentity,
                        configuredDatabaseIdentity
                    )
                });
            } catch {
                return entry;
            }
        })
        .slice(0, 100);
    return {
        schedule: _currentSchedule === null ? 'off' : _currentSchedule,
        schedulerEnabled: DB_BACKUP_SCHEDULER_ENABLED,
        backupDir,
        maxBackups: MAX_BACKUPS,
        configuredDatabaseIdentity,
        recentBackups
    };
}

function getRecoverabilityEvidencePath() {
    return path.join(getDbBackupDir(), 'recoverability-validation.json');
}

function getLatestRecoverabilityEvidence() {
    try {
        const parsed = JSON.parse(fs.readFileSync(getRecoverabilityEvidencePath(), 'utf8'));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
        return parsed;
    } catch {
        return null;
    }
}

function normalizePort(value, fallback) {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65535) return String(parsed);
    if (fallback === '') return String(value || '').trim();
    return String(fallback || '').trim();
}

function exactEnvironmentValue(env, name) {
    const key = Object.keys(env || {}).find(candidate => String(candidate).toUpperCase() === name);
    return key ? env[key] : '';
}

function getDatabaseIdentity(envInput, runtimeInput) {
    const env = envInput || process.env;
    const runtime = runtimeInput || {};
    const usesDatabaseEnvironment = env === process.env || Object.keys(env).some(key => /^DB_(?:HOST|PORT|NAME)$/i.test(key));
    const configuredHost = usesDatabaseEnvironment ? exactEnvironmentValue(env, 'DB_HOST') : (env.DB_HOST || env.host);
    const configuredPort = usesDatabaseEnvironment ? exactEnvironmentValue(env, 'DB_PORT') : (env.DB_PORT || env.port);
    const configuredDatabase = usesDatabaseEnvironment ? exactEnvironmentValue(env, 'DB_NAME') : (env.DB_NAME || env.databaseName);
    return {
        host: String(configuredHost || '127.0.0.1').trim().toLowerCase(),
        port: normalizePort(configuredPort, '5432'),
        databaseName: String(configuredDatabase || 'patient_rx_dev').trim(),
        actualDatabaseName: String(runtime.databaseName || runtime.database_name || '').trim(),
        serverAddress: String(runtime.serverAddress || runtime.server_address || '').trim().toLowerCase(),
        serverPort: normalizePort(runtime.serverPort || runtime.server_port, ''),
        databaseOid: String(runtime.databaseOid || runtime.database_oid || '').trim()
    };
}

function configuredDatabaseIdentitiesMatch(leftInput, rightInput) {
    const left = leftInput || {};
    const right = rightInput || {};
    return Boolean(
        left.host && right.host
        && left.port && right.port
        && left.databaseName && right.databaseName
        && String(left.host).toLowerCase() === String(right.host).toLowerCase()
        && String(left.port) === String(right.port)
        && String(left.databaseName) === String(right.databaseName)
    );
}

function databaseIdentitiesMatch(leftInput, rightInput) {
    const left = leftInput || {};
    const right = rightInput || {};
    return Boolean(
        configuredDatabaseIdentitiesMatch(left, right)
        && left.actualDatabaseName && right.actualDatabaseName
        && left.serverAddress && right.serverAddress
        && left.serverPort && right.serverPort
        && left.databaseOid && right.databaseOid
        && String(left.actualDatabaseName) === String(right.actualDatabaseName)
        && String(left.serverAddress).toLowerCase() === String(right.serverAddress).toLowerCase()
        && String(left.serverPort) === String(right.serverPort)
        && String(left.databaseOid) === String(right.databaseOid)
    );
}

function persistRecoverabilityEvidence(result) {
    const rowCounts = result && result.rowCounts && typeof result.rowCounts === 'object'
        ? {
            patients: Number(result.rowCounts.patients || 0),
            rxRecords: Number(result.rowCounts.rxRecords || 0),
            workflowTrackings: Number(result.rowCounts.workflowTrackings || 0)
        }
        : null;
    const evidence = {
        status: result && result.status ? String(result.status) : 'failed',
        validatedAt: new Date().toISOString(),
        backupFile: result && result.backupFile ? path.basename(String(result.backupFile)) : null,
        latestBackupAt: result && result.latestBackupAt ? result.latestBackupAt : null,
        backupSha256: result && result.backupSha256 ? String(result.backupSha256) : null,
        backupSizeBytes: Number(result && result.backupSizeBytes || 0),
        backupMtimeMs: Number(result && result.backupMtimeMs || 0),
        sourceDatabaseIdentity: result && result.sourceDatabaseIdentity
            ? getDatabaseIdentity(result.sourceDatabaseIdentity, result.sourceDatabaseIdentity)
            : null,
        tableCount: Number(result && result.tableCount || 0),
        estimatedLiveRows: Number(result && result.estimatedLiveRows || 0),
        maxTableRows: Number(result && result.maxTableRows || 0),
        migrationCount: Number(result && result.migrationCount || 0),
        migrationLedgerHash: result && result.migrationLedgerHash ? String(result.migrationLedgerHash) : null,
        migrationChecksumsComplete: result && result.migrationChecksumsComplete === true,
        schemaVerified: result && result.schemaVerified === true,
        fingerprintVerified: result && result.fingerprintVerified === true,
        cleanupSucceeded: result && result.cleanupSucceeded === true,
        rowCounts,
        rowCountComparisons: Array.isArray(result && result.rowCountComparisons)
            ? result.rowCountComparisons.slice(0, 10)
            : [],
        durationMs: Number(result && result.durationMs || 0),
        message: result && result.message ? String(result.message).slice(0, 500) : ''
    };
    const evidencePath = getRecoverabilityEvidencePath();
    const tempPath = evidencePath + '.tmp';
    ensureDir(path.dirname(evidencePath));
    fs.writeFileSync(tempPath, JSON.stringify(evidence, null, 2), 'utf8');
    fs.renameSync(tempPath, evidencePath);
    return evidence;
}

function _pgIdentifier(value) {
    return String(value || '').replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
}
function _safeTempDbName(prefix) {
    var safePrefix = _pgIdentifier(prefix || 'rx_health_validate');
    if (!safePrefix) safePrefix = 'rx_health_validate';
    var suffix = (Date.now() + Math.floor(Math.random() * 1e6)).toString(36);
    var candidate = (safePrefix + '_' + suffix).slice(0, 45);
    if (candidate.length < 5) candidate = 'rx_health_validate_' + suffix;
    if (candidate.length > 45) candidate = candidate.slice(0, 45);
    return candidate.replace(/_+$/g, '');
}

function _runToolCommand(toolName, args, toolEnv) {
    return new Promise(function(resolve) {
        var env = toolEnv || process.env;
        var child;
        var stdout = '';
        var stderr = '';
        try {
            child = spawn(toolName, args, { env: env });
        } catch (err) {
            return resolve({ status: 'failed', code: -1, stdout: '', stderr: err.message });
        }

        child.stdout.on('data', function(d) { stdout += d.toString(); });
        child.stderr.on('data', function(d) { stderr += d.toString(); });
        child.on('error', function(err) {
            resolve({ status: 'failed', code: -1, stdout: '', stderr: err.message });
        });
        child.on('close', function(code) {
            resolve({ status: code === 0 ? 'success' : 'failed', code: code, stdout: stdout.trim(), stderr: stderr.trim() });
        });
    });
}

function _runPsqlSql(databaseName, sql) {
    return new Promise(function(resolve, reject) {
        var env = process.env;
        var pgEnv = Object.assign({}, process.env, {
            PGPASSWORD: env.DB_PASS || '',
            PGOPTIONS: env.PGOPTIONS || ''
        });
        var psqlTool = findPgTool('psql');
        var args = [
            '-h', env.DB_HOST || '127.0.0.1',
            '-p', env.DB_PORT || '5432',
            '-U', env.DB_USER || 'postgres',
            '-d', databaseName,
            '-t', '-A', '-F', '|',
            '-c', sql
        ];
        _runToolCommand(psqlTool, args, pgEnv).then(function(result) {
            if (result.status !== 'success') {
                return reject(new Error(result.stderr || ('psql failed: exit ' + result.code)));
            }
            resolve(result.stdout);
        }).catch(function(err) {
            reject(err);
        });
    });
}

function _parsePsqlRows(raw) {
    return String(raw || '')
        .split(/\r?\n/)
        .map(function(line) { return String(line || '').trim(); })
        .filter(function(line) { return line.length > 0; });
}

function _queryDatabaseRuntimeIdentity(dbName) {
    var sql = `
        SELECT row_to_json(r)::text AS json_row FROM (
            SELECT
                current_database() AS database_name,
                (SELECT oid::text FROM pg_database WHERE datname = current_database()) AS database_oid,
                COALESCE(inet_server_addr()::text, 'local-socket') AS server_address,
                COALESCE(inet_server_port()::text, 'local-socket') AS server_port
        ) r;`;
    return _runPsqlSql(dbName, sql).then(function(stdout) {
        var rows = _parsePsqlRows(stdout);
        if (!rows.length) throw new Error('Database identity query returned no rows.');
        return getDatabaseIdentity(process.env, JSON.parse(rows[0]));
    });
}

function _createValidationDatabase(dbName) {
    return _runPsqlSql('postgres', 'CREATE DATABASE ' + sqlIdentifier(dbName) + ' TEMPLATE template0;');
}

function normalizeApplicationFingerprint(raw) {
    raw = raw || {};
    return {
        databaseName: String(raw.database_name || raw.databaseName || ''),
        databaseOid: String(raw.database_oid || raw.databaseOid || ''),
        serverAddress: String(raw.server_address || raw.serverAddress || ''),
        serverPort: String(raw.server_port || raw.serverPort || ''),
        schemaTableCount: Number(raw.schema_table_count || raw.schemaTableCount || 0),
        migrationCount: Number(raw.migration_count || raw.migrationCount || 0),
        missingMigrationChecksums: Number(raw.missing_migration_checksums || raw.missingMigrationChecksums || 0),
        migrationLedgerHash: raw.migration_ledger_hash || raw.migrationLedgerHash || null,
        rowCounts: {
            patients: Number(raw.patient_rows || raw.rowCounts && raw.rowCounts.patients || 0),
            rxRecords: Number(raw.rx_record_rows || raw.rowCounts && raw.rowCounts.rxRecords || 0),
            workflowTrackings: Number(raw.workflow_tracking_rows || raw.rowCounts && raw.rowCounts.workflowTrackings || 0)
        },
        totalCoreRows: Number(raw.total_core_rows || raw.totalCoreRows || 0),
        maxTableRows: Number(raw.max_table_rows || raw.maxTableRows || 0)
    };
}

function _queryApplicationFingerprint(dbName) {
    var sql = `
        WITH row_counts AS (
            SELECT
                (SELECT COUNT(*)::bigint FROM "Patients") AS patient_rows,
                (SELECT COUNT(*)::bigint FROM "RXRecords") AS rx_record_rows,
                (SELECT COUNT(*)::bigint FROM "RXWorkflowTrackings") AS workflow_tracking_rows
        ), migration_ledger AS (
            SELECT
                COUNT(*)::int AS migration_count,
                COUNT(*) FILTER (WHERE "checksum" IS NULL OR BTRIM("checksum") = '')::int AS missing_migration_checksums,
                MD5(COALESCE(STRING_AGG("name" || ':' || COALESCE("checksum", ''), '|' ORDER BY "name"), '')) AS migration_ledger_hash
            FROM "SequelizeMeta"
        )
        SELECT row_to_json(r)::text AS json_row FROM (
            SELECT
                current_database() AS database_name,
                (SELECT oid::text FROM pg_database WHERE datname = current_database()) AS database_oid,
                COALESCE(inet_server_addr()::text, 'local-socket') AS server_address,
                COALESCE(inet_server_port()::text, 'local-socket') AS server_port,
                (SELECT COUNT(*)::int FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE') AS schema_table_count,
                m.migration_count,
                m.missing_migration_checksums,
                m.migration_ledger_hash,
                c.patient_rows,
                c.rx_record_rows,
                c.workflow_tracking_rows,
                (c.patient_rows + c.rx_record_rows + c.workflow_tracking_rows)::bigint AS total_core_rows,
                GREATEST(c.patient_rows, c.rx_record_rows, c.workflow_tracking_rows)::bigint AS max_table_rows
            FROM row_counts c
            CROSS JOIN migration_ledger m
        ) r;`;
    return _runPsqlSql(dbName, sql).then(function(stdout) {
        var rows = _parsePsqlRows(stdout);
        if (!rows.length) throw new Error('Recoverability validation returned no fingerprint rows.');
        return normalizeApplicationFingerprint(JSON.parse(rows[0]));
    });
}

function compareRecoverabilityFingerprints(expectedInput, actualInput) {
    var expected = normalizeApplicationFingerprint(expectedInput);
    var actual = normalizeApplicationFingerprint(actualInput);
    var differences = [];
    var rowCountComparisons = [];

    [
        ['schema table count', 'schemaTableCount'],
        ['migration count', 'migrationCount'],
        ['migration ledger hash', 'migrationLedgerHash']
    ].forEach(function(item) {
        if (expected[item[1]] !== actual[item[1]]) {
            differences.push(item[0] + ' differs from the source backup fingerprint');
        }
    });
    if (!expected.migrationLedgerHash) differences.push('source backup migration ledger hash is missing');
    if (expected.missingMigrationChecksums !== 0 || actual.missingMigrationChecksums !== 0) {
        differences.push('migration ledger contains missing checksums');
    }

    Object.keys(expected.rowCounts).forEach(function(key) {
        var expectedCount = Number(expected.rowCounts[key] || 0);
        var actualCount = Number(actual.rowCounts[key] || 0);
        var tolerance = expectedCount === 0 ? 0 : Math.max(10, Math.ceil(expectedCount * 0.01));
        var difference = Math.abs(actualCount - expectedCount);
        var matches = difference <= tolerance;
        rowCountComparisons.push({ key, expected: expectedCount, actual: actualCount, tolerance, matches });
        if (!matches) differences.push(key + ' row count differs beyond the validation tolerance');
    });

    return { ok: differences.length === 0, differences, rowCountComparisons, expected, actual };
}

function _restoreIntoDatabase(dumpFilePath, dbName) {
    var env = process.env;
    var args = [
        '-h', env.DB_HOST || '127.0.0.1',
        '-p', env.DB_PORT || '5432',
        '-U', env.DB_USER || 'postgres',
        '-d', dbName,
        '-F', 'c',
        '--no-owner', '--no-privileges',
        dumpFilePath
    ];
    return _runToolCommand(findPgTool('pg_restore'), args, Object.assign({}, process.env, { PGPASSWORD: env.DB_PASS || '' }));
}

function validateLatestBackupRecoverability(options) {
    options = options || {};
    var requireFreshHours = Number(options.requireFreshBackupHours);
    if (!Number.isFinite(requireFreshHours) || requireFreshHours <= 0) requireFreshHours = 48;
    var minSchemaTables = Number(options.minSchemaTables);
    if (!Number.isFinite(minSchemaTables) || minSchemaTables <= 0) minSchemaTables = 1;

    return new Promise(function(resolve) {
        var start = Date.now();
        var env = process.env;
        var dbName = env.DB_NAME || 'patient_rx_dev';
        var configuredDatabaseIdentity = getDatabaseIdentity(env);
        function finish(result) {
            try {
                persistRecoverabilityEvidence(result);
                result.evidencePersisted = true;
            } catch (e) {
                result.evidencePersisted = false;
                result.evidenceError = e && e.message ? e.message : String(e || 'Unable to persist validation evidence');
            }
            resolve(result);
        }
        if (options.elevatedIsolatedOperation !== true
            || options.confirmDatabase !== dbName
            || DB_BACKUP_SCHEDULER_ENABLED
            || SITE_BACKUP_SCHEDULER_ENABLED) {
            return finish({
                status: 'skipped',
                tempDatabase: null,
                operationMode: 'elevated-isolated-maintenance',
                message: 'Recoverability validation requires an explicitly confirmed isolated maintenance process with both backup schedulers disabled and temporary credentials that can create a database.',
                durationMs: Date.now() - start
            });
        }

        var backupEntries = syncLogWithDisk()
            .filter(isDatabaseBackupLogEntry)
            .filter(function(entry) {
                return configuredDatabaseIdentitiesMatch(
                    entry && entry.sourceDatabaseIdentity,
                    configuredDatabaseIdentity
                );
            });
        var latest = latestSuccessfulBackup(backupEntries);
        if (!latest || !latest.timestamp) {
            return finish({
                status: 'skipped',
                tempDatabase: null,
                sourceDatabaseIdentity: configuredDatabaseIdentity,
                message: 'No successful backup bound to the configured source database was found; create a new backup before validating recoverability.',
                durationMs: Date.now() - start
            });
        }

        var dumpPath = latest.filename ? path.join(getDbBackupDir(), latest.filename) : null;
        if (!dumpPath || !fs.existsSync(dumpPath)) {
            return finish({
                status: 'failed',
                tempDatabase: null,
                message: 'Latest successful backup dump file is missing on disk.',
                durationMs: Date.now() - start
            });
        }

        var latestTimestamp = new Date(latest.timestamp).getTime();
        if (!Number.isFinite(latestTimestamp)) {
            return finish({
                status: 'failed',
                tempDatabase: null,
                backupFile: latest.filename,
                latestBackupAt: latest.timestamp,
                message: 'Latest successful backup has an invalid timestamp.',
                durationMs: Date.now() - start
            });
        }
        var ageHours = Math.max(0, (Date.now() - latestTimestamp) / (1000 * 60 * 60));
        if (ageHours > requireFreshHours) {
            return finish({
                status: 'failed',
                tempDatabase: null,
                message: 'Latest backup is older than configured recoverability freshness window.',
                latestBackupAgeHours: Math.round(ageHours * 10) / 10,
                requireFreshBackupHours: requireFreshHours,
                durationMs: Date.now() - start
            });
        }

        var tempDb = _safeTempDbName('rx_health_validate');
        if (tempDb === dbName || !/^rx_health_validate_[a-z0-9_]+$/.test(tempDb)) {
            return finish({
                status: 'failed',
                tempDatabase: null,
                backupFile: latest.filename || path.basename(dumpPath),
                latestBackupAt: latest.timestamp,
                message: 'Refusing unsafe restore-validation database name.',
                durationMs: Date.now() - start
            });
        }
        var result = {
            status: 'failed',
            tempDatabase: tempDb,
            backupFile: latest.filename || path.basename(dumpPath),
            latestBackupAt: latest.timestamp,
            latestBackupAgeHours: Math.round(ageHours * 10) / 10,
            tableCount: 0,
            estimatedLiveRows: 0,
            maxTableRows: 0,
            migrationCount: 0,
            migrationLedgerHash: null,
            migrationChecksumsComplete: false,
            schemaVerified: false,
            fingerprintVerified: false,
            rowCounts: null,
            rowCountComparisons: [],
            pgVersion: null,
            operationMode: 'elevated-isolated-maintenance',
            sourceDatabaseIdentity: latest.sourceDatabaseIdentity
        };

        var restoreResult;
        var sourceFingerprint;
        var tempDatabaseCreated = false;

        getBackupFileIdentity(latest.filename)
            .then(function(identity) {
                result.backupSha256 = identity.sha256;
                result.backupSizeBytes = identity.sizeBytes;
                result.backupMtimeMs = identity.mtimeMs;
                if (!latest.sha256 || !Number(latest.sizeBytes) || !Number(latest.mtimeMs)
                    || !latest.fingerprint || !databaseIdentitiesMatch(latest.sourceDatabaseIdentity, latest.sourceDatabaseIdentity)) {
                    throw new Error('Latest backup predates bound dump, source-database identity, and schema fingerprint evidence; create a new backup before validating recoverability.');
                }
                if (latest.sha256 !== identity.sha256
                    || Number(latest.sizeBytes) !== identity.sizeBytes
                    || Number(latest.mtimeMs) !== identity.mtimeMs) {
                    throw new Error('Latest backup dump identity no longer matches its creation record.');
                }
                sourceFingerprint = normalizeApplicationFingerprint(latest.fingerprint);
                return _queryDatabaseRuntimeIdentity(dbName);
            })
            .then(function(currentDatabaseIdentity) {
                if (currentDatabaseIdentity.actualDatabaseName !== dbName
                    || !databaseIdentitiesMatch(latest.sourceDatabaseIdentity, currentDatabaseIdentity)) {
                    throw new Error('Latest backup belongs to a different source database identity; create a new backup for the currently configured database.');
                }
                result.sourceDatabaseIdentity = currentDatabaseIdentity;
                return _runPsqlSql('postgres', 'SELECT (rolsuper OR rolcreatedb)::text FROM pg_roles WHERE rolname = current_user;');
            })
            .then(function(privilegeOut) {
                var privilege = String(_parsePsqlRows(privilegeOut)[0] || '').toLowerCase();
                if (!['t', 'true', '1'].includes(privilege)) {
                    throw new Error('Recoverability validation credentials must have CREATEDB or superuser privilege for the isolated temporary database.');
                }
                return _runPsqlSql('postgres', 'SELECT version() AS "version"');
            })
            .then(function(versionOut) {
                var v = _parsePsqlRows(versionOut);
                result.pgVersion = (v[0] || 'unknown');
                return _runToolCommand(findPgTool('pg_restore'), ['--list', dumpPath], Object.assign({}, process.env, { PGPASSWORD: env.DB_PASS || '' }));
            })
            .then(function(listResult) {
                if (listResult.status !== 'success') {
                    throw new Error('Backup archive validation failed: ' + (listResult.stderr || ('exit ' + listResult.code)));
                }
                return _createValidationDatabase(tempDb);
            })
            .then(function() {
                tempDatabaseCreated = true;
                return _restoreIntoDatabase(dumpPath, tempDb);
            })
            .then(function(restoreRun) {
                restoreResult = restoreRun;
                if (restoreRun.status !== 'success') {
                    throw new Error('Restore to temporary database failed: ' + (restoreRun.stderr || ('exit ' + restoreRun.code)));
                }
                return _queryApplicationFingerprint(tempDb);
            })
            .then(function(restoredFingerprint) {
                var comparison = compareRecoverabilityFingerprints(sourceFingerprint, restoredFingerprint);
                result.tableCount = restoredFingerprint.schemaTableCount;
                result.estimatedLiveRows = restoredFingerprint.totalCoreRows;
                result.maxTableRows = restoredFingerprint.maxTableRows;
                result.migrationCount = restoredFingerprint.migrationCount;
                result.migrationLedgerHash = restoredFingerprint.migrationLedgerHash;
                result.migrationChecksumsComplete = sourceFingerprint.missingMigrationChecksums === 0
                    && restoredFingerprint.missingMigrationChecksums === 0;
                result.schemaVerified = restoredFingerprint.schemaTableCount >= minSchemaTables
                    && restoredFingerprint.schemaTableCount === sourceFingerprint.schemaTableCount;
                result.rowCounts = restoredFingerprint.rowCounts;
                result.rowCountComparisons = comparison.rowCountComparisons;
                result.fingerprintVerified = comparison.ok
                    && result.schemaVerified
                    && result.migrationChecksumsComplete;
                if (!result.fingerprintVerified) {
                    var detail = comparison.differences.length
                        ? comparison.differences.join('; ')
                        : 'schema validation requirements were not met';
                    throw new Error('Recovered database fingerprint did not match the source backup: ' + detail + '.');
                }
                return getBackupFileIdentity(latest.filename);
            })
            .then(function(identityAfterRestore) {
                if (identityAfterRestore.sha256 !== result.backupSha256
                    || identityAfterRestore.sizeBytes !== result.backupSizeBytes
                    || identityAfterRestore.mtimeMs !== result.backupMtimeMs) {
                    throw new Error('Backup dump changed while recoverability validation was running.');
                }
                return _runPsqlSql(tempDb, 'SELECT 1;');
            })
            .then(function() {
                return _runPsqlSql('postgres', 'DROP DATABASE ' + sqlIdentifier(tempDb) + ';');
            })
            .then(function() {
                tempDatabaseCreated = false;
                result.cleanupSucceeded = true;
                result.durationMs = Date.now() - start;
                result.status = 'passed';
                result.message = 'Backup recoverability verified in an isolated temporary database using bound dump identity, migration ledger, schema, and sanitized row-count fingerprints.';
                finish(result);
            })
            .catch(function(err) {
                result.status = 'failed';
                result.durationMs = Date.now() - start;
                result.message = err && err.message ? err.message : String(err || 'Unknown restore-validation error');
                if (restoreResult && restoreResult.status === 'success' && restoreResult.stderr) {
                    result.restoreStderr = restoreResult.stderr;
                }
                if (!tempDatabaseCreated) return finish(result);
                _runPsqlSql('postgres', 'DROP DATABASE ' + sqlIdentifier(tempDb) + ';')
                    .then(function() {
                        tempDatabaseCreated = false;
                        result.cleanupSucceeded = true;
                    })
                    .catch(function(cleanupError) {
                        result.cleanupSucceeded = false;
                        result.cleanupError = cleanupError && cleanupError.message
                            ? cleanupError.message
                            : String(cleanupError || 'Temporary database cleanup failed');
                        result.message += ' Temporary database cleanup also failed: ' + result.cleanupError;
                    })
                    .then(function() { finish(result); });
            });
    });
}

function maybeAlertMissingBackup(kind, schedule, entries, expectedWindowHours, currentDatabaseIdentity) {
    if (!isBackupScheduleEnabled(schedule)) return;
    if (kind === 'database') {
        entries = (entries || []).filter(function(entry) {
            return databaseIdentitiesMatch(
                entry && entry.sourceDatabaseIdentity,
                currentDatabaseIdentity
            );
        });
    }
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

async function checkMissingBackups() {
    const databaseSchedule = _currentSchedule === null ? 'off' : _currentSchedule;
    if (isBackupScheduleEnabled(databaseSchedule)) {
        try {
            const currentDatabaseIdentity = await _queryDatabaseRuntimeIdentity(
                process.env.DB_NAME || 'patient_rx_dev'
            );
            maybeAlertMissingBackup(
                'database',
                databaseSchedule,
                syncLogWithDisk(),
                26,
                currentDatabaseIdentity
            );
        } catch {
            maybeAlertMissingBackup('database', databaseSchedule, [], 26, null);
        }
    }
    try {
        maybeAlertMissingBackup('site', _siteBackupSchedule === null ? 'off' : _siteBackupSchedule, syncSiteLogWithDisk(), 8 * 24);
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
                                    kind:        'database-restore',
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
    getStatus: getReadOnlyStatus,
    getReadOnlyStatus,
    getDatabaseIdentity,
    configuredDatabaseIdentitiesMatch,
    databaseIdentitiesMatch,
    getBackupFileIdentity,
    getLatestRecoverabilityEvidence,
    runFullSiteBackup,
    readSiteLog,
    deleteSiteBackup,
    setSiteBackupDir,
    getSiteBackupDir,
    startSiteBackupScheduler,
    getSiteBackupStatus: () => ({
        schedule:      _siteBackupSchedule === null ? 'off' : _siteBackupSchedule,
        schedulerEnabled: SITE_BACKUP_SCHEDULER_ENABLED,
        backupDir:     getSiteBackupDir(),
        maxBackups:    MAX_SITE_BACKUPS,
        recentBackups: syncSiteLogWithDisk().slice(0, 10)
    }),
    validateLatestBackupRecoverability,
    compareRecoverabilityFingerprints
};
