if (!process.env.DB_NAME) {
    require('dotenv').config({ override: true });
}

const assert = require('assert');
const { Op } = require('sequelize');
const db = require('../models');
const adminController = require('../controllers/adminController');
const callCenterController = require('../controllers/callCenterController');
const { getCallCenterInactiveClaimSeconds } = require('../utils/globalSettings');

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
        await db.CallCenterCallAttempt.destroy({ where: { patientId: { [Op.in]: patientIds } } }).catch(() => {});
        await db.AuditLog.destroy({ where: { recordId: { [Op.in]: patientIds }, module: 'Call Center' } }).catch(() => {});
        await db.PatientServiceDateHistory.destroy({ where: { patientId: { [Op.in]: patientIds } } }).catch(() => {});
        await db.PatientServiceDateCycle.destroy({ where: { patientId: { [Op.in]: patientIds } } }).catch(() => {});
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

        const adminRole = await db.Role.create({ name: `Administrator ${RUN_ID}`, isSystem: false });
        const callCenterRole = await db.Role.create({
            name: `Call Center ${RUN_ID}`,
            isSystem: false,
            permissions: { call_center: { visible: true, canAdd: true } }
        });
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
        const secondCallCenterUser = await db.User.create({
            firstName: 'Queue',
            lastName: 'Second Agent',
            username: `${RUN_ID}-agent-2`,
            passwordHash: 'not-used',
            roleId: callCenterRole.id,
            isActive: true
        });
        created.users.push(adminUser, callCenterUser, secondCallCenterUser);

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

        await db.CallCenterLock.create({
            patientId: patient.id,
            userId: adminUser.id,
            lockedAt: new Date(),
            expiresAt: new Date(Date.now() + 10 * 60 * 1000)
        });
        const adminLockedRes = makeRes();
        await callCenterController.listPatients({
            query: { q: patient.lastName, page: 1, pageSize: 10 },
            user: { id: callCenterUser.id, role: 'Call Center' },
            authToken: `${RUN_ID}-admin-lock-token`
        }, adminLockedRes);
        assert.strictEqual(adminLockedRes.statusCode, 200, 'Call Center list failed with admin-held lock: ' + JSON.stringify(adminLockedRes.body));
        assert.strictEqual(adminLockedRes.body.total, 1, 'Admin-held queue locks should not hide eligible patients from Call Center agents.');
        assert((adminLockedRes.body.rows || []).some((row) => row.id === patient.id), 'Call Center agent should see patient even if an admin viewed the queue first.');
        assert.strictEqual(adminLockedRes.body.locksAcquired, false, 'Viewing a queue must not acquire patient claims.');
        assert.strictEqual(adminLockedRes.body.claimMode, 'on_dial', 'Queue must advertise click-to-dial claim behavior.');
        const untouchedAdminLock = await db.CallCenterLock.findOne({ where: { patientId: patient.id } });
        assert.strictEqual(untouchedAdminLock.userId, adminUser.id, 'Viewing a queue must not reassign an existing patient lock.');
        await untouchedAdminLock.destroy();

        const firstClaimRes = makeRes();
        await callCenterController.claimPatient({
            params: { id: String(patient.id) },
            user: { id: callCenterUser.id, role: 'Call Center' }
        }, firstClaimRes);
        assert.strictEqual(firstClaimRes.statusCode, 200, 'First agent should claim the patient when dialing.');
        const firstAgentLock = await db.CallCenterLock.findOne({ where: { patientId: patient.id, userId: callCenterUser.id } });
        const initialLeaseMs = new Date(firstAgentLock.expiresAt).getTime() - Date.now();
        const expectedInactiveLeaseMs = getCallCenterInactiveClaimSeconds() * 1000;
        assert(initialLeaseMs > 0 && initialLeaseMs <= expectedInactiveLeaseMs + 1000, 'Phone-click claim must use the configured inactive timeout before a call starts.');

        const cooldownStatusRes = makeRes();
        await callCenterController.getLockStatuses({
            query: { patientIds: String(patient.id) },
            user: { id: secondCallCenterUser.id, role: 'Call Center' }
        }, cooldownStatusRes);
        assert.strictEqual(cooldownStatusRes.statusCode, 200, 'Phone availability status failed.');
        assert.strictEqual(cooldownStatusRes.body.statuses[0].status, 'cooldown', 'A claimed row without an active attempt must be amber/cooldown.');
        assert.strictEqual(cooldownStatusRes.body.statuses[0].mine, false, 'A second agent must see the lock as belonging to another user.');
        assert.strictEqual(cooldownStatusRes.body.statuses[0].user, 'Queue Repair Agent', 'Availability status must identify the other agent.');

        const secondAgentListRes = makeRes();
        await callCenterController.listPatients({
            query: { q: patient.lastName, page: 1, pageSize: 10 },
            user: { id: secondCallCenterUser.id, role: 'Call Center' }
        }, secondAgentListRes);
        assert.strictEqual(secondAgentListRes.statusCode, 200, 'Second agent queue list failed.');
        assert.strictEqual(secondAgentListRes.body.total, 1, 'A claimed patient must stay visible so its colored phone status can explain who is using it.');

        const activeAttempt = await db.CallCenterCallAttempt.create({
            patientId: patient.id,
            userId: callCenterUser.id,
            correlationId: `${RUN_ID}-active`,
            phoneClient: 'rx_softphone',
            direction: 'outbound',
            state: 'connected',
            patientName: `${patient.firstName} ${patient.lastName}`,
            agentName: 'Queue Repair Agent',
            dialedNumber: patient.phone,
            dialedAt: new Date(),
            ringingAt: new Date(Date.now() - 12000),
            answeredAt: new Date(Date.now() - 5000)
        });
        const activeStatusRes = makeRes();
        await callCenterController.getLockStatuses({
            query: { patientIds: String(patient.id) },
            user: { id: secondCallCenterUser.id, role: 'Call Center' }
        }, activeStatusRes);
        assert.strictEqual(activeStatusRes.body.statuses[0].status, 'active', 'Dialing/ringing/connected rows must be red/in use.');
        assert.strictEqual(activeStatusRes.body.statuses[0].callState, 'connected', 'Availability must expose the active call state.');
        assert(activeStatusRes.body.statuses[0].connectedAt, 'A connected call must expose its answer timestamp for the live duration badge.');

        const conflictingClaimRes = makeRes();
        await callCenterController.claimPatient({
            params: { id: String(patient.id) },
            user: { id: secondCallCenterUser.id, role: 'Call Center' }
        }, conflictingClaimRes);
        assert.strictEqual(conflictingClaimRes.statusCode, 409, 'Second agent must not claim a patient while the first dial workflow is active.');
        await activeAttempt.destroy();

        const firstReleaseRes = makeRes();
        await callCenterController.releaseLocks({
            body: { patientIds: [patient.id] },
            user: { id: callCenterUser.id, role: 'Call Center' }
        }, firstReleaseRes);
        assert.strictEqual(firstReleaseRes.statusCode, 200, 'First agent lock release failed.');

        const secondClaimRes = makeRes();
        await callCenterController.claimPatient({
            params: { id: String(patient.id) },
            user: { id: secondCallCenterUser.id, role: 'Call Center' }
        }, secondClaimRes);
        assert.strictEqual(secondClaimRes.statusCode, 200, 'Second agent should claim the patient after release.');

        const secondReleaseRes = makeRes();
        await callCenterController.releaseLocks({
            body: { patientIds: [patient.id] },
            user: { id: secondCallCenterUser.id, role: 'Call Center' }
        }, secondReleaseRes);
        assert.strictEqual(secondReleaseRes.statusCode, 200, 'Second agent lock release failed.');

        const heartbeatWithoutClaimRes = makeRes();
        await callCenterController.refreshLocks({
            body: { patientIds: [patient.id] },
            user: { id: callCenterUser.id, role: 'Call Center' }
        }, heartbeatWithoutClaimRes);
        assert.strictEqual(heartbeatWithoutClaimRes.statusCode, 200, 'Claim heartbeat request failed.');
        assert.deepStrictEqual(heartbeatWithoutClaimRes.body.refreshed, [], 'A heartbeat must not create a patient claim.');
        assert.strictEqual(heartbeatWithoutClaimRes.body.conflicts.length, 1, 'Missing claim heartbeat should tell the browser to stop refreshing it.');
        assert.strictEqual(await db.CallCenterLock.count({ where: { patientId: patient.id } }), 0, 'A heartbeat without a phone-click claim must leave the patient unlocked.');

        const adminReviewRes = makeRes();
        await callCenterController.listPatients({
            query: { q: patient.lastName, page: 1, pageSize: 10 },
            user: { id: adminUser.id, role: 'Administrator' },
            authToken: `${RUN_ID}-admin-review-token`
        }, adminReviewRes);
        assert.strictEqual(adminReviewRes.statusCode, 200, 'Admin Call Center review list failed: ' + JSON.stringify(adminReviewRes.body));
        assert.strictEqual(adminReviewRes.body.total, 1, 'Agent-held queue locks should not hide eligible patients from admin review.');
        assert.strictEqual(adminReviewRes.body.locksAcquired, false, 'Admin review should not acquire Call Center queue locks.');

        await createAudit(callCenterUser, patient, 'Called', 20);
        const calledOnlyRes = makeRes();
        await callCenterController.listPatients({
            query: { q: patient.lastName, page: 1, pageSize: 10 },
            user: { id: callCenterUser.id, role: 'Call Center' },
            authToken: `${RUN_ID}-called-only-token`
        }, calledOnlyRes);
        assert.strictEqual(calledOnlyRes.statusCode, 200, 'Call Center called-only list failed: ' + JSON.stringify(calledOnlyRes.body));
        assert.strictEqual(calledOnlyRes.body.total, 1, 'Called-only eligible patient should remain in the queue until a new service date is accepted.');
        const calledOnlyRow = (calledOnlyRes.body.rows || []).find((row) => row.id === patient.id);
        assert(calledOnlyRow, 'Called-only eligible patient should be returned in the queue.');
        assert.strictEqual(calledOnlyRow.calledToday, true, 'Called-only row should still show that a call was already made today.');
        assert.strictEqual(calledOnlyRow.calledTodayCount, 1, 'Called-only row should keep today call count history.');

        await patient.update({ serviceDate: newServiceDate });
        await createAudit(callCenterUser, patient, 'Service Date Added', 10, { serviceDate: newServiceDate });
        await db.PatientServiceDateCycle.create({
            patientId: patient.id,
            serviceDate: newServiceDate,
            status: 'active',
            source: 'Call Center',
            startedAt: new Date(`${newServiceDate}T00:00:00`),
            metadata: { regression: RUN_ID }
        });
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
        assert.strictEqual(deleteRes.body.results.callCenterQueueRepair.closedServiceDateCycles, 1, 'Undone service date cycle was not closed.');

        const reloaded = await db.Patient.findByPk(patient.id);
        assert.strictEqual(reloaded.serviceDate, oldServiceDate, 'Patient service date should return to previous eligible date.');

        const undoneCycle = await db.PatientServiceDateCycle.findOne({
            where: { patientId: patient.id, serviceDate: newServiceDate }
        });
        assert.strictEqual(undoneCycle.status, 'historical', 'Undone service date cycle should become historical.');

        const restoredCycle = await db.PatientServiceDateCycle.findOne({
            where: { patientId: patient.id, serviceDate: oldServiceDate }
        });
        assert(restoredCycle, 'Restored previous service date cycle should exist.');
        assert.strictEqual(restoredCycle.status, 'active', 'Restored previous service date cycle should be active.');

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
