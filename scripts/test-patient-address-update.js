'use strict';

// Real update handler, synthetic persistence only; never opens a database.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const addressUtils = require('../utils/patientAddress');
const source = fs.readFileSync(path.join(__dirname, '../controllers/patientController.js'), 'utf8');
const fields = ['address', 'addressLine1', 'city', 'state', 'zipCode'];
const original = { address: '100 Test Way, Tampa, FL 33602', addressLine1: '100 Test Way', city: 'Tampa', state: 'FL', zipCode: '33602' };
const replacement = { address: '200 Example Ct, Hollywood, FL 33024', addressLine1: '200 Example Ct', city: 'Hollywood', state: 'FL', zipCode: '33024' };
let stored, tagContext, permission;
const transaction = { LOCK: { UPDATE: 'UPDATE' } };
const context = {
    ...addressUtils,
    db: {
        sequelize: { transaction: async callback => callback(transaction) },
        Patient: { async findByPk(id, options) {
            assert.equal(options.transaction, transaction);
            return { ...stored, async save(options) {
                assert.equal(options.transaction, transaction);
                fields.forEach(field => { stored[field] = this[field]; });
            } };
        } }
    },
    getRequestPermission: async () => permission,
    parseDate: value => value || null,
    buildPatientContextSnapshot: async () => ({}),
    patientContextFieldsChanged: () => false,
    isServiceDateOverrideEnabled: () => false,
    setPatientTags: async (patient, ids, options) => { tagContext = options; }
};
vm.runInNewContext(source.slice(source.indexOf('async function lockedUpdatePatient('), source.indexOf('exports.delete =')), context);
function reset() {
    stored = { ...original };
    tagContext = null;
    permission = { visible: true, canEdit: true };
}
async function save(body) {
    let status = 200;
    let response;
    await context.lockedUpdatePatient({ params: { id: '1' }, body }, {
        status(code) { status = code; return this; },
        json(value) { response = value; }
    });
    assert.equal(status, 200, JSON.stringify(response));
    return response;
}
async function main() {
    reset();
    const body = { ...replacement, address: original.address, patientTagIds: [1] };
    await save(body);
    assert.deepEqual(stored, replacement, 'Visible address edits must win over the stale hidden full address');
    assert.equal(tagContext.city, 'Hollywood', 'Region assignment must receive the saved city');
    assert.equal(addressUtils.inferRegionalTagName(tagContext.address, tagContext.city), 'Miami');
    await save({ ...stored, patientTagIds: [1] });
    assert.deepEqual(stored, replacement, 'Reopening and saving must retain the replacement');

    reset();
    await save({ addressLine1: '300 Sample Ave' });
    assert.deepEqual(stored, { ...original, addressLine1: '300 Sample Ave', address: '300 Sample Ave, Tampa, FL 33602' }, 'Partial edits retain omitted fields');
    await save({ zipCode: '' });
    assert.equal(stored.zipCode, null, 'Explicit clearing must persist');
    assert.equal(stored.city, 'Tampa');

    reset();
    await save({ address: original.address, addressLine1: '', city: '', state: '', zipCode: '', patientTagIds: [] });
    assert.deepEqual(stored, Object.fromEntries(fields.map(field => [field, null])), 'Clearing all visible fields clears the full address too');
    assert.equal(addressUtils.inferRegionalTagName(tagContext.address, tagContext.city), 'None');

    reset();
    await save({ address: replacement.address });
    assert.deepEqual(stored, replacement, 'Legacy full-address-only requests still parse');

    reset();
    await save({ notes: 'Synthetic unrelated edit' });
    assert.deepEqual(stored, original, 'Unrelated edits preserve addresses');
    permission = { visible: true, canEdit: false, canOverrideExpired: true };
    await save(body);
    assert.deepEqual(stored, original, 'Service-date-only permission cannot change addresses');
    console.log('PASS patient address update: replacement, reload, partial edit, clearing, legacy input, Region context, and permissions.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
