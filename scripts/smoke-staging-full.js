'use strict';

const path = require('path');
const { spawn } = require('child_process');
const { prepareStagingEnv } = require('./lib/staging-env');

const root = path.join(__dirname, '..');
const staging = prepareStagingEnv();
process.env.PATIENT_PAGINATION_TEST_DB_NAME = staging.dbName;
process.env.DASHBOARD_ANALYTICS_TEST_DB_NAME = staging.dbName;
process.env.CALL_CENTER_PAGINATION_TEST_DB_NAME = staging.dbName;

const tasks = [
    ['public JavaScript encoding and syntax check', 'check-public-js.js'],
    ['portable new-server installer regression', 'test-new-server-installer.js'],
    ['staging config check', 'check-staging-config.js'],
    ['patient import guard smoke', 'smoke-staging-import-guard.js'],
    ['security alerts smoke', 'smoke-staging-security-alerts.js'],
    ['security hardening smoke', 'smoke-staging-security-hardening.js'],
    ['Call Center API restriction smoke', 'smoke-staging-call-center-security.js'],
    ['Call Center database-side pagination regression', 'test-call-center-server-pagination.js'],
    ['patient database-side pagination regression', 'test-patient-server-pagination.js'],
    ['persisted dashboard analytics regression', 'test-dashboard-persisted-analytics.js'],
    ['RX warehouse filter and Call Center cleanup regression', 'test-rx-warehouse-filter-cleanup.js'],
    ['managed RX Softphone relay regression', 'test-softphone-relay.js'],
    ['staging browser click smoke', 'run-isolated-staging-ui-smoke.js']
];

function runTask(label, script) {
    return new Promise((resolve, reject) => {
        console.log('');
        console.log('=== ' + label + ' ===');
        const child = spawn(process.execPath, [path.join(__dirname, script)], {
            cwd: root,
            env: process.env,
            stdio: 'inherit',
            windowsHide: true
        });
        child.on('error', reject);
        child.on('close', code => {
            if (code === 0) return resolve();
            reject(new Error(label + ' failed with exit code ' + code));
        });
    });
}

async function main() {
    console.log('Patient RX staging full smoke test');
    console.log('This expects staging to be running. Start it with "npm run staging:start".');
    for (const [label, script] of tasks) {
        await runTask(label, script);
    }
    console.log('');
    console.log('All staging full smoke tasks passed.');
}

main().catch(err => {
    console.error('[staging:full-smoke] ' + err.message);
    process.exit(1);
});
