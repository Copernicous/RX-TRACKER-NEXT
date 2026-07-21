'use strict';

const crypto = require('crypto');
const db = require('../models');
const { decryptPassword } = require('../services/softphoneAccountService');
const { updateAttemptForUser, publicAttempt } = require('./callAttemptController');

const ONLINE_WINDOW_MS = 12 * 1000;
const PAIRING_WINDOW_MS = 10 * 60 * 1000;
const COMMAND_WINDOW_MS = 25 * 1000;
const ACTIVE_CALL_STATES = new Set(['dialing', 'trying', 'ringing', 'answering', 'connected', 'incoming']);

function secret() {
    return String(process.env.SOFTPHONE_RELAY_SECRET || process.env.JWT_SECRET || '');
}

function digest(kind, value) {
    if (!secret()) throw new Error('Softphone relay security is not configured.');
    return crypto.createHmac('sha256', secret()).update(`rx-softphone-relay:${kind}:`).update(String(value || '')).digest('hex');
}

function cleanText(value, maxLength) {
    return String(value === undefined || value === null ? '' : value)
        .trim()
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .slice(0, maxLength);
}

function requestIp(req) {
    const forwarded = req.headers && req.headers['x-forwarded-for'];
    return cleanText(forwarded ? String(forwarded).split(',')[0] : (req.ip || ''), 64);
}

function bearerToken(req) {
    const match = String(req.get('authorization') || '').match(/^Bearer\s+([^\s]+)$/i);
    return match ? match[1] : '';
}

function isOnline(device) {
    return !!(device && device.isEnabled !== false && device.tokenHash && device.lastSeenAt
        && Date.now() - new Date(device.lastSeenAt).getTime() <= ONLINE_WINDOW_MS);
}

function safeSnapshot(value) {
    const source = value && typeof value === 'object' ? value : {};
    const call = cleanText(source.call || 'idle', 24).toLowerCase();
    const registration = cleanText(source.registration || 'offline', 24).toLowerCase();
    return {
        registration,
        call,
        peer: cleanText(source.peer, 128) || null,
        incoming: source.incoming === true,
        muted: source.muted === true,
        callId: cleanText(source.callId, 64) || null,
        dialedAt: source.dialedAt || null,
        ringingAt: source.ringingAt || null,
        connectedAt: source.connectedAt || null,
        endedAt: source.endedAt || null,
        outcome: cleanText(source.outcome, 32) || null,
        sipResponseCode: Number.isInteger(Number(source.sipResponseCode)) ? Number(source.sipResponseCode) : null,
        sipReason: cleanText(source.sipReason, 255) || null,
        server: cleanText(source.server, 255),
        port: Number(source.port) || 5060,
        username: cleanText(source.username, 128),
        localSipPort: Number(source.localSipPort) || 0
    };
}

function attemptPayload(snapshot) {
    let state = snapshot.call;
    if (state === 'answering' || state === 'incoming') state = 'trying';
    if (!['dialing', 'trying', 'ringing', 'connected', 'ended', 'failed'].includes(state)) return null;
    return {
        state,
        ringingAt: snapshot.ringingAt,
        answeredAt: snapshot.connectedAt,
        endedAt: snapshot.endedAt,
        outcome: snapshot.outcome,
        sipResponseCode: snapshot.sipResponseCode,
        sipReason: snapshot.sipReason
    };
}

async function authenticateDevice(req, res) {
    const token = bearerToken(req);
    if (!token || token.length < 32 || token.length > 256) {
        res.status(401).json({ error: 'A valid relay device token is required.' });
        return null;
    }
    const device = await db.SoftphoneRelayDevice.findOne({
        where: { tokenHash: digest('token', token), isEnabled: true }
    });
    if (!device) {
        res.status(401).json({ error: 'Relay device pairing is invalid or has been replaced.' });
        return null;
    }
    return device;
}

async function syncAttemptFromSnapshot(device, snapshot, ipAddress) {
    if (!snapshot.callId) return;
    const payload = attemptPayload(snapshot);
    if (!payload) return;
    const attempt = await db.CallCenterCallAttempt.findOne({
        where: { correlationId: snapshot.callId, userId: device.userId },
        attributes: ['id']
    });
    if (!attempt) return;
    try {
        await updateAttemptForUser(device.userId, attempt.id, payload, ipAddress);
    } catch (err) {
        if (err.status !== 404) throw err;
    }
}

async function completeCommands(device, completed) {
    if (!Array.isArray(completed) || !completed.length) return;
    const ids = completed.map(item => Number.parseInt(item && item.commandId, 10)).filter(Number.isFinite).slice(0, 10);
    if (!ids.length) return;
    const results = new Map(completed.map(item => [Number.parseInt(item && item.commandId, 10), item]));
    const commands = await db.SoftphoneRelayCommand.findAll({
        where: { id: ids, deviceId: device.id, status: 'delivered' }
    });
    for (const command of commands) {
        const result = results.get(command.id) || {};
        command.status = result.success === true ? 'completed' : 'failed';
        command.completedAt = new Date();
        command.errorMessage = result.success === true ? null : (cleanText(result.error, 255) || 'Softphone command failed.');
        await command.save();
        if (command.status === 'failed' && command.attemptId) {
            await updateAttemptForUser(device.userId, command.attemptId, {
                state: 'failed',
                endedAt: new Date().toISOString(),
                outcome: 'failed',
                sipReason: command.errorMessage
            }, null).catch(() => {});
        }
    }
}

exports.createPairingCode = async (req, res) => {
    try {
        const account = await db.UserSoftphoneAccount.findOne({ where: { userId: req.user.id, isEnabled: true } });
        if (!account) return res.status(409).json({ error: 'Configure the user phone account before pairing RX Softphone.' });

        let code;
        let codeHash;
        for (let i = 0; i < 5; i += 1) {
            code = String(crypto.randomInt(0, 100000000)).padStart(8, '0');
            codeHash = digest('pair', code);
            const collision = await db.SoftphoneRelayDevice.count({ where: { pairingCodeHash: codeHash } });
            if (!collision) break;
        }
        const expiresAt = new Date(Date.now() + PAIRING_WINDOW_MS);
        const [device] = await db.SoftphoneRelayDevice.findOrCreate({
            where: { userId: req.user.id },
            defaults: { userId: req.user.id, pairingCodeHash: codeHash, pairingExpiresAt: expiresAt }
        });
        await device.update({ pairingCodeHash: codeHash, pairingExpiresAt: expiresAt, isEnabled: true });
        res.set('Cache-Control', 'no-store, private');
        res.json({ pairingCode: code, expiresAt, expiresInSeconds: Math.floor(PAIRING_WINDOW_MS / 1000) });
    } catch (err) {
        console.error('[Softphone Relay] pairing-code error:', err.message);
        res.status(500).json({ error: 'Could not create a softphone pairing code.' });
    }
};

exports.pairDevice = async (req, res) => {
    try {
        const code = String(req.body && req.body.pairingCode || '').replace(/\D/g, '');
        if (code.length !== 8) return res.status(400).json({ error: 'Enter the 8-digit pairing code shown in RX Tracker.' });
        const token = crypto.randomBytes(48).toString('base64url');
        const deviceKey = crypto.randomUUID();
        const device = await db.sequelize.transaction(async transaction => {
            const match = await db.SoftphoneRelayDevice.findOne({
                where: {
                    pairingCodeHash: digest('pair', code),
                    pairingExpiresAt: { [db.Sequelize.Op.gt]: new Date() },
                    isEnabled: true
                },
                transaction,
                lock: transaction.LOCK.UPDATE
            });
            if (!match) return null;
            await match.update({
                deviceKey,
                deviceName: cleanText(req.body && req.body.deviceName, 128) || 'Windows RX Softphone',
                tokenHash: digest('token', token),
                pairingCodeHash: null,
                pairingExpiresAt: null,
                pairedAt: new Date(),
                lastSeenAt: new Date(),
                registrationState: 'offline',
                callState: 'idle',
                snapshot: null
            }, { transaction });
            return match;
        });
        if (!device) return res.status(404).json({ error: 'Pairing code is invalid or expired.' });
        res.set('Cache-Control', 'no-store');
        res.json({ deviceToken: token, deviceKey, userId: device.userId });
    } catch (err) {
        console.error('[Softphone Relay] pair error:', err.message);
        res.status(500).json({ error: 'Could not pair the Windows softphone.' });
    }
};

exports.pollDevice = async (req, res) => {
    try {
        const device = await authenticateDevice(req, res);
        if (!device) return;

        const snapshot = safeSnapshot(req.body && req.body.snapshot);
        // PostgreSQL JSONB does not preserve the JavaScript insertion order of
        // object keys. Normalize both sides before comparing so an unchanged
        // terminal snapshot is not replayed on every relay poll.
        const previousSnapshot = device.snapshot ? safeSnapshot(device.snapshot) : null;
        const snapshotChanged = JSON.stringify(previousSnapshot) !== JSON.stringify(snapshot);
        await completeCommands(device, req.body && req.body.completedCommands);
        await device.update({
            lastSeenAt: new Date(),
            registrationState: snapshot.registration,
            callState: snapshot.call,
            callId: snapshot.callId,
            peer: snapshot.peer,
            snapshot
        });
        if (snapshotChanged) await syncAttemptFromSnapshot(device, snapshot, requestIp(req));

        await db.SoftphoneRelayCommand.update({ status: 'expired', completedAt: new Date() }, {
            where: { deviceId: device.id, status: 'queued', expiresAt: { [db.Sequelize.Op.lte]: new Date() } }
        });

        let command = null;
        await db.sequelize.transaction(async transaction => {
            command = await db.SoftphoneRelayCommand.findOne({
                where: { deviceId: device.id, status: 'queued', expiresAt: { [db.Sequelize.Op.gt]: new Date() } },
                order: [['createdAt', 'ASC']],
                transaction,
                lock: transaction.LOCK.UPDATE
            });
            if (command) await command.update({ status: 'delivered', deliveredAt: new Date() }, { transaction });
        });

        const account = await db.UserSoftphoneAccount.findOne({ where: { userId: device.userId, isEnabled: true } });
        const accountUpdatedAt = account ? account.updatedAt.toISOString() : null;
        const clientAccountVersion = cleanText(req.body && req.body.accountUpdatedAt, 64);
        let registration = null;
        const registeredToAssignedAccount = !!(account
            && snapshot.registration === 'registered'
            && String(snapshot.server || '').toLowerCase() === String(account.server || '').toLowerCase()
            && Number(snapshot.port || 5060) === Number(account.port || 5060)
            && String(snapshot.username || '') === String(account.username || ''));
        if (account && (!registeredToAssignedAccount || clientAccountVersion !== accountUpdatedAt)) {
            registration = {
                server: account.server,
                port: account.port,
                username: account.username,
                displayName: account.displayName || account.username,
                localSipPort: account.localSipPort || 0,
                password: decryptPassword(device.userId, account.encryptedPassword)
            };
        }

        res.set('Cache-Control', 'no-store');
        res.json({
            serverTime: new Date().toISOString(),
            accountUpdatedAt,
            registration,
            command: command ? {
                id: command.id,
                type: command.commandType,
                payload: command.payload,
                expiresAt: command.expiresAt
            } : null
        });
    } catch (err) {
        console.error('[Softphone Relay] poll error:', err.message);
        res.status(500).json({ error: 'Softphone relay poll failed.' });
    }
};

exports.getStatus = async (req, res) => {
    try {
        const device = await db.SoftphoneRelayDevice.findOne({ where: { userId: req.user.id, isEnabled: true } });
        const online = isOnline(device);
        let activeAttempt = null;
        if (device && device.callId) {
            const attempt = await db.CallCenterCallAttempt.findOne({ where: { userId: req.user.id, correlationId: device.callId } });
            activeAttempt = publicAttempt(attempt);
        }
        res.set('Cache-Control', 'no-store, private');
        res.json({
            paired: !!(device && device.tokenHash),
            online,
            deviceName: device && device.deviceName || null,
            lastSeenAt: device && device.lastSeenAt || null,
            snapshot: online ? device.snapshot : null,
            activeAttempt
        });
    } catch (err) {
        res.status(500).json({ error: 'Could not load relay status.' });
    }
};

exports.queueDial = async (req, res) => {
    try {
        const attemptId = Number.parseInt(req.body && req.body.attemptId, 10);
        if (!Number.isFinite(attemptId)) return res.status(400).json({ error: 'A valid call attempt is required.' });
        let command;
        await db.sequelize.transaction(async transaction => {
            const device = await db.SoftphoneRelayDevice.findOne({
                where: { userId: req.user.id, isEnabled: true }, transaction, lock: transaction.LOCK.UPDATE
            });
            if (!isOnline(device)) {
                const err = new Error('The paired Windows RX Softphone is offline.');
                err.status = 409;
                throw err;
            }
            if (ACTIVE_CALL_STATES.has(String(device.callState || '').toLowerCase())) {
                const err = new Error('RX Softphone already has a call in progress.');
                err.status = 409;
                throw err;
            }
            const pendingDial = await db.SoftphoneRelayCommand.count({
                where: {
                    deviceId: device.id,
                    commandType: 'dial',
                    status: { [db.Sequelize.Op.in]: ['queued', 'delivered'] },
                    expiresAt: { [db.Sequelize.Op.gt]: new Date() }
                },
                transaction
            });
            if (pendingDial) {
                const err = new Error('RX Softphone already has a call command in progress.');
                err.status = 409;
                throw err;
            }
            const attempt = await db.CallCenterCallAttempt.findOne({
                where: { id: attemptId, userId: req.user.id, state: 'dialing' }, transaction, lock: transaction.LOCK.UPDATE
            });
            if (!attempt) {
                const err = new Error('Call attempt is unavailable or already completed.');
                err.status = 409;
                throw err;
            }
            command = await db.SoftphoneRelayCommand.create({
                deviceId: device.id,
                userId: req.user.id,
                attemptId: attempt.id,
                commandType: 'dial',
                payload: { destination: attempt.dialedNumber, correlationId: attempt.correlationId },
                status: 'queued',
                expiresAt: new Date(Date.now() + COMMAND_WINDOW_MS)
            }, { transaction });
        });
        res.status(202).json({ commandId: command.id, status: command.status });
    } catch (err) {
        const status = err.status || 500;
        if (status >= 500) console.error('[Softphone Relay] dial error:', err.message);
        res.status(status).json({ error: status >= 500 ? 'Could not queue the relay call.' : err.message });
    }
};

exports.queueHangup = async (req, res) => {
    try {
        const device = await db.SoftphoneRelayDevice.findOne({ where: { userId: req.user.id, isEnabled: true } });
        if (!isOnline(device)) return res.status(409).json({ error: 'The paired Windows RX Softphone is offline.' });
        const attempt = device.callId ? await db.CallCenterCallAttempt.findOne({
            where: { userId: req.user.id, correlationId: device.callId }
        }) : null;
        const command = await db.SoftphoneRelayCommand.create({
            deviceId: device.id,
            userId: req.user.id,
            attemptId: attempt && attempt.id || null,
            commandType: 'hangup',
            payload: {},
            status: 'queued',
            expiresAt: new Date(Date.now() + COMMAND_WINDOW_MS)
        });
        res.status(202).json({ commandId: command.id, status: command.status });
    } catch (err) {
        res.status(500).json({ error: 'Could not queue the relay hangup.' });
    }
};
