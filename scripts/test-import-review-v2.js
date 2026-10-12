'use strict';
// Synthetic fixtures only; no database configuration or patient files are loaded.
const assert = require('node:assert/strict');
const model = require('../public/js/import-review-model');
const { enabled } = require('../utils/importReviewV2');
const { findWarnings } = require('../utils/patientImportDuplicates');
const { buildPlan, mergePatch } = require('../utils/patientImportMerge');
const harness = require('./test-patient-import-duplicates');
let count = 0;
const check = (name, fn) => { fn(); count++; console.log('PASS ' + name); };
const existing = { id: 1, patientCode: 'SYNTHETIC-1', firstName: 'ALICE', lastName: 'EXAMPLE', dob: '1980-01-02', phone: '3055550100' };
const sibling = { ...existing, id: undefined, patientCode: '', firstName: 'BOB', dob: '1982-03-04' };
const raw = p => ({ ...p, _rowNum: 2 });
const options = { includeExact: true, householdInformational: true };
check('switch defaults off and refuses production', () => {
    assert(!enabled({})); assert(!enabled({ APP_ENV: 'production', IMPORT_REVIEW_V2: 'true' }));
    assert(enabled({ APP_ENV: 'staging', IMPORT_REVIEW_V2: 'true' }));
    assert(enabled({ APP_ENV: 'development', IMPORT_REVIEW_V2: 'true' }));
});
check('legacy shared-phone warning remains unchanged', () => assert.equal(findWarnings([sibling], [existing], { includeExact: true })[0].informational, undefined));
check('different names with shared phone default to separate patient', () => {
    const warnings = findWarnings([sibling], [existing], options); assert.equal(warnings.length, 0);
    const items = model.session([raw(sibling)], warnings); assert(model.resolved(items[0]));
    assert.equal(model.decisions(items).length, 0, 'Separate people need no duplicate decision');
});
check('mixed review excludes unrelated database and CSV shared-phone matches', () => {
    const unrelated = { ...sibling, firstName: 'ROBERT', lastName: 'OTHER' };
    const incoming = { ...existing, patientCode: '', phone: sibling.phone };
    const warnings = findWarnings([unrelated, incoming], [{ ...existing, phone: '3055550199' }, { ...unrelated, id: 2 }], options);
    const review = warnings.find(w => w.row === 3);
    assert.equal(review.matches.length, 1); assert.equal(review.matches[0].patient.id, existing.id);
    assert.equal(review.canCreate, false);
});
check('same DOB or missing DOB retains shared-phone evidence', () => {
    for (const dob of [existing.dob, null]) assert.equal(findWarnings([{ ...sibling, dob }], [existing], options)[0].matches.length, 1);
});
check('similar names with different DOB retain shared-phone evidence', () => {
    assert.equal(findWarnings([{ ...sibling, firstName: 'ALISE' }], [existing], options)[0].matches.length, 1);
});
check('exact name/DOB stays blocked even with shared household phone', () => {
    const warnings = findWarnings([existing], [existing], options); assert.equal(warnings[0].canCreate, false); assert(!warnings[0].informational);
});
check('Patient ID collision with different identity stays blocked', () => assert.equal(findWarnings([{ ...sibling, patientCode: existing.patientCode }], [existing], options)[0].canCreate, false));
check('similar name and same DOB requires review without auto-merge', () => {
    const incoming = { ...existing, patientCode: '', firstName: 'ALISE', phone: '' };
    const warning = findWarnings([incoming], [{ ...existing, phone: '' }], options)[0];
    assert(warning); assert(!warning.informational); assert(warning.canCreate);
});
check('different name and different DOB does not become a spelling match', () => assert.equal(findWarnings([{ ...sibling, phone: '' }], [{ ...existing, phone: '' }], options).length, 0));
check('same-file exact identity remains blocked and cannot merge into unsaved row', () => {
    const warnings = findWarnings([existing, { ...existing, patientCode: '' }], [], options);
    assert.equal(warnings[0].canCreate, false); assert.equal(warnings[0].matches[0].source, 'file');
    assert.throws(() => buildPlan([existing, existing], [], warnings, [{ row: 3, action: 'merge', targetId: 1, fields: {} }], true));
});
check('repeat-upload fingerprint ignores review metadata but respects patient fields', () => {
    const { sourceHash, repeatedRows } = require('../utils/importReviewV2');
    assert.equal(sourceHash(existing), sourceHash({ ...existing, _reviewNotes: 'changed note', _reviewSourceRow: '98' }));
    assert.notEqual(sourceHash(existing), sourceHash({ ...existing, phone: '3055550109' }));
    const source = { ...existing }; delete source.id;
    const updatedAt = '2026-01-01T00:00:00.000Z', report = { id: 10, newValue: { sourceRows: [{ hash: sourceHash(source), patientId: 1, updatedAt }] } };
    assert.equal(repeatedRows([source], [{ ...existing, updatedAt }], [report]).length, 1);
    assert.equal(repeatedRows([source], [{ ...existing, updatedAt: '2026-01-02T00:00:00Z' }], [report]).length, 0);
    assert.equal(repeatedRows([source], [{ ...existing, updatedAt }], [{ id: 9, newValue: { schemaVersion: 1 } }]).length, 0);
    assert.equal(repeatedRows([{ ...source, patientTags: 'Changed tag' }], [{ ...existing, updatedAt }], [report]).length, 0);
});
check('same name different DOB still needs review', () => assert(!findWarnings([{ ...existing, patientCode: '', dob: sibling.dob }], [existing], options)[0].informational));
check('multiple candidates must all be compared before separate import', () => {
    const warning = { row: 2, canCreate: true, matches: [{}, {}] };
    const item = model.session([raw(sibling)], [warning])[0]; item.decision.action = 'import';
    assert(!model.resolved(item)); item.different.add(0); assert(!model.resolved(item)); item.different.add(1); assert(model.resolved(item));
});
check('hard duplicate cannot be bypassed by different-person clicks', () => {
    const item = model.session([raw(existing)], [{ row: 2, canCreate: false, matches: [{}] }])[0];
    item.decision.action = 'import'; item.different.add(0); assert(!model.resolved(item));
});
check('defer exports without saving, including unflagged rows', () => {
    const items = model.session([raw(sibling)], []); items[0].decision.action = 'defer';
    const decisions = model.decisions(items); assert.equal(decisions[0].action, 'skip');
    assert.equal(buildPlan([sibling], [], [], decisions, true, { allowUnflaggedSkip: true })[0].action, 'skip');
    assert.throws(() => buildPlan([sibling], [], [], decisions, true));
});
check('invalid/unflagged merge targets still rejected', () => assert.throws(() => buildPlan([sibling], [existing], [], [{ row: 2, action: 'merge', targetId: 1, fields: {} }], true, { allowUnflaggedSkip: true })));
check('merge permission and restoration are retained', () => {
    const warnings = findWarnings([existing], [existing], options), d = [{ row: 2, action: 'merge', targetId: 1, fields: {} }];
    assert.throws(() => buildPlan([existing], [existing], warnings, d, false));
    const deleted = { ...existing, isDeleted: true };
    assert.throws(() => buildPlan([existing], [deleted], findWarnings([existing], [deleted], options), d, true));
    d[0].confirmRestore = true; assert(buildPlan([existing], [deleted], findWarnings([existing], [deleted], options), d, true)[0].restore);
});
check('blank incoming values never erase existing values', () => assert.deepEqual(mergePatch(existing, { phone: '' }, { phone: 'incoming' }), {}));
check('two rows cannot merge into one target', () => {
    const incoming = [existing, existing], warnings = findWarnings(incoming, [existing], options);
    assert.throws(() => buildPlan(incoming, [existing], warnings, [2, 3].map(row => ({ row, action: 'merge', targetId: 1, fields: {} })), true));
});
check('correction CSV keeps all original headers, Unicode, quotes and multiline text', () => {
    const rows = [{ _rowNum: 2, firstName: ' José ', notes: 'two\nlines, "quoted"', custom: 'original', _reviewNotes: 'my note' }];
    const packet = model.correction(['firstName', 'notes', 'custom'], rows, [{ row: 2, error: 'DOB missing' }, { row: 2, error: 'Phone invalid' }]);
    assert.equal(packet.rows.length, 1); assert.equal(packet.rows[0]._reviewSourceRow, 2); assert.equal(packet.rows[0].firstName, ' José ');
    assert.equal(packet.rows[0]._reviewNotes, 'my note'); assert.equal(packet.rows[0]._reviewError, 'DOB missing; Phone invalid');
    assert(model.encode(packet.headers, packet.rows).includes('two\nlines, ""quoted""'));
});
check('completed and deliberately skipped rows are excluded from correction subset', () => {
    const rows = [2, 3, 4].map(_rowNum => ({ _rowNum })); assert.deepEqual(model.correction([], rows, [], [3]).rows.map(r => r._reviewSourceRow), [3]);
});
check('original source locator survives repeated correction uploads', () => assert.equal(model.correction([], [{ _rowNum: 2, _reviewSourceRow: '98' }], [{ row: 2, error: 'retry' }]).rows[0]._reviewSourceRow, '98'));
check('restoration checkbox required in final summary', () => {
    const item = model.session([raw(existing)], [findWarnings([existing], [existing], options)[0]])[0];
    item.target = { ...existing, isActive: false }; item.decision = { row: 2, action: 'merge', targetId: 1 };
    assert(!model.resolved(item)); item.decision.confirmRestore = true; assert(model.resolved(item));
});
async function run(csv, body = {}) {
    let result;
    await harness.controller.importDataset({ params: { dataset: 'patients' }, file: { buffer: Buffer.from(csv), originalname: 'synthetic.csv' },
        body: { reviewMode: 'merge', reviewVersion: '2', mode: 'preview', ...body }, user: { id: 7 } }, {
        status(code) { this.code = code; return this; }, json(data) { result = { ...data, status: this.code || 200 }; }
    }); return result;
}
async function main() {
    process.env.APP_ENV = 'staging'; process.env.IMPORT_REVIEW_V2 = 'true'; harness.reset();
    const csv = phone => 'firstName,lastName,dob,phone\nALICE,EXAMPLE,1980-01-02,' + phone;
    let result = await run(csv('305555010'));
    assert(result.aborted); assert.match(result.errors[0].error, /10 US digits/); assert.equal(harness.stats().writes, 0); count++; console.log('PASS v2 incomplete-phone rejection saves nothing');
    result = await run(csv('+1 (305) 555-0100')); assert(result.preview); count++; console.log('PASS optional leading 1 accepted');
    result = await run(csv('0000000000')); assert(result.aborted); count++; console.log('PASS placeholder phone rejected');
    result = await run('firstName,dob\nALICE,1980-01-02'); assert.equal(result.status, 400); count++; console.log('PASS missing required header rejected');
    result = await run('firstName,lastName,dob,phone,phone\nALICE,EXAMPLE,1980-01-02,123,456'); assert.equal(result.status, 400); count++; console.log('PASS duplicate header rejected');
    harness.reset([existing]); result = await run(model.encode(['firstName','lastName','dob','phone'], [sibling]));
    assert.equal(result.warnings.length, 0); count++; console.log('PASS server excludes unrelated shared-phone matches');
    const token = result.reviewToken;
    result = await run(model.encode(['firstName','lastName','dob','phone'], [sibling]), { mode: 'save', duplicateReviewToken: token });
    assert.equal(result.successCount, 1); count++; console.log('PASS household individual create through signed locked review');
    harness.reset(); harness.setHistoryFailure(true);
    try {
        result = await run(csv('3055550109'), { mode: 'save' });
        assert(result.saveCommitted); assert.equal(result.status, 500); assert.equal(result.aborted, false); assert.equal(harness.stats().writes, 1);
        count++; console.log('PASS post-commit failure reports saved batch and never labels it unsaved');
    } finally { harness.setHistoryFailure(false); }
    process.env.IMPORT_REVIEW_V2 = 'false'; harness.reset();
    result = await run(csv('305555010')); assert(result.preview); count++; console.log('PASS switch off restores legacy phone behavior');
    console.log('PASS ' + count + ' import-review-v2 scenarios');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
