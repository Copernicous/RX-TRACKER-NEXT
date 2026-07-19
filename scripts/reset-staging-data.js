'use strict';

const assert = require('assert');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { prepareStagingEnv } = require('./lib/staging-env');

const stagingConfig = prepareStagingEnv();
const db = require('../models');
const { BUILT_IN_DEFAULTS } = require('../middleware/rbac');

const confirmation = String(process.env.STAGING_RESET_CONFIRM || '');
const credentialsPath = path.join(stagingConfig.writableRoot, 'staging-admin-credentials.txt');
const adminUsername = 'staging_admin';
const adminPassword = 'Staging!' + crypto.randomBytes(18).toString('base64url');

const BUILT_IN_ROLES = [
    'Administrator',
    'Supervisor',
    'Operator',
    'Read Only',
    'Call Center'
];

const DEFAULT_WORKFLOW_ACTIONS = [
    { name: 'RX Received', description: 'Initial receipt of RX', sequenceNumber: 1 },
    { name: 'Pharmacy Contacted', description: 'Pharmacy has been contacted', sequenceNumber: 2 },
    { name: 'Transportation Assigned', description: 'Transportation company assigned', sequenceNumber: 3 },
    { name: 'Delivery Scheduled', description: 'Delivery is scheduled', sequenceNumber: 4 },
    { name: 'RX Delivered', description: 'RX has been delivered to patient', sequenceNumber: 5 },
    { name: 'Driver Receipt Obtained', description: 'Signed receipt from driver obtained', sequenceNumber: 6 }
];

function quoteIdentifier(value) {
    return '"' + String(value).replace(/"/g, '""') + '"';
}

function assertSafeTarget() {
    assert(
        /(staging|stage|qa|test|sandbox|copy)/i.test(stagingConfig.dbName),
        'Refusing reset because DB_NAME is not named as a non-production database.'
    );
    assert.strictEqual(
        confirmation,
        stagingConfig.dbName,
        'Set STAGING_RESET_CONFIRM to the exact staging DB name (' + stagingConfig.dbName + ').'
    );
    assert.notStrictEqual(
        String(stagingConfig.rootEnv.DB_NAME || '').toLowerCase(),
        String(stagingConfig.dbName).toLowerCase(),
        'Refusing reset because staging and root .env use the same database.'
    );
}

async function publicTables(transaction) {
    const [rows] = await db.sequelize.query(
        "SELECT table_name AS \"tableName\" "
        + "FROM information_schema.tables "
        + "WHERE table_schema = 'public' AND table_type = 'BASE TABLE' "
        + 'ORDER BY table_name',
        { transaction }
    );
    return rows.map(row => row.tableName);
}

async function seedCleanBaseline(transaction) {
    const roles = {};
    for (const name of BUILT_IN_ROLES) {
        roles[name] = await db.Role.create({
            name,
            description: name + ' role',
            isSystem: true,
            permissions: BUILT_IN_DEFAULTS[name] ? BUILT_IN_DEFAULTS[name]() : {}
        }, { transaction });
    }

    for (const action of DEFAULT_WORKFLOW_ACTIONS) {
        await db.WorkflowAction.create({
            ...action,
            isActive: true
        }, { transaction });
    }

    await db.User.create({
        firstName: 'Staging',
        lastName: 'Administrator',
        username: adminUsername,
        email: 'staging_admin@example.test',
        passwordHash: await bcrypt.hash(adminPassword, 10),
        roleId: roles.Administrator.id,
        isActive: true,
        isMaster: true,
        tokenVersion: 0,
        twoFactorEnabled: false
    }, { transaction });
}

async function verifyBaseline(allTables) {
    const allowedRows = new Set(['Roles', 'Users', 'WorkflowActions', 'SequelizeMeta']);
    const nonEmpty = [];
    for (const table of allTables) {
        const [rows] = await db.sequelize.query(
            'SELECT COUNT(*)::int AS "count" FROM ' + quoteIdentifier(table)
        );
        const count = Number(rows[0].count);
        if (count > 0) nonEmpty.push({ table, count });
        if (!allowedRows.has(table)) {
            assert.strictEqual(count, 0, table + ' still contains ' + count + ' row(s) after reset.');
        }
    }

    assert.strictEqual(await db.Role.count(), BUILT_IN_ROLES.length, 'Unexpected role count after reset.');
    assert.strictEqual(await db.User.count(), 1, 'Unexpected user count after reset.');
    assert.strictEqual(await db.WorkflowAction.count(), DEFAULT_WORKFLOW_ACTIONS.length, 'Unexpected workflow action count after reset.');
    assert.strictEqual(await db.Patient.count(), 0, 'Patients were not cleared.');
    assert.strictEqual(await db.RXRecord.count(), 0, 'RX records were not cleared.');
    return nonEmpty;
}

async function main() {
    assertSafeTarget();
    await db.sequelize.authenticate();

    const transaction = await db.sequelize.transaction();
    let allTables;
    try {
        allTables = await publicTables(transaction);
        const tablesToClear = allTables.filter(name => name !== 'SequelizeMeta');
        assert(tablesToClear.length > 0, 'No staging tables were found to reset.');

        await db.sequelize.query(
            'TRUNCATE TABLE '
            + tablesToClear.map(quoteIdentifier).join(', ')
            + ' RESTART IDENTITY CASCADE',
            { transaction }
        );
        await seedCleanBaseline(transaction);

        fs.writeFileSync(credentialsPath, [
            'Patient RX staging administrator',
            'Generated: ' + new Date().toISOString(),
            'Database: ' + stagingConfig.dbName,
            'Username: ' + adminUsername,
            'Password: ' + adminPassword,
            '',
            'Change this password after login, then delete this file.'
        ].join('\r\n'), { encoding: 'utf8', mode: 0o600 });

        await transaction.commit();
    } catch (err) {
        await transaction.rollback().catch(() => {});
        try { fs.unlinkSync(credentialsPath); } catch {}
        throw err;
    }

    const nonEmpty = await verifyBaseline(allTables);
    console.log('PASS reset database: ' + stagingConfig.dbName);
    console.log('PASS production/business tables are empty.');
    console.log('PASS clean baseline rows: ' + nonEmpty.map(item => item.table + '=' + item.count).join(', '));
    console.log('PASS staging admin username: ' + adminUsername);
    console.log('Credentials file: ' + credentialsPath);
}

main()
    .catch(err => {
        console.error('FAIL staging data reset');
        console.error(err.stack || err.message);
        process.exitCode = 1;
    })
    .finally(async () => {
        await db.sequelize.close().catch(() => {});
    });
