'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

async function main() {
    const databaseName = String(process.env.DB_NAME || '');
    assert.strictEqual(process.env.GITHUB_ACTIONS, 'true', 'Real recoverability integration is restricted to GitHub Actions.');
    assert.strictEqual(process.env.CI, 'true', 'Real recoverability integration requires the disposable CI environment.');
    assert.strictEqual(
        process.env.BACKUP_RECOVERABILITY_REAL_DB,
        'true',
        'Real recoverability validation requires BACKUP_RECOVERABILITY_REAL_DB=true.'
    );
    assert.match(
        databaseName,
        /^rx_next_ci_[a-z0-9_]+$/,
        'Real recoverability validation is restricted to an RX NEXT CI database.'
    );

    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rx-recoverability-ci-'));
    process.env.APP_WRITABLE_ROOT = runtimeRoot;
    process.env.BACKUP_SCHEDULER_ENABLED = 'false';
    process.env.SITE_BACKUP_SCHEDULER_ENABLED = 'false';
    process.env.SECURITY_ALERT_BACKUP_MONITOR = 'false';

    const backupService = require('../services/backupService');
    const db = require('../models');
    try {
        const backup = await backupService.runBackup('Lifecycle CI recoverability integration');
        assert.strictEqual(backup.status, 'success', backup.error || backup.verificationError || 'Backup creation failed.');
        assert.ok(backup.sha256 && backup.sizeBytes > 0 && backup.mtimeMs > 0, 'Backup file identity was not recorded.');
        assert.ok(backup.fingerprint, 'Backup fingerprint was not recorded.');
        assert.strictEqual(backup.sourceDatabaseIdentity.actualDatabaseName, databaseName);
        assert.strictEqual(
            backupService.databaseIdentitiesMatch(
                backup.sourceDatabaseIdentity,
                backup.sourceDatabaseIdentity
            ),
            true,
            'Backup source database identity is incomplete.'
        );

        const validation = await backupService.validateLatestBackupRecoverability({
            elevatedIsolatedOperation: true,
            confirmDatabase: databaseName,
            requireFreshBackupHours: 1
        });
        assert.strictEqual(validation.status, 'passed', validation.message || 'Recoverability validation failed.');
        assert.strictEqual(validation.cleanupSucceeded, true, 'Temporary database cleanup was not verified.');
        assert.strictEqual(validation.evidencePersisted, true, 'Recoverability evidence was not persisted.');
        assert.strictEqual(validation.fingerprintVerified, true, 'Restored fingerprint was not verified.');

        const rows = await db.sequelize.query(
            `SELECT COUNT(*)::int AS "count"
             FROM pg_database
             WHERE datname ~ '^rx_health_validate_[a-z0-9_]+$'`,
            { type: db.Sequelize.QueryTypes.SELECT }
        );
        assert.strictEqual(Number(rows[0] && rows[0].count || 0), 0, 'A temporary validation database was left behind.');

        console.log('PASS real isolated backup recoverability validation and cleanup.');
    } finally {
        await db.sequelize.close().catch(() => {});
        fs.rmSync(runtimeRoot, { recursive: true, force: true });
    }
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
