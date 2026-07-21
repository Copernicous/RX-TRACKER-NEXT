'use strict';

const manifest = require('./migration-manifest');

const META_TABLE = 'SequelizeMeta';
const ADVISORY_LOCK_KEY = 'rx-tracker-next:migrations';

async function getStatus(sequelize, options = {}) {
  const ensureMeta = options.ensureMeta === true;
  const queryInterface = sequelize.getQueryInterface();
  const metaExists = await tableExists(queryInterface, META_TABLE);

  if (!metaExists && !ensureMeta) {
    return {
      metaExists: false,
      applied: [],
      pending: manifest.map((item) => item.name),
      unknown: [],
      missingLedgerColumns: ['checksum', 'appliedAt'],
      missingChecksums: [],
      checksumMismatches: [],
      ledgerReady: false
    };
  }

  if (!metaExists) await ensureMetaTable(queryInterface, sequelize.Sequelize);

  let columns = await queryInterface.describeTable(META_TABLE);
  if (ensureMeta) {
    await ensureLedgerColumns(queryInterface, sequelize.Sequelize, columns);
    columns = await queryInterface.describeTable(META_TABLE);
    await establishMissingChecksums(sequelize, columns);
  }

  const missingLedgerColumns = ['checksum', 'appliedAt'].filter((name) => !columns[name]);
  const checksumSelect = columns.checksum ? '"checksum"' : 'NULL::varchar AS "checksum"';
  const appliedAtSelect = columns.appliedAt ? '"appliedAt"' : 'NULL::timestamptz AS "appliedAt"';

  const [rows] = await sequelize.query(
    `SELECT "name", ${checksumSelect}, ${appliedAtSelect} FROM "${META_TABLE}" ORDER BY "name"`
  );
  const applied = rows.map((row) => row.name);
  const expectedByName = new Map(manifest.map((item) => [item.name, item]));
  const expectedNames = new Set(expectedByName.keys());
  const missingChecksums = rows
    .filter((row) => expectedNames.has(row.name) && !row.checksum)
    .map((row) => row.name);
  const checksumMismatches = rows
    .filter((row) => {
      const expected = expectedByName.get(row.name);
      return expected && row.checksum && row.checksum !== expected.checksum;
    })
    .map((row) => ({
      name: row.name,
      recorded: row.checksum,
      expected: expectedByName.get(row.name).checksum
    }));

  return {
    metaExists: true,
    applied,
    pending: manifest.map((item) => item.name).filter((name) => !applied.includes(name)),
    unknown: applied.filter((name) => !expectedNames.has(name)),
    missingLedgerColumns,
    missingChecksums,
    checksumMismatches,
    ledgerReady: missingLedgerColumns.length === 0 && missingChecksums.length === 0 && checksumMismatches.length === 0
  };
}

async function migrate(sequelize, logger = console) {
  await sequelize.authenticate();
  await acquireLock(sequelize);

  try {
    const statusBefore = await getStatus(sequelize, { ensureMeta: true });
    if (statusBefore.unknown.length) {
      throw new Error(
        `Database contains migration records unknown to this build: ${statusBefore.unknown.join(', ')}`
      );
    }
    if (statusBefore.checksumMismatches.length) {
      throw new Error(
        `Applied migration checksum drift detected: ${statusBefore.checksumMismatches.map((item) => item.name).join(', ')}`
      );
    }

    const queryInterface = sequelize.getQueryInterface();
    let appliedCount = 0;

    for (const item of manifest) {
      if (!statusBefore.pending.includes(item.name)) continue;
      logger.log(`[DB] Applying ${item.name}...`);
      await item.migration.up(queryInterface, sequelize.Sequelize);
      await sequelize.query(`
        INSERT INTO "${META_TABLE}" ("name", "checksum", "appliedAt")
        VALUES (:name, :checksum, NOW())
      `, { replacements: { name: item.name, checksum: item.checksum } });
      appliedCount += 1;
      logger.log(`[DB] Applied ${item.name}.`);
    }

    const statusAfter = await getStatus(sequelize);
    return { appliedCount, status: statusAfter };
  } finally {
    await releaseLock(sequelize);
  }
}

async function recordApplied(sequelize, names) {
  await sequelize.authenticate();
  await acquireLock(sequelize);

  try {
    const queryInterface = sequelize.getQueryInterface();
    await ensureMetaTable(queryInterface, sequelize.Sequelize);
    const known = new Set(manifest.map((item) => item.name));
    const byName = new Map(manifest.map((item) => [item.name, item]));

    for (const name of names) {
      if (!known.has(name)) throw new Error(`Cannot record unknown migration: ${name}`);
      await sequelize.query(`
        INSERT INTO "${META_TABLE}" ("name", "checksum", "appliedAt")
        VALUES (:name, :checksum, NOW())
        ON CONFLICT ("name") DO NOTHING
      `, { replacements: { name, checksum: byName.get(name).checksum } });
    }

    const status = await getStatus(sequelize);
    if (status.checksumMismatches.length) {
      throw new Error(
        `Applied migration checksum drift detected: ${status.checksumMismatches.map((item) => item.name).join(', ')}`
      );
    }
    return status;
  } finally {
    await releaseLock(sequelize);
  }
}

async function ensureMetaTable(queryInterface, Sequelize) {
  if (!await tableExists(queryInterface, META_TABLE)) {
    await queryInterface.createTable(META_TABLE, {
      name: {
        type: Sequelize.STRING,
        allowNull: false,
        primaryKey: true,
        unique: true
      },
      checksum: {
        type: Sequelize.STRING(64),
        allowNull: true
      },
      appliedAt: {
        type: Sequelize.DATE,
        allowNull: true
      }
    });
  }

  const columns = await queryInterface.describeTable(META_TABLE);
  await ensureLedgerColumns(queryInterface, Sequelize, columns);
  await establishMissingChecksums(queryInterface.sequelize, await queryInterface.describeTable(META_TABLE));
}

async function ensureLedgerColumns(queryInterface, Sequelize, columns) {
  if (!columns.checksum) {
    await queryInterface.addColumn(META_TABLE, 'checksum', {
      type: Sequelize.STRING(64),
      allowNull: true
    });
  }
  if (!columns.appliedAt) {
    await queryInterface.addColumn(META_TABLE, 'appliedAt', {
      type: Sequelize.DATE,
      allowNull: true
    });
  }
}

async function establishMissingChecksums(sequelize, columns) {
  if (!columns.checksum || !columns.appliedAt) return;
  for (const item of manifest) {
    await sequelize.query(`
      UPDATE "${META_TABLE}"
         SET "checksum" = COALESCE("checksum", :checksum),
             "appliedAt" = COALESCE("appliedAt", NOW())
       WHERE "name" = :name
    `, { replacements: { name: item.name, checksum: item.checksum } });
  }
}

async function tableExists(queryInterface, tableName) {
  const tables = await queryInterface.showAllTables();
  return tables.some((table) => normalizeTableName(table) === tableName);
}

function normalizeTableName(table) {
  if (typeof table === 'string') return table;
  return table.tableName || table.table_name || String(table);
}

async function acquireLock(sequelize) {
  await sequelize.query('SELECT pg_advisory_lock(hashtext(:key))', {
    replacements: { key: ADVISORY_LOCK_KEY }
  });
}

async function releaseLock(sequelize) {
  await sequelize.query('SELECT pg_advisory_unlock(hashtext(:key))', {
    replacements: { key: ADVISORY_LOCK_KEY }
  }).catch(() => {});
}

module.exports = {
  META_TABLE,
  getStatus,
  migrate,
  recordApplied
};
