'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { chromium } = require('playwright-core');
const { prepareStagingEnv } = require('./lib/staging-env');

const isolatedSmoke = process.env.STAGING_UI_SMOKE_ISOLATED === 'true';
if (!isolatedSmoke && process.env.STAGING_UI_SMOKE_ALLOW_SHARED_DB !== 'true') {
    throw new Error(
        'Refusing to create browser-smoke fixtures in the shared staging database. ' +
        'Run "npm run staging:ui-click-smoke" for an isolated server/database.'
    );
}
const stagingConfig = isolatedSmoke
    ? {
        dbName: process.env.DB_NAME || '',
        dbHost: process.env.DB_HOST || '127.0.0.1',
        dbPort: process.env.DB_PORT || '5432',
        port: process.env.PORT || '',
        writableRoot: process.env.APP_WRITABLE_ROOT || ''
    }
    : prepareStagingEnv();
if (isolatedSmoke && !/(ui_smoke|smoke_ui|test)/i.test(stagingConfig.dbName)) {
    throw new Error('Refusing isolated UI smoke because DB_NAME is not marked as a smoke/test database.');
}
const db = require('../models');
const { BUILT_IN_DEFAULTS } = require('../middleware/rbac');
const Op = db.Sequelize.Op;

const DEFAULT_BASE_URL = 'http://localhost:' + (process.env.PORT || stagingConfig.port || '3100');
const baseUrl = (process.env.STAGING_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
const runId = String(Date.now());
const password = 'SmokePass!' + runId;
const sipTestPassword = 'SipSmoke!' + runId;
const sipTestExtension = 'smoke-' + runId;
const screenshotsDir = path.join(stagingConfig.writableRoot, 'smoke-screenshots');

const created = {
    roles: [],
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
        isMaster: label === 'Admin',
        twoFactorEnabled: false
    });
    created.users.push(user);
    return user;
}

async function createPermissionTestRole(label, canAdd, canEdit) {
    const permissions = roleDefaults('Read Only');
    ['patients', 'clinics'].forEach(key => {
        permissions[key] = {
            ...permissions[key],
            visible: true,
            canAdd,
            canEdit,
            canDelete: false,
            canExport: false,
            canCopy: true
        };
    });
    const role = await db.Role.create({
        name: `Smoke ${label} ${runId}`,
        description: 'Temporary Spanish permission rendering smoke role',
        isSystem: false,
        permissions
    });
    created.roles.push(role);
    return role;
}

async function createPatient(clinic, patientTransport, label, serviceDate, options) {
    options = options || {};
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
        isNonCompanyPatient: options.isNonCompanyPatient === true
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
    const addOnlyRole = await createPermissionTestRole('Add Only', true, false);
    const editOnlyRole = await createPermissionTestRole('Edit Only', false, true);
    const adminUser = await createUser(adminRole, 'Admin');
    const callCenterUser = await createUser(callCenterRole, 'CallCenter');
    const addOnlyUser = await createUser(addOnlyRole, 'AddOnly');
    const editOnlyUser = await createUser(editOnlyRole, 'EditOnly');

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
    const nonCompanyPatient = await createPatient(
        clinic,
        patientTransport,
        'NonCompany',
        dateFromToday(-123),
        { isNonCompanyPatient: true }
    );

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
    const dialedAt = new Date(Date.now() - 8 * 60 * 1000);
    const ringingAt = new Date(dialedAt.getTime() + 3000);
    const answeredAt = new Date(ringingAt.getTime() + 7000);
    const endedAt = new Date(answeredAt.getTime() + 83000);
    const crmAttempt = await db.CallCenterCallAttempt.create({
        patientId: metricPatient.id,
        userId: callCenterUser.id,
        correlationId: 'ui-smoke-attempt-' + runId,
        phoneClient: 'rx_softphone',
        direction: 'outbound',
        state: 'ended',
        outcome: 'answered',
        patientCode: metricPatient.patientCode,
        patientName: metricPatient.firstName + ' ' + metricPatient.lastName,
        clinicName: clinic.name,
        agentName: callCenterUser.firstName + ' ' + callCenterUser.lastName,
        extension: 'smoke-ext',
        dialedNumber: String(metricPatient.phone).replace(/[^0-9+*#]/g, ''),
        sipResponseCode: 200,
        sipReason: 'OK',
        dialedAt,
        ringingAt,
        answeredAt,
        endedAt,
        ringDurationSeconds: 7,
        conversationDurationSeconds: 83
    });
    const smokePhoneAccount = await db.UserSoftphoneAccount.create({
        userId: callCenterUser.id,
        server: '192.0.2.20',
        port: 5060,
        username: sipTestExtension,
        authId: 'smoke-auth-' + runId,
        displayName: 'Smoke Live Phone',
        localSipPort: 0,
        encryptedPassword: 'smoke-test-value-never-decrypted',
        isEnabled: true
    });
    const liveSeenAt = new Date();
    await db.SoftphoneRelayDevice.create({
        userId: callCenterUser.id,
        deviceName: 'Smoke Live RX Phone',
        tokenHash: ('smoke-live-phone-' + runId).padEnd(64, '0').slice(0, 64),
        pairedAt: liveSeenAt,
        lastSeenAt: liveSeenAt,
        isEnabled: true,
        registrationState: 'registered',
        callState: 'connected',
        callId: crmAttempt.correlationId,
        peer: crmAttempt.dialedNumber,
        snapshot: {
            registration: 'registered',
            call: 'connected',
            peer: crmAttempt.dialedNumber,
            incoming: false,
            muted: false,
            callId: crmAttempt.correlationId,
            dialedAt: crmAttempt.dialedAt,
            ringingAt: crmAttempt.ringingAt,
            connectedAt: crmAttempt.answeredAt,
            endedAt: null,
            outcome: 'answered',
            clientVersion: '0.6.0',
            managedMode: true,
            allowManualDialing: true,
            accountUpdatedAt: smokePhoneAccount.updatedAt.toISOString()
        }
    });

    return {
        adminUser,
        callCenterUser,
        addOnlyUser,
        editOnlyUser,
        clinic,
        patientTransport,
        queuePatient,
        metricPatient,
        secondMetricPatient,
        nonCompanyPatient,
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

async function downloadText(page, selector, name) {
    const locator = page.locator(selector).first();
    await locator.waitFor({ state: 'visible', timeout: 10000 });
    const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 15000 }),
        locator.click()
    ]);
    const downloadPath = await download.path();
    const contents = fs.readFileSync(downloadPath, 'utf8');
    const suggested = download.suggestedFilename();
    await download.delete().catch(() => {});
    pass(name, suggested);
    return contents;
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
    await page.waitForFunction(() => {
        const steps = document.querySelector('#rxPipelineSteps');
        const text = steps ? (steps.textContent || '') : '';
        return text.includes('Current Stage Breakdown — RX records by latest completed step') ||
            text.includes('No workflow steps configured yet.');
    }, null, { timeout: 15000 });
    const pipelineBreakdownText = (await page.locator('#rxPipelineSteps').textContent()).trim();
    assert(
        pipelineBreakdownText.includes('Current Stage Breakdown — RX records by latest completed step'),
        'RX Workflow Pipeline must identify Current Stage as the latest completed workflow step.'
    );
    assert(
        !pipelineBreakdownText.includes('RX records waiting at each step'),
        'RX Workflow Pipeline must not label Current Stage counts as Next Action waiting counts.'
    );
    pass('dashboard RX pipeline uses Current Stage terminology');

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
    await page.locator('#patientReport button:has-text("Advanced")').click();
    await page.fill('#prfPatientCode', fixtures.nonCompanyPatient.patientCode);
    await page.fill('#prfDob', '1980-01-01');
    await page.selectOption('#prfPatientType', 'non_company');
    await page.selectOption('#prfClinicId', String(fixtures.clinic.id));
    await page.selectOption('#prfPatientTransportId', String(fixtures.patientTransport.id));
    const patientReportResponse = page.waitForResponse(response =>
        response.url().includes('/api/reports/patients?')
        && response.url().includes('patientType=non_company')
        && response.url().includes('clinicId=' + fixtures.clinic.id)
        && response.url().includes('patientTransportId=' + fixtures.patientTransport.id)
        && response.status() === 200,
        { timeout: 15000 }
    );
    await page.locator('#patientReport button[title="Search"]').click();
    await patientReportResponse;
    await page.waitForFunction((code) => {
        const body = document.querySelector('#patientReportBody');
        return body && body.textContent.indexOf(code) !== -1;
    }, fixtures.nonCompanyPatient.patientCode, { timeout: 15000 });
    const patientReportText = await page.locator('#patientReportBody').innerText();
    assert(patientReportText.includes('Non-Company'), 'Patient report did not show the selected patient type.');
    assert(patientReportText.includes(fixtures.clinic.name), 'Patient report did not show the selected clinic.');
    assert(patientReportText.includes(fixtures.patientTransport.companyName), 'Patient report did not show the selected patient transport.');
    pass('Patient report advanced filters and assignment columns');
    await expectDownload(page, '#exportPatientCsv', 'Filtered Patient report CSV export');
    await expectDownload(page, '#exportPatientRxDetailCsv', 'Normalized Patient + RX complete-history CSV export');
    const summaryExcel = await downloadText(page, '#exportPatientRxDetailXls', 'Patient + RX workflow-column Excel export');
    const configuredWorkflowActions = await db.WorkflowAction.findAll({
        where: { isActive: true },
        order: [['sequenceNumber', 'ASC'], ['id', 'ASC']]
    });
    configuredWorkflowActions.forEach(action => {
        const prefix = 'Workflow ' + (action.sequenceNumber || action.id) + ' - ' + action.name;
        assert(summaryExcel.includes(prefix + ' Status'), 'Summary Excel is missing configured workflow status column: ' + action.name);
        assert(summaryExcel.includes(prefix + ' Date'), 'Summary Excel is missing configured workflow date column: ' + action.name);
        assert(summaryExcel.includes(prefix + ' Completed By'), 'Summary Excel is missing configured workflow actor column: ' + action.name);
    });
    pass('Summary Excel retains headers for every configured workflow step', configuredWorkflowActions.length + ' steps');

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
    pass('Call Center Patient Activity filters and calculators');
    await page.locator('#ccReportTable th:has-text("Calls")').click();
    pass('Call Center Patient Activity sorting click');
    await expectDownload(page, '#exportCcCsv', 'Call Center Patient Activity CSV export');
    await expectDownload(page, '#exportCcXls', 'Call Center Patient Activity Excel export');

    await page.locator('#ccReportBody .cc-open-attempts').first().click();
    await expectVisible(page, '#ccAttemptsReportPane.active.show', 'Call Attempts report view visible');
    await page.waitForFunction((code) => {
        const body = document.querySelector('#ccAttemptReportBody');
        return body && body.textContent.indexOf(code) !== -1;
    }, fixtures.metricPatient.patientCode, { timeout: 15000 });
    assert.strictEqual((await page.locator('#ccaMAttempts').innerText()).trim(), '1', 'Automatic attempt total mismatch.');
    assert.strictEqual((await page.locator('#ccaMAnswered').innerText()).trim(), '1', 'Automatic answered total mismatch.');
    assert((await page.locator('#ccAttemptReportBody').innerText()).includes('200 — OK'), 'Automatic attempt SIP result was not rendered.');
    pass('Call Center Call Attempts filters and calculators');
    await expectDownload(page, '#exportCcAttemptsCsv', 'Call attempt CSV export');
    await expectDownload(page, '#exportCcAttemptsXls', 'Call attempt Excel export');

    await page.locator('#ccSupervisorViewTab').click();
    await expectVisible(page, '#ccSupervisorReportPane.active.show', 'Supervisor summary report view visible');
    await page.waitForFunction((agentName) => {
        const body = document.querySelector('#ccSupervisorAgentBody');
        return body && body.textContent.indexOf(agentName) !== -1;
    }, fixtures.callCenterUser.firstName + ' ' + fixtures.callCenterUser.lastName, { timeout: 15000 });
    assert.strictEqual((await page.locator('#ccsMCalls').innerText()).trim(), '1', 'Supervisor call total mismatch.');
    assert.strictEqual((await page.locator('#ccsMAnswered').innerText()).trim(), '1', 'Supervisor answered total mismatch.');
    assert.strictEqual((await page.locator('#ccsMNoAnswer').innerText()).trim(), '0', 'Supervisor no-answer total mismatch.');
    assert.strictEqual((await page.locator('#ccsMAnswerRate').innerText()).trim(), '100%', 'Supervisor answer rate mismatch.');
    assert.strictEqual((await page.locator('#ccsMTotalTalk').innerText()).trim(), '1:23', 'Supervisor total talk mismatch.');
    assert((await page.locator('#ccSupervisorClinicBody').innerText()).includes(fixtures.clinic.name), 'Supervisor clinic group was not rendered.');
    assert((await page.locator('#ccSupervisorDateBody').innerText()).includes('1:23'), 'Supervisor daily talk duration was not rendered.');
    pass('Call Center Supervisor Summary filters, groups, and calculations');
    await expectDownload(page, '#exportCcSupervisorCsv', 'Call Center Supervisor Summary CSV export');

    await page.locator('#ccAttemptsViewTab').click();
    await page.locator('#ccAttemptReportBody .cc-open-activity').first().click();
    await expectVisible(page, '#ccActivityReportPane.active.show', 'Patient Activity report return link');

    const returnedRx = await db.RXRecord.create({
        patientId: fixtures.metricPatient.id,
        serviceDate: dateFromToday(-30),
        isDeleted: false,
        returnedToWarehouse: true,
        warehouseReturnDate: new Date(),
        warehouseReturnNote: 'Staging browser warehouse filter smoke'
    });
    const notReturnedRx = await db.RXRecord.create({
        patientId: fixtures.secondMetricPatient.id,
        serviceDate: dateFromToday(-30),
        isDeleted: false,
        returnedToWarehouse: false
    });
    const workflowActionsForRxSmoke = await db.WorkflowAction.findAll({
        where: { isActive: true },
        order: [['sequenceNumber', 'ASC'], ['id', 'ASC']],
        limit: 2
    });
    assert(
        workflowActionsForRxSmoke.length >= 2,
        'RX report browser smoke requires at least two active workflow actions.'
    );
    const firstWorkflowAction = workflowActionsForRxSmoke[0];
    const secondWorkflowAction = workflowActionsForRxSmoke[1];
    const reportStageDate = new Date();
    const reportTracking = await db.RXWorkflowTracking.create({
        rxRecordId: returnedRx.id,
        workflowActionId: firstWorkflowAction.id,
        completionDate: reportStageDate,
        userId: fixtures.adminUser.id
    });

    await page.goto(route('/reports'), { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.locator('a[href="#rxActionReport"]').click();
    await expectVisible(page, '#rrfCurrentWorkflowStage', 'RX report Current Stage filter');
    const reportCurrentStageLabel = await page.locator(
        '#rxActionReport label.form-label:has-text("Current Stage")'
    ).first().innerText();
    assert.strictEqual(reportCurrentStageLabel.trim().toLowerCase(), 'current stage');
    const reportCurrentStageOptions = await page.locator('#rrfCurrentWorkflowStage option').allTextContents();
    assert(
        reportCurrentStageOptions.includes(firstWorkflowAction.name),
        'RX report Current Stage choices must use the business action name.'
    );
    await page.locator('#rxActionReport button:has-text("Advanced")').click();
    await expectVisible(page, '#rrfWorkflowStage', 'RX report Next Action Required filter');
    await expectVisible(page, '#rrfCompletedStage', 'RX report History Includes Action filter');
    const reportNextActionOptions = await page.locator('#rrfWorkflowStage option').allTextContents();
    assert(
        reportNextActionOptions.includes('Needs: ' + secondWorkflowAction.name),
        'RX report Next Action Required choices must state the required business action.'
    );
    await page.fill('#rrfRxId', String(returnedRx.id));
    await page.selectOption('#rrfCurrentWorkflowStage', String(firstWorkflowAction.sequenceNumber));
    await page.selectOption('#rrfClinicId', String(fixtures.clinic.id));
    await page.selectOption('#rrfPatientType', 'company');
    await page.selectOption('#rrfWarehouseStatus', 'returned');
    await page.selectOption('#rrfCompletedStage', String(firstWorkflowAction.id));
    await page.fill('#rrfStageFrom', reportStageDate.toISOString().slice(0, 10));
    await page.fill('#rrfStageTo', reportStageDate.toISOString().slice(0, 10));
    const rxReportResponse = page.waitForResponse(response =>
        response.url().includes('/api/reports/rx-actions?')
        && response.url().includes('warehouseStatus=returned')
        && response.url().includes('clinicId=' + fixtures.clinic.id)
        && response.url().includes('currentWorkflowStage=' + firstWorkflowAction.sequenceNumber)
        && response.url().includes('completedStageId=' + firstWorkflowAction.id)
        && response.url().includes('stageFrom=')
        && response.status() === 200,
        { timeout: 15000 }
    );
    await page.locator('#rxActionReport button[title="Search"]').click();
    await rxReportResponse;
    await page.waitForFunction((rxId) => {
        const body = document.querySelector('#rxActionBody');
        return body && body.textContent.indexOf('RX-' + rxId) !== -1;
    }, returnedRx.id, { timeout: 15000 });
    const rxReportText = await page.locator('#rxActionBody').innerText();
    assert(rxReportText.includes('Returned'), 'RX action report did not show the warehouse status.');
    assert(rxReportText.includes(fixtures.clinic.name), 'RX action report did not show the selected clinic.');
    assert(rxReportText.includes(firstWorkflowAction.name), 'RX action report did not show the completed process stage.');
    assert(rxReportText.includes(fixtures.adminUser.firstName), 'RX action report did not show who completed the stage.');
    pass('RX action report distinguishes current stage, next action, and process history');
    await expectDownload(page, '#exportRxCsv', 'Filtered RX action report CSV export');

    await page.goto(route('/rx-records'), { waitUntil: 'domcontentloaded' });
    await page.locator('button[onclick="toggleRxPanel()"]').click();
    await expectVisible(page, '#rxFilterWarehouseStatus', 'RX Records Warehouse Status filter');
    let warehouseResponse = page.waitForResponse(response =>
        response.url().includes('/api/rx-records?')
        && response.url().includes('warehouseStatus=returned')
        && response.status() === 200,
        { timeout: 15000 }
    );
    await page.selectOption('#rxFilterWarehouseStatus', 'returned');
    await warehouseResponse;
    await page.waitForFunction((rxId) => {
        const body = document.querySelector('#rxBody');
        return body && body.textContent.indexOf('#' + rxId) !== -1;
    }, returnedRx.id, { timeout: 15000 });
    const returnedBody = await page.locator('#rxBody').innerText();
    assert(returnedBody.includes('#' + returnedRx.id), 'Returned filter did not include the returned RX.');
    assert(!returnedBody.includes('#' + notReturnedRx.id), 'Returned filter included a non-returned RX.');
    assert(returnedBody.includes('Returned to Warehouse'), 'Returned RX must show a readable warehouse badge.');
    const quickRxCsv = await downloadText(page, '#exportRxListCsvBtn', 'Filtered RX warehouse CSV export');
    assert(
        quickRxCsv.includes('"Completed Steps","Current Stage","Next Action Required"'),
        'RX Records CSV must place the explicit Current Stage and Next Action Required columns together.'
    );
    assert(
        quickRxCsv.includes(`"${firstWorkflowAction.name}","${secondWorkflowAction.name}"`),
        'RX Records CSV must export the current completed stage beside the next required action.'
    );

    warehouseResponse = page.waitForResponse(response =>
        response.url().includes('/api/rx-records?')
        && response.url().includes('warehouseStatus=not-returned')
        && response.status() === 200,
        { timeout: 15000 }
    );
    await page.selectOption('#rxFilterWarehouseStatus', 'not-returned');
    await warehouseResponse;
    await page.waitForFunction((rxId) => {
        const body = document.querySelector('#rxBody');
        return body && body.textContent.indexOf('#' + rxId) !== -1;
    }, notReturnedRx.id, { timeout: 15000 });
    const notReturnedBody = await page.locator('#rxBody').innerText();
    assert(notReturnedBody.includes('#' + notReturnedRx.id), 'Not Returned filter did not include the active RX.');
    assert(!notReturnedBody.includes('#' + returnedRx.id), 'Not Returned filter included a returned RX.');
    pass('RX Records warehouse filter and readable status badge');

    await expectVisible(page, '#rxFilterCurrentWorkflowStage', 'RX Records Current Stage filter');
    await expectVisible(page, '#rxFilterWorkflowStage', 'RX Records Next Action Required filter');
    await expectVisible(
        page,
        'label.form-label:has-text("Current Stage")',
        'RX Records primary Current Stage label'
    );
    await expectVisible(
        page,
        'label.form-label:has-text("Next Action Required")',
        'RX Records advanced Next Action Required label'
    );
    assert.strictEqual(
        await page.locator('#rxFilterCurrentWorkflowStage').evaluate(element => Boolean(element.closest('#rxAdvPanel'))),
        false,
        'Current Stage must remain in the primary filter row.'
    );
    assert.strictEqual(
        await page.locator('#rxFilterWorkflowStage').evaluate(element => Boolean(element.closest('#rxAdvPanel'))),
        true,
        'Next Action Required must be in Advanced filters.'
    );

    const firstStageSequence = Number(firstWorkflowAction.sequenceNumber);
    const nextStageSequence = firstStageSequence + 1;
    await page.locator(`#rxFilterWorkflowStage option[value="${nextStageSequence}"]`)
        .waitFor({ state: 'attached', timeout: 15000 });
    await page.locator(`#rxFilterCurrentWorkflowStage option[value="${firstStageSequence}"]`)
        .waitFor({ state: 'attached', timeout: 15000 });
    assert.strictEqual(
        (await page.locator(`#rxFilterCurrentWorkflowStage option[value="${firstStageSequence}"]`).innerText()).trim(),
        firstWorkflowAction.name,
        'Current Stage options must use the business action name without offset numbering.'
    );
    assert.strictEqual(
        (await page.locator(`#rxFilterWorkflowStage option[value="${nextStageSequence}"]`).innerText()).trim(),
        'Needs: ' + secondWorkflowAction.name,
        'Next Action Required options must explain the required action without stage numbering.'
    );

    let stageResponse = page.waitForResponse(response =>
        response.url().includes('/api/rx-records?')
        && response.url().includes(`workflowStage=${nextStageSequence}`)
        && response.status() === 200,
        { timeout: 15000 }
    );
    await page.selectOption('#rxFilterWarehouseStatus', '');
    await page.selectOption('#rxFilterWorkflowStage', String(nextStageSequence));
    await stageResponse;
    await page.waitForFunction((rxId) => {
        const body = document.querySelector('#rxBody');
        return body && body.textContent.indexOf('#' + rxId) !== -1;
    }, returnedRx.id, { timeout: 15000 });
    let stageBody = await page.locator('#rxBody').innerText();
    assert(stageBody.includes('#' + returnedRx.id), 'Needs second action must include the RX currently completed through the first action.');
    assert(!stageBody.includes('#' + notReturnedRx.id), 'Needs second action must exclude a not-started RX.');

    stageResponse = page.waitForResponse(response =>
        response.url().includes('/api/rx-records?')
        && response.url().includes(`currentWorkflowStage=${firstStageSequence}`)
        && !response.url().includes(`workflowStage=${nextStageSequence}`)
        && response.status() === 200,
        { timeout: 15000 }
    );
    await page.selectOption('#rxFilterWorkflowStage', '');
    await page.selectOption('#rxFilterCurrentWorkflowStage', String(firstStageSequence));
    await stageResponse;
    await page.waitForFunction((rxId) => {
        const body = document.querySelector('#rxBody');
        return body && body.textContent.indexOf('#' + rxId) !== -1;
    }, returnedRx.id, { timeout: 15000 });
    stageBody = await page.locator('#rxBody').innerText();
    assert(stageBody.includes('#' + returnedRx.id), 'Current Stage must match the Excel current-stage record.');
    assert(!stageBody.includes('#' + notReturnedRx.id), 'Current Stage must exclude a not-started RX.');
    pass('RX Records prioritizes Current Stage and keeps Next Action Required advanced');

    await db.RXWorkflowTracking.destroy({ where: { id: reportTracking.id } });
    await db.RXRecord.destroy({ where: { id: { [Op.in]: [returnedRx.id, notReturnedRx.id] } } });

    await page.goto(route('/patients'), { waitUntil: 'domcontentloaded' });
    await page.locator('#advancedToggleBtn').click();
    await page.locator('#srchPatientType').waitFor({ state: 'visible', timeout: 15000 });
    const nonCompanyFilterResponse = page.waitForResponse(response =>
        response.url().includes('/api/patients?')
        && response.url().includes('patientType=non_company')
        && response.status() === 200,
        { timeout: 15000 }
    );
    await page.selectOption('#srchPatientType', 'non_company');
    await nonCompanyFilterResponse;
    const nonCompanyRow = page.locator('tr[data-patient-id="' + fixtures.nonCompanyPatient.id + '"]');
    await nonCompanyRow.waitFor({ state: 'visible', timeout: 15000 });
    assert.strictEqual(await nonCompanyRow.getAttribute('data-patient-type'), 'non-company', 'Non-company row marker is missing.');
    await expectVisible(page, 'tr[data-patient-id="' + fixtures.nonCompanyPatient.id + '"] .patient-non-company-badge', 'Patients non-company warning badge');
    assert(
        (await nonCompanyRow.innerText()).includes('No Call Center'),
        'Non-company row must explain that it is excluded from Call Center.'
    );
    const companyFilterResponse = page.waitForResponse(response =>
        response.url().includes('/api/patients?')
        && response.url().includes('patientType=company')
        && response.status() === 200,
        { timeout: 15000 }
    );
    await page.selectOption('#srchPatientType', 'company');
    await companyFilterResponse;
    assert.strictEqual(await page.locator('tr[data-patient-id="' + fixtures.nonCompanyPatient.id + '"]').count(), 0, 'Company filter must hide non-company rows.');
    pass('Patients Company / Non-Company filtering');

    const reopenNonCompanyResponse = page.waitForResponse(response =>
        response.url().includes('/api/patients?')
        && response.url().includes('patientType=non_company')
        && response.status() === 200,
        { timeout: 15000 }
    );
    await page.selectOption('#srchPatientType', 'non_company');
    await reopenNonCompanyResponse;
    await nonCompanyRow.waitFor({ state: 'visible', timeout: 15000 });
    await nonCompanyRow.locator('button.btn-outline-primary').click();
    await page.locator('#patientModal').waitFor({ state: 'visible', timeout: 10000 });
    assert.strictEqual(await page.locator('#pIsNonCompanyPatient').isChecked(), true, 'Edit form must load the current non-company flag.');
    const clearNonCompanyResponse = page.waitForResponse(response =>
        response.url().includes('/api/patients/' + fixtures.nonCompanyPatient.id)
        && response.request().method() === 'PUT'
        && response.status() === 200,
        { timeout: 15000 }
    );
    await page.locator('#pIsNonCompanyPatient').uncheck();
    await page.locator('#savePatientBtn').click();
    await clearNonCompanyResponse;
    await page.locator('#patientModal').waitFor({ state: 'hidden', timeout: 10000 });
    let persistedPatientResponse = await context.request.get(route('/api/patients/' + fixtures.nonCompanyPatient.id));
    assert.strictEqual(persistedPatientResponse.status(), 200, 'Updated patient should reload after clearing non-company.');
    let persistedPatient = await persistedPatientResponse.json();
    assert.strictEqual(persistedPatient.isNonCompanyPatient, false, 'Clearing Non-Company Patient must persist false.');

    const showCompanyPatientResponse = page.waitForResponse(response =>
        response.url().includes('/api/patients?')
        && response.url().includes('patientType=company')
        && response.status() === 200,
        { timeout: 15000 }
    );
    await page.selectOption('#srchPatientType', 'company');
    await showCompanyPatientResponse;
    await nonCompanyRow.waitFor({ state: 'visible', timeout: 15000 });
    assert.strictEqual(await nonCompanyRow.getAttribute('data-patient-type'), 'company', 'Cleared patient must render as a company patient.');
    assert.strictEqual(await nonCompanyRow.locator('.patient-non-company-badge').count(), 0, 'Cleared patient must not retain the non-company badge.');

    await nonCompanyRow.locator('button.btn-outline-primary').click();
    await page.locator('#patientModal').waitFor({ state: 'visible', timeout: 10000 });
    assert.strictEqual(await page.locator('#pIsNonCompanyPatient').isChecked(), false, 'Edit form must reload the cleared non-company flag.');
    const restoreNonCompanyResponse = page.waitForResponse(response =>
        response.url().includes('/api/patients/' + fixtures.nonCompanyPatient.id)
        && response.request().method() === 'PUT'
        && response.status() === 200,
        { timeout: 15000 }
    );
    await page.locator('#pIsNonCompanyPatient').check();
    await page.locator('#savePatientBtn').click();
    await restoreNonCompanyResponse;
    await page.locator('#patientModal').waitFor({ state: 'hidden', timeout: 10000 });
    persistedPatientResponse = await context.request.get(route('/api/patients/' + fixtures.nonCompanyPatient.id));
    persistedPatient = await persistedPatientResponse.json();
    assert.strictEqual(persistedPatient.isNonCompanyPatient, true, 'Restoring Non-Company Patient must persist true.');
    pass('Patients Non-Company checkbox persists both unchecked and checked states');

    const excludedQueueResponse = await context.request.get(route('/api/call-center/patients?q=' + encodeURIComponent(fixtures.nonCompanyPatient.lastName)));
    assert.strictEqual(excludedQueueResponse.status(), 200, 'Non-company Call Center exclusion query failed.');
    assert.strictEqual((await excludedQueueResponse.json()).total, 0, 'Non-company patient appeared in the Call Center queue.');
    pass('Non-company patient excluded from Call Center queue');

    await page.goto(route('/users'), { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.locator('#addNewBtn').click();
    await expectVisible(page, '#crudModal', 'Administrator Add User modal');
    assert.strictEqual(await page.locator('#crudViewOnlyBanner').isHidden(), true, 'Administrator must not see the View Only banner in shared Add/Edit forms.');
    assert.strictEqual(await page.locator('#saveCrudBtn').isVisible(), true, 'Administrator Save action must remain available in shared Add/Edit forms.');
    assert.strictEqual(await page.locator('#crudForm input').first().isEditable(), true, 'Administrator fields must remain editable in shared Add/Edit forms.');
    await page.locator('#crudModal .btn-close').click();
    await page.locator('#crudModal').waitFor({ state: 'hidden', timeout: 5000 });
    pass('Administrator shared Add/Edit modal permissions');

    const phoneUserRow = page.locator('#crudTable tbody tr').filter({ hasText: fixtures.callCenterUser.username }).first();
    await phoneUserRow.waitFor({ state: 'visible', timeout: 15000 });
    page.once('dialog', dialog => dialog.accept());
    await Promise.all([
        page.waitForResponse(response => response.url().includes('/api/users/' + fixtures.callCenterUser.id + '/phone-account/setup-access') && response.status() === 200),
        phoneUserRow.getByRole('button', { name: 'Allow setup' }).click()
    ]);
    await fixtures.callCenterUser.reload();
    assert.strictEqual(fixtures.callCenterUser.phoneAccountSetupAllowed, true, 'Administrator did not grant setup to the selected user.');
    pass('Administrator granted one-time Phone Account Setup to one user');

    await page.goto(route('/softphone-devices'), { waitUntil: 'domcontentloaded' });
    await waitForNonPlaceholder(page, '#deviceStatPaired', 'Administrator Phone Devices inventory loaded');
    assert.strictEqual(
        (await page.locator('#deviceRows').innerText()).includes('Loading devices'),
        false,
        'Phone Devices must not remain in its initial loading state.'
    );
    pass('Administrator Phone Devices FortiGate-safe inventory request');

    await db.SoftphoneRelayDevice.update(
        { lastSeenAt: new Date() },
        { where: { userId: fixtures.callCenterUser.id } }
    );
    await page.goto(route('/live-rx-phones'), { waitUntil: 'domcontentloaded' });
    await waitForNonPlaceholder(page, '#phoneStatRegistered', 'Administrator Live RX Phones board loaded');
    assert.strictEqual(
        (await page.locator('#livePhoneBoard').innerText()).includes('Loading RX Softphone lines'),
        false,
        'Live RX Phones must not remain in its initial loading state.'
    );
    assert.strictEqual(await page.locator('#livePhoneStatusFilter').isVisible(), true, 'Live RX Phones status filter must be visible.');
    const livePhoneText = await page.locator('#livePhoneBoard').innerText();
    assert.strictEqual(
        await page.locator('#livePhoneBoard .phone-crm-label').first().textContent(),
        'RX Tracker call',
        'Live RX Phones did not label the CRM-originated active call.'
    );
    assert(livePhoneText.includes(fixtures.metricPatient.firstName + ' ' + fixtures.metricPatient.lastName), 'Live RX Phones did not show the called patient name.');
    assert(livePhoneText.includes(fixtures.metricPatient.patientCode), 'Live RX Phones did not show the patient ID.');
    assert(livePhoneText.includes(fixtures.clinic.name), 'Live RX Phones did not show the patient clinic.');
    await page.fill('#livePhoneSearch', fixtures.metricPatient.patientCode);
    assert.strictEqual(await page.locator('#livePhoneBoard .live-phone-card').count(), 1, 'Live RX Phones patient search did not retain the correlated phone card.');
    await page.fill('#livePhoneSearch', '');
    pass('Administrator Live RX Phones CRM patient context');
    pass('Administrator Live RX Phones presence board');

    assertNoBrowserErrors('admin dashboard/report flow');
    await context.close();
}

async function runCallCenterWorkspace(fixtures) {
    const { context, page } = await newContext();
    await login(page, fixtures.callCenterUser.username, '/call-center');

    const phoneSetupLoaded = page.waitForResponse(response =>
        response.request().method() === 'GET'
        && response.url().includes('/api/phone-account/setup')
        && response.status() === 200,
        { timeout: 15000 }
    );
    await page.goto(route('/phone-account-setup'), { waitUntil: 'domcontentloaded' });
    await phoneSetupLoaded;
    await expectVisible(page, '#phoneAccountSetupForm', 'Per-user Phone Account Setup page');
    await page.fill('#phoneSetupServer', '192.168.15.200');
    await page.fill('#phoneSetupPort', '5060');
    await page.fill('#phoneSetupUsername', sipTestExtension);
    await page.fill('#phoneSetupDisplayName', 'Staging Smoke Softphone');
    await page.fill('#phoneSetupPassword', sipTestPassword);
    await page.fill('#phoneSetupPasswordConfirm', sipTestPassword);
    await page.fill('#phoneSetupLocalPort', '0');
    await Promise.all([
        page.waitForResponse(response => response.url().includes('/api/phone-account/setup') && response.status() === 200),
        page.locator('#phoneSetupSaveBtn').click()
    ]);
    await page.waitForURL('**/call-center', { timeout: 15000 });

    const accountBefore = await context.request.get(route('/api/call-center/phone-account'));
    assert.strictEqual(accountBefore.status(), 200, 'Call Center user should be able to load their own softphone assignment.');
    const accountBeforeBody = await accountBefore.json();
    assert.strictEqual(accountBeforeBody.configured, true, 'Self-configured softphone account should be available to its Call Center user.');
    assert.strictEqual(accountBeforeBody.username, sipTestExtension, 'Call Center user saved the wrong extension.');
    assert.strictEqual(accountBeforeBody.canManage, false, 'Call Center users must not be allowed to edit their assigned account.');
    assert.strictEqual(accountBeforeBody.adminPinRequired, true, 'Isolated staging must require the administrator PIN for phone-account saves.');

    const rejectedSecondSetup = await context.request.post(route('/api/phone-account/setup'), {
        data: { server: '192.168.15.200', port: 5060, username: 'unauthorized', displayName: 'Unauthorized', localSipPort: 0, password: sipTestPassword }
    });
    assert.strictEqual(rejectedSecondSetup.status(), 403, 'Completed users must not be able to change the account without a new per-user authorization.');

    const accountAfter = await context.request.get(route('/api/call-center/phone-account'));
    const accountMetadata = await accountAfter.json();
    assert.strictEqual(accountAfter.status(), 200, 'Saved softphone assignment should load.');
    assert.strictEqual(accountMetadata.passwordConfigured, true, 'Assigned account should report an encrypted password is configured.');
    assert.strictEqual(Object.hasOwn(accountMetadata, 'password'), false, 'Softphone metadata endpoint must not expose the password.');
    assert.strictEqual(Object.hasOwn(accountMetadata, 'encryptedPassword'), false, 'Softphone metadata endpoint must not expose ciphertext.');

    const registrationBootstrap = await page.evaluate(async ({ expectedPassword }) => {
        const response = await fetchWithAuth('/api/call-center/phone-account/registration', { method: 'POST', body: '{}', silent: true });
        const body = await response.json().catch(() => ({}));
        const result = { status: response.status, configured: body.configured === true, passwordMatches: body.password === expectedPassword };
        body.password = '';
        return result;
    }, { expectedPassword: sipTestPassword });
    assert.deepStrictEqual(
        registrationBootstrap,
        { status: 200, configured: true, passwordMatches: true },
        'Authenticated registration bootstrap should decrypt only the current user assignment.'
    );
    const storedAccount = await db.UserSoftphoneAccount.findOne({ where: { userId: fixtures.callCenterUser.id } });
    assert(storedAccount && storedAccount.encryptedPassword.startsWith('rxsoft:v1:'), 'Staging DB should store a versioned encrypted SIP password.');
    assert(!storedAccount.encryptedPassword.includes(sipTestPassword), 'Staging DB must not store the SIP password in plaintext.');
    assert.strictEqual(await page.locator('#ccPhoneSetupModal').count(), 0, 'Call Center must not include the retired phone account editor.');
    await db.UserSoftphoneAccount.destroy({ where: { userId: fixtures.callCenterUser.id } });
    pass('Per-user encrypted one-time RX Softphone setup');

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

    const rejectedNonCompanyClaim = await page.evaluate(async (patientId) => {
        const response = await fetchWithAuth('/api/call-center/patients/' + patientId + '/claim', {
            method: 'POST',
            body: '{}',
            silent: true
        });
        return {
            status: response.status,
            body: await response.json().catch(() => ({}))
        };
    }, fixtures.nonCompanyPatient.id);
    assert.strictEqual(rejectedNonCompanyClaim.status, 409, 'Non-company Call Center claim must be rejected.');
    assert.match(rejectedNonCompanyClaim.body.error || '', /Non-company patients are not eligible/i);
    pass('Call Center rejects non-company patient claim');

    await page.goto(route('/live-rx-phones'), { waitUntil: 'domcontentloaded' });
    await page.waitForURL('**/call-center', { timeout: 15000 });
    pass('Call Center cannot open Administrator Live RX Phones');

    await page.goto(route('/dashboard'), { waitUntil: 'domcontentloaded' });
    await page.waitForURL('**/call-center', { timeout: 15000 });
    pass('Call Center URL injection redirected to workspace');

    await expectVisible(page, '#ccCardQueue', 'Call Center queue card visible');
    await waitForNonPlaceholder(page, '#ccMetricEligible', 'Call Center eligible metric loaded');
    const pageSizeOptions = await page.locator('#ccPageSize option').evaluateAll(options => options.map(option => option.value));
    assert.deepStrictEqual(pageSizeOptions, ['5', '10', '25', '50'], 'Call Center page size options should support longer scrolling rosters.');
    pass('Call Center pagination options support 5, 10, 25, and 50 patients');
    const expandedRosterResponsePromise = page.waitForResponse(response =>
        response.url().includes('/api/call-center/patients?')
        && response.url().includes('pageSize=25')
        && response.status() === 200
    );
    await page.selectOption('#ccPageSize', '25');
    const expandedRosterResponse = await expandedRosterResponsePromise;
    const expandedRosterData = await expandedRosterResponse.json();
    assert.strictEqual(expandedRosterData.pageSize, 25, 'Call Center API should honor the selected longer roster size.');
    pass('Call Center expanded scrolling roster loaded', '25 patients per page');

    await page.fill('#ccSearch', fixtures.queueSearch);
    await page.click('#ccSearchBtn');
    const rowSelector = '#ccPatientRows tr:has-text("' + fixtures.queueSearch + '")';
    await page.locator(rowSelector).first().waitFor({ state: 'visible', timeout: 15000 });
    await page.locator('.cc-sort[data-sort="clinicName"]').click();
    pass('Call Center clinic sorting click');
    await page.locator('.cc-sort[data-sort="patientTransportName"]').click();
    pass('Call Center patient transport sorting click');

    let row = page.locator(rowSelector).first();
    const rosterLayout = await row.evaluate(element => {
        const record = element.querySelector('.cc-record-all');
        const cellTops = Array.from(record.children).map(cell => Math.round(cell.getBoundingClientRect().top));
        return {
            fields: record.children.length,
            topDifference: Math.max(...cellTops) - Math.min(...cellTops)
        };
    });
    assert.strictEqual(rosterLayout.fields, 10, 'Call Center roster should contain all ten compact patient fields/actions.');
    assert(rosterLayout.topDifference <= 2, 'Call Center patient fields and actions should render on one aligned line.');
    const noteBox = row.locator('.cc-row-note');
    const compactNoteHeight = await noteBox.evaluate(element => element.getBoundingClientRect().height);
    await noteBox.fill('First line\nSecond line\nThird line');
    const expandedNoteHeight = await noteBox.evaluate(element => element.getBoundingClientRect().height);
    assert(expandedNoteHeight > compactNoteHeight, 'Call Center Add Note field should grow with multi-line comments.');
    await noteBox.fill('');
    pass('Call Center compact one-line roster layout');
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
    const connectedAtForBadge = new Date(Date.now() - 65000).toISOString();
    const lockStatusPattern = '**/api/call-center/locks/status**';
    await page.route(lockStatusPattern, async intercepted => {
        await intercepted.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                statuses: [{
                    patientId: fixtures.queuePatient.id,
                    status: 'active',
                    mine: false,
                    user: 'Another Agent',
                    callState: 'connected',
                    connectedAt: connectedAtForBadge,
                    secondsRemaining: 0
                }]
            })
        });
    });
    const connectedTimer = row.locator('.cc-cooldown-countdown.connected');
    await connectedTimer.waitFor({ state: 'visible', timeout: 5000 });
    const connectedTimerText = (await connectedTimer.innerText()).trim();
    assert(/^1:\d{2}$/.test(connectedTimerText), 'Connected phone badge should display elapsed m:ss duration.');
    assert((await callLink.getAttribute('aria-label')).includes('Connected'), 'Connected phone action should expose elapsed duration accessibly.');
    const sharedStateText = (await row.locator('.cc-phone-lock-status').innerText()).trim();
    assert(/In use by Another Agent.*Connected 1:\d{2}/.test(sharedStateText), 'Another user should see the shared connected call state and duration.');
    await page.unroute(lockStatusPattern);
    await page.waitForFunction((patientId) => {
        const badge = document.querySelector('[data-action="phone-call"][data-patient-id="' + patientId + '"] .cc-cooldown-countdown');
        return badge && !badge.classList.contains('connected');
    }, String(fixtures.queuePatient.id), { timeout: 5000 });
    pass('Call Center shared state and timer badge', connectedTimerText + ' / ' + sharedStateText);
    assert.strictEqual(
        await row.locator('.cc-row-hangup[data-action="phone-hangup"]').count(),
        1,
        'Call Center should place the Hang Up control beneath this patient dial icon.'
    );
    const hangupPlacement = await row.evaluate(element => {
        const dial = element.querySelector('.cc-call-link[data-action="phone-call"]');
        const hangup = element.querySelector('.cc-row-hangup[data-action="phone-hangup"]');
        hangup.classList.remove('d-none');
        const dialRect = dial.getBoundingClientRect();
        const hangupRect = hangup.getBoundingClientRect();
        const placement = {
            belowDial: hangupRect.top >= dialRect.bottom,
            centered: Math.abs((hangupRect.left + (hangupRect.width / 2)) - (dialRect.left + (dialRect.width / 2))) <= 2
        };
        hangup.classList.add('d-none');
        return placement;
    });
    assert(hangupPlacement.belowDial, 'Hang Up control should render below the dial icon.');
    assert(hangupPlacement.centered, 'Hang Up control should remain centered with the dial icon.');
    pass('Call Center inline Hang Up control placement');
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

    await page.evaluate(() => localStorage.setItem('rxUiLanguage', 'es'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('#ccCardQueue').waitFor({ state: 'visible', timeout: 15000 });
    const spanishCards = await page.locator('.cc-metric .label').allTextContents();
    assert.deepStrictEqual(
        spanishCards.map(value => value.trim()),
        ['Cola de llamadas', 'Llamadas en esta sesión', 'Pacientes en esta sesión', 'Fechas en esta sesión', 'Eficiencia'],
        'Call Center metric cards should render in Spanish.'
    );
    assert(/^Página \d+ de \d+$/.test((await page.locator('#ccPageLabel').innerText()).trim()), 'Call Center pagination should render in Spanish.');
    assert.strictEqual(await page.title(), 'Centro de llamadas - Patient RX System', 'Call Center document title should render in Spanish.');

    await page.locator('#ccCardCalls').click();
    await page.waitForFunction(() => (document.getElementById('ccListTitle') || {}).textContent === 'Llamadas en esta sesión', null, { timeout: 15000 });
    assert(
        (await page.locator('#ccListSubtitle').innerText()).includes('Registros de llamadas de esta sesión'),
        'Dynamic Call Center card subtitle should render in Spanish.'
    );

    await page.locator('#ccCardServiceDates').click();
    const spanishBusinessRow = page.locator('tr[data-id="' + fixtures.queuePatient.id + '"]');
    await spanishBusinessRow.waitFor({ state: 'visible', timeout: 15000 });
    assert.strictEqual(
        (await spanishBusinessRow.locator('.cc-name-cell').allInnerTexts()).join(' '),
        fixtures.queuePatient.firstName + ' ' + fixtures.queuePatient.lastName,
        'Spanish UI must preserve the patient name exactly as stored.'
    );
    assert.strictEqual(
        (await spanishBusinessRow.locator('.cc-clinic-name').innerText()).trim(),
        fixtures.clinic.name,
        'Spanish UI must preserve the clinic name exactly as stored.'
    );
    assert.strictEqual(
        (await spanishBusinessRow.locator('.cc-patient-transport-name').innerText()).trim(),
        fixtures.patientTransport.companyName,
        'Spanish UI must preserve the patient transport name exactly as stored.'
    );
    assert(/Fecha de servicio ingresada|Listo/.test(await spanishBusinessRow.innerText()), 'Call Center status should render in Spanish.');
    pass('Call Center Spanish cards, dynamic copy, and business-data preservation');

    assertNoBrowserErrors('Call Center workspace flow');
    await context.close();
}

async function runSpanishPermissionWorkspace(fixtures) {
    async function useSpanish(page) {
        await page.addInitScript(function() {
            localStorage.setItem('rxUiLanguage', 'es');
        });
    }

    async function closeModal(page, modalSelector) {
        await page.locator(modalSelector + ' .btn-close').click();
        await page.locator(modalSelector).waitFor({ state: 'hidden', timeout: 5000 });
    }

    const addOnly = await newContext();
    await useSpanish(addOnly.page);
    await login(addOnly.page, fixtures.addOnlyUser.username, '/dashboard');
    await addOnly.page.goto(route('/patients'), { waitUntil: 'domcontentloaded' });
    await addOnly.page.waitForLoadState('networkidle').catch(() => {});
    assert.strictEqual(await addOnly.page.locator('html').getAttribute('lang'), 'es', 'Add-only permission test must run in Spanish.');
    await addOnly.page.locator('#addPatientBtn').click();
    await addOnly.page.locator('#patientModal').waitFor({ state: 'visible', timeout: 10000 });
    assert.strictEqual(await addOnly.page.locator('#patientModalTitle').getAttribute('data-modal-mode'), 'add');
    assert.strictEqual(await addOnly.page.locator('#savePatientBtn').isVisible(), true, 'Spanish add-only user must retain Patient Save in Add mode.');
    await closeModal(addOnly.page, '#patientModal');
    const addOnlyPatientRow = addOnly.page.locator('tr[data-patient-id="' + fixtures.queuePatient.id + '"]');
    await addOnlyPatientRow.waitFor({ state: 'visible', timeout: 15000 });
    await addOnlyPatientRow.locator('button:has(i.fa-eye)').click();
    await addOnly.page.locator('#patientModal').waitFor({ state: 'visible', timeout: 10000 });
    assert.strictEqual(await addOnly.page.locator('#patientModalTitle').getAttribute('data-modal-mode'), 'edit');
    assert.strictEqual(await addOnly.page.locator('#savePatientBtn').isHidden(), true, 'Spanish add-only user must not gain Patient Save in Edit mode.');
    await closeModal(addOnly.page, '#patientModal');

    await addOnly.page.goto(route('/clinics'), { waitUntil: 'domcontentloaded' });
    await addOnly.page.waitForLoadState('networkidle').catch(() => {});
    await addOnly.page.locator('#addNewBtn').click();
    await addOnly.page.locator('#crudModal').waitFor({ state: 'visible', timeout: 10000 });
    assert.strictEqual(await addOnly.page.locator('#crudModalLabel').getAttribute('data-modal-mode'), 'add');
    assert.strictEqual(await addOnly.page.locator('#saveCrudBtn').isVisible(), true, 'Spanish add-only user must retain CRUD Save in Add mode.');
    await closeModal(addOnly.page, '#crudModal');
    const addOnlyClinicRow = addOnly.page.locator('#crudTable tbody tr').filter({ hasText: fixtures.clinic.name }).first();
    await addOnlyClinicRow.waitFor({ state: 'visible', timeout: 15000 });
    await addOnlyClinicRow.locator('button:has(i.fa-eye)').evaluate(button => button.click());
    await addOnly.page.locator('#crudModal').waitFor({ state: 'visible', timeout: 10000 });
    assert.strictEqual(await addOnly.page.locator('#crudModalLabel').getAttribute('data-modal-mode'), 'edit');
    assert.strictEqual(await addOnly.page.locator('#saveCrudBtn').isHidden(), true, 'Spanish add-only user must not gain CRUD Save in Edit mode.');
    await closeModal(addOnly.page, '#crudModal');
    await addOnly.context.close();

    const editOnly = await newContext();
    await useSpanish(editOnly.page);
    await login(editOnly.page, fixtures.editOnlyUser.username, '/dashboard');
    await editOnly.page.goto(route('/patients'), { waitUntil: 'domcontentloaded' });
    await editOnly.page.waitForLoadState('networkidle').catch(() => {});
    assert.strictEqual(await editOnly.page.locator('html').getAttribute('lang'), 'es', 'Edit-only permission test must run in Spanish.');
    const editOnlyPatientRow = editOnly.page.locator('tr[data-patient-id="' + fixtures.queuePatient.id + '"]');
    await editOnlyPatientRow.waitFor({ state: 'visible', timeout: 15000 });
    await editOnlyPatientRow.locator('button:has(i.fa-edit)').click();
    await editOnly.page.locator('#patientModal').waitFor({ state: 'visible', timeout: 10000 });
    assert.strictEqual(await editOnly.page.locator('#savePatientBtn').isVisible(), true, 'Spanish edit-only user must retain Patient Save in Edit mode.');
    await closeModal(editOnly.page, '#patientModal');
    await editOnly.page.evaluate(() => document.getElementById('addPatientBtn').click());
    await editOnly.page.locator('#patientModal').waitFor({ state: 'visible', timeout: 10000 });
    assert.strictEqual(await editOnly.page.locator('#patientModalTitle').getAttribute('data-modal-mode'), 'add');
    assert.strictEqual(await editOnly.page.locator('#savePatientBtn').isHidden(), true, 'Spanish edit-only user must not gain Patient Save in Add mode.');
    await closeModal(editOnly.page, '#patientModal');

    await editOnly.page.goto(route('/clinics'), { waitUntil: 'domcontentloaded' });
    await editOnly.page.waitForLoadState('networkidle').catch(() => {});
    const editOnlyClinicRow = editOnly.page.locator('#crudTable tbody tr').filter({ hasText: fixtures.clinic.name }).first();
    await editOnlyClinicRow.waitFor({ state: 'visible', timeout: 15000 });
    await editOnlyClinicRow.locator('button:has(i.fa-edit)').click();
    await editOnly.page.locator('#crudModal').waitFor({ state: 'visible', timeout: 10000 });
    assert.strictEqual(await editOnly.page.locator('#saveCrudBtn').isVisible(), true, 'Spanish edit-only user must retain CRUD Save in Edit mode.');
    await closeModal(editOnly.page, '#crudModal');
    await editOnly.page.evaluate(() => document.getElementById('addNewBtn').click());
    await editOnly.page.locator('#crudModal').waitFor({ state: 'visible', timeout: 10000 });
    assert.strictEqual(await editOnly.page.locator('#crudModalLabel').getAttribute('data-modal-mode'), 'add');
    assert.strictEqual(await editOnly.page.locator('#saveCrudBtn').isHidden(), true, 'Spanish edit-only user must not gain CRUD Save in Add mode.');
    await closeModal(editOnly.page, '#crudModal');
    await editOnly.context.close();

    pass('Spanish Add/Edit permission rendering uses stable modal modes');
    assertNoBrowserErrors('Spanish permission workspace flow');
}

async function cleanup() {
    const patientIds = created.patients.map(row => row.id);
    const userIds = created.users.map(row => row.id);
    const clinicIds = created.clinics.map(row => row.id);
    const patientTransportIds = created.patientTransports.map(row => row.id);
    const roleIds = created.roles.map(row => row.id);
    await new Promise(resolve => setTimeout(resolve, 500));

    if (patientIds.length) {
        if (db.CallCenterCallAttempt) await db.CallCenterCallAttempt.destroy({ where: { patientId: { [Op.in]: patientIds } } }).catch(() => {});
        if (db.CallCenterLock) await db.CallCenterLock.destroy({ where: { patientId: { [Op.in]: patientIds } } }).catch(() => {});
        if (db.PatientLock) await db.PatientLock.destroy({ where: { patientId: { [Op.in]: patientIds } } }).catch(() => {});
        if (db.RXRecord) {
            const smokeRx = await db.RXRecord.findAll({ where: { patientId: { [Op.in]: patientIds } }, attributes: ['id'] }).catch(() => []);
            const smokeRxIds = smokeRx.map(row => row.id);
            if (smokeRxIds.length) {
                if (db.RXWorkflowTracking) await db.RXWorkflowTracking.destroy({ where: { rxRecordId: { [Op.in]: smokeRxIds } } }).catch(() => {});
                if (db.RXHistory) await db.RXHistory.destroy({ where: { rxRecordId: { [Op.in]: smokeRxIds } } }).catch(() => {});
                if (db.Medication) await db.Medication.destroy({ where: { rxRecordId: { [Op.in]: smokeRxIds } } }).catch(() => {});
                await db.RXRecord.destroy({ where: { id: { [Op.in]: smokeRxIds } } }).catch(() => {});
            }
        }
        await db.PatientNote.destroy({ where: { patientId: { [Op.in]: patientIds } } }).catch(() => {});
        if (db.PatientServiceDateHistory) await db.PatientServiceDateHistory.destroy({ where: { patientId: { [Op.in]: patientIds } } }).catch(() => {});
        if (db.PatientServiceDateCycle) await db.PatientServiceDateCycle.destroy({ where: { patientId: { [Op.in]: patientIds } } }).catch(() => {});
        await db.AuditLog.destroy({ where: { recordId: { [Op.in]: patientIds }, module: 'Call Center' } }).catch(() => {});
        await db.Patient.destroy({ where: { id: { [Op.in]: patientIds } } }).catch(() => {});
    }
    if (userIds.length) {
        if (db.SoftphoneRelayDevice) await db.SoftphoneRelayDevice.destroy({ where: { userId: { [Op.in]: userIds } } }).catch(() => {});
        if (db.UserSoftphoneAccount) await db.UserSoftphoneAccount.destroy({ where: { userId: { [Op.in]: userIds } } }).catch(() => {});
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
    if (roleIds.length) {
        await db.Role.destroy({ where: { id: { [Op.in]: roleIds } } }).catch(() => {});
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
    await runSpanishPermissionWorkspace(fixtures);
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
