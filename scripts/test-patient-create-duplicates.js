'use strict';

// Exercise the real create handler with synthetic transaction-aware model substitutes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const duplicates = require('../utils/patientImportDuplicates');
const { parseDate } = require('../utils/dateUtils');
const { normalizeAddressPayload } = require('../utils/patientAddress');
const source = fs.readFileSync(path.join(__dirname, '../controllers/patientController.js'), 'utf8');
let existing, audits, txs, failTags;
const original = { id: 1, patientCode: 'TEST-1', firstName: 'ALICE', lastName: 'EXAMPLE', dob: '1980-01-01', phone: '3055550100' };
function reset() { existing = [{ ...original }]; audits = []; txs = []; failTags = false; }
const db = {
    sequelize: {
        async transaction() {
            const tx = { finished: null, rows: [], async commit() { existing.push(...this.rows); this.finished = 'commit'; }, async rollback() { this.finished = 'rollback'; } };
            txs.push(tx); return tx;
        },
        async query(sql, options) { assert.match(sql, /LOCK TABLE "Patients"/); assert(options.transaction); }
    },
    Patient: {
        async findOne(options) { assert(options.transaction); return options.where ? existing.find(p => p.patientCode === options.where.patientCode) : existing.at(-1); },
        async findAll(options) { assert(options.transaction); return existing; },
        async create(data, options) { const row = { ...data, id: existing.length + 1 }; options.transaction.rows.push(row); return row; },
        async findByPk(id, options) { return options.transaction.rows.find(row => row.id === id); }
    },
    AuditLog: { async create(row, options) { assert(options.transaction); audits.push(row); } }
};
const context = { exports: {}, Buffer, Date, db, ...duplicates, parseDate, normalizeAddressPayload,
    toUpperName: value => String(value || '').trim().toUpperCase(),
    async setPatientTags(data, ids, options) { assert(options.transaction); if (failTags) throw Error('Synthetic tag failure'); },
    async syncPatientServiceDateCycles(data, options) { assert(options.transaction); },
    async buildPatientContextSnapshot(data, options) { assert(options.transaction); return {}; },
    patientContextChangedFields: () => [],
    async recordPatientServiceDateChange(entry, options) { assert(options.transaction); }
};
vm.runInNewContext(source.slice(source.indexOf('exports.create ='), source.indexOf('exports.update =')), context);
async function create(body, userId = 7) {
    let status = 200, result;
    await context.exports.create({ body, user: { id: userId }, ip: '127.0.0.1' }, {
        status(code) { status = code; return this; }, json(data) { result = data; }
    });
    assert(txs.every(tx => tx.finished), 'Transaction must close before handler finishes');
    return { status, ...result };
}
async function main() {
    reset();
    const incoming = { ...original, id: undefined, patientCode: 'TEST-NEW', dob: '1981-01-01', serviceDate: '2026-09-10' };
    let result = await create(incoming);
    assert.equal(result.status, 409); assert(result.reviewRequired); assert.equal(existing.length, 1);
    assert.equal(audits.length, 0);
    const token = result.reviewToken;
    result = await create({ ...incoming, duplicateReviewToken: token }, 8);
    assert(result.reviewRequired); assert.equal(existing.length, 1);
    result = await create({ ...incoming, phone: '3055550101', duplicateReviewToken: token });
    assert(result.reviewRequired); assert.equal(existing.length, 1);
    result = await create({ ...incoming, duplicateReviewToken: token });
    assert.equal(result.status, 201); assert.equal(existing.length, 2); assert.equal(audits.length, 1);
    assert.equal(existing[1].duplicateReviewToken, undefined);
    reset();
    result = await create({ ...incoming, dob: original.dob, firstName: ' alice ', duplicateReviewToken: token });
    assert(result.duplicateBlocked); assert.equal(existing.length, 1);
    existing[0].isDeleted = true;
    result = await create({ ...incoming, dob: original.dob });
    assert(result.duplicateBlocked);
    reset();
    const preview = await create(incoming);
    existing.push({ ...original, id: 10, patientCode: 'LATER', firstName: 'BOB' });
    result = await create({ ...incoming, duplicateReviewToken: preview.reviewToken });
    assert(result.reviewRequired); assert.equal(existing.length, 2);
    reset();
    result = await create({ ...incoming, firstName: 'BOB', phone: '' });
    assert.equal(result.status, 201);
    reset(); failTags = true;
    result = await create({ ...incoming, firstName: 'BOB', phone: '' });
    assert.equal(result.status, 400); assert.equal(existing.length, 1);
    console.log('PASS manual patient creation: no-write warning, hard identity block, stale/user/payload binding, transactional create/rollback and override audit.');
}
module.exports = { controller: context.exports, reset, stats: () => ({ patients: existing.length, audits: audits.length }) };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
