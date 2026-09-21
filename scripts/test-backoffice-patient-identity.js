const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
// Full client script, synthetic DOM/API only. No application config or database.
class Element {
    constructor() { this.style = {}; this.value = ''; this.children = []; this.disabled = false; this.classList = { add() {}, remove() {}, toggle() {} }; }
    set textContent(value) { this.text = String(value); this.children = []; }
    get textContent() { return (this.text || '') + this.children.map(child => child.textContent).join(''); }
    appendChild(child) { this.children.push(child); }
    addEventListener() {}
    focus() {}
}
const elements = new Map();
const el = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
const context = { window: {}, document: { getElementById: el, addEventListener() {}, createElement: () => new Element(), querySelectorAll: () => [] }, setInterval() {}, setTimeout() {}, escHtml: value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/backoffice.js'), 'utf8'), context);
const patients = [{ id: 71, patientCode: 'PAT-00091', firstName: 'SAMPLE', lastName: '<ONE>' }, { id: 91, patientCode: 'PAT-00111', firstName: 'SAMPLE', lastName: 'TWO' }, { id: 92, patientCode: null, firstName: 'NO', lastName: 'CODE' }];
const requests = [];
let impactFails = false;
let releaseImpact;
context.apiFetch = async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : null;
    requests.push({ url, body, method: options.method });
    if (url.includes('table-data')) return { ok: true, json: async () => ({ rows: patients, columns: Object.keys(patients[0]), total: patients.length }) };
    if (url.endsWith('row-impact')) {
        if (releaseImpact === 'wait') await new Promise(resolve => { releaseImpact = resolve; });
        return { ok: !impactFails, json: async () => impactFails ? { error: 'Synthetic failure' } : { impact: [] } };
    }
    // Simulate a rejected delete after capturing the exact payload; no data changes.
    return { ok: false, json: async () => ({ error: 'Synthetic delete response' }) };
};
context.toast = () => {};
context.tableMeta = [{ key: 'Patients', label: 'Patients' }, { key: 'Clinics', label: 'Clinics' }];
async function run() {
    context.viewerSelectedIds.add('999');
    await context.openViewer('Patients');
    assert.equal(context.viewerSelectedIds.size, 0);
    assert.equal(context.viewerCols[0], 'patientCode');
    assert.equal(context.viewerVis.id, false);
    assert.equal(context.viewerColumnLabel('id'), 'Internal Database ID');
    assert.match(el('viewerTableWrap').innerHTML, /Patient ID/);
    assert.match(el('viewerTableWrap').innerHTML, /PAT-00091/);
    assert.match(el('viewerTableWrap').innerHTML, /&lt;ONE&gt;/);
    assert.equal(context.viewerCellValue(patients[2], 'patientCode'), 92);
    context.toggleCol('patientCode', false);
    assert.equal(context.viewerVis.patientCode, true);
    // Deleted status must ignore other true/false fields and combine with search.
    const statusRows = [
        { id: 1, patientCode: 'TEST-A', isDeleted: true, isActive: false },
        { id: 2, patientCode: 'TEST-B', isDeleted: false, isActive: true },
        { id: 3, patientCode: 'TEST-C', isDeleted: null, isActive: true },
        { id: 4, patientCode: 'TEST-D', isDeleted: 'true', isActive: false },
        { id: 5, patientCode: 'TEST-E', isDeleted: 'false', isActive: true }
    ];
    context.viewerRows = statusRows;
    context.viewerSelectedIds.add('2');
    context.viewerPage = 2;
    el('viewerDeletedFilter').value = 'deleted';
    context.changeViewerDeletedFilter();
    assert.equal(context.viewerSelectedIds.size, 0, 'Changing status clears prior delete selection');
    assert.equal(context.viewerPage, 1);
    assert.equal(context.viewerFiltRows.map(row => row.id).join(','), '1,4');
    assert.match(el('viewerInfo').textContent, /2.*filtered/);
    el('viewerSearch').value = 'TEST-D';
    context.applyViewerFilter();
    assert.equal(context.viewerFiltRows.map(row => row.id).join(','), '4');
    el('viewerSearch').value = 'TEST-B';
    context.applyViewerFilter();
    assert.equal(context.viewerFiltRows.length, 0);
    assert.match(el('viewerTableWrap').innerHTML, /No records match your filters/);
    el('viewerSearch').value = '';
    el('viewerDeletedFilter').value = 'not-deleted';
    context.changeViewerDeletedFilter();
    assert.equal(context.viewerFiltRows.map(row => row.id).join(','), '2,3,5');
    el('viewerDeletedFilter').value = 'all';
    context.changeViewerDeletedFilter();
    assert.equal(context.viewerFiltRows.length, 5);
    context.viewerRows = patients;
    el('viewerSearch').value = '91';
    context.applyViewerFilter();
    assert.equal(context.viewerFiltRows.length, 2);
    context.viewerSelectedIds.add('71');
    releaseImpact = 'wait';
    const loading = context.openImpactModal();
    el('impactPhrase').value = 'CONFIRM';
    context.checkImpactPhrase();
    assert.equal(el('impactDeleteBtn').disabled, true);
    await context.executeRowDelete();
    assert.equal(requests.filter(r => r.method === 'DELETE').length, 0);
    releaseImpact(); releaseImpact = null;
    await loading;
    assert.equal(el('impactDeleteBtn').disabled, false);
    assert.match(el('impactPatients').textContent, /PAT-00091 - SAMPLE <ONE>/);
    assert.doesNotMatch(el('impactPatients').textContent, /PAT-00111/);
    context.viewerSelectedIds.clear(); context.viewerSelectedIds.add('91');
    await context.executeRowDelete();
    assert.deepEqual(requests.find(r => r.method === 'DELETE').body, { tableName: 'Patients', ids: ['71'] });
    assert.equal(el('impactDeleteBtn').disabled, true);
    context.closeImpactModal();
    await context.openImpactModal();
    assert.match(el('impactPatients').textContent, /PAT-00111 - SAMPLE TWO/);
    context.closeImpactModal();
    impactFails = true;
    await context.openImpactModal();
    el('impactPhrase').value = 'CONFIRM'; context.checkImpactPhrase();
    assert.equal(el('impactDeleteBtn').disabled, true);
    impactFails = false;
    context.viewerSelectedIds.add('71');
    await context.openImpactModal();
    assert.match(el('impactPatients').textContent, /PAT-00091/);
    assert.match(el('impactPatients').textContent, /PAT-00111/);
    context.closeImpactModal();
    context.viewerSelectedIds.clear(); context.viewerSelectedIds.add('999');
    await context.openImpactModal();
    el('impactPhrase').value = 'CONFIRM'; context.checkImpactPhrase();
    assert.equal(el('impactDeleteBtn').disabled, true);
    await context.openViewer('Clinics');
    assert.equal(context.viewerSelectedIds.size, 0);
    assert.equal(el('viewerDeletedFilterWrap').style.display, 'none');
    assert.equal(el('viewerDeletedFilter').value, 'all');
    el('viewerDeletedFilter').value = 'deleted';
    context.applyViewerFilter();
    assert.equal(context.viewerFiltRows.length, patients.length, 'Other tables ignore patient status filter');
    assert.equal(context.viewerColumnLabel('id'), 'id');
    assert.equal(context.viewerCols[0], 'id');
    assert.equal(context.viewerVis.id, true);
    console.log('PASS: matching Patient IDs, fallback, safe text, column order, multiple matches, exact deletion target, fresh selections, and impact failure/loading guards');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
