'use strict';
const assert = require('node:assert/strict');
const safeTarget = process.env.DB_HOST === '127.0.0.1' &&
    ((process.env.DB_PORT === '55441' && process.env.DB_NAME === 'rx_history_archive_test') ||
     (process.env.RX_LOCAL_RELEASE_TEST === '1' && process.env.DB_NAME === 'rx_next_ci_archive_test'));
if (!safeTarget) throw Error('Requires a dedicated disposable archive test database on loopback.');
process.env.IMPORT_REVIEW_V2 = 'true';
process.env.HISTORY_ARCHIVE_SCHEDULER_ENABLED = 'true';
const db = require('../models');
const service = require('../services/historyArchiveService');
const controller = require('../controllers/historyArchiveController');
const auditController = require('../controllers/auditLogController');
const imports = require('../controllers/importController');
const admin = require('../controllers/adminController');
const retained = require('../utils/retainedImportFile');
const { sourceModel } = require('../utils/historySource');
const { assertDatabaseReady } = require('../db/schema-verifier');
const { createBusinessFingerprint } = require('../db/business-fingerprint');
const { gunzipSync } = require('zlib');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
let checks = 0;
const pass = message => { checks++; console.log('PASS ' + message); };
async function response(method, req) {
    let body, status = 200; const headers = {};
    await method({ query: {}, params: {}, body: {}, ...req }, { set(k,v) { headers[k] = v; }, setHeader(k,v) { headers[k] = v; },
        status(n) { status = n; return this; }, json(value) { body = value; }, send(value) { body = value; } });
    return { body, status, headers };
}
async function main() {
    await assertDatabaseReady(db); pass('fresh schema and checksummed migration ready');
    await db.sequelize.query('TRUNCATE "AuditLogs", "AuditLogsArchive", "ErrorLogs", "ErrorLogsArchive", "UserActivityLogs", "UserActivityLogsArchive" RESTART IDENTITY CASCADE');
    await db.SystemSetting.destroy({ where: { key: ['history_archive_policy_v1', 'history_archive_last_run_v1'] } });
    assert.equal((await service.policy()).types.imports.days, 30);
    for (const value of [-1, 0, 1.5, '30', '30junk', null, 3651]) await assert.rejects(service.run('audit', value, null), /Retention/);
    assert.throws(() => sourceModel(db, 'AuditLog', 'invalid'), /source/);
    assert.throws(() => service.validatePolicy({ ...service.defaults(), hourUTC: 24 }), /hour/);
    pass('30-day defaults and strict invalid retention/source/schedule rejection');
    const now = new Date(), cutoff = service.cutoffFor(30, now);
    const old = new Date(cutoff.getTime() - 1000), recent = new Date(cutoff.getTime() + 60000);
    const role = await db.Role.findOne({ where: { name: 'Administrator' } });
    const user = await db.User.create({ username: 'ARCHIVE-' + Date.now(), firstName: 'Synthetic', lastName: 'Archive', roleId: role.id, passwordHash: 'not-a-login', isActive: true });
    const reqUser = { id: user.id, role: 'Administrator', roleId: role.id };
    const businessBefore = await createBusinessFingerprint(db);
    const audit = values => db.AuditLog.create({ userId: user.id, module: 'Patients', action: 'Update', previousValue: { a: 'before', nested: [1, null] }, newValue: { a: 'after' }, createdAt: old, updatedAt: old, ...values }, { silent: true });
    const first = await audit({}), boundary = await audit({ createdAt: cutoff, updatedAt: cutoff }), newer = await audit({ createdAt: recent, updatedAt: recent });
    const called = await audit({ module: 'Call Center', action: 'Called' });
    const pending = await audit({ module: 'Data Import', action: 'Patient import correction file', newValue: { items: [{ itemId: 'pending' }] } });
    const bytes = Buffer.from('patientCode,firstName\r\nSYNTHETIC,Archive\r\n');
    const upload = retained.capture({ originalname: 'synthetic.csv', buffer: bytes });
    const report = await audit({ module: 'Data Import', action: 'Patient import report', newValue: { fileName: 'synthetic.csv', createdCount: 1, rows: [{ original: 'synthetic evidence' }], hasUploadedFile: true, sourceFile: upload, uploadedFile: upload } });
    const original = JSON.stringify(first.toJSON());
    const allBefore = await db.AuditLogHistory.count();
    let result = await service.run('audit', 30, user.id, { now });
    assert.equal(result.count, 1);
    assert.equal(await db.AuditLog.findByPk(first.id), null);
    assert.deepEqual(JSON.parse(JSON.stringify((await db.AuditLogArchive.findByPk(first.id)).toJSON())), JSON.parse(original));
    for (const row of [boundary, newer, called, pending, report]) assert(await db.AuditLog.findByPk(row.id));
    assert.equal(await db.AuditLogHistory.count(), allBefore + 1); // receipt
    pass('strict cutoff, byte-equivalent JSON preservation, protected call/correction/import rows and complete history counts');
    assert.equal((await service.run('imports', 30, user.id, { now })).count, 1);
    const detail = await response(imports.getPatientReport, { params: { id: report.id }, user: reqUser });
    assert.equal(detail.status, 200); assert.equal(detail.body.rows[0].original, 'synthetic evidence');
    const download = await response(imports.downloadUploadedFile, { params: { id: report.id }, user: reqUser });
    assert.equal(download.status, 200); assert(download.body.equals(bytes));
    const listed = await response(imports.listPatientReports, { query: { historySource: 'archived' }, user: reqUser });
    assert(listed.body.reports.some(r => r.id === report.id));
    pass('archived import list/detail and original uploaded CSV remain available without reinsertion');
    const correction = await audit({ module: 'Data Import', action: 'Patient import correction file', newValue: { fileName: 'synthetic.csv', headers: ['firstName'], items: [{ itemId: 'complete', values: { firstName: 'Synthetic' } }], sourceFile: upload } });
    const revision = await audit({ module: 'Data Import', action: 'Patient import correction revision', recordId: correction.id, newValue: { items: [{ itemId: 'complete', error: 'Synthetic corrected' }] } });
    const resolution = await audit({ module: 'Data Import', action: 'Patient import correction resolved', recordId: correction.id, newValue: { itemIds: ['complete'], reportId: report.id } });
    assert.equal((await service.run('corrections', 30, user.id, { now })).count, 3);
    for (const row of [correction, revision, resolution]) { assert.equal(await db.AuditLog.findByPk(row.id), null); assert(await db.AuditLogArchive.findByPk(row.id)); }
    assert(await db.AuditLog.findByPk(pending.id));
    const corrected = await response(imports.listCorrectionFiles, { query: { historySource: 'archived' }, user: reqUser });
    assert.equal(corrected.status, 200); assert.equal(corrected.body.files[0].pendingCount, 0);
    const originalCorrection = await response(imports.downloadCorrectionOriginalFile, { params: { id: correction.id }, user: reqUser });
    assert(originalCorrection.body.equals(bytes));
    pass('fully resolved correction groups move together, preserve completion links and original CSV; pending files stay active');
    const oldError = await db.ErrorLog.create({ source: 'backend', message: 'synthetic resolved', stack: 'synthetic stack', resolved: true, createdAt: old, updatedAt: old }, { silent: true });
    const openError = await db.ErrorLog.create({ message: 'synthetic open', resolved: false, createdAt: old, updatedAt: old }, { silent: true });
    const recentResolution = await db.ErrorLog.create({ message: 'recent resolution', resolved: true, createdAt: old, updatedAt: recent }, { silent: true });
    const activity = await db.UserActivityLog.create({ userId: user.id, usernameSnapshot: user.username, pagePath: '/patients', visitedAt: old, createdAt: old, updatedAt: old }, { silent: true });
    assert.equal((await service.run('errors', 30, user.id, { now })).count, 1);
    assert(await db.ErrorLogArchive.findByPk(oldError.id)); assert(await db.ErrorLog.findByPk(openError.id)); assert(await db.ErrorLog.findByPk(recentResolution.id));
    assert.equal((await service.run('activity', 30, user.id, { now })).count, 1);
    assert(await db.UserActivityLogHistory.findByPk(activity.id));
    pass('resolved errors/activity archived; unresolved and recently modified errors protected');
    const backofficeError = await db.ErrorLog.create({ message: 'resolved through Backoffice', resolved: false, createdAt: old, updatedAt: old }, { silent: true });
    let resolved = await response(admin.resolveErrorLogs, { body: { ids: [backofficeError.id, oldError.id] } });
    assert.equal(resolved.body.resolved, 1); assert.equal(resolved.body.ignored, 1);
    await backofficeError.reload(); assert(backofficeError.updatedAt > recent);
    assert.equal((await service.run('errors', 30, user.id, { now })).count, 0);
    assert.equal((await response(admin.resolveErrorLogs, { body: { ids: [oldError.id] } })).body.resolved, 0);
    await db.ErrorLog.create({ message: 'resolve all fixture', resolved: false, createdAt: old, updatedAt: old }, { silent: true });
    resolved = await response(admin.resolveErrorLogs, { body: { ids: 'all' } }); assert(resolved.body.resolved >= 1);
    assert.equal((await service.run('errors', 30, user.id, { now })).count, 0);
    const archivedErrors = await response(admin.getErrorLogs, { query: { historySource: 'archived' } });
    assert.equal(archivedErrors.status, 200); assert(archivedErrors.body.rows.every(row => row.storage === 'archived'));
    const archivedAudit = await response(admin.getAuditLogs, { query: { historySource: 'archived' } });
    assert.equal(archivedAudit.status, 200); assert(archivedAudit.body.rows.length); assert(archivedAudit.body.rows.every(row => row.storage === 'archived'));
    assert.equal((await response(admin.getAuditLogs, { query: { historySource: 'invalid' } })).status, 400);
    const pagedTable = await response(admin.getTableData, { params: { tableName: 'AuditLogs' }, query: { size: '1', page: '2', search: 'History' } });
    assert.equal(pagedTable.status, 200); assert(pagedTable.body.rows.length <= 1); assert(pagedTable.body.total >= 1);
    assert.equal((await response(admin.getTableData, { params: { tableName: 'AuditLogs"; DROP TABLE "Patients";--' }, query: {} })).status, 400);
    assert.equal((await response(admin.getTableData, { params: { tableName: 'AuditLogs' }, query: { size: '1', sort: 'id"; DROP TABLE "Patients";--', direction: 'ASC; DELETE' } })).status, 200);
    pass('Backoffice resolution timestamps/counts, archived read-only scopes, trusted query identifiers and bounded raw-table pagination');
    const snapshotSettings = require('../utils/globalSettings'), savedSettingsReader = snapshotSettings.readSettings;
    const snapshotRoot = path.resolve('output/backoffice-snapshot-integration-' + Date.now());
    snapshotSettings.readSettings = () => ({ backupPath: snapshotRoot });
    try {
        const snapshot = await response(admin.createBackup, { user: reqUser });
        assert.equal(snapshot.status, 200, JSON.stringify(snapshot.body));
        assert(snapshot.body.files.some(file => file.table === 'AuditLogsArchive' && file.rows > 0));
        assert(snapshot.body.files.some(file => file.table === 'ErrorLogsArchive' && file.rows > 0));
    } finally { snapshotSettings.readSettings = savedSettingsReader; fs.rmSync(snapshotRoot, { recursive: true, force: true }); }
    pass('real PostgreSQL read-only CSV cursors preserve archived tables in bounded snapshot exports');


    const doomed = await audit({ action: 'Rollback test' });
    const create = db.AuditLog.create;
    db.AuditLog.create = function(value, options) { if (value.module === 'History Archive') throw Error('injected receipt failure'); return create.call(this, value, options); };
    try { await assert.rejects(service.run('audit', 30, user.id, { now }), /injected/); }
    finally { db.AuditLog.create = create; }
    assert(await db.AuditLog.findByPk(doomed.id)); assert.equal(await db.AuditLogArchive.findByPk(doomed.id), null);
    pass('failure after copy/delete rolls back both stores and retains active source');
    await db.sequelize.transaction(async transaction => {
        await db.sequelize.query('SELECT pg_advisory_xact_lock(7261030)', { transaction });
        await assert.rejects(service.run('audit', 30, user.id, { now }), e => e.status === 409);
    });
    pass('concurrent-operation lock rejects overlapping transfers');
    const packet = await response(controller.download, { params: { kind: 'imports' }, user: reqUser });
    const decoded = JSON.parse(gunzipSync(packet.body));
    assert.equal(decoded.manifest.count, 1);
    assert.equal(crypto.createHash('sha256').update(JSON.stringify(decoded.records)).digest('hex'), decoded.manifest.sha256);
    assert.equal(decoded.records[0].newValue.sourceFile.content, upload.content);
    const numbered = await response(controller.pages, { params: { kind: 'imports' }, user: reqUser });
    assert.equal(numbered.status, 200); assert.equal(numbered.body.totalPages, 1); assert.equal(numbered.body.totalRecords, 1);
    assert.equal(numbered.body.pages[0].dateFrom, old.toISOString());
    assert.equal(numbered.body.pages[0].dateTo, old.toISOString());
    const numberedDownload = await response(controller.download, { params: { kind: 'imports' }, query: { page: '1', revision: numbered.body.revision }, user: reqUser });
    assert.equal(numberedDownload.status, 200);
    assert.equal(JSON.parse(gunzipSync(numberedDownload.body)).manifest.page, 1);
    assert.equal(JSON.parse(gunzipSync(numberedDownload.body)).manifest.dateFrom, old.toISOString());
    assert.equal((await response(controller.pages, { params: { kind: 'imports' }, query: { page: '2' }, user: reqUser })).status, 400);
    await service.run('audit', 30, user.id, { now });
    const changedPage = await response(controller.download, { params: { kind: 'imports' }, query: { after: String(report.id), revision: decoded.manifest.revision }, user: reqUser });
    assert.equal(changedPage.status, 409);
    assert.equal((await response(controller.pages, { params: { kind: 'imports' }, query: { page: '1', revision: numbered.body.revision }, user: reqUser })).status, 409);
    pass('compressed archive export verifies payload/checksum and rejects pages after concurrent archive changes');
    await assert.rejects(db.AuditLogArchive.destroy({ where: { id: first.id } }), /read-only/);
    const oldRead = await response(auditController.getAll, { query: { historySource: 'archived' }, user: reqUser });
    assert.equal(oldRead.status, 200, JSON.stringify(oldRead.body)); assert(oldRead.body.data.some(r => r.id === first.id));
    const nonOwner = await response(imports.getPatientReport, { params: { id: report.id }, user: { id: user.id + 1000, role: 'Driver' } });
    assert.equal(nonOwner.status, 404);
    pass('archive read-only model, history browsing and import-owner permission checks');
    const p = service.defaults(); p.automatic = true; p.hourUTC = 0;
    const automaticCandidate = await audit({ action: 'Automatic archive candidate' });
    await service.savePolicy(p, user.id);
    await service.tick(now);
    assert.equal(await db.AuditLog.findByPk(automaticCandidate.id), null);
    const countAfter = await db.AuditLogHistory.count();
    await service.tick(now);
    assert.equal(await db.AuditLogHistory.count(), countAfter);
    const status = await service.status(); assert.equal(status.lastRun.state, 'complete');
    assert.equal(status.schedulerEnabled, true); assert.equal(status.automaticEffective, true);
    process.env.HISTORY_ARCHIVE_SCHEDULER_ENABLED = 'false';
    try {
        const paused = await service.status();
        assert.equal(paused.policy.automatic, true); assert.equal(paused.schedulerEnabled, false); assert.equal(paused.automaticEffective, false);
        await service.tick(new Date(now.getTime() + 86400000));
        assert.equal((await service.status()).lastRun.day, status.lastRun.day);
    } finally { delete process.env.HISTORY_ARCHIVE_SCHEDULER_ENABLED; }
    db.AuditLog.create = function(value, options) { if (value.module === 'History Archive') throw Error('injected automatic failure'); return create.call(this, value, options); };
    try { await service.tick(new Date(now.getTime() + 86400000)); }
    finally { db.AuditLog.create = create; }
    assert.equal((await service.status()).lastRun.state, 'failed');
    assert(await db.AuditLog.findByPk(boundary.id));
    assert.equal((await createBusinessFingerprint(db)).sha256, businessBefore.sha256);
    pass('persisted daily schedule, visible failure state, rollback and unchanged business-data fingerprint');
    const migration = require('../migrations/20261027000000-create-history-archives');
    await assert.rejects(migration.down(db.sequelize.getQueryInterface()), /returned to active/);
    assert(await db.AuditLogArchive.findByPk(first.id));
    pass('migration rollback refuses to discard populated archives');
    const directory = path.resolve('output/history-archive-validation/technical-fixture-' + Date.now()); fs.mkdirSync(directory, { recursive: true });
    const oldFile = path.join(directory, 'access-2020-01-01.log'), newFile = path.join(directory, 'error-2026-10-27.log');
    fs.writeFileSync(oldFile, 'synthetic historical log'); fs.utimesSync(oldFile, old, old); fs.writeFileSync(newFile, 'recent');
    const technical = require('../services/technicalLogFiles');
    assert.equal(await technical.archiveClosedFiles(directory, 30, [path.basename(newFile)], now), 1);
    assert(fs.existsSync(newFile)); assert(!fs.existsSync(oldFile));
    const archived = fs.readdirSync(path.join(directory, 'archive')).find(f => f.startsWith('access-2020'));
    assert.equal(gunzipSync(fs.readFileSync(path.join(directory, 'archive', archived))).toString(), 'synthetic historical log');
    fs.writeFileSync(oldFile, 'synthetic historical log'); fs.utimesSync(oldFile, old, old);
    fs.writeFileSync(path.join(directory, 'archive', archived), 'synthetic corrupted gzip');
    await assert.rejects(technical.archiveClosedFiles(directory, 30, [path.basename(newFile)], now));
    assert(fs.existsSync(oldFile));
    assert.throws(() => technical.retentionDays('-1'), /LOG_RETENTION/);
    pass('technical file compression readback, recent/open file preservation and retention validation');
    console.log(`PASS ${checks} archive integration scenarios.`);
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(async () => { service.stopScheduler(); await db.sequelize.close(); });
