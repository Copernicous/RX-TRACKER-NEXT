'use strict';
const db        = require('../models');
const { QueryTypes, Op } = require('sequelize');
const fs        = require('fs');
const path      = require('path');
const os        = require('os');
const bcrypt    = require('bcryptjs');
const { parseDate } = require('../utils/dateUtils');
const fileSettings = require('../utils/globalSettings');
const logDashboardService = require('../services/logDashboardService');
const backupService = require('../services/backupService');
const {
    recordPatientServiceDateChange
} = require('../services/patientServiceDateHistoryService');
const {
    syncPatientServiceDateCycles
} = require('../services/patientServiceDateCycleService');

function readSettings() {
    return fileSettings.readSettings();
}

// ── Table definitions with deletion order (dependencies first) ────────────────
const TABLE_META = [
    {
        key: 'RXWorkflowTrackings',
        label: 'RX Workflow Trackings',
        icon: 'fas fa-project-diagram',
        color: '#f59e0b',
        description: 'Workflow step completions for RX records',
        dependsOn: ['RXRecords']
    },
    {
        key: 'RXHistories',
        label: 'RX Histories',
        icon: 'fas fa-history',
        color: '#8b5cf6',
        description: 'Audit trail of RX record changes',
        dependsOn: ['RXRecords']
    },
    {
        key: 'Medications',
        label: 'Medications',
        icon: 'fas fa-pills',
        color: '#06b6d4',
        description: 'Medication entries attached to RX records',
        dependsOn: ['RXRecords']
    },
    {
        key: 'RXRecords',
        label: 'RX Records',
        icon: 'fas fa-prescription',
        color: '#ef4444',
        description: 'All prescription tracking records',
        dependsOn: ['Patients']
    },
    {
        key: 'PatientNotes',
        label: 'Patient Notes',
        icon: 'fas fa-sticky-note',
        color: '#eab308',
        description: 'Free-text notes attached to patient profiles',
        dependsOn: ['Patients']
    },
    {
        key: 'PatientServiceDateHistories',
        label: 'Patient Service Date Histories',
        icon: 'fas fa-calendar-alt',
        color: '#7c3aed',
        description: 'Patient-level service date changes over time',
        dependsOn: ['Patients']
    },
    {
        key: 'PatientLocks',
        label: 'Patient Locks',
        icon: 'fas fa-lock',
        color: '#6b7280',
        description: 'Soft-lock records for concurrent editing protection',
        dependsOn: ['Patients']
    },
    {
        key: 'CallCenterLocks',
        label: 'Call Center Locks',
        icon: 'fas fa-headset',
        color: '#38bdf8',
        description: 'Hard claims that prevent two Call Center users calling the same patient',
        dependsOn: ['Patients']
    },
    {
        key: 'Patients',
        label: 'Patients',
        icon: 'fas fa-user-injured',
        color: '#f43f5e',
        description: 'All patient profiles and demographic data',
        dependsOn: []
    },
    {
        key: 'Pharmacies',
        label: 'Pharmacies',
        icon: 'fas fa-clinic-medical',
        color: '#10b981',
        description: 'Pharmacy locations and contacts',
        dependsOn: []
    },
    {
        key: 'PharmacyTransportCompanies',
        label: 'Pharmacy Transport Companies',
        icon: 'fas fa-truck',
        color: '#3b82f6',
        description: 'Companies that transport from pharmacies',
        dependsOn: []
    },
    {
        key: 'PatientTransportCompanies',
        label: 'Patient Transport Companies',
        icon: 'fas fa-ambulance',
        color: '#14b8a6',
        description: 'Companies that transport patients',
        dependsOn: []
    },
    {
        key: 'Clinics',
        label: 'Clinics',
        icon: 'fas fa-hospital',
        color: '#6366f1',
        description: 'Clinic locations linked to patients',
        dependsOn: []
    },
    {
        key: 'MedicationCatalogs',
        label: 'RX Actions (Catalog)',
        icon: 'fas fa-clipboard-list',
        color: '#0ea5e9',
        description: 'Catalog of available prescription action types',
        dependsOn: []
    },
    {
        key: 'WorkflowActions',
        label: 'Workflow Actions',
        icon: 'fas fa-tasks',
        color: '#84cc16',
        description: 'Workflow step definitions for RX tracking',
        dependsOn: []
    },
    {
        key: 'AuditLogs',
        label: 'Audit Logs',
        icon: 'fas fa-shield-alt',
        color: '#f97316',
        description: 'System-wide change audit trail',
        dependsOn: []
    },
];

// GET /api/admin/stats — live record counts
exports.getStats = async (req, res) => {
    try {
        const counts = {};
        for (const t of TABLE_META) {
            const [result] = await db.sequelize.query(
                `SELECT COUNT(*) AS cnt FROM "${t.key}"`,
                { type: QueryTypes.SELECT }
            );
            counts[t.key] = parseInt(result.cnt, 10);
        }
        res.json({ tables: TABLE_META, counts });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// GET /api/admin/schema — column definitions + FK relationships
exports.getSchema = async (req, res) => {
    try {
        const colRows = await db.sequelize.query(`
            SELECT table_name, column_name, data_type, character_maximum_length,
                   is_nullable, column_default, ordinal_position
            FROM information_schema.columns
            WHERE table_schema = 'public'
            ORDER BY table_name, ordinal_position
        `, { type: QueryTypes.SELECT });

        const fkRows = await db.sequelize.query(`
            SELECT tc.table_name AS from_table, kcu.column_name AS from_column,
                   ccu.table_name AS to_table, ccu.column_name AS to_column,
                   tc.constraint_name
            FROM information_schema.table_constraints AS tc
            JOIN information_schema.key_column_usage AS kcu
                ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
            JOIN information_schema.constraint_column_usage AS ccu
                ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
            WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
            ORDER BY tc.table_name, kcu.column_name
        `, { type: QueryTypes.SELECT });

        const pkRows = await db.sequelize.query(`
            SELECT tc.table_name, kcu.column_name
            FROM information_schema.table_constraints AS tc
            JOIN information_schema.key_column_usage AS kcu
                ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
            WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = 'public'
        `, { type: QueryTypes.SELECT });

        const pkSet = {};
        pkRows.forEach(r => { if (!pkSet[r.table_name]) pkSet[r.table_name] = new Set(); pkSet[r.table_name].add(r.column_name); });

        const fkMap = {};
        fkRows.forEach(r => { fkMap[`${r.from_table}.${r.from_column}`] = { toTable: r.to_table, toColumn: r.to_column }; });

        const tables = {};
        colRows.forEach(row => {
            if (!tables[row.table_name]) tables[row.table_name] = { name: row.table_name, columns: [] };
            const colKey = `${row.table_name}.${row.column_name}`;
            tables[row.table_name].columns.push({
                name:       row.column_name,
                type:       row.data_type + (row.character_maximum_length ? `(${row.character_maximum_length})` : ''),
                nullable:   row.is_nullable === 'YES',
                isPK:       !!(pkSet[row.table_name] && pkSet[row.table_name].has(row.column_name)),
                isFK:       !!fkMap[colKey],
                references: fkMap[colKey] || null
            });
        });

        res.json({ tables: Object.values(tables), relationships: fkRows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
// DELETE /api/admin/purge — purge selected tables in safe order
exports.purge = async (req, res) => {
    const { tables } = req.body; // array of table keys
    if (!tables || !Array.isArray(tables) || tables.length === 0) {
        return res.status(400).json({ error: 'No tables specified.' });
    }

    // Validate all keys are legit
    const validKeys = new Set(TABLE_META.map(t => t.key));
    const invalid = tables.filter(t => !validKeys.has(t));
    if (invalid.length > 0) {
        return res.status(400).json({ error: `Unknown tables: ${invalid.join(', ')}` });
    }

    // Build topologically-sorted deletion order:
    // children (dependsOn non-empty) go first, then parents
    const orderedAll = [...TABLE_META]; // already in safe order in our definition
    const toDelete = orderedAll.filter(t => tables.includes(t.key));

    // Before deleting Patients, null FK refs in RXRecords and Patients from Pharmacies/Transport
    // Also null pharmacyId and transport refs if those tables are being purged
    const results = {};
    const t = await db.sequelize.transaction();
    try {
        // Handle FK nullification for tables that other records point TO
        if (tables.includes('Pharmacies')) {
            await db.sequelize.query('UPDATE "RXRecords" SET "pharmacyId" = NULL WHERE "pharmacyId" IS NOT NULL', { transaction: t });
            await db.sequelize.query('UPDATE "Patients"  SET "pharmacyId" = NULL WHERE "pharmacyId"  IS NOT NULL', { transaction: t });
        }
        if (tables.includes('PharmacyTransportCompanies')) {
            await db.sequelize.query('UPDATE "RXRecords" SET "pharmacyTransportCompanyId" = NULL WHERE "pharmacyTransportCompanyId" IS NOT NULL', { transaction: t });
            await db.sequelize.query('UPDATE "Patients"  SET "pharmacyTransportCompanyId" = NULL WHERE "pharmacyTransportCompanyId" IS NOT NULL', { transaction: t });
        }
        if (tables.includes('PatientTransportCompanies')) {
            await db.sequelize.query('UPDATE "RXRecords" SET "patientTransportCompanyId" = NULL WHERE "patientTransportCompanyId" IS NOT NULL', { transaction: t });
            await db.sequelize.query('UPDATE "Patients"  SET "patientTransportCompanyId" = NULL WHERE "patientTransportCompanyId"  IS NOT NULL', { transaction: t });
        }
        if (tables.includes('Clinics')) {
            await db.sequelize.query('UPDATE "Patients" SET "clinicId" = NULL WHERE "clinicId" IS NOT NULL', { transaction: t });
        }
        if (tables.includes('RXRecords') || tables.includes('Patients')) {
            // Null workflow/medication FK refs that point to RXRecords/Patients if not already deleting them
            if (!tables.includes('RXWorkflowTrackings')) {
                await db.sequelize.query('DELETE FROM "RXWorkflowTrackings" WHERE "rxRecordId" IN (SELECT id FROM "RXRecords")', { transaction: t });
            }
            if (!tables.includes('Medications')) {
                await db.sequelize.query('DELETE FROM "Medications" WHERE "rxRecordId" IN (SELECT id FROM "RXRecords")', { transaction: t });
            }
            if (!tables.includes('RXHistories')) {
                await db.sequelize.query('DELETE FROM "RXHistories" WHERE "rxRecordId" IN (SELECT id FROM "RXRecords")', { transaction: t });
            }
        }
        if (tables.includes('Patients')) {
            if (!tables.includes('PatientNotes')) {
                await db.sequelize.query('DELETE FROM "PatientNotes" WHERE "patientId" IN (SELECT id FROM "Patients")', { transaction: t });
            }
            if (!tables.includes('PatientServiceDateHistories')) {
                await db.sequelize.query('DELETE FROM "PatientServiceDateHistories" WHERE "patientId" IN (SELECT id FROM "Patients")', { transaction: t });
            }
            if (!tables.includes('PatientLocks')) {
                await db.sequelize.query('DELETE FROM "PatientLocks" WHERE "patientId" IN (SELECT id FROM "Patients")', { transaction: t });
            }
            if (!tables.includes('CallCenterLocks')) {
                await db.sequelize.query('DELETE FROM "CallCenterLocks" WHERE "patientId" IN (SELECT id FROM "Patients")', { transaction: t });
            }
            if (!tables.includes('RXRecords')) {
                await db.sequelize.query('DELETE FROM "RXRecords" WHERE "patientId" IN (SELECT id FROM "Patients")', { transaction: t });
            }
        }

        // Now delete in safe order
        for (const tbl of toDelete) {
            const [rows] = await db.sequelize.query(
                `DELETE FROM "${tbl.key}" RETURNING id`,
                { type: QueryTypes.SELECT, transaction: t }
            );
            results[tbl.key] = Array.isArray(rows) ? rows.length : 0;
        }

        await t.commit();

        // Write to audit log
        try {
            // Use validated labels from TABLE_META (not raw user input) to prevent log injection
            var _validatedLabels = toDelete.map(function(t) { return t.label; }).join(', ');
            var _purgeAuditNow = new Date();
            await db.AuditLog.create({
                userId: req.user?.id || null,
                date: _purgeAuditNow,
                time: _purgeAuditNow.toTimeString().split(' ')[0],
                module: 'Back Office',
                action: 'BACKOFFICE_PURGE',
                previousValue: {
                    tableNames: toDelete.map(function(t) { return t.key; }),
                    tableLabels: _validatedLabels
                },
                newValue: { results: results },
                ipAddress: req.ip
            });
        } catch(e) { /* non-fatal */ }

        res.json({ success: true, results });
    } catch (err) {
        await t.rollback();
        res.status(500).json({ error: err.message });
    }
};

// ══════════════════════════════════════════════════════════════════════════
// SYSTEM SETTINGS
// ══════════════════════════════════════════════════════════════════════════
exports.getSettings = (req, res) => {
    try { res.json(readSettings()); }
    catch (e) { res.status(500).json({ error: e.message }); }
};

exports.saveSettings = (req, res) => {
    try {
        const allowed = ['backupPath','backupRetentionDays','appName','sessionTimeoutMinutes','maxLoginAttempts','maintenanceMode','serviceDateOverrideEnabled','callCenterLeadDays','callCenterPhoneClient','callCenterInactiveClaimSeconds'];
        const current = readSettings();
        const currentLeadDays = fileSettings.getCallCenterLeadDays();
        const currentPhoneClient = fileSettings.getCallCenterPhoneClient();
        const currentInactiveClaimSeconds = fileSettings.getCallCenterInactiveClaimSeconds();
        const next    = { ...current };
        for (const key of allowed) if (req.body[key] !== undefined) next[key] = req.body[key];
        next.maintenanceMode = next.maintenanceMode === true || next.maintenanceMode === 'true';
        next.serviceDateOverrideEnabled = next.serviceDateOverrideEnabled === true || next.serviceDateOverrideEnabled === 'true';
        next.serviceWindowDays = 90;
        next.callCenterLeadDays = Number.parseInt(next.callCenterLeadDays, 10);
        if (!Number.isInteger(next.callCenterLeadDays) || next.callCenterLeadDays < 0 || next.callCenterLeadDays > 89) {
            return res.status(400).json({ error: 'Call Center lead days must be a whole number from 0 to 89.' });
        }
        next.callCenterPhoneClient = String(next.callCenterPhoneClient || currentPhoneClient).trim().toLowerCase();
        if (!['microsip', 'rx_softphone', 'auto'].includes(next.callCenterPhoneClient)) {
            return res.status(400).json({ error: 'Call Center phone client must be MicroSIP, RX Softphone, or Automatic.' });
        }
        next.callCenterInactiveClaimSeconds = Number.parseInt(next.callCenterInactiveClaimSeconds, 10);
        if (!Number.isInteger(next.callCenterInactiveClaimSeconds) || next.callCenterInactiveClaimSeconds < 5 || next.callCenterInactiveClaimSeconds > 300) {
            return res.status(400).json({ error: 'Inactive Call Center claim timeout must be a whole number from 5 to 300 seconds.' });
        }
        if (next.backupPath) { try { fs.mkdirSync(next.backupPath, { recursive: true }); } catch {} }
        fileSettings.writeSettings(next);
        if (current.serviceDateOverrideEnabled !== next.serviceDateOverrideEnabled) {
            db.AuditLog.create({
                userId:        req.user ? req.user.id : null,
                date:          new Date().toISOString().split('T')[0],
                time:          new Date().toTimeString().split(' ')[0],
                module:        'Backoffice',
                action:        next.serviceDateOverrideEnabled ? 'Global 90-Day Override Enabled' : 'Global 90-Day Override Disabled',
                recordId:      null,
                previousValue: { serviceDateOverrideEnabled: current.serviceDateOverrideEnabled },
                newValue:      { serviceDateOverrideEnabled: next.serviceDateOverrideEnabled },
                ipAddress:     req.ip || (req.socket ? req.socket.remoteAddress : 'unknown')
            }).catch(function() {});
        }
        if (currentLeadDays !== next.callCenterLeadDays) {
            db.AuditLog.create({
                userId: req.user ? req.user.id : null,
                date: new Date().toISOString().split('T')[0],
                time: new Date().toTimeString().split(' ')[0],
                module: 'Backoffice',
                action: 'Call Center Lead Days Changed',
                recordId: null,
                previousValue: { callCenterLeadDays: currentLeadDays },
                newValue: { callCenterLeadDays: next.callCenterLeadDays },
                ipAddress: req.ip || (req.socket ? req.socket.remoteAddress : 'unknown')
            }).catch(function() {});
        }
        if (currentPhoneClient !== next.callCenterPhoneClient) {
            db.AuditLog.create({
                userId: req.user ? req.user.id : null,
                date: new Date().toISOString().split('T')[0],
                time: new Date().toTimeString().split(' ')[0],
                module: 'Backoffice',
                action: 'Call Center Phone Client Changed',
                recordId: null,
                previousValue: { callCenterPhoneClient: currentPhoneClient },
                newValue: { callCenterPhoneClient: next.callCenterPhoneClient },
                ipAddress: req.ip || (req.socket ? req.socket.remoteAddress : 'unknown')
            }).catch(function() {});
        }
        if (currentInactiveClaimSeconds !== next.callCenterInactiveClaimSeconds) {
            db.AuditLog.create({
                userId: req.user ? req.user.id : null,
                date: new Date().toISOString().split('T')[0],
                time: new Date().toTimeString().split(' ')[0],
                module: 'Backoffice',
                action: 'Call Center Inactive Claim Timeout Changed',
                recordId: null,
                previousValue: { callCenterInactiveClaimSeconds: currentInactiveClaimSeconds },
                newValue: { callCenterInactiveClaimSeconds: next.callCenterInactiveClaimSeconds },
                ipAddress: req.ip || (req.socket ? req.socket.remoteAddress : 'unknown')
            }).catch(function() {});
        }
        res.json({ success: true, settings: next });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

// ══════════════════════════════════════════════════════════════════════════
// BACKUP MANAGER
// ══════════════════════════════════════════════════════════════════════════
function rowsToCsv(columns, rows) {
    const esc = v => {
        if (v === null || v === undefined) return '';
        const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
        return (s.includes(',') || s.includes('"') || s.includes('\n'))
            ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return columns.map(esc).join(',') + '\n' + rows.map(r => columns.map(c => esc(r[c])).join(',')).join('\n');
}

exports.createBackup = async (req, res) => {
    const settings = readSettings();
    const bkpRoot  = settings.backupPath || path.join(__dirname, '..', 'backups');
    const ts       = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const bkpDir   = path.join(bkpRoot, `backup_${ts}`);
    try {
        fs.mkdirSync(bkpDir, { recursive: true });
        const files = [];
        for (const meta of TABLE_META) {
            const rows = await db.sequelize.query(`SELECT * FROM "${meta.key}" ORDER BY id`, { type: QueryTypes.SELECT });
            if (!rows.length) { files.push({ table: meta.key, rows: 0 }); continue; }
            const cols = Object.keys(rows[0]);
            fs.writeFileSync(path.join(bkpDir, `${meta.key}.csv`), rowsToCsv(cols, rows), 'utf8');
            files.push({ table: meta.key, rows: rows.length });
        }
        fs.writeFileSync(path.join(bkpDir, 'manifest.json'), JSON.stringify({ createdAt: new Date().toISOString(), tables: files }, null, 2), 'utf8');
        // Auto-prune old backups
        try {
            const retDays = parseInt(settings.backupRetentionDays || 30, 10);
            const cutoff  = Date.now() - retDays * 86400 * 1000;
            fs.readdirSync(bkpRoot).forEach(d => {
                const full = path.join(bkpRoot, d);
                if (fs.statSync(full).isDirectory() && d.startsWith('backup_') && fs.statSync(full).mtimeMs < cutoff)
                    fs.rmSync(full, { recursive: true, force: true });
            });
        } catch {}
        res.json({ success: true, backupDir: `backup_${ts}`, files });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.listBackups = (req, res) => {
    const settings = readSettings();
    const bkpRoot  = settings.backupPath || path.join(__dirname, '..', 'backups');
    try {
        fs.mkdirSync(bkpRoot, { recursive: true });
        const dirs = fs.readdirSync(bkpRoot)
            .filter(d => { try { return fs.statSync(path.join(bkpRoot, d)).isDirectory() && d.startsWith('backup_'); } catch { return false; } })
            .map(d => {
                const full  = path.join(bkpRoot, d);
                const stat  = fs.statSync(full);
                let manifest = null;
                try { manifest = JSON.parse(fs.readFileSync(path.join(full, 'manifest.json'), 'utf8')); } catch {}
                const csvFiles = fs.readdirSync(full).filter(f => f.endsWith('.csv'));
                const size = csvFiles.reduce((s, f) => { try { return s + fs.statSync(path.join(full, f)).size; } catch { return s; } }, 0);
                return { name: d, createdAt: stat.birthtime, sizeBytes: size, fileCount: csvFiles.length, tables: manifest?.tables || [] };
            })
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        res.json({ backups: dirs, backupPath: bkpRoot });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.deleteBackup = (req, res) => {
    const { name } = req.params;
    if (!name || !name.startsWith('backup_') || name.includes('..')) return res.status(400).json({ error: 'Invalid backup name.' });
    const settings = readSettings();
    const bkpRoot  = settings.backupPath || path.join(__dirname, '..', 'backups');
    try {
        const full = path.join(bkpRoot, name);
        if (!fs.existsSync(full)) return res.status(404).json({ error: 'Backup not found.' });
        fs.rmSync(full, { recursive: true, force: true });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.downloadBackupFile = (req, res) => {
    const { name, file } = req.params;
    if (!name.startsWith('backup_') || name.includes('..') || file.includes('..')) return res.status(400).json({ error: 'Invalid path.' });
    const settings = readSettings();
    const bkpRoot  = settings.backupPath || path.join(__dirname, '..', 'backups');
    const fp = path.join(bkpRoot, name, file);
    if (!fs.existsSync(fp)) return res.status(404).json({ error: 'File not found.' });
    res.setHeader('Content-Disposition', `attachment; filename="${file}"`);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.sendFile(path.resolve(fp));
};

// ══════════════════════════════════════════════════════════════════════════
// SYSTEM HEALTH
// ══════════════════════════════════════════════════════════════════════════
function formatRoutineStatus(itemCount, risk) {
    if (risk) return 'warning';
    return itemCount > 0 ? 'warning' : 'ok';
}

function countCheckStatus(items) {
    var hasCritical = items.some(function(i) { return i.severity === 'critical'; });
    var hasWarning = items.some(function(i) { return i.severity === 'warning'; });
    if (hasCritical) return 'critical';
    if (hasWarning) return 'warning';
    return items.some(function(i) { return i.severity === 'info'; }) ? 'info' : 'ok';
}

function addCheckSummary(checks, key, items, description) {
    checks[key] = {
        description: description,
        status: countCheckStatus(items),
        items: items
    };
}

function parseIntSetting(rawValue, fallback, minimum, maximum) {
    var n = Number.parseInt(rawValue, 10);
    if (!Number.isFinite(n) || Number.isNaN(n)) return fallback;
    if (Number.isInteger(minimum) && n < minimum) return minimum;
    if (Number.isInteger(maximum) && n > maximum) return maximum;
    return n;
}

function parseBoolSetting(rawValue, fallback) {
    if (rawValue === undefined || rawValue === null) return fallback;
    return ['1', 'true', 'yes', 'on', 'y'].includes(String(rawValue).trim().toLowerCase());
}

function getRoutineHealthConfig() {
    return {
        slowQueries: {
            minCalls: parseIntSetting(process.env.DB_HEALTH_SLOW_QUERY_MIN_CALLS, 10, 5, 1000000),
            meanMsWarn: parseIntSetting(process.env.DB_HEALTH_SLOW_QUERY_MEAN_MS_WARNING, 250, 20, 60000),
            totalMsWarn: parseIntSetting(process.env.DB_HEALTH_SLOW_QUERY_TOTAL_MS_WARNING, 5000, 500, 6000000)
        },
        missingIndex: {
            minRows: parseIntSetting(process.env.DB_HEALTH_MISSING_INDEX_MIN_ROWS, 5000, 100, 2000000000),
            minSizeMb: parseIntSetting(process.env.DB_HEALTH_MISSING_INDEX_MIN_TABLE_MB, 8, 1, 2048),
            minCalls: parseIntSetting(process.env.DB_HEALTH_MISSING_INDEX_MIN_CALLS, 20, 3, 1000000),
            minMeanMs: parseIntSetting(process.env.DB_HEALTH_MISSING_INDEX_MIN_MEAN_MS, 120, 10, 60000),
            minEvidenceCalls: parseIntSetting(process.env.DB_HEALTH_MISSING_INDEX_MIN_EVIDENCE_CALLS, 20, 3, 1000000),
            seqToIdxRatioWarn: parseIntSetting(process.env.DB_HEALTH_MISSING_INDEX_SEQ_IDX_RATIO, 20, 2, 2000),
            statsFreshnessHours: parseIntSetting(process.env.DB_HEALTH_MISSING_INDEX_STATS_HOURS, 24, 1, 4320),
            topTables: parseIntSetting(process.env.DB_HEALTH_MISSING_INDEX_TOP_TABLES, 20, 5, 200),
            confidenceScore: {
                missing: parseIntSetting(process.env.DB_HEALTH_MISSING_INDEX_CONF_SCORE_WARN, 70, 40, 99)
            }
        },
        unusedIndex: {
            candidateSizeMb: parseIntSetting(process.env.DB_HEALTH_UNUSED_INDEX_MIN_MB, 10, 1, 4096),
            observationDays: parseIntSetting(process.env.DB_HEALTH_INDEX_OBSERVATION_DAYS, 30, 30, 365),
            warningWriteRows: parseIntSetting(process.env.DB_HEALTH_UNUSED_INDEX_WARNING_WRITES, 2500, 10, 100000000),
            ignoreNameLike: String(process.env.DB_HEALTH_UNUSED_INDEX_IGNORE_LIKE || 'cleanup, %_fk_%, %_cleanup_%').split(',')
        },
        largeColumn: {
            minAvgBytes: parseIntSetting(process.env.DB_HEALTH_LARGE_COLUMN_MIN_AVG_BYTES, 1024, 64, 10485760),
            minVarcharLength: parseIntSetting(process.env.DB_HEALTH_LARGE_VARCHAR_MIN_LENGTH, 1024, 16, 1000000),
            minColumnBytes: parseIntSetting(process.env.DB_HEALTH_LARGE_COLUMN_REPORTED_SIZE_MB, 1, 1, 1024),
            topColumnCandidates: parseIntSetting(process.env.DB_HEALTH_LARGE_COLUMN_TOPN, 60, 10, 500),
            topSampleRows: parseIntSetting(process.env.DB_HEALTH_LARGE_COLUMN_SAMPLE_ROWS, 120, 10, 5000),
        },
        deadRows: {
            warningRatio: parseIntSetting(process.env.DB_HEALTH_DEADROW_WARNING_RATIO_PCT, 12, 1, 100),
            criticalRatio: parseIntSetting(process.env.DB_HEALTH_DEADROW_CRITICAL_RATIO_PCT, 30, 1, 100),
            smallTableRows: parseIntSetting(process.env.DB_HEALTH_SMALL_TABLE_ROWS, 4000, 0, 200000),
            minRowsForVacuumFull: parseIntSetting(process.env.DB_HEALTH_DEADROW_MIN_ROWS_FOR_VACUUM_FULL, 10000, 1, 1000000000),
            vacuumFullReclaimMb: parseIntSetting(process.env.DB_HEALTH_DEADROW_RECLAIM_MB, 128, 16, 10000),
            vacuumFullRatioPct: parseIntSetting(process.env.DB_HEALTH_DEADROW_VACUUM_FULL_RATIO_PCT, 55, 20, 99)
        },
        backup: {
            restoreValidationEnabled: parseBoolSetting(process.env.DB_HEALTH_RESTORE_VALIDATE, false),
            requiredHoursSinceLastSuccessful: parseIntSetting(process.env.DB_HEALTH_BACKUP_RECENT_HOURS, 24, 1, 1680),
            maxValidationAgeHours: parseIntSetting(process.env.DB_HEALTH_BACKUP_VALIDATION_MAX_AGE_HOURS, 48, 2, 720)
        }
    };
}

function quoteIdent(v) {
    return '"' + String(v).replace(/"/g, '""') + '"';
}

function severityFromConfidence(confidence) {
    if (confidence === 'high') return 'warning';
    if (confidence === 'medium') return 'info';
    return 'info';
}

function buildFindingsEnvelope(options) {
    var confidence = options.confidence || 'medium';
    var severity = options.severity || severityFromConfidence(confidence);
    var evidence = options.evidence !== undefined ? options.evidence : null;
    var recommendedAction = options.recommendedAction || 'Review this finding in context before changing production configuration.';
    var requiresHumanApproval = options.requiresHumanApproval !== undefined ? options.requiresHumanApproval : true;
    return {
        severity: severity,
        area: options.area || 'A02',
        finding: options.finding || 'Health check finding',
        reason: options.reason || '',
        evidence: evidence,
        confidence: confidence,
        recommendedAction: recommendedAction,
        requiresHumanApproval: requiresHumanApproval,
        value: options.value || null
    };
}

function extractColumnsFromQuery(queryText) {
    if (!queryText) return [];
    var normalized = String(queryText).toLowerCase().replace(/\\s+/g, ' ');
    var candidates = [];
    var re = /(?:where|join|on|group by|order by)\\s+[^\\)]*?([a-zA-Z_][\\w\\.]*?)\\s*(=|<>|<=|>=|<|>|like|ilike|in|is|between)/g;
    var m;
    while ((m = re.exec(normalized)) !== null) {
        var token = m[1];
        if (!token) continue;
        if (token.indexOf('.') !== -1) token = token.split('.').pop();
        if (token.length < 2) continue;
        if (!/^[a-z][a-z0-9_]*$/.test(token)) continue;
        if (candidates.indexOf(token) === -1) candidates.push(token);
        if (candidates.length >= 12) break;
    }
    return candidates;
}

function detectCheckerError(items, checkKey, check) {
    items.push(buildFindingsEnvelope({
        area: check.area,
        finding: check.finding,
        reason: check.errorReason || 'Query execution failed',
        evidence: { query: check.errorQuery || null, error: check.error },
        confidence: 'low',
        severity: 'critical',
        recommendedAction: check.recommendation || 'Fix query permissions/schema and rerun database health checks.',
        requiresHumanApproval: true
    }));
}

function normalizeIdentifierPatterns(rawPatterns) {
    return String(rawPatterns || '')
        .split(',')
        .map(function(item) { return String(item || '').trim().toLowerCase(); })
        .filter(Boolean);
}

function queryReferencesTable(queryText, schema, table) {
    var q = String(queryText || '').toLowerCase();
    var s = String(schema || '').toLowerCase();
    var t = String(table || '').toLowerCase();
    if (!q || !t) return false;
    if (s) {
        if (q.indexOf('"' + s + '"."' + t + '"') !== -1) return true;
        if (q.indexOf('"' + s + '"."' + t + '.' + '"') !== -1) return true;
        if (q.indexOf(s + '."' + t + '"') !== -1) return true;
    }
    var tQuoted = '"' + t + '"';
    if (q.indexOf(tQuoted) !== -1) return true;
    if (q.indexOf(' ' + t + ' ') !== -1) return true;
    if (q.indexOf(' ' + t + '.') !== -1) return true;
    if (q.indexOf(' ' + t + ',') !== -1) return true;
    if (q.indexOf(' ' + t + ')') !== -1) return true;
    return false;
}

function confidenceFromEvidence(options) {
    var score = Number(options.score || 0);
    if (score >= 70) return 'high';
    if (score >= 40) return 'medium';
    return 'low';
}

exports.getHealth = async (req, res) => {
    try {
        const tableStats = await db.sequelize.query(`
            SELECT t.tablename AS "table",
                pg_size_pretty(pg_total_relation_size(quote_ident(t.tablename))) AS "totalSize",
                pg_total_relation_size(quote_ident(t.tablename)) AS "sizeBytes",
                COALESCE(s.n_live_tup, 0) AS "rowEstimate"
            FROM pg_tables t
            LEFT JOIN pg_stat_user_tables s ON s.relname = t.tablename
            WHERE t.schemaname = 'public'
            ORDER BY pg_total_relation_size(quote_ident(t.tablename)) DESC
        `, { type: QueryTypes.SELECT });

        const [dbInfo] = await db.sequelize.query(
            `SELECT pg_size_pretty(pg_database_size(current_database())) AS "size",
                    pg_database_size(current_database()) AS "sizeBytes",
                    current_database() AS "name",
                    current_user AS "currentUser",
                    inet_server_addr()::text AS "serverAddr",
                    inet_server_port()::text AS "serverPort",
                    inet_client_addr()::text AS "clientAddr",
                    inet_client_port()::text AS "clientPort",
                    current_setting('application_name', true) AS "applicationName",
                    version() AS "version"`,
            { type: QueryTypes.SELECT }
        );

        const [conn] = await db.sequelize.query(
            `SELECT count(*) AS "active" FROM pg_stat_activity WHERE state = 'active'`,
            { type: QueryTypes.SELECT }
        );

        const mem = process.memoryUsage();
        const node = {
            version: process.version, platform: process.platform, arch: process.arch,
            uptime: Math.floor(process.uptime()),
            heapUsed: mem.heapUsed, heapTotal: mem.heapTotal, rss: mem.rss,
            cpus: os.cpus().length, hostname: os.hostname(),
            freeMemBytes: os.freemem(), totalMemBytes: os.totalmem()
        };

        const dbName = dbInfo && dbInfo.name ? dbInfo.name : (process.env.DB_NAME || 'unknown');
        const dbConnection = {
            name: dbName,
            currentUser: dbInfo && dbInfo.currentUser ? dbInfo.currentUser : 'unknown',
            serverHost: dbInfo && dbInfo.serverAddr ? dbInfo.serverAddr : (process.env.DB_HOST || 'localhost'),
            serverPort: dbInfo && dbInfo.serverPort ? dbInfo.serverPort : (process.env.DB_PORT || '5432'),
            clientHost: dbInfo && dbInfo.clientAddr ? dbInfo.clientAddr : null,
            clientPort: dbInfo && dbInfo.clientPort ? dbInfo.clientPort : null,
            applicationName: dbInfo && dbInfo.applicationName ? dbInfo.applicationName : null
        };

        res.json({
            tableStats,
            db: {
                size: dbInfo ? dbInfo.size : null,
                sizeBytes: dbInfo ? dbInfo.sizeBytes : 0,
                version: dbInfo ? dbInfo.version : 'unknown',
                name: dbName,
                currentUser: dbConnection.currentUser,
                connection: dbConnection
            },
            connections: parseInt(conn.active, 10),
            node
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

// ══════════════════════════════════════════════════════════════════════════
exports.getRoutineDbChecks = async (req, res) => {
        try {
        const checks = {};
        const config = getRoutineHealthConfig();
        const ignoreIndexesByName = normalizeIdentifierPatterns(config.unusedIndex.ignoreNameLike);

        function makeNamePatternMatcher(patterns) {
            return function(name) {
                if (!name) return false;
                var lower = String(name).toLowerCase();
                return patterns.some(function(p) {
                    if (!p) return false;
                    if (p.indexOf('%') === -1 && p.indexOf('_') === -1) return lower === p;
                    var re = new RegExp(
                        '^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.') + '$',
                        'i'
                    );
                    return re.test(lower);
                });
            };
        }

        const ignoreIndexByPattern = makeNamePatternMatcher(ignoreIndexesByName);

        async function fetchSlowQueryTop() {
            const [extStat] = await db.sequelize.query(
                `SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements') AS "available"`,
                { type: QueryTypes.SELECT }
            );
            if (!extStat || !extStat.available) return [];

            return db.sequelize.query(
                `SELECT calls, total_exec_time, mean_exec_time, rows,
                        (shared_blks_hit + shared_blks_read) AS "sharedBlks",
                        left(regexp_replace(query, E'[\\t\\n\\r]+', ' ', 'g'), 260) AS "query"
                 FROM pg_stat_statements
                 WHERE calls >= :minCalls
                 ORDER BY total_exec_time DESC NULLS LAST
                 LIMIT :sampleSize`,
                {
                    type: QueryTypes.SELECT,
                    replacements: {
                        minCalls: config.slowQueries.minCalls,
                        sampleSize: 80
                    }
                }
            );
        }

        function buildQueryEvidence(statRows, limit, tableInfo) {
            if (!Array.isArray(statRows) || !statRows.length || !tableInfo) return [];
            return statRows.filter(function(r) {
                return queryReferencesTable(r.query || '', tableInfo.schema, tableInfo.table);
            }).slice(0, limit || 8).map(function(row) {
                return {
                    calls: Number(row.calls || 0),
                    meanMs: Number(row.mean_exec_time || 0),
                    totalMs: Number(row.total_exec_time || 0),
                    rows: Number(row.rows || 0),
                    sharedBlks: Number(row.sharedBlks || 0),
                    query: String(row.query || '').replace(/\\s+/g, ' ').slice(0, 240),
                    columns: extractColumnsFromQuery(row.query || '')
                };
            });
        }

        const slowQueries = [];
        try {
            const statementRows = await fetchSlowQueryTop();
            if (!statementRows.length) {
                slowQueries.push(buildFindingsEnvelope({
                    area: 'A05',
                    finding: 'pg_stat_statements sample not available',
                    reason: 'pg_stat_statements is enabled, but no statements met the configured threshold.',
                    evidence: {
                        minCalls: config.slowQueries.minCalls,
                        sampleRows: 0
                    },
                    confidence: 'low',
                    severity: 'info',
                    recommendedAction: 'Increase workload and rerun checks during business hours.',
                    requiresHumanApproval: false
                }));
            } else {
                statementRows.forEach(function(r) {
                    const mean = Number(r.mean_exec_time || 0);
                    const total = Number(r.total_exec_time || 0);
                    const calls = Number(r.calls || 0);
                    if (mean < config.slowQueries.meanMsWarn && total < config.slowQueries.totalMsWarn) return;

                    var score = 0;
                    if (mean >= config.slowQueries.meanMsWarn) score += 38;
                    if (total >= config.slowQueries.totalMsWarn) score += 25;
                    if (calls >= config.slowQueries.minCalls * 3) score += 25;
                    if (Number(r.rows || 0) > 0) score += 12;
                    const confidence = score > 100 ? 'high' : score >= 60 ? 'medium' : 'low';

                    slowQueries.push(buildFindingsEnvelope({
                        area: 'A05',
                        finding: 'High-latency SQL statement',
                        reason: 'Statement exceeds configured latency thresholds and may delay request paths under load.',
                        evidence: {
                            calls: calls,
                            meanMs: Math.round(mean),
                            totalMs: Math.round(total),
                            rows: Number(r.rows || 0),
                            sharedBlks: Number(r.sharedBlks || 0),
                            statement: String(r.query || '')
                        },
                        confidence: confidence,
                        recommendedAction: 'Review query execution plan and indexes, then measure after applying any SQL or schema changes.',
                        requiresHumanApproval: true,
                        value: {
                            category: 'A05'
                        }
                    }));
                });

                if (!slowQueries.length) {
                    slowQueries.push(buildFindingsEnvelope({
                        area: 'A05',
                        finding: 'No actionable slow-query pattern',
                        reason: 'Captured statements did not breach slow-query thresholds.',
                        evidence: {
                            sampleRows: statementRows.length,
                            minCallThreshold: config.slowQueries.minCalls,
                            meanWarnMs: config.slowQueries.meanMsWarn,
                            totalWarnMs: config.slowQueries.totalMsWarn
                        },
                        confidence: 'high',
                        severity: 'ok',
                        recommendedAction: 'No action needed.',
                        requiresHumanApproval: false,
                        value: {
                            statementCount: statementRows.length
                        }
                    }));
                }
            }
        } catch (e) {
            detectCheckerError(slowQueries, 'slowQueries', {
                area: 'A05',
                finding: 'Unable to evaluate slow queries',
                error: e.message,
                errorQuery: 'pg_stat_statements query'
            });
        }
        addCheckSummary(checks, 'slowQueries', slowQueries, 'Long-running SQL statements and execution hotspots');

            const statementEvidenceRows = [];
        try {
            const stmtRows = await fetchSlowQueryTop();
            statementEvidenceRows.push.apply(statementEvidenceRows, Array.isArray(stmtRows) ? stmtRows : []);
        } catch (e) {
            // ignore. Missing statement evidence lowers confidence in index analysis but never blocks checks.
        }

        const indexChecks = [];
        try {
            const missingIndexRows = await db.sequelize.query(
                `SELECT n.nspname AS "schema", c.relname AS "table",
                        COALESCE(s.seq_scan, 0) AS "seqScan",
                        COALESCE(s.idx_scan, 0) AS "idxScan",
                        COALESCE(s.n_live_tup, 0) AS "liveRows",
                        COALESCE(pg_relation_size(c.oid), 0) AS "sizeBytes",
                        COALESCE(s.n_tup_ins, 0) AS "inserts",
                        COALESCE(s.n_tup_upd, 0) AS "updates",
                        COALESCE(s.n_tup_del, 0) AS "deletes",
                        COALESCE(s.n_mod_since_analyze, 0) AS "modSinceAnalyze",
                        EXTRACT(EPOCH FROM (NOW() - COALESCE(s.stats_reset, NOW() - INTERVAL '10 years')))/3600 AS "statsAgeHours"
                 FROM pg_class c
                 JOIN pg_namespace n ON n.oid = c.relnamespace
                 LEFT JOIN pg_stat_user_tables s
                   ON s.schemaname = n.nspname AND s.relname = c.relname
                 WHERE n.nspname = 'public'
                    AND c.relkind = 'r'
                    AND COALESCE(s.n_live_tup,0) >= :minRows
                    AND COALESCE(pg_relation_size(c.oid), 0) >= :minSizeBytes
                    AND (s.stats_reset IS NULL OR COALESCE(EXTRACT(EPOCH FROM (NOW() - s.stats_reset))/3600, 999999) >= :statsAgeHours)
                    AND COALESCE(s.seq_scan, 0) >= :minSeqScans
                    AND (COALESCE(s.seq_scan,0) >= (COALESCE(s.idx_scan,0) * :seqToIdxRatioWarn))
                  ORDER BY (COALESCE(s.seq_scan,0) / NULLIF(COALESCE(s.idx_scan,0),0)) DESC NULLS LAST
                  LIMIT :limit`,
                {
                    type: QueryTypes.SELECT,
                    replacements: {
                        minRows: config.missingIndex.minRows,
                        minSizeBytes: Math.max(config.missingIndex.minSizeMb, 1) * 1024 * 1024,
                        statsAgeHours: config.missingIndex.statsFreshnessHours,
                        minSeqScans: Math.max(config.missingIndex.minCalls, 1),
                        seqToIdxRatioWarn: config.missingIndex.seqToIdxRatioWarn,
                        limit: config.missingIndex.topTables
                    }
                }
            );

            missingIndexRows.forEach(function(r) {
                var tableInfo = {
                    schema: r.schema,
                    table: r.table
                };
                const seqScan = Number(r.seqScan || 0);
                const idxScan = Number(r.idxScan || 0);
                const liveRows = Number(r.liveRows || 0);
                const sizeBytes = Number(r.sizeBytes || 0);
                const statsAge = Number(r.statsAgeHours || 0);
                const writes = Number(r.inserts || 0) + Number(r.updates || 0) + Number(r.deletes || 0);
                const ratio = idxScan ? seqScan / Math.max(idxScan, 1) : 999;
                if (idxScan > 0 && ratio < config.missingIndex.seqToIdxRatioWarn) return;
                if (idxScan === 0 && liveRows < config.missingIndex.minRows * 3) return;
                if (statsAge < config.missingIndex.statsFreshnessHours) return;

                const evidenceStatements = buildQueryEvidence(statementEvidenceRows, 6, tableInfo);
                const queryPatterns = evidenceStatements.map(function(row) { return row.query; }).filter(Boolean);
                if (!queryPatterns.length) return;

                const evidenceCalls = evidenceStatements.reduce(function(sum, row) { return sum + Number(row.calls || 0); }, 0);
                const evidenceLatencyMs = evidenceStatements.reduce(function(max, row) {
                    return Math.max(max, Number(row.meanMs || 0));
                }, 0);
                const evidenceHasStrongSignal =
                    evidenceCalls >= config.missingIndex.minEvidenceCalls &&
                    evidenceLatencyMs >= config.missingIndex.minMeanMs;
                if (!evidenceHasStrongSignal && idxScan === 0 && ratio < config.missingIndex.seqToIdxRatioWarn * 2) return;

                const columns = [];
                evidenceStatements.forEach(function(item) {
                    (item.columns || []).forEach(function(col) {
                        if (columns.indexOf(col) === -1) columns.push(col);
                    });
                });

                var score = 20;
                if (ratio >= config.missingIndex.seqToIdxRatioWarn * 2) score += 30;
                if (idxScan === 0) score += 30;
                if (sizeBytes >= 1024 * 1024 * 64) score += 10;
                if (liveRows >= Math.max(config.missingIndex.minRows, 50000)) score += 10;
                if (writes >= config.missingIndex.minCalls * 10) score += 10;
                if (evidenceStatements.length > 0) score += Math.min(20, evidenceStatements.length * 5);
                if (evidenceStatements.some(function(item) { return Number(item.meanMs || 0) >= config.missingIndex.minMeanMs; })) score += 12;
                if (statsAge < config.missingIndex.statsFreshnessHours * 2) score += 5;
                if (statsAge <= config.missingIndex.statsFreshnessHours) score -= 5;

                const confidence = confidenceFromEvidence({ score: score });
                const evidenceScore = evidenceHasStrongSignal ? 25 : 5;
                const shouldWarn = score >= config.missingIndex.confidenceScore.missing || ratio > config.missingIndex.seqToIdxRatioWarn * 1.75 || evidenceScore >= 25;

                indexChecks.push(buildFindingsEnvelope({
                    area: 'A02',
                    finding: 'Potential missing index candidate',
                    reason: 'Table scan dominates observed access patterns while index scan coverage is low/absent after a stable statistics window.',
                    evidence: {
                        table: tableInfo.schema + '.' + tableInfo.table,
                        sizeBytes: sizeBytes,
                        liveRows: liveRows,
                        seqScan: seqScan,
                        idxScan: idxScan,
                        seqToIdxRatio: Math.round(ratio * 100) / 100,
                        statsAgeHours: Math.round(statsAge * 10) / 10,
                        writesObserved: writes,
                        queryEvidence: evidenceStatements.slice(0, 6),
                        queryPatterns: queryPatterns.slice(0, 3),
                        queryCallsWindow: evidenceCalls,
                        queryMaxMeanMs: Math.round(evidenceLatencyMs)
                    },
                    confidence: confidence,
                    severity: shouldWarn ? 'warning' : severityFromConfidence(confidence),
                    recommendedAction: idxScan === 0 || shouldWarn
                        ? 'Collect EXPLAIN (ANALYZE, BUFFERS) for at least one referenced query pattern before any index change.'
                        : 'Keep as informational review signal until additional evidence is captured.',
                    requiresHumanApproval: true,
                    value: {
                        recommendedNextAction: shouldWarn ? 'Explain-validate' : 'Track-evidence',
                        table: tableInfo.table,
                        schema: tableInfo.schema,
                        queryPatterns: queryPatterns.slice(0, 3)
                    }
                }));
            });

            if (!indexChecks.length) {
                indexChecks.push(buildFindingsEnvelope({
                    area: 'A02',
                    finding: 'Missing-index candidates not identified',
                    reason: 'No table met the stronger evidence threshold for missing-index candidates.',
                    evidence: {
                        sampleRows: missingIndexRows.length,
                        minRows: config.missingIndex.minRows,
                        minSizeMb: config.missingIndex.minSizeMb,
                        seqToIdxRatio: config.missingIndex.seqToIdxRatioWarn,
                        statsFreshnessHours: config.missingIndex.statsFreshnessHours
                    },
                    confidence: 'high',
                    severity: 'ok',
                    recommendedAction: 'No action required.',
                    requiresHumanApproval: false,
                    value: {
                        candidateCount: missingIndexRows.length
                    }
                }));
            }
        } catch (e) {
            detectCheckerError(indexChecks, 'indexChecks', {
                area: 'A02',
                finding: 'Unable to evaluate missing-index candidates',
                error: e.message,
                errorQuery: 'missing-index candidate query'
            });
        }

        try {
            const unusedRows = await db.sequelize.query(
                `SELECT n.nspname AS "schema", rel.relname AS "table", idx.relname AS "index",
                        COALESCE(ui.idx_scan, 0) AS "idxScan",
                        COALESCE(pg_relation_size(idx.oid), 0) AS "sizeBytes",
                        pg_size_pretty(pg_relation_size(idx.oid)) AS "size",
                        COALESCE(tbl.n_live_tup, 0) AS "liveRows",
                        COALESCE(tbl.n_tup_ins, 0) + COALESCE(tbl.n_tup_upd, 0) + COALESCE(tbl.n_tup_del, 0) AS "writeRows",
                        EXTRACT(EPOCH FROM (NOW() - COALESCE(tbl.stats_reset, NOW() - INTERVAL '10 years')))/3600 AS "statsAgeHours",
                        con.conname AS "constraintName",
                        con.contype AS "constraintType"
                 FROM pg_class idx
                 JOIN pg_index ix ON ix.indexrelid = idx.oid
                 JOIN pg_class rel ON rel.oid = ix.indrelid
                 JOIN pg_namespace n ON n.oid = idx.relnamespace
                 LEFT JOIN pg_stat_user_indexes ui ON ui.indexrelid = idx.oid
                 LEFT JOIN pg_stat_user_tables tbl ON tbl.schemaname = n.nspname AND tbl.relname = rel.relname
                 LEFT JOIN pg_constraint con ON con.conindid = idx.oid
                 WHERE n.nspname = 'public'
                   AND idx.relkind = 'i'
                   AND COALESCE(ui.idx_scan, 0) = 0
                   AND NOT ix.indisprimary
                   AND NOT ix.indisunique
                   AND tbl.stats_reset IS NOT NULL
                   AND COALESCE(EXTRACT(EPOCH FROM (NOW() - tbl.stats_reset))/3600, 999999) >= :statsAgeHours
                   AND COALESCE(pg_relation_size(idx.oid), 0) >= :minIndexSizeBytes
                 ORDER BY COALESCE(pg_relation_size(idx.oid), 0) DESC NULLS LAST`,
                {
                    type: QueryTypes.SELECT,
                    replacements: {
                        minIndexSizeBytes: Math.max(config.unusedIndex.candidateSizeMb, 1) * 1024 * 1024,
                        statsAgeHours: config.unusedIndex.observationDays * 24
                    }
                }
            );

            const filteredUnused = unusedRows.filter(function(r) {
                if (ignoreIndexByPattern(r.index) || ignoreIndexByPattern(r.table)) return false;
                if (r.constraintType === 'f') return false;
                if (r.constraintType && r.constraintName) return false;
                var ageHours = Number(r.statsAgeHours || 0);
                var minAge = config.unusedIndex.observationDays * 24;
                if (ageHours < minAge) return false;
                return true;
            });

            const finalLimit = Math.min(filteredUnused.length, 60);
            if (!filteredUnused.length) {
                indexChecks.push(buildFindingsEnvelope({
                    area: 'A02',
                    finding: 'No unused-index candidates found',
                    reason: 'Indexes with stable zero-usage signals and sufficient observation age were not identified.',
                    evidence: {
                        configuredMinIndexMb: config.unusedIndex.candidateSizeMb,
                        observationDays: config.unusedIndex.observationDays,
                        totalZeroScanCandidates: unusedRows.length
                    },
                    confidence: 'high',
                    severity: 'ok',
                    recommendedAction: 'No action required.',
                    requiresHumanApproval: false,
                    value: {
                        filteredCandidates: 0
                    }
                }));
            } else {
                filteredUnused.slice(0, finalLimit).forEach(function(r) {
                    const sizeBytes = Number(r.sizeBytes || 0);
                    const writeRows = Number(r.writeRows || 0);
                    const liveRows = Number(r.liveRows || 0);
                    const statsAge = Number(r.statsAgeHours || 0);
                    const idxScan = Number(r.idxScan || 0);
                    var score = 25;
                    if (sizeBytes >= config.unusedIndex.candidateSizeMb * 1024 * 1024 * 4) score += 35;
                    if (writeRows >= config.unusedIndex.warningWriteRows) score += 25;
                    if (writeRows > 0) score += 15;
                    if (liveRows > config.missingIndex.minRows) score += 15;
                    if (statsAge < config.unusedIndex.observationDays * 24) score -= 30;
                    const confidence = confidenceFromEvidence({ score: score });
                    const isWarning = writeRows >= config.unusedIndex.warningWriteRows || sizeBytes >= config.unusedIndex.candidateSizeMb * 1024 * 1024 * 4;
                    indexChecks.push(buildFindingsEnvelope({
                        area: 'A02',
                        finding: 'Potentially unused/over-maintained index',
                        reason: 'Observed no index scans across a sustained sample window; verify migration/cleanup usage and foreign-key ownership before any action.',
                        evidence: {
                            index: r.schema + '.' + r.table + '.' + r.index,
                            sizeBytes: sizeBytes,
                            tableLiveRows: liveRows,
                            writesObserved: writeRows,
                            statsAgeHours: Math.round(statsAge * 10) / 10,
                            idxScan: idxScan,
                            constraintName: r.constraintName || null,
                            constraintType: r.constraintType || null
                        },
                        confidence: isWarning ? 'medium' : confidence,
                        severity: isWarning ? 'warning' : 'info',
                        recommendedAction: isWarning
                            ? 'Review write workload and index size. Consider monitoring one more cycle before dropping any index.'
                            : 'Keep as informational evidence; monitor workload trends and only plan cleanup with stronger write/storage signal.',
                        requiresHumanApproval: true,
                        value: {
                            indexTable: r.table,
                            indexName: r.index,
                            candidateSizeBytes: sizeBytes
                        }
                    }));
                });
            }
        } catch (e) {
            detectCheckerError(indexChecks, 'indexChecks', {
                area: 'A02',
                finding: 'Unable to evaluate unused-index candidates',
                error: e.message,
                errorQuery: 'unused-index candidate query'
            });
        }
        addCheckSummary(checks, 'indexChecks', indexChecks, 'Index coverage and maintenance candidates');

        const deadRows = [];
        try {
            const rows = await db.sequelize.query(
                `SELECT schemaname AS "schema", relname AS "table",
                        COALESCE(n_live_tup, 0) AS "liveRows",
                        COALESCE(n_dead_tup, 0) AS "deadRows",
                        CASE WHEN n_live_tup > 0 THEN (COALESCE(n_dead_tup,0)::float / n_live_tup) ELSE NULL END AS "deadRatio",
                        COALESCE(pg_total_relation_size(format('%I.%I', schemaname, relname)), 0) AS "tableSizeBytes",
                        COALESCE(last_vacuum::text, 'never') AS "lastVacuum",
                        COALESCE(last_autovacuum::text, 'never') AS "lastAutovacuum",
                        COALESCE(last_analyze::text, 'never') AS "lastAnalyze",
                        COALESCE(last_autoanalyze::text, 'never') AS "lastAutoanalyze",
                        COALESCE(n_tup_ins, 0) + COALESCE(n_tup_upd, 0) + COALESCE(n_tup_del, 0) AS "writeRows"
                 FROM pg_stat_user_tables
                 ORDER BY COALESCE(CASE WHEN n_live_tup > 0 THEN COALESCE(n_dead_tup,0)::float / n_live_tup ELSE 0 END, 0) DESC
                 LIMIT 40`,
                { type: QueryTypes.SELECT }
            );
            rows.forEach(function(r) {
                var liveRows = Number(r.liveRows || 0);
                var deadRowsCount = Number(r.deadRows || 0);
                var ratio = r.deadRatio;
                if (!Number.isFinite(ratio)) ratio = 0;
                var tableSizeBytes = Number(r.tableSizeBytes || 0);
                var estimatedReclaimBytes = Math.round(tableSizeBytes * ratio);
                var reclaimNeedMb = config.deadRows.vacuumFullReclaimMb;
                var vacuumFullRatio = (config.deadRows.vacuumFullRatioPct || 55) / 100;

                var severity = 'ok';
                if (liveRows > config.deadRows.smallTableRows && ratio >= (config.deadRows.criticalRatio / 100)) {
                    severity = 'warning';
                }
                if (liveRows <= config.deadRows.smallTableRows && ratio > 0.35) {
                    severity = 'info';
                }
                if (liveRows > config.deadRows.smallTableRows && ratio >= 0.5) {
                    severity = 'warning';
                }
                if (liveRows > config.deadRows.smallTableRows && ratio >= (config.deadRows.criticalRatio / 100)) {
                    severity = 'warning';
                }

                const recommendVacuumFull = severity === 'warning'
                    && liveRows >= config.deadRows.minRowsForVacuumFull
                    && deadRowsCount > 0
                    && ratio >= vacuumFullRatio
                    && estimatedReclaimBytes >= reclaimNeedMb * 1024 * 1024;
                deadRows.push(buildFindingsEnvelope({
                    area: 'A05',
                    finding: 'Dead tuple ratio',
                    reason: 'Autovacuum/autoanalyze cadence and dead/live ratio trend are being monitored.',
                    evidence: {
                        table: r.schema + '.' + r.table,
                        liveRows: liveRows,
                        deadRows: deadRowsCount,
                        deadRatio: Math.round(Number(ratio || 0) * 1000) / 10,
                        tableSizeBytes: tableSizeBytes,
                        estimatedReclaimBytes: estimatedReclaimBytes,
                        writeRows: Number(r.writeRows || 0),
                        lastVacuum: r.lastVacuum,
                        lastAutovacuum: r.lastAutovacuum,
                        lastAnalyze: r.lastAnalyze,
                        lastAutoanalyze: r.lastAutoanalyze
                    },
                    confidence: severity === 'ok' ? 'high' : 'medium',
                    severity: severity,
                    recommendedAction: recommendVacuumFull
                        ? 'Investigate bloat with EXPLAIN/pg_stat_progress_vacuum and apply VACUUM FULL only if physical reclaim is required.'
                        : 'Use routine VACUUM/ANALYZE window and monitor after next maintenance cycle.',
                    requiresHumanApproval: true,
                    value: {
                        recommendationRequiresWindow: recommendVacuumFull
                    }
                }));
            });
        } catch (e) {
            detectCheckerError(deadRows, 'deadRows', {
                area: 'A05',
                finding: 'Unable to evaluate dead tuples',
                error: e.message,
                errorQuery: 'pg_stat_user_tables dead tuple query'
            });
        }
        addCheckSummary(checks, 'deadRows', deadRows, 'Dead rows, vacuum timing, and bloat risk signals');

        const largeColumns = [];
        try {
            const candidateColumns = await db.sequelize.query(
                `SELECT c.table_schema AS "schemaName", c.table_name AS "tableName", c.column_name AS "columnName",
                        c.data_type AS "dataType", c.character_maximum_length AS "varcharLength",
                        COALESCE(ps.avg_width, 0) AS "avgWidth"
                 FROM information_schema.columns c
                 JOIN pg_namespace n ON n.nspname = c.table_schema
                 JOIN pg_class t ON t.relnamespace = n.oid AND t.relname = c.table_name AND t.relkind = 'r'
                 LEFT JOIN pg_stats ps
                   ON ps.schemaname = c.table_schema
                  AND ps.tablename  = c.table_name
                  AND ps.attname    = c.column_name
                 WHERE c.table_schema = 'public'
                   AND (
                        c.data_type IN ('text', 'json', 'jsonb', 'bytea')
                        OR (c.data_type = 'character varying' AND COALESCE(c.character_maximum_length, 0) >= :minVarcharLength)
                   )
                   AND COALESCE(ps.avg_width, 0) >= :minAvgBytes
                 ORDER BY COALESCE(ps.avg_width, 0) DESC
                 LIMIT :candidateColumns`,
                {
                    type: QueryTypes.SELECT,
                    replacements: {
                        minVarcharLength: config.largeColumn.minVarcharLength,
                        minAvgBytes: config.largeColumn.minAvgBytes,
                        candidateColumns: config.largeColumn.topColumnCandidates
                    }
                }
            );

            if (!candidateColumns.length) {
                largeColumns.push(buildFindingsEnvelope({
                    area: 'A04',
                    finding: 'Large-column candidates not identified',
                    reason: 'No information_schema candidate passed configured byte/length thresholds.',
                    evidence: {
                        minAvgBytes: config.largeColumn.minAvgBytes,
                        minVarcharLength: config.largeColumn.minVarcharLength,
                        topColumnCandidates: config.largeColumn.topColumnCandidates
                    },
                    confidence: 'high',
                    severity: 'ok',
                    recommendedAction: 'No action required.',
                    requiresHumanApproval: false,
                    value: {
                        candidateColumns: 0
                    }
                }));
            } else {
                for (var i = 0; i < Math.min(candidateColumns.length, config.largeColumn.topColumnCandidates); i++) {
                    const c = candidateColumns[i];
                    const schema = String(c.schemaName || '').trim();
                    const table = String(c.tableName || '').trim();
                    const column = String(c.columnName || '').trim();
                    if (!schema || !table || !column) continue;

                    // Validate catalog-backed existence before dynamic size query.
                    const exists = await db.sequelize.query(
                        `SELECT COUNT(*)::int AS "count"
                         FROM pg_attribute a
                         JOIN pg_class t ON t.oid = a.attrelid AND t.relkind = 'r'
                         JOIN pg_namespace n ON n.oid = t.relnamespace
                         WHERE n.nspname = :schema
                           AND t.relname = :table
                           AND a.attname = :column
                           AND a.attnum > 0
                           AND NOT a.attisdropped`,
                        {
                            type: QueryTypes.SELECT,
                            replacements: {
                                schema: schema,
                                table: table,
                                column: column
                            }
                        }
                    );
                    if (!exists[0] || Number(exists[0].count) < 1) continue;

                    const qSchema = quoteIdent(schema);
                    const qTable = quoteIdent(table);
                    const qColumn = quoteIdent(column);
                    const q = `${qSchema}.${qTable}`;
                    const quotedCol = `${q}.${qColumn}`;
                    const sizeRows = await db.sequelize.query(
                        `SELECT COUNT(*)::bigint AS "rowCount",
                                COALESCE(SUM(pg_column_size(${quotedCol}), 0)::bigint, 0) AS "totalBytes",
                                COALESCE(AVG(pg_column_size(${quotedCol}), 0)::float, 0) AS "avgBytes",
                                COALESCE(MAX(pg_column_size(${quotedCol}), 0)::bigint, 0) AS "maxBytes",
                                SUM(CASE WHEN ${quotedCol} IS NULL THEN 1 ELSE 0 END)::bigint AS "nullCount"
                         FROM ${q}`,
                        { type: QueryTypes.SELECT }
                    );
                    if (!sizeRows || !sizeRows[0]) continue;
                    const sizeStat = sizeRows[0];
                    const rowCount = Number(sizeStat.rowCount || 0);
                    const totalBytes = Number(sizeStat.totalBytes || 0);
                    const avgBytes = Number(sizeStat.avgBytes || 0);
                    const maxBytes = Number(sizeStat.maxBytes || 0);
                    const nullRows = Number(sizeStat.nullCount || 0);
                    if (rowCount <= 0) continue;

                    const nullPercent = Math.round((nullRows / Math.max(rowCount, 1)) * 10000) / 100;
                    const meetsThreshold = totalBytes >= (config.largeColumn.minColumnBytes * 1024 * 1024)
                        || avgBytes >= config.largeColumn.minAvgBytes
                        || maxBytes >= config.largeColumn.minVarcharLength;

                    if (!meetsThreshold) continue;
                    const severity = (totalBytes >= (config.largeColumn.minColumnBytes * 1024 * 1024 * 2))
                        ? 'warning'
                        : 'info';
                    const confidence = confidenceFromEvidence({
                        score: totalBytes > (config.largeColumn.minColumnBytes * 1024 * 1024) ? 70 : 45
                    });
                    largeColumns.push(buildFindingsEnvelope({
                        area: 'A04',
                        finding: 'Large stored column footprint',
                        reason: 'Column storage profile exceeds baseline thresholds and should be reviewed for JSON/text payload growth.',
                        evidence: {
                            table: schema + '.' + table,
                            column: column,
                            dataType: c.dataType,
                            rowCount: rowCount,
                            totalBytes: totalBytes,
                            avgBytes: Math.round(avgBytes),
                            maxBytes: maxBytes,
                            nullPercent: nullPercent,
                            varcharLength: Number(c.varcharLength || 0)
                        },
                        confidence: severity === 'warning' ? 'medium' : confidence,
                        severity: severity,
                        recommendedAction: 'Review payload schema, trim stored JSON/text blobs, or archive historical large fields into dedicated tables.',
                        requiresHumanApproval: true,
                        value: {
                            sampleLimit: config.largeColumn.topSampleRows
                        }
                    }));
                }
            }
        } catch (e) {
            detectCheckerError(largeColumns, 'largeColumns', {
                area: 'A04',
                finding: 'Unable to evaluate large-column footprint',
                error: e.message,
                errorQuery: 'information_schema / pg_column_size query'
            });
        }
        if (!largeColumns.length) {
            largeColumns.push(buildFindingsEnvelope({
                area: 'A04',
                finding: 'Large-column candidates below threshold',
                reason: 'Validated columns were below alert thresholds.',
                evidence: {
                    minColumnBytes: config.largeColumn.minColumnBytes,
                    minVarcharLength: config.largeColumn.minVarcharLength,
                    minAvgBytes: config.largeColumn.minAvgBytes
                },
                confidence: 'high',
                severity: 'ok',
                recommendedAction: 'No action required.',
                requiresHumanApproval: false,
                value: {
                    evaluated: config.largeColumn.topColumnCandidates
                }
            }));
        }
        addCheckSummary(checks, 'largeColumns', largeColumns, 'Potentially oversized JSON/text/bytea/varchar columns');

        const backupRows = [];
        try {
            const backupStatus = backupService.getStatus ? backupService.getStatus() : null;
            const recent = Array.isArray(backupStatus && backupStatus.recentBackups)
                ? backupStatus.recentBackups.slice(0, 30)
                : [];
            const failedRecent = recent.filter(function(r) { return r && r.status === 'failed'; }).length;
            const latest = (() => {
                var newest = null;
                if (Array.isArray(recent)) {
                    for (var i = 0; i < recent.length; i++) {
                        const row = recent[i];
                        if (!row || row.status !== 'success') continue;
                        if (!newest || (new Date(row.timestamp) > new Date(newest.timestamp))) newest = row;
                    }
                }
                return newest;
            })();
            const latestAgeHours = latest && latest.timestamp
                ? Math.max(0, (Date.now() - new Date(latest.timestamp).getTime()) / (1000 * 60 * 60))
                : null;
            const creationStatus = !latest
                ? 'critical'
                : (latestAgeHours > config.backup.requiredHoursSinceLastSuccessful
                    ? 'warning'
                    : 'ok');

            backupRows.push(buildFindingsEnvelope({
                area: 'A10',
                finding: 'Database backup creation recency',
                reason: latest
                    ? 'Recent successful backup availability is used for recovery readiness review.'
                    : 'No recent successful backups found to establish creation coverage.',
                evidence: {
                    schedule: backupStatus && backupStatus.schedule ? backupStatus.schedule : 'unknown',
                    maxBackups: backupStatus && backupStatus.maxBackups ? backupStatus.maxBackups : 0,
                    recentCount: recent.length,
                    failedRecent: failedRecent,
                    latestBackupFile: latest ? latest.filename : null,
                    latestBackupAt: latest ? latest.timestamp : null,
                    latestAgeHours: latestAgeHours === null ? null : Math.round(latestAgeHours * 10) / 10,
                    requiredWindowHours: config.backup.requiredHoursSinceLastSuccessful
                },
                confidence: latest ? 'high' : 'low',
                severity: creationStatus,
                recommendedAction: latest
                    ? (creationStatus === 'warning'
                        ? 'Run backup and verify schedule alignment before high-risk operations.'
                        : 'No action required.')
                    : 'Run backup schedule or restore validation cannot proceed without a successful dump.',
                requiresHumanApproval: latest ? false : true,
                value: {
                    kind: 'db-backup-creation',
                    schedule: backupStatus && backupStatus.schedule ? backupStatus.schedule : 'unknown'
                }
            }));

            recent.forEach(function(r) {
                backupRows.push(buildFindingsEnvelope({
                    area: 'A10',
                    finding: 'Recent backup run',
                    reason: 'Recent run status is reported for audit context, not operational recommendation.',
                    evidence: {
                        filename: r.filename || '',
                        status: r.status || 'unknown',
                        triggeredBy: r.triggeredBy || '',
                        timestamp: r.timestamp || r.date || null,
                        size: r.size || 0
                    },
                    confidence: 'high',
                    severity: r && r.status === 'failed' ? 'warning' : 'ok',
                    recommendedAction: r && r.status === 'failed'
                        ? 'Re-run failed backup manually or verify environment disk and DB privileges.'
                        : 'No action needed.',
                    requiresHumanApproval: r && r.status === 'failed',
                    value: {
                        kind: 'db-backup-recent-run'
                    }
                }));
            });

            if (config.backup.restoreValidationEnabled && latest) {
                const validationResult = await backupService.validateLatestBackupRecoverability({
                    requireFreshBackupHours: config.backup.maxValidationAgeHours,
                    minSchemaTables: 1,
                    sampleTableRows: Math.max(1, Math.min(config.largeColumn.topSampleRows, 50))
                });
                const validationSeverity = validationResult && validationResult.status === 'passed'
                    ? 'ok'
                    : validationResult && validationResult.status === 'skipped' ? 'info' : 'warning';
                const validationConfidence = validationResult && validationResult.status === 'passed' ? 'high' : 'low';
                backupRows.push(buildFindingsEnvelope({
                    area: 'A10',
                    finding: validationResult && validationResult.status === 'passed'
                        ? 'Database recoverability validated in isolation'
                        : 'Database recoverability validation failed',
                    reason: validationResult && validationResult.message
                        ? validationResult.message
                        : 'Isolated restore validation returned with non-success result.',
                    evidence: validationResult || { error: 'No recoverability details available' },
                    confidence: validationConfidence,
                    severity: validationSeverity,
                    recommendedAction: validationResult && validationResult.status === 'passed'
                        ? 'No action required.'
                        : 'Run isolated restore validation from operations window and review restore output.',
                    requiresHumanApproval: validationResult && validationResult.status === 'passed' ? false : true,
                    value: {
                        validationStatus: validationResult && validationResult.status ? validationResult.status : 'unknown',
                        tempDbName: validationResult ? validationResult.tempDatabase : null,
                        ageHoursFromBackup: latestAgeHours === null ? null : Math.round(latestAgeHours * 10) / 10
                    }
                }));
            }
        } catch (e) {
            detectCheckerError(backupRows, 'backupHealth', {
                area: 'A10',
                finding: 'Unable to evaluate backup health',
                error: e.message,
                errorQuery: 'backup health + optional recoverability check'
            });
        }
        addCheckSummary(checks, 'backupHealth', backupRows, 'Backup creation and recoverability checks');

        const summary = {
            generatedAt: new Date().toISOString(),
            overall: 'ok',
            totals: { ok: 0, info: 0, warning: 0, critical: 0 },
            checks
        };

        Object.keys(checks).forEach(function(key) {
            checks[key].items.forEach(function(item) {
                if (item.severity === 'critical') summary.totals.critical += 1;
                else if (item.severity === 'warning') summary.totals.warning += 1;
                else if (item.severity === 'info') summary.totals.info += 1;
                else if (item.severity === 'ok') summary.totals.ok += 1;
            });
            if (checks[key].status === 'critical') summary.overall = 'critical';
            if (checks[key].status === 'warning' && summary.overall === 'ok') summary.overall = 'warning';
        });

        res.json(summary);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

exports.getLogDashboard = async (req, res) => {
    try {
        const summary = await logDashboardService.buildLogDashboardSummary(req.query || {});
        res.json(summary);
    } catch (e) { res.status(500).json({ error: e.message }); }
};

// LOCK MANAGER
// ══════════════════════════════════════════════════════════════════════════
exports.getLocks = async (req, res) => {
    try {
        const locks = await db.sequelize.query(`
            SELECT pl.id, pl."patientId", pl."userId", pl."lockedAt", pl."expiresAt",
                p."firstName" || ' ' || p."lastName" AS "patientName",
                u."firstName" || ' ' || u."lastName" AS "userName", u."username",
                CASE WHEN pl."expiresAt" > NOW() THEN true ELSE false END AS "isActive",
                EXTRACT(EPOCH FROM (pl."expiresAt" - NOW()))::int AS "secsRemaining"
            FROM "PatientLocks" pl
            LEFT JOIN "Patients" p ON p.id = pl."patientId"
            LEFT JOIN "Users"    u ON u.id = pl."userId"
            ORDER BY pl."expiresAt" DESC
        `, { type: QueryTypes.SELECT });
        res.json({ locks, active: locks.filter(l => l.isActive).length, expired: locks.filter(l => !l.isActive).length });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.releaseLock = async (req, res) => {
    const { id } = req.params;
    try {
        await db.sequelize.query(`DELETE FROM "PatientLocks" WHERE id = :id`, { replacements: { id: parseInt(id,10) }, type: QueryTypes.DELETE });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.releaseExpiredLocks = async (req, res) => {
    try {
        const rows = await db.sequelize.query(`DELETE FROM "PatientLocks" WHERE "expiresAt" < NOW() RETURNING id`, { type: QueryTypes.SELECT });
        res.json({ success: true, released: Array.isArray(rows) ? rows.length : 0 });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

function ccCleanupInput(source) {
    source = source || {};
    const target = ['all', 'calls', 'notes', 'service_dates', 'locks'].includes(source.target) ? source.target : 'all';
    const lockScope = source.lockScope === 'all' ? 'all' : 'stale';
    const userId = parseInt(source.userId || '', 10);
    const patientId = parseInt(source.patientId || '', 10);
    return {
        target,
        lockScope,
        from: parseDate(source.from) || null,
        to: parseDate(source.to) || null,
        userId: Number.isFinite(userId) ? userId : null,
        patientId: Number.isFinite(patientId) ? patientId : null
    };
}

function ccWhere(input, config, replacements) {
    const clauses = [];
    if (config.base) clauses.push(config.base);
    if (input.from) {
        replacements[config.prefix + 'From'] = input.from + ' 00:00:00';
        clauses.push(config.dateCol + ' >= :' + config.prefix + 'From');
    }
    if (input.to) {
        replacements[config.prefix + 'To'] = input.to + ' 23:59:59';
        clauses.push(config.dateCol + ' <= :' + config.prefix + 'To');
    }
    if (input.userId && config.userCol) {
        replacements[config.prefix + 'UserId'] = input.userId;
        clauses.push(config.userCol + ' = :' + config.prefix + 'UserId');
    }
    if (input.patientId && config.patientCol) {
        replacements[config.prefix + 'PatientId'] = input.patientId;
        clauses.push(config.patientCol + ' = :' + config.prefix + 'PatientId');
    }
    if (config.lockScope && input.lockScope === 'stale') {
        clauses.push('"expiresAt" < NOW()');
    }
    return clauses.length ? clauses.join(' AND ') : '1=1';
}

async function ccCount(sql, replacements) {
    const row = await db.sequelize.query(sql, {
        type: QueryTypes.SELECT,
        replacements
    });
    return parseInt((row[0] && row[0].count) || 0, 10) || 0;
}

function ccWantsTarget(input, target) {
    return input.target === 'all' || input.target === target;
}

async function ccCleanupCounts(input) {
    const counts = {
        callAttempts: 0,
        callEvents: 0,
        callCenterNotes: 0,
        noteAuditEvents: 0,
        serviceDateAuditEvents: 0,
        serviceDateHistoryEvents: 0,
        locks: 0
    };

    let rep = {};
    if (ccWantsTarget(input, 'calls')) {
        counts.callAttempts = await ccCount(
            `SELECT COUNT(*)::int AS count FROM "CallCenterCallAttempts" WHERE ${ccWhere(input, {
                prefix: 'callAttempt',
                dateCol: `"dialedAt"`,
                userCol: `"userId"`,
                patientCol: `"patientId"`
            }, rep)}`,
            rep
        );
        rep = {};
        counts.callEvents = await ccCount(
            `SELECT COUNT(*)::int AS count FROM "AuditLogs" WHERE ${ccWhere(input, {
                prefix: 'call',
                base: `"module" = 'Call Center' AND "action" = 'Called'`,
                dateCol: `"createdAt"`,
                userCol: `"userId"`,
                patientCol: `"recordId"`
            }, rep)}`,
            rep
        );
    }

    rep = {};
    if (ccWantsTarget(input, 'notes')) {
        counts.callCenterNotes = await ccCount(
            `SELECT COUNT(*)::int AS count FROM "PatientNotes" WHERE ${ccWhere(input, {
                prefix: 'note',
                base: `"source" = 'Call Center'`,
                dateCol: `"createdAt"`,
                userCol: `"userId"`,
                patientCol: `"patientId"`
            }, rep)}`,
            rep
        );
        rep = {};
        counts.noteAuditEvents = await ccCount(
            `SELECT COUNT(*)::int AS count FROM "AuditLogs" WHERE ${ccWhere(input, {
                prefix: 'noteAudit',
                base: `"module" = 'Call Center' AND "action" = 'Note Added'`,
                dateCol: `"createdAt"`,
                userCol: `"userId"`,
                patientCol: `"recordId"`
            }, rep)}`,
            rep
        );
    }

    rep = {};
    if (ccWantsTarget(input, 'service_dates')) {
        counts.serviceDateAuditEvents = await ccCount(
            `SELECT COUNT(*)::int AS count FROM "AuditLogs" WHERE ${ccWhere(input, {
                prefix: 'svcAudit',
                base: `"module" = 'Call Center' AND "action" = 'Service Date Added'`,
                dateCol: `"createdAt"`,
                userCol: `"userId"`,
                patientCol: `"recordId"`
            }, rep)}`,
            rep
        );
        rep = {};
        counts.serviceDateHistoryEvents = await ccCount(
            `SELECT COUNT(*)::int AS count FROM "PatientServiceDateHistories" WHERE ${ccWhere(input, {
                prefix: 'svcHist',
                base: `"changeSource" = 'Call Center'`,
                dateCol: `"createdAt"`,
                userCol: `"changedByUserId"`,
                patientCol: `"patientId"`
            }, rep)}`,
            rep
        );
    }

    rep = {};
    if (ccWantsTarget(input, 'locks')) {
        counts.locks = await ccCount(
            `SELECT COUNT(*)::int AS count FROM "CallCenterLocks" WHERE ${ccWhere(input, {
                prefix: 'lock',
                dateCol: `"createdAt"`,
                userCol: `"userId"`,
                patientCol: `"patientId"`,
                lockScope: true
            }, rep)}`,
            rep
        );
    }

    counts.total = counts.callAttempts + counts.callEvents + counts.callCenterNotes + counts.noteAuditEvents +
        counts.serviceDateAuditEvents + counts.serviceDateHistoryEvents + counts.locks;
    return counts;
}

exports.getCallCenterCleanupPreview = async (req, res) => {
    try {
        const input = ccCleanupInput(req.query || {});
        const counts = await ccCleanupCounts(input);
        let preview = [];
        if (input.target === 'locks') {
            const rep = {};
            preview = await db.sequelize.query(`
                SELECT l.id, l."createdAt", 'Lock' AS action, l."patientId",
                       p."firstName" || ' ' || p."lastName" AS "patientName",
                       u."firstName" || ' ' || u."lastName" AS "userName", u.username
                FROM "CallCenterLocks" l
                LEFT JOIN "Patients" p ON p.id = l."patientId"
                LEFT JOIN "Users" u ON u.id = l."userId"
                WHERE ${ccWhere(input, {
                    prefix: 'previewLock',
                    dateCol: `l."createdAt"`,
                    userCol: `l."userId"`,
                    patientCol: `l."patientId"`,
                    lockScope: true
                }, rep)}
                ORDER BY l."createdAt" DESC
                LIMIT 20
            `, { type: QueryTypes.SELECT, replacements: rep });
        } else if (input.target === 'calls') {
            const rep = {};
            preview = await db.sequelize.query(`
                SELECT a.id, a."dialedAt" AS "createdAt",
                       COALESCE(NULLIF(a.outcome, ''), NULLIF(a.state, ''), 'Call Attempt') AS action,
                       a."patientId", a."patientName",
                       a."agentName" AS "userName", u.username
                FROM "CallCenterCallAttempts" a
                LEFT JOIN "Users" u ON u.id = a."userId"
                WHERE ${ccWhere(input, {
                    prefix: 'previewAttempt',
                    dateCol: `a."dialedAt"`,
                    userCol: `a."userId"`,
                    patientCol: `a."patientId"`
                }, rep)}
                ORDER BY a."dialedAt" DESC
                LIMIT 20
            `, { type: QueryTypes.SELECT, replacements: rep });
        } else {
            const actions = [];
            if (ccWantsTarget(input, 'calls')) actions.push('Called');
            if (ccWantsTarget(input, 'notes')) actions.push('Note Added');
            if (ccWantsTarget(input, 'service_dates')) actions.push('Service Date Added');
            const rep = { previewActions: actions.length ? actions : ['Called', 'Note Added', 'Service Date Added'] };
            preview = await db.sequelize.query(`
                SELECT al.id, al."createdAt", al.action, al."recordId" AS "patientId",
                       p."firstName" || ' ' || p."lastName" AS "patientName",
                       u."firstName" || ' ' || u."lastName" AS "userName", u.username
                FROM "AuditLogs" al
                LEFT JOIN "Patients" p ON p.id = al."recordId"
                LEFT JOIN "Users" u ON u.id = al."userId"
                WHERE ${ccWhere(input, {
                    prefix: 'previewAudit',
                    base: `al."module" = 'Call Center' AND al."action" IN (:previewActions)`,
                    dateCol: `al."createdAt"`,
                    userCol: `al."userId"`,
                    patientCol: `al."recordId"`
                }, rep)}
                ORDER BY al."createdAt" DESC
                LIMIT 20
            `, { type: QueryTypes.SELECT, replacements: rep });
        }
        res.json({ input, counts, preview });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

async function ccDeleteReturning(sql, replacements, transaction) {
    const rows = await db.sequelize.query(sql, {
        type: QueryTypes.SELECT,
        replacements,
        transaction
    });
    return Array.isArray(rows) ? rows.length : 0;
}

exports.purgeCallCenterCleanup = async (req, res) => {
    const input = ccCleanupInput(req.body || {});
    if ((req.body && req.body.confirmText) !== 'PURGE CALL CENTER') {
        return res.status(400).json({ error: 'Type PURGE CALL CENTER to confirm.' });
    }

    const t = await db.sequelize.transaction();
    try {
        const results = {};
        let rep = {};

        if (ccWantsTarget(input, 'calls')) {
            results.callAttempts = await ccDeleteReturning(
                `DELETE FROM "CallCenterCallAttempts" WHERE ${ccWhere(input, {
                    prefix: 'callAttemptDel',
                    dateCol: `"dialedAt"`,
                    userCol: `"userId"`,
                    patientCol: `"patientId"`
                }, rep)} RETURNING id`,
                rep,
                t
            );
            rep = {};
            results.callEvents = await ccDeleteReturning(
                `DELETE FROM "AuditLogs" WHERE ${ccWhere(input, {
                    prefix: 'callDel',
                    base: `"module" = 'Call Center' AND "action" = 'Called'`,
                    dateCol: `"createdAt"`,
                    userCol: `"userId"`,
                    patientCol: `"recordId"`
                }, rep)} RETURNING id`,
                rep,
                t
            );
        }

        rep = {};
        if (ccWantsTarget(input, 'notes')) {
            results.callCenterNotes = await ccDeleteReturning(
                `DELETE FROM "PatientNotes" WHERE ${ccWhere(input, {
                    prefix: 'noteDel',
                    base: `"source" = 'Call Center'`,
                    dateCol: `"createdAt"`,
                    userCol: `"userId"`,
                    patientCol: `"patientId"`
                }, rep)} RETURNING id`,
                rep,
                t
            );
            rep = {};
            results.noteAuditEvents = await ccDeleteReturning(
                `DELETE FROM "AuditLogs" WHERE ${ccWhere(input, {
                    prefix: 'noteAuditDel',
                    base: `"module" = 'Call Center' AND "action" = 'Note Added'`,
                    dateCol: `"createdAt"`,
                    userCol: `"userId"`,
                    patientCol: `"recordId"`
                }, rep)} RETURNING id`,
                rep,
                t
            );
        }

        rep = {};
        if (ccWantsTarget(input, 'service_dates')) {
            results.serviceDateAuditEvents = await ccDeleteReturning(
                `DELETE FROM "AuditLogs" WHERE ${ccWhere(input, {
                    prefix: 'svcAuditDel',
                    base: `"module" = 'Call Center' AND "action" = 'Service Date Added'`,
                    dateCol: `"createdAt"`,
                    userCol: `"userId"`,
                    patientCol: `"recordId"`
                }, rep)} RETURNING id`,
                rep,
                t
            );
            rep = {};
            results.serviceDateHistoryEvents = await ccDeleteReturning(
                `DELETE FROM "PatientServiceDateHistories" WHERE ${ccWhere(input, {
                    prefix: 'svcHistDel',
                    base: `"changeSource" = 'Call Center'`,
                    dateCol: `"createdAt"`,
                    userCol: `"changedByUserId"`,
                    patientCol: `"patientId"`
                }, rep)} RETURNING id`,
                rep,
                t
            );
        }

        rep = {};
        if (ccWantsTarget(input, 'locks')) {
            results.locks = await ccDeleteReturning(
                `DELETE FROM "CallCenterLocks" WHERE ${ccWhere(input, {
                    prefix: 'lockDel',
                    dateCol: `"createdAt"`,
                    userCol: `"userId"`,
                    patientCol: `"patientId"`,
                    lockScope: true
                }, rep)} RETURNING id`,
                rep,
                t
            );
        }

        await t.commit();

        try {
            await db.AuditLog.create({
                userId: req.user?.id || null,
                date: new Date(),
                time: new Date().toTimeString().split(' ')[0],
                module: 'Back Office',
                action: 'Call Center Cleanup Purge',
                newValue: { input, results },
                ipAddress: req.ip
            });
        } catch (_e) {}

        res.json({ success: true, input, results });
    } catch (e) {
        await t.rollback();
        res.status(500).json({ error: e.message });
    }
};

exports.searchPatientsForServiceDateOverride = async (req, res) => {
    try {
        const q = String(req.query.q || '').trim();
        if (q.length < 2) return res.json({ patients: [] });

        const like = { [Op.like]: `%${q}%` };
        const patients = await db.Patient.findAll({
            where: {
                [Op.and]: [
                    { [Op.or]: [{ isDeleted: false }, { isDeleted: null }] },
                    {
                        [Op.or]: [
                            { firstName: like },
                            { lastName: like },
                            { patientCode: like },
                            { phone: like }
                        ]
                    }
                ]
            },
            attributes: ['id', 'patientCode', 'firstName', 'lastName', 'dob', 'phone', 'serviceDate', 'isActive'],
            include: [{
                model: db.RXRecord,
                attributes: ['id', 'serviceDate', 'arrivalDate', 'isDeleted'],
                where: { [Op.or]: [{ isDeleted: false }, { isDeleted: null }] },
                required: false
            }],
            order: [['lastName', 'ASC'], ['firstName', 'ASC']],
            limit: 12
        });

        res.json({ patients });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.overridePatientServiceDate = async (req, res) => {
    const patientId = parseInt(req.params.id, 10);
    const newServiceDate = parseDate(req.body.serviceDate);
    const reason = String(req.body.reason || '').trim();
    const syncMatchingRx = req.body.syncMatchingRx === true || req.body.syncMatchingRx === 'true';

    if (!Number.isFinite(patientId)) return res.status(400).json({ error: 'Invalid patient id.' });
    if (!newServiceDate) return res.status(400).json({ error: 'New service date is required.' });
    if (reason.length < 8) return res.status(400).json({ error: 'A reason of at least 8 characters is required.' });

    const t = await db.sequelize.transaction();
    try {
        const patient = await db.Patient.findByPk(patientId, { transaction: t, lock: t.LOCK.UPDATE });
        if (!patient) {
            await t.rollback();
            return res.status(404).json({ error: 'Patient not found.' });
        }

        const oldServiceDate = patient.serviceDate ? String(patient.serviceDate).slice(0, 10) : null;
        if (oldServiceDate === newServiceDate) {
            await t.rollback();
            return res.status(400).json({ error: 'New service date is the same as the current service date.' });
        }

        patient.serviceDate = newServiceDate;
        await patient.save({ transaction: t });

        let rxUpdated = 0;
        if (syncMatchingRx && oldServiceDate) {
            const result = await db.RXRecord.update(
                { serviceDate: newServiceDate, arrivalDate: newServiceDate },
                {
                    where: {
                        patientId,
                        serviceDate: oldServiceDate,
                        [Op.or]: [{ isDeleted: false }, { isDeleted: null }]
                    },
                    transaction: t
                }
            );
            rxUpdated = Array.isArray(result) ? result[0] : result;
        }

        const label = `${patient.firstName || ''} ${patient.lastName || ''}`.trim() || `Patient #${patient.id}`;
        await db.AuditLog.create({
            userId:        req.user ? req.user.id : null,
            date:          new Date().toISOString().split('T')[0],
            time:          new Date().toTimeString().split(' ')[0],
            module:        'Backoffice',
            action:        '90-Day Service Date Override',
            recordId:      patient.id,
            previousValue: {
                _label: label,
                patientCode: patient.patientCode,
                serviceDate: oldServiceDate
            },
            newValue: {
                _label: label,
                patientCode: patient.patientCode,
                serviceDate: newServiceDate,
                reason,
                syncMatchingRx,
                rxUpdated
            },
            ipAddress:     req.ip || req.socket?.remoteAddress || 'unknown'
        }, { transaction: t });

        await t.commit();

        await recordPatientServiceDateChange({
            patientId: patient.id,
            previousServiceDate: oldServiceDate,
            newServiceDate,
            userId: req.user?.id || null,
            changeSource: 'Backoffice Override',
            reason,
            metadata: {
                syncMatchingRx,
                rxUpdated
            }
        });

        res.json({
            success: true,
            patient: {
                id: patient.id,
                patientCode: patient.patientCode,
                firstName: patient.firstName,
                lastName: patient.lastName,
                oldServiceDate,
                serviceDate: newServiceDate
            },
            rxUpdated
        });
    } catch (e) {
        await t.rollback();
        res.status(500).json({ error: e.message });
    }
};

// ══════════════════════════════════════════════════════════════════════════
// USER MANAGER
// ══════════════════════════════════════════════════════════════════════════
const ROLE_LABELS = { 1: 'Administrator', 2: 'Supervisor', 3: 'Operator', 4: 'Read Only' };

exports.getUsers = async (req, res) => {
    try {
        const users = await db.sequelize.query(`
            SELECT u.id, u."username", u."firstName", u."lastName", u."email",
                   u."roleId", u."isActive", u."createdAt",
                   u."twoFactorEnabled", u."failedLoginCount", u."lockedUntil",
                   (SELECT COUNT(*) FROM "AuditLogs" al WHERE al."userId" = u.id)::int AS "activityCount",
                   (SELECT MAX("createdAt") FROM "AuditLogs" al WHERE al."userId" = u.id) AS "lastActivity"
            FROM "Users" u ORDER BY u."createdAt" DESC
        `, { type: QueryTypes.SELECT });
        res.json({ users: users.map(u => ({ ...u, roleLabel: ROLE_LABELS[u.roleId] || 'Unknown' })) });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.updateUser = async (req, res) => {
    const { id } = req.params;
    if (parseInt(id, 10) === req.user?.id) return res.status(400).json({ error: 'Cannot modify your own account here.' });
    const { roleId, isActive } = req.body;
    try {
        const sets = [], rep = { id: parseInt(id, 10) };
        if (roleId   !== undefined) { sets.push(`"roleId" = :roleId`);     rep.roleId   = parseInt(roleId, 10); }
        if (isActive !== undefined) { sets.push(`"isActive" = :isActive`); rep.isActive = !!isActive; }
        if (!sets.length) return res.status(400).json({ error: 'Nothing to update.' });
        await db.sequelize.query(`UPDATE "Users" SET ${sets.join(',')} WHERE id = :id`, { replacements: rep });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.adminResetPassword = async (req, res) => {
    const { id } = req.params;
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    if (parseInt(id, 10) === req.user?.id) return res.status(400).json({ error: 'Use your profile page to change your own password.' });
    try {
        const hash = await bcrypt.hash(newPassword, 12);
        await db.sequelize.query(`UPDATE "Users" SET "passwordHash" = :hash WHERE id = :id`, { replacements: { hash, id: parseInt(id,10) } });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
};
// ── FK pairs for orphan detection [childTable, childCol, parentTable, parentCol] ──
const FK_PAIRS = [
    ['RXRecords',           'patientId',                  'Patients',                 'id'],
    ['RXWorkflowTrackings', 'rxRecordId',                 'RXRecords',                'id'],
    ['Medications',         'rxRecordId',                 'RXRecords',                'id'],
    ['RXHistories',         'rxRecordId',                 'RXRecords',                'id'],
    ['PatientNotes',        'patientId',                  'Patients',                 'id'],
    ['PatientServiceDateHistories', 'patientId',          'Patients',                 'id'],
    ['PatientServiceDateHistories', 'changedByUserId',    'Users',                    'id'],
    ['PatientLocks',        'patientId',                  'Patients',                 'id'],
    ['RXRecords',           'pharmacyId',                 'Pharmacies',               'id'],
    ['RXRecords',           'pharmacyTransportCompanyId', 'PharmacyTransportCompanies','id'],
    ['RXRecords',           'patientTransportCompanyId',  'PatientTransportCompanies','id'],
    ['Patients',            'clinicId',                   'Clinics',                  'id'],
];

// GET /api/admin/orphans — find FK references with no matching parent
exports.getOrphans = async (req, res) => {
    try {
        const results = [];
        for (const [childTbl, childCol, parentTbl, parentCol] of FK_PAIRS) {
            const [rows] = await db.sequelize.query(
                `SELECT COUNT(*) AS cnt FROM "${childTbl}" c
                 WHERE c."${childCol}" IS NOT NULL
                   AND NOT EXISTS (
                       SELECT 1 FROM "${parentTbl}" p WHERE p."${parentCol}" = c."${childCol}"
                   )`,
                { type: QueryTypes.SELECT }
            );
            const count = parseInt(rows?.cnt ?? 0, 10);
            results.push({
                childTable: childTbl, childCol, parentTable: parentTbl, parentCol,
                orphanCount: count, clean: count === 0
            });
        }
        const totalOrphans = results.reduce((s, r) => s + r.orphanCount, 0);
        res.json({ results, totalOrphans, clean: totalOrphans === 0 });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// DELETE /api/admin/orphans — clean up orphaned rows for a specific FK pair
exports.cleanOrphans = async (req, res) => {
    const { childTable, childCol, parentTable, parentCol } = req.body;
    // Validate against known pairs
    const valid = FK_PAIRS.find(([ct, cc, pt, pc]) =>
        ct === childTable && cc === childCol && pt === parentTable && pc === parentCol);
    if (!valid) return res.status(400).json({ error: 'Unknown FK pair.' });

    // The WHERE clause that identifies orphaned rows in childTable
    const orphanWhere = `"${childCol}" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "${parentTable}" p WHERE p."${parentCol}" = "${childTable}"."${childCol}")`;

    const t = await db.sequelize.transaction();
    try {
        // Before deleting orphaned rows, cascade-delete their own children
        // (e.g. before deleting orphaned RXRecords, delete their RXHistories/Medications/RXWorkflowTrackings)
        const grandChildren = FK_CHILDREN[childTable] || [];
        for (const gc of grandChildren) {
            if (gc.action === 'cascade' && !gc.via) {
                await db.sequelize.query(
                    `DELETE FROM "${gc.table}" WHERE "${gc.col}" IN (SELECT id FROM "${childTable}" WHERE ${orphanWhere})`,
                    { transaction: t }
                );
            }
        }

        // Now delete the orphaned rows themselves
        const [deleted] = await db.sequelize.query(
            `DELETE FROM "${childTable}" WHERE ${orphanWhere} RETURNING id`,
            { type: QueryTypes.SELECT, transaction: t }
        );
        await t.commit();
        const count = Array.isArray(deleted) ? deleted.length : 0;
        res.json({ success: true, deleted: count });
    } catch (err) {
        await t.rollback();
        res.status(500).json({ error: err.message });
    }
};

// GET /api/admin/duplicates — find duplicate Patients by name or phone
exports.getDuplicates = async (req, res) => {
    try {
        // Duplicates by full name
        const byName = await db.sequelize.query(`
            SELECT
                TRIM(LOWER("firstName")) || ' ' || TRIM(LOWER("lastName")) AS match_key,
                COUNT(*) AS cnt,
                JSON_AGG(JSON_BUILD_OBJECT(
                    'id', id,
                    'firstName', "firstName",
                    'lastName', "lastName",
                    'dob', "dob",
                    'phone', "phone",
                    'createdAt', "createdAt",
                    'isActive', "isActive"
                ) ORDER BY id) AS records
            FROM "Patients"
            GROUP BY TRIM(LOWER("firstName")), TRIM(LOWER("lastName"))
            HAVING COUNT(*) > 1
            ORDER BY cnt DESC
        `, { type: QueryTypes.SELECT });

        // Duplicates by phone
        const byPhone = await db.sequelize.query(`
            SELECT
                "phone" AS match_key,
                COUNT(*) AS cnt,
                JSON_AGG(JSON_BUILD_OBJECT(
                    'id', id,
                    'firstName', "firstName",
                    'lastName', "lastName",
                    'dob', "dob",
                    'phone', "phone",
                    'createdAt', "createdAt"
                ) ORDER BY id) AS records
            FROM "Patients"
            WHERE "phone" IS NOT NULL AND TRIM("phone") != ''
            GROUP BY "phone"
            HAVING COUNT(*) > 1
            ORDER BY cnt DESC
        `, { type: QueryTypes.SELECT });

        res.json({
            byName:  byName.map(r => ({ ...r, cnt: parseInt(r.cnt, 10) })),
            byPhone: byPhone.map(r => ({ ...r, cnt: parseInt(r.cnt, 10) })),
            totalNameGroups:  byName.length,
            totalPhoneGroups: byPhone.length
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// GET /api/admin/audit-logs — paginated, filterable audit log viewer
exports.getAuditLogs = async (req, res) => {
    const page     = Math.max(1, parseInt(req.query.page  || '1',   10));
    const pageSize = Math.min(500, Math.max(10, parseInt(req.query.size || '50', 10)));
    const offset   = (page - 1) * pageSize;
    const action   = req.query.action   || '';
    const userId   = req.query.userId   || '';
    const module_  = req.query.module   || '';
    const search   = req.query.search   || '';
    const dateFrom = req.query.dateFrom || '';
    const dateTo   = req.query.dateTo   || '';

    const where = ['1=1'];
    const replacements = { limit: pageSize, offset };

    if (action)   { where.push(`al."action" ILIKE :action`);         replacements.action = `%${action}%`; }
    if (userId)   { where.push(`al."userId" = :userId`);              replacements.userId = parseInt(userId, 10); }
    if (module_)  { where.push(`al."module" ILIKE :module_`);         replacements.module_ = `%${module_}%`; }
    if (search)   { where.push(`(al."previousValue"::text ILIKE :search OR al."newValue"::text ILIKE :search)`); replacements.search = `%${search}%`; }
    if (dateFrom) { where.push(`al."date" >= :dateFrom`);             replacements.dateFrom = dateFrom; }
    if (dateTo)   { where.push(`al."date" <= :dateTo`);               replacements.dateTo = dateTo; }

    const whereClause = where.join(' AND ');
    try {
        const [countRow] = await db.sequelize.query(
            `SELECT COUNT(*) AS total FROM "AuditLogs" al WHERE ${whereClause}`,
            { type: QueryTypes.SELECT, replacements }
        );
        const total = parseInt(countRow.total, 10);

        const rows = await db.sequelize.query(`
            SELECT al.id, al."action", al."module", al."recordId", al."date", al."time",
                   al."ipAddress", al."previousValue", al."newValue", al."createdAt", al."userId",
                   u."firstName", u."lastName", u."username"
            FROM "AuditLogs" al
            LEFT JOIN "Users" u ON u.id = al."userId"
            WHERE ${whereClause}
            ORDER BY al."createdAt" DESC
            LIMIT :limit OFFSET :offset
        `, { type: QueryTypes.SELECT, replacements });

        // Distinct action types for filter dropdown
        const actions = await db.sequelize.query(
            `SELECT DISTINCT "action" FROM "AuditLogs" WHERE "action" IS NOT NULL ORDER BY "action"`,
            { type: QueryTypes.SELECT }
        );

        res.json({ rows, total, page, pageSize, pages: Math.ceil(total / pageSize), actions: actions.map(a => a.action) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
// GET /api/admin/table-data/:tableName — fetch all rows from a table
exports.getTableData = async (req, res) => {
    const { tableName } = req.params;
    const validKeys = new Set(TABLE_META.map(t => t.key));
    if (!validKeys.has(tableName)) {
        return res.status(400).json({ error: `Unknown table: ${tableName}` });
    }
    try {
        const rows = await db.sequelize.query(
            `SELECT * FROM "${tableName}" ORDER BY id DESC`,
            { type: QueryTypes.SELECT }
        );
        // Get column names from first row, or from information_schema if empty
        let columns = [];
        if (rows.length > 0) {
            columns = Object.keys(rows[0]);
        } else {
            const colRows = await db.sequelize.query(
                `SELECT column_name FROM information_schema.columns WHERE table_name = :tbl ORDER BY ordinal_position`,
                { type: QueryTypes.SELECT, replacements: { tbl: tableName } }
            );
            columns = colRows.map(r => r.column_name);
        }
        const meta = TABLE_META.find(t => t.key === tableName);
        res.json({ tableName, label: meta?.label || tableName, columns, rows, total: rows.length });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// ── FK children map: parent table → child tables that reference it ─────────────
// action: 'cascade' = delete child rows, 'null' = SET col = NULL
// IMPORTANT: list grandchildren BEFORE their parents so the delete order is safe
const FK_CHILDREN = {
    Patients: [
        // Attachment metadata must be removed before its patient/RX owners.
        { table: 'DocumentAttachments', col: 'rxRecordId', action: 'cascade', via: 'RXRecords' },
        { table: 'DocumentAttachments', col: 'patientId',  action: 'cascade', impactExcludeVia: { col: 'rxRecordId', via: 'RXRecords' } },
        // Grandchildren of RXRecords must be cleaned BEFORE RXRecords is deleted
        { table: 'RXHistories',          col: 'rxRecordId',  action: 'cascade', via: 'RXRecords' },
        { table: 'RXWorkflowTrackings',  col: 'rxRecordId',  action: 'cascade', via: 'RXRecords' },
        { table: 'Medications',          col: 'rxRecordId',  action: 'cascade', via: 'RXRecords' },
        // Direct children of Patients
        { table: 'RXRecords',            col: 'patientId',   action: 'cascade' },
        { table: 'PatientNotes',         col: 'patientId',   action: 'cascade' },
        { table: 'PatientServiceDateHistories', col: 'patientId', action: 'cascade' },
        { table: 'PatientServiceDateCycles', col: 'patientId', action: 'cascade' },
        { table: 'PatientLocks',         col: 'patientId',   action: 'cascade' },
        { table: 'CallCenterLocks',      col: 'patientId',   action: 'cascade' },
    ],
    RXRecords: [
        // Children of RXRecords — delete in safe order
        { table: 'RXHistories',          col: 'rxRecordId',  action: 'cascade' },
        { table: 'RXWorkflowTrackings',  col: 'rxRecordId',  action: 'cascade' },
        { table: 'Medications',          col: 'rxRecordId',  action: 'cascade' },
    ],
    Pharmacies: [
        { table: 'RXRecords',            col: 'pharmacyId',                 action: 'null' },
        { table: 'Patients',             col: 'pharmacyId',                 action: 'null' },
    ],
    PharmacyTransportCompanies: [
        { table: 'RXRecords',            col: 'pharmacyTransportCompanyId', action: 'null' },
        { table: 'Patients',             col: 'pharmacyTransportCompanyId', action: 'null' },
    ],
    PatientTransportCompanies: [
        { table: 'RXRecords',            col: 'patientTransportCompanyId',  action: 'null' },
        { table: 'Patients',             col: 'patientTransportCompanyId',  action: 'null' },
    ],
    Clinics: [
        { table: 'Patients',             col: 'clinicId',                   action: 'null' },
    ],
    WorkflowActions: [
        { table: 'RXWorkflowTrackings',  col: 'workflowActionId',           action: 'null' },
    ],
    Users: [
        // AuditLogs and RXHistories reference userId — SET NULL to allow user deletion
        { table: 'RXHistories',          col: 'userId',                     action: 'null' },
        { table: 'PatientServiceDateHistories', col: 'changedByUserId',     action: 'null' },
        { table: 'AuditLogs',            col: 'userId',                     action: 'null' },
    ],
};


// POST /api/admin/row-impact — returns count of related records for given IDs
exports.getRowImpact = async (req, res) => {
    const { tableName, ids } = req.body;
    const validKeys = new Set(TABLE_META.map(t => t.key));
    if (!validKeys.has(tableName)) return res.status(400).json({ error: `Unknown table: ${tableName}` });
    if (!ids || !ids.length) return res.status(400).json({ error: 'No IDs provided.' });

    const children = FK_CHILDREN[tableName] || [];
    const impact = [];
    try {
        for (const child of children) {
            const idList = ids.map(id => parseInt(id, 10)).filter(n => !isNaN(n));
            if (!idList.length) continue;
            let whereSql = `"${child.col}" IN (:ids)`;
            if (child.via) {
                const viaLink = children.find(c => c.table === child.via && !c.via);
                if (!viaLink) continue;
                whereSql = `"${child.col}" IN (SELECT id FROM "${child.via}" WHERE "${viaLink.col}" IN (:ids))`;
            }
            if (child.impactExcludeVia) {
                const viaLink = children.find(c => c.table === child.impactExcludeVia.via && !c.via);
                if (!viaLink) continue;
                whereSql += ` AND ("${child.impactExcludeVia.col}" IS NULL OR "${child.impactExcludeVia.col}" NOT IN (` +
                    `SELECT id FROM "${child.impactExcludeVia.via}" WHERE "${viaLink.col}" IN (:ids)))`;
            }
            const [row] = await db.sequelize.query(
                `SELECT COUNT(*) AS cnt FROM "${child.table}" WHERE ${whereSql}`,
                { type: QueryTypes.SELECT, replacements: { ids: idList } }
            );
            const cnt = parseInt(row.cnt, 10);
            if (cnt > 0 || child.action === 'cascade') {
                impact.push({ table: child.table, col: child.col, count: cnt, action: child.action });
            }
        }
        res.json({ tableName, ids, impact, hasImpact: impact.some(i => i.count > 0) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

function auditServiceDateValue(value) {
    if (!value) return null;
    let payload = value;
    if (typeof payload === 'string') {
        try { payload = JSON.parse(payload); } catch (_e) { payload = {}; }
    }
    if (!payload || typeof payload !== 'object') return null;
    return parseDate(payload.serviceDate || payload.newServiceDate);
}

function isCallCenterEligibleServiceDate(value) {
    const serviceDate = parseDate(value);
    if (!serviceDate) return false;
    const cutoff = new Date();
    cutoff.setHours(0, 0, 0, 0);
    cutoff.setDate(cutoff.getDate() - fileSettings.getServiceWindowDays());
    return serviceDate < cutoff.toISOString().slice(0, 10);
}

function serviceDateCycleEnd(value) {
    const serviceDate = parseDate(value);
    if (!serviceDate) return null;
    const end = new Date(`${serviceDate}T00:00:00`);
    if (isNaN(end.getTime())) return null;
    end.setDate(end.getDate() + fileSettings.getServiceWindowDays());
    return end;
}

function requestIp(req) {
    return req.headers['x-forwarded-for'] || req.ip || (req.connection && req.connection.remoteAddress) || null;
}

async function prepareServiceDateHistoryDelete(idList, transaction, req) {
    const histories = await db.PatientServiceDateHistory.findAll({
        where: { id: { [Op.in]: idList } },
        transaction,
        lock: transaction.LOCK.UPDATE
    });
    const result = {
        inspected: histories.length,
        callCenterRows: 0,
        restoredPatients: 0,
        removedServiceDateAuditLogs: 0,
        removedCallCenterLocks: 0,
        reopenedQueuePatients: 0,
        closedServiceDateCycles: 0
    };
    const callCenterRows = histories.filter((row) =>
        String(row.changeSource || '').trim().toLowerCase() === 'call center'
    );
    result.callCenterRows = callCenterRows.length;
    if (!callCenterRows.length) return result;

    const patientIds = Array.from(new Set(callCenterRows
        .map((row) => parseInt(row.patientId, 10))
        .filter((id) => Number.isFinite(id))));
    const auditIdsToDelete = [];
    const reopenedQueuePatientIds = new Set();

    for (const history of callCenterRows) {
        const patientId = parseInt(history.patientId, 10);
        if (!Number.isFinite(patientId)) continue;

        const previousServiceDate = parseDate(history.previousServiceDate);
        const newServiceDate = parseDate(history.newServiceDate);
        const patient = await db.Patient.findByPk(patientId, {
            transaction,
            lock: transaction.LOCK.UPDATE
        });
        if (patient && newServiceDate && parseDate(patient.serviceDate) === newServiceDate) {
            await patient.update({ serviceDate: previousServiceDate || null }, { transaction });
            const [closedCycles] = await db.PatientServiceDateCycle.update({
                status: 'historical',
                endedAt: serviceDateCycleEnd(newServiceDate)
            }, {
                where: {
                    patientId,
                    serviceDate: newServiceDate,
                    status: 'active'
                },
                transaction
            });
            result.closedServiceDateCycles += closedCycles || 0;
            await syncPatientServiceDateCycles(patient, {
                transaction,
                userId: req && req.user && req.user.id ? req.user.id : null,
                source: 'Backoffice Call Center Queue Repair',
                contextChangeReason: 'Backoffice deleted Call Center service date history',
                metadata: { callCenterQueueRepair: true }
            });
            result.restoredPatients += 1;
            if (
                patient.isActive === true &&
                patient.isDeleted !== true &&
                isCallCenterEligibleServiceDate(previousServiceDate)
            ) {
                reopenedQueuePatientIds.add(patientId);
                await db.AuditLog.create({
                    userId: req && req.user && req.user.id ? req.user.id : null,
                    module: 'Call Center',
                    action: 'Queue Reopened',
                    recordId: patientId,
                    previousValue: {
                        serviceDate: newServiceDate,
                        serviceDateHistoryId: history.id
                    },
                    newValue: {
                        serviceDate: previousServiceDate,
                        reason: 'Backoffice deleted Call Center service date history'
                    },
                    ipAddress: req ? requestIp(req) : null
                }, { transaction });
            }
        }
        const logs = await db.AuditLog.findAll({
            where: {
                module: 'Call Center',
                action: 'Service Date Added',
                recordId: patientId
            },
            attributes: ['id', 'newValue'],
            transaction
        });
        logs.forEach((log) => {
            if (!newServiceDate || auditServiceDateValue(log.newValue) === newServiceDate) {
                auditIdsToDelete.push(log.id);
            }
        });
    }

    if (auditIdsToDelete.length) {
        const deletedLogs = await db.AuditLog.destroy({
            where: { id: { [Op.in]: Array.from(new Set(auditIdsToDelete)) } },
            transaction
        });
        result.removedServiceDateAuditLogs = deletedLogs || 0;
    }

    if (patientIds.length && db.CallCenterLock) {
        const deletedLocks = await db.CallCenterLock.destroy({
            where: { patientId: { [Op.in]: patientIds } },
            transaction
        });
        result.removedCallCenterLocks = deletedLocks || 0;
    }

    result.reopenedQueuePatients = reopenedQueuePatientIds.size;
    return result;
}

// DELETE /api/admin/rows — delete specific rows by ID, with cascade/null handling
exports.deleteRows = async (req, res) => {
    const { tableName, ids } = req.body;
    const validKeys = new Set(TABLE_META.map(t => t.key));
    if (!validKeys.has(tableName)) return res.status(400).json({ error: `Unknown table: ${tableName}` });
    if (!ids || !ids.length) return res.status(400).json({ error: 'No IDs provided.' });

    const idList = Array.from(new Set(ids.map(id => parseInt(id, 10)).filter(n => !isNaN(n))));
    if (!idList.length) return res.status(400).json({ error: 'No valid IDs.' });

    const children = FK_CHILDREN[tableName] || [];
    const t = await db.sequelize.transaction();
    const results = { deleted: 0, cascaded: {}, nulled: {} };

    try {
        // Lock and validate every requested row before touching dependencies. This
        // prevents a misleading success response when IDs are stale or incorrect.
        const targets = await db.sequelize.query(
            `SELECT id FROM "${tableName}" WHERE id IN (:ids) FOR UPDATE`,
            { type: QueryTypes.SELECT, replacements: { ids: idList }, transaction: t }
        );
        if (targets.length !== idList.length) {
            await t.rollback();
            return res.status(404).json({
                error: `Delete aborted: requested ${idList.length} row(s), but found ${targets.length}. Nothing was deleted.`
            });
        }

        if (tableName === 'PatientServiceDateHistories') {
            results.callCenterQueueRepair = await prepareServiceDateHistoryDelete(idList, t, req);
        }

        // Handle children first (list is ordered: grandchildren before direct children)
        for (const child of children) {
            if (child.action === 'cascade') {
                let sql;
                if (child.via) {
                    // Grandchild: child.col references child.via table, not the parent directly
                    // e.g. RXHistories.rxRecordId -> RXRecords (where patientId IN (:ids))
                    // Find the FK column that links child.via back to tableName
                    const viaChildren = FK_CHILDREN[tableName] || [];
                    const viaLink = viaChildren.find(c => c.table === child.via && !c.via);
                    if (viaLink) {
                        sql = `DELETE FROM "${child.table}" WHERE "${child.col}" IN (SELECT id FROM "${child.via}" WHERE "${viaLink.col}" IN (:ids))`;
                    } else {
                        // Fallback: skip (shouldn't happen with correct FK_CHILDREN config)
                        continue;
                    }
                } else {
                    sql = `DELETE FROM "${child.table}" WHERE "${child.col}" IN (:ids)`;
                }
                const rows = await db.sequelize.query(
                    sql + ' RETURNING id',
                    { type: QueryTypes.SELECT, replacements: { ids: idList }, transaction: t }
                );
                results.cascaded[child.table] = (results.cascaded[child.table] || 0) + rows.length;
            } else if (child.action === 'null') {
                await db.sequelize.query(
                    `UPDATE "${child.table}" SET "${child.col}" = NULL WHERE "${child.col}" IN (:ids)`,
                    { replacements: { ids: idList }, transaction: t }
                );
                results.nulled[child.table] = child.col;
            }
        }

        // Delete main rows
        const deleted = await db.sequelize.query(
            `DELETE FROM "${tableName}" WHERE id IN (:ids) RETURNING id`,
            { type: QueryTypes.SELECT, replacements: { ids: idList }, transaction: t }
        );
        results.deleted = deleted.length;

        if (results.deleted !== idList.length) {
            throw new Error(`Delete verification failed: expected ${idList.length} row(s), deleted ${results.deleted}.`);
        }

        const remaining = await db.sequelize.query(
            `SELECT id FROM "${tableName}" WHERE id IN (:ids)`,
            { type: QueryTypes.SELECT, replacements: { ids: idList }, transaction: t }
        );
        if (remaining.length) {
            throw new Error(`Delete verification failed: ${remaining.length} target row(s) still exist.`);
        }

        await t.commit();

        // Audit log
        try {
            const auditNow = new Date();
            await db.AuditLog.create({
                userId: req.user?.id || null,
                date: auditNow,
                time: auditNow.toTimeString().split(' ')[0],
                module: 'Back Office',
                action: 'BACKOFFICE_ROW_DELETE',
                recordId: idList.length === 1 ? idList[0] : null,
                previousValue: {
                    tableName: tableName,
                    ids: idList
                },
                newValue: {
                    deleted: results.deleted,
                    cascaded: results.cascaded,
                    nulled: results.nulled
                },
                ipAddress: req.ip
            });
        } catch(e) { /* non-fatal */ }

        res.json({ success: true, results });
    } catch (err) {
        await t.rollback();
        res.status(500).json({ error: err.message });
    }
};

// --------------------------------------------------------------------------
// ERROR LOG MANAGER
// --------------------------------------------------------------------------
exports.getErrorLogs = async (req, res) => {
    const page     = Math.max(1, parseInt(req.query.page || '1', 10));
    const rawSize  = parseInt(req.query.size || '50', 10);
    // Allow large exports (size >= 9999 is the export signal) — cap at 10000
    const pageSize = rawSize >= 9999 ? Math.min(rawSize, 10000) : Math.min(200, Math.max(10, rawSize));
    const offset   = (page - 1) * pageSize;
    const severity = req.query.severity || '';
    const source   = req.query.source   || '';
    const resolved = req.query.resolved;
    const search   = req.query.search   || '';
    const dateFrom = req.query.dateFrom || '';
    const dateTo   = req.query.dateTo   || '';

    const where = ['1=1'];
    const rep   = { limit: pageSize, offset };

    if (severity) { where.push(`el."severity" = :severity`); rep.severity = severity; }
    if (source)   { where.push(`el."source" = :source`);     rep.source   = source; }
    if (resolved !== undefined && resolved !== '') { where.push(`el."resolved" = :resolved`); rep.resolved = resolved === 'true'; }
    if (search)   { where.push(`(el."message" ILIKE :search OR el."url" ILIKE :search OR el."stack" ILIKE :search)`); rep.search = '%' + search + '%'; }
    if (dateFrom) { where.push(`el."createdAt" >= :dateFrom`); rep.dateFrom = dateFrom; }
    if (dateTo)   { where.push(`el."createdAt" <= :dateTo`);   rep.dateTo   = dateTo + ' 23:59:59'; }

    const wc = where.join(' AND ');
    try {
        const [countRow] = await db.sequelize.query(
            `SELECT COUNT(*) AS total FROM "ErrorLogs" el WHERE ${wc}`,
            { type: QueryTypes.SELECT, replacements: rep }
        );
        const total = parseInt(countRow.total, 10);

        const rows = await db.sequelize.query(`
            SELECT el.id, el."source", el."severity", el."message", el."stack",
                   el."url", el."userAgent", el."ipAddress", el."resolved", el."createdAt",
                   el."userId", u."username", u."firstName", u."lastName"
            FROM "ErrorLogs" el
            LEFT JOIN "Users" u ON u.id = el."userId"
            WHERE ${wc}
            ORDER BY el."createdAt" DESC
            LIMIT :limit OFFSET :offset
        `, { type: QueryTypes.SELECT, replacements: rep });

        // Summary stats
        const stats = await db.sequelize.query(`
            SELECT
                COUNT(*) FILTER (WHERE severity = 'error')   AS errors,
                COUNT(*) FILTER (WHERE severity = 'warning') AS warnings,
                COUNT(*) FILTER (WHERE severity = 'info')    AS infos,
                COUNT(*) FILTER (WHERE resolved = true)      AS resolved,
                COUNT(*) FILTER (WHERE resolved = false)     AS unresolved,
                COUNT(*) FILTER (WHERE source = 'frontend')  AS frontend,
                COUNT(*) FILTER (WHERE source = 'backend')   AS backend
            FROM "ErrorLogs"
        `, { type: QueryTypes.SELECT });

        res.json({ rows, total, page, pageSize, pages: Math.ceil(total / pageSize), stats: stats[0] });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.resolveErrorLogs = async (req, res) => {
    const { ids } = req.body; // array or 'all'
    try {
        if (ids === 'all') {
            await db.sequelize.query(`UPDATE "ErrorLogs" SET "resolved" = true`, { type: QueryTypes.UPDATE });
            res.json({ success: true, message: 'All marked resolved.' });
        } else if (Array.isArray(ids) && ids.length) {
            await db.sequelize.query(
                `UPDATE "ErrorLogs" SET "resolved" = true WHERE id = ANY(:ids)`,
                { replacements: { ids }, type: QueryTypes.UPDATE }
            );
            res.json({ success: true, message: `${ids.length} error(s) marked resolved.` });
        } else {
            res.status(400).json({ error: 'No IDs provided.' });
        }
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.purgeErrorLogs = async (req, res) => {
    const { mode, olderThanDays, severity, source, resolvedOnly, ids } = req.body;
    try {
        let deleted = 0;
        if (mode === 'ids' && Array.isArray(ids) && ids.length) {
            const [r] = await db.sequelize.query(
                `DELETE FROM "ErrorLogs" WHERE id = ANY(:ids) RETURNING id`,
                { replacements: { ids }, type: QueryTypes.SELECT }
            );
            deleted = Array.isArray(r) ? r.length : (r?.length || ids.length);
        } else if (mode === 'age' && olderThanDays > 0) {
            const where = [`"createdAt" < NOW() - INTERVAL '${parseInt(olderThanDays,10)} days'`];
            if (severity)     where.push(`"severity" = '${severity.replace(/'/g,"''")}'`);
            if (source)       where.push(`"source" = '${source.replace(/'/g,"''")}'`);
            if (resolvedOnly) where.push(`"resolved" = true`);
            const [r] = await db.sequelize.query(
                `DELETE FROM "ErrorLogs" WHERE ${where.join(' AND ')} RETURNING id`,
                { type: QueryTypes.SELECT }
            );
            deleted = Array.isArray(r) ? r.length : 0;
        } else if (mode === 'filter') {
            const where = ['1=1'];
            const rep = {};
            if (severity)       { where.push(`"severity" = :severity`);   rep.severity = severity; }
            if (source)         { where.push(`"source" = :source`);       rep.source   = source; }
            if (resolvedOnly)   { where.push(`"resolved" = true`); }
            const [r] = await db.sequelize.query(
                `DELETE FROM "ErrorLogs" WHERE ${where.join(' AND ')} RETURNING id`,
                { replacements: rep, type: QueryTypes.SELECT }
            );
            deleted = Array.isArray(r) ? r.length : 0;
        } else if (mode === 'all') {
            const [r] = await db.sequelize.query(`DELETE FROM "ErrorLogs" RETURNING id`, { type: QueryTypes.SELECT });
            deleted = Array.isArray(r) ? r.length : 0;
        } else {
            return res.status(400).json({ error: 'Invalid purge mode.' });
        }
        res.json({ success: true, deleted });
    } catch (e) { res.status(500).json({ error: e.message }); }
};


