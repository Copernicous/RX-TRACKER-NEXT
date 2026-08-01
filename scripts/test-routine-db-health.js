'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

process.env.BACKUP_SCHEDULER_ENABLED = 'false';
process.env.SITE_BACKUP_SCHEDULER_ENABLED = 'false';

const db = require('../models');
const backupService = require('../services/backupService');
const adminController = require('../controllers/adminController');

const fixtureDatabaseRuntime = {
    databaseName: process.env.DB_NAME || 'patient_rx_dev',
    databaseOid: '424242',
    serverAddress: '127.0.0.1',
    serverPort: process.env.DB_PORT || '5432'
};
const fixtureDatabaseIdentity = backupService.getDatabaseIdentity(process.env, fixtureDatabaseRuntime);

function makeResponse() {
    return {
        statusCode: 200,
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(payload) {
            this.body = payload;
            return this;
        }
    };
}

function normalizeSql(sql) {
    return String(sql || '').replace(/\s+/g, ' ').trim();
}

function findItem(body, finding) {
    const items = Object.values(body.checks || {}).flatMap(check => check.items || []);
    return items.find(item => item.finding === finding);
}

function successfulBackupStatus(timestamp, unbound, manyNewerFailures) {
    const successful = {
        id: 1,
        filename: 'backup-test.dump',
        timestamp,
        triggeredBy: 'Test fixture',
        status: 'success',
        size: 4096,
        sizeBytes: 4096,
        fileSizeBytes: 4096,
        fileMtimeMs: 1700000000000,
        sourceDatabaseIdentity: unbound ? null : fixtureDatabaseIdentity
    };
    const recentBackups = manyNewerFailures
        ? Array.from({ length: 31 }, (_, index) => ({
            id: 100 + index,
            filename: null,
            timestamp: new Date(Date.now() + index * 1000).toISOString(),
            triggeredBy: 'Failure fixture',
            status: 'failed',
            size: 0,
            sourceDatabaseIdentity: fixtureDatabaseIdentity
        })).concat(successful)
        : [successful];
    return {
        schedule: '0 2 * * *',
        schedulerEnabled: false,
        maxBackups: 10,
        configuredDatabaseIdentity: backupService.getDatabaseIdentity(process.env),
        recentBackups
    };
}

async function runScenario(name) {
    const sqlCalls = [];
    const originalQuery = db.sequelize.query;
    const originalTransaction = db.sequelize.transaction;
    const originalReadOnlyStatus = backupService.getReadOnlyStatus;
    const originalFileIdentity = backupService.getBackupFileIdentity;
    const originalEvidence = backupService.getLatestRecoverabilityEvidence;
    const originalValidator = backupService.validateLatestBackupRecoverability;
    let validatorCalls = 0;
    const backupTimestamp = new Date().toISOString();
    const backupIdentity = {
        sha256: 'a'.repeat(64),
        sizeBytes: 4096,
        mtimeMs: 1700000000000
    };

    backupService.getReadOnlyStatus = () => successfulBackupStatus(
        backupTimestamp,
        name === 'legacy-unbound-backup',
        name === 'many-newer-backup-failures'
    );
    backupService.getBackupFileIdentity = async () => backupIdentity;
    backupService.getLatestRecoverabilityEvidence = () => ['failing-catalog', 'wrong-backup-source', 'wrong-failed-source'].includes(name) ? {
        status: name === 'wrong-failed-source' ? 'failed' : 'passed',
        validatedAt: new Date().toISOString(),
        backupFile: 'backup-test.dump',
        latestBackupAt: backupTimestamp,
        backupSha256: backupIdentity.sha256,
        backupSizeBytes: backupIdentity.sizeBytes,
        backupMtimeMs: backupIdentity.mtimeMs,
        sourceDatabaseIdentity: ['wrong-backup-source', 'wrong-failed-source'].includes(name)
            ? Object.assign({}, fixtureDatabaseIdentity, { databaseName: 'different_database', actualDatabaseName: 'different_database' })
            : fixtureDatabaseIdentity,
        tableCount: 30,
        estimatedLiveRows: 1000,
        migrationChecksumsComplete: true,
        schemaVerified: true,
        fingerprintVerified: true,
        cleanupSucceeded: true,
        durationMs: 1200,
        message: 'fixture'
    } : null;
    backupService.validateLatestBackupRecoverability = async () => {
        validatorCalls += 1;
        throw new Error('Routine GET must never invoke restore validation');
    };

    db.sequelize.transaction = async (options, callback) => {
        assert.strictEqual(options.readOnly, true, 'large-column aggregate transaction must be read-only');
        return callback({ fixture: true });
    };

    db.sequelize.query = async (sql, options) => {
        const normalized = normalizeSql(sql);
        sqlCalls.push({ sql: normalized, options: options || {} });

        assert.ok(!/\b(?:DROP|CREATE|ALTER|INSERT|UPDATE|DELETE|TRUNCATE)\b/i.test(normalized), `mutating SQL in routine GET: ${normalized}`);

        if (normalized.includes('AS "databaseOid"') && normalized.includes('current_database()')) {
            return [fixtureDatabaseRuntime];
        }

        if (normalized.includes('FROM pg_extension') && normalized.includes('pg_stat_statements')) {
            return [{ available: ['failing-catalog', 'legacy-statements', 'update-assignment'].includes(name) }];
        }
        if (normalized.includes('FROM pg_stat_statements')) {
            assert.ok(normalized.includes('dbid = (SELECT oid FROM pg_database WHERE datname = current_database())'), 'statement evidence must be database-filtered');
            assert.ok(normalized.includes('userid = (SELECT usesysid FROM pg_user WHERE usename = current_user)'), 'statement evidence must be runtime-user-filtered');
            if (name === 'legacy-statements' && normalized.includes('stats_since AS "statsSince"')) {
                throw new Error('column stats_since does not exist');
            }
            return [{
                calls: 100,
                total_exec_time: 40000,
                mean_exec_time: 400,
                rows: 100,
                sharedBlks: 5000,
                statsSince: name === 'legacy-statements' ? null : new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(),
                statsAgeHours: name === 'legacy-statements' ? null : 40 * 24,
                query: name === 'update-assignment'
                    ? 'UPDATE "AuditLogs" SET "newValue" = $1 WHERE "id" = $2'
                    : 'SELECT "newValue" FROM "AuditLogs" WHERE "newValue" IS NOT NULL'
            }];
        }
        if (normalized.includes('FROM pg_stat_database')) {
            return [{
                statsReset: new Date(Date.now() - (['failing-catalog', 'update-assignment'].includes(name) ? 40 : 0.5) * 24 * 60 * 60 * 1000).toISOString(),
                statsAgeHours: ['failing-catalog', 'update-assignment'].includes(name) ? 40 * 24 : 12
            }];
        }
        if (normalized.includes('JOIN pg_index ix')) {
            if (name !== 'failing-catalog') return [];
            return [
                { schema: 'public', table: 'AuditLogs', index: 'auditlogs_constraint_idx', idxScan: 0, sizeBytes: 50 * 1024 * 1024, liveRows: 10000, writeRows: 5000, isValid: true, isReady: true, isLive: true, constraintOwned: true, supportsForeignKey: false },
                { schema: 'public', table: 'AuditLogs', index: 'auditlogs_fk_idx', idxScan: 0, sizeBytes: 50 * 1024 * 1024, liveRows: 10000, writeRows: 5000, isValid: true, isReady: true, isLive: true, constraintOwned: false, supportsForeignKey: true },
                { schema: 'public', table: 'AuditLogs', index: 'auditlogs_cleanup_idx', idxScan: 0, sizeBytes: 50 * 1024 * 1024, liveRows: 10000, writeRows: 5000, isValid: true, isReady: true, isLive: true, constraintOwned: false, supportsForeignKey: false },
                { schema: 'public', table: 'AuditLogs', index: 'auditlogs_invalid_idx', idxScan: 0, sizeBytes: 50 * 1024 * 1024, liveRows: 10000, writeRows: 5000, isValid: false, isReady: true, isLive: true, constraintOwned: false, supportsForeignKey: false },
                { schema: 'public', table: 'AuditLogs', index: 'auditlogs_candidate_idx', idxScan: 0, sizeBytes: 12 * 1024 * 1024, liveRows: 10000, writeRows: 100, isValid: true, isReady: true, isLive: true, isReplicaIdentity: false, isClustered: false, constraintOwned: false, supportsForeignKey: false }
            ];
        }
        if (normalized.includes('FROM pg_class c') && normalized.includes('AS "seqScan"')) {
            if (!['failing-catalog', 'update-assignment'].includes(name)) return [];
            return [{
                schema: 'public',
                table: 'AuditLogs',
                seqScan: 1000,
                idxScan: 0,
                liveRows: 100000,
                sizeBytes: 80 * 1024 * 1024,
                inserts: 100,
                updates: 500,
                deletes: 10,
                modSinceAnalyze: 20,
                tableColumns: ['id', 'newValue'],
                indexedLeadingColumns: ['id']
            }];
        }
        if (normalized.includes('FROM pg_stat_user_tables') && normalized.includes('AS "deadRatio"')) {
            return [{
                schema: 'public',
                table: 'TransientRows',
                liveRows: 0,
                deadRows: 100,
                deadRatio: 1,
                tableSizeBytes: 65536,
                lastVacuum: 'never',
                lastAutovacuum: 'never',
                lastAnalyze: 'never',
                lastAutoanalyze: 'never',
                writeRows: 100
            }];
        }
        if (normalized.includes('FROM information_schema.columns c')) {
            assert.ok(!normalized.includes('COALESCE(ps.avg_width, 0) >=') , 'candidate discovery must not require pg_stats');
            assert.ok(normalized.includes('c.character_maximum_length IS NULL'), 'unlimited varchar columns must be candidates');
            return name === 'failing-catalog' ? [{
                schemaName: 'public',
                tableName: 'AuditLogs',
                columnName: 'newValue',
                dataType: 'jsonb',
                varcharLength: null,
                avgWidth: 0
            }] : [];
        }
        if (normalized.includes('FROM pg_attribute a')) return [{ count: 1 }];
        if (normalized === 'SET TRANSACTION READ ONLY') return [];
        if (normalized.startsWith('SET LOCAL statement_timeout')) return [];
        if (normalized.includes('SUM(pg_column_size')) {
            throw new Error('fixture statement timeout');
        }
        throw new Error(`Unexpected SQL in ${name}: ${normalized}`);
    };

    const res = makeResponse();
    try {
        await adminController.getRoutineDbChecks({}, res);
        return { res, sqlCalls, validatorCalls };
    } finally {
        db.sequelize.query = originalQuery;
        db.sequelize.transaction = originalTransaction;
        backupService.getReadOnlyStatus = originalReadOnlyStatus;
        backupService.getBackupFileIdentity = originalFileIdentity;
        backupService.getLatestRecoverabilityEvidence = originalEvidence;
        backupService.validateLatestBackupRecoverability = originalValidator;
    }
}

async function main() {
    if (process.env.ROUTINE_DB_HEALTH_REAL_DB === 'true') {
        await db.sequelize.authenticate();
        const [identity] = await db.sequelize.query(
            `SELECT current_user AS "currentUser",
                    (SELECT rolsuper OR rolcreatedb FROM pg_roles WHERE rolname = current_user) AS "elevated"`,
            { type: db.Sequelize.QueryTypes.SELECT }
        );
        assert.strictEqual(identity.currentUser, process.env.DB_USER, 'integration check must use the configured restricted runtime role');
        assert.strictEqual(identity.elevated, false, 'routine health integration must not use an elevated database role');

        const res = makeResponse();
        await adminController.getRoutineDbChecks({}, res);
        assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
        assert.strictEqual(res.body.checkerStatus, 'ok', JSON.stringify(res.body));
        assert.strictEqual(res.body.totals.checkerErrors, 0, JSON.stringify(res.body));
        assert.ok(res.body.checks.largeColumns, 'real PostgreSQL run must exercise large-column checks');
        assert.ok(res.body.checks.indexChecks, 'real PostgreSQL run must exercise index checks');
        console.log(`Routine database-health restricted-role integration passed as ${identity.currentUser}.`);
        return;
    }

    const inconclusive = await runScenario('inconclusive');
    assert.strictEqual(inconclusive.res.statusCode, 200);
    assert.strictEqual(inconclusive.validatorCalls, 0, 'routine GET never runs restore validation');
    assert.strictEqual(inconclusive.res.body.totals.checkerErrors, 0);
    assert.strictEqual(findItem(inconclusive.res.body, 'Missing-index analysis inconclusive').severity, 'info');
    assert.strictEqual(findItem(inconclusive.res.body, 'Missing-index analysis inconclusive').confidence, 'low');
    assert.strictEqual(findItem(inconclusive.res.body, 'Unused-index analysis inconclusive').severity, 'info');
    assert.strictEqual(findItem(inconclusive.res.body, 'Dead tuple ratio').severity, 'info', 'small dead-only tables stay informational');
    assert.strictEqual(findItem(inconclusive.res.body, 'Dead tuple ratio').evidence.totalTupleEstimate, 100);
    assert.strictEqual(findItem(inconclusive.res.body, 'Database recoverability not independently validated').severity, 'info');
    assert.strictEqual(inconclusive.res.body.overall, 'info', 'informational uncertainty must not report an overall OK');

    const legacyUnboundBackup = await runScenario('legacy-unbound-backup');
    const legacyCreationFinding = findItem(legacyUnboundBackup.res.body, 'Database backup creation recency');
    assert.strictEqual(legacyCreationFinding.severity, 'warning', 'a real legacy dump is inconclusive, not critical');
    assert.strictEqual(legacyCreationFinding.evidence.unboundOrOtherSuccessfulDumps, 1);

    const manyFailures = await runScenario('many-newer-backup-failures');
    const manyFailuresCreation = findItem(manyFailures.res.body, 'Database backup creation recency');
    assert.strictEqual(manyFailuresCreation.severity, 'ok', 'display truncation must not hide a valid current backup');
    assert.strictEqual(manyFailuresCreation.evidence.latestBackupFile, 'backup-test.dump');

    const legacy = await runScenario('legacy-statements');
    assert.strictEqual(legacy.res.statusCode, 200);
    assert.strictEqual(legacy.res.body.totals.checkerErrors, 0);
    assert.match(
        findItem(legacy.res.body, 'Missing-index analysis inconclusive').reason,
        /does not expose the statement statistics start time/
    );
    const legacyStatementCalls = legacy.sqlCalls.filter(call => call.sql.includes('FROM pg_stat_statements'));
    assert.strictEqual(legacyStatementCalls.length, 2, 'legacy stats_since fallback must run once after the primary query');

    const updateAssignment = await runScenario('update-assignment');
    assert.strictEqual(updateAssignment.res.statusCode, 200);
    assert.strictEqual(
        findItem(updateAssignment.res.body, 'Potential missing index candidate'),
        undefined,
        'UPDATE SET assignments must not be classified as filter/join index candidates'
    );
    assert.ok(findItem(updateAssignment.res.body, 'No supported missing-index recommendation'));

    const failing = await runScenario('failing-catalog');
    assert.strictEqual(failing.res.statusCode, 200);
    assert.strictEqual(failing.validatorCalls, 0, 'failing catalog path still never runs restore validation');
    assert.strictEqual(failing.res.body.totals.checkerErrors, 1, 'checker failure has a separate total');
    assert.strictEqual(failing.res.body.totals.critical, 0, 'checker failure is not a database critical result');
    const checkerError = findItem(failing.res.body, 'Large-column size evaluation incomplete');
    assert.strictEqual(checkerError.resultType, 'checkerError');
    assert.strictEqual(checkerError.severity, 'error');
    const missingCandidate = findItem(failing.res.body, 'Potential missing index candidate');
    assert.deepStrictEqual(missingCandidate.evidence.actualFilterJoinColumns, ['newvalue']);
    assert.deepStrictEqual(missingCandidate.evidence.existingIndexedLeadingColumns, ['id']);
    assert.match(missingCandidate.recommendedAction, /EXPLAIN \(ANALYZE, BUFFERS\)/);
    const unusedCandidates = failing.res.body.checks.indexChecks.items.filter(item => item.finding === 'Potentially unused/over-maintained index');
    assert.strictEqual(unusedCandidates.length, 1, 'constraint/FK/cleanup indexes must be excluded');
    assert.strictEqual(unusedCandidates[0].severity, 'info', 'ordinary unused candidate stays informational');
    assert.strictEqual(findItem(failing.res.body, 'Database recoverability independently validated').severity, 'ok');
    const slowFinding = findItem(failing.res.body, 'High-latency SQL statement');
    assert.strictEqual(slowFinding.confidence, 'high', 'maximum slow-query score must reach high confidence');
    assert.strictEqual(slowFinding.severity, 'warning');

    const readOnlyCall = failing.sqlCalls.findIndex(call => call.sql === 'SET TRANSACTION READ ONLY');
    const timeoutCall = failing.sqlCalls.findIndex(call => call.sql.startsWith('SET LOCAL statement_timeout'));
    assert.ok(readOnlyCall >= 0 && readOnlyCall < timeoutCall, 'explicit PostgreSQL read-only mode must be set before the aggregate');

    const missingCatalogSql = failing.sqlCalls.find(call => call.sql.includes('AS "indexedLeadingColumns"'));
    assert.ok(missingCatalogSql, 'missing-index query must inspect existing leading index columns');
    assert.match(missingCatalogSql.sql, /existing_ix\.indisvalid/);
    const unusedCatalogSql = failing.sqlCalls.find(call => call.sql.includes('JOIN pg_index ix'));
    assert.match(unusedCatalogSql.sql, /ix\.indisvalid/);
    assert.match(unusedCatalogSql.sql, /NOT ix\.indisreplident/);
    assert.match(unusedCatalogSql.sql, /array_agg\(key_col ORDER BY key_col\)/);

    for (const scenario of ['wrong-backup-source', 'wrong-failed-source']) {
        const wrongBackupSource = await runScenario(scenario);
        const wrongSourceFinding = findItem(wrongBackupSource.res.body, 'Database recoverability not independently validated');
        assert.strictEqual(wrongSourceFinding.severity, 'info');
        assert.strictEqual(wrongSourceFinding.evidence.matchesCurrentDatabaseIdentity, false);
    }
    assert.match(unusedCatalogSql.sql, /array_agg\(fk_col ORDER BY fk_col\)/);

    const uiSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'backoffice-features.js'), 'utf8');
    assert.ok(!uiSource.includes('idx > 25'), 'routine UI must not silently truncate findings');
    ['Reason', 'Evidence', 'Confidence', 'Recommended action', 'Human approval'].forEach(label => {
        assert.ok(uiSource.includes(`_routineDetail('${label}'`), `routine UI must show ${label}`);
    });

    console.log('Routine database-health controller tests passed.');
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
}).finally(async () => {
    await db.sequelize.close().catch(() => {});
});
