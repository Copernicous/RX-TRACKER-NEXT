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

const safeDatabaseTokens = new Set(['staging', 'stage', 'qa', 'test', 'sandbox', 'copy']);
const databaseTokens = String(process.env.DB_NAME || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
if (!databaseTokens.some(token => safeDatabaseTokens.has(token))) {
    throw new Error(
        `Refusing RX pipeline/filter parity regression on non-test database "${process.env.DB_NAME || ''}".`
    );
}

const db = require('../models');
const dashboardController = require('../controllers/dashboardController');
const rxController = require('../controllers/rxController');

const runId = String(Date.now());
const marker = `PIPELINE${runId}`;
const created = {
    patientId: null,
    rxIds: [],
    trackingIds: []
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

async function createTrackings(rxId, actions) {
    if (!actions.length) return [];
    const rows = await db.RXWorkflowTracking.bulkCreate(actions.map(action => ({
        rxRecordId: rxId,
        workflowActionId: action.id,
        completionDate: new Date(),
        userId: null
    })), { returning: true });
    created.trackingIds.push(...rows.map(row => row.id));
    return rows;
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

    const pipelineBefore = await getPipeline();
    const beforeByAction = stepCountMap(pipelineBefore);
    actions.forEach(action => {
        assert(
            beforeByAction.has(Number(action.id)),
            `RX pipeline is missing active workflow action ${action.id} before fixture creation`
        );
    });

    const serviceDate = new Date().toISOString().slice(0, 10);
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
    const duplicateStageRx = await createRx(patient.id, serviceDate, false);
    const completedRx = await createRx(patient.id, serviceDate, false);
    const hiddenFirstStageRx = await createRx(patient.id, serviceDate, true);

    await createTrackings(firstStageRx.id, [actions[0]]);
    await createTrackings(secondStageRx.id, actions.slice(0, 2));
    const duplicateRows = await createTrackings(
        duplicateStageRx.id,
        Array.from({ length: actions.length }, () => actions[0])
    );
    assert.strictEqual(
        duplicateRows.length,
        actions.length,
        'Duplicate-history fixture must contain totalSteps copies of the first action'
    );
    await createTrackings(completedRx.id, actions);
    await createTrackings(hiddenFirstStageRx.id, [actions[0]]);

    const pipelineAfter = await getPipeline();
    const afterByAction = stepCountMap(pipelineAfter);

    assert.strictEqual(
        Number(pipelineAfter.total) - Number(pipelineBefore.total),
        5,
        'Dashboard pipeline must exclude the hidden fixture from its total'
    );
    assert.strictEqual(
        Number(pipelineAfter.notStarted) - Number(pipelineBefore.notStarted),
        1,
        'Dashboard Not Started must include only the unstarted fixture'
    );
    assert.strictEqual(
        Number(pipelineAfter.inProgress) - Number(pipelineBefore.inProgress),
        3,
        'Dashboard In Progress must include stage 1, stage 2, and duplicate-history fixtures'
    );
    assert.strictEqual(
        Number(pipelineAfter.completed) - Number(pipelineBefore.completed),
        1,
        'Only the fixture with every distinct active action may be Completed'
    );

    const allVisible = await getRxPage(patient.id, {});
    assert.strictEqual(allVisible.total, 5, 'RX Records default view must exclude the hidden fixture');
    assert.deepStrictEqual(
        sortedIds(allVisible.rows),
        [
            unstartedRx.id,
            firstStageRx.id,
            secondStageRx.id,
            duplicateStageRx.id,
            completedRx.id
        ].sort((a, b) => a - b)
    );

    const expectedByActionId = new Map(actions.map(action => [Number(action.id), []]));
    expectedByActionId.get(Number(actions[0].id)).push(firstStageRx.id, duplicateStageRx.id);
    expectedByActionId.get(Number(actions[1].id)).push(secondStageRx.id);
    expectedByActionId.get(Number(actions[actions.length - 1].id)).push(completedRx.id);

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

    const nextActionOne = await getRxPage(patient.id, { workflowStage: '1' });
    assert.deepStrictEqual(
        sortedIds(nextActionOne.rows),
        [unstartedRx.id],
        'Next Action 1 must contain only the unstarted fixture'
    );
    const firstStageDelta =
        Number(afterByAction.get(Number(actions[0].id))) -
        Number(beforeByAction.get(Number(actions[0].id)));
    assert.strictEqual(firstStageDelta, 2, 'Dashboard first Current Stage must contain two fixtures');
    assert.notStrictEqual(
        firstStageDelta,
        nextActionOne.total,
        'Dashboard Current Stage must not silently use Next Action Required counts'
    );

    const hiddenOnly = await getRxPage(patient.id, {
        includeDeleted: 'true',
        currentWorkflowStage: String(actions[0].sequenceNumber)
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
