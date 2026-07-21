'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { Client } = require('pg');
const { chromium } = require('playwright-core');
const { prepareStagingEnv } = require('./lib/staging-env');

const stagingConfig = prepareStagingEnv();
const db = require('../models');
const backupService = require('../services/backupService');
const { BUILT_IN_DEFAULTS } = require('../middleware/rbac');

const DEFAULT_BASE_URL = 'http://localhost:' + (process.env.PORT || stagingConfig.port || '3100');
const baseUrl = (process.env.STAGING_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
const dumpFile = path.resolve(process.env.STAGING_RESTORE_DUMP || '');
const requiredConfirmation = String(process.env.STAGING_RESTORE_CONFIRM || '');
const stagingToken = String(process.env.STAGING_DESTRUCTIVE_CONFIRM_TOKEN || '');
const runId = String(Date.now());
const username = 'staging_restore_smoke_' + runId;
const password = 'RestoreSmoke!' + runId;

let browser;
let activePage;
let ownsBrowser = false;
let smokeUserId = null;
let restoreSucceeded = false;

function route(pathname) {
    return baseUrl + (pathname.startsWith('/') ? pathname : '/' + pathname);
}

function findChromeExecutable() {
    const candidates = [
        process.env.STAGING_CHROME_PATH,
        process.env.QA_CHROME_PATH,
        'C:/Program Files/Google/Chrome/Application/chrome.exe',
        'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
        process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe') : ''
    ].filter(Boolean);
    return candidates.find(candidate => fs.existsSync(candidate));
}

function backupFiles() {
    const dir = backupService.getDbBackupDir();
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter(name => name.endsWith('.dump')).sort();
}

async function createSmokeAdministrator() {
    let role = await db.Role.findOne({ where: { name: 'Administrator' } });
    if (!role) {
        role = await db.Role.create({
            name: 'Administrator',
            description: 'Administrator role',
            isSystem: true,
            permissions: BUILT_IN_DEFAULTS.Administrator()
        });
    }

    const user = await db.User.create({
        firstName: 'Staging',
        lastName: 'Restore Smoke',
        username,
        email: username + '@example.test',
        passwordHash: await bcrypt.hash(password, 8),
        roleId: role.id,
        isActive: true,
        tokenVersion: 0,
        isMaster: false,
        twoFactorEnabled: false
    });
    smokeUserId = user.id;
}

async function cleanupSmokeAdministrator() {
    if (!smokeUserId || restoreSucceeded) return;
    await db.AuditLog.destroy({ where: { userId: smokeUserId } }).catch(() => {});
    if (db.UserActivityLog) {
        await db.UserActivityLog.destroy({ where: { userId: smokeUserId } }).catch(() => {});
    }
    await db.User.destroy({ where: { id: smokeUserId } }).catch(() => {});
}

async function verifyRestoredDatabase() {
    const client = new Client({
        host: process.env.DB_HOST || '127.0.0.1',
        port: Number(process.env.DB_PORT || 5432),
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASS || '',
        database: process.env.DB_NAME
    });
    await client.connect();
    try {
        const tables = await client.query(
            "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('Patients', 'Users', 'Roles')"
        );
        const names = new Set(tables.rows.map(row => row.table_name));
        ['Patients', 'Users', 'Roles'].forEach(name => {
            assert(names.has(name), 'Restored dump is missing required table ' + name + '.');
        });

        const counts = await client.query(
            'SELECT (SELECT COUNT(*)::int FROM "Patients") AS patients, '
            + '(SELECT COUNT(*)::int FROM "Users") AS users, '
            + '(SELECT COUNT(*)::int FROM "Roles") AS roles'
        );
        return counts.rows[0];
    } finally {
        await client.end().catch(() => {});
    }
}

function assertSafeInputs() {
    assert(
        /(staging|stage|qa|test|sandbox|copy)/i.test(stagingConfig.dbName),
        'Refusing restore smoke because the target DB is not named as a non-production database.'
    );
    assert.strictEqual(
        requiredConfirmation,
        stagingConfig.dbName,
        'Set STAGING_RESTORE_CONFIRM to the exact staging DB name (' + stagingConfig.dbName + ').'
    );
    assert(stagingToken, 'STAGING_DESTRUCTIVE_CONFIRM_TOKEN is required.');
    assert(dumpFile && fs.existsSync(dumpFile), 'STAGING_RESTORE_DUMP does not exist: ' + dumpFile);
    assert.strictEqual(path.extname(dumpFile).toLowerCase(), '.dump', 'STAGING_RESTORE_DUMP must be a .dump file.');
}

async function main() {
    assertSafeInputs();
    const chrome = findChromeExecutable();
    assert(chrome, 'Chrome was not found. Set STAGING_CHROME_PATH or QA_CHROME_PATH.');

    console.log('Staging backup restore UI smoke test');
    console.log('URL : ' + baseUrl);
    console.log('DB  : ' + stagingConfig.dbHost + ':' + stagingConfig.dbPort + '/' + stagingConfig.dbName);
    console.log('Dump: ' + path.basename(dumpFile));

    await db.sequelize.authenticate();
    await createSmokeAdministrator();

    const backupsBefore = new Set(backupFiles());
    const restoreStatuses = [];
    const browserErrors = [];
    const dialogs = [];

    let context;
    if (process.env.STAGING_CDP_URL) {
        browser = await chromium.connectOverCDP(process.env.STAGING_CDP_URL);
        context = browser.contexts()[0];
        assert(context, 'The connected Chrome session has no browser context.');
    } else {
        browser = await chromium.launch({
            headless: String(process.env.STAGING_HEADLESS || 'true').toLowerCase() !== 'false',
            executablePath: chrome
        });
        ownsBrowser = true;
        context = await browser.newContext({
            ignoreHTTPSErrors: true,
            baseURL: baseUrl,
            viewport: { width: 1440, height: 1000 }
        });
    }
    const page = await context.newPage();
    activePage = page;

    page.on('pageerror', err => browserErrors.push(err.message));
    page.on('response', response => {
        if (response.url().includes('/api/backups/restore')) {
            restoreStatuses.push(response.status());
        }
    });
    page.on('dialog', async dialog => {
        dialogs.push(dialog.type());
        if (dialog.type() === 'prompt') {
            await dialog.accept(stagingToken);
        } else {
            await dialog.accept();
        }
    });

    await page.goto(route('/login'), { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.fill('#username', username);
    await page.fill('#password', password);
    await Promise.all([
        page.waitForURL(url => /\/dashboard(?:[/?#]|$)/.test(url.href), { timeout: 30000 }),
        page.click('#loginBtn')
    ]);

    await page.goto(route('/backups'), { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.locator('#restoreDumpFile').setInputFiles(dumpFile);
    await page.fill('#restoreConfirmInput', 'RESTORE');
    await page.locator('#restoreStartBtn').waitFor({ state: 'visible' });
    assert.strictEqual(await page.locator('#restoreStartBtn').isEnabled(), true, 'Restore button did not enable.');
    assert.strictEqual(
        await page.evaluate(() => Boolean(window.rxStagingGuard && window.rxStagingGuard.read)),
        true,
        'The backup page did not load the shared staging guard API.'
    );

    const finalResponsePromise = page.waitForResponse(
        response => response.url().includes('/api/backups/restore') && response.status() === 200,
        { timeout: 180000 }
    );
    await page.click('#restoreStartBtn');
    const finalResponse = await finalResponsePromise;
    const result = await finalResponse.json();
    assert.strictEqual(result.status, 'success', 'Restore API failed: ' + (result.error || JSON.stringify(result)));
    restoreSucceeded = true;

    await page.locator('#restoreResultBadge .bg-success').waitFor({ state: 'visible', timeout: 30000 });
    assert(restoreStatuses.includes(428), 'The UI did not exercise the staging confirmation rejection.');
    assert(restoreStatuses.includes(200), 'The UI did not complete the confirmed restore request.');
    assert(dialogs.includes('confirm'), 'The destructive restore confirmation dialog was not shown.');
    assert(dialogs.includes('prompt'), 'The staging token prompt was not shown.');
    assert.strictEqual(browserErrors.length, 0, 'Browser errors: ' + browserErrors.join(' | '));

    const newSafetyBackups = backupFiles().filter(name => !backupsBefore.has(name));
    assert(newSafetyBackups.length > 0, 'Restore succeeded without creating a new safety backup file.');

    const restoredCounts = await verifyRestoredDatabase();
    console.log('PASS staging guard returned 428, prompted, and retried successfully');
    console.log('PASS restore API and success UI completed');
    console.log('PASS safety backup created: ' + newSafetyBackups.join(', '));
    console.log(
        'PASS restored database verified: patients=' + restoredCounts.patients
        + ', users=' + restoredCounts.users
        + ', roles=' + restoredCounts.roles
    );
}

main()
    .catch(err => {
        console.error('FAIL staging backup restore UI smoke test');
        console.error(err.stack || err.message);
        process.exitCode = 1;
    })
    .finally(async () => {
        if (activePage) await activePage.close().catch(() => {});
        if (browser && ownsBrowser) await browser.close().catch(() => {});
        await cleanupSmokeAdministrator().catch(() => {});
        await db.sequelize.close().catch(() => {});
    });
