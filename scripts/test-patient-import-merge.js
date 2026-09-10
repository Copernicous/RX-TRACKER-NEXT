'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { prepareStagingEnv } = require('./lib/staging-env');
if (process.env.CI === 'true') {
    if (process.env.DB_NAME !== 'rx_next_ci_regression_test' || process.env.DB_HOST !== '127.0.0.1') {
        throw Error('CI merge tests require the isolated local regression database.');
    }
} else prepareStagingEnv(); // Refuse a shared production/development target.
const db = require('../models');
const controller = require('../controllers/importController');
const { mergePatch } = require('../utils/patientImportMerge');
const prefix = 'STG-MERGE-' + Date.now() + '-';
let user, editorRole;
const headers = ['patientCode', 'firstName', 'lastName', 'dob', 'phone', 'notes', 'addressLine1', 'city', 'state', 'zipCode', 'serviceDate'];
const csv = rows => Buffer.from([headers.join(','), ...rows.map(row => headers.map(key => '"' + String(row[key] ?? '').replace(/"/g, '""') + '"').join(','))].join('\n'));
async function run(rows, body = {}, denied = false, editor = false) {
    let output, status = 200;
    await controller.importDataset({ params: { dataset: 'patients' }, file: { buffer: csv(rows) },
        body: { reviewMode: 'merge', ...body }, user: denied ? { id: -1 } : { id: user.id, role: editor ? undefined : 'Administrator' }, ip: '127.0.0.1' }, {
        status(code) { status = code; return this; }, json(data) { output = data; }
    });
    return { ...output, status };
}
function decision(row, targetId, fields) { return { row, action: 'merge', targetId, fields }; }
async function submit(rows, decisions, preview) {
    return run(rows, { duplicateReviewToken: preview.reviewToken, reviewDecisions: JSON.stringify(decisions) });
}
async function history(method, id, userId = user.id) {
    let output, status = 200;
    await controller[method]({ params: { id: String(id) }, query: { page: '1' }, user: { id: userId } }, {
        status(code) { status = code; return this; }, setHeader() {}, json(data) { output = data; }
    });
    return { status, ...output };
}
async function cleanup() {
    const patients = await db.Patient.findAll({ where: { patientCode: { [db.Sequelize.Op.like]: prefix + '%' } }, attributes: ['id'], raw: true });
    const ids = patients.map(p => p.id);
    if (ids.length) await db.sequelize.transaction(async transaction => {
        for (const model of ['RXRecord', 'PatientTagAssignment', 'PatientServiceDateHistory', 'PatientServiceDateCycle']) {
            await db[model].destroy({ where: { patientId: ids }, transaction });
        }
        await db.Patient.destroy({ where: { id: ids }, transaction });
    });
    if (user) {
        await db.AuditLog.destroy({ where: { userId: user.id } });
        await db.User.destroy({ where: { id: user.id } });
    }
    if (editorRole) await db.Role.destroy({ where: { id: editorRole.id } });
}
async function main() {
    editorRole = await db.Role.create({ name: prefix + 'EDITOR', isSystem: false,
        permissions: { patients: { visible: true, canEdit: true, canOverrideExpired: false } } });
    user = await db.User.create({ username: prefix + 'USER', firstName: 'Synthetic', lastName: 'Merge Test',
        email: prefix + 'user@example.test', passwordHash: await require('bcryptjs').hash(crypto.randomBytes(24).toString('hex'), 8),
        roleId: editorRole.id, isActive: true, isMaster: false });
    const existing = await db.Patient.create({ patientCode: prefix + 'OLD', firstName: prefix + 'ALICE', lastName: 'SYNTHETIC',
        dob: '1980-01-01', phone: null, notes: 'Existing note', serviceDate: '2020-01-01', isActive: true });
    const incoming = { patientCode: prefix + 'INCOMING', firstName: existing.firstName, lastName: 'SYNTHETIC',
        dob: '1980-01-01', phone: '3055550151', notes: 'New note' };
    const before = await db.Patient.count();
    let preview = await run([incoming], { mode: 'preview' });
    assert(preview.reviewRequired); assert.equal(preview.warnings[0].canCreate, false);
    assert.equal(await db.Patient.count(), before);
    let result = await submit([incoming], [{ row: 2, action: 'import' }], preview);
    assert.equal(result.status, 400); assert.equal(await db.Patient.count(), before);
    result = await submit([incoming], [decision(2, existing.id, { phone: 'fill', dob: 'keep', notes: 'append' })], preview);
    assert.equal(result.mergedCount, 1); assert.equal(result.successCount, 0);
    await existing.reload(); assert.equal(existing.phone, incoming.phone); assert.equal(existing.notes, 'Existing note\nNew note');
    assert.equal(await db.Patient.count(), before);
    assert.equal(result.reportRows.find(r => r.field === 'Phone').finalValue, incoming.phone);
    assert.equal(result.reportRows.find(r => r.field === 'Notes').existingValue, 'Existing note');
    const firstReportId = result.reportId;
    const firstReportRows = JSON.stringify(result.reportRows);
    assert(Number.isInteger(firstReportId));
    let savedReport = await history('getPatientReport', firstReportId);
    assert.equal(savedReport.status, 200); assert.equal(JSON.stringify(savedReport.reportRows), firstReportRows);
    assert.equal((await history('getPatientReport', firstReportId, -1)).status, 404, 'Other importers cannot read another user report');
    const list = await history('listPatientReports');
    assert.equal(list.status, 200); assert(list.reports.some(report => report.id === firstReportId));
    assert(await db.AuditLog.count({ where: { userId: user.id, action: 'Merge patient import row' } }));

    const correction = { ...incoming, dob: '1981-02-03', phone: '3055550152', notes: '' };
    preview = await run([correction], { mode: 'preview' });
    result = await submit([correction], [decision(2, existing.id, { dob: 'incoming', phone: 'incoming', notes: 'incoming' })], preview);
    assert.equal(result.mergedCount, 1); await existing.reload();
    assert.equal(existing.dob, correction.dob); assert.equal(existing.phone, correction.phone);
    assert.equal(existing.notes, 'Existing note\nNew note', 'Blank source must never erase notes');
    savedReport = await history('getPatientReport', firstReportId);
    assert.equal(JSON.stringify(savedReport.reportRows), firstReportRows, 'Historical report must not change after patient edits');

    preview = await run([correction], { mode: 'preview' });
    await existing.update({ phone: '3055550153' });
    result = await submit([correction], [decision(2, existing.id, { phone: 'incoming' })], preview);
    assert(result.reviewRequired, 'Stale target requires another review');
    preview = await run([correction], { mode: 'preview' }, true);
    assert.equal(preview.canMerge, false);
    result = await run([correction], { duplicateReviewToken: preview.reviewToken,
        reviewDecisions: JSON.stringify([decision(2, existing.id, { phone: 'incoming' })]) }, true);
    assert.equal(result.status, 400);

    const newRow = { patientCode: prefix + 'NEW', firstName: prefix + 'BOB', lastName: 'SYNTHETIC', dob: '1970-01-01' };
    preview = await run([correction, newRow], { mode: 'preview' });
    const originalCreate = db.Patient.bulkCreate;
    db.Patient.bulkCreate = async () => { throw Error('Synthetic rollback test'); };
    try {
        result = await submit([correction, newRow], [decision(2, existing.id, { phone: 'incoming' })], preview);
        assert.equal(result.status, 500);
    } finally { db.Patient.bulkCreate = originalCreate; }
    await existing.reload(); assert.equal(existing.phone, '3055550153', 'Merge must roll back when another row fails');
    result = await submit([correction, newRow], [decision(2, existing.id, { phone: 'keep' })], preview);
    assert.equal(result.mergedCount, 1); assert.equal(result.successCount, 1);
    assert(result.reportRows.some(row => row.action === 'created'));

    preview = await run([correction], { mode: 'preview' });
    result = await submit([correction], [{ row: 2, action: 'skip' }], preview);
    assert.equal(result.skippedCount, 1); assert.equal(result.reportRows[0].action, 'discarded');

    const address = { ...correction, addressLine1: '91008 QA Test Lane', city: 'Miami', state: 'FL', zipCode: '33101' };
    preview = await run([address], { mode: 'preview' });
    result = await submit([address], [decision(2, existing.id, { address: 'incoming' })], preview);
    assert.equal(result.mergedCount, 1); await existing.reload(); assert.equal(existing.city, 'Miami');
    const currentDate = new Date().toISOString().slice(0, 10);
    await existing.update({ serviceDate: currentDate });
    const dateChange = { ...correction, serviceDate: '2026-10-01' };
    preview = await run([dateChange], { mode: 'preview' }, false, true);
    result = await run([dateChange], { duplicateReviewToken: preview.reviewToken,
        reviewDecisions: JSON.stringify([decision(2, existing.id, { serviceDate: 'incoming' })]) }, false, true);
    assert.equal(result.status, 400); await existing.reload(); assert.equal(existing.serviceDate, currentDate);
    assert.match(result.error, /window/);
    await existing.update({ isActive: false });
    preview = await run([correction], { mode: 'preview' });
    result = await submit([correction], [decision(2, existing.id, { phone: 'incoming' })], preview);
    assert.equal(result.status, 400);
    await existing.update({ isDeleted: true });
    const deletedRx = await db.RXRecord.create({ patientId: existing.id, isDeleted: true, deletedAt: new Date() });
    preview = await run([correction], { mode: 'preview' });
    assert(preview.warnings[0].matches.some(match => match.patient.isDeleted));
    result = await submit([correction], [decision(2, existing.id, { phone: 'incoming' })], preview);
    assert.equal(result.status, 400, 'Deleted patients require explicit restoration confirmation');
    const restoreDecision = { ...decision(2, existing.id, { phone: 'incoming' }), confirmRestore: true };
    const originalBulkCreate = db.Patient.bulkCreate;
    db.Patient.bulkCreate = async () => { throw Error('Synthetic restore rollback test'); };
    try {
        result = await submit([correction], [restoreDecision], preview);
        assert.equal(result.status, 500);
    } finally { db.Patient.bulkCreate = originalBulkCreate; }
    await existing.reload(); await deletedRx.reload();
    assert.equal(existing.isDeleted, true); assert.equal(deletedRx.isDeleted, true);
    result = await submit([correction], [restoreDecision], preview);
    assert.equal(result.mergedCount, 1); assert.equal(result.successCount, 0);
    await existing.reload(); await deletedRx.reload();
    assert.equal(existing.isDeleted, false); assert.equal(existing.isActive, true);
    assert.equal(deletedRx.isDeleted, false); assert.equal(deletedRx.deletedAt, null);
    assert.equal(result.reportRows.find(row => row.field === 'Patient status').finalValue, 'Active');
    assert.equal(result.reportRows.find(row => row.field === 'Restored RX records').finalValue, 1);
    savedReport = await history('getPatientReport', result.reportId);
    assert.deepEqual(savedReport.reportRows, result.reportRows);
    assert.throws(() => mergePatch({}, {}, { patientCode: 'incoming' }), /Invalid merge field/);
    assert.throws(() => mergePatch({}, {}, { isDeleted: 'incoming' }), /Invalid merge field/);
    console.log('PASS staging merge: exact-match merge/no-new-patient, DOB/phone overrides, fill/append/blank protection, permission/stale checks, atomic rollback, mixed rows, discard and detailed report.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(async () => {
    await cleanup().catch(error => { console.error('Fixture cleanup failed:', error.message); process.exitCode = 1; });
    await db.sequelize.close();
});
