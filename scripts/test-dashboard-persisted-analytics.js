'use strict';

const assert = require('assert');

const explicitDatabase = String(process.env.DASHBOARD_ANALYTICS_TEST_DB_NAME || '').trim();
if (explicitDatabase) process.env.DB_NAME = explicitDatabase;
const confirmedDatabase = String(process.env.DASHBOARD_ANALYTICS_TEST_CONFIRM_DB_NAME || '').trim();
const safeDatabaseTokens = new Set(['staging', 'stage', 'qa', 'test', 'sandbox']);
const databaseTokens = String(process.env.DB_NAME || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
if (!databaseTokens.some(token => safeDatabaseTokens.has(token))) {
    throw new Error('Refusing dashboard analytics regression on a non-test database.');
}
if (!confirmedDatabase || confirmedDatabase !== String(process.env.DB_NAME || '')) {
    throw new Error(
        'Refusing dashboard analytics regression without an exact ' +
        'DASHBOARD_ANALYTICS_TEST_CONFIRM_DB_NAME match.'
    );
}

const db = require('../models');
const dashboardController = require('../controllers/dashboardController');
const {
    captureSnapshot,
    localSnapshotDate,
    materializeSnapshotHistory
} = require('../services/snapshotService');
const { attachRelatedRxServiceRecords } = require('../services/patientServiceDateHistoryService');

const runId = String(Date.now());
const created = {
    patientId: null,
    rxIds: [],
    trackingIds: [],
    workflowActionId: null,
    inactiveWorkflowActionId: null
};
let replacedHistoryDate = null;
let previousHistorySnapshot = null;
let baselineCurrentSnapshot = null;
let historicalBaselineSnapshot = null;

function runHandler(handler, query) {
    return new Promise((resolve, reject) => {
        const res = {
            statusCode: 200,
            status(code) { this.statusCode = code; return this; },
            json(payload) { resolve({ status: this.statusCode, payload }); },
            send(payload) { resolve({ status: this.statusCode, payload }); }
        };
        Promise.resolve(handler({ query: query || {} }, res)).catch(reject);
    });
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
        await attempt('delete workflow tracking fixtures', () => (
            db.RXWorkflowTracking.destroy({ where: { id: created.trackingIds } })
        ));
    }
    if (created.rxIds.length) {
        await attempt('delete RX fixtures', () => (
            db.RXRecord.destroy({ where: { id: created.rxIds } })
        ));
    }
    if (created.patientId) {
        await attempt('delete service-date history fixtures', () => (
            db.PatientServiceDateHistory.destroy({ where: { patientId: created.patientId } })
        ));
        await attempt('delete service-date cycle fixtures', () => (
            db.PatientServiceDateCycle.destroy({ where: { patientId: created.patientId } })
        ));
        await attempt('delete patient fixture', () => (
            db.Patient.destroy({ where: { id: created.patientId } })
        ));
    }
    if (created.inactiveWorkflowActionId) {
        await attempt('delete inactive workflow action fixture', () => (
            db.WorkflowAction.destroy({ where: { id: created.inactiveWorkflowActionId } })
        ));
    }
    if (created.workflowActionId) {
        await attempt('delete active workflow action fixture', () => (
            db.WorkflowAction.destroy({ where: { id: created.workflowActionId } })
        ));
    }

    if (replacedHistoryDate) {
        if (previousHistorySnapshot) {
            await attempt('restore previous historical snapshot', async () => {
                const restored = { ...previousHistorySnapshot };
                delete restored.id;
                await db.DailySnapshot.upsert(restored);
            });
        } else {
            await attempt('remove materialized historical snapshot', () => (
                db.DailySnapshot.destroy({ where: { snapshotDate: replacedHistoryDate } })
            ));
        }
    }

    await attempt('refresh current snapshot after fixture cleanup', () => captureSnapshot());

    if (created.trackingIds.length) {
        await attempt('verify workflow tracking cleanup', async () => {
            const remaining = await db.RXWorkflowTracking.count({ where: { id: created.trackingIds } });
            assert.strictEqual(remaining, 0, 'workflow tracking fixtures remain');
        });
    }
    if (created.rxIds.length) {
        await attempt('verify RX cleanup', async () => {
            const remaining = await db.RXRecord.count({ where: { id: created.rxIds } });
            assert.strictEqual(remaining, 0, 'RX fixtures remain');
        });
    }
    if (created.patientId) {
        await attempt('verify patient cleanup', async () => {
            const remaining = await db.Patient.count({ where: { id: created.patientId } });
            assert.strictEqual(remaining, 0, 'patient fixture remains');
        });
    }
    const actionIds = [created.workflowActionId, created.inactiveWorkflowActionId].filter(Boolean);
    if (actionIds.length) {
        await attempt('verify workflow action cleanup', async () => {
            const remaining = await db.WorkflowAction.count({ where: { id: actionIds } });
            assert.strictEqual(remaining, 0, 'workflow action fixtures remain');
        });
    }

    if (replacedHistoryDate) {
        await attempt('verify historical snapshot restoration', async () => {
            const restored = await db.DailySnapshot.findOne({
                where: { snapshotDate: replacedHistoryDate },
                raw: true
            });
            if (!previousHistorySnapshot) {
                assert.strictEqual(restored, null, 'temporary historical snapshot remains');
                return;
            }
            assert(restored, 'previous historical snapshot was not restored');
            for (const field of Object.keys(previousHistorySnapshot)) {
                if (['id', 'createdAt', 'updatedAt'].includes(field)) continue;
                const before = previousHistorySnapshot[field];
                const after = restored[field];
                const normalize = value => value instanceof Date ? value.toISOString() : String(value ?? '');
                assert.strictEqual(normalize(after), normalize(before), `restored historical ${field} changed`);
            }
        });
    }

    if (baselineCurrentSnapshot) {
        await attempt('verify current snapshot fixture cleanup', async () => {
            const current = await db.DailySnapshot.findOne({
                where: { snapshotDate: localSnapshotDate() },
                raw: true
            });
            assert(current, 'current snapshot is missing after cleanup');
            for (const field of ['totalPatients', 'activePatients', 'inactivePatients', 'totalRX']) {
                assert.strictEqual(
                    Number(current[field] || 0),
                    Number(baselineCurrentSnapshot[field] || 0),
                    `current snapshot ${field} still contains fixture data`
                );
            }
        });
    }

    if (failures.length) {
        throw new AggregateError(failures, 'Dashboard analytics fixture cleanup failed');
    }
}
async function main() {
    await db.sequelize.authenticate();
    let actions = await db.WorkflowAction.findAll({
        where: { isActive: true },
        order: [['sequenceNumber', 'ASC'], ['id', 'ASC']]
    });
    if (!actions.length) {
        const action = await db.WorkflowAction.create({
            name: `Analytics Action ${runId}`,
            description: 'Temporary analytics regression action',
            sequenceNumber: 1,
            isActive: true
        });
        created.workflowActionId = action.id;
        actions = [action];
    }

    const maxSequenceNumber = Number(await db.WorkflowAction.max('sequenceNumber')) || 0;
    const inactiveAction = await db.WorkflowAction.create({
        name: `Analytics Retired Action ${runId}`,
        description: 'Temporary inactive analytics regression action',
        sequenceNumber: maxSequenceNumber + 1000,
        isActive: false
    });
    created.inactiveWorkflowActionId = inactiveAction.id;
    const orphanWorkflowActionId = (Number(await db.WorkflowAction.max('id')) || 0) + 1000000;
    assert.strictEqual(
        await db.WorkflowAction.count({ where: { id: orphanWorkflowActionId } }),
        0,
        'Orphan workflow fixture ID must not have a parent action.'
    );

    const baseline = await captureSnapshot();
    assert(baseline, 'Baseline dashboard analytics snapshot was not persisted.');
    baselineCurrentSnapshot = baseline.toJSON ? baseline.toJSON() : { ...baseline };

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    replacedHistoryDate = localSnapshotDate(yesterday);
    const previous = await db.DailySnapshot.findOne({
        where: { snapshotDate: replacedHistoryDate },
        raw: true
    });
    previousHistorySnapshot = previous || null;
    await db.DailySnapshot.destroy({ where: { snapshotDate: replacedHistoryDate } });
    const baselineHistoryInserted = await materializeSnapshotHistory(
        replacedHistoryDate,
        replacedHistoryDate
    );
    assert.strictEqual(baselineHistoryInserted, 1, 'Historical baseline must be materialized.');
    historicalBaselineSnapshot = await db.DailySnapshot.findOne({
        where: { snapshotDate: replacedHistoryDate },
        raw: true
    });
    assert(historicalBaselineSnapshot, 'Historical baseline snapshot is missing.');
    const fixtureTimestamp = new Date(`${replacedHistoryDate}T12:00:00`);

    const patient = await db.Patient.create({
        firstName: 'ANALYTICS',
        lastName: `TEST ${runId}`,
        patientCode: `AN-${runId}`,
        dob: '1980-01-01',
        phone: '555-0199',
        serviceDate: '2020-01-01',
        isActive: true,
        isDeleted: false,
        isNonCompanyPatient: false
    });
    created.patientId = patient.id;

    const completedRx = await db.RXRecord.create({
        patientId: patient.id,
        serviceDate: patient.serviceDate,
        isDeleted: false
    });
    const incompleteRx = await db.RXRecord.create({
        patientId: patient.id,
        serviceDate: patient.serviceDate,
        isDeleted: false
    });
    created.rxIds.push(completedRx.id, incompleteRx.id);

    await db.sequelize.query(
        `UPDATE "Patients"
         SET "createdAt" = :fixtureTimestamp, "updatedAt" = :fixtureTimestamp
         WHERE id = :patientId`,
        { replacements: { fixtureTimestamp, patientId: patient.id } }
    );
    await db.sequelize.query(
        `UPDATE "RXRecords"
         SET "createdAt" = :fixtureTimestamp, "updatedAt" = :fixtureTimestamp
         WHERE id IN (:rxIds)`,
        { replacements: { fixtureTimestamp, rxIds: created.rxIds } }
    );

    const trackingRows = actions.map(action => ({
        rxRecordId: completedRx.id,
        workflowActionId: action.id,
        completionDate: fixtureTimestamp,
        userId: null
    }));
    trackingRows.push(
        {
            rxRecordId: completedRx.id,
            workflowActionId: actions[0].id,
            completionDate: fixtureTimestamp,
            userId: null
        },
        {
            rxRecordId: completedRx.id,
            workflowActionId: inactiveAction.id,
            completionDate: fixtureTimestamp,
            userId: null
        },
        {
            rxRecordId: completedRx.id,
            workflowActionId: orphanWorkflowActionId,
            completionDate: fixtureTimestamp,
            userId: null
        }
    );

    const incompleteDistinctSteps = actions.length > 1 ? 1 : 0;
    if (incompleteDistinctSteps) {
        for (let i = 0; i < actions.length; i++) {
            trackingRows.push({
                rxRecordId: incompleteRx.id,
                workflowActionId: actions[0].id,
                completionDate: fixtureTimestamp,
                userId: null
            });
        }
    } else {
        for (let i = 0; i < 2; i++) {
            trackingRows.push({
                rxRecordId: incompleteRx.id,
                workflowActionId: inactiveAction.id,
                completionDate: fixtureTimestamp,
                userId: null
            });
        }
    }

    const trackings = await db.RXWorkflowTracking.bulkCreate(trackingRows, { returning: true });
    created.trackingIds.push(...trackings.map(row => row.id));

    const enrichedHistory = await attachRelatedRxServiceRecords([{
        patientId: patient.id,
        previousServiceDate: patient.serviceDate,
        newServiceDate: '2020-02-01'
    }]);
    const relatedRx = enrichedHistory[0].relatedRxRecords.previousRxRecords;
    const completedSummary = relatedRx.find(row => Number(row.id) === Number(completedRx.id));
    const incompleteSummary = relatedRx.find(row => Number(row.id) === Number(incompleteRx.id));
    assert(completedSummary, 'Completed RX must appear in the service-date history summary.');
    assert(incompleteSummary, 'Incomplete RX must appear in the service-date history summary.');
    assert.strictEqual(completedSummary.workflowStepCount, actions.length);
    assert.strictEqual(incompleteSummary.workflowStepCount, incompleteDistinctSteps);

    const captured = await captureSnapshot();
    assert(captured, 'Current dashboard analytics snapshot was not persisted.');
    assert.strictEqual(String(captured.snapshotDate), localSnapshotDate());
    assert.strictEqual(Number(captured.totalRX), Number(baseline.totalRX) + 2);
    assert.strictEqual(Number(captured.pendingRX), Number(baseline.pendingRX) + 1);
    assert.strictEqual(Number(captured.completedRX), Number(baseline.completedRX) + 1);
    assert.strictEqual(
        Number(captured.totalWorkflowSteps),
        Number(baseline.totalWorkflowSteps) + (2 * actions.length)
    );
    assert.strictEqual(
        Number(captured.completedWorkflowSteps),
        Number(baseline.completedWorkflowSteps) + actions.length + incompleteDistinctSteps
    );
    assert.strictEqual(
        Number(captured.workflowStepsToday),
        Number(baseline.workflowStepsToday),
        'Backdated fixture completions must not inflate today workflow steps.'
    );
    assert(Number(captured.workflowCompletionRate) <= 100, 'Workflow completion rate must not exceed 100%.');

    await db.DailySnapshot.destroy({ where: { snapshotDate: replacedHistoryDate } });
    const historyStartedAt = Date.now();
    const insertedHistory = await materializeSnapshotHistory(
        replacedHistoryDate,
        replacedHistoryDate
    );
    const historyMs = Date.now() - historyStartedAt;
    assert.strictEqual(insertedHistory, 1, 'One missing historical analytics row must be materialized.');
    const historical = await db.DailySnapshot.findOne({
        where: { snapshotDate: replacedHistoryDate },
        raw: true
    });
    assert(historical, 'Historical analytics row was not persisted.');
    assert.strictEqual(Number(historical.totalPatients), Number(historicalBaselineSnapshot.totalPatients) + 1);
    assert.strictEqual(Number(historical.activePatients), Number(historicalBaselineSnapshot.activePatients) + 1);
    assert.strictEqual(Number(historical.newPatientsToday), Number(historicalBaselineSnapshot.newPatientsToday) + 1);
    assert.strictEqual(Number(historical.totalRX), Number(historicalBaselineSnapshot.totalRX) + 2);
    assert.strictEqual(Number(historical.newRXToday), Number(historicalBaselineSnapshot.newRXToday) + 2);
    assert.strictEqual(Number(historical.pendingRX), Number(historicalBaselineSnapshot.pendingRX) + 1);
    assert.strictEqual(Number(historical.completedRX), Number(historicalBaselineSnapshot.completedRX) + 1);
    assert.strictEqual(
        Number(historical.totalWorkflowSteps),
        Number(historicalBaselineSnapshot.totalWorkflowSteps) + (2 * actions.length)
    );
    assert.strictEqual(
        Number(historical.completedWorkflowSteps),
        Number(historicalBaselineSnapshot.completedWorkflowSteps) + actions.length + incompleteDistinctSteps
    );
    assert.strictEqual(
        Number(historical.workflowStepsToday),
        Number(historicalBaselineSnapshot.workflowStepsToday) + actions.length + incompleteDistinctSteps
    );
    assert.strictEqual(
        Number(historical.pendingRX || 0) + Number(historical.completedRX || 0),
        Number(historical.totalRX || 0),
        'Historical Pending and Completed RX must reconcile to Total RX.'
    );
    assert(Number(historical.workflowCompletionRate) <= 100, 'Historical workflow completion rate must not exceed 100%.');

    // Poison persisted patient/RX values while leaving the timestamp in the future.
    // Live operational cards must ignore these stale values and use current rows.
    await db.sequelize.query(
        `UPDATE "DailySnapshots"
         SET "activePatients" = :activePatients,
             "inactivePatients" = :inactivePatients,
             "totalRX" = :totalRX,
             "pendingRX" = :pendingRX,
             "updatedAt" = NOW() + INTERVAL '1 minute'
         WHERE "snapshotDate" = :snapshotDate`,
        {
            replacements: {
                activePatients: Number(captured.activePatients) + 99,
                inactivePatients: Number(captured.inactivePatients) + 99,
                totalRX: Number(captured.totalRX) + 99,
                pendingRX: Number(captured.pendingRX) + 99,
                snapshotDate: localSnapshotDate()
            }
        }
    );

    const stats = await runHandler(dashboardController.getStats, {});
    assert.strictEqual(stats.status, 200, stats.payload.error || 'Dashboard stats failed');
    assert(stats.payload.analyticsAsOf, 'Dashboard stats must report the persisted analytics timestamp.');
    assert.strictEqual(Number(stats.payload.activePatients), Number(captured.activePatients));
    assert.strictEqual(Number(stats.payload.inactivePatients), Number(captured.inactivePatients));
    assert.strictEqual(Number(stats.payload.activeRxCount), Number(captured.totalRX));
    assert.strictEqual(Number(stats.payload.pendingDeliveriesCount), Number(captured.pendingRX));
    await captureSnapshot();

    const originalFindAll = db.Patient.findAll;
    const patientQueries = [];
    db.Patient.findAll = function(options) {
        patientQueries.push(options || {});
        return originalFindAll.call(this, options);
    };
    let eligibility;
    try {
        eligibility = await runHandler(dashboardController.getEligibilityStats, {});
    } finally {
        db.Patient.findAll = originalFindAll;
    }
    assert.strictEqual(eligibility.status, 200, eligibility.payload.error || 'Eligibility summary failed');
    assert(eligibility.payload.analyticsAsOf, 'Eligibility summary must use persisted analytics.');
    assert(patientQueries.some(options => options.limit === 20), 'Eligibility preview must remain bounded to 20 patients.');

    const today = localSnapshotDate();
    const firstChartStarted = Date.now();
    const firstChart = await runHandler(dashboardController.getChartData, {
        chartFrom: today,
        chartTo: today
    });
    const firstChartMs = Date.now() - firstChartStarted;
    assert.strictEqual(firstChart.status, 200, firstChart.payload.error || 'Persisted dashboard chart failed');
    assert.strictEqual(firstChart.payload.analyticsSource, 'daily_snapshots');
    assert.deepStrictEqual(firstChart.payload.dailyTrends.labels, [today]);

    const secondChartStarted = Date.now();
    const secondChart = await runHandler(dashboardController.getChartData, {
        chartFrom: today,
        chartTo: today
    });
    const secondChartMs = Date.now() - secondChartStarted;
    assert.strictEqual(secondChart.status, 200, secondChart.payload.error || 'Repeated persisted dashboard chart failed');
    assert.strictEqual(secondChart.payload.analyticsSource, 'daily_snapshots');

    const pipeline = await runHandler(dashboardController.getRxPipeline, {});
    assert.strictEqual(pipeline.status, 200, pipeline.payload.error || 'Aggregated RX pipeline failed');
    assert(Number(pipeline.payload.total) >= 1);
    assert.strictEqual(
        Number(pipeline.payload.total),
        Number(pipeline.payload.notStarted) +
            Number(pipeline.payload.inProgress) +
            Number(pipeline.payload.expired) +
            Number(pipeline.payload.completed)
    );
    assert.strictEqual(
        Number(pipeline.payload.allIncomplete),
        Number(pipeline.payload.notStarted) +
            Number(pipeline.payload.inProgress) +
            Number(pipeline.payload.expired)
    );
    assert.strictEqual(
        pipeline.payload.stepBreakdown.reduce((sum, step) => sum + Number(step.count || 0), 0),
        Number(pipeline.payload.startedIncomplete) + Number(pipeline.payload.completed),
        'Current Stage rows must retain every started incomplete RX, including Expired'
    );
    assert.strictEqual(Number(captured.totalRX), Number(pipeline.payload.total));
    assert.strictEqual(Number(captured.completedRX), Number(pipeline.payload.completed));
    assert.strictEqual(Number(captured.pendingRX), Number(pipeline.payload.allIncomplete));

    const pendingDrilldown = await runHandler(dashboardController.getPendingRx, {});
    assert.strictEqual(pendingDrilldown.status, 200, pendingDrilldown.payload.error || 'Pending RX drilldown failed');
    const pendingIds = new Set(pendingDrilldown.payload.map(row => Number(row.id)));
    assert(pendingIds.has(Number(incompleteRx.id)), 'Duplicate history must not remove an incomplete RX from Pending.');
    assert(!pendingIds.has(Number(completedRx.id)), 'A canonically completed RX must not appear in Pending.');
    const incompleteDrilldown = pendingDrilldown.payload.find(row => Number(row.id) === Number(incompleteRx.id));
    assert.strictEqual(Number(incompleteDrilldown.workflowStepsDone), incompleteDistinctSteps);
    assert.strictEqual(Number(incompleteDrilldown.workflowStepTotal), actions.length);

    console.log(`PASS: current analytics persisted; chart cache ${firstChartMs}ms then ${secondChartMs}ms`);
    console.log(`PASS: canonical historical day materialized in ${historyMs}ms`);
    console.log('PASS: eligibility preview bounded and RX pipeline aggregated in PostgreSQL');
    console.log('PASS: current/history cards, Pending drilldown, and service history use distinct active workflow steps');
}
async function run() {
    const failures = [];
    try {
        await main();
    } catch (error) {
        failures.push(error);
    }
    try {
        await cleanup();
    } catch (error) {
        failures.push(error);
    }
    try {
        await db.sequelize.close();
    } catch (error) {
        failures.push(new Error(`Database close failed: ${error.message}`, { cause: error }));
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) {
        throw new AggregateError(failures, 'Dashboard analytics regression and cleanup failed');
    }
}

run()
    .then(() => {
        console.log('Dashboard persisted analytics regression passed.');
    })
    .catch(error => {
        console.error(error.stack || error.message);
        if (error.errors) {
            error.errors.forEach(item => console.error(item.stack || item.message));
        }
        process.exitCode = 1;
    });
