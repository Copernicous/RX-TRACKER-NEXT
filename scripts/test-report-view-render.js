'use strict';

const assert = require('assert');
const path = require('path');
const ejs = require('ejs');

const reportView = path.resolve(__dirname, '..', 'views', 'reports.ejs');
const requiredIds = [
    'prfEligibility',
    'prfMissingInfo',
    'prfRxStatus',
    'prfClinicId',
    'prfPharmacyId',
    'prfPatientTransportId',
    'prfPharmacyTransportId',
    'rrfWorkflowStage',
    'rrfWarehouseStatus',
    'rrfArrivalFrom',
    'rrfArrivalTo',
    'patientReportBody',
    'rxActionBody'
];

ejs.renderFile(reportView, {
    cspNonce: 'report-render-regression',
    locals: {
        userPerms: null,
        isAdmin: true,
        currentUser: { role: 'Administrator' },
        callCenterLeadDays: 10,
        activePage: 'reports',
        isStaging: true,
        appBuild: 'report-render-regression',
        phoneAccountSetupAllowed: false
    }
}, (error, html) => {
    if (error) throw error;
    requiredIds.forEach(id => {
        assert(html.includes(`id="${id}"`), `Rendered report is missing #${id}.`);
    });
    assert(html.includes('Default Pharmacy'), 'Patient report must expose the default-pharmacy dimension.');
    assert(html.includes('Returned to Warehouse'), 'RX report must expose warehouse-return filtering.');
    console.log(`PASS: Reports EJS rendered with ${requiredIds.length} upgraded filter controls.`);
});
