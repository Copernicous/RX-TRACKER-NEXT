'use strict';

const db = require('../models');
const { QueryTypes } = require('sequelize');
const fileArchives = require('./backofficeFileArchive');
const KEY = 'history_archive_policy_v1';
const LAST = 'history_archive_last_run_v1';
const LOCK = 7261030;
const BATCH_SIZE = 250;
const batchLimit = kind => kind === 'corrections' ? 1 : kind === 'imports' ? 10 : BATCH_SIZE;
const TYPES = Object.freeze({
    audit: { table: 'AuditLogs', model: 'AuditLog', date: 'createdAt', label: 'Audit events',
        eligible: `COALESCE("module", '') NOT IN ('Data Import', 'History Archive')
          AND COALESCE("module", '') NOT ILIKE 'Call Center%'
          AND COALESCE("action", '') <> 'Called'
          AND NOT EXISTS (SELECT 1 FROM "CallCenterCallAttempts" c WHERE c."calledAuditLogId" = s.id)` },
    imports: { table: 'AuditLogs', model: 'AuditLog', date: 'createdAt', label: 'Completed import reports',
        eligible: `"module" = 'Data Import' AND "action" = 'Patient import report'` },
    corrections: { table: 'AuditLogs', model: 'AuditLog', date: 'createdAt', label: 'Completed correction files',
        eligible: `"module" = 'Data Import' AND "action" = 'Patient import correction file'
          AND jsonb_typeof("newValue"::jsonb->'items') = 'array'
          AND NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(s."newValue"::jsonb->'items') = 'array' THEN s."newValue"::jsonb->'items' ELSE '[]'::jsonb END) item
            WHERE NOT EXISTS (SELECT 1 FROM "AuditLogs" r WHERE r."recordId" = s.id AND r."userId" = s."userId"
              AND r."module" = 'Data Import' AND r."action" = 'Patient import correction resolved'
              AND (r."newValue"::jsonb->'itemIds') @> jsonb_build_array(item->>'itemId')))
          AND NOT EXISTS (SELECT 1 FROM "AuditLogs" r WHERE r."recordId" = s.id AND r."module" = 'Data Import'
            AND r."action" IN ('Patient import correction revision', 'Patient import correction resolved')
            AND (r."createdAt" >= :cutoff OR r."updatedAt" >= :cutoff))
          AND (SELECT COUNT(*) FROM "AuditLogs" r WHERE r."recordId" = s.id AND r."module" = 'Data Import'
            AND r."action" IN ('Patient import correction revision', 'Patient import correction resolved')) < ${BATCH_SIZE}` },
    activity: { table: 'UserActivityLogs', model: 'UserActivityLog', date: 'visitedAt', label: 'Page activity', eligible: 'TRUE' },
    errors: { table: 'ErrorLogs', model: 'ErrorLog', date: 'createdAt', label: 'Resolved errors', eligible: '"resolved" = TRUE' },
    ...fileArchives.TYPES
});
const defaults = () => ({ automatic: false, hourUTC: 6, types: Object.fromEntries(Object.keys(TYPES).map(k => [k, { enabled: true, days: 30 }])) });
function bad(message) { const e = Error(message); e.status = 400; throw e; }
function days(value) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 3650) bad('Retention must be a whole number from 1 to 3650 days.');
    return value;
}
function typeOf(kind) { if (!Object.hasOwn(TYPES, kind)) bad('Unknown archive section.'); return TYPES[kind]; }
function validatePolicy(input) {
    if (!input || typeof input.automatic !== 'boolean' || !Number.isInteger(input.hourUTC) || input.hourUTC < 0 || input.hourUTC > 23) bad('Choose automatic archiving and an hour from 0 to 23 UTC.');
    if (!input.types || Object.keys(input.types).some(k => !Object.hasOwn(TYPES, k))) bad('Invalid archive sections.');
    const types = {};
    for (const kind of Object.keys(TYPES)) {
        const p = input.types[kind];
        if (!p || typeof p.enabled !== 'boolean') bad('Each section requires an enabled setting.');
        types[kind] = { enabled: p.enabled, days: days(p.days) };
    }
    return { automatic: input.automatic, hourUTC: input.hourUTC, types };
}
async function policy(transaction) {
    const row = await db.SystemSetting.findOne({ where: { key: KEY }, raw: true, ...(transaction ? { transaction } : {}) });
    if (!row) return defaults();
    const stored = JSON.parse(row.value);
    // Additional adapters must not silently enable themselves in a saved policy.
    for (const kind of Object.keys(TYPES)) if (stored.types && !stored.types[kind]) stored.types[kind] = { enabled: false, days: 30 };
    return validatePolicy(stored);
}
async function receipt(action, value, actorId, transaction) {
    await db.AuditLog.create({ userId: actorId || null, module: 'History Archive', action, newValue: value,
        date: new Date().toISOString().slice(0, 10), time: new Date().toISOString().slice(11, 19) }, { transaction });
}
async function savePolicy(input, actorId) {
    const value = validatePolicy(input);
    await db.sequelize.transaction(async transaction => {
        await db.sequelize.query('SELECT pg_advisory_xact_lock(:key)', { replacements: { key: LOCK }, transaction });
        await db.SystemSetting.upsert({ key: KEY, value: JSON.stringify(value), description: 'History archive retention and daily UTC schedule' }, { transaction });
        await receipt('Archive policy changed', value, actorId, transaction);
    });
    return value;
}
function cutoffFor(retention, now = new Date()) {
    return new Date(now.getTime() - days(retention) * 86400000);
}
function predicate(type) {
    return `s."${type.date}" < :cutoff AND s."createdAt" < :cutoff AND s."updatedAt" < :cutoff AND (${type.eligible})`;
}
async function preview(kind, retention, now = new Date()) {
    const type = typeOf(kind), cutoff = cutoffFor(retention, now);
    if (type.file) return fileArchives.preview(kind, retention, now);
    const [row] = await db.sequelize.query(`SELECT COUNT(*)::bigint AS count, MIN(s."${type.date}") AS oldest, MAX(s."${type.date}") AS newest
        FROM "${type.table}" s WHERE ${predicate(type)}`, { replacements: { cutoff }, type: QueryTypes.SELECT });
    return { kind, days: retention, cutoff: cutoff.toISOString(), eligible: Number(row.count), oldest: row.oldest, newest: row.newest };
}
async function batch(kind, retention, actorId, now, automatic) {
    const type = typeOf(kind), cutoff = cutoffFor(retention, now);
    return db.sequelize.transaction(async transaction => {
        await db.sequelize.query("SET LOCAL lock_timeout = '3s'", { transaction });
        await db.sequelize.query("SET LOCAL statement_timeout = '30s'", { transaction });
        const [lock] = await db.sequelize.query('SELECT pg_try_advisory_xact_lock(:key) AS locked', { replacements: { key: LOCK }, transaction, type: QueryTypes.SELECT });
        if (!lock.locked) { const e = Error('Another archive operation is running.'); e.status = 409; throw e; }
        if (automatic) {
            const current = await policy(transaction);
            if (!current.automatic || !current.types[kind].enabled || current.types[kind].days !== retention) return 0;
        }
        const selected = await db.sequelize.query(`SELECT s.id FROM "${type.table}" s WHERE ${predicate(type)}
            ORDER BY s."${type.date}", s.id LIMIT ${batchLimit(kind)} FOR UPDATE OF s SKIP LOCKED`, { replacements: { cutoff }, transaction, type: QueryTypes.SELECT });
        if (!selected.length) return 0;
        let ids = selected.map(row => row.id);
        if (kind === 'corrections') {
            const events = await db.sequelize.query(`SELECT r.id FROM "AuditLogs" r WHERE r."recordId" IN (:ids)
                AND r."module" = 'Data Import' AND r."action" IN ('Patient import correction revision', 'Patient import correction resolved')
                ORDER BY r.id FOR UPDATE OF r`, { replacements: { ids }, transaction, type: QueryTypes.SELECT });
            ids = [...ids, ...events.map(r => r.id)];
            if (ids.length > BATCH_SIZE) throw Error('Correction history exceeds the bounded transfer size; active records retained.');
        }
        const replacements = { ids };
        // Copy, compare all fields (including JSON), then remove precisely those
        // locked rows. Every operation and the receipt share one DB transaction.
        await db.sequelize.query(`INSERT INTO "${type.table}Archive" SELECT s.* FROM "${type.table}" s WHERE s.id IN (:ids)`, { replacements, transaction });
        const [verified] = await db.sequelize.query(`SELECT COUNT(*)::int AS count FROM "${type.table}" s
            JOIN "${type.table}Archive" a USING (id) WHERE s.id IN (:ids) AND to_jsonb(s) = to_jsonb(a)`, { replacements, transaction, type: QueryTypes.SELECT });
        if (verified.count !== ids.length) throw Error('Archive verification failed; active rows retained.');
        const removed = await db.sequelize.query(`DELETE FROM "${type.table}" WHERE id IN (:ids) RETURNING id`, { replacements, transaction, type: QueryTypes.SELECT });
        if (removed.length !== ids.length) throw Error('Archive transfer count mismatch; transaction rolled back.');
        await receipt('History archived', { kind, days: retention, cutoff: cutoff.toISOString(), count: ids.length, storage: type.table + 'Archive', verified: true }, actorId, transaction);
        return ids.length;
    });
}
async function run(kind, retention, actorId, options = {}) {
    const type = typeOf(kind); days(retention);
    if (type.file) return db.sequelize.transaction(async transaction => {
        const [lock] = await db.sequelize.query('SELECT pg_try_advisory_xact_lock(:key) AS locked', { replacements: { key: LOCK }, transaction, type: QueryTypes.SELECT });
        if (!lock.locked) { const e = Error('Another archive operation is running.'); e.status = 409; throw e; }
        if (options.automatic) {
            const current = await policy(transaction);
            if (!current.automatic || !current.types[kind].enabled || current.types[kind].days !== retention) return { kind, count: 0 };
        }
        const result = await fileArchives.run(kind, retention, options.now || new Date());
        if (result.count) await receipt('Files compressed', { kind, count: result.count, days: retention, cutoff: result.cutoff, verified: true }, actorId, transaction);
        return result;
    });
    const now = options.now || new Date();
    let count = 0;
    // Bounded work: at most 2,500 rows per section per invocation.
    for (let i = 0; i < 10; i++) {
        const n = await batch(kind, retention, actorId, now, options.automatic);
        count += n;
        if (!n || (kind !== 'corrections' && n < batchLimit(kind))) break;
    }
    return { kind, count, cutoff: cutoffFor(retention, now).toISOString(), message: `${count} older records archived. Recent and protected records retained.` };
}
async function status() {
    const value = await policy();
    const sections = [];
    for (const [kind, type] of Object.entries(TYPES)) {
        const result = await preview(kind, value.types[kind].days);
        if (type.file) { sections.push({ ...result, label: type.label, storage: type.location, file: true }); continue; }
        // Audit and import totals share a physical table; label counts by section.
        const where = kind === 'imports' ? `WHERE "module" = 'Data Import' AND "action" = 'Patient import report'`
            : kind === 'corrections' ? `WHERE "module" = 'Data Import' AND "action" = 'Patient import correction file'`
            : kind === 'audit' ? `WHERE COALESCE("module", '') <> 'Data Import'` : '';
        const [counts] = await db.sequelize.query(`SELECT (SELECT COUNT(*) FROM "${type.table}" ${where})::bigint AS active,
            (SELECT COUNT(*) FROM "${type.table}Archive" ${where})::bigint AS archived`, { type: QueryTypes.SELECT });
        sections.push({ ...result, label: type.label, storage: type.table + 'Archive', active: Number(counts.active), archived: Number(counts.archived) });
    }
    const last = await db.SystemSetting.findOne({ where: { key: LAST }, raw: true });
    return { policy: value, sections, lastRun: last ? JSON.parse(last.value) : null, databaseStorage: true, schedulerEnabled: process.env.HISTORY_ARCHIVE_SCHEDULER_ENABLED !== 'false',
        automaticEffective: value.automatic && process.env.HISTORY_ARCHIVE_SCHEDULER_ENABLED !== 'false' };
}
let timer;
async function tick(now = new Date()) {
    if (process.env.HISTORY_ARCHIVE_SCHEDULER_ENABLED === 'false') return;
    const value = await policy();
    if (!value.automatic || now.getUTCHours() < value.hourUTC) return;
    const day = now.toISOString().slice(0, 10);
    // A persisted daily claim prevents overlapping processes/restarts from
    // repeatedly archiving the same day's backlog. Failure is visible, retry manual.
    const claimed = await db.sequelize.transaction(async transaction => {
        await db.sequelize.query('SELECT pg_advisory_xact_lock(:key)', { replacements: { key: LOCK }, transaction });
        const row = await db.SystemSetting.findOne({ where: { key: LAST }, transaction, raw: true });
        if (row && JSON.parse(row.value).day === day) return false;
        await db.SystemSetting.upsert({ key: LAST, value: JSON.stringify({ day, startedAt: now.toISOString(), state: 'running' }) }, { transaction });
        return true;
    });
    if (!claimed) return;
    const result = { day, startedAt: now.toISOString(), state: 'complete', sections: [] };
    try {
        for (const kind of Object.keys(TYPES)) if (value.types[kind].enabled) result.sections.push(await run(kind, value.types[kind].days, null, { now, automatic: true }));
    } catch (e) {
        result.state = 'failed';
        result.error = 'Archive job did not complete. Committed batches remain archived; uncommitted batches retain active rows. Review server error logs and retry.';
        console.error('[History Archive] Scheduled job failed:', e.name);
    }
    result.finishedAt = new Date().toISOString();
    await db.SystemSetting.upsert({ key: LAST, value: JSON.stringify(result) });
}
function startScheduler() {
    if (timer || process.env.HISTORY_ARCHIVE_SCHEDULER_ENABLED === 'false') return;
    timer = setInterval(() => tick().catch(e => console.error('[History Archive] Scheduler unavailable:', e.name)), 60000);
    timer.unref();
}
function stopScheduler() { if (timer) clearInterval(timer); timer = null; }
module.exports = { TYPES, defaults, days, validatePolicy, cutoffFor, policy, savePolicy, preview, run, status, tick, startScheduler, stopScheduler };
