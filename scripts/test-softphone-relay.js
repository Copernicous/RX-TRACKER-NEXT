'use strict';

const assert = require('assert');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { prepareStagingEnv } = require('./lib/staging-env');

if (process.env.RELAY_TEST_DB_NAME) {
    process.env.DB_NAME = process.env.RELAY_TEST_DB_NAME;
    process.env.NODE_ENV = process.env.RELAY_TEST_NODE_ENV || process.env.NODE_ENV || 'development';
    process.env.PORT = process.env.RELAY_TEST_PORT || process.env.PORT || '3212';
    process.env.APP_ORIGINS = process.env.APP_ORIGINS || `http://127.0.0.1:${process.env.PORT}`;
} else {
    prepareStagingEnv();
}
const db = require('../models');
const relayController = require('../controllers/softphoneRelayController');
const { encryptPassword } = require('../services/softphoneAccountService');

function mockResponse() {
    return {
        statusCode: 200,
        headers: {},
        body: null,
        set(name, value) { this.headers[name] = value; return this; },
        status(code) { this.statusCode = code; return this; },
        json(value) { this.body = value; return this; }
    };
}

async function main() {
    const suffix = crypto.randomBytes(6).toString('hex');
    let user;
    let patient;
    let attempt;
    try {
        await db.sequelize.authenticate();
        user = await db.User.create({
            firstName: 'Relay',
            lastName: 'Smoke',
            username: `relay_smoke_${suffix}`,
            passwordHash: await bcrypt.hash(crypto.randomBytes(18).toString('base64url'), 4),
            isActive: true,
            isMaster: false
        });
        await db.UserSoftphoneAccount.create({
            userId: user.id,
            server: '192.0.2.10',
            port: 5060,
            username: `9${user.id}`,
            authId: `relay-auth-${user.id}`,
            displayName: 'Relay Smoke',
            localSipPort: 0,
            encryptedPassword: encryptPassword(user.id, crypto.randomBytes(24).toString('base64url')),
            isEnabled: true
        });

        const codeResponse = mockResponse();
        await relayController.createPairingCode({ user: { id: user.id } }, codeResponse);
        assert.strictEqual(codeResponse.statusCode, 200);
        assert.match(codeResponse.body.pairingCode, /^\d{8}$/);

        const baseUrl = `http://127.0.0.1:${process.env.PORT || 3100}`;
        const client = { version: '0.6.0', managedMode: true, allowManualDialing: true };
        const pairResponse = await fetch(`${baseUrl}/api/softphone-relay/device/pair`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pairingCode: codeResponse.body.pairingCode, deviceName: 'Relay Smoke Device', client })
        });
        const pair = await pairResponse.json();
        assert.strictEqual(pairResponse.status, 200);
        assert.ok(pair.deviceToken && pair.deviceToken.length >= 32);
        assert.strictEqual(pair.policy.mode, 'managed');
        assert.strictEqual(pair.policy.minimumClientVersion, '0.6.0');
        assert.strictEqual(pair.policy.allowLocalAccountChanges, false);

        const device = await db.SoftphoneRelayDevice.findOne({ where: { userId: user.id } });
        assert.ok(device && device.tokenHash);
        const command = await db.SoftphoneRelayCommand.create({
            deviceId: device.id,
            userId: user.id,
            commandType: 'hangup',
            payload: {},
            status: 'queued',
            expiresAt: new Date(Date.now() + 20000)
        });
        const snapshot = {
            registration: 'offline', call: 'idle', peer: null, incoming: false, muted: false,
            callId: null, server: '', port: 5060, username: '', localSipPort: 0
        };
        const pollResponse = await fetch(`${baseUrl}/api/softphone-relay/device/poll`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${pair.deviceToken}` },
            body: JSON.stringify({ snapshot, accountUpdatedAt: null, completedCommands: [], client })
        });
        const poll = await pollResponse.json();
        assert.strictEqual(pollResponse.status, 200);
        assert.strictEqual(poll.command.id, command.id);
        assert.strictEqual(poll.command.type, 'hangup');
        assert.strictEqual(poll.registration.username, `9${user.id}`);
        assert.strictEqual(poll.registration.authId, `relay-auth-${user.id}`);
        assert.strictEqual(poll.policy.accountAssigned, true);
        assert.strictEqual(poll.policy.allowLocalUnpair, false);
        assert.ok(poll.registration.password);

        const synchronizedSnapshot = {
            ...snapshot,
            registration: 'failed',
            server: poll.registration.server,
            port: poll.registration.port,
            username: poll.registration.username
        };

        const completeResponse = await fetch(`${baseUrl}/api/softphone-relay/device/poll`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${pair.deviceToken}` },
            body: JSON.stringify({
                snapshot: synchronizedSnapshot,
                accountUpdatedAt: poll.accountUpdatedAt,
                completedCommands: [{ commandId: command.id, success: true, error: null }],
                client
            })
        });
        const completedPoll = await completeResponse.json();
        assert.strictEqual(completeResponse.status, 200);
        assert.strictEqual(completedPoll.registration, null, 'A failed managed account must not be resent on every relay poll.');
        await command.reload();
        assert.strictEqual(command.status, 'completed');

        await device.reload();
        assert.strictEqual(device.snapshot.clientVersion, '0.6.0');
        assert.strictEqual(device.snapshot.managedMode, true);

        const dialedAt = new Date(Date.now() - 12000).toISOString();
        const ringingAt = new Date(Date.now() - 9000).toISOString();
        const connectedAt = new Date(Date.now() - 5000).toISOString();
        const connectedSnapshot = {
            ...synchronizedSnapshot,
            registration: 'registered',
            call: 'connected',
            peer: '3055550100',
            callId: `live-board-${suffix}`,
            dialedAt,
            ringingAt,
            connectedAt,
            endedAt: null,
            outcome: 'answered'
        };
        const connectedPollResponse = await fetch(`${baseUrl}/api/softphone-relay/device/poll`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${pair.deviceToken}` },
            body: JSON.stringify({
                snapshot: connectedSnapshot,
                accountUpdatedAt: poll.accountUpdatedAt,
                completedCommands: [],
                client
            })
        });
        assert.strictEqual(connectedPollResponse.status, 200);

        const manualListResponse = mockResponse();
        await relayController.getAdminDevices({ user: { id: user.id }, headers: {} }, manualListResponse);
        const manualEntry = manualListResponse.body.users.find(entry => Number(entry.id) === Number(user.id));
        assert.strictEqual(manualEntry.device.crmCall, null, 'A call without an RX Tracker attempt must not expose CRM patient context.');

        patient = await db.Patient.create({
            firstName: 'Relay',
            lastName: 'Patient',
            phone: '3055550100',
            patientCode: `PAT-RELAY-${suffix}`,
            isActive: true,
            isDeleted: false,
            isNonCompanyPatient: false
        });
        attempt = await db.CallCenterCallAttempt.create({
            patientId: patient.id,
            userId: user.id,
            correlationId: connectedSnapshot.callId,
            phoneClient: 'rx_softphone',
            direction: 'outbound',
            state: 'connected',
            outcome: 'answered',
            patientCode: patient.patientCode,
            patientName: `${patient.firstName} ${patient.lastName}`,
            clinicName: 'Relay Test Clinic',
            agentName: `${user.firstName} ${user.lastName}`,
            extension: `9${user.id}`,
            dialedNumber: connectedSnapshot.peer,
            dialedAt,
            ringingAt,
            answeredAt: connectedAt
        });

        const adminListResponse = mockResponse();
        await relayController.getAdminDevices({ user: { id: user.id }, headers: {} }, adminListResponse);
        assert.strictEqual(adminListResponse.statusCode, 200);
        const adminEntry = adminListResponse.body.users.find(entry => Number(entry.id) === Number(user.id));
        assert.ok(adminEntry, 'Managed device must appear in the Administrator phone-device inventory.');
        assert.strictEqual(adminEntry.account.authId, `relay-auth-${user.id}`);
        assert.strictEqual(adminEntry.device.clientVersion, '0.6.0');
        assert.strictEqual(adminEntry.device.updateRequired, false);
        assert.strictEqual(adminEntry.device.accountSynchronized, true);
        assert.strictEqual(adminEntry.device.registrationState, 'registered');
        assert.strictEqual(adminEntry.device.callState, 'connected');
        assert.strictEqual(adminEntry.device.peer, '3055550100');
        assert.strictEqual(adminEntry.device.dialedAt, dialedAt);
        assert.strictEqual(adminEntry.device.ringingAt, ringingAt);
        assert.strictEqual(adminEntry.device.connectedAt, connectedAt);
        assert.strictEqual(adminEntry.device.outcome, 'answered');
        assert.deepStrictEqual(adminEntry.device.crmCall, {
            patientCode: patient.patientCode,
            patientName: 'Relay Patient',
            clinicName: 'Relay Test Clinic',
            dialedNumber: '3055550100'
        }, 'Administrator phone presence must include bounded CRM context for an RX Tracker-originated call.');

        const endedPollResponse = await fetch(`${baseUrl}/api/softphone-relay/device/poll`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${pair.deviceToken}` },
            body: JSON.stringify({
                snapshot: {
                    ...connectedSnapshot,
                    call: 'idle',
                    endedAt: new Date().toISOString()
                },
                accountUpdatedAt: poll.accountUpdatedAt,
                completedCommands: [],
                client
            })
        });
        assert.strictEqual(endedPollResponse.status, 200);

        const revokeResponse = mockResponse();
        await relayController.revokeAdminDevice({
            params: { userId: String(user.id) },
            user: { id: user.id },
            headers: {},
            ip: '127.0.0.1'
        }, revokeResponse);
        assert.strictEqual(revokeResponse.statusCode, 200);
        await device.reload();
        assert.strictEqual(device.isEnabled, false);
        assert.strictEqual(device.tokenHash, null);

        const retireResponse = mockResponse();
        await relayController.retireAdminPhoneLine({
            params: { userId: String(user.id) },
            user: { id: user.id },
            headers: {},
            ip: '127.0.0.1'
        }, retireResponse);
        assert.strictEqual(retireResponse.statusCode, 200);
        assert.strictEqual(retireResponse.body.retired, true);
        assert.strictEqual(retireResponse.body.pairingRevoked, false, 'An already-revoked device must not block line retirement.');
        const retiredAccount = await db.UserSoftphoneAccount.findOne({ where: { userId: user.id } });
        assert.strictEqual(retiredAccount.isEnabled, false, 'Retiring a line must disable its SIP assignment without deleting it.');

        const repeatRetireResponse = mockResponse();
        await relayController.retireAdminPhoneLine({
            params: { userId: String(user.id) },
            user: { id: user.id },
            headers: {},
            ip: '127.0.0.1'
        }, repeatRetireResponse);
        assert.strictEqual(repeatRetireResponse.statusCode, 404, 'An already-retired line must not report another destructive change.');

        const revokedPollResponse = await fetch(`${baseUrl}/api/softphone-relay/device/poll`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${pair.deviceToken}` },
            body: JSON.stringify({ snapshot: synchronizedSnapshot, accountUpdatedAt: poll.accountUpdatedAt, completedCommands: [], client })
        });
        assert.strictEqual(revokedPollResponse.status, 401, 'A revoked workstation token must stop working immediately.');

        console.log('PASS managed Windows softphone relay pairing, stable registration handoff, device inventory, revocation, line retirement, and command acknowledgement.');
    } finally {
        if (user) {
            await db.SoftphoneRelayCommand.destroy({ where: { userId: user.id } });
            await db.SoftphoneRelayDevice.destroy({ where: { userId: user.id } });
            await db.UserSoftphoneAccount.destroy({ where: { userId: user.id } });
            if (attempt) await db.CallCenterCallAttempt.destroy({ where: { id: attempt.id } });
            if (patient) await db.Patient.destroy({ where: { id: patient.id }, force: true });
            await db.User.destroy({ where: { id: user.id }, force: true });
        }
        await db.sequelize.close();
    }
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});
