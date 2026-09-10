'use strict';

const crypto = require('crypto');
const { normalizeStructuredAddressForReference } = require('../utils/patientAddress');

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
  'PatientTagAssignments',
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

  const regionalAssignmentGaps = await countRegionalAssignmentGaps(db, existingTables);

  const data = {
    schema: 1,
    database: db.sequelize.config.database,
    tableCounts,
    workflowActions,
    regionalAssignmentGaps
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

async function countRegionalAssignmentGaps(db, existingTables) {
  const patientTable = existingTables.get('patients');
  const tagTable = existingTables.get('patienttags');
  const assignmentTable = existingTables.get('patienttagassignments');
  if (!patientTable || !tagTable || !assignmentTable) return 0;

  const [columns] = await db.sequelize.query(`
    SELECT LOWER(column_name) AS name
      FROM information_schema.columns
     WHERE table_name = :table
  `, { replacements: { table: patientTable } });
  const patientColumns = new Set(columns.map((row) => row.name));
  if (!patientColumns.has('city') || !patientColumns.has('address')) return 0;
  const addressLineExpression = patientColumns.has('addressline1') ? 'p."addressLine1"' : 'NULL';
  const stateExpression = patientColumns.has('state') ? 'p.state' : 'NULL';
  const zipExpression = patientColumns.has('zipcode') ? 'p."zipCode"' : 'NULL';
  // next.78 runs address cleanup before missing-Region completion. Forecast
  // only that pending migration, using its exact parser without writing data.
  let cleanupPending = false;
  const ledger = existingTables.get('sequelizemeta');
  if (ledger) {
    const [applied] = await db.sequelize.query(
      `SELECT name FROM ${quoteIdentifier(ledger)} WHERE name = :name`,
      { replacements: { name: '20260906000000-rerun-improved-structured-address-cleanup.js' } }
    );
    cleanupPending = applied.length === 0;
  }

  const [rows] = await db.sequelize.query(`
    SELECT p.city, p.address, ${addressLineExpression} AS "addressLine1",
           ${stateExpression} AS state, ${zipExpression} AS "zipCode"
      FROM ${quoteIdentifier(patientTable)} p
     WHERE NOT EXISTS (
       SELECT 1 FROM ${quoteIdentifier(assignmentTable)} assignment
       JOIN ${quoteIdentifier(tagTable)} tag ON tag.id = assignment."patientTagId"
       WHERE assignment."patientId" = p.id AND tag."isActive" IS TRUE
         AND LOWER(BTRIM(tag."groupName")) IN ('region', 'city')
         AND LOWER(BTRIM(tag.name)) IN ('miami', 'tampa', 'none')
     )
  `);
  // SQL BTRIM without a character argument strips spaces, not all whitespace.
  const sqlTrim = value => String(value ?? '').replace(/^ +| +$/g, '');
  return rows.filter(patient => {
    let projected = patient;
    const cleanupInput = patient.address ?? patient.addressLine1 ?? patient.city ?? patient.state ?? patient.zipCode ?? '';
    if (cleanupPending && sqlTrim(cleanupInput)) {
      const parsed = normalizeStructuredAddressForReference(patient);
      const fields = ['addressLine1', 'city', 'state', 'zipCode'];
      const clean = value => String(value || '').replace(/\s+/g, ' ').trim() || null;
      if (fields.some(field => parsed[field]) && fields.some(field => clean(patient[field]) !== clean(parsed[field]))) {
        projected = { ...patient, ...parsed };
      }
    }
    return Boolean(sqlTrim(projected.city)) || !sqlTrim(projected.address ?? projected.addressLine1 ?? '');
  }).length;
}

module.exports = {
  BUSINESS_TABLES,
  compareBusinessFingerprints,
  createBusinessFingerprint
};
