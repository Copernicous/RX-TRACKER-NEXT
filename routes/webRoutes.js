const express = require('express');
const router = express.Router();
const { requireMaster } = require('../middleware/rbac');
const { isCallCenterRole, hasCallCenterAccess } = require('../utils/callCenterAccess');
const { proxyRedirect } = require('../utils/proxyAwareRedirect');

function requireWebLogin(req, res, next) {
    if (res.locals && res.locals.currentUser) return next();
    return proxyRedirect(req, res, '/login');
}

function requireVisibleModule(moduleKey) {
    return (req, res, next) => {
        if (!res.locals || !res.locals.currentUser) return proxyRedirect(req, res, '/login');
        if (res.locals.isAdmin) return next();
        const perms = res.locals.userPerms || {};
        const modulePerm = perms[moduleKey] || {};
        if (modulePerm.visible === true) return next();
        return proxyRedirect(req, res, '/dashboard');
    };
}

function requireAdministratorWeb(req, res, next) {
    if (!res.locals || !res.locals.currentUser) return proxyRedirect(req, res, '/login');
    if (res.locals.isAdmin) return next();
    return proxyRedirect(req, res, '/dashboard');
}

function redirectCallCenterRole(req, res, next) {
    const user = res.locals && res.locals.currentUser;
    if (isCallCenterRole(user) && !['/call-center', '/phone-account-setup'].includes(req.path)) {
        return proxyRedirect(req, res, '/call-center');
    }
    next();
}

function requirePhoneAccountSetupAccess(req, res, next) {
    if (!res.locals || !res.locals.currentUser) return proxyRedirect(req, res, '/login');
    if (res.locals.phoneAccountSetupAllowed === true) return next();
    const target = hasCallCenterAccess(res.locals.currentUser) ? '/call-center' : '/dashboard';
    return proxyRedirect(req, res, target + '?phone_setup=unavailable');
}

function requireCallCenterPage(req, res, next) {
    const user = res.locals && res.locals.currentUser;
    if (hasCallCenterAccess(user)) return next();
    return proxyRedirect(req, res, '/dashboard');
}

function allowRxSoftphoneConnection(req, res, next) {
    const headerName = 'Content-Security-Policy';
    const current = String(res.getHeader(headerName) || '');
    const softphoneOrigin = 'http://127.0.0.1:5188';
    if (current && !current.includes(softphoneOrigin)) {
        res.setHeader(headerName, current.replace(
            "connect-src 'self'",
            "connect-src 'self' " + softphoneOrigin
        ));
    }
    next();
}

// Root → redirect to login
router.get('/', (req, res) => {
    if (res.locals && isCallCenterRole(res.locals.currentUser)) return proxyRedirect(req, res, '/call-center');
    return proxyRedirect(req, res, '/login');
});

router.get('/login', (req, res) => {
    if (res.locals && isCallCenterRole(res.locals.currentUser)) return proxyRedirect(req, res, '/call-center');
    res.render('login', { title: 'Login - Patient RX System' });
});

router.get('/call-center', requireWebLogin, requireCallCenterPage, allowRxSoftphoneConnection, (req, res) => {
    res.render('call-center', { title: 'Call Center', activePage: 'call-center' });
});

router.get('/phone-account-setup', requireWebLogin, requirePhoneAccountSetupAccess, (req, res) => {
    res.render('phone-account-setup', {
        title: 'Phone Account Setup',
        activePage: 'phone-account-setup',
        setupSuccessPath: hasCallCenterAccess(res.locals.currentUser) ? '/call-center' : '/dashboard'
    });
});

router.use(redirectCallCenterRole);

router.get('/dashboard', requireWebLogin, (req, res) => {
    res.render('dashboard', { title: 'Dashboard', activePage: 'dashboard' });
});

// Reference Data — crud view
router.get('/pharmacies', requireWebLogin, (req, res) => {
    res.render('crud', { title: 'Pharmacies', module: 'pharmacies', apiEndpoint: '/api/pharmacies', activePage: 'pharmacies' });
});

router.get('/patient-transport', requireWebLogin, (req, res) => {
    res.render('crud', { title: 'Patient Transport Companies', module: 'patient-transport', apiEndpoint: '/api/patient-transport', activePage: 'patient-transport' });
});

router.get('/pharmacy-transport', requireWebLogin, (req, res) => {
    res.render('crud', { title: 'Pharmacy Transport Companies', module: 'pharmacy-transport', apiEndpoint: '/api/pharmacy-transport', activePage: 'pharmacy-transport' });
});

router.get('/clinics', requireWebLogin, (req, res) => {
    res.render('crud', { title: 'Clinics', module: 'clinics', apiEndpoint: '/api/clinics', activePage: 'clinics' });
});

// Administration — crud view
router.get('/users', requireWebLogin, (req, res) => {
    res.render('crud', { title: 'User Management', module: 'users', apiEndpoint: '/api/users', activePage: 'users' });
});

router.get('/roles', requireWebLogin, requireVisibleModule('users'), (req, res) => {
    res.render('roles', { title: 'Roles Management', activePage: 'roles' });
});

router.get('/softphone-devices', requireWebLogin, requireAdministratorWeb, (req, res) => {
    res.render('softphone-devices', { title: 'RX Softphone Devices', activePage: 'softphone-devices' });
});

router.get('/live-rx-phones', requireWebLogin, requireAdministratorWeb, (req, res) => {
    res.render('live-rx-phones', { title: 'Live RX Phones', activePage: 'live-rx-phones' });
});

router.get('/workflow-actions', requireWebLogin, (req, res) => {
    res.render('crud', { title: 'Workflow Actions', module: 'workflow-actions', apiEndpoint: '/api/workflow-actions', activePage: 'workflow-actions' });
});

router.get('/medication-catalog', requireWebLogin, (req, res) => {
    res.render('crud', { title: 'RX Actions', module: 'medication-catalog', apiEndpoint: '/api/medication-catalog', activePage: 'medication-catalog' });
});

// Dedicated full-featured views
router.get('/patients', requireWebLogin, (req, res) => {
    res.render('patients', { title: 'Patients Management', activePage: 'patients' });
});

router.get('/patients/:id/timeline', requireWebLogin, (req, res) => {
    res.render('patient-timeline', { title: 'Patient Timeline', patientId: req.params.id, activePage: 'patients' });
});

router.get('/rx-records', requireWebLogin, (req, res) => {
    res.render('rx-records', { title: 'RX Records', activePage: 'rx-records' });
});

router.get('/reports', requireWebLogin, (req, res) => {
    res.render('reports', { title: 'Reports', activePage: 'reports' });
});

router.get('/import', requireWebLogin, (req, res) => {
    res.render('import', { title: 'Data Import', activePage: 'import' });
});

router.get('/audit-log', requireWebLogin, (req, res) => {
    res.render('audit-log', { title: 'Audit Log', activePage: 'audit-log' });
});

router.get('/backups', requireWebLogin, (req, res) => {
    res.render('backups', { title: 'Backup Management', activePage: 'backups' });
});

router.get('/system-settings', requireWebLogin, (req, res) => {
    res.render('system-settings', { title: 'System Settings', activePage: 'system-settings' });
});

// Back Office — MASTER admin only. isMaster must be true in the DB (set via SQL only).
router.get('/backoffice', requireWebLogin, requireMaster, (req, res) => {
    res.render('backoffice', { title: 'Back Office — Data Control Center', activePage: 'backoffice' });
});

router.get('/active-users', requireWebLogin, (req, res) => {
    res.render('active-users', { title: 'Active Users — Who\'s Online', activePage: 'active-users' });
});

// Changelog page — reads CHANGELOG.md and renders it
router.get('/changelog', requireWebLogin, (req, res) => {
    const fs   = require('fs');
    const path = require('path');
    const IS_PKG = typeof process.pkg !== 'undefined';
    const root   = IS_PKG ? path.dirname(process.execPath) : path.join(__dirname, '..');
    const mdPath = path.join(root, 'CHANGELOG.md');
    let markdown = '';
    try { markdown = fs.readFileSync(mdPath, 'utf8'); } catch {}
    res.render('changelog', { title: 'Changelog', activePage: 'changelog', markdown });
});

module.exports = router;

