const express = require('express');
const router = express.Router();

router.get('/login', (req, res) => {
    res.render('login', { title: 'Login - Patient RX System' });
});

router.get('/dashboard', (req, res) => {
    res.render('dashboard', { title: 'Dashboard', activePage: 'dashboard' });
});

// Reference Data — crud view
router.get('/pharmacies', (req, res) => {
    res.render('crud', { title: 'Pharmacies', module: 'pharmacies', apiEndpoint: '/api/pharmacies', activePage: 'pharmacies' });
});

router.get('/patient-transport', (req, res) => {
    res.render('crud', { title: 'Patient Transport Companies', module: 'patient-transport', apiEndpoint: '/api/patient-transport', activePage: 'patient-transport' });
});

router.get('/pharmacy-transport', (req, res) => {
    res.render('crud', { title: 'Pharmacy Transport Companies', module: 'pharmacy-transport', apiEndpoint: '/api/pharmacy-transport', activePage: 'pharmacy-transport' });
});

router.get('/clinics', (req, res) => {
    res.render('crud', { title: 'Clinics', module: 'clinics', apiEndpoint: '/api/clinics', activePage: 'clinics' });
});

// Administration — crud view
router.get('/users', (req, res) => {
    res.render('crud', { title: 'User Management', module: 'users', apiEndpoint: '/api/users', activePage: 'users' });
});

router.get('/roles', (req, res) => {
    res.render('roles', { title: 'Roles Management', activePage: 'roles' });
});

router.get('/workflow-actions', (req, res) => {
    res.render('crud', { title: 'Workflow Actions', module: 'workflow-actions', apiEndpoint: '/api/workflow-actions', activePage: 'workflow-actions' });
});

router.get('/medication-catalog', (req, res) => {
    res.render('crud', { title: 'RX Actions', module: 'medication-catalog', apiEndpoint: '/api/medication-catalog', activePage: 'medication-catalog' });
});

// Dedicated full-featured views
router.get('/patients', (req, res) => {
    res.render('patients', { title: 'Patients Management', activePage: 'patients' });
});

router.get('/patients/:id/timeline', (req, res) => {
    res.render('patient-timeline', { title: 'Patient Timeline', patientId: req.params.id, activePage: 'patients' });
});

router.get('/rx-records', (req, res) => {
    res.render('rx-records', { title: 'RX Records', activePage: 'rx-records' });
});

router.get('/reports', (req, res) => {
    res.render('reports', { title: 'Reports', activePage: 'reports' });
});

router.get('/import', (req, res) => {
    res.render('import', { title: 'Data Import', activePage: 'import' });
});

router.get('/audit-log', (req, res) => {
    res.render('audit-log', { title: 'Audit Log', activePage: 'audit-log' });
});

router.get('/backups', (req, res) => {
    res.render('backups', { title: 'Backup Management', activePage: 'backups' });
});

router.get('/system-settings', (req, res) => {
    res.render('system-settings', { title: 'System Settings', activePage: 'system-settings' });
});

router.get('/backoffice', (req, res) => {
    res.render('backoffice', { title: 'Back Office — Data Control Center', activePage: 'backoffice' });
});

module.exports = router;
