'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { chromium } = require('playwright-core');
const { prepareStagingEnv } = require('./lib/staging-env');

const stagingConfig = prepareStagingEnv();
const db = require('../models');
const { BUILT_IN_DEFAULTS } = require('../middleware/rbac');
const Op = db.Sequelize.Op;

const DEFAULT_BASE_URL = 'http://localhost:' + (process.env.PORT || stagingConfig.port || '3100');
const baseUrl = (process.env.STAGING_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
const runId = String(Date.now());
const password = 'SmokePass!' + runId;
const screenshotsDir = path.join(stagingConfig.writableRoot, 'smoke-screenshots');

const created = {
    users: [],
    patients: [],
    clinics: [],
    patientTransports: []
};

let browser;
let activePage;
const browserErrors = [];

function route(pathname) {
    return baseUrl + (pathname.startsWith('/') ? pathname : '/' + pathname);
}

function pass(name, detail) {
    console.log('PASS ' + name + (detail ? ': ' + detail : ''));
}

function todayIso() {
    return new Date().toISOString().slice(0, 10);
}

function dateFromToday(days) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
}

function localDateOnly(value) {
    const d = value instanceof Date ? value : new Date(value);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
}

function timeOnly(value) {
    return value.toTimeString().split(' ')[0];
}

function roleDefaults(name) {
    return BUILT_IN_DEFAULTS[name] ? BUILT_IN_DEFAULTS[name]() : {};
}

async function ensureBuiltInRole(name) {
    const [role] = await db.Role.findOrCreate({
        where: { name },
        defaults: {
            name,
            description: name + ' role',
            isSystem: true,
            permissions: roleDefaults(name)
        }
    });
    if (!role.permissions) {
        await role.update({ permissions: roleDefaults(name), isSystem: true });
    }
    return role;
}

async function createUser(role, label) {
    const user = await db.User.create({
        firstName: 'Smoke',
        lastName: label,
        username: `smoke_${label.toLowerCase()}_${runId}`,
        email: `smoke_${label.toLowerCase()}_${runId}@example.test`,
        passwordHash: await bcrypt.hash(password, 8),
        roleId: role.id,
        isActive: true,
        tokenVersion: 0,
        isMaster: false,
        twoFactorEnabled: false
    });
    created.users.push(user);
    return user;
}

async function createPatient(clinic, patientTransport, label, serviceDate) {
    const patient = await db.Patient.create({
        firstName: 'Smoke',
        lastName: `${label}${runId.slice(-5)}`,
        dob: '1980-01-01',
        address: '100 Smoke Test Way',
        phone: '555-' + runId.slice(-3).padStart(3, '0') + '-' + (label === 'Queue' ? '0001' : '0002'),
        serviceDate,
        clinicId: clinic.id,
        patientTransportCompanyId: patientTransport.id,
        notes: 'Staging UI smoke patient ' + label,
        isActive: true,
        isDeleted: false,
        patientCode: `STG-CC-${label.toUpperCase()}-${runId}`.slice(0, 60),
        isNonCompanyPatient: false
    });
    created.patients.push(patient);
    return patient;
}

async function createCallCenterAudit(user, patient, action, minutesAgo, newValue) {
    const at = new Date(Date.now() - minutesAgo * 60 * 1000);
    return db.AuditLog.create({
        userId: user.id,
        date: localDateOnly(at),
        time: timeOnly(at),
        module: 'Call Center',
        action,
        recordId: patient.id,
        previousValue: null,
        newValue: newValue || null,
        ipAddress: '127.0.0.1',
        createdAt: at,
        updatedAt: at
    });
}

async function seedFixtures() {
    await db.sequelize.authenticate();

    const adminRole = await ensureBuiltInRole('Administrator');
    const callCenterRole = await ensureBuiltInRole('Call Center');
    const adminUser = await createUser(adminRole, 'Admin');
    const callCenterUser = await createUser(callCenterRole, 'CallCenter');

    const clinic = await db.Clinic.create({
        name: 'Smoke CC Clinic ' + runId,
        address: '101 Smoke Clinic Rd',
        phone: '555-777-0000',
        contactPerson: 'Smoke QA',
        notes: 'Temporary staging UI smoke clinic',
        isActive: true
    });
    created.clinics.push(clinic);

    const patientTransport = await db.PatientTransportCompany.create({
        companyName: 'Smoke Patient Transport ' + runId,
        phone: '555-778-0000',
        contactPerson: 'Smoke Dispatcher',
        notes: 'Temporary staging UI smoke patient transport',
        isActive: true
    });
    created.patientTransports.push(patientTransport);

    const queuePatient = await createPatient(clinic, patientTransport, 'Queue', dateFromToday(-130));
    const metricPatient = await createPatient(clinic, patientTransport, 'Metric', dateFromToday(-125));
    const secondMetricPatient = await createPatient(clinic, patientTransport, 'MetricTwo', dateFromToday(-124));

    await createCallCenterAudit(callCenterUser, metricPatient, 'Called', 25);
    await createCallCenterAudit(callCenterUser, metricPatient, 'Called', 20);
    await createCallCenterAudit(callCenterUser, secondMetricPatient, 'Called', 15);
    await createCallCenterAudit(callCenterUser, metricPatient, 'Note Added', 14);
    await createCallCenterAudit(callCenterUser, metricPatient, 'Service Date Added', 10, { serviceDate: todayIso() });
    await db.PatientNote.create({
        patientId: metricPatient.id,
        userId: callCenterUser.id,
        source: 'Call Center',
        note: 'Smoke report call center note ' + runId
    });
    await db.PatientServiceDateHistory.create({
        patientId: metricPatient.id,
        previousServiceDate: metricPatient.serviceDate,
        newServiceDate: todayIso(),
        changedByUserId: callCenterUser.id,
        changeSource: 'Call Center',
        reason: 'Staging UI smoke service date history',
        metadata: { runId }
    });

    return {
        adminUser,
        callCenterUser,
        clinic,
        patientTransport,
        queuePatient,
        metricPatient,
        secondMetricPatient,
        queueSearch: queuePatient.lastName,
        metricSearch: metricPatient.patientCode
    };
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

async function captureFailureScreenshot(name) {
    if (!activePage) return '';
    fs.mkdirSync(screenshotsDir, { recursive: true });
    const fileName = new Date().toISOString().replace(/[:.]/g, '-') + '-' + name.replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '.png';
    const screenshotPath = path.join(screenshotsDir, fileName);
    await activePage.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
    return screenshotPath;
}

async function newContext() {
    const context = await browser.newContext({
        ignoreHTTPSErrors: true,
        baseURL: baseUrl,
        viewport: { width: 1440, height: 1000 },
        acceptDownloads: true
    });
    await context.addInitScript(function() {
        try {
            Object.defineProperty(window, 'showSaveFilePicker', {
                value: undefined,
                configurable: true
            });
        } catch (e) {
            window.showSaveFilePicker = undefined;
        }
    });
    const page = await context.newPage();
    activePage = page;
    page.on('pageerror', err => browserErrors.push('PAGEERROR: ' + err.message));
    page.on('response', res => {
        if (res.status() >= 500) {
            browserErrors.push('HTTP ' + res.status() + ': ' + res.url());
        }
    });
    return { context, page };
}

function assertNoBrowserErrors(label) {
    assert.strictEqual(browserErrors.length, 0, label + ' browser errors: ' + browserErrors.join(' | '));
}

async function login(page, username, expectedPath) {
    await page.goto(route('/login'), { waitUntil: 'domcontentloaded' });
    await page.fill('#username', username);
    await page.fill('#password', password);
    await Promise.all([
        page.waitForURL('**' + expectedPath, { timeout: 15000 }),
        page.click('#loginBtn')
    ]);
    await page.waitForLoadState('networkidle').catch(() => {});
    pass('login ' + username, expectedPath);
}

async function expectVisible(page, selector, name) {
    await page.locator(selector).first().waitFor({ state: 'visible', timeout: 15000 });
    pass(name);
}

async function waitForNonPlaceholder(page, selector, name) {
    const loc = page.locator(selector).first();
    await loc.waitFor({ state: 'visible', timeout: 15000 });
    await page.waitForFunction((sel) => {
        const el = document.querySelector(sel);
        if (!el) return false;
        const text = (el.textContent || '').trim();
        return text && !/^[-\u2014\s]+$/.test(text) && !/loading/i.test(text);
    }, selector, { timeout: 15000 });
    pass(name, (await loc.textContent()).trim());
}

async function expectDownload(page, selector, name) {
    const locator = page.locator(selector).first();
    await locator.waitFor({ state: 'visible', timeout: 10000 });
    const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 15000 }),
        locator.click()
    ]);
    const suggested = download.suggestedFilename();
    await download.delete().catch(() => {});
    pass(name, suggested);
}

function textOfMetric(totals, key, suffix) {
    const value = totals && totals[key] !== undefined && totals[key] !== null ? totals[key] : 0;
    return String(value) + (suffix || '');
}

async function assertDashboardCallCenterCalculations(page, expected) {
    const data = await page.evaluate(() => window._lastCallCenterReviewData || null);
    assert(data && data.totals, 'Dashboard did not expose Call Center metric data.');
    const totals = data.totals;
    Object.keys(expected).forEach(key => {
        assert.strictEqual(Number(totals[key] || 0), expected[key], 'Unexpected selected-user total for ' + key);
    });
    const checks = [
        ['#ccReviewCalls', textOfMetric(totals, 'calls')],
        ['#ccReviewUnique', textOfMetric(totals, 'uniquePatientsCalled')],
        ['#ccReviewDates', textOfMetric(totals, 'serviceDates')],
        ['#ccReviewRepeats', textOfMetric(totals, 'repeatCalls')],
        ['#ccReviewEfficiency', textOfMetric(totals, 'efficiency', '%')],
        ['#ccReviewConversion', textOfMetric(totals, 'conversionRate', '%')],
        ['#ccReviewRepeatRate', textOfMetric(totals, 'repeatRate', '%')],
        ['#ccReviewCallsPerDate', textOfMetric(totals, 'callsPerServiceDate')],
        ['#ccReviewNotesPerCall', textOfMetric(totals, 'notesPerCall')]
    ];
    await page.waitForFunction((expectedChecks) => {
        return expectedChecks.every(([selector, expectedText]) => {
            const el = document.querySelector(selector);
            return el && (el.textContent || '').trim() === expectedText;
        });
    }, checks, { timeout: 15000 });
    for (const [selector, expectedText] of checks) {
        const actual = (await page.locator(selector).innerText()).trim();
        assert.strictEqual(actual, expectedText, selector + ' card did not match calculator data.');
    }
    await waitForNonPlaceholder(page, '#ccReviewLastActivity', 'Call Center last activity card loaded');
    pass('dashboard Call Center calculator cards match API totals');
}

async function runAdminDashboardAndReports(fixtures) {
    const { context, page } = await newContext();
    await login(page, fixtures.adminUser.username, '/dashboard');

    const version = await context.request.get(route('/api/version'));
    assert.strictEqual(version.status(), 200, 'Admin should access restricted /api/version.');
    pass('admin /api/version access');

    await waitForNonPlaceholder(page, '#activePatientsCount', 'dashboard active patients card');
    await waitForNonPlaceholder(page, '#patientsWithNoRxCount', 'dashboard no-RX card');
    await waitForNonPlaceholder(page, '#pendingDeliveriesCount', 'dashboard pending deliveries card');
    await expectVisible(page, '#rxPipelineRow', 'RX Workflow Pipeline visible');
    await waitForNonPlaceholder(page, '#rxPipelinePercent', 'RX Workflow Pipeline calculator loaded');

    await expectVisible(page, '#callCenterReviewCard', 'Call Center Metrics card visible under RX pipeline');
    await page.locator('[data-cc-history-range="all"]').click();
    await page.waitForFunction(() => window._lastCallCenterReviewData && window._lastCallCenterReviewData.totals, null, { timeout: 15000 });
    await page.selectOption('#ccHistoryChartType', 'bar');
    await page.selectOption('#ccHistoryUser', String(fixtures.callCenterUser.id));
    const selectedUserMetrics = page.waitForResponse(response =>
        response.url().includes('/api/call-center/metrics/review') &&
        response.url().includes('historyUserId=' + fixtures.callCenterUser.id) &&
        response.status() === 200,
        { timeout: 15000 }
    );
    await page.click('#ccHistoryApplyBtn');
    await selectedUserMetrics;
    await page.waitForFunction((userId) => {
        const data = window._lastCallCenterReviewData;
        const scope = document.querySelector('#ccReviewScope');
        return data && data.totals && Number(data.totals.calls || 0) === 3 && scope && scope.textContent.indexOf('Smoke CallCenter') !== -1;
    }, fixtures.callCenterUser.id, { timeout: 15000 });
    await assertDashboardCallCenterCalculations(page, {
        calls: 3,
        uniquePatientsCalled: 2,
        serviceDates: 1,
        repeatCalls: 1,
        notes: 1,
        efficiency: 33,
        conversionRate: 50,
        repeatRate: 33,
        callsPerServiceDate: 3,
        notesPerCall: 0.3
    });

    await expectDownload(page, '#ccHistoryExportBtn', 'Call Center metrics CSV export');
    await page.locator('[data-cc-drilldown="calls"]').first().click();
    await expectVisible(page, '#drilldownModal.show', 'Call Center metric drilldown modal');
    await page.locator('#drilldownBody').waitFor({ state: 'visible', timeout: 10000 });
    const drillText = await page.locator('#drilldownBody').innerText();
    assert(drillText.includes(fixtures.metricPatient.patientCode), 'Drilldown did not include seeded metric patient.');
    await page.locator('[data-cc-drill-sort="name"]').first().click();
    pass('Call Center drilldown sorting click');
    await expectDownload(page, '#ccDrilldownExportBtn', 'Call Center drilldown CSV export');
    await page.keyboard.press('Escape').catch(() => {});

    await page.goto(route('/reports'), { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.locator('a[href="#callCenterReport"]').click();
    await expectVisible(page, '#callCenterReport.active, #callCenterReport.show', 'Call Center Report tab visible');
    await page.fill('#ccrPatientCode', fixtures.metricPatient.patientCode);
    await page.locator('#callCenterReport button[title="Search"]').first().click();
    await page.locator('#ccReportBody').waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForFunction((code) => {
        const body = document.querySelector('#ccReportBody');
        return body && body.textContent.indexOf(code) !== -1;
    }, fixtures.metricPatient.patientCode, { timeout: 15000 });
    assert.strictEqual((await page.locator('#ccrMCalls').innerText()).trim(), '2', 'Call Center report filtered call total mismatch.');
    assert.strictEqual((await page.locator('#ccrMRepeats').innerText()).trim(), '1', 'Call Center report filtered repeat total mismatch.');
    assert.strictEqual((await page.locator('#ccrMDates').innerText()).trim(), '1', 'Call Center report filtered date total mismatch.');
    assert.strictEqual((await page.locator('#ccrMNotes').innerText()).trim(), '1', 'Call Center report filtered note total mismatch.');
    const reportText = await page.locator('#ccReportBody').innerText();
    assert(reportText.includes('Smoke report call center note'), 'Call Center report did not show note history.');
    pass('Call Center Report filters and calculators');
    await page.locator('#ccReportTable th:has-text("Calls")').click();
    pass('Call Center Report sorting click');
    await expectDownload(page, '#exportCcCsv', 'Call Center Report CSV export');
    await expectDownload(page, '#exportCcXls', 'Call Center Report Excel export');

    assertNoBrowserErrors('admin dashboard/report flow');
    await context.close();
}

async function runCallCenterWorkspace(fixtures) {
    const { context, page } = await newContext();
    await login(page, fixtures.callCenterUser.username, '/call-center');

    const workspaceResponse = await context.request.get(route('/call-center'));
    assert.strictEqual(workspaceResponse.status(), 200, 'Authenticated Call Center page should load.');
    assert(
        String(workspaceResponse.headers()['content-security-policy'] || '').includes('http://127.0.0.1:5188'),
        'Call Center CSP should allow only its local RX Softphone connection.'
    );
    pass('Call Center page-scoped RX Softphone CSP');

    let res = await context.request.get(route('/api/dashboard/stats'));
    assert.strictEqual(res.status(), 403, 'Call Center should get 403 on dashboard API.');
    res = await context.request.get(route('/api/version'));
    assert.strictEqual(res.status(), 403, 'Call Center should get 403 on version API.');
    pass('Call Center API blocks dashboard and version');

    await page.goto(route('/dashboard'), { waitUntil: 'domcontentloaded' });
    await page.waitForURL('**/call-center', { timeout: 15000 });
    pass('Call Center URL injection redirected to workspace');

    await expectVisible(page, '#ccCardQueue', 'Call Center queue card visible');
    await waitForNonPlaceholder(page, '#ccMetricEligible', 'Call Center eligible metric loaded');
    const pageSizeOptions = await page.locator('#ccPageSize option').evaluateAll(options => options.map(option => option.value));
    assert.deepStrictEqual(pageSizeOptions, ['5', '10'], 'Call Center page size options should be only 5 and 10.');
    pass('Call Center pagination options limited to 5 and 10');

    await page.fill('#ccSearch', fixtures.queueSearch);
    await page.click('#ccSearchBtn');
    const rowSelector = '#ccPatientRows tr:has-text("' + fixtures.queueSearch + '")';
    await page.locator(rowSelector).first().waitFor({ state: 'visible', timeout: 15000 });
    await page.locator('.cc-sort[data-sort="clinicName"]').click();
    pass('Call Center clinic sorting click');
    await page.locator('.cc-sort[data-sort="patientTransportName"]').click();
    pass('Call Center patient transport sorting click');

    let row = page.locator(rowSelector).first();
    assert.strictEqual(
        (await row.locator('.cc-clinic-name').innerText()).trim(),
        fixtures.clinic.name,
        'Call Center roster should show the patient clinic/location.'
    );
    const clinicSearchRes = await context.request.get(route('/api/call-center/patients?q=' + encodeURIComponent(fixtures.clinic.name) + '&sort=clinicName'));
    assert.strictEqual(clinicSearchRes.status(), 200, 'Call Center clinic search API should be available.');
    const clinicSearchData = await clinicSearchRes.json();
    const clinicSearchRow = (clinicSearchData.rows || []).find(item => item.id === fixtures.queuePatient.id);
    assert(clinicSearchRow, 'Call Center clinic search should find the assigned patient.');
    assert.strictEqual(clinicSearchRow.clinicName, fixtures.clinic.name, 'Call Center API should expose the assigned clinic name.');
    pass('Call Center clinic displayed and searchable', fixtures.clinic.name);
    assert.strictEqual(
        (await row.locator('.cc-patient-transport-name').innerText()).trim(),
        fixtures.patientTransport.companyName,
        'Call Center roster should show the patient transport company.'
    );
    const patientTransportSearchRes = await context.request.get(route('/api/call-center/patients?q=' + encodeURIComponent(fixtures.patientTransport.companyName) + '&sort=patientTransportName'));
    assert.strictEqual(patientTransportSearchRes.status(), 200, 'Call Center patient transport search API should be available.');
    const patientTransportSearchData = await patientTransportSearchRes.json();
    const patientTransportSearchRow = (patientTransportSearchData.rows || []).find(item => item.id === fixtures.queuePatient.id);
    assert(patientTransportSearchRow, 'Call Center patient transport search should find the assigned patient.');
    assert.strictEqual(patientTransportSearchRow.patientTransportName, fixtures.patientTransport.companyName, 'Call Center API should expose the assigned patient transport company.');
    pass('Call Center patient transport displayed and searchable', fixtures.patientTransport.companyName);

    const selectedPhoneClient = patientTransportSearchData.phoneClient;
    assert(
        ['microsip', 'rx_softphone', 'auto'].includes(selectedPhoneClient),
        'Call Center API should expose a supported Backoffice phone-client selection.'
    );
    const callLink = row.locator('.cc-call-link[data-action="phone-call"]');
    await callLink.waitFor({ state: 'visible', timeout: 15000 });
    const expectedDialNumber = String(fixtures.queuePatient.phone || '').replace(/\D/g, '');
    assert.strictEqual(
        await callLink.getAttribute('href'),
        'callto:' + expectedDialNumber,
        'Call Center phone icon should keep a normalized MicroSIP-compatible CALLTO fallback.'
    );
    assert.strictEqual(await callLink.getAttribute('data-dial-number'), expectedDialNumber, 'Call Center link should retain the number shown in the launch message.');
    assert.strictEqual(await row.locator('.cc-called').isChecked(), false, 'Rendering click-to-call must not pre-record a call.');
    await page.locator('#ccPhoneClientStatus').waitFor({ state: 'visible', timeout: 15000 });
    assert((await page.locator('#ccSoftphoneHelp').innerText()).trim(), 'Call Center should display guidance for the selected phone client.');
    pass('Call Center selectable phone integration configured', selectedPhoneClient + ' / callto:' + expectedDialNumber);

    await row.locator('.cc-row-note').fill('First smoke call note ' + runId);
    await row.locator('.cc-called').check();
    await Promise.all([
        page.waitForResponse(response => response.url().includes('/api/call-center/patients/') && response.url().includes('/actions') && response.status() === 200),
        row.locator('[data-action="save"]').click()
    ]);
    await page.waitForFunction(() => Number((document.querySelector('#ccMetricCalls') || {}).textContent || 0) >= 1, null, { timeout: 15000 });
    pass('Call Center first call saved');

    await page.locator('#ccCardCalls').click();
    await page.locator(rowSelector).first().waitFor({ state: 'visible', timeout: 15000 });
    row = page.locator(rowSelector).first();
    await row.locator('.cc-row-note').fill('Second smoke call note ' + runId);
    await row.locator('.cc-called').check();
    await Promise.all([
        page.waitForResponse(response => response.url().includes('/api/call-center/patients/') && response.url().includes('/actions') && response.status() === 200),
        row.locator('[data-action="save"]').click()
    ]);
    await page.locator('#ccCardCalls').click();
    await page.locator(rowSelector).first().waitFor({ state: 'visible', timeout: 15000 });
    row = page.locator(rowSelector).first();
    const calledListRes = await context.request.get(route('/api/call-center/patients?view=called-today&q=' + encodeURIComponent(fixtures.queueSearch)));
    assert.strictEqual(calledListRes.status(), 200, 'Call Center called-today API should be available.');
    const calledList = await calledListRes.json();
    const calledRow = (calledList.rows || []).find(item => item.id === fixtures.queuePatient.id);
    assert(calledRow, 'Called patient should be present in called-today API results.');
    assert(calledRow.callCount >= 2, 'Call history should show at least two calls after repeat call.');
    assert((calledRow.recentCalls || []).length >= 2, 'Recent call history should include multiple call timestamps.');
    pass('Call Center repeat call history registered', String(calledRow.callCount));

    await row.locator('.cc-new-date').fill(todayIso());
    await Promise.all([
        page.waitForResponse(response => response.url().includes('/api/call-center/patients/') && response.url().includes('/actions') && response.status() === 200),
        row.locator('[data-action="save"]').click()
    ]);
    await page.waitForFunction(() => Number((document.querySelector('#ccMetricDates') || {}).textContent || 0) >= 1, null, { timeout: 15000 });
    await page.locator('#ccCardServiceDates').click();
    await page.locator(rowSelector).first().waitFor({ state: 'visible', timeout: 15000 });
    const serviceDateText = await page.locator(rowSelector).first().innerText();
    assert(/Service date entered|Done/i.test(serviceDateText), 'Service date card did not show completed patient.');
    pass('Call Center service date assignment moved patient to dates card');

    assertNoBrowserErrors('Call Center workspace flow');
    await context.close();
}

async function cleanup() {
    const patientIds = created.patients.map(row => row.id);
    const userIds = created.users.map(row => row.id);
    const clinicIds = created.clinics.map(row => row.id);
    const patientTransportIds = created.patientTransports.map(row => row.id);
    await new Promise(resolve => setTimeout(resolve, 500));

    if (patientIds.length) {
        if (db.CallCenterLock) await db.CallCenterLock.destroy({ where: { patientId: { [Op.in]: patientIds } } }).catch(() => {});
        if (db.PatientLock) await db.PatientLock.destroy({ where: { patientId: { [Op.in]: patientIds } } }).catch(() => {});
        await db.PatientNote.destroy({ where: { patientId: { [Op.in]: patientIds } } }).catch(() => {});
        if (db.PatientServiceDateHistory) await db.PatientServiceDateHistory.destroy({ where: { patientId: { [Op.in]: patientIds } } }).catch(() => {});
        if (db.PatientServiceDateCycle) await db.PatientServiceDateCycle.destroy({ where: { patientId: { [Op.in]: patientIds } } }).catch(() => {});
        await db.AuditLog.destroy({ where: { recordId: { [Op.in]: patientIds }, module: 'Call Center' } }).catch(() => {});
        await db.Patient.destroy({ where: { id: { [Op.in]: patientIds } } }).catch(() => {});
    }
    if (userIds.length) {
        await db.AuditLog.destroy({ where: { userId: { [Op.in]: userIds } } }).catch(() => {});
        if (db.UserActivityLog) await db.UserActivityLog.destroy({ where: { userId: { [Op.in]: userIds } } }).catch(() => {});
        await db.User.destroy({ where: { id: { [Op.in]: userIds } } }).catch(() => {});
    }
    if (clinicIds.length) {
        await db.Clinic.destroy({ where: { id: { [Op.in]: clinicIds } } }).catch(() => {});
    }
    if (patientTransportIds.length) {
        await db.PatientTransportCompany.destroy({ where: { id: { [Op.in]: patientTransportIds } } }).catch(() => {});
    }
}

async function main() {
    console.log('Staging full UI click smoke test');
    console.log('URL: ' + baseUrl);
    console.log('DB : ' + stagingConfig.dbHost + ':' + stagingConfig.dbPort + '/' + stagingConfig.dbName);

    const loginProbe = await fetch(route('/login')).catch(err => {
        throw new Error('Cannot reach staging at ' + baseUrl + '. Start it with "npm run staging:start" first. ' + err.message);
    });
    if (!loginProbe || loginProbe.status >= 500) throw new Error('/login returned HTTP ' + (loginProbe && loginProbe.status));

    const chrome = findChromeExecutable();
    if (!chrome) {
        throw new Error('Chrome was not found. Install Google Chrome or set STAGING_CHROME_PATH/QA_CHROME_PATH.');
    }

    const fixtures = await seedFixtures();
    browser = await chromium.launch({
        headless: String(process.env.STAGING_HEADLESS || 'true').toLowerCase() !== 'false',
        slowMo: Number(process.env.STAGING_SLOW_MO || 0),
        executablePath: chrome
    });

    await runAdminDashboardAndReports(fixtures);
    await runCallCenterWorkspace(fixtures);
    console.log('All staging UI click smoke checks passed.');
}

main()
    .catch(async (err) => {
        const screenshot = await captureFailureScreenshot('staging-ui-click-failure');
        console.error('[staging:ui-click-smoke] ' + (err.stack || err.message));
        if (screenshot) console.error('Screenshot: ' + screenshot);
        process.exitCode = 1;
    })
    .finally(async () => {
        if (browser) await browser.close().catch(() => {});
        await cleanup();
        await db.sequelize.close().catch(() => {});
    });
