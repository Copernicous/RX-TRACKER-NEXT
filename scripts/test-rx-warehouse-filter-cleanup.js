const assert = require('assert');
const { Op } = require('sequelize');
const {
  readConfig,
  assertQaDatabase,
  applyRuntimeEnv
} = require('../qa/lib/qa-env');

const config = readConfig();
assertQaDatabase(config);
applyRuntimeEnv(config);
process.env.BACKUP_SCHEDULER_ENABLED = 'false';
process.env.SITE_BACKUP_SCHEDULER_ENABLED = 'false';

const db = require('../models');
const rxController = require('../controllers/rxController');
const adminController = require('../controllers/adminController');

const runId = String(Date.now());
const startedAt = new Date();
let patient;
let returnedRx;
let activeRx;
let unstartedRx;
let stageTrackings = [];
let calledAudit;
let callAttempt;

function runHandler(handler, req) {
  return new Promise(resolve => {
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
    Promise.resolve(handler(req, res))
      .catch(error => resolve({ status: 500, payload: { error: error.message } }));
  });
}

async function cleanup() {
  if (callAttempt) {
    await db.CallCenterCallAttempt.destroy({ where: { id: callAttempt.id } }).catch(() => {});
  }
  if (calledAudit) {
    await db.AuditLog.destroy({ where: { id: calledAudit.id } }).catch(() => {});
  }
  await db.AuditLog.destroy({
    where: {
      module: 'Back Office',
      action: 'Call Center Cleanup Purge',
      createdAt: { [Op.gte]: startedAt }
    }
  }).catch(() => {});
  if (stageTrackings.length) {
    await db.RXWorkflowTracking.destroy({
      where: { id: stageTrackings.map(row => row.id) }
    }).catch(() => {});
  }
  const rxIds = [returnedRx?.id, activeRx?.id, unstartedRx?.id].filter(Boolean);
  if (rxIds.length) {
    await db.RXRecord.destroy({ where: { id: rxIds } }).catch(() => {});
  }
  if (patient) {
    await db.PatientServiceDateHistory.destroy({ where: { patientId: patient.id } }).catch(() => {});
    await db.PatientServiceDateCycle.destroy({ where: { patientId: patient.id } }).catch(() => {});
    await db.Patient.destroy({ where: { id: patient.id } }).catch(() => {});
  }
}

async function run() {
  await db.sequelize.authenticate();

  patient = await db.Patient.create({
    firstName: 'QA',
    lastName: `WAREHOUSE ${runId}`,
    dob: '1980-01-01',
    address: '100 QA Warehouse Way',
    phone: '555-0100',
    serviceDate: '2026-01-01',
    notes: 'Temporary warehouse filter test',
    isActive: true,
    isDeleted: false,
    patientCode: `QA-WH-${runId}`,
    isNonCompanyPatient: false
  });

  returnedRx = await db.RXRecord.create({
    patientId: patient.id,
    serviceDate: '2026-01-01',
    isDeleted: false,
    returnedToWarehouse: true,
    warehouseReturnDate: new Date(),
    warehouseReturnNote: 'Temporary returned fixture'
  });
  activeRx = await db.RXRecord.create({
    patientId: patient.id,
    serviceDate: '2026-01-01',
    isDeleted: false,
    returnedToWarehouse: false
  });

  let result = await runHandler(rxController.getAll, {
    query: {
      paginated: 'true',
      patientId: String(patient.id),
      warehouseStatus: 'returned',
      page: '1',
      pageSize: '10'
    }
  });
  assert.strictEqual(result.status, 200, result.payload?.error || 'Returned filter request failed');
  assert.deepStrictEqual(result.payload.rows.map(row => row.id), [returnedRx.id]);

  result = await runHandler(rxController.getAll, {
    query: {
      paginated: 'true',
      patientId: String(patient.id),
      warehouseStatus: 'not-returned',
      page: '1',
      pageSize: '10'
    }
  });
  assert.strictEqual(result.status, 200, result.payload?.error || 'Not-returned filter request failed');
  assert.deepStrictEqual(result.payload.rows.map(row => row.id), [activeRx.id]);

  result = await runHandler(rxController.getAll, {
    query: {
      patientId: String(patient.id),
      warehouseStatus: 'returned'
    }
  });
  assert.strictEqual(result.status, 200, result.payload?.error || 'Non-paginated returned filter request failed');
  assert.deepStrictEqual(result.payload.map(row => row.id), [returnedRx.id]);
  console.log('PASS: RX Records warehouse status filters');

  const workflowActions = await db.WorkflowAction.findAll({
    where: { isActive: true },
    order: [['sequenceNumber', 'ASC'], ['id', 'ASC']],
    limit: 2
  });
  assert.strictEqual(workflowActions.length, 2, 'Stage filter regression requires at least two active workflow actions');

  unstartedRx = await db.RXRecord.create({
    patientId: patient.id,
    serviceDate: '2026-01-01',
    isDeleted: false,
    returnedToWarehouse: false
  });
  stageTrackings = await db.RXWorkflowTracking.bulkCreate([
    {
      rxRecordId: returnedRx.id,
      workflowActionId: workflowActions[0].id,
      completionDate: new Date()
    },
    {
      rxRecordId: activeRx.id,
      workflowActionId: workflowActions[0].id,
      completionDate: new Date()
    },
    {
      rxRecordId: activeRx.id,
      workflowActionId: workflowActions[1].id,
      completionDate: new Date()
    }
  ], { returning: true });

  result = await runHandler(rxController.getAll, {
    query: {
      paginated: 'true',
      patientId: String(patient.id),
      workflowStage: '1',
      page: '1',
      pageSize: '10'
    }
  });
  assert.strictEqual(result.status, 200, result.payload?.error || 'Next required action 1 request failed');
  assert.deepStrictEqual(result.payload.rows.map(row => row.id), [unstartedRx.id]);

  result = await runHandler(rxController.getAll, {
    query: {
      paginated: 'true',
      patientId: String(patient.id),
      workflowStage: '2',
      page: '1',
      pageSize: '10'
    }
  });
  assert.strictEqual(result.status, 200, result.payload?.error || 'Next required action 2 request failed');
  assert.deepStrictEqual(result.payload.rows.map(row => row.id), [returnedRx.id]);

  result = await runHandler(rxController.getAll, {
    query: {
      paginated: 'true',
      patientId: String(patient.id),
      currentWorkflowStage: String(workflowActions[0].sequenceNumber),
      page: '1',
      pageSize: '10'
    }
  });
  assert.strictEqual(result.status, 200, result.payload?.error || 'Current stage 1 request failed');
  assert.deepStrictEqual(result.payload.rows.map(row => row.id), [returnedRx.id]);

  result = await runHandler(rxController.getAll, {
    query: {
      paginated: 'true',
      patientId: String(patient.id),
      currentWorkflowStage: String(workflowActions[1].sequenceNumber),
      page: '1',
      pageSize: '10'
    }
  });
  assert.strictEqual(result.status, 200, result.payload?.error || 'Current stage 2 request failed');
  assert.deepStrictEqual(result.payload.rows.map(row => row.id), [activeRx.id]);
  console.log('PASS: RX Records Current Stage and Next Action Required filters remain distinct');

  calledAudit = await db.AuditLog.create({
    date: new Date(),
    time: new Date().toTimeString().split(' ')[0],
    module: 'Call Center',
    action: 'Called',
    recordId: patient.id,
    newValue: { testRun: runId }
  });
  callAttempt = await db.CallCenterCallAttempt.create({
    patientId: patient.id,
    calledAuditLogId: calledAudit.id,
    correlationId: `qa-warehouse-${runId}`,
    phoneClient: 'rx_softphone',
    direction: 'outbound',
    state: 'ended',
    outcome: 'answered',
    patientCode: patient.patientCode,
    patientName: `${patient.firstName} ${patient.lastName}`,
    agentName: 'QA Warehouse Test',
    extension: '1006',
    dialedNumber: patient.phone,
    dialedAt: new Date(),
    answeredAt: new Date(),
    endedAt: new Date(),
    ringDurationSeconds: 1,
    conversationDurationSeconds: 1
  });

  result = await runHandler(adminController.getCallCenterCleanupPreview, {
    query: { target: 'calls', patientId: String(patient.id) }
  });
  assert.strictEqual(result.status, 200, result.payload?.error || 'Cleanup preview failed');
  assert.strictEqual(result.payload.counts.callAttempts, 1);
  assert.strictEqual(result.payload.counts.callEvents, 1);
  assert.strictEqual(result.payload.counts.total, 2);

  result = await runHandler(adminController.purgeCallCenterCleanup, {
    body: {
      target: 'calls',
      patientId: String(patient.id),
      confirmText: 'PURGE CALL CENTER'
    },
    user: null,
    ip: '127.0.0.1'
  });
  assert.strictEqual(result.status, 200, result.payload?.error || 'Cleanup purge failed');
  assert.strictEqual(result.payload.results.callAttempts, 1);
  assert.strictEqual(result.payload.results.callEvents, 1);
  assert.strictEqual(await db.CallCenterCallAttempt.count({ where: { id: callAttempt.id } }), 0);
  assert.strictEqual(await db.AuditLog.count({ where: { id: calledAudit.id } }), 0);
  assert.strictEqual(await db.RXRecord.count({ where: { id: [returnedRx.id, activeRx.id] } }), 2);
  console.log('PASS: Calls Only cleanup removes attempts and call events while preserving RX records');
}

run()
  .then(async () => {
    await cleanup();
    await db.sequelize.close();
    console.log('RX warehouse filter and Call Center cleanup regression checks passed.');
  })
  .catch(async error => {
    console.error(error.stack || error.message);
    await cleanup();
    await db.sequelize.close().catch(() => {});
    process.exit(1);
  });
