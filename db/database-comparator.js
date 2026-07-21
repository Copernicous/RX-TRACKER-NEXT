'use strict';

const { Sequelize } = require('sequelize');

function createSourceConnectionFromEnv() {
  const database = String(process.env.SOURCE_DB_NAME || '').trim();
  if (!database) throw new Error('SOURCE_DB_NAME is required for compare-copy.');

  return new Sequelize(
    database,
    process.env.SOURCE_DB_USER || process.env.DB_USER || 'postgres',
    process.env.SOURCE_DB_PASS || '',
    {
      host: process.env.SOURCE_DB_HOST || process.env.DB_HOST || '127.0.0.1',
      port: Number.parseInt(process.env.SOURCE_DB_PORT || process.env.DB_PORT || '5432', 10),
      dialect: 'postgres',
      logging: false
    }
  );
}

async function compareDatabases(source, target) {
  await Promise.all([source.authenticate(), target.authenticate()]);
  const [sourceSnapshot, targetSnapshot] = await Promise.all([
    inspectDatabaseShape(source),
    inspectDatabaseShape(target)
  ]);

  const sourceTables = new Set(Object.keys(sourceSnapshot.tables));
  const targetTables = new Set(Object.keys(targetSnapshot.tables));
  const missingFromTarget = [...sourceTables].filter((table) => !targetTables.has(table)).sort();
  const addedInTarget = [...targetTables].filter((table) => !sourceTables.has(table)).sort();
  const columnDifferences = [];
  const rowCountDifferences = [];

  for (const table of [...sourceTables].filter((name) => targetTables.has(name)).sort()) {
    const sourceColumns = new Set(sourceSnapshot.tables[table].columns);
    const targetColumns = new Set(targetSnapshot.tables[table].columns);
    const missingColumns = [...sourceColumns].filter((column) => !targetColumns.has(column)).sort();
    const addedColumns = [...targetColumns].filter((column) => !sourceColumns.has(column)).sort();
    if (missingColumns.length || addedColumns.length) {
      columnDifferences.push({ table, missingFromTarget: missingColumns, addedInTarget: addedColumns });
    }

    const sourceCount = sourceSnapshot.tables[table].rowCount;
    const targetCount = targetSnapshot.tables[table].rowCount;
    if (sourceCount !== targetCount) {
      rowCountDifferences.push({ table, source: sourceCount, target: targetCount, delta: targetCount - sourceCount });
    }
  }

  return {
    comparedAt: new Date().toISOString(),
    source: source.config.database,
    target: target.config.database,
    sourceTableCount: sourceTables.size,
    targetTableCount: targetTables.size,
    missingFromTarget,
    addedInTarget,
    columnDifferences,
    rowCountDifferences,
    schemaCompatible: missingFromTarget.length === 0 && columnDifferences.every((item) => item.missingFromTarget.length === 0)
  };
}

async function inspectDatabaseShape(sequelize) {
  const [columnRows] = await sequelize.query(`
    SELECT table_name, column_name
      FROM information_schema.columns
     WHERE table_schema = 'public'
     ORDER BY table_name, ordinal_position
  `);
  const tables = {};
  for (const row of columnRows) {
    if (!tables[row.table_name]) tables[row.table_name] = { columns: [], rowCount: 0 };
    tables[row.table_name].columns.push(row.column_name);
  }

  for (const tableName of Object.keys(tables)) {
    const [rows] = await sequelize.query(`SELECT COUNT(*)::bigint AS count FROM ${quoteIdentifier(tableName)}`);
    tables[tableName].rowCount = Number(rows[0].count);
  }
  return { tables };
}

function quoteIdentifier(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

module.exports = {
  createSourceConnectionFromEnv,
  compareDatabases,
  inspectDatabaseShape,
  quoteIdentifier
};
