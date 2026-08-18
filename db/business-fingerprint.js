'use strict';

const crypto = require('crypto');

const BUSINESS_TABLES = [
  'Patients',
  'RXRecords',
  'RXWorkflowTrackings',
  'RXDriverAssignmentHistories',
  'RXProfileSyncReviewEvents',
  'Users',
  'PatientNotes',
  'PatientServiceDateHistories',
  'PatientServiceDateCycles',
  'CallCenterCallAttempts',
  'CallCenterLocks',
  'Clinics',
  'Pharmacies',
  'PatientTransportCompanies',
  'PharmacyTransportCompanies',
  'Medications',
  'MedicationCatalogs',
  'DocumentAttachments'
];

async function createBusinessFingerprint(db) {
  await db.sequelize.authenticate();
  const queryInterface = db.sequelize.getQueryInterface();
  const existingTables = new Map(
    (await queryInterface.showAllTables()).map((table) => {
      const name = normalizeTableName(table);
      return [name.toLowerCase(), name];
    })
  );

  const tableCounts = {};
  for (const expectedName of BUSINESS_TABLES) {
    const actualName = existingTables.get(expectedName.toLowerCase());
    if (!actualName) {
      tableCounts[expectedName] = null;
      continue;
    }
    const [rows] = await db.sequelize.query(
      `SELECT COUNT(*)::bigint AS "count" FROM ${quoteIdentifier(actualName)}`
    );
    tableCounts[expectedName] = Number.parseInt(rows[0].count, 10);
  }

  let workflowActions = [];
  const workflowTable = existingTables.get('workflowactions');
  if (workflowTable) {
    const [rows] = await db.sequelize.query(`
      SELECT "id", "name", "description", "sequenceNumber", "isActive"
        FROM ${quoteIdentifier(workflowTable)}
       ORDER BY "id"
    `);
    workflowActions = rows.map((row) => ({
      id: Number(row.id),
      name: row.name,
      description: row.description,
      sequenceNumber: row.sequenceNumber === null ? null : Number(row.sequenceNumber),
      isActive: row.isActive === true
    }));
  }

  const data = {
    schema: 1,
    database: db.sequelize.config.database,
    tableCounts,
    workflowActions
  };
  const canonical = JSON.stringify(data);
  return {
    ...data,
    sha256: crypto.createHash('sha256').update(canonical, 'utf8').digest('hex')
  };
}

function compareBusinessFingerprints(before, after) {
  const differences = [];
  const tableNames = new Set([
    ...Object.keys(before.tableCounts || {}),
    ...Object.keys(after.tableCounts || {})
  ]);
  for (const table of [...tableNames].sort()) {
    const previous = before.tableCounts?.[table] ?? null;
    const current = after.tableCounts?.[table] ?? null;
    if (previous !== current) {
      differences.push({ type: 'table-count', table, before: previous, after: current });
    }
  }

  if (JSON.stringify(before.workflowActions || []) !== JSON.stringify(after.workflowActions || [])) {
    differences.push({
      type: 'workflow-actions',
      before: before.workflowActions || [],
      after: after.workflowActions || []
    });
  }
  return { ok: differences.length === 0, differences };
}

function normalizeTableName(table) {
  if (typeof table === 'string') return table;
  return table.tableName || table.table_name || String(table);
}

function quoteIdentifier(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

module.exports = {
  BUSINESS_TABLES,
  compareBusinessFingerprints,
  createBusinessFingerprint
};
