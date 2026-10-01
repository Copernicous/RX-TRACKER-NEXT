'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert/strict');
const { spawn, spawnSync } = require('child_process');
const { Client } = require('pg');
const [directory, credentialsFile] = process.argv.slice(2);
if (!directory || !credentialsFile) throw Error('Provide extracted package and local maintenance env file.');
const config = require('dotenv').parse(fs.readFileSync(credentialsFile));
assert.equal(config.DB_HOST, '127.0.0.1');
assert.ok(config.DB_USER && config.DB_PASS);
const name = 'rx_next_ci_packaged_' + crypto.randomBytes(6).toString('hex');
const admin = new Client({ host: config.DB_HOST, port: config.DB_PORT || 5432, user: config.DB_USER, password: config.DB_PASS, database: 'postgres' });
const packageDir = path.resolve(directory);
assert.equal(fs.existsSync(path.join(packageDir, '.env')), false);
const version = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'))).version;
const env = { ...process.env, NODE_ENV: 'development', DB_HOST: '127.0.0.1', DB_PORT: config.DB_PORT || '5432', DB_USER: config.DB_USER, DB_PASS: config.DB_PASS, DB_NAME: name,
    PORT: '3213', APP_ORIGIN: 'http://127.0.0.1:3213', APP_ORIGINS: 'http://127.0.0.1:3213',
    JWT_SECRET: crypto.randomBytes(32).toString('hex'), SETTINGS_ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex'),
    APP_WRITABLE_ROOT: path.join(packageDir, 'runtime'), BACKUP_SCHEDULER_ENABLED: 'false', SITE_BACKUP_SCHEDULER_ENABLED: 'false', SECURITY_ALERT_BACKUP_MONITOR: 'false' };
let created = false, child, log;
(async () => {
    try {
        await admin.connect();
        await admin.query(`CREATE DATABASE "${name}"`); created = true;
        const provision = spawnSync(path.join(packageDir, 'rx-db.exe'), ['provision'], { cwd: packageDir, env, encoding: 'utf8', timeout: 180000, windowsHide: true });
        assert.equal(provision.status, 0, 'Compiled database provisioning: ' + (provision.stderr || ''));
        log = fs.openSync(path.join(packageDir, 'compiled-smoke.log'), 'w');
        child = spawn(path.join(packageDir, 'server.exe'), [], { cwd: packageDir, env, stdio: ['ignore', log, log], windowsHide: true });
        let health;
        for (let n = 0; n < 30; n++) {
            assert.equal(child.exitCode, null, 'Compiled server exited');
            try {
                const response = await fetch('http://127.0.0.1:3213/api/healthz');
                health = await response.json();
                if (response.ok && health.pid === child.pid && health.status === 'ok') break;
            } catch {}
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        assert.equal(health?.pid, child.pid); assert.equal(health?.status, 'ok'); assert.equal(health?.version, version);
        const script = await fetch('http://127.0.0.1:3213/js/rx-stage-report.js');
        assert.equal(script.status, 200);
        const text = await script.text();
        assert.ok(text.includes('stageReportBaseline') && text.includes('stageReportTopScroll'));
        assert.equal((await fetch('http://127.0.0.1:3213/login')).status, 200);
        console.log('PASS extracted compiled rx-db provision, server/database health, exact version, report assets and login.');
    } finally {
        if (child && child.exitCode === null) { child.kill(); await new Promise(resolve => child.once('exit', resolve)); }
        if (log !== undefined) fs.closeSync(log);
        if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
        await admin.end();
    }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
