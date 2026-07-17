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

    settings.writeSettings({ ...settings.DEFAULT_SETTINGS, serviceWindowDays: 90, callCenterLeadDays: 10 });
    assert.strictEqual(settings.getServiceWindowDays(), 90, 'Service eligibility must remain fixed at 90 days.');
    assert.strictEqual(settings.getCallCenterLeadDays(), 10, 'Call Center lead days must be persisted.');
    const eligibility = require('../utils/serviceWindowEligibility');
    assert.strictEqual(
        eligibility.evaluateServiceWindow('2026-04-02', new Date('2026-07-01T12:00:00')).eligible,
        true,
        'A patient must become service eligible on fixed day 90.'
    );
    assert.strictEqual(
        eligibility.isCallCenterCandidate('2026-04-12', new Date('2026-07-01T12:00:00')),
        true,
        'A 10-day lead must place a patient in Call Center on day 80.'
    );
    assert.strictEqual(
        eligibility.isCallCenterCandidate('2026-04-13', new Date('2026-07-01T12:00:00')),
        false,
        'A patient before day 80 must remain outside Call Center.'
    );
    assert.strictEqual(eligibility.getCallCenterThresholdDays(), 80, '90 minus a 10-day lead must equal day 80.');
    assert.strictEqual(
        eligibility.getCallCenterCutoffIso(new Date('2026-07-17T12:00:00')),
        '2026-04-28',
        'A 10-day lead on July 17 must produce an April 28 Call Queue cutoff.'
    );

    settings.writeSettings({ ...settings.DEFAULT_SETTINGS, serviceWindowDays: 75 });
    assert.strictEqual(settings.getCallCenterLeadDays(), 15, 'Legacy threshold 75 must migrate to a 15-day lead.');

    for (const invalid of [-1, 90, 366, 'invalid', null]) {
        settings.writeSettings({ ...settings.DEFAULT_SETTINGS, serviceWindowDays: 90, callCenterLeadDays: invalid });
        assert.strictEqual(
            settings.getCallCenterLeadDays(),
            10,
            `Invalid lead value ${String(invalid)} must safely fall back to 10 days.`
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
        'views/backoffice.ejs': 'sCallCenterLeadDays'
    };

    for (const [relativeFile, marker] of Object.entries(requiredWiring)) {
        const source = fs.readFileSync(path.join(__dirname, '..', relativeFile), 'utf8');
        assert(source.includes(marker), `${relativeFile} is missing configurable service-window wiring.`);
    }

    const dashboardSource = fs.readFileSync(path.join(__dirname, '..', 'controllers/dashboardController.js'), 'utf8');
    const dashboardBrowserSource = fs.readFileSync(path.join(__dirname, '..', 'public/js/dashboard.js'), 'utf8');
    assert(
        dashboardSource.includes('daysLeft <= getCallCenterLeadDays()'),
        'Dashboard pre-eligibility totals must use the configured Call Center lead value.'
    );
    assert(
        !dashboardBrowserSource.includes("setNote('eligExpiringNote', 'Active patients only, inactive excluded')"),
        'Dashboard stats refresh must not overwrite the Call Queue cutoff date.'
    );

    const callCenterSource = fs.readFileSync(path.join(__dirname, '..', 'controllers/callCenterController.js'), 'utf8');
    assert(
        callCenterSource.includes('isCallCenterCandidate(patient.serviceDate)'),
        'Call Center eligibility must use the shared 90-minus-lead evaluator.'
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

    console.log('PASS: fixed 90-day eligibility and configurable Call Center lead-window behavior.');
} finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
}
