'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

process.env.BACKUP_SCHEDULER_ENABLED = 'false';
process.env.SITE_BACKUP_SCHEDULER_ENABLED = 'false';

const backupService = require('../services/backupService');

const dbStatus = backupService.getReadOnlyStatus();
const siteStatus = backupService.getSiteBackupStatus();

assert.strictEqual(dbStatus.schedulerEnabled, false, 'database scheduler flag must disable startup');
assert.strictEqual(dbStatus.schedule, 'off', 'database scheduler must report off');
assert.strictEqual(siteStatus.schedulerEnabled, false, 'site scheduler flag must disable startup');
assert.strictEqual(siteStatus.schedule, 'off', 'site scheduler must report off');

const dbStart = backupService.startScheduler('* * * * * *');
const siteStart = backupService.startSiteBackupScheduler('* * * * * *');

assert.deepStrictEqual(dbStart, {
    ok: true,
    schedule: 'off',
    disabledByEnvironment: true
});
assert.deepStrictEqual(siteStart, {
    ok: true,
    schedule: 'off',
    disabledByEnvironment: true
});

function runChild(source, extraEnv) {
    const result = spawnSync(process.execPath, ['-e', source], {
        cwd: path.join(__dirname, '..'),
        encoding: 'utf8',
        env: Object.assign({}, process.env, extraEnv || {})
    });
    assert.strictEqual(
        result.status,
        0,
        `child assertion failed\nstdout:\n${result.stdout || ''}\nstderr:\n${result.stderr || ''}`
    );
}

const servicePath = require.resolve('../services/backupService');
runChild(`
    const assert = require('assert');
    const Module = require('module');
    const tasks = [];
    const fakeCron = {
        validate(expression) { return expression !== 'invalid cron'; },
        schedule(expression) {
            if (expression === 'throwing cron') throw new Error('fixture scheduling failure');
            const task = { expression, stopped: false, stop() { this.stopped = true; } };
            tasks.push(task);
            return task;
        }
    };
    const originalLoad = Module._load;
    Module._load = function(request) {
        if (request === 'node-cron') return fakeCron;
        return originalLoad.apply(this, arguments);
    };
    const service = require(${JSON.stringify(servicePath)});
    const initialDbTask = tasks[0];
    const initialSiteTask = tasks[1];
    assert.ok(initialDbTask && initialSiteTask);

    assert.strictEqual(service.startScheduler('5 4 * * *', { persist: false }).ok, true);
    const activeDbTask = tasks[2];
    assert.strictEqual(initialDbTask.stopped, true);
    const invalidDb = service.startScheduler('invalid cron', { persist: false });
    assert.strictEqual(invalidDb.ok, false);
    assert.strictEqual(invalidDb.schedule, '5 4 * * *');
    assert.strictEqual(activeDbTask.stopped, false, 'invalid DB cron must preserve the active task');
    assert.strictEqual(service.getReadOnlyStatus().schedule, '5 4 * * *');
    const failedDbStart = service.startScheduler('throwing cron', { persist: false });
    assert.strictEqual(failedDbStart.ok, false);
    assert.strictEqual(failedDbStart.schedule, '5 4 * * *');
    assert.strictEqual(activeDbTask.stopped, false, 'scheduler construction failure must preserve the active task');

    assert.strictEqual(service.startSiteBackupScheduler('10 3 * * 0', { persist: false }).ok, true);
    const activeSiteTask = tasks[3];
    assert.strictEqual(initialSiteTask.stopped, true);
    const invalidSite = service.startSiteBackupScheduler('invalid cron', { persist: false });
    assert.strictEqual(invalidSite.ok, false);
    assert.strictEqual(invalidSite.schedule, '10 3 * * 0');
    assert.strictEqual(activeSiteTask.stopped, false, 'invalid site cron must preserve the active task');
    assert.strictEqual(service.getSiteBackupStatus().schedule, '10 3 * * 0');

    service.startScheduler('off', { persist: false });
    service.startSiteBackupScheduler('off', { persist: false });
`, {
    BACKUP_SCHEDULER_ENABLED: 'true',
    SITE_BACKUP_SCHEDULER_ENABLED: 'true',
    SECURITY_ALERT_BACKUP_MONITOR: 'false'
});

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rx-backup-health-'));
try {
    runChild(`
        const assert = require('assert');
        const crypto = require('crypto');
        const fs = require('fs');
        const path = require('path');
        const service = require(${JSON.stringify(servicePath)});
        const backupDir = service.getDbBackupDir();
        fs.mkdirSync(backupDir, { recursive: true });
        const dumpName = 'backup-test.dump';
        const dumpBytes = Buffer.from('bound dump fixture');
        fs.writeFileSync(path.join(backupDir, dumpName), dumpBytes);
        const timestamp = new Date(Date.now() - 60 * 1000).toISOString();
        const sourceDatabaseIdentity = service.getDatabaseIdentity(process.env, {
            databaseName: process.env.DB_NAME,
            databaseOid: '515151',
            serverAddress: '127.0.0.1',
            serverPort: process.env.DB_PORT || '5432'
        });
        const configuredDatabaseIdentity = service.getDatabaseIdentity(process.env);
        fs.writeFileSync(path.join(backupDir, 'backup.log.json'), JSON.stringify([
            { kind: 'database-restore', status: 'success', timestamp: new Date().toISOString(), triggeredBy: 'Manual restore', filename: null },
            { status: 'success', timestamp: new Date().toISOString(), triggeredBy: 'Manual restore', filename: null },
            { kind: 'database-backup', status: 'success', timestamp, triggeredBy: 'Test', filename: dumpName, size: dumpBytes.length, sourceDatabaseIdentity },
            { kind: 'database-backup', status: 'failed', timestamp, triggeredBy: 'Test', filename: null, size: 0, sourceDatabaseIdentity: configuredDatabaseIdentity }
        ], null, 2));

        (async () => {
            const status = service.getReadOnlyStatus();
            assert.strictEqual(status.recentBackups.length, 2, 'restore history must not be classified as backup history');
            assert.ok(status.recentBackups.every(entry => entry.kind === 'database-backup'));
            assert.strictEqual(service.databaseIdentitiesMatch(sourceDatabaseIdentity, sourceDatabaseIdentity), true);
            assert.strictEqual(service.databaseIdentitiesMatch(configuredDatabaseIdentity, sourceDatabaseIdentity), false, 'configured-only identity must not prove a backup source');
            assert.strictEqual(service.configuredDatabaseIdentitiesMatch(
                sourceDatabaseIdentity,
                Object.assign({}, sourceDatabaseIdentity, { databaseName: 'other_database' })
            ), false, 'a backup for another database must never match the current source');
            assert.strictEqual(service.databaseIdentitiesMatch(
                sourceDatabaseIdentity,
                Object.assign({}, sourceDatabaseIdentity, { databaseOid: '616161' })
            ), false, 'a recreated database with the same name but a new OID must require a new backup');
            const identity = await service.getBackupFileIdentity(dumpName);
            assert.strictEqual(identity.sha256, crypto.createHash('sha256').update(dumpBytes).digest('hex'));
            assert.strictEqual(identity.sizeBytes, dumpBytes.length);
            assert.ok(identity.mtimeMs > 0);

            const base = {
                schemaTableCount: 30,
                migrationCount: 12,
                missingMigrationChecksums: 0,
                migrationLedgerHash: 'ledger-hash',
                rowCounts: { patients: 1000, rxRecords: 2000, workflowTrackings: 3000 },
                totalCoreRows: 6000,
                maxTableRows: 3000
            };
            const withinTolerance = Object.assign({}, base, {
                rowCounts: { patients: 1005, rxRecords: 2000, workflowTrackings: 3000 }
            });
            assert.strictEqual(service.compareRecoverabilityFingerprints(base, withinTolerance).ok, true);
            const mismatch = Object.assign({}, base, {
                rowCounts: { patients: 1200, rxRecords: 2000, workflowTrackings: 3000 }
            });
            assert.strictEqual(service.compareRecoverabilityFingerprints(base, mismatch).ok, false);

            const guarded = await service.validateLatestBackupRecoverability();
            assert.strictEqual(guarded.status, 'skipped');
            assert.match(guarded.message, /explicitly confirmed isolated maintenance process/);
            const unbound = await service.validateLatestBackupRecoverability({
                elevatedIsolatedOperation: true,
                confirmDatabase: process.env.DB_NAME
            });
            assert.strictEqual(unbound.status, 'failed');
            assert.match(unbound.message, /predates bound dump.*schema fingerprint evidence/);
            assert.strictEqual(unbound.cleanupSucceeded, undefined, 'no temporary database was created for an unbound dump');
        })().catch(error => {
            console.error(error);
            process.exitCode = 1;
        });
    `, {
        APP_WRITABLE_ROOT: tempRoot,
        DB_NAME: 'rx_backup_health_fixture',
        BACKUP_SCHEDULER_ENABLED: 'false',
        SITE_BACKUP_SCHEDULER_ENABLED: 'false',
        SECURITY_ALERT_BACKUP_MONITOR: 'false'
    });
} finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
}

const lifecyclePath = require.resolve('./db-lifecycle');
runChild(`
    const assert = require('assert');
    const servicePath = ${JSON.stringify(servicePath)};
    let captured = null;
    let returnUnsafeTarget = false;
    require.cache[servicePath] = {
        id: servicePath,
        filename: servicePath,
        loaded: true,
        exports: {
            async validateLatestBackupRecoverability(options) {
                captured = options;
                assert.strictEqual(process.env.BACKUP_SCHEDULER_ENABLED, 'false');
                assert.strictEqual(process.env.SITE_BACKUP_SCHEDULER_ENABLED, 'false');
                return {
                    status: 'passed',
                    evidencePersisted: true,
                    cleanupSucceeded: true,
                    backupFile: 'backup-test.dump',
                    tempDatabase: returnUnsafeTarget ? 'rx_cli_guard_test' : 'rx_health_validate_test',
                    message: 'fixture passed'
                };
            }
        }
    };
    const lifecycle = require(${JSON.stringify(lifecyclePath)});
    (async () => {
        await assert.rejects(
            lifecycle.main([
                'validate-backup-recoverability',
                '--confirm-database', 'wrong_database',
                '--acknowledge-isolated-maintenance'
            ]),
            /must exactly match DB_NAME/
        );
        await assert.rejects(
            lifecycle.main([
                'validate-backup-recoverability',
                '--confirm-database', 'rx_cli_guard_test'
            ]),
            /acknowledge-isolated-maintenance/
        );
        returnUnsafeTarget = true;
        await assert.rejects(
            lifecycle.main([
                'validate-backup-recoverability',
                '--confirm-database', 'rx_cli_guard_test',
                '--acknowledge-isolated-maintenance'
            ]),
            /unsafe temporary database target/
        );
        returnUnsafeTarget = false;
        const code = await lifecycle.main([
            'validate-backup-recoverability',
            '--confirm-database', 'rx_cli_guard_test',
            '--acknowledge-isolated-maintenance',
            '--require-fresh-hours', '24'
        ]);
        assert.strictEqual(code, 0);
        assert.deepStrictEqual(captured, {
            elevatedIsolatedOperation: true,
            confirmDatabase: 'rx_cli_guard_test',
            requireFreshBackupHours: '24'
        });
    })().catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
`, {
    DB_NAME: 'rx_cli_guard_test',
    BACKUP_SCHEDULER_ENABLED: 'true',
    SITE_BACKUP_SCHEDULER_ENABLED: 'true'
});

const source = fs.readFileSync(servicePath, 'utf8');
assert.ok(source.includes("kind:        'database-backup'"), 'new backup log entries must be typed');
assert.ok(source.includes("kind:        'database-restore'"), 'restore history entries must be typed separately');
assert.ok(source.includes("fingerprint = await _queryApplicationFingerprint"), 'successful backup creation must record a schema/data fingerprint');
assert.ok(source.includes('sourceDatabaseIdentity'), 'backup creation and validation evidence must bind the source database identity');
assert.ok(
    source.includes('const currentDatabaseIdentity = await _queryDatabaseRuntimeIdentity'),
    'missing-backup monitoring must compare records with the current runtime database identity'
);
assert.ok(
    source.includes("excludeRelativePaths: ['administration/delivery-log-archives']"),
    'site ZIP must exclude the precise delivery-log archive subtree'
);
assert.ok(source.includes('$normalizedRel.StartsWith($normalizedExcluded + "/")'));
const broadExcludes = source.match(/excludes:\s*\[([^\]]+)\]/);
assert.ok(broadExcludes && !broadExcludes[1].includes('delivery-log-archives'), 'PHI exclusion must not use a broad directory-name match');

const lifecycleSource = fs.readFileSync(lifecyclePath, 'utf8');
assert.ok(lifecycleSource.includes("case 'validate-backup-recoverability':"));
assert.ok(lifecycleSource.includes('--acknowledge-isolated-maintenance'));
assert.ok(lifecycleSource.includes("process.env.BACKUP_SCHEDULER_ENABLED = 'false'"));
assert.ok(lifecycleSource.includes("process.env.SITE_BACKUP_SCHEDULER_ENABLED = 'false'"));
const packageJson = require('../package.json');
assert.strictEqual(
    packageJson.scripts['db:backup:validate-recoverability'],
    'node scripts/db-lifecycle.js validate-backup-recoverability'
);

console.log('Backup scheduler-disable tests passed.');
