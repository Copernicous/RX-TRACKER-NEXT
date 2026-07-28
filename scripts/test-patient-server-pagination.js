'use strict';

const assert = require('assert');
const { Op } = require('sequelize');

const explicitDatabase = String(process.env.PATIENT_PAGINATION_TEST_DB_NAME || '').trim();
if (explicitDatabase) process.env.DB_NAME = explicitDatabase;
const confirmedDatabase = String(process.env.PATIENT_PAGINATION_TEST_CONFIRM_DB_NAME || '').trim();
const safeDatabaseTokens = new Set(['staging', 'stage', 'qa', 'test', 'sandbox']);
const databaseTokens = String(process.env.DB_NAME || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
if (!databaseTokens.some(token => safeDatabaseTokens.has(token))) {
    throw new Error('Refusing patient pagination regression on a non-test database.');
}
if (!confirmedDatabase || confirmedDatabase !== String(process.env.DB_NAME || '')) {
    throw new Error(
        'Refusing patient pagination regression without an exact ' +
        'PATIENT_PAGINATION_TEST_CONFIRM_DB_NAME match.'
    );
}

const db = require('../models');
const patientController = require('../controllers/patientController');

const runId = String(Date.now());
const marker = `PAGE${runId}`;
const created = {
    patientIds: [],
    rxIds: [],
    trackingIds: [],
    clinicIds: [],
    pharmacyIds: [],
    patientTransportIds: [],
    pharmacyTransportIds: [],
    workflowActionIds: [],
    inactiveWorkflowActionId: null
};

function runHandler(query) {
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
        Promise.resolve(patientController.getAll({ query }, res)).catch(reject);
    });
}

function runTimelineHandler(patientId) {
    return new Promise((resolve, reject) => {
        const res = {
            statusCode: 200,
            status(code) {
                this.statusCode = code;
                return this;
            },
            json(payload) {
                resolve({ status: this.statusCode, payload });
            }
        };
        const req = { params: { id: String(patientId) }, user: { id: null } };
        Promise.resolve(patientController.getTimeline(req, res)).catch(reject);
    });
}

async function cleanup() {
    if (created.trackingIds.length) {
        await db.RXWorkflowTracking.destroy({ where: { id: created.trackingIds } }).catch(() => {});
    }
    if (created.rxIds.length) {
        await db.RXRecord.destroy({ where: { id: created.rxIds } }).catch(() => {});
    }
    if (created.patientIds.length) {
        await db.PatientNote.destroy({ where: { patientId: created.patientIds } }).catch(() => {});
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
    if (created.workflowActionIds.length) {
        await db.WorkflowAction.destroy({ where: { id: created.workflowActionIds } }).catch(() => {});
    }
    if (created.inactiveWorkflowActionId) {
        await db.WorkflowAction.destroy({ where: { id: created.inactiveWorkflowActionId } }).catch(() => {});
    }
}

async function createFixtures() {
    const clinicA = await db.Clinic.create({ name: `${marker} Clinic A`, isActive: true });
    const clinicB = await db.Clinic.create({ name: `${marker} Clinic B`, isActive: true });
    created.clinicIds.push(clinicA.id, clinicB.id);
    const pharmacy = await db.Pharmacy.create({ name: `${marker} Pharmacy`, isActive: true });
    created.pharmacyIds.push(pharmacy.id);
    const patientTransport = await db.PatientTransportCompany.create({
        companyName: `${marker} Patient Transport`,
        contactPerson: `${marker} Dispatcher`,
        isActive: true
    });
    created.patientTransportIds.push(patientTransport.id);
    const pharmacyTransport = await db.PharmacyTransportCompany.create({
        companyName: `${marker} Pharmacy Transport`,
        contactPerson: `${marker} Courier`,
        isActive: true
    });
    created.pharmacyTransportIds.push(pharmacyTransport.id);

    let activeActions = await db.WorkflowAction.findAll({
        where: { isActive: true },
        order: [['sequenceNumber', 'ASC'], ['id', 'ASC']]
    });
    if (activeActions.length < 2) {
        let nextSequence = (Number(await db.WorkflowAction.max('sequenceNumber')) || 0) + 1;
        while (activeActions.length < 2) {
            const action = await db.WorkflowAction.create({
                name: `${marker} Action ${activeActions.length + 1}`,
                description: 'Temporary patient pagination regression action',
                sequenceNumber: nextSequence++,
                isActive: true
            });
            created.workflowActionIds.push(action.id);
            activeActions.push(action);
        }
    }

    let inactiveAction = await db.WorkflowAction.findOne({
        where: { isActive: false },
        order: [['sequenceNumber', 'ASC'], ['id', 'ASC']]
    });
    if (!inactiveAction) {
        const maxSequence = await db.WorkflowAction.max('sequenceNumber');
        inactiveAction = await db.WorkflowAction.create({
            name: `${marker} Inactive Action`,
            description: 'Temporary inactive patient pagination regression action',
            sequenceNumber: (Number(maxSequence) || 0) + 1,
            isActive: false
        });
        created.inactiveWorkflowActionId = inactiveAction.id;
    }

    const common = {
        lastName: marker,
        dob: '1980-01-01',
        phone: '555-0100',
        pharmacyId: pharmacy.id,
        patientTransportCompanyId: patientTransport.id,
        pharmacyTransportCompanyId: pharmacyTransport.id,
        isDeleted: false
    };
    const patients = await db.Patient.bulkCreate([
        {
            ...common,
            firstName: 'ALPHA',
            patientCode: `${marker}-A`,
            serviceDate: '2020-01-01',
            clinicId: clinicA.id,
            isActive: true,
            isNonCompanyPatient: false
        },
        {
            ...common,
            firstName: 'BETA',
            patientCode: `${marker}-B`,
            serviceDate: '2020-02-01',
            clinicId: clinicB.id,
            isActive: true,
            isNonCompanyPatient: false
        },
        {
            ...common,
            firstName: 'GAMMA',
            patientCode: `${marker}-C`,
            serviceDate: null,
            clinicId: clinicA.id,
            isActive: true,
            isNonCompanyPatient: true
        },
        {
            ...common,
            firstName: 'OMEGA',
            patientCode: `${marker}-D`,
            serviceDate: null,
            clinicId: null,
            pharmacyId: null,
            patientTransportCompanyId: null,
            pharmacyTransportCompanyId: null,
            isActive: false,
            isNonCompanyPatient: false
        }
    ], { returning: true });
    created.patientIds.push(...patients.map(patient => patient.id));

    const incompleteRx = await db.RXRecord.create({
        patientId: patients[0].id,
        serviceDate: patients[0].serviceDate,
        isDeleted: false
    });
    const completeRx = await db.RXRecord.create({
        patientId: patients[1].id,
        serviceDate: patients[1].serviceDate,
        isDeleted: false
    });
    created.rxIds.push(incompleteRx.id, completeRx.id);
    const completed = await db.RXWorkflowTracking.bulkCreate(activeActions.map(action => ({
        rxRecordId: completeRx.id,
        workflowActionId: action.id,
        completionDate: new Date(),
        userId: null
    })), { returning: true });
    const edgeHistory = await db.RXWorkflowTracking.bulkCreate([
        {
            rxRecordId: completeRx.id,
            workflowActionId: activeActions[0].id,
            completionDate: new Date(),
            userId: null
        },
        {
            rxRecordId: completeRx.id,
            workflowActionId: inactiveAction.id,
            completionDate: new Date(),
            userId: null
        },
        {
            rxRecordId: incompleteRx.id,
            workflowActionId: activeActions[0].id,
            completionDate: new Date(),
            userId: null
        },
        {
            rxRecordId: incompleteRx.id,
            workflowActionId: activeActions[0].id,
            completionDate: new Date(),
            userId: null
        },
        {
            rxRecordId: incompleteRx.id,
            workflowActionId: inactiveAction.id,
            completionDate: new Date(),
            userId: null
        }
    ], { returning: true });
    created.trackingIds.push(...completed.map(row => row.id), ...edgeHistory.map(row => row.id));

    return { activeActions, inactiveAction, patients, incompleteRx, completeRx };
}

async function main() {
    await db.sequelize.authenticate();
    const fixtures = await createFixtures();

    const originalFindAll = db.Patient.findAll;
    const observedQueries = [];
    db.Patient.findAll = function(options) {
        observedQueries.push(options || {});
        return originalFindAll.call(this, options);
    };

    try {
        let result = await runHandler({
            paginated: 'true',
            page: '1',
            pageSize: '2',
            sort: 'firstName',
            dir: 'asc',
            lastName: marker
        });
        assert.strictEqual(result.status, 200, result.payload.error || 'Patient pagination failed');
        assert.strictEqual(result.payload.total, 4);
        assert.deepStrictEqual(result.payload.rows.map(row => row.firstName), ['ALPHA', 'BETA']);
        assert.strictEqual(result.payload.totalPages, 2);
        const alphaRow = result.payload.rows.find(row => row.firstName === 'ALPHA');
        const betaRow = result.payload.rows.find(row => row.firstName === 'BETA');
        assert.strictEqual(alphaRow.needsAction, true, 'Duplicate and inactive history must remain incomplete');
        assert.strictEqual(betaRow.needsAction, false, 'All distinct active steps must be complete');
        assert(result.payload.facets.clinics.some(row => row.label === `${marker} Clinic A`));
        assert(result.payload.facets.clinics.some(row => row.label === `${marker} Clinic B`));

        const idPageQuery = observedQueries.find(options =>
            options.limit === 2
            && Array.isArray(options.attributes)
            && options.attributes.length === 1
            && options.attributes[0] === 'id'
        );
        assert(idPageQuery, 'The patient list must issue a bounded ID-page query.');
        const relationshipQuery = observedQueries.find(options =>
            Array.isArray(options.include)
            && options.include.some(include => include && include.model === db.RXRecord)
        );
        assert(
            relationshipQuery
            && relationshipQuery.where
            && relationshipQuery.where.id
            && (
                Array.isArray(relationshipQuery.where.id)
                || relationshipQuery.where.id[Op.in]
            ),
            'Patient relationships must load only for IDs on the selected page.'
        );
        console.log('PASS: selected patient page is bounded before relationship loading');

        result = await runHandler({
            paginated: 'true',
            page: '2',
            pageSize: '2',
            sort: 'firstName',
            dir: 'asc',
            lastName: marker
        });
        assert.deepStrictEqual(result.payload.rows.map(row => row.firstName), ['GAMMA', 'OMEGA']);

        result = await runHandler({
            paginated: 'true',
            page: '1',
            pageSize: '10',
            sort: 'id',
            dir: 'asc',
            lastName: marker,
            eligibility: 'needsAction'
        });
        assert.deepStrictEqual(result.payload.rows.map(row => row.firstName), ['ALPHA']);
        assert.strictEqual(result.payload.needsActionTotal, 1);
        const completeTimeline = await runTimelineHandler(fixtures.patients[1].id);
        assert.strictEqual(completeTimeline.status, 200, completeTimeline.payload.error || 'Timeline failed');
        assert.strictEqual(
            completeTimeline.payload.workflowActions.length,
            fixtures.activeActions.length,
            'Timeline must return active workflow definitions only'
        );
        assert(completeTimeline.payload.workflowActions.every(action => action.isActive === true));
        const timelineCompleteRx = completeTimeline.payload.rxRecords.find(
            row => Number(row.id) === Number(fixtures.completeRx.id)
        );
        assert.strictEqual(
            timelineCompleteRx.RXWorkflowTrackings.length,
            fixtures.activeActions.length + 2,
            'Timeline must preserve duplicate and inactive audit-history rows'
        );
        assert.strictEqual(
            timelineCompleteRx.completedSteps.length,
            fixtures.activeActions.length,
            'Timeline must expose each completed active step exactly once'
        );
        assert(!timelineCompleteRx.completedSteps.includes(Number(fixtures.inactiveAction.id)));

        const incompleteTimeline = await runTimelineHandler(fixtures.patients[0].id);
        assert.strictEqual(incompleteTimeline.status, 200, incompleteTimeline.payload.error || 'Timeline failed');
        const timelineIncompleteRx = incompleteTimeline.payload.rxRecords.find(
            row => Number(row.id) === Number(fixtures.incompleteRx.id)
        );
        assert.strictEqual(timelineIncompleteRx.RXWorkflowTrackings.length, 3);
        assert.deepStrictEqual(
            timelineIncompleteRx.completedSteps,
            [Number(fixtures.activeActions[0].id)],
            'Duplicate and inactive history must count as one active completed step'
        );

        result = await runHandler({
            paginated: 'true',
            page: '1',
            pageSize: '10',
            lastName: marker,
            patientType: 'non_company'
        });
        assert.deepStrictEqual(result.payload.rows.map(row => row.firstName), ['GAMMA']);

        result = await runHandler({
            paginated: 'true',
            page: '1',
            pageSize: '10',
            lastName: marker,
            missingInfo: 'all'
        });
        assert.deepStrictEqual(result.payload.rows.map(row => row.firstName), ['OMEGA']);

        result = await runHandler({
            paginated: 'true',
            page: '1',
            pageSize: '10',
            lastName: marker,
            noRx: 'true',
            sort: 'firstName',
            dir: 'asc'
        });
        assert.deepStrictEqual(result.payload.rows.map(row => row.firstName), ['GAMMA']);

        result = await runHandler({
            paginated: 'true',
            exportAll: 'true',
            page: '1',
            pageSize: '500',
            sort: 'Clinic.name',
            dir: 'asc',
            lastName: marker
        });
        assert.strictEqual(result.payload.rows.length, 4);
        console.log('PASS: filters, facets, needs-action, no-RX, sorting, and explicit export preserved');
    } finally {
        db.Patient.findAll = originalFindAll;
    }
}

main()
    .then(async () => {
        await cleanup();
        await db.sequelize.close();
        console.log('Patient database-side pagination regression passed.');
    })
    .catch(async error => {
        console.error(error.stack || error.message);
        await cleanup();
        await db.sequelize.close().catch(() => {});
        process.exit(1);
    });
