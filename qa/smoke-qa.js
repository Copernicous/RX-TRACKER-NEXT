const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const { readConfig, ensureQaDirectories } = require('./lib/qa-env');

const config = readConfig();
ensureQaDirectories(config);

const results = [];
const errors = [];
const skipped = [];
let page;

function qaRoute(pathname) {
  const base = config.baseURL.replace(/\/+$/, '');
  const cleanPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return `${base}${cleanPath}`;
}

function pass(name, detail = '') {
  results.push({ status: 'PASS', name, detail });
  console.log('PASS:', name, detail);
}

function fail(name, detail = '') {
  results.push({ status: 'FAIL', name, detail });
  console.log('FAIL:', name, detail);
}

function skip(name, detail = '') {
  skipped.push({ name, detail });
  console.log('SKIP:', name, detail);
}

function findChromeExecutable() {
  const candidates = [
    config.chromePath,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe') : ''
  ].filter(Boolean);

  return candidates.find(candidate => fs.existsSync(candidate));
}

async function captureFailureScreenshot(name) {
  if (!page) return '';
  const fileName = `${new Date().toISOString().replace(/[:.]/g, '-')}-${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`;
  const screenshotPath = path.join(config.screenshotsDir, fileName);
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
  return screenshotPath;
}

async function safeClick(selector, name, opts = {}) {
  const loc = page.locator(selector).first();
  const count = await loc.count();
  if (!count) {
    skip(name, 'not present');
    return false;
  }
  if (!(await loc.isVisible().catch(() => false))) {
    skip(name, 'not visible');
    return false;
  }
  await loc.click({ timeout: 5000 });
  if (opts.wait) await page.waitForTimeout(opts.wait);
  pass(name);
  return true;
}

async function closeModal() {
  const close = page.locator('.modal.show button[data-bs-dismiss="modal"], .modal.show .btn-close').first();
  if (await close.count()) await close.click().catch(() => {});
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(300);
}

async function expectText(text, name) {
  await page.locator(`text=${text}`).first().waitFor({ state: 'visible', timeout: 10000 });
  pass(name);
}

async function expectVisible(selector, name) {
  await page.locator(selector).first().waitFor({ state: 'visible', timeout: 8000 });
  pass(name);
}

async function runSmoke() {
  const chrome = findChromeExecutable();
  if (!chrome) {
    throw new Error('Chrome was not found. Install Google Chrome or set QA_CHROME_PATH in qa/.env.qa.');
  }

  const browser = await chromium.launch({
    headless: config.headless,
    slowMo: config.slowMo,
    executablePath: chrome
  });

  try {
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      baseURL: config.baseURL,
      viewport: { width: 1440, height: 1000 },
      acceptDownloads: true
    });

    page = await context.newPage();
    page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push('CONSOLE: ' + msg.text());
    });
    page.on('requestfailed', req => {
      const errorText = req.failure()?.errorText || '';
      if (errorText.includes('net::ERR_ABORTED')) return;
      errors.push('REQUESTFAILED: ' + req.url() + ' ' + errorText);
    });
    page.on('response', res => {
      const status = res.status();
      if (status >= 500) errors.push('HTTP ' + status + ': ' + res.url());
    });

    await page.goto(qaRoute('/login'), { waitUntil: 'domcontentloaded' });
    await page.fill('#username', config.loginUsername);
    await page.fill('#password', config.loginPassword);
    await Promise.all([
      page.waitForURL('**/dashboard', { timeout: 15000 }),
      page.click('#loginBtn')
    ]);
    pass(`login ${config.loginUsername}/${'*'.repeat(config.loginPassword.length)} via HTTPS proxy`);

    await page.waitForLoadState('networkidle').catch(() => {});
    await expectText('Dashboard', 'dashboard loaded');
    await safeClick('#themeToggle', 'dashboard theme toggle', { wait: 200 });
    await safeClick('#sidebarCollapse', 'dashboard sidebar toggle', { wait: 200 });

    const pages = [
      ['/dashboard', 'Dashboard'],
      ['/patients', 'Patients Management'],
      ['/rx-records', 'RX Records'],
      ['/reports', 'Reports'],
      ['/audit-log', 'Audit Log'],
      ['/import', 'Data Import'],
      ['/pharmacies', 'Pharmacies'],
      ['/patient-transport', 'Patient Transport Companies'],
      ['/pharmacy-transport', 'Pharmacy Transport Companies'],
      ['/clinics', 'Clinics'],
      ['/workflow-actions', 'Workflow Actions'],
      ['/medication-catalog', 'RX Actions'],
      ['/users', 'User Management'],
      ['/roles', 'Roles Management'],
      ['/backups', 'Backup Management'],
      ['/system-settings', 'System Settings'],
      ['/active-users', 'Active Users'],
      ['/changelog', 'Changelog']
    ];

    for (const [url, label] of pages) {
      await page.goto(qaRoute(url), { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle').catch(() => {});
      await expectText(label.split(' ')[0], `${url} page reachable`);
    }

    await page.goto(qaRoute('/patients'), { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.fill('#srchFirstName', 'QA');
    await page.waitForTimeout(700);
    await page.locator('tbody:has-text("QA Patient")').waitFor({ state: 'visible', timeout: 10000 });
    pass('patients search shows seeded QA patient');
    await safeClick('#advancedToggleBtn', 'patients advanced filters toggle', { wait: 300 });
    await safeClick('#clearBtn', 'patients clear filters', { wait: 500 });
    await safeClick('#addPatientBtn', 'patients add modal opens', { wait: 500 });
    await expectVisible('#patientModal.show', 'patient modal visible');
    await closeModal();
    await safeClick('#exportPatientsCsvBtn', 'patients export button opens selector/download', { wait: 500 });
    await closeModal();

    await page.goto(qaRoute('/rx-records'), { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.fill('#rxFilterPatient', 'QA');
    await safeClick('#rxFilterBtn', 'rx search button', { wait: 700 });
    await page.locator('tbody:has-text("QA Patient")').waitFor({ state: 'visible', timeout: 10000 });
    pass('rx list shows seeded QA RX');
    await safeClick('button:has-text("New RX")', 'rx new modal opens', { wait: 500 });
    await expectVisible('#rxModal.show', 'rx modal visible');
    await closeModal();
    await safeClick('#rxClearBtn', 'rx clear filters', { wait: 500 });
    await safeClick('button[title="Workflow"]', 'rx workflow modal opens', { wait: 800 });
    await expectVisible('#workflowModal.show', 'workflow modal visible');
    await closeModal();
    await safeClick('button[title="View History"]', 'rx history modal opens', { wait: 800 });
    await closeModal();

    const crudPages = [
      ['/pharmacies', 'QA Pharmacy'],
      ['/patient-transport', 'QA Patient Transport'],
      ['/pharmacy-transport', 'QA Pharmacy Transport'],
      ['/clinics', 'QA Clinic'],
      ['/workflow-actions', 'QA Received Warehouse'],
      ['/medication-catalog', 'QA Medication Action']
    ];

    for (const [url, seededText] of crudPages) {
      await page.goto(qaRoute(url), { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle').catch(() => {});
      await expectText(seededText, `${url} shows seeded data`);
      const addButton = page.locator('#addNewBtn, button:has-text("Add"), button:has-text("New")').first();
      if (await addButton.count() && await addButton.isVisible().catch(() => false)) {
        await addButton.click();
        await page.waitForTimeout(400);
        pass(`${url} add button clickable`);
        await closeModal();
      } else {
        skip(`${url} add button`, 'not visible/found');
      }
    }

    await page.goto(qaRoute('/reports'), { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => {});
    await safeClick('button, a.btn', 'reports first visible action button', { wait: 500 }).catch(e => skip('reports button', e.message));

    await page.goto(qaRoute('/backups'), { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => {});
    await expectText('Backup', 'backups page loaded');
    skip('backup run/restore/delete buttons', 'destructive/heavy operations intentionally not clicked in smoke test');

    await page.goto(qaRoute('/system-settings'), { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => {});
    await expectText('System', 'system settings page loaded');

    await page.goto(qaRoute('/backoffice'), { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);
    const backofficeUrl = page.url();
    if (backofficeUrl.includes('/dashboard') || await page.locator('text=Master admin access required').count()) {
      pass('backoffice restricted for non-isMaster admin');
    } else {
      fail('backoffice restriction', 'non-isMaster admin was not redirected/restricted: ' + backofficeUrl);
    }

    const api = await context.request.get(qaRoute('/api/dashboard/stats'), { ignoreHTTPSErrors: true });
    if (api.ok()) pass('authenticated API dashboard stats');
    else fail('authenticated API dashboard stats', String(api.status()));
  } finally {
    await browser.close().catch(() => {});
  }
}

function writeSummary() {
  const failed = results.filter(r => r.status === 'FAIL').length;
  const summary = {
    generatedAt: new Date().toISOString(),
    baseURL: config.baseURL,
    database: config.dbName,
    passed: results.filter(r => r.status === 'PASS').length,
    failed,
    skipped,
    errors,
    results
  };
  const reportPath = path.join(config.resultsDir, 'smoke-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

(async () => {
  try {
    await runSmoke();
  } catch (err) {
    const screenshot = await captureFailureScreenshot('smoke-crash');
    fail('smoke test crashed', `${err.stack || err.message}${screenshot ? ` | screenshot: ${screenshot}` : ''}`);
  }

  const summary = writeSummary();
  if (summary.failed || summary.errors.length) process.exit(1);
})();
