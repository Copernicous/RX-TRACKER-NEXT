const express = require('express');
const router = express.Router();

router.get('/login', (req, res) => {
    res.render('login', { title: 'Login - Patient RX System' });
});

router.get('/dashboard', (req, res) => {
    res.render('dashboard', { title: 'Dashboard' });
});

// Settings - use generic CRUD view
router.get('/pharmacies', (req, res) => {
    res.render('crud', { title: 'Pharmacies Management', module: 'pharmacies', apiEndpoint: '/api/pharmacies' });
});

router.get('/patient-transport', (req, res) => {
    res.render('crud', { title: 'Patient Transport Companies', module: 'patient-transport', apiEndpoint: '/api/patient-transport' });
});

router.get('/pharmacy-transport', (req, res) => {
    res.render('crud', { title: 'Pharmacy Transport Companies', module: 'pharmacy-transport', apiEndpoint: '/api/pharmacy-transport' });
});

router.get('/users', (req, res) => {
    res.render('crud', { title: 'User Management', module: 'users', apiEndpoint: '/api/users' });
});

router.get('/roles', (req, res) => {
    res.render('roles', { title: 'Roles Management' });
});

router.get('/workflow-actions', (req, res) => {
    res.render('crud', { title: 'Workflow Actions', module: 'workflow-actions', apiEndpoint: '/api/workflow-actions' });
});

router.get('/clinics', (req, res) => {
    res.render('crud', { title: 'Clinics Management', module: 'clinics', apiEndpoint: '/api/clinics' });
});

router.get('/medication-catalog', (req, res) => {
    res.render('crud', { title: 'RX Actions', module: 'medication-catalog', apiEndpoint: '/api/medication-catalog' });
});

// Dedicated full-featured views
router.get('/patients', (req, res) => {
    res.render('patients', { title: 'Patients Management' });
});

router.get('/patients/:id/timeline', (req, res) => {
    res.render('patient-timeline', { title: 'Patient Timeline', patientId: req.params.id });
});

router.get('/rx-records', (req, res) => {
    res.render('rx-records', { title: 'RX Records' });
});

router.get('/reports', (req, res) => {
    res.render('reports', { title: 'Reports' });
});

router.get('/import', (req, res) => {
    res.render('import', { title: 'Data Import' });
});

router.get('/audit-log', (req, res) => {
    res.render('audit-log', { title: 'Audit Log' });
});

router.get('/backups', (req, res) => {
    res.render('backups', { title: 'Backup Management' });
});

router.get('/system-settings', (req, res) => {
    res.render('system-settings', { title: 'System Settings' });
});

router.get('/backoffice', (req, res) => {
    res.render('backoffice', { title: 'Back Office — Data Control Center' });
});

router.get('/', (req, res) => {
    res.redirect('/login');
});

module.exports = router;
