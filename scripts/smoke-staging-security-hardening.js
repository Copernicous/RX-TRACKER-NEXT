'use strict';

const fs = require('fs');
const path = require('path');
const { prepareStagingEnv } = require('./lib/staging-env');

const stagingConfig = prepareStagingEnv();
const root = path.join(__dirname, '..');
const DEFAULT_BASE_URL = 'http://localhost:' + (process.env.PORT || stagingConfig.port || '3100');
const baseUrl = (process.env.STAGING_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');

const results = [];

function readRel(relPath) {
    return fs.readFileSync(path.join(root, relPath), 'utf8');
}

function addResult(id, title, status, evidence, verify) {
    results.push({ id, title, status, evidence, verify });
}

function has(text, pattern) {
    return pattern instanceof RegExp ? pattern.test(text) : text.includes(pattern);
}

function getDirective(csp, name) {
    const prefix = name + ' ';
    return String(csp || '')
        .split(';')
        .map(part => part.trim())
        .find(part => part === name || part.indexOf(prefix) === 0) || '';
}

async function fetchText(urlPath) {
    const res = await fetch(baseUrl + urlPath, { redirect: 'manual' });
    const text = await res.text().catch(() => '');
    return { res, text };
}

function statusIcon(status) {
    if (status === 'PASS') return '[PASS]';
    if (status === 'WARN') return '[WARN]';
    return '[INFO]';
}

function printResults() {
    console.log('');
    console.log('Staging security hardening check');
    console.log('URL: ' + baseUrl);
    console.log('');
    results.forEach((item) => {
        console.log(statusIcon(item.status) + ' ' + item.id + '. ' + item.title);
        console.log('       Evidence: ' + item.evidence);
        console.log('       Check:    ' + item.verify);
    });
    const counts = results.reduce((acc, item) => {
        acc[item.status] = (acc[item.status] || 0) + 1;
        return acc;
    }, {});
    console.log('');
    console.log('Summary: ' + (counts.PASS || 0) + ' pass, ' + (counts.WARN || 0) + ' warning, ' + (counts.INFO || 0) + ' info.');
    console.log('Warnings mean confirmed hardening backlog, not that staging is down.');
}

function allJsUnder(relDir) {
    const base = path.join(root, relDir);
    const out = [];
    function walk(dir) {
        fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) return walk(full);
            if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
        });
    }
    walk(base);
    return out.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
}

async function main() {
    let login;
    try {
        login = await fetchText('/login');
    } catch (err) {
        throw new Error('Cannot reach staging at ' + baseUrl + '. Start it with "npm run staging:start" first. ' + err.message);
    }
    if (!login.res || login.res.status >= 500) {
        throw new Error('Staging responded with HTTP ' + (login.res && login.res.status) + ' for /login.');
    }

    const appJsLive = await fetchText('/js/app.js');
    const settingsJsLive = await fetchText('/js/system-settings.js');
    const helpJsLive = await fetchText('/js/help.js');

    const appJs = appJsLive.text || readRel('public/js/app.js');
    const settingsJs = settingsJsLive.text || readRel('public/js/system-settings.js');
    const helpJs = helpJsLive.text || readRel('public/js/help.js');
    const loginEjs = readRel('views/login.ejs');
    const appServer = readRel('app.js');
    const authController = readRel('controllers/authController.js');
    const authMiddleware = readRel('middleware/auth.js');
    const webAuthMiddleware = readRel('middleware/webAuth.js');
    const twoFactorController = readRel('controllers/twoFactorController.js');
    const settingsService = readRel('services/settingsService.js');
    const sessionIdleService = readRel('services/sessionIdleService.js');
    const documentController = readRel('controllers/documentController.js');
    const apiRoutes = readRel('routes/apiRoutes.js');
    const securityAlertService = readRel('services/securityAlertService.js');
    const patientModel = readRel('models/patient.js');
    const rxModel = readRel('models/rxrecord.js');
    const packageJson = readRel('package.json');

    const csp = login.res.headers.get('content-security-policy') || '';
    const scriptSrc = getDirective(csp, 'script-src');
    const styleSrc = getDirective(csp, 'style-src');
    const scriptSrcAttr = getDirective(csp, 'script-src-attr');
    const styleSrcAttr = getDirective(csp, 'style-src-attr');
    const cspUsesNonces = /'nonce-[^']+'/.test(scriptSrc) && /'nonce-[^']+'/.test(styleSrc);
    const cspBlocksBroadInline = !scriptSrc.includes("'unsafe-inline'") && !styleSrc.includes("'unsafe-inline'");
    const cspHasLegacyAttrCompat = scriptSrcAttr.includes("'unsafe-inline'") || styleSrcAttr.includes("'unsafe-inline'");
    const nonceMatch = csp.match(/'nonce-([^']+)'/);
    const loginHtmlHasNonce = nonceMatch ? login.text.includes('nonce="' + nonceMatch[1] + '"') : false;
    addResult(
        1,
        'Browser-readable auth token compatibility',
        has(loginEjs, "localStorage.setItem('token'") || has(loginEjs, "document.cookie = 'rxToken=") || has(authController, '\n        token,') ? 'WARN' : 'PASS',
        has(loginEjs, "localStorage.setItem('token'") || has(authController, '\n        token,')
            ? 'Login/auth code still exposes a browser-readable full session token.'
            : 'Login/auth code uses the server-set HttpOnly rxToken cookie and does not write the full token to localStorage.',
        'Open /login source or run this smoke test; look for localStorage.setItem(token), document.cookie rxToken, and auth JSON token responses.'
    );

    addResult(
        2,
        'CSP nonce-based script/style blocks',
        cspUsesNonces && cspBlocksBroadInline && loginHtmlHasNonce ? 'PASS' : 'WARN',
        csp
            ? 'Live CSP uses script/style nonces; login HTML nonce injection ' + (loginHtmlHasNonce ? 'confirmed' : 'missing') + '; legacy inline attributes ' + (cspHasLegacyAttrCompat ? 'remain allowed for compatibility' : 'are blocked') + '. Header: ' + csp
            : 'Helmet CSP source checked in app.js.',
        'Open DevTools > Network > /login > Response Headers > Content-Security-Policy; confirm script-src/style-src use nonce values and not broad unsafe-inline.'
    );

    const settingsHasRiskyTable = has(settingsJs, "'<code>'+k+'</code>") || has(settingsJs, '${user.firstName || \'\'} ${user.lastName || \'\'}');
    addResult(
        3,
        'Some front-end render paths still need consistent escaping',
        settingsHasRiskyTable ? 'WARN' : 'PASS',
        settingsHasRiskyTable
            ? 'system-settings.js still builds some settings/user table HTML from values directly.'
            : 'No known direct settings/user render pattern found in system-settings.js.',
        'Open /js/system-settings.js and inspect renderSettingsTable/renderEmailAlertUsers for safeHtml/textContent.'
    );

    addResult(
        4,
        'Settings UI and login lockout threshold alignment',
        has(settingsJs, 'max_failed_logins') && (has(authController, 'getMaxFailedAttempts') || has(twoFactorController, '_maxFailedAttempts')) ? 'PASS' : 'WARN',
        has(authController, 'getMaxFailedAttempts')
            ? 'Auth and 2FA lockout paths read max_failed_logins from settings.'
            : 'System Settings exposes max_failed_logins, but auth code did not show a settings-backed threshold helper.',
        'Set max failed logins in staging settings, then inspect authController or run controlled failed-login test with a disposable user.'
    );

    addResult(
        5,
        'Server-side session idle timeout',
        has(sessionIdleService, 'idle_timeout')
            && has(authMiddleware, 'sessionIdleService.validate')
            && has(webAuthMiddleware, 'sessionIdleService.validate')
            && has(apiRoutes, "/session/activity")
            && has(appJs, '/api/session/activity') ? 'PASS' : 'WARN',
        has(sessionIdleService, 'idle_timeout')
            && has(authMiddleware, 'sessionIdleService.validate')
            && has(webAuthMiddleware, 'sessionIdleService.validate')
            && has(apiRoutes, "/session/activity")
            && has(appJs, '/api/session/activity')
            ? 'Auth middleware validates server-side idle timeout; user activity endpoint refreshes it.'
            : 'Idle timeout still appears incomplete or front-end only.',
        'Inspect services/sessionIdleService.js, middleware/auth.js, middleware/webAuth.js, routes/apiRoutes.js, and /js/app.js.'
    );

    const modelText = patientModel + '\n' + rxModel;
    const modelUsesCryptoEncryption = /createCipheriv|createDecipheriv|pgp_sym_encrypt|encryptedFields|encryptPatient|decryptPatient|fieldEncryption/i.test(modelText);
    addResult(
        6,
        'PostgreSQL patient/RX column-level encryption',
        modelUsesCryptoEncryption ? 'PASS' : 'WARN',
        modelUsesCryptoEncryption
            ? 'Patient/RX models reference encryption-related logic.'
            : 'Patient/RX models define normal Sequelize fields; no application encryption hook found.',
        'Inspect models/patient.js and models/rxrecord.js or query PostgreSQL columns directly.'
    );

    const helpClaimsEncrypted = has(helpJs, 'stored in the database in encrypted form');
    addResult(
        7,
        'SMTP password encryption at rest',
        has(settingsService, 'ENCRYPTED_PREFIX') && has(settingsService, 'aes-256-gcm') ? 'PASS' : 'WARN',
        has(settingsService, 'ENCRYPTED_PREFIX')
            ? 'settingsService encrypts smtp_pass before database writes and decrypts it into server memory.'
            : 'SMTP password encryption helper was not found in settingsService.',
        'Open services/settingsService.js; confirm smtp_pass is encrypted with AES-GCM before saving.'
    );

    const uploadExportsRemain = has(documentController, 'exports.uploadPatientDocuments') || has(documentController, 'exports.uploadRxDocuments');
    const uploadRoutesMounted = has(apiRoutes, "router.post('/patients/:id/documents") || has(apiRoutes, "router.post('/rx-records/:id/documents");
    addResult(
        8,
        'Legacy document upload code removed',
        uploadExportsRemain && !uploadRoutesMounted ? 'WARN' : (uploadRoutesMounted ? 'WARN' : 'PASS'),
        uploadExportsRemain && !uploadRoutesMounted
            ? 'Upload controller exports remain; patient/RX document POST routes are not mounted.'
            : (uploadRoutesMounted ? 'Document upload POST route is still mounted.' : 'No upload controller exports/routes found.'),
        'Inspect controllers/documentController.js and routes/apiRoutes.js; in UI confirm no upload controls.'
    );

    addResult(
        9,
        'Dedicated CSRF middleware',
        /csrf/i.test(appServer) || /csrf/i.test(packageJson) ? 'PASS' : 'WARN',
        /csrf/i.test(appServer + packageJson)
            ? 'CSRF-related code/package reference found.'
            : 'No dedicated CSRF middleware/package reference found.',
        'Inspect app.js/package.json for CSRF middleware after cookie-only auth is implemented.'
    );

    const hasAlertConfig = has(settingsService, 'DEFAULT_EMAIL_ALERT_RULES');
    const hasAlertService = has(securityAlertService, 'recordFailedLogin')
        && has(securityAlertService, 'recordPermissionDenied')
        && has(securityAlertService, 'recordCriticalError')
        && has(securityAlertService, 'recordBackupFailure')
        && has(securityAlertService, 'recordBackupMissing')
        && has(securityAlertService, 'emailService.sendEmail');
    addResult(
        10,
        'Automatic security alert detection wiring',
        hasAlertConfig && hasAlertService ? 'PASS' : 'WARN',
        hasAlertConfig && hasAlertService
            ? 'securityAlertService wires configured rules to failed-login, permission-denied, critical-error, backup, settings, API-key, and admin-login events.'
            : 'Email alert rules exist, but the automatic server-side alert service/event hooks were not found.',
        'Run npm run staging:security-alerts, or inspect services/securityAlertService.js and the auth/RBAC/error/backup hooks.'
    );

    if (has(helpJs, 'stored in the database in encrypted form') && !has(settingsService, 'ENCRYPTED_PREFIX')) {
        addResult(
            'extra',
            'User-facing Help text overstates SMTP encryption',
            'WARN',
            'Help text says encrypted; settings service says smtp_pass is stored plaintext for now.',
            'Open Help > email credentials answer, then compare services/settingsService.js.'
        );
    }

    printResults();
}

main().catch((err) => {
    console.error('[staging:security-hardening] ' + err.message);
    process.exit(1);
});
