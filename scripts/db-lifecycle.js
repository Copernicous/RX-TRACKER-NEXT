'use strict';

require('dotenv').config();

const { Client } = require('pg');
const db = require('../models');
const { getStatus, migrate } = require('../db/migration-runner');
const { inspectDatabase, assertDatabaseReady } = require('../db/schema-verifier');
const { adoptV331, inspectV331Anchor } = require('../db/v331-adoption');
const { seedReferenceData } = require('../db/reference-data');
const { bootstrapAdmin } = require('../db/admin-bootstrap');
const {
  sanitizeDatabase,
  validateSanitizedDatabase,
  createSanitizedAdmin
} = require('../db/data-sanitizer');
const { restoreDump } = require('../db/dump-restore');
const { createSourceConnectionFromEnv, compareDatabases } = require('../db/database-comparator');
const { createBusinessFingerprint } = require('../db/business-fingerprint');
const {
  configureRuntimeRole,
  inspectRuntimeRole,
  verifyRuntimeConnection
} = require('../db/runtime-role');

async function main(argv = process.argv.slice(2)) {
  const command = String(argv[0] || 'help').toLowerCase();
  const options = parseOptions(argv.slice(1));
  let exitCode = 0;

  try {
    switch (command) {
      case 'help':
      case '--help':
      case '-h':
        printHelp();
        break;

      case 'create':
        await createDatabase();
        break;

      case 'status': {
        await db.sequelize.authenticate();
        const status = await getStatus(db.sequelize);
        printMigrationStatus(status);
        if (!status.metaExists || !status.ledgerReady || status.pending.length || status.unknown.length) exitCode = 2;
        break;
      }

      case 'migrate': {
        printTarget();
        const result = await migrate(db.sequelize);
        console.log(`[DB] Migration complete. ${result.appliedCount} migration(s) applied.`);
        printMigrationStatus(result.status);
        break;
      }

      case 'verify': {
        printTarget();
        const report = await inspectDatabase(db);
        printVerification(report);
        if (!report.ok) exitCode = 2;
        break;
      }

      case 'inspect-v331': {
        printTarget();
        const report = await inspectV331Anchor(db);
        printVerification(report);
        if (!report.ok) exitCode = 2;
        break;
      }

      case 'adopt-v331': {
        printTarget();
        const result = await adoptV331(db, { confirmDatabase: options.confirmDatabase });
        console.log(`[DB] Adopted ${result.database}; recorded ${result.recorded} legacy migration name(s).`);
        console.log(`[DB] Pending NEXT migration(s): ${result.pending.join(', ') || 'none'}`);
        break;
      }

      case 'seed-reference': {
        printTarget();
        await assertDatabaseReady(db);
        await seedReferenceData(db);
        break;
      }

      case 'business-fingerprint': {
        printTarget();
        const fingerprint = await createBusinessFingerprint(db);
        console.log(`RX_BUSINESS_FINGERPRINT=${JSON.stringify(fingerprint)}`);
        break;
      }

      case 'configure-runtime-role': {
        printTarget();
        const passwordEnv = String(options.passwordEnv || 'RX_RUNTIME_DB_PASSWORD');
        const password = process.env[passwordEnv];
        if (!password) throw new Error(`Set ${passwordEnv} before running configure-runtime-role.`);
        const report = await configureRuntimeRole(db, {
          role: options.role,
          password,
          confirmDatabase: options.confirmDatabase
        });
        delete process.env[passwordEnv];
        printRuntimeRole(report);
        if (!report.ok) exitCode = 2;
        break;
      }

      case 'inspect-runtime-role': {
        printTarget();
        const report = await inspectRuntimeRole(db, options.role);
        printRuntimeRole(report);
        if (!report.ok) exitCode = 2;
        break;
      }

      case 'verify-runtime-role': {
        printTarget();
        const passwordEnv = String(options.passwordEnv || 'RX_RUNTIME_DB_PASSWORD');
        const password = process.env[passwordEnv];
        if (!password) throw new Error(`Set ${passwordEnv} before running verify-runtime-role.`);
        const report = await verifyRuntimeConnection(db, { role: options.role, password });
        delete process.env[passwordEnv];
        console.log(`[DB] Runtime connection verification: ${report.ok ? 'PASS' : 'FAIL'}.`);
        console.log(`[DB] Runtime role=${report.role} database=${report.database}.`);
        break;
      }

      case 'bootstrap-admin': {
        printTarget();
        await assertDatabaseReady(db);
        const passwordEnv = String(options.passwordEnv || 'RX_BOOTSTRAP_ADMIN_PASSWORD');
        const password = process.env[passwordEnv];
        if (!password) throw new Error(`Set ${passwordEnv} before running bootstrap-admin.`);

        const result = await bootstrapAdmin(db, {
          username: options.username,
          email: options.email,
          firstName: options.firstName,
          lastName: options.lastName,
          password,
          master: options.master === true
        });
        delete process.env[passwordEnv];
        console.log(`[DB] Created first-run administrator ${result.username} (id ${result.id}, master=${result.isMaster}).`);
        break;
      }

      case 'sanitize': {
        printTarget();
        await assertDatabaseReady(db);
        const result = await sanitizeDatabase(db, { confirmDatabase: options.confirmDatabase });
        console.log(`[DB] Sanitization complete. Validation checks passed with ${result.violations.length} violation(s).`);
        break;
      }

      case 'validate-sanitized': {
        printTarget();
        await assertDatabaseReady(db);
        const result = await validateSanitizedDatabase(db);
        console.log(`[DB] Sanitized-data validation: ${result.ok ? 'PASS' : 'FAIL'}.`);
        result.violations.forEach((item) => console.log(`  VIOLATION ${item.check}: ${item.count} row(s)`));
        if (!result.ok) exitCode = 2;
        break;
      }

      case 'sanitized-admin': {
        printTarget();
        await assertDatabaseReady(db);
        const passwordEnv = String(options.passwordEnv || 'RX_SANITIZED_ADMIN_PASSWORD');
        const password = process.env[passwordEnv];
        if (!password) throw new Error(`Set ${passwordEnv} before running sanitized-admin.`);
        const result = await createSanitizedAdmin(db, {
          confirmDatabase: options.confirmDatabase,
          password
        });
        delete process.env[passwordEnv];
        console.log(`[DB] Sanitized test administrator ready: ${result.username} (id ${result.id}).`);
        break;
      }

      case 'restore-copy': {
        printTarget();
        const result = await restoreDump(db, {
          confirmDatabase: options.confirmDatabase,
          dumpPath: options.dump
        });
        console.log(`[DB] Restore complete using ${result.format} format.`);
        break;
      }

      case 'rehearse-v331': {
        printTarget();
        await restoreDump(db, {
          confirmDatabase: options.confirmDatabase,
          dumpPath: options.dump
        });
        const adoption = await adoptV331(db, { confirmDatabase: options.confirmDatabase });
        console.log(`[DB] Adopted ${adoption.recorded} legacy migration name(s).`);
        const migrationResult = await migrate(db.sequelize);
        console.log(`[DB] Applied ${migrationResult.appliedCount} NEXT migration(s).`);
        await assertDatabaseReady(db);
        await seedReferenceData(db);
        const sanitization = await sanitizeDatabase(db, { confirmDatabase: options.confirmDatabase });
        console.log(`[DB] Rehearsal copy sanitized; ${sanitization.violations.length} validation violation(s).`);
        break;
      }

      case 'compare-copy': {
        printTarget();
        const source = createSourceConnectionFromEnv();
        try {
          const comparison = await compareDatabases(source, db.sequelize);
          printComparison(comparison);
          if (!comparison.schemaCompatible) exitCode = 2;
        } finally {
          await source.close().catch(() => {});
        }
        break;
      }

      case 'provision': {
        await createDatabase();
        printTarget();
        const migrationResult = await migrate(db.sequelize);
        console.log(`[DB] Migration complete. ${migrationResult.appliedCount} migration(s) applied.`);
        await assertDatabaseReady(db);
        await seedReferenceData(db);
        console.log('[DB] Provisioning complete. Run bootstrap-admin separately with a strong password environment variable.');
        break;
      }

      default:
        throw new Error(`Unknown database command: ${command}. Run rx-db help.`);
    }
  } finally {
    await db.sequelize.close().catch(() => {});
  }

  return exitCode;
}

async function createDatabase() {
  const database = String(process.env.DB_NAME || '').trim();
  if (!/^[A-Za-z0-9_-]{1,63}$/.test(database)) {
    throw new Error('DB_NAME must contain only letters, numbers, underscore, or hyphen.');
  }

  const client = new Client({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number.parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASS || '',
    database: process.env.DB_MAINTENANCE_NAME || 'postgres'
  });

  await client.connect();
  try {
    const existing = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [database]);
    if (existing.rowCount) {
      console.log(`[DB] Database ${database} already exists; no change made.`);
      return false;
    }
    await client.query(`CREATE DATABASE ${quoteIdentifier(database)} TEMPLATE template0`);
    console.log(`[DB] Created database ${database}.`);
    return true;
  } finally {
    await client.end();
  }
}

function quoteIdentifier(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function parseOptions(args) {
  const options = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--master') {
      options.master = true;
      continue;
    }
    if (!arg.startsWith('--')) throw new Error(`Unexpected argument: ${arg}`);
    const key = arg.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const value = args[i + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}.`);
    options[key] = value;
    i += 1;
  }
  return options;
}

function printTarget() {
  console.log(
    `[DB] Target database=${db.sequelize.config.database} ` +
    `host=${db.sequelize.config.host}:${db.sequelize.config.port || 5432} ` +
    `user=${db.sequelize.config.username}`
  );
}

function printMigrationStatus(status) {
  console.log(`[DB] Migration history: ${status.metaExists ? 'present' : 'missing'}`);
  console.log(`[DB] Applied: ${status.applied.length}`);
  console.log(`[DB] Pending: ${status.pending.length}`);
  console.log(`[DB] Checksum ledger: ${status.ledgerReady ? 'verified' : 'not ready'}`);
  if (status.pending.length) status.pending.forEach((name) => console.log(`  PENDING ${name}`));
  if (status.unknown.length) status.unknown.forEach((name) => console.log(`  UNKNOWN ${name}`));
  if (status.missingLedgerColumns.length) {
    console.log(`  LEDGER MISSING COLUMNS ${status.missingLedgerColumns.join(', ')}`);
  }
  status.missingChecksums.forEach((name) => console.log(`  CHECKSUM MISSING ${name}`));
  status.checksumMismatches.forEach((item) => console.log(`  CHECKSUM MISMATCH ${item.name}`));
}

function printVerification(report) {
  console.log(`[DB] Verification: ${report.ok ? 'READY' : 'NOT READY'}`);
  console.log(`[DB] Missing tables: ${report.missingTables.length}`);
  console.log(`[DB] Missing columns: ${report.missingColumns.length}`);
  console.log(`[DB] Missing unique indexes: ${report.missingUniqueIndexes.length}`);
  if (report.migrations.metaExists !== null) printMigrationStatus(report.migrations);
  report.errors.forEach((error) => console.log(`  ERROR ${error}`));
}

function printHelp() {
  console.log(`
RX Tracker NEXT database lifecycle

  rx-db create
  rx-db status
  rx-db migrate
  rx-db verify
  rx-db inspect-v331
  rx-db adopt-v331 --confirm-database <exact DB_NAME>
  rx-db seed-reference
  rx-db business-fingerprint
  rx-db configure-runtime-role --role <name> --confirm-database <exact DB_NAME>
  rx-db inspect-runtime-role --role <name>
  rx-db verify-runtime-role --role <name>
  rx-db bootstrap-admin --username <name> [--email <address>] [--master]
  rx-db provision
  rx-db restore-copy --dump <path> --confirm-database <exact DB_NAME>
  rx-db rehearse-v331 --dump <path> --confirm-database <exact DB_NAME>
  rx-db sanitize --confirm-database <exact DB_NAME>
  rx-db validate-sanitized
  rx-db sanitized-admin --confirm-database <exact DB_NAME>
  rx-db compare-copy

bootstrap-admin reads the password from RX_BOOTSTRAP_ADMIN_PASSWORD by default.
Use --password-env <VARIABLE_NAME> to select a different environment variable.
No command prints database, administrator, SIP, relay, or encryption secrets.
`);
}

function printRuntimeRole(report) {
  console.log(`[DB] Runtime role inspection: ${report.ok ? 'PASS' : 'FAIL'}.`);
  console.log(`[DB] Runtime role=${report.role} database=${report.database}.`);
  if (Number.isInteger(report.tableCount)) console.log(`[DB] Runtime tables covered: ${report.tableCount}.`);
  if (Number.isInteger(report.sequenceCount)) console.log(`[DB] Runtime sequences covered: ${report.sequenceCount}.`);
  (report.errors || []).forEach((error) => console.log(`  ERROR ${error}`));
}

function printComparison(comparison) {
  console.log(`[DB] Compared source=${comparison.source} target=${comparison.target}.`);
  console.log(`[DB] Schema compatible: ${comparison.schemaCompatible ? 'yes' : 'no'}`);
  console.log(`[DB] Tables: source=${comparison.sourceTableCount} target=${comparison.targetTableCount}`);
  comparison.missingFromTarget.forEach((table) => console.log(`  MISSING TABLE ${table}`));
  comparison.addedInTarget.forEach((table) => console.log(`  ADDED TABLE ${table}`));
  comparison.columnDifferences.forEach((item) => {
    console.log(
      `  COLUMNS ${item.table}: missing=[${item.missingFromTarget.join(',')}] added=[${item.addedInTarget.join(',')}]`
    );
  });
  comparison.rowCountDifferences.forEach((item) => {
    console.log(`  ROWS ${item.table}: source=${item.source} target=${item.target} delta=${item.delta}`);
  });
}

if (require.main === module) {
  main()
    .then((exitCode) => { process.exitCode = exitCode; })
    .catch((error) => {
      console.error(`[DB] ERROR: ${error.message}`);
      process.exitCode = 1;
    });
}

module.exports = { main, parseOptions, quoteIdentifier };
