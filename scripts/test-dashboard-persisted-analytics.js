'use strict';

const assert = require('assert');

const explicitDatabase = String(process.env.DASHBOARD_ANALYTICS_TEST_DB_NAME || '').trim();
if (explicitDatabase) process.env.DB_NAME = explicitDatabase;
if (!/(test|qa|staging|stage|sandbox|copy)/i.test(String(process.env.DB_NAME || ''))) {
    throw new Error('Refusing dashboard analytics regression on a non-test database.');
}

const db = require('../models');
const dashboardController = require('../controllers/dashboardController');
const {
    captureSnapshot,
    localSnapshotDate,
    materializeSnapshotHistory
} = require('../services/snapshotService');

const runId = String(Date.now());
const created = { patientId: null, rxId: null, trackingIds: [], workflowActionId: null };
let replacedHistoryDate = null;
let previousHistorySnapshot = null;

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
    if (replacedHistoryDate) {
        if (previousHistorySnapshot) {
            const restored = { ...previousHistorySnapshot };
            delete restored.id;
            await db.DailySnapshot.upsert(restored).catch(() => {});
        } else {
            await db.DailySnapshot.destroy({
                where: { snapshotDate: replacedHistoryDate }
            }).catch(() => {});
        }
    }
    if (created.trackingIds.length) {
        await db.RXWorkflowTracking.destroy({ where: { id: created.trackingIds } }).catch(() => {});
    }
    if (created.rxId) await db.RXRecord.destroy({ where: { id: created.rxId } }).catch(() => {});
    if (created.patientId) {
        await db.PatientServiceDateHistory.destroy({ where: { patientId: created.patientId } }).catch(() => {});
        await db.PatientServiceDateCycle.destroy({ where: { patientId: created.patientId } }).catch(() => {});
        await db.Patient.destroy({ where: { id: created.patientId } }).catch(() => {});
    }
    if (created.workflowActionId) {
        await db.WorkflowAction.destroy({ where: { id: created.workflowActionId } }).catch(() => {});
    }
    await captureSnapshot().catch(() => {});
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
    const rx = await db.RXRecord.create({
        patientId: patient.id,
        serviceDate: patient.serviceDate,
        isDeleted: false
    });
    created.rxId = rx.id;
    const trackings = await db.RXWorkflowTracking.bulkCreate(actions.map(action => ({
        rxRecordId: rx.id,
        workflowActionId: action.id,
        completionDate: new Date(),
        userId: null
    })), { returning: true });
    created.trackingIds.push(...trackings.map(row => row.id));

    const captured = await captureSnapshot();
    assert(captured, 'Current dashboard analytics snapshot was not persisted.');
    assert.strictEqual(String(captured.snapshotDate), localSnapshotDate());

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    replacedHistoryDate = localSnapshotDate(yesterday);
    const previous = await db.DailySnapshot.findOne({
        where: { snapshotDate: replacedHistoryDate },
        raw: true
    });
    previousHistorySnapshot = previous || null;
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
    if (previousHistorySnapshot) {
        [
            'totalPatients',
            'activePatients',
            'inactivePatients',
            'newPatientsToday',
            'totalRX',
            'newRXToday',
            'pendingRX',
            'completedRX',
            'patientsWithNoRx',
            'eligibleNow',
            'expiringIn7',
            'inWindow',
            'noServiceDate',
            'completedWorkflowSteps',
            'workflowStepsToday',
            'totalWorkflowSteps'
        ].forEach(field => {
            assert.strictEqual(
                Number(historical[field] || 0),
                Number(previousHistorySnapshot[field] || 0),
                `Set-based historical ${field} changed from the established dashboard result.`
            );
        });
    }

    const stats = await runHandler(dashboardController.getStats, {});
    assert.strictEqual(stats.status, 200, stats.payload.error || 'Dashboard stats failed');
    assert(stats.payload.analyticsAsOf, 'Dashboard stats must report the persisted analytics timestamp.');
    assert(Number(stats.payload.activePatients) >= 1);
    assert(Number(stats.payload.activeRxCount) >= 1);
    assert(Number(stats.payload.pendingDeliveriesCount) >= 0);

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
        Number(pipeline.payload.notStarted) + Number(pipeline.payload.inProgress) + Number(pipeline.payload.completed)
    );

    console.log(`PASS: current analytics persisted; chart cache ${firstChartMs}ms then ${secondChartMs}ms`);
    console.log(`PASS: missing historical day materialized in ${historyMs}ms`);
    console.log('PASS: eligibility preview bounded and RX pipeline aggregated in PostgreSQL');
}

main()
    .then(async () => {
        await cleanup();
        await db.sequelize.close();
        console.log('Dashboard persisted analytics regression passed.');
    })
    .catch(async error => {
        console.error(error.stack || error.message);
        await cleanup();
        await db.sequelize.close().catch(() => {});
        process.exit(1);
    });
