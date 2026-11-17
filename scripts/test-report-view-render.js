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
    'rrfCurrentWorkflowStage',
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
    assert(!html.includes('id="sdrForm"'), 'Validation now belongs to Patients.');
    assert(html.includes('Default Pharmacy'), 'Patient report must expose the default-pharmacy dimension.');
    assert(html.includes('Complete History CSV'), 'Reports must expose the normalized complete Patient + RX history export.');
    assert(html.includes('table below stays compact for reference'), 'Reports must explain that history expansion applies to the export, not the screen.');
    assert(html.includes('Returned to Warehouse'), 'RX report must expose warehouse-return filtering.');
    assert(html.includes('Current Stage'), 'RX report must expose the current workflow stage.');
    assert(html.includes('Current Stage Date'), 'RX report must expose the current workflow stage date.');
    assert(html.includes('Next Action Required'), 'RX report must name the next operational action explicitly.');
    assert(html.includes('History Includes Action'), 'RX report must distinguish historical completion from current stage.');
    assert(!html.includes('Next Pending Stage'), 'RX report must not retain the misleading Next Pending Stage label.');
    assert(!html.includes('Completed Stage'), 'RX report must not present historical completion as the current stage.');
    assert(
        html.includes('separate Status, Date, and Completed By columns for every configured workflow step'),
        'Reports must explain that configured workflow headers remain present without completion data.'
    );
    console.log(`PASS: Reports EJS rendered with ${requiredIds.length} upgraded filter controls.`);
});

ejs.renderFile(path.resolve(__dirname, '../views/patients.ejs'), {
    cspNonce: 'patient-validation-render',
    serviceWindowDays: 90,
    locals: { userPerms: null, isAdmin: true, currentUser: { role: 'Administrator' },
        callCenterLeadDays: 10, activePage: 'patients', isStaging: true, appBuild: 'validation-render', phoneAccountSetupAllowed: false }
}, (error, html) => {
    if (error) throw error;
    for (const id of ['serviceDateValidationBtn', 'serviceDateValidationModal', 'sdrForm', 'sdrBody', 'sdrExport',
        'sdrClinic', 'sdrPharmacy', 'sdrLastRxFrom', 'sdrLastRxTo', 'sdrLastRxStatus', 'sdrStatsPanel', 'sdrPatientStatus',
        'sdrRxHistory', 'sdrCoverage', 'sdrPageSize', 'sdrFirst', 'sdrLast', 'sdrPageJump', 'sdrFilterChips', 'sdrDetails',
        'sdrDetailsPatient', 'sdrDetailsDate', 'sdrDetailsDates', 'sdrDetailsDone']) {
        assert(html.includes(`id="${id}"`), 'Patients validation is missing #' + id);
    }
    assert(html.includes('Last RX service date'));
    assert(html.includes('modal-fullscreen'));
    assert.equal((html.match(/data-sdr-sort=/g) || []).length, 11);
    assert(html.indexOf('id="sdrPageSize"') < html.indexOf('id="sdrBody"'), 'Pagination is above detail rows');
    assert(html.includes('value="1000"'));
    assert(html.includes('In current list'));
    console.log('PASS: Patients EJS exposes validation with clinic/pharmacy and last-RX filters.');
});
