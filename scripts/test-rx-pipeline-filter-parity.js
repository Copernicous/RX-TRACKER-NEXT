'use strict';

const assert = require('assert');
const { Op } = require('sequelize');
const { prepareStagingEnv } = require('./lib/staging-env');

const explicitDatabase = String(process.env.RX_PIPELINE_FILTER_TEST_DB_NAME || '').trim();
if (explicitDatabase) {
    process.env.DB_NAME = explicitDatabase;
} else {
    const staging = prepareStagingEnv();
    process.env.DB_NAME = staging.dbName;
}

const confirmedDatabase = String(process.env.RX_PIPELINE_FILTER_TEST_CONFIRM_DB_NAME || '').trim();
const safeDatabaseTokens = new Set(['staging', 'stage', 'qa', 'test', 'sandbox']);
const databaseTokens = String(process.env.DB_NAME || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
if (!databaseTokens.some(token => safeDatabaseTokens.has(token))) {
    throw new Error(
        `Refusing RX pipeline/filter parity regression on non-test database "${process.env.DB_NAME || ''}".`
    );
}
if (!confirmedDatabase || confirmedDatabase !== String(process.env.DB_NAME || '')) {
    throw new Error(
        'Refusing RX pipeline/filter parity regression without an exact ' +
        'RX_PIPELINE_FILTER_TEST_CONFIRM_DB_NAME match.'
    );
}

// Make the date-filter contract deterministic in CI and exercise the configured
// application timezone rather than the machine/browser timezone.
process.env.TZ = 'America/New_York';

const db = require('../models');
const dashboardController = require('../controllers/dashboardController');
const rxController = require('../controllers/rxController');
const { getServiceWindowDays } = require('../utils/globalSettings');

const runId = String(Date.now());
const marker = `PIPELINE${runId}`;
const created = {
    patientId: null,
    rxIds: [],
    trackingIds: [],
    workflowActionIds: []
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
        Promise.resolve(handler({ query: query || {} }, res)).catch(reject);
    });
}

async function getPipeline() {
    const result = await runHandler(dashboardController.getRxPipeline, {});
    assert.strictEqual(result.status, 200, result.payload?.error || 'RX pipeline request failed');
    assert(Array.isArray(result.payload?.stepBreakdown), 'RX pipeline must return a step breakdown');
    return result.payload;
}

async function getRxPage(patientId, filters) {
    const result = await runHandler(rxController.getAll, {
        paginated: 'true',
        patientId: String(patientId),
        page: '1',
        pageSize: '100',
        sort: 'id',
        dir: 'asc',
        ...(filters || {})
    });
    assert.strictEqual(result.status, 200, result.payload?.error || 'RX Records filter request failed');
    assert(Array.isArray(result.payload?.rows), 'RX Records paginated response must include rows');
    return result.payload;
}

function sortedIds(rows) {
    return rows.map(row => Number(row.id)).sort((a, b) => a - b);
}

function stepCountMap(pipeline) {
    return new Map(
        pipeline.stepBreakdown.map(step => [Number(step.id), Number(step.count || 0)])
    );
}

async function createRx(patientId, serviceDate, isDeleted) {
    const rx = await db.RXRecord.create({
        patientId,
        serviceDate,
        isDeleted: Boolean(isDeleted)
    });
    created.rxIds.push(rx.id);
    return rx;
}

async function createTrackings(rxId, actions, completionDates) {
    if (!actions.length) return [];
    const rows = await db.RXWorkflowTracking.bulkCreate(actions.map((action, index) => ({
        rxRecordId: rxId,
        workflowActionId: action.id,
        completionDate: Array.isArray(completionDates)
            ? completionDates[index]
            : (completionDates || new Date()),
        userId: null
    })), { returning: true });
    created.trackingIds.push(...rows.map(row => row.id));
    return rows;
}

function localDateIso(dayOffset) {
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() + Number(dayOffset || 0));
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return String(date.getFullYear()) + '-' + month + '-' + day;
}

function localDateKey(value) {
    const date = new Date(value);
    if (isNaN(date.getTime())) return '';
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return String(date.getFullYear()) + '-' + month + '-' + day;
}

async function cleanup() {
    const failures = [];
    const attempt = async (label, operation) => {
        try {
            await operation();
        } catch (error) {
            failures.push(new Error(`${label}: ${error.message}`, { cause: error }));
        }
    };

    if (created.trackingIds.length) {
        await attempt('delete workflow tracking fixtures', () => db.RXWorkflowTracking.destroy({
            where: { id: { [Op.in]: created.trackingIds } }
        }));
    }
    if (created.rxIds.length) {
        await attempt('delete RX fixtures', () => db.RXRecord.destroy({
            where: { id: { [Op.in]: created.rxIds } }
        }));
    }
    if (created.workflowActionIds.length) {
        await attempt('delete inactive workflow action fixtures', () => db.WorkflowAction.destroy({
            where: { id: { [Op.in]: created.workflowActionIds } }
        }));
    }
    if (created.patientId) {
        await attempt('delete service-date history fixtures', () => db.PatientServiceDateHistory.destroy({
            where: { patientId: created.patientId }
        }));
        await attempt('delete service-date cycle fixtures', () => db.PatientServiceDateCycle.destroy({
            where: { patientId: created.patientId }
        }));
        await attempt('delete patient fixture', () => db.Patient.destroy({
            where: { id: created.patientId }
        }));
    }

    if (created.trackingIds.length) {
        await attempt('verify workflow tracking cleanup', async () => {
            const remaining = await db.RXWorkflowTracking.count({
                where: { id: { [Op.in]: created.trackingIds } }
            });
            assert.strictEqual(remaining, 0, 'workflow tracking fixtures remain');
        });
    }
    if (created.rxIds.length) {
        await attempt('verify RX cleanup', async () => {
            const remaining = await db.RXRecord.count({
                where: { id: { [Op.in]: created.rxIds } }
            });
            assert.strictEqual(remaining, 0, 'RX fixtures remain');
        });
    }
    if (created.patientId) {
        await attempt('verify patient cleanup', async () => {
            const remaining = await db.Patient.count({ where: { id: created.patientId } });
            assert.strictEqual(remaining, 0, 'patient fixture remains');
        });
    }

    if (failures.length) {
        throw new AggregateError(failures, 'RX pipeline/filter fixture cleanup failed');
    }
}

async function main() {
    await db.sequelize.authenticate();

    const actions = await db.WorkflowAction.findAll({
        where: { isActive: true },
        order: [['sequenceNumber', 'ASC'], ['id', 'ASC']]
    });
    assert(
        actions.length >= 3,
        'RX pipeline/filter parity regression requires at least three active workflow actions'
    );
    const inactiveAction = await db.WorkflowAction.create({
        name: 'PIPELINE INACTIVE ' + runId,
        description: 'Temporary inactive action for Current Stage Date parity',
        sequenceNumber: Math.max(...actions.map(action => Number(action.sequenceNumber) || 0)) + 100,
        isActive: false
    });
    created.workflowActionIds.push(inactiveAction.id);

    const pipelineBefore = await getPipeline();
    const beforeByAction = stepCountMap(pipelineBefore);
    actions.forEach(action => {
        assert(
            beforeByAction.has(Number(action.id)),
            `RX pipeline is missing active workflow action ${action.id} before fixture creation`
        );
    });

    const serviceDate = new Date().toISOString().slice(0, 10);
    const selectedStageDate = localDateIso(-1);
    const outsideStageDate = localDateIso(0);
    const selectedStageStart = new Date(selectedStageDate + 'T00:00:00.000');
    const selectedStageMidday = new Date(selectedStageDate + 'T12:00:00.000');
    const selectedStageEnd = new Date(selectedStageDate + 'T23:59:59.999');
    const outsideStageMidday = new Date(outsideStageDate + 'T12:00:00.000');
    const expiredDate = new Date();
    expiredDate.setUTCDate(expiredDate.getUTCDate() - getServiceWindowDays() - 2);
    const expiredServiceDate = expiredDate.toISOString().slice(0, 10);
    const patient = await db.Patient.create({
        firstName: 'PIPELINE',
        lastName: marker,
        patientCode: marker,
        dob: '1980-01-01',
        phone: '555-0198',
        serviceDate,
        isActive: true,
        isDeleted: false,
        isNonCompanyPatient: false
    });
    created.patientId = patient.id;

    const unstartedRx = await createRx(patient.id, serviceDate, false);
    const firstStageRx = await createRx(patient.id, serviceDate, false);
    const secondStageRx = await createRx(patient.id, serviceDate, false);
    const expiredUnstartedRx = await createRx(patient.id, expiredServiceDate, false);
    const duplicateStageRx = await createRx(patient.id, expiredServiceDate, false);
    const completedRx = await createRx(patient.id, serviceDate, false);
    const expiredCompletedRx = await createRx(patient.id, expiredServiceDate, false);
    const hiddenFirstStageRx = await createRx(patient.id, serviceDate, true);

    await createTrackings(firstStageRx.id, [actions[0]], [selectedStageStart]);
    await createTrackings(firstStageRx.id, [inactiveAction], [outsideStageMidday]);
    await createTrackings(
        secondStageRx.id,
        actions.slice(0, 2),
        [selectedStageMidday, outsideStageMidday]
    );
    const duplicateActions = Array.from({ length: actions.length }, () => actions[0]);
    const duplicateDates = duplicateActions.map((action, index) =>
        index === 0
            ? selectedStageStart
            : new Date(outsideStageMidday.getTime() + index)
    );
    const duplicateRows = await createTrackings(
        duplicateStageRx.id,
        duplicateActions,
        duplicateDates
    );
    assert.strictEqual(
        duplicateRows.length,
        actions.length,
        'Duplicate-history fixture must contain totalSteps copies of the first action'
    );
    await createTrackings(
        completedRx.id,
        actions,
        actions.map((action, index) => index === actions.length - 1
            ? selectedStageEnd
            : new Date(selectedStageStart.getTime() + index))
    );
    await createTrackings(expiredCompletedRx.id, actions, actions.map(() => outsideStageMidday));
    await createTrackings(hiddenFirstStageRx.id, [actions[0]], [selectedStageMidday]);

    const pipelineAfter = await getPipeline();
    const afterByAction = stepCountMap(pipelineAfter);

    assert.strictEqual(
        Number(pipelineAfter.total) - Number(pipelineBefore.total),
        7,
        'Dashboard pipeline must exclude the hidden fixture from its total'
    );
    assert.strictEqual(
        Number(pipelineAfter.notStarted) - Number(pipelineBefore.notStarted),
        1,
        'Dashboard Not Started must include only the non-expired unstarted fixture'
    );
    assert.strictEqual(
        Number(pipelineAfter.inProgress) - Number(pipelineBefore.inProgress),
        2,
        'Dashboard In Progress must include only non-expired started fixtures'
    );
    assert.strictEqual(
        Number(pipelineAfter.expired) - Number(pipelineBefore.expired),
        2,
        'Dashboard Expired must include expired incomplete RX with and without progress'
    );
    assert.strictEqual(
        Number(pipelineAfter.completed) - Number(pipelineBefore.completed),
        2,
        'Completed must include every fully completed fixture regardless of service date'
    );
    assert.strictEqual(
        Number(pipelineAfter.allIncomplete) - Number(pipelineBefore.allIncomplete),
        5,
        'Dashboard All Incomplete must include Not Started, In Progress, and Expired fixtures'
    );
    assert.strictEqual(
        Number(pipelineAfter.startedIncomplete) - Number(pipelineBefore.startedIncomplete),
        3,
        'Started Incomplete must preserve all Current Stage records, including expired progress'
    );
    assert.strictEqual(
        Number(pipelineAfter.total),
        Number(pipelineAfter.notStarted) +
            Number(pipelineAfter.inProgress) +
            Number(pipelineAfter.expired) +
            Number(pipelineAfter.completed),
        'Dashboard Workflow Status categories must be mutually exclusive and exhaustive'
    );
    assert.strictEqual(
        Number(pipelineAfter.allIncomplete),
        Number(pipelineAfter.notStarted) +
            Number(pipelineAfter.inProgress) +
            Number(pipelineAfter.expired),
        'Dashboard All Incomplete must reconcile to every incomplete Workflow Status'
    );

    const allVisible = await getRxPage(patient.id, {});
    assert.strictEqual(allVisible.total, 7, 'RX Records default view must exclude the hidden fixture');
    assert.deepStrictEqual(
        sortedIds(allVisible.rows),
        [
            unstartedRx.id,
            firstStageRx.id,
            secondStageRx.id,
            expiredUnstartedRx.id,
            duplicateStageRx.id,
            completedRx.id,
            expiredCompletedRx.id
        ].sort((a, b) => a - b)
    );
    const allIncomplete = await getRxPage(patient.id, { workflowStatus: 'incomplete' });
    assert.deepStrictEqual(
        sortedIds(allIncomplete.rows),
        [
            unstartedRx.id,
            firstStageRx.id,
            secondStageRx.id,
            expiredUnstartedRx.id,
            duplicateStageRx.id
        ].sort((a, b) => a - b),
        'All Incomplete must match the Dashboard Pending card and include expired incomplete RX records'
    );
    const operationalPending = await getRxPage(patient.id, { workflowStatus: 'pending' });
    assert.deepStrictEqual(
        sortedIds(operationalPending.rows),
        [unstartedRx.id, firstStageRx.id, secondStageRx.id].sort((a, b) => a - b),
        'Operational Pending must keep the separately labeled Expired status excluded'
    );
    const expiredOnly = await getRxPage(patient.id, { workflowStatus: 'expired' });
    assert.deepStrictEqual(
        sortedIds(expiredOnly.rows),
        [expiredUnstartedRx.id, duplicateStageRx.id].sort((a, b) => a - b),
        'Expired filter must contain expired incomplete RX with and without progress'
    );
    const inProgressOnly = await getRxPage(patient.id, { workflowStatus: 'in-progress' });
    assert.deepStrictEqual(
        sortedIds(inProgressOnly.rows),
        [firstStageRx.id, secondStageRx.id].sort((a, b) => a - b),
        'In Progress filter must match the Dashboard category and exclude Expired'
    );
    const notStartedOnly = await getRxPage(patient.id, { workflowStatus: 'not-started' });
    assert.deepStrictEqual(
        sortedIds(notStartedOnly.rows),
        [unstartedRx.id],
        'Not Started filter must match the Dashboard category and exclude Expired'
    );
    const completedOnly = await getRxPage(patient.id, { workflowStatus: 'completed' });
    assert.deepStrictEqual(
        sortedIds(completedOnly.rows),
        [completedRx.id, expiredCompletedRx.id].sort((a, b) => a - b),
        'Completed filter must match the Dashboard category and take precedence over Expired'
    );

    const duplicateRow = allVisible.rows.find(row => Number(row.id) === Number(duplicateStageRx.id));
    assert(duplicateRow, 'RX Records response must include the duplicate-history fixture');
    assert.strictEqual(
        duplicateRow.RXWorkflowTrackings.length,
        actions.length,
        'RX Records must preserve every duplicate audit-history row'
    );
    assert.deepStrictEqual(
        duplicateRow.completedSteps,
        [Number(actions[0].id)],
        'RX Records progress must expose one distinct active completed step for duplicate history'
    );

    const expectedByActionId = new Map(actions.map(action => [Number(action.id), []]));
    expectedByActionId.get(Number(actions[0].id)).push(firstStageRx.id, duplicateStageRx.id);
    expectedByActionId.get(Number(actions[1].id)).push(secondStageRx.id);
    expectedByActionId.get(Number(actions[actions.length - 1].id)).push(completedRx.id, expiredCompletedRx.id);

    for (const action of actions) {
        const filtered = await getRxPage(patient.id, {
            currentWorkflowStage: String(action.sequenceNumber)
        });
        const expectedIds = expectedByActionId.get(Number(action.id)).sort((a, b) => a - b);
        assert.deepStrictEqual(
            sortedIds(filtered.rows),
            expectedIds,
            `RX Current Stage ${action.sequenceNumber} returned the wrong fixture records`
        );
        assert.strictEqual(
            filtered.total,
            expectedIds.length,
            `RX Current Stage ${action.sequenceNumber} total is incorrect`
        );

        assert(
            afterByAction.has(Number(action.id)),
            `RX pipeline is missing active workflow action ${action.id} after fixture creation`
        );
        const dashboardDelta =
            Number(afterByAction.get(Number(action.id))) -
            Number(beforeByAction.get(Number(action.id)));
        assert.strictEqual(
            dashboardDelta,
            filtered.total,
            `Dashboard Current Stage "${action.name}" must equal the RX Records Current Stage filter`
        );
    }

    const selectedStagePage = await getRxPage(patient.id, {
        currentStageDateFrom: selectedStageDate,
        currentStageDateTo: selectedStageDate
    });
    assert.deepStrictEqual(
        sortedIds(selectedStagePage.rows),
        [firstStageRx.id, completedRx.id].sort((a, b) => a - b),
        'Same-day Current Stage Date must include local midnight and 23:59:59 while excluding historical-only matches'
    );
    assert.strictEqual(selectedStagePage.total, 2, 'Current Stage Date total must equal returned rows');
    selectedStagePage.rows.forEach(row => {
        assert.strictEqual(
            localDateKey(row.currentStageDate),
            selectedStageDate,
            'RX response must expose the same canonical Current Stage Date used by the filter'
        );
    });

    const stageDateFromOnly = await getRxPage(patient.id, {
        currentStageDateFrom: selectedStageDate
    });
    assert.deepStrictEqual(
        sortedIds(stageDateFromOnly.rows),
        [
            firstStageRx.id,
            secondStageRx.id,
            duplicateStageRx.id,
            completedRx.id,
            expiredCompletedRx.id
        ].sort((a, b) => a - b),
        'Current Stage Date From must include all visible records on or after the local day boundary'
    );
    const stageDateToOnly = await getRxPage(patient.id, {
        currentStageDateTo: selectedStageDate
    });
    assert.deepStrictEqual(
        sortedIds(stageDateToOnly.rows),
        [firstStageRx.id, completedRx.id].sort((a, b) => a - b),
        'Current Stage Date To must include the full selected local day and exclude later current stages'
    );
    const outsideStagePage = await getRxPage(patient.id, {
        currentStageDateFrom: outsideStageDate,
        currentStageDateTo: outsideStageDate
    });
    assert.deepStrictEqual(
        sortedIds(outsideStagePage.rows),
        [secondStageRx.id, duplicateStageRx.id, expiredCompletedRx.id].sort((a, b) => a - b),
        'Current Stage Date must use the latest duplicate at the highest active stage'
    );
    const combinedStageDate = await getRxPage(patient.id, {
        currentWorkflowStage: String(actions[0].sequenceNumber),
        currentStageDateFrom: selectedStageDate,
        currentStageDateTo: selectedStageDate
    });
    assert.deepStrictEqual(
        sortedIds(combinedStageDate.rows),
        [firstStageRx.id],
        'Current Stage and Current Stage Date filters must intersect without using older history'
    );
    const combinedCompletedDate = await getRxPage(patient.id, {
        workflowStatus: 'completed',
        currentStageDateFrom: selectedStageDate,
        currentStageDateTo: selectedStageDate
    });
    assert.deepStrictEqual(
        sortedIds(combinedCompletedDate.rows),
        [completedRx.id],
        'Completed status must use the final active-stage completion date'
    );
    const reversedStageDate = await getRxPage(patient.id, {
        currentStageDateFrom: outsideStageDate,
        currentStageDateTo: selectedStageDate
    });
    assert.strictEqual(reversedStageDate.total, 0, 'Reversed Current Stage Date range must return zero records');
    const invalidStageDate = await getRxPage(patient.id, {
        currentStageDateFrom: '2026-02-31',
        currentStageDateTo: 'not-a-date'
    });
    assert.strictEqual(invalidStageDate.total, 7, 'Invalid Current Stage dates must not cause an API error');
    const exportedStageDate = await getRxPage(patient.id, {
        exportAll: 'true',
        currentStageDateFrom: selectedStageDate,
        currentStageDateTo: selectedStageDate
    });
    assert.deepStrictEqual(
        sortedIds(exportedStageDate.rows),
        [firstStageRx.id, completedRx.id].sort((a, b) => a - b),
        'RX exportAll must preserve the Current Stage Date filters'
    );

    const nextActionOne = await getRxPage(patient.id, { workflowStage: '1' });
    assert.deepStrictEqual(
        sortedIds(nextActionOne.rows),
        [unstartedRx.id, expiredUnstartedRx.id].sort((a, b) => a - b),
        'Next Action 1 must contain incomplete fixtures with no completed Current Stage'
    );
    const firstStageIds = [firstStageRx.id, duplicateStageRx.id].sort((a, b) => a - b);
    const firstStageDelta =
        Number(afterByAction.get(Number(actions[0].id))) -
        Number(beforeByAction.get(Number(actions[0].id)));
    assert.strictEqual(firstStageDelta, firstStageIds.length, 'Dashboard first Current Stage must contain two fixtures');
    assert.notDeepStrictEqual(
        firstStageIds,
        sortedIds(nextActionOne.rows),
        'Dashboard Current Stage must not silently use Next Action Required records'
    );

    const hiddenOnly = await getRxPage(patient.id, {
        includeDeleted: 'true',
        currentWorkflowStage: String(actions[0].sequenceNumber),
        currentStageDateFrom: selectedStageDate,
        currentStageDateTo: selectedStageDate
    });
    assert.strictEqual(hiddenOnly.total, 1, 'Hidden RX query must return exactly one fixture');
    assert.deepStrictEqual(
        sortedIds(hiddenOnly.rows),
        [hiddenFirstStageRx.id],
        'Hidden RX query returned the wrong fixture'
    );

    console.log('PASS: dashboard workflow stages match RX Records Current Stage filters exactly');
    console.log('PASS: duplicate workflow history cannot advance stage or completion status');
    console.log('PASS: Current Stage remains distinct from Next Action and excludes hidden RX records');
    console.log('PASS: Current Stage Date uses inclusive app-local boundaries and ignores inactive history');
    console.log('PASS: Current Stage Date filter parity is preserved in exportAll and combined filters');
    console.log('PASS: Dashboard All Incomplete includes expired RX while operational Pending remains distinct');
}

async function run() {
    let mainError = null;
    let cleanupError = null;
    try {
        await main();
    } catch (error) {
        mainError = error;
    }
    try {
        await cleanup();
    } catch (error) {
        cleanupError = error;
    } finally {
        await db.sequelize.close().catch(() => {});
    }

    if (mainError && cleanupError) {
        throw new AggregateError(
            [mainError, cleanupError],
            'RX pipeline/filter regression and fixture cleanup both failed'
        );
    }
    if (mainError) throw mainError;
    if (cleanupError) throw cleanupError;
}

run().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
});
