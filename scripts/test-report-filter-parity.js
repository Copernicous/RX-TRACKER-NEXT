'use strict';

const assert = require('assert');
const { prepareStagingEnv } = require('./lib/staging-env');

const explicitDatabase = String(process.env.REPORT_FILTER_TEST_DB_NAME || '').trim();
if (explicitDatabase) {
    process.env.DB_NAME = explicitDatabase;
} else {
    const staging = prepareStagingEnv();
    process.env.DB_NAME = staging.dbName;
}
if (!/(staging|stage|qa|test|sandbox|copy)/i.test(String(process.env.DB_NAME || ''))) {
    throw new Error(`Refusing report regression on non-test database "${process.env.DB_NAME || ''}".`);
}

const db = require('../models');
const reportController = require('../controllers/reportController');
const patientRxCompleteCsv = require('../utils/patientRxCompleteCsv');

const marker = `REPORT${Date.now()}`;
const created = {
    patientIds: [],
    rxIds: [],
    trackingIds: [],
    medicationIds: [],
    rxHistoryIds: [],
    patientNoteIds: [],
    documentIds: [],
    callAttemptIds: [],
    clinicIds: [],
    pharmacyIds: [],
    patientTransportIds: [],
    pharmacyTransportIds: []
};

function runHandler(handler, query) {
    return new Promise((resolve, reject) => {
        const res = {
            statusCode: 200,
            status(code) {
                this.statusCode = code;
                return this;
            },
            json(payload) {
                resolve({ status: this.statusCode, payload });
            },
            send(payload) {
                resolve({ status: this.statusCode, payload });
            }
        };
        Promise.resolve(handler({ query, user: { role: 'Administrator', roleId: 1 } }, res)).catch(reject);
    });
}

async function patientRows(filters) {
    const result = await runHandler(reportController.getPatientReport, {
        paginated: 'true',
        page: '1',
        pageSize: '50',
        sort: 'firstName',
        dir: 'asc',
        lastName: marker,
        ...filters
    });
    assert.strictEqual(result.status, 200, result.payload.error || 'Patient report failed');
    return result.payload.rows;
}

async function rxRows(filters) {
    const result = await runHandler(reportController.getRXActionReport, {
        paginated: 'true',
        page: '1',
        pageSize: '50',
        sort: 'id',
        dir: 'asc',
        lastName: marker,
        ...filters
    });
    assert.strictEqual(result.status, 200, result.payload.error || 'RX report failed');
    return result.payload.rows;
}

async function patientRxDetailRows(filters) {
    const result = await runHandler(reportController.getPatientRxDetailReport, {
        lastName: marker,
        ...filters
    });
    assert.strictEqual(result.status, 200, result.payload.error || 'Patient + RX detail report failed');
    return result.payload.rows;
}

async function patientRxCompleteRows(filters) {
    const result = await runHandler(reportController.getPatientRxDetailReport, {
        lastName: marker,
        completeHistory: 'true',
        ...filters
    });
    assert.strictEqual(result.status, 200, result.payload.error || 'Complete Patient + RX history report failed');
    return result.payload.rows;
}

async function cleanup() {
    if (created.callAttemptIds.length) {
        await db.CallCenterCallAttempt.destroy({ where: { id: created.callAttemptIds } }).catch(() => {});
    }
    if (created.documentIds.length) {
        await db.DocumentAttachment.destroy({ where: { id: created.documentIds }, force: true }).catch(() => {});
    }
    if (created.patientNoteIds.length) {
        await db.PatientNote.destroy({ where: { id: created.patientNoteIds } }).catch(() => {});
    }
    if (created.rxHistoryIds.length) {
        await db.RXHistory.destroy({ where: { id: created.rxHistoryIds } }).catch(() => {});
    }
    if (created.medicationIds.length) {
        await db.Medication.destroy({ where: { id: created.medicationIds } }).catch(() => {});
    }
    if (created.trackingIds.length) {
        await db.RXWorkflowTracking.destroy({ where: { id: created.trackingIds } }).catch(() => {});
    }
    if (created.rxIds.length) {
        await db.RXRecord.destroy({ where: { id: created.rxIds } }).catch(() => {});
    }
    if (created.patientIds.length) {
        await db.PatientServiceDateHistory.destroy({ where: { patientId: created.patientIds } }).catch(() => {});
        await db.PatientServiceDateCycle.destroy({ where: { patientId: created.patientIds } }).catch(() => {});
        await db.Patient.destroy({ where: { id: created.patientIds } }).catch(() => {});
    }
    if (created.clinicIds.length) await db.Clinic.destroy({ where: { id: created.clinicIds } }).catch(() => {});
    if (created.pharmacyIds.length) await db.Pharmacy.destroy({ where: { id: created.pharmacyIds } }).catch(() => {});
    if (created.patientTransportIds.length) {
        await db.PatientTransportCompany.destroy({ where: { id: created.patientTransportIds } }).catch(() => {});
    }
    if (created.pharmacyTransportIds.length) {
        await db.PharmacyTransportCompany.destroy({ where: { id: created.pharmacyTransportIds } }).catch(() => {});
    }
}

async function createFixtures() {
    const [clinicA, clinicB] = await Promise.all([
        db.Clinic.create({ name: `${marker} Clinic A`, isActive: true }),
        db.Clinic.create({ name: `${marker} Clinic B`, isActive: true })
    ]);
    created.clinicIds.push(clinicA.id, clinicB.id);
    const [pharmacyA, pharmacyB] = await Promise.all([
        db.Pharmacy.create({ name: `${marker} Pharmacy A`, isActive: true }),
        db.Pharmacy.create({ name: `${marker} Pharmacy B`, isActive: true })
    ]);
    created.pharmacyIds.push(pharmacyA.id, pharmacyB.id);
    const [patientTransport, pharmacyTransport] = await Promise.all([
        db.PatientTransportCompany.create({ companyName: `${marker} Patient Transport`, isActive: true }),
        db.PharmacyTransportCompany.create({ companyName: `${marker} Pharmacy Transport`, isActive: true })
    ]);
    created.patientTransportIds.push(patientTransport.id);
    created.pharmacyTransportIds.push(pharmacyTransport.id);

    const patients = await db.Patient.bulkCreate([
        {
            firstName: 'COMPLETE',
            lastName: marker,
            dob: '1980-01-01',
            patientCode: `${marker}-COMPLETE`,
            phone: '555-1001',
            serviceDate: '2020-01-01',
            clinicId: clinicA.id,
            pharmacyId: pharmacyA.id,
            patientTransportCompanyId: patientTransport.id,
            pharmacyTransportCompanyId: pharmacyTransport.id,
            isActive: true,
            isNonCompanyPatient: false,
            isDeleted: false
        },
        {
            firstName: 'EXPIRED',
            lastName: marker,
            dob: '1981-02-02',
            patientCode: `${marker}-EXPIRED`,
            phone: '555-1002',
            serviceDate: '2020-02-01',
            clinicId: clinicB.id,
            pharmacyId: pharmacyB.id,
            patientTransportCompanyId: patientTransport.id,
            pharmacyTransportCompanyId: pharmacyTransport.id,
            isActive: true,
            isNonCompanyPatient: true,
            isDeleted: false
        },
        {
            firstName: 'MISSING',
            lastName: marker,
            dob: '1982-03-03',
            patientCode: `${marker}-MISSING`,
            phone: '555-1003',
            serviceDate: null,
            clinicId: null,
            pharmacyId: null,
            patientTransportCompanyId: null,
            pharmacyTransportCompanyId: null,
            isActive: true,
            isNonCompanyPatient: false,
            isDeleted: false
        }
    ], { returning: true });
    created.patientIds.push(...patients.map(row => row.id));

    const today = new Date().toISOString().slice(0, 10);
    const rxRows = await db.RXRecord.bulkCreate([
        {
            patientId: patients[0].id,
            arrivalDate: '2026-01-10',
            serviceDate: patients[0].serviceDate,
            pharmacyId: pharmacyA.id,
            patientTransportCompanyId: patientTransport.id,
            pharmacyTransportCompanyId: pharmacyTransport.id,
            returnedToWarehouse: true,
            warehouseReturnDate: new Date(),
            warehouseReturnNote: marker,
            isDeleted: false
        },
        {
            patientId: patients[1].id,
            arrivalDate: '2026-02-10',
            serviceDate: patients[1].serviceDate,
            pharmacyId: pharmacyB.id,
            patientTransportCompanyId: patientTransport.id,
            pharmacyTransportCompanyId: pharmacyTransport.id,
            returnedToWarehouse: false,
            isDeleted: false
        },
        {
            patientId: patients[1].id,
            arrivalDate: '2026-03-10',
            serviceDate: today,
            pharmacyId: pharmacyB.id,
            patientTransportCompanyId: patientTransport.id,
            pharmacyTransportCompanyId: pharmacyTransport.id,
            returnedToWarehouse: false,
            isDeleted: false
        }
    ], { returning: true });
    created.rxIds.push(...rxRows.map(row => row.id));

    const actions = await db.WorkflowAction.findAll({
        where: { isActive: true },
        order: [['sequenceNumber', 'ASC'], ['id', 'ASC']]
    });
    assert(actions.length >= 2, 'Report parity regression requires at least two active workflow actions.');
    const trackingRows = [
        ...actions.map(action => ({
            rxRecordId: rxRows[0].id,
            workflowActionId: action.id,
            completionDate: new Date('2026-04-10T14:30:00Z')
        })),
        {
            rxRecordId: rxRows[1].id,
            workflowActionId: actions[0].id,
            completionDate: new Date('2026-05-15T15:45:00Z')
        }
    ];
    const createdTrackings = await db.RXWorkflowTracking.bulkCreate(trackingRows, { returning: true });
    created.trackingIds.push(...createdTrackings.map(row => row.id));

    const medication = await db.Medication.create({
        rxRecordId: rxRows[0].id,
        name: `${marker} Medication`,
        quantity: 30,
        notes: 'Complete transfer medication'
    });
    created.medicationIds.push(medication.id);
    const rxHistory = await db.RXHistory.create({
        rxRecordId: rxRows[0].id,
        changeType: 'Update',
        snapshot: JSON.stringify({ serviceDate: '2020-01-01' }),
        changedFields: JSON.stringify([{ field: 'serviceDate', from: '2019-01-01', to: '2020-01-01' }]),
        note: 'Complete transfer RX history'
    });
    created.rxHistoryIds.push(rxHistory.id);
    const patientNote = await db.PatientNote.create({
        patientId: patients[0].id,
        note: 'Complete transfer patient note',
        source: 'Report regression'
    });
    created.patientNoteIds.push(patientNote.id);
    await db.PatientServiceDateHistory.create({
        patientId: patients[0].id,
        previousServiceDate: '2019-01-01',
        newServiceDate: patients[0].serviceDate,
        changeSource: 'Report regression',
        reason: 'Complete transfer service-date history',
        metadata: { marker }
    });
    await db.PatientServiceDateCycle.create({
        patientId: patients[0].id,
        serviceDate: patients[0].serviceDate,
        status: 'historical',
        source: 'Report regression',
        startedAt: new Date('2020-01-01T12:00:00Z'),
        endedAt: new Date('2020-03-31T12:00:00Z'),
        metadata: { marker }
    });
    const patientDocument = await db.DocumentAttachment.create({
        ownerType: 'patient',
        patientId: patients[0].id,
        originalName: `${marker}-patient.pdf`,
        storedName: `${marker}-patient-stored.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: 321,
        provider: 'local',
        localPath: `test/${marker}-patient-stored.pdf`
    });
    const rxDocument = await db.DocumentAttachment.create({
        ownerType: 'rx',
        patientId: patients[0].id,
        rxRecordId: rxRows[0].id,
        originalName: `${marker}-rx.pdf`,
        storedName: `${marker}-rx-stored.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: 654,
        provider: 'local',
        localPath: `test/${marker}-rx-stored.pdf`
    });
    created.documentIds.push(patientDocument.id, rxDocument.id);
    const callAttempt = await db.CallCenterCallAttempt.create({
        patientId: patients[0].id,
        correlationId: `${marker}-call`,
        phoneClient: 'rx_softphone',
        direction: 'outbound',
        state: 'ended',
        outcome: 'answered',
        patientCode: patients[0].patientCode,
        patientName: `${patients[0].firstName} ${patients[0].lastName}`,
        clinicName: clinicA.name,
        agentName: 'Report Regression',
        extension: '9001',
        dialedNumber: patients[0].phone,
        sipResponseCode: 200,
        sipReason: 'OK',
        dialedAt: new Date('2026-06-01T14:00:00Z'),
        ringingAt: new Date('2026-06-01T14:00:02Z'),
        answeredAt: new Date('2026-06-01T14:00:05Z'),
        endedAt: new Date('2026-06-01T14:01:05Z'),
        ringDurationSeconds: 5,
        conversationDurationSeconds: 60
    });
    created.callAttemptIds.push(callAttempt.id);

    return { clinicA, clinicB, pharmacyA, pharmacyB, patientTransport, pharmacyTransport, actions };
}

async function main() {
    await db.sequelize.authenticate();
    const refs = await createFixtures();

    assert.deepStrictEqual((await patientRows({ dob: '1981-02-02' })).map(row => row.firstName), ['EXPIRED']);
    assert.deepStrictEqual((await patientRows({ patientType: 'non_company' })).map(row => row.firstName), ['EXPIRED']);
    assert.deepStrictEqual((await patientRows({ missingInfo: 'all' })).map(row => row.firstName), ['MISSING']);
    assert.deepStrictEqual((await patientRows({ rxStatus: 'no_rx' })).map(row => row.firstName), ['MISSING']);
    assert.deepStrictEqual((await patientRows({ clinicId: refs.clinicA.id })).map(row => row.firstName), ['COMPLETE']);
    assert.deepStrictEqual((await patientRows({ pharmacyId: refs.pharmacyB.id })).map(row => row.firstName), ['EXPIRED']);
    assert.deepStrictEqual((await patientRows({ eligibility: 'needsAction' })).map(row => row.firstName), ['EXPIRED']);

    assert.strictEqual((await rxRows({ pharmacyId: refs.pharmacyA.id })).length, 1);
    assert.strictEqual((await rxRows({ clinicId: refs.clinicB.id })).length, 2);
    assert.strictEqual((await rxRows({ patientType: 'non_company' })).length, 2);
    assert.strictEqual((await rxRows({ warehouseStatus: 'returned' })).length, 1);
    assert.strictEqual((await rxRows({ workflowStatus: 'completed' })).length, 1);
    assert.strictEqual((await rxRows({ workflowStatus: 'expired' })).length, 1);
    assert.strictEqual((await rxRows({ workflowStatus: 'not-started' })).length, 1);
    assert.strictEqual((await rxRows({ workflowStage: '1' })).length, 1);
    assert.strictEqual((await rxRows({ workflowStage: '2' })).length, 1);
    assert.strictEqual((await rxRows({ currentWorkflowStage: String(refs.actions[0].sequenceNumber) })).length, 1);
    assert.strictEqual((await rxRows({
        currentWorkflowStage: String(refs.actions[refs.actions.length - 1].sequenceNumber)
    })).length, 1);
    assert.strictEqual((await rxRows({ completedStageId: refs.actions[0].id })).length, 2);
    assert.strictEqual((await rxRows({ stageFrom: '2026-05-01', stageTo: '2026-05-31' })).length, 1);
    assert.strictEqual((await rxRows({
        completedStageId: refs.actions[1].id,
        stageFrom: '2026-05-01',
        stageTo: '2026-05-31'
    })).length, 0);
    assert.strictEqual((await rxRows({ arrivalFrom: '2026-02-01', arrivalTo: '2026-02-28' })).length, 1);
    assert.strictEqual((await rxRows({ patientTransportId: refs.patientTransport.id })).length, 3);
    assert.strictEqual((await rxRows({ pharmacyTransportId: refs.pharmacyTransport.id })).length, 3);

    const stagedRows = await rxRows({ pharmacyId: refs.pharmacyA.id });
    assert.strictEqual(stagedRows[0].stageHistory.length, refs.actions.length);
    assert.strictEqual(stagedRows[0].currentStage.stage, refs.actions[refs.actions.length - 1].name);
    assert.strictEqual(stagedRows[0].currentStage.completedBy, 'System');

    const fullRows = await patientRxDetailRows({});
    assert.strictEqual(fullRows.length, 4, 'Full transfer export must create one row per RX plus one blank-RX patient row.');
    assert.strictEqual(fullRows.filter(row => row.firstName === 'EXPIRED').length, 2, 'A patient with two RX records must repeat on two vertical rows.');
    const noRxRow = fullRows.find(row => row.firstName === 'MISSING');
    assert(noRxRow, 'Full transfer export must retain patients without RX records.');
    assert.strictEqual(noRxRow.rxId, null);
    const completeExport = fullRows.find(row => row.firstName === 'COMPLETE');
    assert(completeExport.workflowStageHistory.includes(refs.actions[0].name));
    assert(Array.isArray(completeExport.workflowStageDetails), 'Summary transfer rows must expose structured workflow columns.');
    assert.strictEqual(
        completeExport.workflowStageDetails.length,
        refs.actions.length,
        'Summary transfer rows must expose every completed workflow step separately.'
    );
    assert(completeExport.workflowStageDetails.every(stage =>
        stage.workflowActionId
        && stage.stage
        && stage.completionDate
    ), 'Structured workflow steps must preserve action identity, stage name, and completion date.');
    assert.strictEqual(completeExport.currentStage, refs.actions[refs.actions.length - 1].name);

    const completeHistory = await patientRxCompleteRows({});
    const recordTypes = new Set(completeHistory.map(row => row.recordType));
    [
        'PATIENT_RX',
        'WORKFLOW_STEP',
        'MEDICATION',
        'RX_CHANGE_HISTORY',
        'PATIENT_NOTE',
        'SERVICE_DATE_HISTORY',
        'SERVICE_DATE_CYCLE',
        'DOCUMENT_ATTACHMENT',
        'CALL_ATTEMPT'
    ].forEach(type => assert(recordTypes.has(type), `Complete history export is missing ${type}.`));
    assert.strictEqual(
        completeHistory.filter(row => row.recordType === 'PATIENT_RX').length,
        4,
        'Complete history export must retain one summary row per RX plus the patient without RX.'
    );
    const completedWorkflowRows = completeHistory.filter(row =>
        row.recordType === 'WORKFLOW_STEP'
        && row.rxId === completeExport.rxId
        && row.detailStatus === 'Completed'
    );
    assert.strictEqual(completedWorkflowRows.length, refs.actions.length, 'Every completed workflow step must be a separate row.');
    assert(completedWorkflowRows.every(row =>
        row.detailDefinitionId
        && row.detailName
        && row.detailSequence
        && row.eventDate
    ), 'Every completed workflow step must retain action identity, order, and completion date.');
    const pendingWorkflowRows = completeHistory.filter(row =>
        row.recordType === 'WORKFLOW_STEP'
        && row.detailStatus === 'Pending'
    );
    assert(pendingWorkflowRows.length >= refs.actions.length, 'Uncompleted workflow steps must remain visible as pending rows.');
    assert(completeHistory.every(row => row.exportSchemaVersion === 1), 'Every complete-history row must carry the export schema version.');
    assert(completeHistory.every(row => row.patientDatabaseId), 'Every patient-related complete-history row must retain its patient database ID.');
    assert(completeHistory.some(row =>
        row.recordType === 'DOCUMENT_ATTACHMENT'
        && row.recordScope === 'RX'
        && row.attachmentOriginalName === `${marker}-rx.pdf`
    ), 'RX document metadata must retain its RX scope and original filename.');
    assert(completeHistory.some(row =>
        row.recordType === 'CALL_ATTEMPT'
        && row.callSipResponseCode === 200
        && row.callConversationSeconds === 60
    ), 'Call attempt timing and SIP result must remain in the complete history export.');
    completeHistory.forEach(row => {
        assert.strictEqual(
            patientRxCompleteCsv.rowValues(row).length,
            patientRxCompleteCsv.headers.length,
            `CSV ${row.recordType} row must match the fixed header count.`
        );
    });
    assert(patientRxCompleteCsv.headers.includes('Event Date'), 'Complete CSV must expose the workflow/event date column.');
    assert(patientRxCompleteCsv.rowLine({
        exportSchemaVersion: 1,
        recordType: 'PATIENT_NOTE',
        detailNotes: '=unsafe-spreadsheet-formula'
    }).includes("'=unsafe-spreadsheet-formula"), 'CSV cells must neutralize spreadsheet formulas.');

    console.log('PASS: Patient/RX filters, stage dates, compact reference rows, and normalized complete-history records match operational dimensions.');
}

main()
    .catch(error => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await cleanup();
        await db.sequelize.close();
    });
