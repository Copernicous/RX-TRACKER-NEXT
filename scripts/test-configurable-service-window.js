'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rx-service-window-'));
process.env.APP_WRITABLE_ROOT = tempRoot;

try {
    const settings = require('../utils/globalSettings');

    assert.strictEqual(settings.getServiceWindowDays(), 90, 'Missing setting must default to 90 days.');

    settings.writeSettings({ ...settings.DEFAULT_SETTINGS, serviceWindowDays: 60 });
    assert.strictEqual(settings.getServiceWindowDays(), 60, 'A valid custom window must be persisted and returned.');
    const eligibility = require('../utils/serviceWindowEligibility');
    assert.strictEqual(
        eligibility.evaluateServiceWindow('2026-04-30', new Date('2026-07-01T12:00:00')).eligible,
        true,
        'A service date older than the configured window must be eligible.'
    );
    assert.strictEqual(
        eligibility.evaluateServiceWindow('2026-05-02', new Date('2026-07-01T12:00:00')).eligible,
        true,
        'A patient must become eligible on the exact configured eligibility day.'
    );
    assert.strictEqual(
        eligibility.evaluateServiceWindow('2026-04-30', new Date('2026-07-01T12:00:00')).eligibleSince,
        '2026-06-29',
        'Eligible-since must be the exact configured eligibility day.'
    );

    settings.writeSettings({ ...settings.DEFAULT_SETTINGS, serviceWindowDays: 1 });
    assert.strictEqual(settings.getServiceWindowDays(), 1, 'The minimum supported window must be accepted.');

    settings.writeSettings({ ...settings.DEFAULT_SETTINGS, serviceWindowDays: 365 });
    assert.strictEqual(settings.getServiceWindowDays(), 365, 'The maximum supported window must be accepted.');

    for (const invalid of [0, 366, -1, 'invalid', null]) {
        settings.writeSettings({ ...settings.DEFAULT_SETTINGS, serviceWindowDays: invalid });
        assert.strictEqual(
            settings.getServiceWindowDays(),
            90,
            `Invalid value ${String(invalid)} must safely fall back to 90 days.`
        );
    }

    const requiredWiring = {
        'controllers/patientController.js': 'getServiceWindowDays',
        'controllers/rxController.js': 'getServiceWindowDays',
        'controllers/dashboardController.js': 'getServiceWindowDays',
        'controllers/callCenterController.js': 'getServiceWindowDays',
        'controllers/importController.js': 'getServiceWindowDays',
        'services/patientServiceDateCycleService.js': 'getServiceWindowDays',
        'services/snapshotService.js': 'getServiceWindowDays',
        'utils/serviceWindowEligibility.js': 'evaluateServiceWindow',
        'views/backoffice.ejs': 'sServiceWindowDays'
    };

    for (const [relativeFile, marker] of Object.entries(requiredWiring)) {
        const source = fs.readFileSync(path.join(__dirname, '..', relativeFile), 'utf8');
        assert(source.includes(marker), `${relativeFile} is missing configurable service-window wiring.`);
    }

    const callCenterSource = fs.readFileSync(path.join(__dirname, '..', 'controllers/callCenterController.js'), 'utf8');
    assert(
        callCenterSource.includes('evaluateServiceWindow(patient.serviceDate).eligible'),
        'Call Center eligibility must use the shared configured-day evaluator.'
    );
    assert(
        !callCenterSource.includes('addDaysIso(serviceDate, 91)'),
        'Call Center must not retain the old hard-coded 91-day eligible-since offset.'
    );

    const patientControllerSource = fs.readFileSync(path.join(__dirname, '..', 'controllers/patientController.js'), 'utf8');
    const patientBrowserSource = fs.readFileSync(path.join(__dirname, '..', 'public/js/patients.js'), 'utf8');
    assert(
        patientControllerSource.includes('if (patient.isActive !== true) return false;'),
        'Server-side Patient eligibility filtering must use the active-patient population.'
    );
    assert(
        patientBrowserSource.includes('if (p.isActive !== true) return false;'),
        'Browser-side Patient eligibility filtering must use the active-patient population.'
    );

    console.log('PASS: configurable service window defaults, validation fallback, persistence, and rule wiring.');
} finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
}
