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
        const pairResponse = await fetch(`${baseUrl}/api/softphone-relay/device/pair`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pairingCode: codeResponse.body.pairingCode, deviceName: 'Relay Smoke Device' })
        });
        const pair = await pairResponse.json();
        assert.strictEqual(pairResponse.status, 200);
        assert.ok(pair.deviceToken && pair.deviceToken.length >= 32);

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
            body: JSON.stringify({ snapshot, accountUpdatedAt: null, completedCommands: [] })
        });
        const poll = await pollResponse.json();
        assert.strictEqual(pollResponse.status, 200);
        assert.strictEqual(poll.command.id, command.id);
        assert.strictEqual(poll.command.type, 'hangup');
        assert.strictEqual(poll.registration.username, `9${user.id}`);
        assert.ok(poll.registration.password);
        poll.registration.password = '';

        const completeResponse = await fetch(`${baseUrl}/api/softphone-relay/device/poll`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${pair.deviceToken}` },
            body: JSON.stringify({
                snapshot,
                accountUpdatedAt: poll.accountUpdatedAt,
                completedCommands: [{ commandId: command.id, success: true, error: null }]
            })
        });
        assert.strictEqual(completeResponse.status, 200);
        await command.reload();
        assert.strictEqual(command.status, 'completed');

        console.log('PASS outbound Windows softphone relay pairing, authentication, registration handoff, and command acknowledgement.');
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
