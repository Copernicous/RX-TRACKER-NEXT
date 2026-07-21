'use strict';

const manifest = require('./migration-manifest');
const { recordApplied } = require('./migration-runner');
const { inspectDatabase } = require('./schema-verifier');

const NEXT_BASELINE_MIGRATION = '20260721230000-complete-v331-startup-schema.js';
const LEGACY_MIGRATION_NAMES = manifest
  .map((item) => item.name)
  .filter((name) => name < NEXT_BASELINE_MIGRATION);

async function inspectV331Anchor(db) {
  return inspectDatabase(db, { includeMigrations: false, includeIndexes: false });
}

async function adoptV331(db, options = {}) {
  const expectedDatabase = String(options.confirmDatabase || '').trim();
  const actualDatabase = String(db.sequelize.config.database || '').trim();

  if (!expectedDatabase || expectedDatabase !== actualDatabase) {
    throw new Error(
      `Adoption confirmation failed. Pass --confirm-database ${actualDatabase} exactly.`
    );
  }

  const anchor = await inspectV331Anchor(db);
  if (!anchor.ok) {
    const preview = anchor.errors.slice(0, 12).join('; ');
    throw new Error(
      `The target is not a complete RX Tracker 3.3.1 schema and cannot be adopted automatically: ${preview}`
    );
  }

  const status = await recordApplied(db.sequelize, LEGACY_MIGRATION_NAMES);
  return {
    database: actualDatabase,
    recorded: LEGACY_MIGRATION_NAMES.length,
    pending: status.pending
  };
}

module.exports = {
  NEXT_BASELINE_MIGRATION,
  LEGACY_MIGRATION_NAMES,
  inspectV331Anchor,
  adoptV331
};
