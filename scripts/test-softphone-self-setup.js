'use strict';

const assert = require('assert');
const { prepareStagingEnv } = require('./lib/staging-env');

const explicitTestDatabase = String(process.env.SOFTPHONE_SETUP_TEST_DB_NAME || '').trim();
if (explicitTestDatabase) {
    process.env.DB_NAME = explicitTestDatabase;
} else {
    const staging = prepareStagingEnv();
    process.env.DB_NAME = staging.dbName.replace(/[^A-Za-z0-9_]/g, '_') + '_ui_smoke';
}
if (!/(ui_smoke|test)/i.test(process.env.DB_NAME)) {
    throw new Error('Refusing phone-account setup test on a non-test database.');
}
process.env.SOFTPHONE_CREDENTIAL_KEY = process.env.SOFTPHONE_CREDENTIAL_KEY || 'isolated-softphone-setup-test-key';

const db = require('../models');
const controller = require('../controllers/softphoneAccountController');
const { decryptPassword } = require('../services/softphoneAccountService');

const runId = String(Date.now());
const created = { roleId: null, userId: null };

function response() {
    return {
        statusCode: 200,
        body: null,
        headers: {},
        status(code) { this.statusCode = code; return this; },
        set(name, value) { this.headers[name] = value; return this; },
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
        socket: { remoteAddress: '127.0.0.1' }
    };
}

async function cleanup() {
    if (created.userId) {
        await db.AuditLog.destroy({ where: { module: 'Call Center', recordId: created.userId } }).catch(() => {});
        await db.UserSoftphoneAccount.destroy({ where: { userId: created.userId } }).catch(() => {});
        await db.User.destroy({ where: { id: created.userId } }).catch(() => {});
    }
    if (created.roleId) await db.Role.destroy({ where: { id: created.roleId } }).catch(() => {});
}

async function main() {
    try {
        await db.sequelize.authenticate();
        const queryInterface = db.sequelize.getQueryInterface();
        const userColumns = await queryInterface.describeTable('Users');
        assert(userColumns.phoneAccountSetupAllowed, 'Migrated schema is missing Users.phoneAccountSetupAllowed.');
        const role = await db.Role.create({
            name: 'Phone Setup Test ' + runId,
            description: 'Isolated regression role',
            isSystem: false,
            permissions: {}
        });
        created.roleId = role.id;
        const user = await db.User.create({
            firstName: 'Phone',
            lastName: 'Setup',
            username: 'phone-setup-' + runId,
            email: 'phone-setup-' + runId + '@example.test',
            passwordHash: 'not-used',
            roleId: role.id,
            isActive: true,
            phoneAccountSetupAllowed: false
        });
        created.userId = user.id;
        const userContext = { id: user.id, username: user.username, firstName: user.firstName, lastName: user.lastName, role: role.name };

        const unauthorizedStatus = response();
        await controller.getOwnSetup(request(userContext), unauthorizedStatus);
        assert.strictEqual(unauthorizedStatus.statusCode, 403, 'A role alone must not enable setup for a user.');

        const allowFirstSetup = response();
        await controller.enableSetupAccess(request(
            { id: user.id, username: user.username, role: 'Administrator' },
            {},
            { id: String(user.id) }
        ), allowFirstSetup);
        assert.strictEqual(allowFirstSetup.statusCode, 200, JSON.stringify(allowFirstSetup.body));

        const initialStatus = response();
        await controller.getOwnSetup(request(userContext), initialStatus);
        assert.strictEqual(initialStatus.statusCode, 200);
        assert.strictEqual(initialStatus.body.configured, false, 'An individually authorized user must have setup available.');

        const firstSave = response();
        await controller.saveOwnSetup(request(userContext, {
            server: '192.0.2.50',
            port: 5060,
            username: '1006',
            displayName: '1006',
            password: 'first-test-password',
            localSipPort: 0
        }), firstSave);
        assert.strictEqual(firstSave.statusCode, 200, JSON.stringify(firstSave.body));
        let account = await db.UserSoftphoneAccount.findOne({ where: { userId: user.id } });
        assert(account && account.isEnabled === true, 'Self-service setup must enable the saved account.');
        assert.strictEqual(decryptPassword(user.id, account.encryptedPassword), 'first-test-password');
        await user.reload();
        assert.strictEqual(user.phoneAccountSetupAllowed, false, 'Successful setup must remove this user\'s setup access.');

        const duplicateSave = response();
        await controller.saveOwnSetup(request(userContext, {
            server: '192.0.2.51', port: 5060, username: '9999', displayName: '9999', password: 'should-not-save', localSipPort: 0
        }), duplicateSave);
        assert.strictEqual(duplicateSave.statusCode, 403, 'A user must not be able to change phone settings after setup access closes.');

        const allowAgain = response();
        await controller.enableSetupAccess(request(
            { id: user.id, username: user.username, role: 'Administrator' },
            {},
            { id: String(user.id) }
        ), allowAgain);
        assert.strictEqual(allowAgain.statusCode, 200, JSON.stringify(allowAgain.body));
        account = await db.UserSoftphoneAccount.findOne({ where: { userId: user.id } });
        assert.strictEqual(account.isEnabled, false, 'Administrator re-enable must disable registration until setup is completed.');
        await user.reload();
        assert.strictEqual(user.phoneAccountSetupAllowed, true, 'Administrator must enable setup only for the selected user.');

        const secondSave = response();
        await controller.saveOwnSetup(request(userContext, {
            server: '192.0.2.52',
            port: 5060,
            username: '1007',
            displayName: '1007',
            password: 'second-test-password',
            localSipPort: 0
        }), secondSave);
        assert.strictEqual(secondSave.statusCode, 200, JSON.stringify(secondSave.body));
        account = await db.UserSoftphoneAccount.findOne({ where: { userId: user.id } });
        assert.strictEqual(account.isEnabled, true, 'Completing reopened setup must enable registration again.');
        assert.strictEqual(account.username, '1007');
        assert.strictEqual(decryptPassword(user.id, account.encryptedPassword), 'second-test-password');
        await user.reload();
        assert.strictEqual(user.phoneAccountSetupAllowed, false, 'Reconfiguration must close per-user setup access again.');

        console.log('PASS per-user one-time phone-account setup and administrator re-enable workflow.');
    } finally {
        await cleanup();
        await db.sequelize.close().catch(() => {});
    }
}

main().catch(err => {
    console.error('FAIL phone-account self-setup regression');
    console.error(err.stack || err.message);
    process.exitCode = 1;
});
