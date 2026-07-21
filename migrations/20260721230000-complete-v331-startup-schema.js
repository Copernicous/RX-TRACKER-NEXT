'use strict';

/**
 * Converts the schema work that RX Tracker 3.3.1 performed during web-server
 * startup into one explicit, idempotent compatibility migration.
 *
 * This migration supports both:
 *   1. a fresh database that ran the legacy migration chain; and
 *   2. an adopted v3.3.1 database where sequelize.sync()/startup DDL already
 *      created some or all of these objects.
 *
 * The migration is intentionally additive. Its down direction is blocked
 * because an adopted database cannot distinguish pre-existing objects from
 * objects created here without recording per-object provenance.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await ensureLegacySyncTables(queryInterface, Sequelize);
    await ensureLegacyStartupColumns(queryInterface, Sequelize);
    await ensureLegacyIndexes(queryInterface);
    await runLegacyBackfills(queryInterface);
  },

  async down() {
    throw new Error(
      '20260721230000-complete-v331-startup-schema is an additive adoption migration and cannot be reversed safely. Restore the pre-migration database backup instead.'
    );
  }
};

async function ensureLegacySyncTables(queryInterface, Sequelize) {
  await createTableIfMissing(queryInterface, 'ApiKeys', {
    id: integerId(Sequelize),
    name: { type: Sequelize.STRING, allowNull: false },
    keyPrefix: { type: Sequelize.STRING, allowNull: false },
    keyHash: { type: Sequelize.STRING, allowNull: false },
    description: { type: Sequelize.TEXT, allowNull: true },
    createdByUserId: nullableReference(Sequelize, 'Users'),
    isActive: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
    lastUsedAt: { type: Sequelize.DATE, allowNull: true },
    expiresAt: { type: Sequelize.DATE, allowNull: true },
    createdAt: requiredTimestamp(Sequelize),
    updatedAt: requiredTimestamp(Sequelize)
  });

  await createTableIfMissing(queryInterface, 'CallCenterLocks', {
    id: integerId(Sequelize),
    patientId: requiredReference(Sequelize, 'Patients'),
    userId: requiredReference(Sequelize, 'Users'),
    lockedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
    expiresAt: { type: Sequelize.DATE, allowNull: false },
    createdAt: requiredTimestamp(Sequelize),
    updatedAt: requiredTimestamp(Sequelize)
  });

  await createTableIfMissing(queryInterface, 'ErrorLogs', {
    id: integerId(Sequelize),
    source: {
      type: Sequelize.ENUM('frontend', 'backend'),
      allowNull: false,
      defaultValue: 'frontend'
    },
    severity: {
      type: Sequelize.ENUM('error', 'warning', 'info'),
      allowNull: false,
      defaultValue: 'error'
    },
    message: { type: Sequelize.TEXT, allowNull: true },
    stack: { type: Sequelize.TEXT, allowNull: true },
    url: { type: Sequelize.STRING, allowNull: true },
    userAgent: { type: Sequelize.STRING, allowNull: true },
    userId: nullableReference(Sequelize, 'Users'),
    ipAddress: { type: Sequelize.STRING, allowNull: true },
    resolved: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
    createdAt: requiredTimestamp(Sequelize),
    updatedAt: requiredTimestamp(Sequelize)
  });

  await createTableIfMissing(queryInterface, 'PatientLocks', {
    id: integerId(Sequelize),
    patientId: requiredReference(Sequelize, 'Patients'),
    userId: requiredReference(Sequelize, 'Users'),
    lockedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
    expiresAt: { type: Sequelize.DATE, allowNull: false },
    createdAt: requiredTimestamp(Sequelize),
    updatedAt: requiredTimestamp(Sequelize)
  });

  await createTableIfMissing(queryInterface, 'PatientNotes', {
    id: integerId(Sequelize),
    patientId: requiredReference(Sequelize, 'Patients'),
    userId: nullableReference(Sequelize, 'Users'),
    note: { type: Sequelize.TEXT, allowNull: false },
    source: { type: Sequelize.STRING(60), allowNull: false, defaultValue: 'Patient' },
    createdAt: requiredTimestamp(Sequelize),
    updatedAt: requiredTimestamp(Sequelize)
  });

  await createTableIfMissing(queryInterface, 'RXHistories', {
    id: integerId(Sequelize),
    rxRecordId: requiredReference(Sequelize, 'RXRecords'),
    userId: nullableReference(Sequelize, 'Users'),
    changeType: { type: Sequelize.STRING(50), allowNull: true, defaultValue: 'Update' },
    snapshot: { type: Sequelize.TEXT, allowNull: false },
    changedFields: { type: Sequelize.TEXT, allowNull: true },
    note: { type: Sequelize.STRING(255), allowNull: true },
    createdAt: requiredTimestamp(Sequelize)
  });

  await createTableIfMissing(queryInterface, 'SystemSettings', {
    id: integerId(Sequelize),
    key: { type: Sequelize.STRING, allowNull: false },
    value: { type: Sequelize.TEXT, allowNull: true },
    description: { type: Sequelize.STRING, allowNull: true },
    createdAt: requiredTimestamp(Sequelize),
    updatedAt: requiredTimestamp(Sequelize)
  });
}

async function ensureLegacyStartupColumns(queryInterface, Sequelize) {
  const columns = {
    Roles: {
      description: { type: Sequelize.STRING, allowNull: true },
      isSystem: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      permissions: { type: Sequelize.TEXT, allowNull: true }
    },
    Users: {
      notes: { type: Sequelize.TEXT, allowNull: true },
      permissions: { type: Sequelize.TEXT, allowNull: true },
      twoFactorSecret: { type: Sequelize.TEXT, allowNull: true },
      twoFactorEnabled: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      failedLoginCount: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      lockedUntil: { type: Sequelize.DATE, allowNull: true },
      backupCodes: { type: Sequelize.TEXT, allowNull: true },
      tokenVersion: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      phoneAccountSetupAllowed: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      isMaster: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false }
    },
    RXRecords: {
      isDeleted: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      deletedAt: { type: Sequelize.DATE, allowNull: true },
      returnedToWarehouse: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      warehouseReturnDate: { type: Sequelize.DATE, allowNull: true },
      warehouseReturnNote: { type: Sequelize.STRING, allowNull: true },
      patientServiceDateCycleId: nullableReference(Sequelize, 'PatientServiceDateCycles')
    },
    AuditLogs: {
      previousValue: { type: Sequelize.JSON, allowNull: true }
    },
    MedicationCatalogs: {
      sortOrder: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 999 }
    },
    PatientNotes: {
      source: { type: Sequelize.STRING(60), allowNull: false, defaultValue: 'Patient' }
    },
    DailySnapshots: {
      patientsWithNoRx: zeroInteger(Sequelize),
      eligibleNow: zeroInteger(Sequelize),
      expiringIn7: zeroInteger(Sequelize),
      inWindow: zeroInteger(Sequelize),
      noServiceDate: zeroInteger(Sequelize),
      loginEventsToday: zeroInteger(Sequelize),
      uniqueLoginUsersToday: zeroInteger(Sequelize),
      userActivityEventsToday: zeroInteger(Sequelize),
      uniqueActivityUsersToday: zeroInteger(Sequelize),
      workflowCompletionRate: { type: Sequelize.DOUBLE, allowNull: false, defaultValue: 0 },
      completedWorkflowSteps: zeroInteger(Sequelize),
      workflowStepsToday: zeroInteger(Sequelize),
      totalWorkflowSteps: zeroInteger(Sequelize)
    }
  };

  for (const [tableName, definitions] of Object.entries(columns)) {
    for (const [columnName, definition] of Object.entries(definitions)) {
      await addColumnIfMissing(queryInterface, tableName, columnName, definition);
    }
  }
}

async function ensureLegacyIndexes(queryInterface) {
  const indexes = [
    ['ApiKeys', ['keyHash'], { name: 'uq_api_keys_key_hash', unique: true }],
    ['CallCenterLocks', ['patientId'], { name: 'uq_call_center_locks_patient', unique: true }],
    ['CallCenterLocks', ['userId'], { name: 'idx_call_center_locks_user' }],
    ['CallCenterLocks', ['expiresAt'], { name: 'idx_call_center_locks_expires' }],
    ['ErrorLogs', ['resolved'], { name: 'idx_errorlogs_resolved' }],
    ['PatientLocks', ['patientId'], { name: 'idx_patient_locks_patient' }],
    ['PatientLocks', ['userId'], { name: 'idx_patient_locks_user' }],
    ['PatientLocks', ['expiresAt'], { name: 'idx_patient_locks_expires' }],
    ['PatientNotes', ['patientId'], { name: 'idx_patientnotes_patientId' }],
    ['RXHistories', ['rxRecordId'], { name: 'idx_rxhistory_rxRecordId' }],
    ['SystemSettings', ['key'], { name: 'uq_system_settings_key', unique: true }],
    ['RXRecords', ['patientServiceDateCycleId'], { name: 'idx_rxrecords_patient_service_date_cycle' }],
    ['Patients', ['patientCode'], { name: 'uq_patients_patient_code', unique: true }]
  ];

  for (const [tableName, fields, options] of indexes) {
    await addIndexIfMissing(queryInterface, tableName, fields, options);
  }
}

async function runLegacyBackfills(queryInterface) {
  await queryInterface.sequelize.query(`
    UPDATE "PatientNotes"
       SET "source" = 'Patient'
     WHERE "source" IS NULL OR BTRIM("source") = ''
  `);

  await queryInterface.sequelize.query(`
    INSERT INTO "PatientServiceDateCycles"
      ("patientId", "serviceDate", "status", "source", "startedAt", "endedAt", "metadata", "createdAt", "updatedAt")
    SELECT
      source_dates."patientId",
      source_dates."serviceDate",
      CASE WHEN patients."serviceDate" = source_dates."serviceDate" THEN 'active' ELSE 'historical' END,
      'NEXT v3.3.1 adoption',
      source_dates."serviceDate"::timestamp with time zone,
      CASE
        WHEN patients."serviceDate" = source_dates."serviceDate" THEN NULL
        ELSE source_dates."serviceDate"::timestamp with time zone + INTERVAL '90 days'
      END,
      '{"backfilled":true,"migration":"20260721230000"}'::json,
      NOW(),
      NOW()
    FROM (
      SELECT "id" AS "patientId", "serviceDate"
        FROM "Patients"
       WHERE "serviceDate" IS NOT NULL
      UNION
      SELECT "patientId", "serviceDate"
        FROM "RXRecords"
       WHERE "patientId" IS NOT NULL AND "serviceDate" IS NOT NULL
    ) AS source_dates
    JOIN "Patients" AS patients ON patients."id" = source_dates."patientId"
    ON CONFLICT ("patientId", "serviceDate") DO NOTHING
  `);

  await queryInterface.sequelize.query(`
    UPDATE "PatientServiceDateCycles" AS cycles
       SET "status" = CASE WHEN patients."serviceDate" = cycles."serviceDate" THEN 'active' ELSE 'historical' END,
           "endedAt" = CASE
             WHEN patients."serviceDate" = cycles."serviceDate" THEN NULL
             ELSE cycles."serviceDate"::timestamp with time zone + INTERVAL '90 days'
           END,
           "updatedAt" = NOW()
      FROM "Patients" AS patients
     WHERE patients."id" = cycles."patientId"
  `);

  await queryInterface.sequelize.query(`
    UPDATE "RXRecords" AS records
       SET "patientServiceDateCycleId" = cycles."id"
      FROM "PatientServiceDateCycles" AS cycles
     WHERE records."patientId" = cycles."patientId"
       AND records."serviceDate" = cycles."serviceDate"
       AND records."patientServiceDateCycleId" IS DISTINCT FROM cycles."id"
  `);

  await queryInterface.sequelize.query(`
    INSERT INTO "PatientServiceDateHistories"
      ("patientId", "previousServiceDate", "newServiceDate", "changedByUserId", "changeSource", "reason", "metadata", "createdAt", "updatedAt")
    SELECT
      patients."id",
      NULL,
      patients."serviceDate",
      NULL,
      'NEXT v3.3.1 adoption',
      'Existing patient service date captured by the audited NEXT compatibility migration.',
      '{"backfilled":true,"migration":"20260721230000"}'::json,
      NOW(),
      NOW()
    FROM "Patients" AS patients
    WHERE patients."serviceDate" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
          FROM "PatientServiceDateHistories" AS history
         WHERE history."patientId" = patients."id"
      )
  `);
}

async function createTableIfMissing(queryInterface, tableName, definition) {
  if (await tableExists(queryInterface, tableName)) return;
  await queryInterface.createTable(tableName, definition);
}

async function addColumnIfMissing(queryInterface, tableName, columnName, definition) {
  const table = await queryInterface.describeTable(tableName);
  if (table[columnName]) return;
  await queryInterface.addColumn(tableName, columnName, definition);
}

async function addIndexIfMissing(queryInterface, tableName, fields, options) {
  if (!await tableExists(queryInterface, tableName)) return;

  const indexes = await queryInterface.showIndex(tableName);
  const expected = fields.map((field) => String(field).toLowerCase()).sort();
  const exists = indexes.some((index) => {
    if (options.name && index.name === options.name) return true;
    if (Boolean(options.unique) !== Boolean(index.unique)) return false;
    const actual = (index.fields || [])
      .map((field) => String(field.attribute || field.name || '').toLowerCase())
      .sort();
    return actual.length === expected.length && actual.every((field, i) => field === expected[i]);
  });

  if (!exists) await queryInterface.addIndex(tableName, fields, options);
}

async function tableExists(queryInterface, tableName) {
  const tables = await queryInterface.showAllTables();
  return tables.some((table) => normalizeTableName(table) === tableName);
}

function normalizeTableName(table) {
  if (typeof table === 'string') return table;
  return table.tableName || table.table_name || String(table);
}

function integerId(Sequelize) {
  return {
    type: Sequelize.INTEGER,
    allowNull: false,
    autoIncrement: true,
    primaryKey: true
  };
}

function requiredTimestamp(Sequelize) {
  return {
    type: Sequelize.DATE,
    allowNull: false,
    defaultValue: Sequelize.literal('NOW()')
  };
}

function requiredReference(Sequelize, model) {
  return {
    type: Sequelize.INTEGER,
    allowNull: false,
    references: { model, key: 'id' },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE'
  };
}

function nullableReference(Sequelize, model) {
  return {
    type: Sequelize.INTEGER,
    allowNull: true,
    references: { model, key: 'id' },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL'
  };
}

function zeroInteger(Sequelize) {
  return { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 };
}
