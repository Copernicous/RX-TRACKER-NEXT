'use strict';

// Synthetic controller harness: never loads database configuration or connects to a database.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const duplicates = require('../utils/patientImportDuplicates');
const filename = path.resolve(__dirname, '../controllers/importController.js');
const localRequire = createRequire(filename);
const patient = { id: 1, patientCode: 'TEST-1', firstName: 'TEST ALICE', lastName: 'EXAMPLE', dob: '1980-01-02', phone: '(305) 555-0100' };
let existing = [], finalExisting = null, writes = [], audit = [], locks = 0, transactions = [];
const db = {
    sequelize: {
        transaction: async () => {
            const tx = { finished: null, async commit() { this.finished = 'commit'; }, async rollback() { this.finished = 'rollback'; } };
            transactions.push(tx);
            return tx;
        },
        query: async sql => { assert.match(sql, /LOCK TABLE "Patients" IN SHARE ROW EXCLUSIVE MODE/); locks++; }
    },
    Patient: {
        findOne: async () => ({ id: 100 }),
        findAll: async options => {
            assert(options.attributes.includes('isDeleted'));
            return options.transaction && finalExisting ? finalExisting : existing;
        },
        bulkCreate: async (rows, options) => {
            assert(options.transaction); assert(locks > 0);
            writes.push(...rows);
            return rows.map((p, i) => ({ ...p, id: 101 + i, setPatientTags: async () => {} }));
        }
    },
    AuditLog: { create: async (row, options) => { audit.push({ row, options }); } }
};
for (const name of ['PatientTransportCompany', 'PharmacyTransportCompany', 'Clinic', 'WorkflowAction', 'PatientTag']) {
    db[name] = { findAll: async () => [] };
}
const context = { exports: {}, console, Buffer, Date, require(name) {
    if (name === '../models') return db;
    if (name === '../services/patientImportMergeService') return { applyMerge: async () => { throw Error('Merge is covered by the staging merge regression'); } };
    if (name === '../middleware/rbac') return { getRequestPermission: async () => ({}) };
    if (name === '../services/patientServiceDateHistoryService') return { bulkRecordPatientServiceDateChanges: async () => {} };
    if (name === '../services/patientServiceDateCycleService') return { syncPatientServiceDateCycles: async () => {} };
    if (name === '../services/cityRegionRuleService') return { applyRegionalTagRuleToIds: async ids => ids };
    if (name === '../utils/globalSettings') return { getServiceWindowDays: () => 90 };
    if (name === '../utils/pharmacyTransportIdentity') return {};
    return localRequire(name);
} };
vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context, { filename });
function reset(records = []) { existing = records; finalExisting = null; writes = []; audit = []; locks = 0; transactions = []; }
function csv(rows) {
    const headers = ['patientCode', 'firstName', 'lastName', 'dob', 'phone', 'address', 'addressLine1', 'city', 'state', 'zipCode'];
    const escape = value => '"' + String(value ?? '').replace(/"/g, '""') + '"';
    return Buffer.from([headers.join(','), ...rows.map(row => headers.map(h => escape(row[h])).join(','))].join('\n'));
}
async function run(rows, body = {}, userId = 7) {
    let output;
    let httpStatus = 200;
    await context.exports.importDataset({ params: { dataset: 'patients' }, file: { buffer: csv(rows) }, body,
        user: { id: userId }, ip: '127.0.0.1' }, {
        status(code) { httpStatus = code; return this; }, json(data) { output = { ...data, httpStatus }; return data; }
    });
    assert(output);
    assert(transactions.every(tx => tx.finished), 'No transaction left open');
    return output;
}
async function main() {
    const client = vm.createContext({ document: { addEventListener() {} } });
    vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../public/js/import.js'), 'utf8'), client);
    const parsed = vm.runInContext(`parseCSV('\uFEFFfirstName,lastName,dob,notes\\r\\nALICE,EXAMPLE,01/02/1980,"two\\nlines, with ""quotes"""\\r\\nBOB,EXAMPLE,01/03/1980,plain\\r\\n')`, client);
    assert.equal(parsed.rows.length, 2);
    assert.equal(parsed.rows[0].notes, 'two\nlines, with "quotes"');
    assert.equal(parsed.rows[1]._rowNum, 3);
    assert.equal(vm.runInContext(`importEscape('<img src=x onerror="bad()">')`, client), '&lt;img src=x onerror=&quot;bad()&quot;&gt;');
    assert.equal(duplicates.normalizePhone('+1 (305) 555-0100'), '3055550100');
    assert.equal(duplicates.normalizePhone('000-000-0000'), '');
    assert.equal(duplicates.normalizePhone('123'), '');
    assert.equal(duplicates.identityKey({ ...patient, firstName: ' test  alice ' }), duplicates.identityKey(patient));
    const changedDob = { ...patient, patientCode: 'TEST-NEW', dob: '1981-01-02' };
    reset([patient]);
    let result = await run([changedDob], { mode: 'preview' });
    assert(result.reviewRequired); assert.equal(writes.length, 0); assert.equal(locks, 0);
    assert.equal(result.warnings[0].matches[0].reasons.length, 2);
    const token = result.reviewToken;
    result = await run([changedDob]);
    assert(result.reviewRequired); assert.equal(writes.length, 0);
    result = await run([changedDob], { duplicateReviewToken: 'true' });
    assert(result.reviewRequired); assert.equal(writes.length, 0);
    result = await run([changedDob], { duplicateReviewToken: token }, 8);
    assert(result.reviewRequired); assert.equal(writes.length, 0);
    result = await run([{ ...changedDob, phone: '305-555-0101' }], { duplicateReviewToken: token });
    assert(result.reviewRequired); assert.equal(writes.length, 0);
    result = await run([changedDob], { duplicateReviewToken: token });
    assert.equal(result.successCount, 1);
    assert(audit.some(a => a.options?.transaction && a.row.action === 'Confirm possible patient duplicates'));

    reset([{ ...patient, isDeleted: true, isActive: false }]);
    result = await run([{ ...patient, patientCode: 'DIFFERENT', firstName: ' test  alice ', dob: '01/02/1980' }], { duplicateReviewToken: token });
    assert(result.aborted); assert(result.errorCount > 0); assert.equal(writes.length, 0);

    reset();
    result = await run([patient, { ...patient, patientCode: 'TEST-2' }]);
    assert(result.errorCount > 0); assert.equal(writes.length, 0);
    result = await run([patient, changedDob], { mode: 'preview' });
    assert.equal(result.warnings[0].row, 3); assert.equal(result.warnings[0].matches[0].source, 'file');
    assert.equal(result.warnings[0].matches[0].row, 2);
    result = await run([patient, changedDob], { duplicateReviewToken: result.reviewToken });
    assert.equal(result.successCount, 2);

    reset([patient]);
    result = await run([{ ...changedDob, firstName: 'BOB', phone: '+1 305-555-0100' }], { mode: 'preview' });
    assert.equal(result.warnings[0].matches[0].reasons.length, 1);
    const addressPatient = { ...patient, phone: '', addressLine1: '12 Test Street Apt 2', city: 'Miami', state: 'FL', zipCode: '33101' };
    const addressIncoming = { ...addressPatient, firstName: 'BOB', patientCode: 'TEST-2', dob: '1985-02-01' };
    reset([addressPatient]);
    result = await run([addressIncoming], { mode: 'preview' });
    assert.match(result.warnings[0].matches[0].reasons[0], /Same address/);
    result = await run([{ ...addressIncoming, addressLine1: '12 Test Street Apt 3' }], { mode: 'preview' });
    assert.equal(result.warnings.length, 0); assert.equal(writes.length, 0);

    reset([patient]);
    const preview = await run([changedDob], { mode: 'preview' });
    finalExisting = [patient, { ...patient, id: 2, patientCode: 'LATER', firstName: 'BOB' }];
    result = await run([changedDob], { duplicateReviewToken: preview.reviewToken });
    assert(result.reviewRequired); assert.equal(writes.length, 0);
    finalExisting = [patient, { ...changedDob, id: 3 }];
    result = await run([changedDob], { duplicateReviewToken: preview.reviewToken });
    assert(result.errorCount > 0); assert.equal(writes.length, 0);

    reset();
    for (const dob of ['02/30/1980', '01/01/2199', 'May 4, 1980']) {
        result = await run([{ ...patient, dob }]);
        assert(result.errorCount > 0); assert.equal(writes.length, 0);
    }
    result = await run([patient], { mode: 'preview' });
    assert(result.preview); assert.equal(writes.length, 0);
    result = await run([patient]);
    assert.equal(result.successCount, 1);

    reset();
    result = await run([{ ...patient, phone: '', address: '' }, { ...patient, patientCode: 'OTHER', firstName: 'BOB', phone: '', address: '' }], { mode: 'preview' });
    assert.equal(result.warnings.length, 0, 'Blank fields must never cause warnings');

    const warnings = duplicates.findWarnings([changedDob], [patient]);
    const file = csv([changedDob]);
    const now = Date.now;
    const expiring = duplicates.createReviewToken(file, 7, warnings);
    Date.now = () => now() + 16 * 60 * 1000;
    try { assert.equal(duplicates.validReviewToken(expiring, file, 7, warnings), false); }
    finally { Date.now = now; }
    reset([patient]);
    const another = { ...changedDob, patientCode: 'TEST-THIRD', firstName: 'BOB', phone: '2125550100' };
    const skipPreview = await run([changedDob, another], { mode: 'preview' });
    result = await run([changedDob, another], { duplicateReviewToken: skipPreview.reviewToken, skipRows: '[2]' });
    assert.equal(result.successCount, 1); assert.equal(result.skippedCount, 1);
    assert.equal(writes[0].firstName, 'BOB');
    const decision = audit.find(a => a.row.action === 'Confirm possible patient duplicates').row.newValue.reviewedRows[0];
    assert.equal(decision.decision, 'skip'); assert.equal(decision.patientId, null);
    reset([patient]);
    result = await run([changedDob, another], { duplicateReviewToken: skipPreview.reviewToken, skipRows: '[3]' });
    assert.equal(result.httpStatus, 400); assert.equal(writes.length, 0);
    result = await run([changedDob], { skipRows: '[2]' });
    assert(result.reviewRequired); assert.equal(writes.length, 0);
    const allSkippedPreview = await run([changedDob], { mode: 'preview' });
    result = await run([changedDob], { duplicateReviewToken: allSkippedPreview.reviewToken, skipRows: '[2]' });
    assert.equal(result.successCount, 0); assert.equal(result.skippedCount, 1); assert.equal(writes.length, 0);
    reset();
    const sameFilePreview = await run([patient, changedDob], { mode: 'preview' });
    result = await run([patient, changedDob], { duplicateReviewToken: sameFilePreview.reviewToken, skipRows: '[3]' });
    assert.equal(result.successCount, 1); assert.equal(writes[0].dob, patient.dob);
    console.log('PASS patient import duplicate review: no-write preview, hard blocks, warning overrides, stale/file/user/expiry binding, audit, final recheck, DOB validation.');
}
module.exports = { controller: context.exports, reset, patient, stats: () => ({ writes: writes.length, audit: audit.length }) };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
