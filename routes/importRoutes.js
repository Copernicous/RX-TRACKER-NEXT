const express = require('express');
const router = express.Router();
const multer = require('multer');
const auth = require('../middleware/auth');
const rbac = require('../middleware/rbac');
const importController = require('../controllers/importController');

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: function(req, file, cb) {
        var allowed = ['text/csv', 'application/vnd.ms-excel', 'text/plain', 'application/octet-stream'];
        var ext = (file.originalname || '').toLowerCase().split('.').pop();
        if (allowed.indexOf(file.mimetype) !== -1 || ext === 'csv') {
            cb(null, true);
        } else {
            cb(new Error('Only CSV files are allowed. Received: ' + file.mimetype));
        }
    }
});

// Require authentication for all endpoints
router.use(auth);

// Template downloads
router.get('/template/:dataset', importController.getTemplate);

// Correction-file records are separate from the existing completed import history.
router.get('/patient-corrections', rbac.requirePermission('import', 'read'), importController.listCorrectionFiles);
router.get('/patient-corrections/:id/original-file', rbac.requirePermission('import', 'read'), rbac.requirePermission('import', 'export'), importController.downloadCorrectionOriginalFile);
router.get('/patient-corrections/:id', rbac.requirePermission('import', 'read'), rbac.requirePermission('import', 'export'), importController.getCorrectionFile);
router.post('/patient-corrections', rbac.requirePermission('import', 'write'), upload.single('file'), importController.saveCorrectionFile);

// Import execution
router.get('/patient-reports', rbac.requirePermission('import', 'read'), importController.listPatientReports);
router.get('/patient-reports/:id/original-file', rbac.requirePermission('import', 'read'), rbac.requirePermission('import', 'export'), importController.downloadOriginalSourceFile);
router.get('/patient-reports/:id/uploaded-file', rbac.requirePermission('import', 'read'), rbac.requirePermission('import', 'export'), importController.downloadUploadedFile);
router.get('/patient-reports/:id', rbac.requirePermission('import', 'read'), importController.getPatientReport);
router.post('/:dataset', rbac.requirePermission('import', 'write'), upload.single('file'), importController.importDataset);

module.exports = router;
