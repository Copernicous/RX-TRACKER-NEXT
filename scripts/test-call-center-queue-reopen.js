if (!process.env.DB_NAME) {
    require('dotenv').config({ override: true });
}

const assert = require('assert');
const { Op } = require('sequelize');
const db = require('../models');
const adminController = require('../controllers/adminController');
const callCenterController = require('../controllers/callCenterController');

const RUN_ID = `cc-reopen-${Date.now()}`;

function dateFromToday(days) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
}

function timeOnly(date) {
    return date.toTimeString().split(' ')[0];
}

function makeRes() {
    return {
        statusCode: 200,
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(payload) {
            this.body = payload;
            return this;
        }
    };
}

async function createAudit(user, patient, action, minutesAgo, newValue) {
    const at = new Date(Date.now() - minutesAgo * 60 * 1000);
    return db.AuditLog.create({
        userId: user.id,
        date: at.toISOString().slice(0, 10),
        time: timeOnly(at),
        module: 'Call Center',
        action,
        recordId: patient.id,
        previousValue: null,
        newValue: newValue || null,
        ipAddress: '127.0.0.1',
        createdAt: at,
        updatedAt: at
    });
}

async function cleanup(created) {
    const patientIds = created.patients.map((row) => row.id);
    if (patientIds.length) {
        await db.CallCenterLock.destroy({ where: { patientId: { [Op.in]: patientIds } } }).catch(() => {});
        await db.AuditLog.destroy({ where: { recordId: { [Op.in]: patientIds }, module: 'Call Center' } }).catch(() => {});
        await db.PatientServiceDateHistory.destroy({ where: { patientId: { [Op.in]: patientIds } } }).catch(() => {});
        await db.Patient.destroy({ where: { id: { [Op.in]: patientIds } } }).catch(() => {});
    }
    if (created.users.length) {
        await db.User.destroy({ where: { id: { [Op.in]: created.users.map((row) => row.id) } } }).catch(() => {});
    }
    if (created.roles.length) {
        await db.Role.destroy({ where: { id: { [Op.in]: created.roles.map((row) => row.id) } } }).catch(() => {});
    }
    if (created.clinics.length) {
        await db.Clinic.destroy({ where: { id: { [Op.in]: created.clinics.map((row) => row.id) } } }).catch(() => {});
    }
}

async function main() {
    const created = { roles: [], users: [], clinics: [], patients: [] };
    try {
        await db.sequelize.authenticate();
        await db.sequelize.sync();

        const adminRole = await db.Role.create({ name: `Administrator ${RUN_ID}`, isSystem: false });
        const callCenterRole = await db.Role.create({ name: `Call Center ${RUN_ID}`, isSystem: false });
        created.roles.push(adminRole, callCenterRole);

        const adminUser = await db.User.create({
            firstName: 'Queue',
            lastName: 'Repair Admin',
            username: `${RUN_ID}-admin`,
            passwordHash: 'not-used',
            roleId: adminRole.id,
            isActive: true
        });
        const callCenterUser = await db.User.create({
            firstName: 'Queue',
            lastName: 'Repair Agent',
            username: `${RUN_ID}-agent`,
            passwordHash: 'not-used',
            roleId: callCenterRole.id,
            isActive: true
        });
        created.users.push(adminUser, callCenterUser);

        const clinic = await db.Clinic.create({
            name: `Queue Repair Clinic ${RUN_ID}`,
            address: '100 Smoke Test Way',
            phone: '555-0100',
            isActive: true
        });
        created.clinics.push(clinic);

        const oldServiceDate = dateFromToday(-130);
        const newServiceDate = dateFromToday(0);
        const patient = await db.Patient.create({
            firstName: 'Queue',
            lastName: `Reopen-${RUN_ID}`,
            dob: '1980-01-01',
            address: '100 Smoke Test Way',
            phone: '555-0101',
            serviceDate: oldServiceDate,
            clinicId: clinic.id,
            notes: 'Call Center queue reopen regression',
            isActive: true,
            isDeleted: false,
            patientCode: `QR-${RUN_ID}`.slice(0, 60),
            isNonCompanyPatient: false
        });
        created.patients.push(patient);

        await createAudit(callCenterUser, patient, 'Called', 20);
        const calledOnlyRes = makeRes();
        await callCenterController.listPatients({
            query: { q: patient.lastName, page: 1, pageSize: 10 },
            user: { id: callCenterUser.id, role: 'Call Center' },
            authToken: `${RUN_ID}-called-only-token`
        }, calledOnlyRes);
        assert.strictEqual(calledOnlyRes.statusCode, 200, 'Call Center called-only list failed: ' + JSON.stringify(calledOnlyRes.body));
        assert.strictEqual(calledOnlyRes.body.total, 0, 'Called-only patient should remain hidden from the new queue.');

        await patient.update({ serviceDate: newServiceDate });
        await createAudit(callCenterUser, patient, 'Service Date Added', 10, { serviceDate: newServiceDate });
        const history = await db.PatientServiceDateHistory.create({
            patientId: patient.id,
            previousServiceDate: oldServiceDate,
            newServiceDate,
            changedByUserId: callCenterUser.id,
            changeSource: 'Call Center',
            reason: 'Regression service date assignment'
        });

        const deleteRes = makeRes();
        await adminController.deleteRows({
            body: { tableName: 'PatientServiceDateHistories', ids: [history.id] },
            user: { id: adminUser.id, role: 'Administrator' },
            headers: {},
            ip: '127.0.0.1',
            connection: {}
        }, deleteRes);

        assert.strictEqual(deleteRes.statusCode, 200, 'Backoffice delete failed: ' + JSON.stringify(deleteRes.body));
        assert.strictEqual(deleteRes.body.results.callCenterQueueRepair.restoredPatients, 1, 'Patient service date was not restored.');
        assert.strictEqual(deleteRes.body.results.callCenterQueueRepair.reopenedQueuePatients, 1, 'Queue reopen marker was not created.');

        const reloaded = await db.Patient.findByPk(patient.id);
        assert.strictEqual(reloaded.serviceDate, oldServiceDate, 'Patient service date should return to previous eligible date.');

        const serviceDateAuditCount = await db.AuditLog.count({
            where: { module: 'Call Center', action: 'Service Date Added', recordId: patient.id }
        });
        assert.strictEqual(serviceDateAuditCount, 0, 'Service date audit should be removed after Backoffice delete.');

        const reopenAuditCount = await db.AuditLog.count({
            where: { module: 'Call Center', action: 'Queue Reopened', recordId: patient.id }
        });
        assert.strictEqual(reopenAuditCount, 1, 'Queue reopened audit should exist.');

        const listRes = makeRes();
        await callCenterController.listPatients({
            query: { q: patient.lastName, page: 1, pageSize: 10 },
            user: { id: callCenterUser.id, role: 'Call Center' },
            authToken: `${RUN_ID}-token`
        }, listRes);

        assert.strictEqual(listRes.statusCode, 200, 'Call Center list failed: ' + JSON.stringify(listRes.body));
        assert((listRes.body.rows || []).some((row) => row.id === patient.id), 'Restored patient should return to the Call Center queue.');
        assert.strictEqual(listRes.body.total, 1, 'Queue search should return exactly the restored patient.');

        console.log('PASS Call Center queue reopen after Backoffice service-date-history delete');
        console.log(JSON.stringify(deleteRes.body.results.callCenterQueueRepair));
    } finally {
        await cleanup(created);
        await db.sequelize.close().catch(() => {});
    }
}

main().catch((err) => {
    console.error('FAIL Call Center queue reopen regression');
    console.error(err);
    process.exit(1);
});
