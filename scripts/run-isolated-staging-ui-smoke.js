'use strict';

const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const { Client } = require('pg');
const { prepareStagingEnv } = require('./lib/staging-env');

const root = path.resolve(__dirname, '..');
const serverOutputLimit = 24000;
let serverOutput = '';

function safeDatabaseName(name) {
    if (!/^[A-Za-z0-9_]+$/.test(name)) {
        throw new Error('Unsafe isolated smoke database name: ' + name);
    }
    if (!/(ui_smoke|smoke_ui|test)/i.test(name)) {
        throw new Error('Isolated smoke database name must contain ui_smoke, smoke_ui, or test.');
    }
    return name;
}

function quoteIdentifier(name) {
    return '"' + safeDatabaseName(name).replace(/"/g, '""') + '"';
}

function appendServerOutput(chunk) {
    serverOutput += String(chunk || '');
    if (serverOutput.length > serverOutputLimit) {
        serverOutput = serverOutput.slice(-serverOutputLimit);
    }
}

async function ensureIsolatedDatabase(config, databaseName) {
    const client = new Client({
        host: config.dbHost,
        port: Number(config.dbPort || 5432),
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASS || '',
        database: process.env.STAGING_UI_SMOKE_ADMIN_DB || 'postgres'
    });
    await client.connect();
    try {
        const existing = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [databaseName]);
        if (!existing.rowCount) {
            await client.query('CREATE DATABASE ' + quoteIdentifier(databaseName) + ' TEMPLATE template0');
            console.log('Created isolated browser-smoke database: ' + databaseName);
        }
    } finally {
        await client.end();
    }
}

function reservePort() {
    return new Promise((resolve, reject) => {
        const probe = net.createServer();
        probe.unref();
        probe.once('error', reject);
        probe.listen(0, '127.0.0.1', () => {
            const address = probe.address();
            probe.close(err => err ? reject(err) : resolve(address.port));
        });
    });
}

async function waitForHealth(baseUrl, child) {
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
        if (child.exitCode !== null) {
            throw new Error('Isolated staging server exited before becoming ready.\n' + serverOutput);
        }
        try {
            const response = await fetch(baseUrl + '/api/healthz', { signal: AbortSignal.timeout(2000) });
            if (response.ok) {
                const body = await response.json().catch(() => ({}));
                if (body.database === 'ok') return;
            }
        } catch (_) {}
        await new Promise(resolve => setTimeout(resolve, 350));
    }
    throw new Error('Timed out waiting for isolated staging server.\n' + serverOutput);
}

function runSmoke(env) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [path.join(__dirname, 'smoke-staging-ui-clicks.js')], {
            cwd: root,
            env,
            stdio: 'inherit',
            windowsHide: true
        });
        child.once('error', reject);
        child.once('exit', code => {
            if (code === 0) resolve();
            else reject(new Error('Isolated staging browser smoke failed with exit code ' + code));
        });
    });
}

async function stopServer(child) {
    if (!child || child.exitCode !== null) return;
    child.kill('SIGTERM');
    await Promise.race([
        new Promise(resolve => child.once('exit', resolve)),
        new Promise(resolve => setTimeout(resolve, 5000))
    ]);
    if (child.exitCode === null) child.kill('SIGKILL');
}

async function main() {
    const staging = prepareStagingEnv();
    const databaseName = safeDatabaseName(
        process.env.STAGING_UI_SMOKE_DB_NAME || (staging.dbName.replace(/[^A-Za-z0-9_]/g, '_') + '_ui_smoke')
    );
    const port = await reservePort();
    const baseUrl = 'http://127.0.0.1:' + port;
    const writableRoot = path.join(root, 'staging', 'runtime', 'ui-smoke-isolated');
    fs.mkdirSync(writableRoot, { recursive: true });

    await ensureIsolatedDatabase(staging, databaseName);

    const isolatedEnv = {
        ...process.env,
        NODE_ENV: 'production',
        PORT: String(port),
        DB_NAME: databaseName,
        DB_HOST: staging.dbHost,
        DB_PORT: String(staging.dbPort || '5432'),
        APP_ORIGIN: baseUrl + ',http://localhost:' + port,
        APP_WRITABLE_ROOT: writableRoot,
        DOCUMENT_STORAGE_LOCAL_DIR: path.join(writableRoot, 'uploads', 'documents'),
        SITE_BACKUP_DIR: path.join(writableRoot, 'site-backups'),
        BACKUP_SCHEDULE: 'off',
        SITE_BACKUP_SCHEDULE: 'off',
        LOG_FILE: 'false',
        ALLOW_DEFAULT_SEED: 'false',
        STAGING_ALLOW_DB_BOOTSTRAP: 'true',
        STAGING_AUTO_MIGRATE: 'true',
        RX_ENV_PROFILE: 'qa',
        RX_EXPECTED_PORT: String(port),
        RX_EXPECTED_DB_NAME: databaseName,
        RX_EXPECTED_WRITABLE_ROOT: writableRoot,
        STAGING_UI_SMOKE_ISOLATED: 'true',
        STAGING_BASE_URL: baseUrl,
        SOFTPHONE_ACCOUNT_ADMIN_PIN: 'isolated-smoke-admin-pin'
    };

    console.log('Starting isolated staging browser smoke.');
    console.log('Application: ' + baseUrl);
    console.log('Database   : ' + databaseName + ' (separate from shared staging)');

    const server = spawn(process.execPath, [path.join(root, 'app.js')], {
        cwd: root,
        env: isolatedEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
    });
    server.stdout.on('data', appendServerOutput);
    server.stderr.on('data', appendServerOutput);

    try {
        await waitForHealth(baseUrl, server);
        await runSmoke(isolatedEnv);
        console.log('Isolated staging browser smoke completed; shared staging data was untouched.');
    } catch (err) {
        if (serverOutput) console.error('\nIsolated server output:\n' + serverOutput);
        throw err;
    } finally {
        await stopServer(server);
    }
}

main().catch(err => {
    console.error('[staging:ui-click-smoke] ' + err.message);
    process.exit(1);
});
