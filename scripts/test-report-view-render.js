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
    'exportPatientRxDetailCsv',
    'exportPatientRxDetailXls',
    'rrfWorkflowStage',
    'rrfCompletedStage',
    'rrfStageFrom',
    'rrfStageTo',
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
    assert(html.includes('Complete History CSV'), 'Reports must expose the normalized complete Patient + RX history export.');
    assert(html.includes('table below stays compact for reference'), 'Reports must explain that history expansion applies to the export, not the screen.');
    assert(html.includes('Returned to Warehouse'), 'RX report must expose warehouse-return filtering.');
    assert(html.includes('Current Stage'), 'RX report must expose the current workflow stage.');
    assert(html.includes('Stage Date'), 'RX report must expose workflow stage dates.');
    assert(
        html.includes('separate Status, Date, and Completed By columns for every configured workflow step'),
        'Reports must explain that configured workflow headers remain present without completion data.'
    );
    console.log(`PASS: Reports EJS rendered with ${requiredIds.length} upgraded filter controls.`);
});
