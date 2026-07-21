'use strict';

const assert = require('assert');
const jwt = require('jsonwebtoken');
const { prepareStagingEnv } = require('./lib/staging-env');

const stagingConfig = prepareStagingEnv();
const db = require('../models');
const { BUILT_IN_DEFAULTS } = require('../middleware/rbac');
const Op = db.Sequelize.Op;

const DEFAULT_BASE_URL = 'http://localhost:' + (process.env.PORT || stagingConfig.port || '3100');
const baseUrl = (process.env.STAGING_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
const runId = String(Date.now());
const createdUserIds = [];

const sensitiveEndpoints = [
    '/api/version',
    '/api/dashboard/stats',
    '/api/patients',
    '/api/rx-records',
    '/api/reports/call-center?paginated=true',
    '/api/audit-logs',
    '/api/user-activity-logs',
    '/api/active-sessions',
    '/api/settings',
    '/api/api-keys',
    '/api/backups/status',
    '/api/admin/backups',
    '/api/roles'
];

function roleDefaults(name) {
    return BUILT_IN_DEFAULTS[name] ? BUILT_IN_DEFAULTS[name]() : {};
}

async function ensureBuiltInRole(name) {
    const [role] = await db.Role.findOrCreate({
        where: { name },
        defaults: {
            name,
            description: name + ' role',
            isSystem: true,
            permissions: roleDefaults(name)
        }
    });
    if (!role.permissions) {
        await role.update({ permissions: roleDefaults(name), isSystem: true });
    }
    return role;
}

async function createUser(role, label) {
    const user = await db.User.create({
        firstName: 'Security',
        lastName: label,
        username: `security_${label.toLowerCase()}_${runId}`,
        email: `security_${label.toLowerCase()}_${runId}@example.test`,
        passwordHash: 'not-used',
        roleId: role.id,
        isActive: true,
        tokenVersion: 0,
        isMaster: false
    });
    createdUserIds.push(user.id);
    return user;
}

function signUser(user, roleName) {
    assert(process.env.JWT_SECRET, 'JWT_SECRET must be set in .env.staging.');
    return jwt.sign({
        id: user.id,
        username: user.username,
        role: roleName,
        tv: user.tokenVersion || 0,
        sid: `security-smoke-${user.id}-${runId}`
    }, process.env.JWT_SECRET, { expiresIn: '15m' });
}

async function fetchStatus(path, token) {
    const headers = token ? { cookie: 'rxToken=' + encodeURIComponent(token) } : {};
    const res = await fetch(baseUrl + path, { headers, redirect: 'manual' });
    const text = await res.text().catch(() => '');
    return { status: res.status, text };
}

async function assertVersionRestricted(callCenterToken, adminToken) {
    const unauthenticated = await fetchStatus('/api/version');
    assert.strictEqual(unauthenticated.status, 401, 'Unauthenticated /api/version should return 401.');

    const callCenter = await fetchStatus('/api/version', callCenterToken);
    assert.strictEqual(callCenter.status, 403, 'Call Center /api/version should return 403.');

    const admin = await fetchStatus('/api/version', adminToken);
    assert.strictEqual(admin.status, 200, 'Administrator /api/version should return 200.');
    const payload = JSON.parse(admin.text);
    assert(payload.version, 'Administrator /api/version response should include version.');
    console.log('PASS /api/version is restricted to Administrator users');
}

async function assertCallCenterBlocked(token) {
    for (const endpoint of sensitiveEndpoints) {
        const result = await fetchStatus(endpoint, token);
        assert.strictEqual(
            result.status,
            403,
            `Call Center should get 403 for ${endpoint}, got ${result.status}: ${result.text.slice(0, 180)}`
        );
        console.log('PASS Call Center 403:', endpoint);
    }
}

async function cleanup() {
    if (!createdUserIds.length) return;
    await new Promise(resolve => setTimeout(resolve, 500));
    await db.AuditLog.destroy({ where: { userId: { [Op.in]: createdUserIds } } }).catch(() => {});
    if (db.UserActivityLog) {
        await db.UserActivityLog.destroy({ where: { userId: { [Op.in]: createdUserIds } } }).catch(() => {});
    }
    await db.User.destroy({ where: { id: { [Op.in]: createdUserIds } } }).catch(() => {});
}

async function main() {
    console.log('Staging Call Center API restriction smoke test');
    console.log('URL: ' + baseUrl);

    try {
        const login = await fetchStatus('/login');
        if (login.status >= 500) throw new Error('/login returned HTTP ' + login.status + '.');
    } catch (err) {
        throw new Error('Cannot reach staging at ' + baseUrl + '. Start it with "npm run staging:start" first. ' + err.message);
    }

    await db.sequelize.authenticate();
    const callCenterRole = await ensureBuiltInRole('Call Center');
    const adminRole = await ensureBuiltInRole('Administrator');
    const callCenterUser = await createUser(callCenterRole, 'CallCenter');
    const adminUser = await createUser(adminRole, 'Admin');
    const callCenterToken = signUser(callCenterUser, 'Call Center');
    const adminToken = signUser(adminUser, 'Administrator');

    await assertVersionRestricted(callCenterToken, adminToken);
    await assertCallCenterBlocked(callCenterToken);

    console.log('All Call Center sensitive endpoint restrictions passed.');
}

main()
    .catch((err) => {
        console.error('[staging:call-center-security] ' + err.message);
        process.exitCode = 1;
    })
    .finally(async () => {
        await cleanup();
        await db.sequelize.close().catch(() => {});
    });
