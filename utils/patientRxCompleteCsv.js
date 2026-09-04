'use strict';

function isoValue(value) {
    if (value === undefined || value === null || value === '') return '';
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const parsed = value instanceof Date ? value : new Date(value);
    return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

function present(value) {
    return value === undefined || value === null ? '' : value;
}

function hasRx(row) {
    return row.rxId !== undefined && row.rxId !== null && row.rxId !== '';
}

function workflowStatus(row) {
    if (!hasRx(row)) return '';
    const completed = Number(row.completedSteps || 0);
    const total = Number(row.totalWorkflowSteps || 0);
    if (total > 0 && completed >= total) return 'Completed';
    return completed > 0 ? 'In Progress' : 'Not Started';
}

const columns = [
    ['Export Schema Version', row => row.exportSchemaVersion || 1],
    ['Record Type', row => row.recordType],
    ['Record Scope', row => row.recordScope],
    ['Patient Database ID', row => row.patientDatabaseId],
    ['Patient ID', row => row.patientCode],
    ['First Name', row => row.firstName],
    ['Last Name', row => row.lastName],
    ['DOB', row => row.dob],
    ['Phone', row => row.phone],
    ['Address', row => row.address],
    ['Patient Service Date', row => row.patientServiceDate],
    ['Patient Status', row => row.patientIsActive ? 'Active' : 'Inactive'],
    ['Patient Type', row => row.isNonCompanyPatient ? 'Non-Company' : 'Company'],
    ['Patient Tags', row => row.patientTags],
    ['Patient Profile Notes', row => row.patientNotes],
    ['Patient Created At', row => isoValue(row.patientCreatedAt)],
    ['Patient Updated At', row => isoValue(row.patientUpdatedAt)],
    ['Clinic Database ID', row => row.clinicId],
    ['Clinic', row => row.clinicName],
    ['Clinic Address', row => row.clinicAddress],
    ['Clinic Phone', row => row.clinicPhone],
    ['Default Pharmacy Database ID', row => row.defaultPharmacyId],
    ['Default Pharmacy', row => row.defaultPharmacyName],
    ['Default Pharmacy Address', row => row.defaultPharmacyAddress],
    ['Default Pharmacy Phone', row => row.defaultPharmacyPhone],
    ['Default Patient Transport Database ID', row => row.defaultPatientTransportId],
    ['Default Patient Transport', row => row.defaultPatientTransport],
    ['Default Patient Transport Phone', row => row.defaultPatientTransportPhone],
    ['Default Pharmacy Transport Database ID', row => row.defaultPharmacyTransportId],
    ['Default Pharmacy Transport', row => row.defaultPharmacyTransport],
    ['Default Pharmacy Transport Phone', row => row.defaultPharmacyTransportPhone],
    ['Patient RX Row', row => hasRx(row) ? row.patientRxRow : ''],
    ['Patient RX Count', row => row.patientRxCount || 0],
    ['RX Database ID', row => hasRx(row) ? row.rxId : ''],
    ['RX #', row => hasRx(row) ? `RX-${row.rxId}` : ''],
    ['Patient Service Date Cycle ID', row => hasRx(row) ? row.patientServiceDateCycleId : ''],
    ['RX Arrival Date', row => row.rxArrivalDate],
    ['RX Service Date', row => row.rxServiceDate],
    ['RX Pharmacy Database ID', row => row.rxPharmacyId],
    ['RX Pharmacy', row => row.rxPharmacyName],
    ['RX Pharmacy Address', row => row.rxPharmacyAddress],
    ['RX Pharmacy Phone', row => row.rxPharmacyPhone],
    ['RX Patient Transport Database ID', row => row.rxPatientTransportId],
    ['RX Patient Transport', row => row.rxPatientTransport],
    ['RX Patient Transport Phone', row => row.rxPatientTransportPhone],
    ['RX Pharmacy Transport Database ID', row => row.rxPharmacyTransportId],
    ['RX Pharmacy Transport', row => row.rxPharmacyTransport],
    ['RX Pharmacy Transport Phone', row => row.rxPharmacyTransportPhone],
    ['Returned to Warehouse', row => hasRx(row) ? (row.returnedToWarehouse ? 'Yes' : 'No') : ''],
    ['Warehouse Return Date', row => isoValue(row.warehouseReturnDate)],
    ['Warehouse Return Note', row => row.warehouseReturnNote],
    ['RX Created At', row => isoValue(row.rxCreatedAt)],
    ['RX Updated At', row => isoValue(row.rxUpdatedAt)],
    ['Completed Workflow Steps', row => hasRx(row) ? row.completedSteps : ''],
    ['Total Workflow Steps', row => hasRx(row) ? row.totalWorkflowSteps : ''],
    ['Current Stage', row => row.currentStage],
    ['Current Stage Date', row => isoValue(row.currentStageDate)],
    ['Current Stage Completed By', row => row.currentStageCompletedBy],
    ['Next Pending Stage', row => row.nextPendingStage],
    ['Workflow Status', row => workflowStatus(row)],
    ['Detail Record ID', row => row.detailRecordId],
    ['Detail Definition ID', row => row.detailDefinitionId],
    ['Detail Parent ID', row => row.detailParentId],
    ['Detail Sequence', row => row.detailSequence],
    ['Detail Status', row => row.detailStatus],
    ['Detail Name', row => row.detailName],
    ['Event Date', row => isoValue(row.eventDate)],
    ['Event End Date', row => isoValue(row.eventEndDate)],
    ['Actor', row => row.actor],
    ['Previous Value', row => row.previousValue],
    ['New Value', row => row.newValue],
    ['Quantity', row => row.quantity],
    ['Source', row => row.source],
    ['Detail Notes', row => row.detailNotes],
    ['Metadata JSON', row => row.metadataJson],
    ['Detail Created At', row => isoValue(row.detailCreatedAt)],
    ['Detail Updated At', row => isoValue(row.detailUpdatedAt)],
    ['Attachment Owner Type', row => row.attachmentOwnerType],
    ['Attachment Original Name', row => row.attachmentOriginalName],
    ['Attachment Stored Name', row => row.attachmentStoredName],
    ['Attachment MIME Type', row => row.attachmentMimeType],
    ['Attachment Size Bytes', row => row.attachmentSizeBytes],
    ['Attachment Provider', row => row.attachmentProvider],
    ['Attachment External File ID', row => row.attachmentExternalFileId],
    ['Attachment Link', row => row.attachmentLink],
    ['Attachment Local Path', row => row.attachmentLocalPath],
    ['Attachment Deleted At', row => isoValue(row.attachmentDeletedAt)],
    ['Call Correlation ID', row => row.callCorrelationId],
    ['Call Direction', row => row.callDirection],
    ['Call Phone Client', row => row.callPhoneClient],
    ['Call Extension', row => row.callExtension],
    ['Call Dialed Number', row => row.callDialedNumber],
    ['Call SIP Response Code', row => row.callSipResponseCode],
    ['Call SIP Reason', row => row.callSipReason],
    ['Call Ringing At', row => isoValue(row.callRingingAt)],
    ['Call Answered At', row => isoValue(row.callAnsweredAt)],
    ['Call Ring Seconds', row => row.callRingSeconds],
    ['Call Conversation Seconds', row => row.callConversationSeconds]
];

function csvCell(value) {
    let cell = String(present(value));
    if (/^[=+\-@]/.test(cell)) cell = `'${cell}`;
    return `"${cell.replace(/"/g, '""')}"`;
}

function headerLine() {
    return columns.map(column => csvCell(column[0])).join(',');
}

function rowValues(row) {
    return columns.map(column => present(column[1](row)));
}

function rowLine(row) {
    return rowValues(row).map(csvCell).join(',');
}

module.exports = {
    headers: columns.map(column => column[0]),
    headerLine,
    rowValues,
    rowLine
};
