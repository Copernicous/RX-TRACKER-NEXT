'use strict';

const assert = require('assert');
const { Op } = require('sequelize');
const { prepareStagingEnv } = require('./lib/staging-env');

const explicitDatabase = String(process.env.CALL_CENTER_PAGINATION_TEST_DB_NAME || '').trim();
if (explicitDatabase) {
    process.env.DB_NAME = explicitDatabase;
} else {
    const staging = prepareStagingEnv();
    process.env.DB_NAME = staging.dbName;
}
if (!/(test|qa|staging|stage|sandbox|copy)/i.test(String(process.env.DB_NAME || ''))) {
    throw new Error('Refusing Call Center pagination regression on a non-test database.');
}

const db = require('../models');
const controller = require('../controllers/callCenterController');

const runId = String(Date.now());
const marker = `CCPAGE${runId}`;
const created = {
    patientIds: [],
    auditIds: [],
    clinicId: null,
    transportId: null,
    userId: null,
    roleId: null
};

function dateFromToday(days) {
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() + days);
    return date.toISOString().slice(0, 10);
}

function timeOnly(date) {
    return date.toTimeString().split(' ')[0];
}

function runHandler(query, user) {
    return new Promise((resolve, reject) => {
        const res = {
            statusCode: 200,
            set() { return this; },
            status(code) {
                this.statusCode = code;
                return this;
            },
            json(payload) {
                if (this.statusCode >= 400) {
                    return reject(new Error(payload.error || payload.message || String(this.statusCode)));
                }
                resolve(payload);
            }
        };
        Promise.resolve(controller.listPatients({
            query,
            user,
            authToken: `${marker}-session`
        }, res)).catch(reject);
    });
}

async function createCallAudit(userId, patientId, secondsAgo) {
    const at = new Date(Date.now() - secondsAgo * 1000);
    const row = await db.AuditLog.create({
        userId,
        date: at.toISOString().slice(0, 10),
        time: timeOnly(at),
        module: 'Call Center',
        action: 'Called',
        recordId: patientId,
        previousValue: null,
        newValue: null,
        ipAddress: '127.0.0.1',
        createdAt: at,
        updatedAt: at
    });
    created.auditIds.push(row.id);
}

async function cleanup() {
    if (created.auditIds.length) {
        await db.AuditLog.destroy({ where: { id: { [Op.in]: created.auditIds } } }).catch(() => {});
    }
    if (created.patientIds.length) {
        await db.PatientNote.destroy({ where: { patientId: { [Op.in]: created.patientIds } } }).catch(() => {});
        await db.PatientServiceDateHistory.destroy({ where: { patientId: { [Op.in]: created.patientIds } } }).catch(() => {});
        await db.PatientServiceDateCycle.destroy({ where: { patientId: { [Op.in]: created.patientIds } } }).catch(() => {});
        await db.Patient.destroy({ where: { id: { [Op.in]: created.patientIds } } }).catch(() => {});
    }
    if (created.userId) await db.User.destroy({ where: { id: created.userId } }).catch(() => {});
    if (created.roleId) await db.Role.destroy({ where: { id: created.roleId } }).catch(() => {});
    if (created.clinicId) await db.Clinic.destroy({ where: { id: created.clinicId } }).catch(() => {});
    if (created.transportId) {
        await db.PatientTransportCompany.destroy({ where: { id: created.transportId } }).catch(() => {});
    }
}

async function createFixtures() {
    const role = await db.Role.create({
        name: `${marker} Call Center`,
        permissions: { call_center: { visible: true, canAdd: true } },
        isSystem: false
    });
    created.roleId = role.id;
    const user = await db.User.create({
        firstName: 'Pagination',
        lastName: 'Agent',
        username: `${marker.toLowerCase()}-agent`,
        passwordHash: 'not-used',
        roleId: role.id,
        isActive: true
    });
    created.userId = user.id;
    const clinic = await db.Clinic.create({ name: `${marker} Clinic`, isActive: true });
    created.clinicId = clinic.id;
    const transport = await db.PatientTransportCompany.create({
        companyName: `${marker} Transport`,
        contactPerson: 'Pagination Dispatcher',
        isActive: true
    });
    created.transportId = transport.id;

    const firstNames = ['ALPHA', 'BRAVO', 'CHARLIE', 'DELTA', 'ECHO', 'FOXTROT', 'GOLF'];
    const patients = await db.Patient.bulkCreate(firstNames.map((firstName, index) => ({
        firstName,
        lastName: marker,
        patientCode: `${marker}-${index + 1}`.slice(0, 60),
        dob: '1980-01-01',
        phone: index === 6 ? '(555) 909-0707' : `555-010-${String(index).padStart(4, '0')}`,
        serviceDate: dateFromToday(-200 + index),
        clinicId: clinic.id,
        patientTransportCompanyId: transport.id,
        notes: `Pagination fixture ${index + 1}`,
        isActive: true,
        isDeleted: false,
        isNonCompanyPatient: false
    })), { returning: true });
    created.patientIds.push(...patients.map((patient) => patient.id));
    await createCallAudit(user.id, patients[0].id, 40);
    await createCallAudit(user.id, patients[0].id, 30);
    await createCallAudit(user.id, patients[0].id, 20);
    await createCallAudit(user.id, patients[1].id, 10);
    return { user, patients };
}

async function main() {
    await db.sequelize.authenticate();
    const fixtures = await createFixtures();
    const requestUser = {
        id: fixtures.user.id,
        firstName: fixtures.user.firstName,
        lastName: fixtures.user.lastName,
        username: fixtures.user.username
    };

    const originalQuery = db.sequelize.query;
    const observedSql = [];
    db.sequelize.query = function(sql, options) {
        observedSql.push(typeof sql === 'string' ? sql : String(sql));
        return originalQuery.call(this, sql, options);
    };

    try {
        let payload = await runHandler({
            page: '1',
            pageSize: '5',
            q: marker,
            sort: 'firstName',
            dir: 'asc'
        }, requestUser);
        assert.strictEqual(payload.total, 7);
        assert.strictEqual(payload.totalPages, 2);
        assert.deepStrictEqual(payload.rows.map(row => row.firstName), ['ALPHA', 'BRAVO', 'CHARLIE', 'DELTA', 'ECHO']);

        const boundedIdQuery = observedSql.find(sql =>
            /FROM "Patients" p/i.test(sql)
            && /LIMIT :limit OFFSET :offset/i.test(sql)
        );
        assert(boundedIdQuery, 'Call Center must issue a bounded database ID-page query.');
        const boundedDetailQuery = observedSql.find(sql =>
            /FROM "Patients" p/i.test(sql)
            && /WHERE p\.id IN \(:ids\)/i.test(sql)
            && /LEFT JOIN "Clinics" c/i.test(sql)
            && /LEFT JOIN "PatientTransportCompanies" pt/i.test(sql)
        );
        assert(boundedDetailQuery, 'Call Center details must load only the selected page IDs with the lightweight detail query.');
        console.log('PASS: Call Center queue is bounded before details and history load');

        payload = await runHandler({
            page: '2',
            pageSize: '5',
            q: marker,
            sort: 'firstName',
            dir: 'asc'
        }, requestUser);
        assert.deepStrictEqual(payload.rows.map(row => row.firstName), ['FOXTROT', 'GOLF']);

        payload = await runHandler({
            page: '1',
            pageSize: '10',
            q: '5559090707'
        }, requestUser);
        assert.strictEqual(payload.total, 1);
        assert.strictEqual(payload.rows[0].firstName, 'GOLF');

        payload = await runHandler({
            page: '1',
            pageSize: '10',
            q: `${marker} Transport`
        }, requestUser);
        assert.strictEqual(payload.total, 7);

        payload = await runHandler({
            page: '1',
            pageSize: '10',
            q: marker,
            sort: 'callCount',
            dir: 'desc'
        }, requestUser);
        assert.deepStrictEqual(payload.rows.slice(0, 2).map(row => row.firstName), ['ALPHA', 'BRAVO']);
        assert.deepStrictEqual(payload.rows.slice(0, 2).map(row => row.callCount), [3, 1]);

        payload = await runHandler({
            view: 'called-today',
            page: '1',
            pageSize: '5',
            q: marker
        }, requestUser);
        assert.strictEqual(payload.activityTotal, 4);
        assert.strictEqual(payload.total, 2);
        assert.deepStrictEqual(payload.rows.map(row => row.firstName), ['BRAVO', 'ALPHA']);
        console.log('PASS: search, normalized phone, relation search, history sorting, and activity pagination preserved');
    } finally {
        db.sequelize.query = originalQuery;
    }
}

main()
    .then(async () => {
        await cleanup();
        await db.sequelize.close();
        console.log('Call Center database-side pagination regression passed.');
    })
    .catch(async error => {
        console.error(error.stack || error.message);
        await cleanup();
        await db.sequelize.close().catch(() => {});
        process.exit(1);
    });
