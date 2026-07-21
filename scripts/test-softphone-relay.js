'use strict';

const assert = require('assert');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { prepareStagingEnv } = require('./lib/staging-env');

prepareStagingEnv();
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
        const client = { version: '0.4.2', managedMode: true, allowManualDialing: true };
        const pairResponse = await fetch(`${baseUrl}/api/softphone-relay/device/pair`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pairingCode: codeResponse.body.pairingCode, deviceName: 'Relay Smoke Device', client })
        });
        const pair = await pairResponse.json();
        assert.strictEqual(pairResponse.status, 200);
        assert.ok(pair.deviceToken && pair.deviceToken.length >= 32);
        assert.strictEqual(pair.policy.mode, 'managed');
        assert.strictEqual(pair.policy.minimumClientVersion, '0.4.2');
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
        assert.strictEqual(device.snapshot.clientVersion, '0.4.2');
        assert.strictEqual(device.snapshot.managedMode, true);

        const adminListResponse = mockResponse();
        await relayController.getAdminDevices({ user: { id: user.id }, headers: {} }, adminListResponse);
        assert.strictEqual(adminListResponse.statusCode, 200);
        const adminEntry = adminListResponse.body.users.find(entry => Number(entry.id) === Number(user.id));
        assert.ok(adminEntry, 'Managed device must appear in the Administrator phone-device inventory.');
        assert.strictEqual(adminEntry.device.clientVersion, '0.4.2');
        assert.strictEqual(adminEntry.device.updateRequired, false);
        assert.strictEqual(adminEntry.device.accountSynchronized, true);

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

        const revokedPollResponse = await fetch(`${baseUrl}/api/softphone-relay/device/poll`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${pair.deviceToken}` },
            body: JSON.stringify({ snapshot: synchronizedSnapshot, accountUpdatedAt: poll.accountUpdatedAt, completedCommands: [], client })
        });
        assert.strictEqual(revokedPollResponse.status, 401, 'A revoked workstation token must stop working immediately.');

        console.log('PASS managed Windows softphone relay pairing, stable registration handoff, device inventory, revocation, and command acknowledgement.');
    } finally {
        if (user) {
            await db.SoftphoneRelayCommand.destroy({ where: { userId: user.id } });
            await db.SoftphoneRelayDevice.destroy({ where: { userId: user.id } });
            await db.UserSoftphoneAccount.destroy({ where: { userId: user.id } });
            await db.User.destroy({ where: { id: user.id }, force: true });
        }
        await db.sequelize.close();
    }
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});
