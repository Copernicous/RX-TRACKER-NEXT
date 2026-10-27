'use strict';
const assert = require('assert/strict');
if (process.env.DB_HOST !== '127.0.0.1' || process.env.DB_NAME !== 'rx_next_ci_profile_test' || process.env.RX_LOCAL_RELEASE_TEST !== '1') throw Error('Dedicated disposable profile test database required.');
const db = require('../models');
const controls = require('../services/rxProfileSyncControl');
const controller = require('../controllers/rxProfileSyncController');
async function call(method, req = {}) {
    const res = { code: 200, status(n) { this.code = n; return this; }, json(value) { this.body = value; } };
    await method({ query: {}, body: {}, params: {}, ...req }, res); return res;
}
async function main() {
    const role = await db.Role.findOne({ where: { name: 'Administrator' } });
    const user = await db.User.create({ username: 'CONTROL-TEST', firstName: 'Synthetic', lastName: 'Administrator', roleId: role.id, passwordHash: 'not-a-login', isActive: true });
    const pharmacy = await db.Pharmacy.create({ name: 'Synthetic Pharmacy', isActive: true });
    const patient = await db.Patient.create({ firstName: 'Synthetic', lastName: 'Control', patientCode: 'CONTROL-001', isActive: true, pharmacyId: pharmacy.id });
    const day = new Date().toISOString().slice(0, 10), boundary = new Date(day + 'T00:00:00.000Z');
    const oldRx = await db.RXRecord.create({ patientId: patient.id, pharmacyId: null, updatedAt: boundary, createdAt: new Date(boundary.getTime() - 1) }, { silent: true });
    const rx = await db.RXRecord.create({ patientId: patient.id, pharmacyId: null, createdAt: boundary, updatedAt: boundary }, { silent: true });
    assert.equal((await controls.get()).enabled, false);
    assert.deepEqual((await call(controller.list)).body.rows, []);
    const pausedSync = await call(controller.sync, { params: { rxId: rx.id }, user }); assert.equal(pausedSync.code, 409, JSON.stringify(pausedSync.body));
    assert.equal((await call(controller.bulkSync, { body: { entries: [{ rxId: rx.id, fields: ['pharmacyId'] }] }, user })).code, 409);
    assert.throws(() => controls.validate({ enabled: true, startDate: null }), /starting date/);
    assert.throws(() => controls.validate({ enabled: true, startDate: '2026-02-30' }), /valid/);
    await controls.save({ enabled: true, startDate: day }, user);
    let rows = (await call(controller.list)).body.rows;
    assert(rows.some(row => row.rxId === rx.id)); assert(!rows.some(row => row.rxId === oldRx.id));
    assert.equal((await call(controller.sync, { params: { rxId: oldRx.id }, body: { fields: ['pharmacyId'] }, user })).code, 400);
    await controls.save({ enabled: false, startDate: day }, user);
    const beforePatient = JSON.stringify((await db.Patient.findByPk(patient.id)).toJSON());
    const beforeRx = JSON.stringify((await db.RXRecord.findByPk(rx.id)).toJSON());
    const historyCount = await db.RXHistory.count();
    rows = (await call(controller.list, { query: { manualReview: 'true' } })).body.rows;
    assert(rows.some(row => row.rxId === rx.id));
    const reviewed = await call(controller.review, { params: { rxId: rx.id }, body: { fields: ['pharmacyId'], reason: 'Intentionally ignored during manual work' }, user });
    assert.equal(reviewed.code, 200); assert.equal(reviewed.body.changed, true);
    assert(!(await call(controller.list, { query: { manualReview: 'true' } })).body.rows.some(row => row.rxId === rx.id));
    assert((await call(controller.list, { query: { manualReview: 'true', reviewStatus: 'reviewed' } })).body.rows.some(row => row.rxId === rx.id));
    assert.equal(JSON.stringify((await db.Patient.findByPk(patient.id)).toJSON()), beforePatient);
    assert.equal(JSON.stringify((await db.RXRecord.findByPk(rx.id)).toJSON()), beforeRx);
    assert.equal(await db.RXHistory.count(), historyCount);
    assert.equal((await call(controller.sync, { params: { rxId: rx.id }, body: { fields: ['pharmacyId'] }, user })).code, 409);
    assert.equal((await controls.get()).enabled, false);
    console.log('PASS persisted default-off/pause, single/bulk write gates, inclusive starting date, explicit paused review and ignored decisions without patient/RX/history changes.');
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => db.sequelize.close());
