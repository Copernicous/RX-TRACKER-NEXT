'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const db = require('../models');
const controller = require('../controllers/rxProfileSyncController');

async function runSync(rx, fields) {
    const historyRows = [];
    const auditRows = [];
    const original = {
        transaction: db.sequelize.transaction,
        findOne: db.RXRecord.findOne,
        historyCreate: db.RXHistory.create,
        auditCreate: db.AuditLog.create
    };

    db.sequelize.transaction = callback => callback({ LOCK: { UPDATE: 'UPDATE' } });
    db.RXRecord.findOne = async () => rx;
    db.RXHistory.create = async row => {
        historyRows.push(row);
        return row;
    };
    db.AuditLog.create = async row => {
        auditRows.push(row);
        return row;
    };

    try {
        let resolveResponse;
        const resultPromise = new Promise(resolve => {
            resolveResponse = resolve;
        });
        const res = {
            statusCode: 200,
            status(code) {
                this.statusCode = code;
                return this;
            },
            json(payload) {
                resolveResponse({ status: this.statusCode, payload });
            }
        };
        await controller.sync({
            params: { rxId: String(rx.id) },
            body: { fields },
            user: { id: 91 },
            ip: '127.0.0.1'
        }, res);
        return { result: await resultPromise, historyRows, auditRows };
    } finally {
        db.sequelize.transaction = original.transaction;
        db.RXRecord.findOne = original.findOne;
        db.RXHistory.create = original.historyCreate;
        db.AuditLog.create = original.auditCreate;
    }
}

async function runBulk(records, entries) {
    const historyRows = [];
    const auditRows = [];
    const original = {
        transaction: db.sequelize.transaction,
        findOne: db.RXRecord.findOne,
        historyCreate: db.RXHistory.create,
        auditCreate: db.AuditLog.create
    };
    db.sequelize.transaction = callback => callback({ LOCK: { UPDATE: 'UPDATE' } });
    db.RXRecord.findOne = async query => records.get(Number(query.where.id));
    db.RXHistory.create = async row => { historyRows.push(row); return row; };
    db.AuditLog.create = async row => { auditRows.push(row); return row; };
    try {
        let resolveResponse;
        const resultPromise = new Promise(resolve => { resolveResponse = resolve; });
        const res = {
            statusCode: 200,
            status(code) { this.statusCode = code; return this; },
            json(payload) { resolveResponse({ status: this.statusCode, payload }); }
        };
        await controller.bulkSync({
            body: { entries },
            user: { id: 92 },
            ip: '127.0.0.2'
        }, res);
        return { result: await resultPromise, historyRows, auditRows };
    } finally {
        db.sequelize.transaction = original.transaction;
        db.RXRecord.findOne = original.findOne;
        db.RXHistory.create = original.historyCreate;
        db.AuditLog.create = original.auditCreate;
    }
}

async function runExport(logs) {
    const original = db.AuditLog.findAll;
    db.AuditLog.findAll = async () => logs;
    const headers = {};
    try {
        let result;
        const res = {
            statusCode: 200,
            status(code) { this.statusCode = code; return this; },
            setHeader(name, value) { headers[name] = value; },
            send(payload) { result = { status: this.statusCode, payload }; },
            json(payload) { result = { status: this.statusCode, payload }; }
        };
        await controller.exportHistory({}, res);
        return { ...result, headers };
    } finally {
        db.AuditLog.findAll = original;
    }
}
function fakeRx(rxValues, patientValues, options = {}) {
    const state = {
        id: options.id || 501,
        patientId: options.patientId || 601,
        pharmacyId: rxValues.pharmacyId,
        patientTransportCompanyId: rxValues.patientTransportCompanyId,
        pharmacyTransportCompanyId: rxValues.pharmacyTransportCompanyId
    };
    const patient = {
        id: state.patientId,
        firstName: options.firstName || 'QA',
        lastName: options.lastName || 'Patient',
        patientCode: options.patientCode || 'QA-601',
        pharmacyId: patientValues.pharmacyId,
        patientTransportCompanyId: patientValues.patientTransportCompanyId,
        pharmacyTransportCompanyId: patientValues.pharmacyTransportCompanyId,
        get(field) {
            return this[field];
        }
    };
    const pending = {};
    return {
        id: state.id,
        Patient: patient,
        pharmacyUpdates: [],
        transportSaves: [],
        get(arg) {
            if (typeof arg === 'string') return state[arg];
            return { ...state };
        },
        async update(update) {
            this.pharmacyUpdates.push({ ...update });
            Object.assign(state, update);
        },
        setDataValue(field, value) {
            pending[field] = value;
        },
        async save({ fields }) {
            this.transportSaves.push([...fields]);
            fields.forEach(field => {
                if (field !== options.dropFieldOnSave) state[field] = pending[field];
            });
        },
        async reload() {
            return this;
        }
    };
}

async function main() {
    const allFields = ['pharmacyId', 'patientTransportCompanyId', 'pharmacyTransportCompanyId'];
    const rx = fakeRx(
        { pharmacyId: 1, patientTransportCompanyId: 2, pharmacyTransportCompanyId: 3 },
        { pharmacyId: 11, patientTransportCompanyId: 12, pharmacyTransportCompanyId: 13 }
    );
    const all = await runSync(rx, allFields);
    assert.strictEqual(all.result.status, 200);
    assert.strictEqual(all.result.payload.updated, true);
    assert.deepStrictEqual(all.result.payload.values, {
        pharmacyId: 11,
        patientTransportCompanyId: 12,
        pharmacyTransportCompanyId: 13
    });
    assert.strictEqual(all.historyRows.length, 1);
    assert.strictEqual(all.auditRows.length, 1);
    assert.deepStrictEqual(all.result.payload.changes.map(change => change.field), allFields);
    assert.deepStrictEqual(rx.pharmacyUpdates, [{ pharmacyId: 11 }]);
    assert.deepStrictEqual(rx.transportSaves, [['patientTransportCompanyId', 'pharmacyTransportCompanyId']]);

    const rescan = await runSync(rx, allFields);
    assert.strictEqual(rescan.result.status, 200);
    assert.strictEqual(rescan.result.payload.updated, false);
    assert.deepStrictEqual(rescan.result.payload.changes, []);
    assert.strictEqual(rescan.historyRows.length, 0);
    assert.strictEqual(rescan.auditRows.length, 0);

    const selected = fakeRx(
        { pharmacyId: 1, patientTransportCompanyId: 2, pharmacyTransportCompanyId: 3 },
        { pharmacyId: 11, patientTransportCompanyId: 12, pharmacyTransportCompanyId: 13 }
    );
    const selectedResult = await runSync(selected, ['patientTransportCompanyId']);
    assert.deepStrictEqual(selectedResult.result.payload.values, {
        pharmacyId: 1,
        patientTransportCompanyId: 12,
        pharmacyTransportCompanyId: 3
    });
    assert.deepStrictEqual(selected.pharmacyUpdates, []);
    assert.deepStrictEqual(selected.transportSaves, [['patientTransportCompanyId']]);

    const blankProfile = fakeRx(
        { pharmacyId: 1, patientTransportCompanyId: 2, pharmacyTransportCompanyId: 3 },
        { pharmacyId: null, patientTransportCompanyId: null, pharmacyTransportCompanyId: null }
    );
    const blankResult = await runSync(blankProfile, allFields);
    assert.strictEqual(blankResult.result.payload.updated, false);
    assert.deepStrictEqual(blankResult.result.payload.changes, []);
    assert.deepStrictEqual(blankProfile.pharmacyUpdates, []);
    assert.deepStrictEqual(blankProfile.transportSaves, []);

    const bulkRxOne = fakeRx(
        { pharmacyId: 1, patientTransportCompanyId: 2, pharmacyTransportCompanyId: 3 },
        { pharmacyId: 1, patientTransportCompanyId: 22, pharmacyTransportCompanyId: 3 },
        { id: 701, patientId: 801, patientCode: 'PT-801' }
    );
    const bulkRxTwo = fakeRx(
        { pharmacyId: 4, patientTransportCompanyId: 5, pharmacyTransportCompanyId: 6 },
        { pharmacyId: 4, patientTransportCompanyId: 5, pharmacyTransportCompanyId: 66 },
        { id: 702, patientId: 802, patientCode: 'PT-802' }
    );
    const bulk = await runBulk(new Map([[701, bulkRxOne], [702, bulkRxTwo]]), [
        { rxId: 701, fields: ['patientTransportCompanyId'] },
        { rxId: 702, fields: ['pharmacyTransportCompanyId'] }
    ]);
    assert.strictEqual(bulk.result.status, 200);
    assert.strictEqual(bulk.result.payload.updated, 2);
    assert.strictEqual(bulk.result.payload.failed, 0);
    assert.strictEqual(bulk.historyRows.length, 2);
    assert.strictEqual(bulk.auditRows.length, 2);

    const exported = await runExport([{
        get() {
            return {
                id: 901,
                createdAt: new Date('2026-07-30T14:00:00.000Z'),
                userId: 92,
                recordId: 701,
                previousValue: { rxId: 701, patientId: 801, patientCode: 'PT-801', patientName: 'QA Patient', fields: [{ field: 'patientTransportCompanyId', value: 2 }] },
                newValue: { rxId: 701, patientId: 801, patientCode: 'PT-801', patientName: 'QA Patient', source: 'Patient profile', fields: [{ field: 'patientTransportCompanyId', value: 22 }] },
                ipAddress: '127.0.0.2',
                User: { id: 92, username: 'qa_master' }
            };
        }
    }]);
    assert.strictEqual(exported.status, 200);
    assert.match(exported.headers['Content-Disposition'], /rx-profile-sync-history-/);
    assert.ok(exported.payload.startsWith('\uFEFFAudit Log ID,'));
    assert.match(exported.payload, /qa_master,701,801,PT-801,QA Patient,Patient Transport,patientTransportCompanyId,2,22/);
    const failed = fakeRx(
        { pharmacyId: 1, patientTransportCompanyId: 2, pharmacyTransportCompanyId: 3 },
        { pharmacyId: 11, patientTransportCompanyId: 12, pharmacyTransportCompanyId: 13 },
        { dropFieldOnSave: 'patientTransportCompanyId' }
    );
    const failedResult = await runSync(failed, allFields);
    assert.strictEqual(failedResult.result.status, 400);
    assert.match(failedResult.result.payload.error, /patientTransportCompanyId/);
    assert.strictEqual(failedResult.historyRows.length, 0);
    assert.strictEqual(failedResult.auditRows.length, 0);

    const viewSource = fs.readFileSync(path.join(__dirname, '..', 'views', 'backoffice.ejs'), 'utf8');
    const browserSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'backoffice-features.js'), 'utf8');
    const routeSource = fs.readFileSync(path.join(__dirname, '..', 'routes', 'apiRoutes.js'), 'utf8');
    const rxControllerSource = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'rxController.js'), 'utf8');
    assert.match(viewSource, /id="rxSyncBulkBtn"/);
    assert.match(viewSource, /Export Displayed Scan/);
    assert.match(viewSource, /Export All Scan/);
    assert.match(viewSource, /rxSyncPageSize/);
    assert.match(viewSource, /Export Sync History/);
    assert.match(browserSource, /function bulkSyncRxProfiles\(\)/);
    assert.match(browserSource, /function exportRxProfileSyncDisplay\(\)/);
    assert.match(browserSource, /function exportAllRxProfileSync\(\)/);
    assert.match(browserSource, /function nextRxProfileSyncPage\(\)/);
    assert.match(browserSource, /RX Patient Transport/);
    assert.match(browserSource, /Matches Patient profile/);
    assert.match(browserSource, /index < 100/);
    assert.match(browserSource, /Selected the first 100 RX records/);
    assert.match(browserSource, /function exportRxProfileSyncHistory\(\)/);
    assert.match(browserSource, /rxProfileSyncIncludesMatchingHistory/);
    assert.match(browserSource, /matching hidden/);
    assert.match(browserSource, /patientOrder/);
    assert.match(routeSource, /rx-profile-sync\/bulk/);
    assert.match(routeSource, /rx-profile-sync\/export/);
    const profileSyncControllerSource = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'rxProfileSyncController.js'), 'utf8');
    assert.match(profileSyncControllerSource, /rxHistoryScope === 'multi'/);
    assert.match(profileSyncControllerSource, /const rowsForCard = showAll \? group : qualifyingRows/);
    assert.match(profileSyncControllerSource, /patientCardPaging: true/);
    assert.match(
        rxControllerSource,
        /exports\.getOne[\s\S]*?RXRecord\.findByPk\(req\.params\.id,\s*\{\s*include:\s*rxInclude\(\)/,
        'The RX Details endpoint must include the same transport associations as the RX list.'
    );

    console.log('PASS: RX Profile Sync persists profile fields, re-scans changed Patient data, exports displayed before/after values and audited history, rejects partial saves, and exposes synced transports in RX Details.');
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
