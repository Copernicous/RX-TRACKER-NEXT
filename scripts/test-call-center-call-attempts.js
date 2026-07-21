'use strict';

const assert = require('assert');
const { prepareStagingEnv } = require('./lib/staging-env');

const staging = prepareStagingEnv();
process.env.DB_NAME = process.env.CALL_ATTEMPT_TEST_DB_NAME || (staging.dbName.replace(/[^A-Za-z0-9_]/g, '_') + '_ui_smoke');
if (!/(ui_smoke|test)/i.test(process.env.DB_NAME)) {
    throw new Error('Refusing call-attempt integration test on a non-test database.');
}

const db = require('../models');
const controller = require('../controllers/callAttemptController');

const runId = String(Date.now());
const created = { userId: null, clinicId: null, patientIds: [], attemptIds: [], auditIds: [] };

function response() {
    return {
        statusCode: 200,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; }
    };
}

function request(user, body, params) {
    return {
        user,
        body: body || {},
        params: params || {},
        headers: {},
        ip: '127.0.0.1',
        connection: { remoteAddress: '127.0.0.1' }
    };
}

async function cleanup() {
    if (created.patientIds.length) await db.CallCenterLock.destroy({ where: { patientId: created.patientIds } }).catch(() => {});
    if (created.attemptIds.length) await db.CallCenterCallAttempt.destroy({ where: { id: created.attemptIds } }).catch(() => {});
    if (created.auditIds.length) await db.AuditLog.destroy({ where: { id: created.auditIds } }).catch(() => {});
    if (created.userId) {
        await db.UserSoftphoneAccount.destroy({ where: { userId: created.userId } }).catch(() => {});
        await db.User.destroy({ where: { id: created.userId } }).catch(() => {});
    }
    if (created.patientIds.length) await db.Patient.destroy({ where: { id: created.patientIds } }).catch(() => {});
    if (created.clinicId) await db.Clinic.destroy({ where: { id: created.clinicId } }).catch(() => {});
}

async function main() {
    try {
        await db.sequelize.authenticate();
        await db.sequelize.sync();
        // sequelize.sync does not revise an existing FK action in the persistent
        // isolated test DB. Keep it aligned with the production migration.
        await db.sequelize.query('ALTER TABLE "CallCenterCallAttempts" DROP CONSTRAINT IF EXISTS "CallCenterCallAttempts_patientId_fkey"');
        await db.sequelize.query('ALTER TABLE "CallCenterCallAttempts" ADD CONSTRAINT "CallCenterCallAttempts_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patients" (id) ON UPDATE CASCADE ON DELETE SET NULL');
        const role = await db.Role.findOne({ where: { name: 'Call Center' } })
            || await db.Role.create({ name: 'Call Center', isSystem: true, permissions: {} });
        const user = await db.User.create({
            firstName: 'Attempt',
            lastName: 'Agent',
            username: 'attempt-agent-' + runId,
            passwordHash: 'not-used',
            roleId: role.id,
            isActive: true
        });
        created.userId = user.id;
        await db.UserSoftphoneAccount.create({
            userId: user.id,
            server: '192.0.2.10',
            port: 5060,
            username: 'ext-' + runId.slice(-6),
            displayName: 'Attempt Agent',
            localSipPort: 0,
            encryptedPassword: 'test-only-ciphertext',
            isEnabled: true
        });
        const clinic = await db.Clinic.create({ name: 'Attempt Clinic ' + runId, isActive: true });
        created.clinicId = clinic.id;
        const patient = await db.Patient.create({
            firstName: 'Attempt',
            lastName: 'Patient',
            dob: '1980-01-01',
            phone: '555-010-1234',
            serviceDate: '2026-01-01',
            clinicId: clinic.id,
            patientCode: ('ATT-' + runId).slice(0, 60),
            isActive: true,
            isDeleted: false
        });
        created.patientIds.push(patient.id);
        const reqUser = { id: user.id, firstName: user.firstName, lastName: user.lastName, username: user.username };

        await db.CallCenterLock.create({
            patientId: patient.id,
            userId: user.id,
            lockedAt: new Date(),
            expiresAt: new Date(Date.now() + 15000)
        });

        const startRes = response();
        await controller.startAttempt(request(reqUser, { patientId: patient.id, dialedNumber: '5550101234' }), startRes);
        assert.strictEqual(startRes.statusCode, 201, JSON.stringify(startRes.body));
        const first = startRes.body.attempt;
        created.attemptIds.push(first.id);
        assert(first.correlationId, 'A server correlation id is required before dialing.');
        assert.strictEqual(first.extension.startsWith('ext-'), true, 'Extension snapshot is missing.');
        let activeLock = await db.CallCenterLock.findOne({ where: { patientId: patient.id, userId: user.id } });
        assert(new Date(activeLock.expiresAt).getTime() - Date.now() > 9 * 60 * 1000, 'Starting an RX Softphone attempt must extend the active call claim.');

        const base = Date.now() - 30000;
        await db.CallCenterCallAttempt.update({ dialedAt: new Date(base) }, { where: { id: first.id } });
        const ringRes = response();
        await controller.updateAttempt(request(reqUser, {
            state: 'ringing',
            ringingAt: new Date(base + 5000).toISOString(),
            sipResponseCode: 180,
            sipReason: 'Ringing'
        }, { id: String(first.id) }), ringRes);
        assert.strictEqual(ringRes.statusCode, 200, JSON.stringify(ringRes.body));
        assert.strictEqual(ringRes.body.calledRecorded, false, 'Ringing must not record Called.');

        const answerRes = response();
        await controller.updateAttempt(request(reqUser, {
            state: 'connected',
            answeredAt: new Date(base + 12000).toISOString(),
            sipResponseCode: 200,
            sipReason: 'OK'
        }, { id: String(first.id) }), answerRes);
        assert.strictEqual(answerRes.statusCode, 200, JSON.stringify(answerRes.body));
        assert.strictEqual(answerRes.body.calledRecorded, true, 'Answered call should record Called automatically.');
        created.auditIds.push((await db.CallCenterCallAttempt.findByPk(first.id)).calledAuditLogId);

        const duplicateAnswerRes = response();
        await controller.updateAttempt(request(reqUser, {
            state: 'connected',
            answeredAt: new Date(base + 12000).toISOString(),
            sipResponseCode: 200,
            sipReason: 'OK'
        }, { id: String(first.id) }), duplicateAnswerRes);
        const calledCount = await db.AuditLog.count({ where: { module: 'Call Center', action: 'Called', recordId: patient.id } });
        assert.strictEqual(calledCount, 1, 'Repeated connected snapshots must not duplicate Called.');

        const endRes = response();
        await controller.updateAttempt(request(reqUser, {
            state: 'ended',
            endedAt: new Date(base + 27000).toISOString(),
            outcome: 'answered',
            sipResponseCode: 200,
            sipReason: 'Normal clearing'
        }, { id: String(first.id) }), endRes);
        assert.strictEqual(endRes.body.attempt.outcome, 'answered');
        assert.strictEqual(endRes.body.attempt.ringDurationSeconds, 7);
        assert.strictEqual(endRes.body.attempt.conversationDurationSeconds, 15);
        activeLock = await db.CallCenterLock.findOne({ where: { patientId: patient.id, userId: user.id } });
        const terminalLeaseMs = new Date(activeLock.expiresAt).getTime() - Date.now();
        assert(terminalLeaseMs > 0 && terminalLeaseMs <= 16000, 'A terminal call must shorten the patient claim to the inactive timeout.');

        const noAnswerStart = response();
        await controller.startAttempt(request(reqUser, { patientId: patient.id, dialedNumber: '5550101234' }), noAnswerStart);
        const second = noAnswerStart.body.attempt;
        created.attemptIds.push(second.id);
        const noAnswerEnd = response();
        await controller.updateAttempt(request(reqUser, {
            state: 'failed',
            endedAt: new Date().toISOString(),
            outcome: 'no_answer',
            sipResponseCode: 408,
            sipReason: 'Request Timeout'
        }, { id: String(second.id) }), noAnswerEnd);
        assert.strictEqual(noAnswerEnd.body.attempt.outcome, 'no_answer');
        assert.strictEqual(noAnswerEnd.body.attempt.calledRecorded, false, 'No-answer attempt must not record Called.');
        assert.strictEqual(await db.AuditLog.count({ where: { module: 'Call Center', action: 'Called', recordId: patient.id } }), 1);

        await patient.destroy();
        created.patientIds = created.patientIds.filter(id => id !== patient.id);
        const retained = await db.CallCenterCallAttempt.findByPk(first.id);
        assert.strictEqual(retained.patientId, null, 'Permanent patient deletion should detach, not delete, call analytics.');
        assert.strictEqual(retained.patientCode, patient.patientCode, 'Detached analytics should retain the historical patient reference until privacy anonymization.');

        console.log('PASS automatic Call Center call-attempt lifecycle, Called recording, and history retention.');
    } finally {
        await cleanup();
        await db.sequelize.close().catch(() => {});
    }
}

main().catch(err => {
    console.error('FAIL Call Center call-attempt lifecycle regression');
    console.error(err);
    process.exit(1);
});
