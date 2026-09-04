'use strict';

const { getStatus } = require('./migration-runner');

const REQUIRED_UNIQUE_INDEXES = [
  ['Users', ['username']],
  ['Patients', ['patientCode']],
  ['SystemSettings', ['key']],
  ['CallCenterLocks', ['patientId']],
  ['UserSoftphoneAccounts', ['userId']],
  ['CallCenterCallAttempts', ['correlationId']],
  ['SoftphoneRelayDevices', ['userId']],
  ['SoftphoneRelayDevices', ['deviceKey']],
  ['SoftphoneRelayDevices', ['tokenHash']],
  ['PatientTagAssignments', ['patientId', 'patientTagId']]
];

const REQUIRED_NAMED_UNIQUE_INDEXES = [
  ['PharmacyTransportCompanies', 'uq_pharmacy_transport_active_company_name_ci'],
  ['PatientTags', 'uq_patient_tags_active_group_name']
];

async function inspectDatabase(db, options = {}) {
  const includeMigrations = options.includeMigrations !== false;
  const includeIndexes = options.includeIndexes !== false;
  const sequelize = db.sequelize;
  const queryInterface = sequelize.getQueryInterface();
  const missingTables = [];
  const missingColumns = [];
  const missingUniqueIndexes = [];

  await sequelize.authenticate();

  const models = Object.entries(db)
    .filter(([, model]) => model && model.rawAttributes && typeof model.getTableName === 'function')
    .sort(([left], [right]) => left.localeCompare(right));

  for (const [modelName, model] of models) {
    const tableName = normalizeTableName(model.getTableName());
    let actualColumns;

    try {
      actualColumns = await queryInterface.describeTable(tableName);
    } catch (error) {
      if (isMissingRelation(error)) {
        missingTables.push({ model: modelName, table: tableName });
        continue;
      }
      throw error;
    }

    for (const [attributeName, attribute] of Object.entries(model.rawAttributes)) {
      const columnName = attribute.field || attribute.fieldName || attributeName;
      if (!actualColumns[columnName]) {
        missingColumns.push({ model: modelName, table: tableName, column: columnName });
      }
    }
  }

  if (includeIndexes) {
    for (const [tableName, fields] of REQUIRED_UNIQUE_INDEXES) {
      try {
        const indexes = await queryInterface.showIndex(tableName);
        if (!hasMatchingUniqueIndex(indexes, fields)) {
          missingUniqueIndexes.push({ table: tableName, fields });
        }
      } catch (error) {
        if (!isMissingRelation(error)) throw error;
      }
    }
    for (const [tableName, indexName] of REQUIRED_NAMED_UNIQUE_INDEXES) {
      try {
        const indexes = await queryInterface.showIndex(tableName);
        if (!indexes.some(index => index.unique && index.name === indexName)) {
          missingUniqueIndexes.push({ table: tableName, index: indexName });
        }
      } catch (error) {
        if (!isMissingRelation(error)) throw error;
      }
    }
  }

  const migrations = includeMigrations
    ? await getStatus(sequelize)
    : { metaExists: null, applied: [], pending: [], unknown: [] };

  const errors = [];
  for (const item of missingTables) errors.push(`missing table ${item.table} (${item.model})`);
  for (const item of missingColumns) errors.push(`missing column ${item.table}.${item.column}`);
  for (const item of missingUniqueIndexes) {
    errors.push(item.index
      ? `missing unique index ${item.index} on ${item.table}`
      : `missing unique index ${item.table}(${item.fields.join(', ')})`);
  }
  if (includeMigrations && !migrations.metaExists) errors.push('missing SequelizeMeta migration history');
  if (includeMigrations && migrations.missingLedgerColumns.length) {
    errors.push(`migration ledger missing column(s): ${migrations.missingLedgerColumns.join(', ')}`);
  }
  if (includeMigrations && migrations.missingChecksums.length) {
    errors.push(`${migrations.missingChecksums.length} applied migration(s) missing checksums`);
  }
  if (includeMigrations && migrations.checksumMismatches.length) {
    errors.push(`${migrations.checksumMismatches.length} applied migration checksum mismatch(es)`);
  }
  if (migrations.pending.length) errors.push(`${migrations.pending.length} pending migration(s)`);
  if (migrations.unknown.length) errors.push(`${migrations.unknown.length} unknown migration record(s)`);

  return {
    ok: errors.length === 0,
    checkedAt: new Date().toISOString(),
    database: sequelize.config.database,
    host: sequelize.config.host,
    missingTables,
    missingColumns,
    missingUniqueIndexes,
    migrations,
    errors
  };
}

async function assertDatabaseReady(db) {
  const report = await inspectDatabase(db);
  if (report.ok) return report;

  const preview = report.errors.slice(0, 8).join('; ');
  const suffix = report.errors.length > 8 ? `; plus ${report.errors.length - 8} more` : '';
  const error = new Error(
    `Database schema is not ready for RX Tracker NEXT: ${preview}${suffix}. ` +
    'Run the explicit database lifecycle tool (rx-db status, migrate, and verify) before starting the web server.'
  );
  error.code = 'RX_DATABASE_NOT_READY';
  error.report = report;
  throw error;
}

function hasMatchingUniqueIndex(indexes, fields) {
  const expected = fields.map((field) => field.toLowerCase()).sort();
  return indexes.some((index) => {
    if (!index.unique) return false;
    const actual = (index.fields || [])
      .map((field) => String(field.attribute || field.name || '').toLowerCase())
      .sort();
    return actual.length === expected.length && actual.every((field, i) => field === expected[i]);
  });
}

function normalizeTableName(table) {
  if (typeof table === 'string') return table;
  return table.tableName || table.table_name || String(table);
}

function isMissingRelation(error) {
  const code = error?.original?.code || error?.parent?.code || error?.code;
  return code === '42P01' || /does not exist|unknown table|no description found/i.test(String(error?.message || ''));
}

module.exports = {
  REQUIRED_UNIQUE_INDEXES,
  REQUIRED_NAMED_UNIQUE_INDEXES,
  inspectDatabase,
  assertDatabaseReady
};
