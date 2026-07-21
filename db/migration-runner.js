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
      unknown: []
    };
  }

  if (!metaExists) await ensureMetaTable(queryInterface, sequelize.Sequelize);

  const [rows] = await sequelize.query(`SELECT "name" FROM "${META_TABLE}" ORDER BY "name"`);
  const applied = rows.map((row) => row.name);
  const expectedNames = new Set(manifest.map((item) => item.name));

  return {
    metaExists: true,
    applied,
    pending: manifest.map((item) => item.name).filter((name) => !applied.includes(name)),
    unknown: applied.filter((name) => !expectedNames.has(name))
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

    const queryInterface = sequelize.getQueryInterface();
    let appliedCount = 0;

    for (const item of manifest) {
      if (!statusBefore.pending.includes(item.name)) continue;
      logger.log(`[DB] Applying ${item.name}...`);
      await item.migration.up(queryInterface, sequelize.Sequelize);
      await sequelize.query(
        `INSERT INTO "${META_TABLE}" ("name") VALUES (:name)`,
        { replacements: { name: item.name } }
      );
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

    for (const name of names) {
      if (!known.has(name)) throw new Error(`Cannot record unknown migration: ${name}`);
      await sequelize.query(
        `INSERT INTO "${META_TABLE}" ("name") VALUES (:name) ON CONFLICT ("name") DO NOTHING`,
        { replacements: { name } }
      );
    }

    return getStatus(sequelize);
  } finally {
    await releaseLock(sequelize);
  }
}

async function ensureMetaTable(queryInterface, Sequelize) {
  if (await tableExists(queryInterface, META_TABLE)) return;
  await queryInterface.createTable(META_TABLE, {
    name: {
      type: Sequelize.STRING,
      allowNull: false,
      primaryKey: true,
      unique: true
    }
  });
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
