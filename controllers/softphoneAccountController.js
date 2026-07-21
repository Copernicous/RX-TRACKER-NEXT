'use strict';

const db = require('../models');
const {
    encryptPassword,
    decryptPassword,
    isAdminPinRequired,
    verifyAdminPin
} = require('../services/softphoneAccountService');
const { normalizeRoleName } = require('../utils/callCenterAccess');

function canManagePhoneAccount(user) {
    return normalizeRoleName(user) === 'administrator';
}

function cleanText(value, maxLength) {
    const clean = String(value || '').trim();
    if (!clean || clean.length > maxLength || /[\u0000-\u001f\u007f]/.test(clean)) return null;
    return clean;
}

function parsePort(value, allowZero) {
    const parsed = Number.parseInt(value, 10);
    const minimum = allowZero ? 0 : 1;
    return Number.isInteger(parsed) && parsed >= minimum && parsed <= 65535 ? parsed : null;
}

function accountResponse(account, canManage) {
    if (!account) return { configured: false, adminPinRequired: isAdminPinRequired(), canManage: !!canManage };
    return {
        configured: true,
        adminPinRequired: isAdminPinRequired(),
        canManage: !!canManage,
        server: account.server,
        port: account.port,
        username: account.username,
        displayName: account.displayName || account.username,
        localSipPort: account.localSipPort || 0,
        passwordConfigured: !!account.encryptedPassword,
        isEnabled: account.isEnabled !== false,
        updatedAt: account.updatedAt
    };
}

function managedAccountResponse(account) {
    if (!account) return { configured: false };
    return {
        configured: true,
        server: account.server,
        port: account.port,
        username: account.username,
        displayName: account.displayName || account.username,
        localSipPort: account.localSipPort || 0,
        passwordConfigured: !!account.encryptedPassword,
        isEnabled: account.isEnabled !== false,
        updatedAt: account.updatedAt
    };
}

function requestIp(req) {
    return req.headers['x-forwarded-for'] || req.ip || (req.socket && req.socket.remoteAddress) || null;
}

async function auditAccountChange(req, action, previousValue, newValue, transaction, targetUserId) {
    const now = new Date();
    return db.AuditLog.create({
        userId: req.user && req.user.id ? req.user.id : null,
        date: now.toISOString().slice(0, 10),
        time: now.toTimeString().split(' ')[0],
        module: 'Call Center',
        action,
        recordId: targetUserId || (req.user && req.user.id ? req.user.id : null),
        previousValue,
        newValue,
        ipAddress: requestIp(req)
    }, { transaction });
}

exports.getOwnAccount = async (req, res) => {
    try {
        const account = await db.UserSoftphoneAccount.findOne({ where: { userId: req.user.id } });
        res.set('Cache-Control', 'no-store');
        res.json(accountResponse(account, canManagePhoneAccount(req.user)));
    } catch (err) {
        console.error('[Softphone Account] getOwnAccount error:', err.message);
        res.status(500).json({ error: 'Could not load the assigned softphone account.' });
    }
};

exports.getManagedAccounts = async (req, res) => {
    try {
        const [users, accounts] = await Promise.all([
            db.User.findAll({
                attributes: ['id', 'username', 'firstName', 'lastName', 'email', 'isActive', 'roleId'],
                include: [{ model: db.Role, attributes: ['name'], required: false }],
                order: [['firstName', 'ASC'], ['lastName', 'ASC'], ['username', 'ASC']]
            }),
            db.UserSoftphoneAccount.findAll({
                attributes: ['userId', 'server', 'port', 'username', 'displayName', 'localSipPort', 'encryptedPassword', 'isEnabled', 'updatedAt']
            })
        ]);
        const byUserId = new Map(accounts.map(account => [Number(account.userId), account]));
        res.set('Cache-Control', 'no-store');
        res.json({
            adminPinRequired: isAdminPinRequired(),
            users: users.map(user => ({
                id: user.id,
                username: user.username,
                firstName: user.firstName || '',
                lastName: user.lastName || '',
                email: user.email || '',
                roleId: user.roleId,
                roleName: user.Role ? user.Role.name : '',
                isActive: user.isActive !== false,
                account: managedAccountResponse(byUserId.get(Number(user.id)))
            }))
        });
    } catch (err) {
        console.error('[Softphone Account] getManagedAccounts error:', err.message);
        res.status(500).json({ error: 'Could not load user phone accounts.' });
    }
};

exports.saveManagedAccount = async (req, res) => {
    const targetUserId = Number.parseInt(req.params.userId, 10);
    const body = req.body || {};

    if (!Number.isInteger(targetUserId) || targetUserId < 1) {
        return res.status(400).json({ error: 'A valid user is required.' });
    }
    if (!verifyAdminPin(body.adminPin)) {
        auditAccountChange(
            req,
            'Assigned Softphone Account PIN Rejected',
            null,
            { accepted: false, targetUserId },
            null,
            targetUserId
        ).catch(err => console.error('[Softphone Account] assigned PIN rejection audit error:', err.message));
        return res.status(403).json({ error: 'Administrator PIN is incorrect.' });
    }

    const server = cleanText(body.server, 253);
    const username = cleanText(body.username, 128);
    const displayName = body.displayName ? cleanText(body.displayName, 128) : username;
    const port = parsePort(body.port, false);
    const localSipPort = parsePort(body.localSipPort === '' || body.localSipPort === undefined ? 0 : body.localSipPort, true);
    const password = body.password === undefined || body.password === null ? '' : String(body.password);
    const isEnabled = body.isEnabled !== false;

    if (!server || !/^[a-z0-9.-]+$/i.test(server)) {
        return res.status(400).json({ error: 'PBX server must be an IP address or host name without a URL scheme.' });
    }
    if (!username) return res.status(400).json({ error: 'SIP extension / username is required.' });
    if (!displayName) return res.status(400).json({ error: 'Display name is invalid.' });
    if (port === null) return res.status(400).json({ error: 'SIP port must be between 1 and 65535.' });
    if (localSipPort === null) return res.status(400).json({ error: 'Local SIP port must be 0 or between 1 and 65535.' });
    if (password.length > 256 || /[\u0000-\u001f\u007f]/.test(password)) {
        return res.status(400).json({ error: 'SIP password must be 256 characters or fewer and contain no control characters.' });
    }

    try {
        let saved;
        const targetUser = await db.User.findByPk(targetUserId, { attributes: ['id', 'username', 'firstName', 'lastName'] });
        if (!targetUser) return res.status(404).json({ error: 'User not found.' });

        await db.sequelize.transaction(async (transaction) => {
            const existing = await db.UserSoftphoneAccount.findOne({
                where: { userId: targetUserId },
                transaction,
                lock: transaction.LOCK.UPDATE
            });
            if (!existing && !password) {
                const error = new Error('SIP password is required when assigning a new phone account.');
                error.status = 400;
                throw error;
            }

            const previousValue = existing ? managedAccountResponse(existing) : null;
            const values = {
                userId: targetUserId,
                server,
                port,
                username,
                displayName,
                localSipPort,
                isEnabled
            };
            if (password) values.encryptedPassword = encryptPassword(targetUserId, password);

            saved = existing
                ? await existing.update(values, { transaction })
                : await db.UserSoftphoneAccount.create(values, { transaction });

            await auditAccountChange(
                req,
                existing ? 'Assigned Softphone Account Updated' : 'Assigned Softphone Account Configured',
                previousValue,
                {
                    ...managedAccountResponse(saved),
                    targetUsername: targetUser.username,
                    passwordChanged: !!password
                },
                transaction,
                targetUserId
            );
        });

        res.set('Cache-Control', 'no-store');
        res.json({
            message: `Phone account assigned to ${targetUser.username}.`,
            account: managedAccountResponse(saved)
        });
    } catch (err) {
        const status = err.status || 500;
        if (status >= 500) console.error('[Softphone Account] saveManagedAccount error:', err.message);
        res.status(status).json({ error: status >= 500 ? 'Could not assign the phone account.' : err.message });
    }
};

exports.saveOwnAccount = async (req, res) => {
    const body = req.body || {};

    if (!canManagePhoneAccount(req.user)) {
        auditAccountChange(
            req,
            'Softphone Account Permission Rejected',
            null,
            { accepted: false, reason: 'administrator_required' },
            null
        ).catch(err => console.error('[Softphone Account] permission rejection audit error:', err.message));
        return res.status(403).json({ error: 'Only an Administrator can change phone-account settings.' });
    }

    if (!verifyAdminPin(body.adminPin)) {
        auditAccountChange(
            req,
            'Softphone Account PIN Rejected',
            null,
            { accepted: false },
            null
        ).catch(err => console.error('[Softphone Account] PIN rejection audit error:', err.message));
        return res.status(403).json({ error: 'Administrator PIN is incorrect.' });
    }

    const server = cleanText(body.server, 253);
    const username = cleanText(body.username, 128);
    const displayName = body.displayName ? cleanText(body.displayName, 128) : username;
    const port = parsePort(body.port, false);
    const localSipPort = parsePort(body.localSipPort === '' || body.localSipPort === undefined ? 0 : body.localSipPort, true);
    const password = body.password === undefined || body.password === null ? '' : String(body.password);

    if (!server || !/^[a-z0-9.-]+$/i.test(server)) {
        return res.status(400).json({ error: 'PBX server must be an IP address or host name without a URL scheme.' });
    }
    if (!username) return res.status(400).json({ error: 'SIP extension / username is required.' });
    if (!displayName) return res.status(400).json({ error: 'Display name is invalid.' });
    if (port === null) return res.status(400).json({ error: 'SIP port must be between 1 and 65535.' });
    if (localSipPort === null) return res.status(400).json({ error: 'Local SIP port must be 0 or between 1 and 65535.' });
    if (password.length > 256 || /[\u0000-\u001f\u007f]/.test(password)) {
        return res.status(400).json({ error: 'SIP password must be 256 characters or fewer and contain no control characters.' });
    }

    try {
        let saved;
        await db.sequelize.transaction(async (transaction) => {
            const existing = await db.UserSoftphoneAccount.findOne({
                where: { userId: req.user.id },
                transaction,
                lock: transaction.LOCK.UPDATE
            });
            if (!existing && !password) {
                const error = new Error('SIP password is required when creating the account.');
                error.status = 400;
                throw error;
            }

            const previousValue = existing ? accountResponse(existing, true) : null;
            const values = {
                userId: req.user.id,
                server,
                port,
                username,
                displayName,
                localSipPort,
                isEnabled: true
            };
            if (password) values.encryptedPassword = encryptPassword(req.user.id, password);

            saved = existing
                ? await existing.update(values, { transaction })
                : await db.UserSoftphoneAccount.create(values, { transaction });

            await auditAccountChange(
                req,
                existing ? 'Softphone Account Updated' : 'Softphone Account Configured',
                previousValue,
                { ...accountResponse(saved, true), passwordChanged: !!password },
                transaction
            );
        });

        res.set('Cache-Control', 'no-store');
        res.json({ message: 'Softphone account saved.', account: accountResponse(saved, true) });
    } catch (err) {
        const status = err.status || 500;
        if (status >= 500) console.error('[Softphone Account] saveOwnAccount error:', err.message);
        res.status(status).json({ error: status >= 500 ? 'Could not save the softphone account.' : err.message });
    }
};

exports.getOwnRegistration = async (req, res) => {
    try {
        const account = await db.UserSoftphoneAccount.findOne({
            where: { userId: req.user.id, isEnabled: true }
        });
        res.set('Cache-Control', 'no-store, private');
        res.set('Pragma', 'no-cache');
        if (!account) return res.json({ configured: false });

        const password = decryptPassword(req.user.id, account.encryptedPassword);
        res.json({
            configured: true,
            server: account.server,
            port: account.port,
            username: account.username,
            displayName: account.displayName || account.username,
            localSipPort: account.localSipPort || 0,
            password
        });
    } catch (err) {
        console.error('[Softphone Account] getOwnRegistration error:', err.message);
        res.status(500).json({ error: 'Could not load the softphone registration credential.' });
    }
};
