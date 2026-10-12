'use strict';
// Only a disposable test cluster is accepted. No .env or external patient files.
const assert = require('node:assert/strict');
if (process.env.DB_HOST !== '127.0.0.1' || (process.env.DB_PORT !== '55439' && process.env.RX_LOCAL_RELEASE_TEST !== '1') || process.env.DB_NAME !== 'rx_next_ci_regression_test') throw Error('Requires the isolated import-review test cluster.');
process.env.APP_ENV = 'staging'; process.env.IMPORT_REVIEW_V2 = 'true';
const db = require('../models');
const controller = require('../controllers/importController');
const model = require('../public/js/import-review-model');
const prefix = 'REVIEW-V2-' + Date.now() + '-';
let user; let count = 0;
const headers = ['patientCode', 'firstName', 'lastName', 'dob', 'phone', 'notes'];
const row = (name, extra = {}) => ({ patientCode: prefix + name, firstName: prefix + name, lastName: 'SYNTHETIC', dob: '1980-01-02', phone: '', notes: '', ...extra });
async function run(rows, body = {}, columns = headers) {
    let output, status = 200;
    await controller.importDataset({ params: { dataset: 'patients' }, file: { buffer: Buffer.from(model.encode(columns, rows)), originalname: 'synthetic-review-v2.csv' },
        body: { reviewMode: 'merge', reviewVersion: '2', ...body }, user: { id: user.id, role: 'Administrator' }, ip: '127.0.0.1' }, {
        status(code) { status = code; return this; }, json(value) { output = value; }
    }); return { ...output, status };
}
const pass = label => { count++; console.log('PASS ' + label); };
async function main() {
    const role = await db.Role.findOne({ where: { name: 'Administrator' } });
    user = await db.User.create({ username: prefix, firstName: 'Synthetic', lastName: 'Review', passwordHash: 'not-a-login-hash', roleId: role.id, isActive: true });
    const good = row('GOOD'), bad = row('BAD', { phone: '305555010' });
    const before = await db.Patient.count();
    let result = await run([good, bad], { mode: 'preview' }); assert(result.aborted); assert.equal(result.errors[0].row, 3); assert.equal(await db.Patient.count(), before); pass('mixed valid/error preview saves nothing');
    result = await run([good]); assert.equal(result.successCount, 1); assert.equal(await db.Patient.count(), before + 1); pass('separately validated good subset saves once');
    const corrected = { ...bad, phone: '3055550101', _reviewSourceRow: 3, _reviewError: 'old phone error', _reviewNotes: 'verified source' };
    result = await run([corrected], {}, [...headers, ...model.metadata]); assert.equal(result.successCount, 1); assert.equal(await db.Patient.count(), before + 2); pass('corrected-only upload preserves metadata and excludes completed patient');
    let preview = await run([good], { mode: 'preview' }); assert(preview.warnings[0].previousImport); pass('identical repeat recognized from committed report');
    const patient = await db.Patient.findOne({ where: { patientCode: good.patientCode } });
    await patient.update({ notes: 'Changed after import' });
    preview = await run([good], { mode: 'preview' }); assert.equal(preview.warnings[0].previousImport, null); pass('patient edited after import is not suggested as already processed');
    preview = await run([{ ...good, notes: 'Different incoming data' }], { mode: 'preview' }); assert.equal(preview.warnings[0].previousImport, null); pass('changed incoming data receives normal comparison');
    result = await run([row('DEFER')], { reviewDecisions: JSON.stringify([{ row: 2, action: 'skip' }]), deferredRows: '[2]', reviewNotes: '{"2":"Review later"}' }); assert.equal(result.successCount, 0); assert.equal(result.skippedCount, 1); assert.equal(await db.Patient.count(), before + 2); assert.equal(result.reportRows[0].action, 'deferred'); assert.equal(result.reportRows[0].incomingValue, prefix + 'DEFER'); assert.equal(result.reportRows[0].reviewNotes, 'Review later'); pass('unflagged deferred row saves no patient and retains identity/notes in report');
    const incoming = { ...good, phone: '3055550102' }, fresh = row('ROLLBACK');
    preview = await run([incoming, fresh], { mode: 'preview' });
    const original = db.Patient.bulkCreate;
    db.Patient.bulkCreate = async () => { throw Error('Synthetic v2 rollback failure'); };
    try {
        result = await run([incoming, fresh], { duplicateReviewToken: preview.reviewToken, reviewDecisions: JSON.stringify([{ row: 2, action: 'merge', targetId: patient.id, fields: { phone: 'incoming' } }]) });
        assert.equal(result.status, 500);
    } finally { db.Patient.bulkCreate = original; }
    await patient.reload(); assert.equal(patient.phone, null); assert.equal(await db.Patient.count(), before + 2); pass('v2 mixed merge/create failure rolls back both');
    preview = await run([incoming], { mode: 'preview' });
    await patient.update({ notes: 'Concurrent change' });
    result = await run([incoming], { duplicateReviewToken: preview.reviewToken, reviewDecisions: JSON.stringify([{ row: 2, action: 'merge', targetId: patient.id, fields: { phone: 'incoming' } }]) });
    assert(result.reviewRequired); await patient.reload(); assert.equal(patient.phone, null); pass('stale v2 review cannot save after concurrent change');
    console.log('PASS ' + count + ' PostgreSQL v2 integration scenarios');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
    if (user) {
        const patients = await db.Patient.findAll({ where: { patientCode: { [db.Sequelize.Op.like]: prefix + '%' } }, attributes: ['id'], raw: true });
        const ids = patients.map(p => p.id);
        if (ids.length) {
            for (const name of ['PatientTagAssignment', 'PatientServiceDateHistory', 'PatientServiceDateCycle']) await db[name].destroy({ where: { patientId: ids } });
            await db.Patient.destroy({ where: { id: ids } });
        }
        await db.AuditLog.destroy({ where: { userId: user.id } }); await db.User.destroy({ where: { id: user.id } });
    }
    await db.sequelize.close();
});
