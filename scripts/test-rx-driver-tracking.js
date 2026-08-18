'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { Op } = require('sequelize');
const {
  readConfig,
  assertQaDatabase,
  applyRuntimeEnv
} = require('../qa/lib/qa-env');

const config = readConfig();
assertQaDatabase(config);
if (!/(driver.*(?:qa|test)|(?:qa|test).*driver)/i.test(String(config.dbName || ''))) {
  throw new Error(
    `Refusing RX driver tracking regression on "${config.dbName}"; ` +
    'set QA_DB_NAME to a dedicated database name containing both "driver" and "qa" or "test".'
  );
}
applyRuntimeEnv(config);
process.env.BACKUP_SCHEDULER_ENABLED = 'false';
process.env.SITE_BACKUP_SCHEDULER_ENABLED = 'false';

const db = require('../models');
const { assertDatabaseReady } = require('../db/schema-verifier');
const rbac = require('../middleware/rbac');
const auditLogger = require('../middleware/auditLogger');
const auditLogController = require('../controllers/auditLogController');
const dashboardController = require('../controllers/dashboardController');
const deliveryOutcomeController = require('../controllers/deliveryOutcomeController');
const patientController = require('../controllers/patientController');
const reportController = require('../controllers/reportController');
const rxController = require('../controllers/rxController');

const runId = `${Date.now().toString(36)}-${process.pid}`;
const created = {
  roleIds: [],
  userIds: [],
  patientId: null,
  rxId: null,
  driverIds: [],
  auditIds: [],
  workflowActionIds: []
};

function localDateOnly(value = new Date()) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function mockReq(user, body = {}, params = {}) {
  return {
    user: {
      id: user.id,
      username: user.username,
      role: user.Role.name
    },
    body,
    params,
    query: {},
    method: 'GET',
    headers: { accept: 'application/json' },
    path: '/api/rx-records'
  };
}

function runHandler(handler, req) {
  return new Promise(resolve => {
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      set() {
        return this;
      },
      json(payload) {
        resolve({ status: this.statusCode, payload, req });
      },
      send(payload) {
        resolve({ status: this.statusCode, payload, req });
      }
    };
    Promise.resolve(handler(req, res))
      .catch(error => resolve({ status: 500, payload: { error: error.message }, req }));
  });
}

function runMiddleware(middleware, req) {
  return new Promise(resolve => {
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        resolve({ ok: false, status: this.statusCode, payload });
      }
    };
    Promise.resolve(middleware(req, res, () => resolve({ ok: true, status: 200 })))
      .catch(error => resolve({ ok: false, status: 500, payload: { error: error.message } }));
  });
}

function assertStatus(result, expected, label) {
  const detail = result && result.payload && (result.payload.error || result.payload.message);
  assert.strictEqual(
    result.status,
    expected,
    `${label}: expected HTTP ${expected}, received ${result.status}${detail ? ` (${detail})` : ''}`
  );
}

async function requireWorkflowActions() {
  const rows = await db.WorkflowAction.findAll({
    where: { sequenceNumber: { [Op.in]: [1, 2, 3] } },
    order: [['sequenceNumber', 'ASC'], ['id', 'ASC']]
  });
  const bySequence = new Map();
  for (const row of rows) {
    const sequence = Number(row.sequenceNumber);
    assert(!bySequence.has(sequence), `Driver regression requires exactly one workflow action at sequence ${sequence}.`);
    bySequence.set(sequence, row);
  }
  for (const sequence of [1, 2, 3]) {
    const action = bySequence.get(sequence);
    assert(action, `Reference data must provide a workflow action at sequence ${sequence}.`);
    assert.strictEqual(action.isActive, true, `Workflow action ${sequence} must be active for this regression.`);
  }
  return [bySequence.get(1), bySequence.get(2), bySequence.get(3)];
}

async function getTracking(rxId, actionId) {
  return db.RXWorkflowTracking.findOne({
    where: { rxRecordId: rxId, workflowActionId: actionId }
  });
}

async function getDriverHistory(rxId) {
  return db.RXDriverAssignmentHistory.findAll({
    where: { rxRecordId: rxId },
    order: [['id', 'ASC']]
  });
}

async function assertCurrentDriver(rxId, driver, label) {
  const rx = await db.RXRecord.findByPk(rxId);
  assert(rx, `${label}: RX record was not found.`);
  assert.strictEqual(Number(rx.pharmacyTransportCompanyId), Number(driver.id), `${label}: unexpected Pharmacy Transportation assignment.`);
  return rx;
}

async function assertStageDriver(rxId, action, driver, label) {
  const tracking = await getTracking(rxId, action.id);
  assert(tracking, `${label}: workflow stage ${action.sequenceNumber} was not found.`);
  assert.strictEqual(Number(tracking.driverId), Number(driver.id), `${label}: unexpected stage driver ID.`);
  assert.strictEqual(tracking.driverNameSnapshot, driver.name, `${label}: unexpected stage driver snapshot.`);
  return tracking;
}

async function createFixtures(actions) {
  const permissions = {
    rx_records: {
      visible: true,
      canAdd: true,
      canEdit: true,
      canUndo: true,
      canWarehouse: true,
      canViewDriverHistory: true,
      canAssignDriver: true,
      canCorrectDriver: true,
      canSyncDriverHistory: true
    },
    drivers: {
      visible: true,
      canAdd: true,
      canEdit: true,
      canDelete: true
    },
    audit_log: {
      visible: true
    }
  };
  const role = await db.Role.create({
    name: `QA Driver Role ${runId}`,
    description: 'Temporary role for RX driver tracking regression',
    isSystem: false,
    permissions
  });
  created.roleIds.push(role.id);

  const user = await db.User.create({
    firstName: 'QA',
    lastName: 'DRIVER',
    username: `qa_driver_${runId}`,
    passwordHash: 'not-used',
    roleId: role.id,
    isActive: true,
    tokenVersion: 0
  });
  created.userIds.push(user.id);
  user.Role = role;

  const restrictedRole = await db.Role.create({
    name: `QA Driver Restricted Role ${runId}`,
    description: 'Temporary role without RX driver-history or Driver delete permission',
    isSystem: false,
    permissions: {
      rx_records: {
        visible: true,
        canViewDriverHistory: false
      },
      drivers: {
        visible: true,
        canEdit: true,
        canDelete: false
      },
      audit_log: {
        visible: true
      }
    }
  });
  created.roleIds.push(restrictedRole.id);
  const restrictedUser = await db.User.create({
    firstName: 'QA',
    lastName: 'DRIVER RESTRICTED',
    username: `qa_driver_restricted_${runId}`,
    passwordHash: 'not-used',
    roleId: restrictedRole.id,
    isActive: true,
    tokenVersion: 0
  });
  created.userIds.push(restrictedUser.id);
  restrictedUser.Role = restrictedRole;

  const drivers = await db.PharmacyTransportCompany.bulkCreate([
    { companyName: `QA Transport A ${runId}`, contactPerson: `QA Driver A ${runId}`, isActive: true },
    { companyName: `QA Transport B ${runId}`, contactPerson: `QA Driver B ${runId}`, isActive: true },
    { companyName: `QA Transport C ${runId}`, contactPerson: `QA Driver C ${runId}`, isActive: true },
    { companyName: `QA Transport D ${runId}`, contactPerson: `QA Driver D Inactive ${runId}`, isActive: false }
  ], { returning: true });
  drivers.forEach(driver => { driver.name = driver.contactPerson || driver.companyName; });
  created.driverIds = drivers.map(driver => driver.id);
  const [driverA, driverB, driverC, inactiveDriverD] = drivers;

  const serviceDate = localDateOnly();
  const patient = await db.Patient.create({
    firstName: 'QA',
    lastName: `DRIVER ${runId}`,
    dob: '1980-01-01',
    address: '100 Driver Regression Way',
    phone: '555-0199',
    serviceDate,
    notes: 'Temporary RX driver tracking regression fixture',
    isActive: true,
    isDeleted: false,
    patientCode: `QA-DRV-${runId}`.slice(0, 60),
    isNonCompanyPatient: false
  });
  created.patientId = patient.id;

  const createResult = await runHandler(
    rxController.create,
    mockReq(user, {
      patientId: patient.id,
      arrivalDate: serviceDate,
      serviceDate,
      pharmacyTransportCompanyId: driverA.id,
      medications: []
    })
  );
  assertStatus(createResult, 201, 'Create RX with Driver A');
  created.rxId = createResult.payload.id;
  assert(created.rxId, 'RX create response must include an ID.');

  const stage1 = await assertStageDriver(created.rxId, actions[0], driverA, 'Initial Stage 1 snapshot');
  await assertCurrentDriver(created.rxId, driverA, 'Initial current assignment');
  const initialHistory = await getDriverHistory(created.rxId);
  assert.strictEqual(initialHistory.length, 2, 'RX creation must write current-assignment and Stage 1 snapshot ledger rows.');
  assert.deepStrictEqual(
    initialHistory.map(item => item.changeType).sort(),
    ['current_assignment', 'stage_snapshot']
  );

  return { user, restrictedUser, driverA, driverB, driverC, inactiveDriverD, stage1 };
}

async function runScenario(actions, fixtures) {
  const { user, driverA, driverB, driverC, inactiveDriverD } = fixtures;
  const rxId = created.rxId;

  let result = await runHandler(
    rxController.updateCurrentDriver,
    mockReq(user, {
      driverId: driverB.id,
      expectedCurrentDriverId: driverA.id,
      reason: 'Driver B takes over after Stage 1.'
    }, { id: rxId })
  );
  assertStatus(result, 200, 'Assign current Driver B');
  assert.strictEqual(result.payload.changed, true);
  await assertCurrentDriver(rxId, driverB, 'Current assignment after takeover');
  await assertStageDriver(rxId, actions[0], driverA, 'Stage 1 remains Driver A after current assignment changes');

  let historyCount = (await getDriverHistory(rxId)).length;
  result = await runHandler(
    rxController.updateCurrentDriver,
    mockReq(user, {
      driverId: driverB.id,
      expectedCurrentDriverId: driverB.id,
      reason: 'No-op assignment regression.'
    }, { id: rxId })
  );
  assertStatus(result, 200, 'No-op current driver assignment');
  assert.strictEqual(result.payload.changed, false);
  assert.strictEqual((await getDriverHistory(rxId)).length, historyCount, 'A no-op assignment must not append ledger history.');
  assert.strictEqual(result.req.skipAuditLog, true, 'A no-op assignment must suppress middleware audit noise.');

  result = await runHandler(
    rxController.updateWorkflow,
    mockReq(user, { rxId, actionId: actions[1].id })
  );
  assertStatus(result, 200, 'Complete Stage 2');
  const stage2 = await assertStageDriver(rxId, actions[1], driverB, 'Stage 2 snapshots current Driver B');

  result = await runHandler(
    rxController.correctWorkflowDriver,
    mockReq(user, {
      trackingId: fixtures.stage1.id,
      driverId: driverC.id,
      expectedDriverId: driverA.id,
      reason: 'Stage 1 was recorded against the wrong driver.'
    })
  );
  assertStatus(result, 200, 'Correct Stage 1 from Driver A to Driver C');
  assert.strictEqual(result.payload.changed, true);
  await assertStageDriver(rxId, actions[0], driverC, 'Corrected Stage 1');
  await assertStageDriver(rxId, actions[1], driverB, 'Stage 2 remains Driver B after Stage 1 correction');
  await assertCurrentDriver(rxId, driverB, 'Current Driver B remains unchanged by historical correction');

  historyCount = (await getDriverHistory(rxId)).length;
  result = await runHandler(
    rxController.correctWorkflowDriver,
    mockReq(user, {
      trackingId: fixtures.stage1.id,
      driverId: inactiveDriverD.id,
      expectedDriverId: driverA.id,
      reason: 'Stale Stage 1 correction must be rejected.'
    })
  );
  assertStatus(result, 409, 'Reject stale Stage 1 expected driver');
  assert.strictEqual(result.payload.code, 'RX_STAGE_DRIVER_STALE');
  await assertStageDriver(rxId, actions[0], driverC, 'Stale correction leaves Stage 1 unchanged');
  assert.strictEqual((await getDriverHistory(rxId)).length, historyCount, 'A stale stage correction must not append ledger history.');

  result = await runHandler(
    rxController.updateWorkflow,
    mockReq(user, { rxId, actionId: actions[2].id })
  );
  assertStatus(result, 200, 'Complete Stage 3');
  const stage3 = await assertStageDriver(rxId, actions[2], driverB, 'Stage 3 continues with current Driver B');

  historyCount = (await getDriverHistory(rxId)).length;
  result = await runHandler(
    rxController.updateCurrentDriver,
    mockReq(user, {
      driverId: driverC.id,
      expectedCurrentDriverId: driverA.id,
      reason: 'Stale current assignment must be rejected.'
    }, { id: rxId })
  );
  assertStatus(result, 409, 'Reject stale current expected driver');
  assert.strictEqual(result.payload.code, 'RX_DRIVER_ASSIGNMENT_STALE');
  await assertCurrentDriver(rxId, driverB, 'Stale current assignment leaves Driver B unchanged');
  assert.strictEqual((await getDriverHistory(rxId)).length, historyCount, 'A stale current assignment must not append ledger history.');

  result = await runHandler(
    rxController.updateCurrentDriver,
    mockReq(user, {
      driverId: inactiveDriverD.id,
      expectedCurrentDriverId: driverB.id,
      reason: 'Inactive drivers cannot receive live assignments.'
    }, { id: rxId })
  );
  assertStatus(result, 400, 'Reject inactive current driver assignment');
  await assertCurrentDriver(rxId, driverB, 'Inactive current assignment is rejected');
  assert.strictEqual((await getDriverHistory(rxId)).length, historyCount, 'Rejected inactive assignment must not append ledger history.');

  result = await runHandler(
    rxController.correctWorkflowDriver,
    mockReq(user, {
      trackingId: fixtures.stage1.id,
      driverId: inactiveDriverD.id,
      expectedDriverId: driverC.id,
      reason: 'Archived dispatch evidence confirms inactive Driver D handled Stage 1.'
    })
  );
  assertStatus(result, 200, 'Allow inactive driver for historical correction');
  assert.strictEqual(result.payload.changed, true);
  await assertStageDriver(rxId, actions[0], inactiveDriverD, 'Stage 1 accepts inactive historical Driver D');
  await assertStageDriver(rxId, actions[1], driverB, 'Inactive historical correction leaves Stage 2 unchanged');
  await assertStageDriver(rxId, actions[2], driverB, 'Inactive historical correction leaves Stage 3 unchanged');
  await assertCurrentDriver(rxId, driverB, 'Inactive historical correction leaves current Driver B unchanged');

  historyCount = (await getDriverHistory(rxId)).length;
  result = await runHandler(
    rxController.correctWorkflowDriver,
    mockReq(user, {
      trackingId: fixtures.stage1.id,
      driverId: inactiveDriverD.id,
      expectedDriverId: inactiveDriverD.id,
      reason: 'No-op historical correction regression.'
    })
  );
  assertStatus(result, 200, 'No-op historical correction');
  assert.strictEqual(result.payload.changed, false);
  assert.strictEqual(result.req.skipAuditLog, true, 'A no-op stage correction must suppress middleware audit noise.');
  assert.strictEqual((await getDriverHistory(rxId)).length, historyCount, 'A no-op stage correction must not append ledger history.');

  result = await runHandler(
    rxController.syncWorkflowDrivers,
    mockReq(user, {
      expectedCurrentDriverId: driverA.id,
      reason: 'Stale synchronization must be rejected.'
    }, { id: rxId })
  );
  assertStatus(result, 409, 'Reject stale synchronization expected driver');
  assert.strictEqual(result.payload.code, 'RX_DRIVER_SYNC_STALE');
  await assertStageDriver(rxId, actions[0], inactiveDriverD, 'Stale sync leaves Stage 1 unchanged');
  assert.strictEqual((await getDriverHistory(rxId)).length, historyCount, 'A stale sync must not append ledger history.');

  result = await runHandler(
    rxController.syncWorkflowDrivers,
    mockReq(user, {
      expectedCurrentDriverId: driverB.id,
      reason: 'Recovery synchronization to the current driver.'
    }, { id: rxId })
  );
  assertStatus(result, 200, 'Synchronize completed stages to current Driver B');
  assert.strictEqual(result.payload.changedCount, 1, 'Only corrected Stage 1 should require synchronization.');
  await assertStageDriver(rxId, actions[0], driverB, 'Synchronization updates Stage 1 to Driver B');
  await assertStageDriver(rxId, actions[1], driverB, 'Synchronization preserves matching Stage 2');
  await assertStageDriver(rxId, actions[2], driverB, 'Synchronization preserves matching Stage 3');
  const syncRows = (await getDriverHistory(rxId)).filter(item => item.changeType === 'stage_sync');
  assert.strictEqual(syncRows.length, 1, 'Synchronization must append one ledger row per changed stage.');
  assert.strictEqual(Number(syncRows[0].previousDriverId), Number(inactiveDriverD.id));
  assert.strictEqual(Number(syncRows[0].driverId), Number(driverB.id));

  historyCount = (await getDriverHistory(rxId)).length;
  result = await runHandler(
    rxController.syncWorkflowDrivers,
    mockReq(user, {
      expectedCurrentDriverId: driverB.id,
      reason: 'No-op synchronization regression.'
    }, { id: rxId })
  );
  assertStatus(result, 200, 'No-op synchronization');
  assert.strictEqual(result.payload.changedCount, 0);
  assert.strictEqual(result.req.skipAuditLog, true, 'A no-op sync must suppress middleware audit noise.');
  assert.strictEqual((await getDriverHistory(rxId)).length, historyCount, 'A no-op sync must not append ledger history.');

  const beforeUndo = await getDriverHistory(rxId);
  const stage3Snapshot = beforeUndo.find(item =>
    item.changeType === 'stage_snapshot' && Number(item.workflowTrackingId) === Number(stage3.id)
  );
  assert(stage3Snapshot, 'Stage 3 snapshot ledger row must exist before undo.');
  result = await runHandler(
    rxController.undoWorkflow,
    mockReq(user, { rxId })
  );
  assertStatus(result, 200, 'Undo Stage 3');
  assert.strictEqual(await getTracking(rxId, actions[2].id), null, 'Undo must remove Stage 3 tracking.');
  assert(await getTracking(rxId, actions[1].id), 'Undo must preserve Stage 2 tracking.');
  const afterUndo = await getDriverHistory(rxId);
  const afterUndoIds = new Set(afterUndo.map(item => Number(item.id)));
  beforeUndo.forEach(item => assert(afterUndoIds.has(Number(item.id)), `Undo removed ledger row ${item.id}.`));
  const persistedStage3Snapshot = afterUndo.find(item => Number(item.id) === Number(stage3Snapshot.id));
  assert.strictEqual(persistedStage3Snapshot.workflowTrackingId, null, 'Deleted Stage 3 must detach, not delete, its snapshot ledger row.');
  const undoRows = afterUndo.filter(item => item.changeType === 'stage_undo' && Number(item.workflowActionId) === Number(actions[2].id));
  assert.strictEqual(undoRows.length, 1, 'Undo must append one Stage 3 undo ledger row.');
  assert.strictEqual(undoRows[0].workflowTrackingId, null, 'Undo ledger row must survive deletion of its tracking row.');
  assert.strictEqual(Number(undoRows[0].previousDriverId), Number(driverB.id));

  const stage1BeforeReset = await getTracking(rxId, actions[0].id);
  const stage2BeforeReset = await getTracking(rxId, actions[1].id);
  const beforeReset = await getDriverHistory(rxId);
  result = await runHandler(
    rxController.returnToWarehouse,
    mockReq(user, { rxId, note: 'Reset preservation regression.' })
  );
  assertStatus(result, 200, 'Return RX to warehouse');
  await assertCurrentDriver(rxId, driverB, 'Warehouse reset preserves current Driver B');
  const remainingTrackings = await db.RXWorkflowTracking.findAll({ where: { rxRecordId: rxId } });
  assert.strictEqual(remainingTrackings.length, 1, 'Warehouse reset must recreate only Stage 1.');
  const resetStage1 = await assertStageDriver(rxId, actions[0], driverB, 'Recreated Stage 1 snapshots current Driver B');
  assert.notStrictEqual(Number(resetStage1.id), Number(stage1BeforeReset.id), 'Warehouse reset must create a new Stage 1 tracking row.');

  const afterReset = await getDriverHistory(rxId);
  const afterResetIds = new Set(afterReset.map(item => Number(item.id)));
  beforeReset.forEach(item => assert(afterResetIds.has(Number(item.id)), `Warehouse reset removed ledger row ${item.id}.`));
  const resetRows = afterReset.filter(item => item.changeType === 'stage_reset');
  assert.strictEqual(resetRows.length, 2, 'Warehouse reset must append one ledger row for each removed stage.');
  for (const trackingId of [stage1BeforeReset.id, stage2BeforeReset.id]) {
    const detachedRows = afterReset.filter(item => Number(item.workflowTrackingId) === Number(trackingId));
    assert.strictEqual(detachedRows.length, 0, `Ledger rows must detach from removed tracking ${trackingId}.`);
  }
  const recreatedSnapshot = afterReset.find(item =>
    item.changeType === 'stage_snapshot' && Number(item.workflowTrackingId) === Number(resetStage1.id)
  );
  assert(recreatedSnapshot, 'Warehouse reset must append a snapshot for recreated Stage 1.');
  assert.strictEqual(Number(recreatedSnapshot.driverId), Number(driverB.id));

  console.log('PASS: A at Stage 1 -> current B -> Stage 2 B -> Stage 1 corrected to C without changing Stage 2/current.');
  console.log('PASS: Stage 3 continues B; inactive historical correction, stale IDs, sync, and no-op behavior are guarded.');
  console.log('PASS: Driver ledger survives Stage 3 undo and return-to-warehouse reset while current Driver B is preserved.');
}

function plainHistoryRows(rows) {
  return (rows || []).map(row => row && typeof row.toJSON === 'function' ? row.toJSON() : row);
}

function parseHistoryJson(value) {
  if (value === null || value === undefined || value === '') return null;
  return typeof value === 'string' ? JSON.parse(value) : value;
}

function containsDriverField(value) {
  if (Array.isArray(value)) return value.some(containsDriverField);
  if (!value || typeof value !== 'object') return false;
  if (typeof value.field === 'string' && /driver/i.test(value.field)) return true;
  return Object.entries(value).some(([key, item]) => /driver/i.test(key) || containsDriverField(item));
}

async function assertGenericHistoryPermissions(fixtures) {
  const { user, restrictedUser, driverA, driverB } = fixtures;
  const rxId = created.rxId;
  const ordinaryRows = await db.RXHistory.findAll({
    where: {
      rxRecordId: rxId,
      changeType: { [Op.notIn]: ['Driver Assignment', 'Driver Correction', 'Driver Sync'] }
    }
  });
  assert(
    ordinaryRows.every(row => !/;\s*driver\s*:/i.test(String(row.note || ''))),
    'New generic workflow notes must not duplicate driver details.'
  );

  const rxSource = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'rxController.js'), 'utf8');
  const deliverySource = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'deliveryOutcomeController.js'), 'utf8');
  assert(!rxSource.includes('; driver: ${'), 'RX workflow history notes must not append driver names.');
  assert(!deliverySource.includes('; driver: ${'), 'Delivery-outcome history notes must not append driver names.');

  const legacyRow = await db.RXHistory.create({
    rxRecordId: rxId,
    userId: user.id,
    changeType: 'Workflow',
    snapshot: JSON.stringify({
      id: rxId,
      serviceDate: localDateOnly(),
      currentDriverId: driverB.id,
      nested: { driverNameSnapshot: driverB.name }
    }),
    changedFields: JSON.stringify([
      { field: 'currentDriver', from: driverA.name, to: driverB.name },
      { field: 'serviceDate', from: '2026-01-01', to: '2026-01-02' }
    ]),
    note: `Legacy workflow note; driver: ${driverB.name}`
  });

  let result = await runHandler(
    rxController.getHistory,
    mockReq(user, {}, { id: rxId })
  );
  assertStatus(result, 200, 'Generic RX history with driver-history permission');
  const allowedRows = plainHistoryRows(result.payload);
  assert(
    allowedRows.some(row => /^Driver (Assignment|Correction|Sync)$/i.test(String(row.changeType || ''))),
    'Users with canViewDriverHistory must retain driver-specific generic history rows.'
  );
  const allowedLegacy = allowedRows.find(row => Number(row.id) === Number(legacyRow.id));
  assert(allowedLegacy, 'Permitted history response must include the legacy generic row.');
  assert.strictEqual(Number(parseHistoryJson(allowedLegacy.snapshot).currentDriverId), Number(driverB.id));
  assert.match(String(allowedLegacy.note || ''), new RegExp(driverB.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  result = await runHandler(
    rxController.getHistory,
    mockReq(restrictedUser, {}, { id: rxId })
  );
  assertStatus(result, 200, 'Generic RX history without driver-history permission');
  const restrictedRows = plainHistoryRows(result.payload);
  assert(
    restrictedRows.every(row => !/^Driver/i.test(String(row.changeType || ''))),
    'Users without canViewDriverHistory must not receive driver-specific generic history rows.'
  );
  for (const row of restrictedRows) {
    assert(!containsDriverField(parseHistoryJson(row.snapshot)), `History snapshot ${row.id} exposed a driver field.`);
    assert(!containsDriverField(parseHistoryJson(row.changedFields)), `History changes ${row.id} exposed a driver field.`);
    assert(!/driver/i.test(String(row.note || '')), `History note ${row.id} exposed driver information.`);
  }
  const restrictedLegacy = restrictedRows.find(row => Number(row.id) === Number(legacyRow.id));
  assert(restrictedLegacy, 'A generic legacy workflow row must remain visible after driver redaction.');
  assert.strictEqual(restrictedLegacy.note, null, 'A legacy note containing driver details must be redacted.');
  assert.strictEqual(parseHistoryJson(restrictedLegacy.snapshot).currentDriverId, undefined);
  assert.deepStrictEqual(
    parseHistoryJson(restrictedLegacy.changedFields).map(item => item.field),
    ['serviceDate'],
    'Driver-specific changed-field entries must be removed without hiding unrelated changes.'
  );

  console.log('PASS: Generic RX history enforces canViewDriverHistory and redacts legacy driver fields and notes.');
}

async function assertAuditLogDriverVisibility(fixtures) {
  const { user, restrictedUser, driverA, driverB } = fixtures;
  const marker = `QA${runId}`;
  const sensitiveAction = `${marker}DriverSensitive`;
  const visibleAction = `${marker}Visible`;
  const nullModuleAction = `${marker}NullModule`;
  const now = new Date();
  const rows = await db.AuditLog.bulkCreate([
    {
      userId: user.id,
      date: localDateOnly(now),
      time: now.toTimeString().split(' ')[0],
      module: 'RX Driver',
      action: sensitiveAction,
      recordId: created.rxId,
      previousValue: { driverId: driverA.id, driverName: driverA.name },
      newValue: {
        driverId: driverB.id,
        driverName: driverB.name,
        reason: 'Sensitive correction reason'
      },
      ipAddress: '127.0.0.1'
    },
    {
      userId: restrictedUser.id,
      date: localDateOnly(now),
      time: now.toTimeString().split(' ')[0],
      module: 'RX Records',
      action: visibleAction,
      recordId: created.rxId,
      previousValue: null,
      newValue: { status: 'Visible control row' },
      ipAddress: '127.0.0.1'
    },
    {
      userId: restrictedUser.id,
      date: localDateOnly(now),
      time: now.toTimeString().split(' ')[0],
      module: null,
      action: nullModuleAction,
      recordId: created.rxId,
      previousValue: null,
      newValue: { status: 'Visible module-less control row' },
      ipAddress: '127.0.0.1'
    }
  ], { returning: true });
  created.auditIds.push(...rows.map(row => row.id));

  function auditReq(requestUser, query = {}) {
    const req = mockReq(requestUser);
    req.query = query;
    return req;
  }

  let result = await runHandler(
    auditLogController.getAll,
    auditReq(user, { action: marker, limit: '100', offset: '0' })
  );
  assertStatus(result, 200, 'Audit log with driver-history permission');
  assert.strictEqual(result.payload.total, 3, 'Permitted audit query must include RX Driver and control rows.');
  assert(result.payload.data.some(row => row.module === 'RX Driver'));

  result = await runHandler(
    auditLogController.getAll,
    auditReq(restrictedUser, { action: marker, limit: '100', offset: '0' })
  );
  assertStatus(result, 200, 'Audit log without driver-history permission');
  assert.strictEqual(result.payload.total, 2, 'Restricted audit total must exclude only RX Driver rows.');
  assert(!result.payload.data.some(row => row.module === 'RX Driver'));
  assert(result.payload.data.some(row => row.module === 'RX Records'));
  assert(result.payload.data.some(row => row.module === null), 'Module-less non-driver audit rows must remain visible.');

  result = await runHandler(
    auditLogController.getAll,
    auditReq(restrictedUser, { module: 'RX Driver', action: marker, exportAll: 'true' })
  );
  assertStatus(result, 200, 'Restricted explicit RX Driver audit filter');
  assert.strictEqual(result.payload.total, 0);
  assert.deepStrictEqual(result.payload.data, []);

  result = await runHandler(auditLogController.getModules, auditReq(user));
  assertStatus(result, 200, 'Audit module metadata with driver-history permission');
  assert(result.payload.includes('RX Driver'), 'Permitted module metadata must include RX Driver.');
  result = await runHandler(auditLogController.getModules, auditReq(restrictedUser));
  assertStatus(result, 200, 'Audit module metadata without driver-history permission');
  assert(!result.payload.includes('RX Driver'), 'Restricted module metadata must exclude RX Driver.');

  result = await runHandler(auditLogController.getActions, auditReq(user));
  assertStatus(result, 200, 'Audit action metadata with driver-history permission');
  assert(result.payload.includes(sensitiveAction));
  assert(result.payload.includes(visibleAction));
  assert(result.payload.includes(nullModuleAction));
  result = await runHandler(auditLogController.getActions, auditReq(restrictedUser));
  assertStatus(result, 200, 'Audit action metadata without driver-history permission');
  assert(!result.payload.includes(sensitiveAction), 'Restricted action metadata must exclude RX Driver-only actions.');
  assert(result.payload.includes(visibleAction), 'Restricted action metadata must preserve visible actions.');
  assert(result.payload.includes(nullModuleAction), 'Restricted action metadata must preserve module-less non-driver actions.');

  result = await runHandler(auditLogController.getUsers, auditReq(user));
  assertStatus(result, 200, 'Audit user metadata with driver-history permission');
  assert(result.payload.some(item => Number(item.id) === Number(user.id)));
  assert(result.payload.some(item => Number(item.id) === Number(restrictedUser.id)));
  result = await runHandler(auditLogController.getUsers, auditReq(restrictedUser));
  assertStatus(result, 200, 'Audit user metadata without driver-history permission');
  assert(!result.payload.some(item => Number(item.id) === Number(user.id)), 'RX Driver-only users must not leak through restricted filter metadata.');
  assert(result.payload.some(item => Number(item.id) === Number(restrictedUser.id)));

  console.log('PASS: Audit rows and filter metadata exclude RX Driver events without canViewDriverHistory.');
}

function findTrackingPayload(rxPayload, trackingId) {
  return (rxPayload.RXWorkflowTrackings || []).find(item => Number(item.id) === Number(trackingId));
}

function assertTrackingDriverVisible(rxPayload, trackingId, driver, label) {
  const tracking = findTrackingPayload(rxPayload, trackingId);
  assert(tracking, `${label}: completed tracking was not returned.`);
  assert.strictEqual(Number(tracking.driverId), Number(driver.id), `${label}: driver ID was not exposed.`);
  assert.strictEqual(tracking.driverNameSnapshot, driver.name, `${label}: driver snapshot was not exposed.`);
  assert(tracking.Driver, `${label}: Driver association was not exposed.`);
  assert.strictEqual(Number(tracking.Driver.id), Number(driver.id), `${label}: unexpected Driver association.`);
}

function assertTrackingDriverRedacted(rxPayload, trackingId, label) {
  const tracking = findTrackingPayload(rxPayload, trackingId);
  assert(tracking, `${label}: completed tracking was not returned.`);
  assert(!Object.prototype.hasOwnProperty.call(tracking, 'driverId'), `${label}: driverId was exposed.`);
  assert(!Object.prototype.hasOwnProperty.call(tracking, 'driverNameSnapshot'), `${label}: driverNameSnapshot was exposed.`);
  assert(!Object.prototype.hasOwnProperty.call(tracking, 'Driver'), `${label}: Driver association was exposed.`);
}

async function assertGenericWorkflowAuditHasNoDriver(user, rxId) {
  const originalCreate = db.AuditLog.create;
  let captured = null;
  try {
    db.AuditLog.create = function (values) {
      captured = values;
      return Promise.resolve(values);
    };

    const req = mockReq(user, { rxId, note: 'Generic audit privacy regression.' });
    req.method = 'POST';
    req.path = '/api/rx-records/undo-workflow';
    req.ip = '127.0.0.1';
    let nextCalled = false;
    const res = {
      statusCode: 200,
      json(payload) {
        return payload;
      }
    };

    await auditLogger.auditLog('RX Workflow')(req, res, () => {
      nextCalled = true;
    });
    assert.strictEqual(nextCalled, true, 'RX Workflow audit middleware must continue to the controller.');
    res.json({ ok: true });
    assert(captured, 'RX Workflow audit middleware must emit an audit record.');

    const previousValue = parseHistoryJson(captured.previousValue);
    const newValue = parseHistoryJson(captured.newValue);
    assert(!containsDriverField(previousValue), 'Generic RX Workflow audit previousValue exposed driver data.');
    assert(!containsDriverField(newValue), 'Generic RX Workflow audit newValue exposed driver data.');
  } finally {
    db.AuditLog.create = originalCreate;
  }
}

function assertTrackingSerializerAllowlists() {
  const controllerDir = path.join(__dirname, '..', 'controllers');
  const expectedAttributes = "attributes: ['id', 'rxRecordId', 'workflowActionId', 'completionDate', 'userId', 'createdAt', 'updatedAt']";
  for (const fileName of ['dashboardController.js', 'patientController.js', 'reportController.js']) {
    const source = fs.readFileSync(path.join(controllerDir, fileName), 'utf8');
    const includeCount = (source.match(/model:\s*db\.RXWorkflowTracking/g) || []).length;
    const allowlistedIncludeCount = (source.match(/model:\s*db\.RXWorkflowTracking,\s*\r?\n\s*attributes:\s*\[/g) || []).length;
    assert.strictEqual(
      allowlistedIncludeCount,
      includeCount,
      `${fileName} must explicitly allowlist every serialized RX workflow tracking include.`
    );
    assert(
      source.includes(expectedAttributes),
      `${fileName} must retain only the pre-driver tracking fields used by that consumer.`
    );
  }

  const reportSource = fs.readFileSync(path.join(controllerDir, 'reportController.js'), 'utf8');
  assert.match(
    reportSource,
    /db\.RXWorkflowTracking\.findAll\(\{[\s\S]{0,250}?attributes:\s*\['id',\s*'rxRecordId',\s*'workflowActionId',\s*'completionDate',\s*'userId',\s*'createdAt',\s*'updatedAt'\]/,
    'The complete report export must allowlist pre-driver workflow tracking fields.'
  );
}

async function assertInactiveWorkflowAndReadPermissions(actions, fixtures) {
  const { user, restrictedUser, driverA, driverB, driverC } = fixtures;
  const rxId = created.rxId;
  const maxSequence = Number(await db.WorkflowAction.max('sequenceNumber')) || 0;
  const action = await db.WorkflowAction.create({
    name: `QA Disabled Historical Stage ${runId}`,
    description: 'Temporary disabled stage for RX driver regression',
    sequenceNumber: maxSequence + 100,
    isActive: true,
    deliveryOutcomeMode: 'delivered_or_returned'
  });
  created.workflowActionIds.push(action.id);

  const tracking = await db.RXWorkflowTracking.create({
    rxRecordId: rxId,
    workflowActionId: action.id,
    completionDate: new Date(),
    userId: user.id,
    driverId: driverA.id,
    driverNameSnapshot: driverA.name
  });
  await db.RXDriverAssignmentHistory.create({
    rxRecordId: rxId,
    workflowTrackingId: tracking.id,
    workflowActionId: action.id,
    workflowActionName: action.name,
    previousDriverId: null,
    previousDriverName: null,
    driverId: driverA.id,
    driverName: driverA.name,
    changeType: 'stage_snapshot',
    reason: 'Temporary historical stage snapshot for regression.',
    userId: user.id
  });
  await action.update({ isActive: false });

  let result = await runHandler(
    rxController.correctWorkflowDriver,
    mockReq(user, {
      trackingId: tracking.id,
      driverId: driverC.id,
      expectedDriverId: driverA.id,
      reason: 'Correct a completed stage after its workflow action was disabled.'
    })
  );
  assertStatus(result, 200, 'Correct driver on completed disabled stage');
  assert.strictEqual(result.payload.changed, true);
  await assertStageDriver(rxId, action, driverC, 'Disabled completed stage remains historically correctable');
  await assertCurrentDriver(rxId, driverB, 'Disabled-stage correction preserves the current driver');

  result = await runHandler(rxController.getOne, mockReq(user, {}, { id: rxId }));
  assertStatus(result, 200, 'Authorized RX read');
  assert.strictEqual(Number(result.payload.pharmacyTransportCompanyId), Number(driverB.id));
  assert.strictEqual(Number(result.payload.CurrentDriver.id), Number(driverB.id));
  const allowedTracking = findTrackingPayload(result.payload, tracking.id);
  assert(allowedTracking, 'Authorized RX read must include the completed disabled stage.');
  assertTrackingDriverVisible(result.payload, tracking.id, driverC, 'Authorized RX read');

  result = await runHandler(rxController.getOne, mockReq(restrictedUser, {}, { id: rxId }));
  assertStatus(result, 200, 'Restricted RX read');
  assert.strictEqual(Number(result.payload.pharmacyTransportCompanyId), Number(driverB.id));
  assert.strictEqual(Number(result.payload.CurrentDriver.id), Number(driverB.id));
  assertTrackingDriverRedacted(result.payload, tracking.id, 'Restricted RX detail read');

  const restrictedListReq = mockReq(restrictedUser);
  restrictedListReq.query = { id: String(rxId) };
  result = await runHandler(rxController.getAll, restrictedListReq);
  assertStatus(result, 200, 'Restricted non-paginated RX read');
  const restrictedListRx = result.payload.find(item => Number(item.id) === Number(rxId));
  assert(restrictedListRx, 'Restricted non-paginated RX read must include the fixture RX.');
  assertTrackingDriverRedacted(restrictedListRx, tracking.id, 'Restricted non-paginated RX read');

  const restrictedPageReq = mockReq(restrictedUser);
  restrictedPageReq.query = { id: String(rxId), paginated: 'true', pageSize: '10' };
  result = await runHandler(rxController.getAll, restrictedPageReq);
  assertStatus(result, 200, 'Restricted paginated RX read');
  const restrictedPageRx = result.payload.rows.find(item => Number(item.id) === Number(rxId));
  assert(restrictedPageRx, 'Restricted paginated RX read must include the fixture RX.');
  assertTrackingDriverRedacted(restrictedPageRx, tracking.id, 'Restricted paginated RX read');

  const restrictedRole = await db.Role.findByPk(restrictedUser.roleId);
  const restrictedPermissions = JSON.parse(JSON.stringify(restrictedRole.permissions));
  for (const permissionName of ['canCorrectDriver', 'canSyncDriverHistory']) {
    await restrictedRole.update({
      permissions: {
        ...restrictedPermissions,
        rx_records: {
          ...restrictedPermissions.rx_records,
          canViewDriverHistory: false,
          [permissionName]: true
        }
      }
    });
    result = await runHandler(rxController.getOne, mockReq(restrictedUser, {}, { id: rxId }));
    assertStatus(result, 200, `RX read authorized by ${permissionName}`);
    assertTrackingDriverVisible(result.payload, tracking.id, driverC, `RX read authorized by ${permissionName}`);
  }
  await restrictedRole.update({ permissions: restrictedPermissions });

  await assertGenericWorkflowAuditHasNoDriver(user, rxId);
  assertTrackingSerializerAllowlists();

  result = await runHandler(dashboardController.getTotalRx, mockReq(user));
  assertStatus(result, 200, 'Dashboard total-RX serialization');
  const dashboardRx = result.payload.find(item => Number(item.id) === Number(rxId));
  assert(dashboardRx, 'Dashboard response must include the fixture RX.');
  assertTrackingDriverRedacted(dashboardRx, tracking.id, 'Dashboard total-RX serialization');

  result = await runHandler(
    patientController.getTimeline,
    mockReq(user, {}, { id: created.patientId })
  );
  assertStatus(result, 200, 'Patient timeline serialization');
  const timelineRx = result.payload.rxRecords.find(item => Number(item.id) === Number(rxId));
  assert(timelineRx, 'Patient timeline must include the fixture RX.');
  assertTrackingDriverRedacted(timelineRx, tracking.id, 'Patient timeline serialization');

  result = await runHandler(reportController.getRXActionReport, mockReq(user));
  assertStatus(result, 200, 'RX action report serialization');
  const reportRx = result.payload.find(item => Number(item.id) === Number(rxId));
  assert(reportRx, 'RX action report must include the fixture RX.');
  assertTrackingDriverRedacted(reportRx, tracking.id, 'RX action report serialization');

  result = await runHandler(
    rxController.updateWorkflow,
    mockReq(user, { rxId, actionId: action.id })
  );
  assertStatus(result, 400, 'Single completion rejects inactive workflow action');
  assert.strictEqual(result.payload.code, 'WORKFLOW_ACTION_INACTIVE');

  result = await runHandler(
    rxController.bulkWorkflow,
    mockReq(user, { rxIds: [rxId], actionId: action.id })
  );
  assertStatus(result, 400, 'Bulk completion rejects inactive workflow action');
  assert.strictEqual(result.payload.code, 'WORKFLOW_ACTION_INACTIVE');

  result = await runHandler(
    deliveryOutcomeController.setOutcome,
    mockReq(user, { rxId, actionId: action.id, outcome: 'delivered' })
  );
  assertStatus(result, 400, 'Delivery outcome rejects inactive workflow action');
  assert.strictEqual(result.payload.code, 'WORKFLOW_ACTION_INACTIVE');

  const rxSource = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'rxController.js'), 'utf8');
  const guardedStepOneQueries = rxSource.match(
    /where:\s*\{\s*sequenceNumber:\s*1,\s*isActive:\s*true\s*\},\s*\r?\n\s*order:\s*\[\['sequenceNumber',\s*'ASC'\],\s*\['id',\s*'ASC'\]\]/g
  ) || [];
  assert.strictEqual(guardedStepOneQueries.length, 2, 'RX create and warehouse reset must choose active Step 1 deterministically.');

  const activeStageOne = await getTracking(rxId, actions[0].id);
  assert(activeStageOne, 'The active Stage 1 fixture must exist before undo regression.');
  result = await runHandler(rxController.undoWorkflow, mockReq(user, { rxId }));
  assertStatus(result, 200, 'Undo ignores higher-sequence disabled historical stage');
  assert.strictEqual(await getTracking(rxId, actions[0].id), null, 'Undo must remove the latest active stage.');
  assert(await getTracking(rxId, action.id), 'Undo must preserve the disabled historical stage.');

  result = await runHandler(rxController.undoWorkflow, mockReq(user, { rxId }));
  assertStatus(result, 400, 'Undo with only disabled historical stages remaining');
  assert(await getTracking(rxId, action.id), 'A disabled historical stage must never be the fallback undo target.');

  console.log('PASS: Inactive workflow actions are rejected, disabled completed stages remain correctable, and undo preserves disabled history.');
  console.log('PASS: Restricted RX reads retain current driver state while redacting completed-stage driver snapshots.');
  console.log('PASS: Generic workflow audits and dashboard/patient/report tracking serializers cannot expose driver fields.');
}

async function cleanup() {
  if (created.auditIds.length) {
    await db.AuditLog.destroy({ where: { id: created.auditIds } });
  }
  if (created.rxId) {
    await db.RXDriverAssignmentHistory.destroy({ where: { rxRecordId: created.rxId } });
    await db.RXWorkflowTracking.destroy({ where: { rxRecordId: created.rxId } });
    await db.RXHistory.destroy({ where: { rxRecordId: created.rxId } });
    await db.Medication.destroy({ where: { rxRecordId: created.rxId } });
    await db.RXRecord.destroy({ where: { id: created.rxId } });
  }
  if (created.workflowActionIds.length) {
    await db.WorkflowAction.destroy({ where: { id: created.workflowActionIds } });
  }
  if (created.patientId) {
    await db.PatientServiceDateHistory.destroy({ where: { patientId: created.patientId } });
    await db.PatientServiceDateCycle.destroy({ where: { patientId: created.patientId } });
    await db.Patient.destroy({ where: { id: created.patientId } });
  }
  if (created.driverIds.length) {
    await db.PharmacyTransportCompany.destroy({ where: { id: created.driverIds } });
  }
  if (created.userIds.length) {
    await db.User.destroy({ where: { id: created.userIds } });
  }
  if (created.roleIds.length) {
    await db.Role.destroy({ where: { id: created.roleIds } });
  }
}

async function main() {
  await assertDatabaseReady(db);
  const actions = await requireWorkflowActions();
  const fixtures = await createFixtures(actions);
  await runScenario(actions, fixtures);
  await assertGenericHistoryPermissions(fixtures);
  await assertAuditLogDriverVisibility(fixtures);
  await assertInactiveWorkflowAndReadPermissions(actions, fixtures);
}

let failure = null;
main()
  .catch(error => {
    failure = error;
  })
  .finally(async () => {
    try {
      await cleanup();
    } catch (cleanupError) {
      if (!failure) failure = cleanupError;
      else console.error('Cleanup also failed:', cleanupError.stack || cleanupError.message);
    }
    await db.sequelize.close().catch(() => {});
    if (failure) {
      console.error('FAIL: RX driver tracking regression');
      console.error(failure.stack || failure.message);
      process.exitCode = 1;
    }
  });
