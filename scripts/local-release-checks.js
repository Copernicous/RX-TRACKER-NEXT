'use strict';

// Local equivalent of database-lifecycle-ci.yml. Creates only disposable,
// collision-checked rx_next_ci_* databases; never reads business databases.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync, spawn } = require('child_process');
const { Client } = require('pg');
const root = path.resolve(__dirname, '..');
const argument = name => process.argv[process.argv.indexOf(name) + 1];
if (!process.argv.includes('--env-file') || !process.argv.includes('--output')) {
    throw Error('Usage: node scripts/local-release-checks.js --env-file <local maintenance env> --output <new evidence directory>');
}
const supplied = require('dotenv').parse(fs.readFileSync(path.resolve(argument('--env-file'))));
if (supplied.DB_HOST !== '127.0.0.1' || !supplied.DB_USER || !supplied.DB_PASS) throw Error('Explicit localhost maintenance credentials required.');
const output = path.resolve(argument('--output'));
fs.mkdirSync(output, { recursive: true });
const lock = path.join(output, 'running.lock');
fs.writeFileSync(lock, String(process.pid), { flag: 'wx' });
const databases = ['base_test', 'ledger_test', 'sanitizer_test', 'v331_copy', 'restore_rehearsal', 'regression_test', 'driver_test'].map(n => 'rx_next_ci_' + n);
const created = [];
const runtimeRole = 'rxnext_runtime_local_' + crypto.randomBytes(5).toString('hex');
let roleCreated = false;
const env = { ...process.env, NODE_ENV: 'development', CI: 'true', RX_LOCAL_RELEASE_TEST: '1',
    DB_HOST: '127.0.0.1', DB_PORT: supplied.DB_PORT || '5432', DB_USER: supplied.DB_USER, DB_PASS: supplied.DB_PASS,
    PGPASSWORD: supplied.DB_PASS, DB_NAME: databases[0],
    JWT_SECRET: crypto.randomBytes(32).toString('hex'), SETTINGS_ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex'),
    SOFTPHONE_CREDENTIAL_KEY: crypto.randomBytes(32).toString('hex'), SOFTPHONE_RELAY_SECRET: crypto.randomBytes(32).toString('hex'),
    APP_ORIGINS: 'http://127.0.0.1:3211', APP_ORIGIN: 'http://127.0.0.1:3211',
    APP_WRITABLE_ROOT: path.join(output, 'runtime'), BACKUP_SCHEDULER_ENABLED: 'false', SITE_BACKUP_SCHEDULER_ENABLED: 'false',
    BACKUP_SCHEDULE: 'off', SITE_BACKUP_SCHEDULE: 'off', SECURITY_ALERT_BACKUP_MONITOR: 'false' };
delete env.GITHUB_ACTIONS;
delete env.BACKUP_SCHEDULE;
delete env.SITE_BACKUP_SCHEDULE;
const pgBin = argument('--pg-bin') && process.argv.includes('--pg-bin') ? path.resolve(argument('--pg-bin')) : 'C:/Program Files/PostgreSQL/17/bin';
env.PATH = pgBin + path.delimiter + env.PATH;
const evidence = { sourceCommit: spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim(),
    version: require('../package.json').version, node: process.version, startedAt: new Date().toISOString(), checks: [], passed: false };
function run(label, command, args, extra = {}, timeout = 180000) {
    const log = path.join(output, String(evidence.checks.length + 1).padStart(3, '0') + '-' + label.replace(/[^a-z0-9-]/gi, '-') + '.log');
    const fd = fs.openSync(log, 'w');
    const started = Date.now();
    let result;
    try { result = spawnSync(command, args, { cwd: root, env: { ...env, APP_WRITABLE_ROOT: path.join(output, 'runtime', label), ...extra }, stdio: ['ignore', fd, fd], timeout, windowsHide: true }); }
    finally { fs.closeSync(fd); }
    const passed = !result.error && result.status === 0;
    evidence.checks.push({ label, passed, elapsedMs: Date.now() - started, log: path.basename(log) });
    console.log((passed ? 'PASS ' : 'FAIL ') + label);
    if (!passed) throw Error(label + ' failed; inspect ' + log + (result.error ? ' (' + result.error.message + ')' : ''));
}
const node = (label, file, args = [], extra = {}, timeout) => run(label, process.execPath, [file, ...args], extra, timeout);
const lifecycle = (label, args, extra = {}) => node(label, 'scripts/db-lifecycle.js', args, extra);
const ps = (label, file, args = [], extra = {}) => run(label, 'powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file, ...args], extra);
const npmCli = path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
const admin = new Client({ host: env.DB_HOST, port: Number(env.DB_PORT), user: env.DB_USER, password: env.DB_PASS, database: 'postgres' });
async function create(database, template = 'template0') {
    if (!databases.includes(database) || !['template0', databases[0]].includes(template)) throw Error('Unsafe fixture database name.');
    await admin.query(`CREATE DATABASE "${database}" TEMPLATE "${template}"`);
    created.push(database);
}
async function smokeServer(label, database, port, extra = {}, relay = false) {
    const serverEnv = { ...env, ...extra, DB_NAME: database, PORT: String(port), APP_ORIGINS: `http://127.0.0.1:${port}`, APP_ORIGIN: `http://127.0.0.1:${port}` };
    const fd = fs.openSync(path.join(output, label + '-server.log'), 'w');
    const child = spawn(process.execPath, ['app.js'], { cwd: root, env: serverEnv, stdio: ['ignore', fd, fd], windowsHide: true });
    try {
        let healthy = false;
        for (let n = 0; n < 30; n++) {
            if (child.exitCode !== null) throw Error(label + ' server exited.');
            try {
                const response = await fetch(`http://127.0.0.1:${port}/api/healthz`);
                const health = await response.json();
                healthy = response.ok && health.status === 'ok' && health.pid === child.pid;
                if (healthy) break;
            } catch {}
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        if (!healthy) throw Error(label + ' server health failed.');
        if (relay) node('managed-softphone-relay', 'scripts/test-softphone-relay.js', [], { ...serverEnv, RELAY_TEST_DB_NAME: database, RELAY_TEST_PORT: String(port) });
        evidence.checks.push({ label, passed: true });
        console.log('PASS ' + label);
    } finally {
        if (child.exitCode === null) { child.kill(); await new Promise(resolve => child.once('exit', resolve)); }
        fs.closeSync(fd);
    }
}
(async () => {
    try {
        await admin.connect();
        const collisions = await admin.query('SELECT datname FROM pg_database WHERE datname = ANY($1)', [databases]);
        if (collisions.rows.length) throw Error('Disposable test database names already exist; no existing database will be overwritten.');
        const workflows = fs.readdirSync(path.join(root, '.github/workflows')).filter(n => /\.ya?ml$/.test(n));
        for (const name of workflows) {
            const text = fs.readFileSync(path.join(root, '.github/workflows', name), 'utf8');
            const trigger = text.split(/^on:\s*$/m)[1]?.split(/^permissions:|^jobs:/m)[0];
            if (!trigger || !/^\s+workflow_dispatch:/m.test(trigger) || /^\s+(push|pull_request|schedule|workflow_run|release):/m.test(trigger)) throw Error('Automatic hosted workflow trigger remains: ' + name);
        }
        evidence.checks.push({ label: 'manual-only-hosted-workflows', passed: true });
        run('dependency-audit', process.execPath, [npmCli, 'audit', '--audit-level=high']);
        node('public-javascript', 'scripts/check-public-js.js');
        for (const name of ['patient-delete-confirmation','backoffice-patient-identity','patient-import-duplicates','patient-create-duplicates','patient-address-update','dependency-policy','security-automation','reference-data','new-server-installer','project-control-test-copy-restore','report-view-render','delivery-log-archive','delivery-log-archive-client','routine-db-health','backup-scheduler-disable','backoffice-backup-snapshot','i18n-branding']) node(name, 'scripts/test-' + name + '.js');
        for (const name of ['Invoke-NextProduction','Invoke-ReleaseUpdate','Invoke-TestCopyRestore']) ps(name + '-self-test', 'scripts/' + name + '.ps1', ['-Action','SelfTest']);
        ps('backup-manifest-ps51', 'scripts/test-release-backup-manifest.ps1');
        ps('release-preflight-ps51', 'scripts/test-release-preflight.ps1');
        await create(databases[0]);
        for (const operation of ['provision','status','verify','migrate']) lifecycle('fresh-' + operation, [operation]);
        node('backup-recoverability', 'scripts/test-backup-recoverability-integration.js', [], { BACKUP_RECOVERABILITY_REAL_DB: 'true' });
        node('stage-report', 'scripts/test-rx-stage-report.js', [], { RX_STAGE_REPORT_TEST_DB_NAME: databases[0], RX_STAGE_REPORT_TEST_CONFIRM_DB_NAME: databases[0] });
        ps('release-runtime-recovery', 'scripts/test-release-runtime-recovery.ps1', ['-PgBin', pgBin]);
        node('release-region-backfill', 'scripts/test-release-region-backfill.js');
        await create(databases[1], databases[0]);
        node('migration-checksum-drift', 'scripts/test-migration-checksums.js', [], { DB_NAME: databases[1] });
        await create(databases[2], databases[0]);
        node('atomic-sanitizer', 'scripts/test-data-sanitizer.js', [], { DB_NAME: databases[2] });
        lifecycle('sanitizer-verify', ['validate-sanitized'], { DB_NAME: databases[2] });
        await create(databases[3], databases[0]);
        const fixture = new Client({ host: env.DB_HOST, port: Number(env.DB_PORT), user: env.DB_USER, password: env.DB_PASS, database: databases[3] });
        await fixture.connect();
        try { await fixture.query('DROP TABLE "SequelizeMeta"; DROP INDEX "idx_users_username";'); }
        finally { await fixture.end(); }
        const dump = path.join(output, 'synthetic-v331.dump');
        run('synthetic-v331-dump', path.join(pgBin, 'pg_dump.exe'), ['-h',env.DB_HOST,'-p',env.DB_PORT,'-U',env.DB_USER,'-Fc','-f',dump,databases[3]]);
        await create(databases[4]);
        lifecycle('v331-rehearsal', ['rehearse-v331','--dump',dump,'--confirm-database',databases[4]], { DB_NAME: databases[4] });
        lifecycle('v331-verify', ['verify'], { DB_NAME: databases[4] });
        lifecycle('v331-sanitized', ['validate-sanitized'], { DB_NAME: databases[4] });
        await create(databases[5], databases[0]);
        const regression = { DB_NAME: databases[5], QA_DB_NAME: databases[5], SOFTPHONE_SETUP_TEST_DB_NAME: databases[5], CALL_ATTEMPT_TEST_DB_NAME: databases[5], CALL_CENTER_PAGINATION_TEST_DB_NAME: databases[5], PATIENT_PAGINATION_TEST_DB_NAME: databases[5], PATIENT_PAGINATION_TEST_CONFIRM_DB_NAME: databases[5], REPORT_FILTER_TEST_DB_NAME: databases[5], DASHBOARD_ANALYTICS_TEST_DB_NAME: databases[5], DASHBOARD_ANALYTICS_TEST_CONFIRM_DB_NAME: databases[5], RX_PIPELINE_FILTER_TEST_DB_NAME: databases[5], RX_PIPELINE_FILTER_TEST_CONFIRM_DB_NAME: databases[5] };
        for (const name of ['patient-import-merge','call-center-queue-reopen','call-center-phone-client','call-center-shared-state','softphone-self-setup','call-center-call-attempts','call-center-server-pagination','patient-server-pagination','patient-status-sort','report-filter-parity','dashboard-persisted-analytics','rx-pipeline-filter-parity','patient-service-date-double-update','rx-override-permissions','workflow-date-timezone','backoffice-patient-delete','configurable-service-window']) node(name, 'scripts/test-' + name + '.js', [], regression);
        await create(databases[6], databases[0]);
        for (const name of ['rx-driver-tracking','pharmacy-transport-duplicates']) node(name, 'scripts/test-' + name + '.js', [], { DB_NAME: databases[6], QA_DB_NAME: databases[6] });
        await smokeServer('relay-runtime', databases[5], 3212, {}, true);
        const password = crypto.randomBytes(24).toString('hex');
        roleCreated = true;
        lifecycle('runtime-role-configure', ['configure-runtime-role','--role',runtimeRole,'--confirm-database',databases[0]], { RX_RUNTIME_DB_PASSWORD: password });
        for (const operation of ['inspect-runtime-role','verify-runtime-role']) lifecycle(operation, [operation,'--role',runtimeRole], { RX_RUNTIME_DB_PASSWORD: password });
        node('restricted-routine-db-health', 'scripts/test-routine-db-health.js', [], { ROUTINE_DB_HEALTH_REAL_DB: 'true', DB_USER: runtimeRole, DB_PASS: password });
        await smokeServer('restricted-runtime', databases[0], 3211, { DB_USER: runtimeRole, DB_PASS: password });
        evidence.passed = true;
    } catch (error) { evidence.error = error.message; process.exitCode = 1; console.error(error.message); }
    finally {
        for (const database of created.reverse()) {
            try { await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`); }
            catch (error) { evidence.passed = false; process.exitCode = 1; console.error('Fixture cleanup failed: ' + database); }
        }
        if (roleCreated) {
            try { await admin.query(`DROP ROLE IF EXISTS "${runtimeRole}"`); }
            catch { evidence.passed = false; process.exitCode = 1; console.error('Fixture role cleanup failed.'); }
        }
        await admin.end().catch(() => {});
        evidence.finishedAt = new Date().toISOString();
        fs.writeFileSync(path.join(output, 'validation.json'), JSON.stringify(evidence, null, 2) + '\n');
        fs.unlinkSync(lock);
        console.log(evidence.passed ? 'PASS complete local lifecycle suite; fixtures removed.' : 'FAILED local lifecycle suite; release blocked.');
    }
})();
