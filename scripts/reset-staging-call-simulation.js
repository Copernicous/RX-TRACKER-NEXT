'use strict';

const assert = require('assert');
const crypto = require('crypto');
const { prepareStagingEnv } = require('./lib/staging-env');

const staging = prepareStagingEnv();
const confirmation = String(process.env.STAGING_CALL_SIM_CONFIRM || '');
const db = require('../models');

function assertSafeTarget() {
    assert(
        /(staging|stage|qa|test|sandbox|copy)/i.test(staging.dbName),
        'Refusing Call Center reset because DB_NAME is not marked as non-production.'
    );
    assert.strictEqual(
        confirmation,
        staging.dbName,
        'Set STAGING_CALL_SIM_CONFIRM to the exact staging DB name (' + staging.dbName + ').'
    );
    assert.notStrictEqual(
        String(staging.rootEnv.DB_NAME || '').toLowerCase(),
        String(staging.dbName).toLowerCase(),
        'Refusing Call Center reset because staging and root .env use the same database.'
    );
}

function localDateParts(value) {
    const date = new Date(value);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return {
        date: year + '-' + month + '-' + day,
        time: date.toTimeString().split(' ')[0]
    };
}

function userLabel(user) {
    const full = ((user && user.firstName || '') + ' ' + (user && user.lastName || '')).trim();
    return full || (user && user.username) || 'Staging user';
}

async function main() {
    assertSafeTarget();
    await db.sequelize.authenticate();

    const account = await db.UserSoftphoneAccount.findOne({
        where: { isEnabled: true },
        include: [{ model: db.User, as: 'User', required: true }],
        order: [['id', 'ASC']]
    });
    assert(account && account.User, 'A saved staging phone account and user are required for the simulation.');

    const patient = await db.Patient.findOne({
        where: {
            [db.Sequelize.Op.or]: [{ isDeleted: false }, { isDeleted: null }]
        },
        include: [{ model: db.Clinic, required: false }],
        order: [['id', 'ASC']]
    });
    assert(patient, 'An active staging patient is required for the simulation.');
    assert(String(patient.phone || '').trim(), 'The staging simulation patient needs a phone number.');

    const endedAt = new Date();
    const dialedAt = new Date(endedAt.getTime() - 50 * 1000);
    const ringingAt = new Date(endedAt.getTime() - 45 * 1000);
    const answeredAt = new Date(endedAt.getTime() - 39 * 1000);
    const parts = localDateParts(answeredAt);

    await db.sequelize.transaction(async transaction => {
        await db.CallCenterCallAttempt.destroy({ where: {}, transaction });
        await db.CallCenterLock.destroy({ where: {}, transaction });
        await db.PatientNote.destroy({ where: { source: 'Call Center' }, transaction });
        await db.PatientServiceDateHistory.destroy({ where: { changeSource: 'Call Center' }, transaction });
        await db.AuditLog.destroy({ where: { module: 'Call Center' }, transaction });

        const attempt = await db.CallCenterCallAttempt.create({
            patientId: patient.id,
            userId: account.User.id,
            correlationId: crypto.randomUUID(),
            phoneClient: 'rx_softphone',
            direction: 'outbound',
            state: 'ended',
            outcome: 'answered',
            patientCode: patient.patientCode || null,
            patientName: ((patient.firstName || '') + ' ' + (patient.lastName || '')).trim(),
            clinicName: patient.Clinic && patient.Clinic.name || null,
            agentName: userLabel(account.User),
            extension: account.username,
            dialedNumber: String(patient.phone).replace(/[^0-9+*#]/g, ''),
            sipResponseCode: 200,
            sipReason: 'OK (staging simulation)',
            dialedAt,
            ringingAt,
            answeredAt,
            endedAt,
            ringDurationSeconds: 6,
            conversationDurationSeconds: 39
        }, { transaction });

        const audit = await db.AuditLog.create({
            userId: account.User.id,
            date: parts.date,
            time: parts.time,
            module: 'Call Center',
            action: 'Called',
            recordId: patient.id,
            previousValue: null,
            newValue: {
                phoneClient: 'rx_softphone',
                autoRecorded: true,
                stagingSimulation: true,
                callAttemptId: attempt.id,
                answerAcknowledged: true,
                callDialedAt: dialedAt,
                callAnsweredAt: answeredAt,
                callEndedAt: endedAt,
                callDurationSeconds: 39,
                callOutcome: 'answered',
                sipResponseCode: 200,
                sipReason: 'OK (staging simulation)'
            },
            ipAddress: '127.0.0.1'
        }, { transaction });

        await attempt.update({ calledAuditLogId: audit.id }, { transaction });
    });

    assert.strictEqual(await db.CallCenterCallAttempt.count(), 1, 'Expected exactly one staging call attempt.');
    assert.strictEqual(await db.AuditLog.count({ where: { module: 'Call Center' } }), 1, 'Expected exactly one staging Call Center audit.');
    console.log('PASS staging Call Center history reset on ' + staging.dbName + '.');
    console.log('PASS preserved users, phone assignments, patients, and non-Call-Center data.');
    console.log('PASS created one answered RX Softphone staging simulation.');
}

main()
    .catch(err => {
        console.error('FAIL staging Call Center simulation reset');
        console.error(err.stack || err.message);
        process.exitCode = 1;
    })
    .finally(async () => {
        await db.sequelize.close().catch(() => {});
    });
