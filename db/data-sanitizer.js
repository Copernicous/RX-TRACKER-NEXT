'use strict';

const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const SAFE_COPY_NAME = /(saniti[sz]ed|copy|qa|test|sandbox|rehearsal|scratch)/i;

async function sanitizeDatabase(db, options = {}) {
  assertSafeCopyTarget(db, options.confirmDatabase);

  const randomPassword = crypto.randomBytes(48).toString('base64url');
  const disabledPasswordHash = await bcrypt.hash(randomPassword, 12);
  const dateShiftDays = -crypto.randomInt(180, 731);
  const sequelize = db.sequelize;
  const transaction = await sequelize.transaction();

  try {
    // Remove credentials, workstation pairings, API access, transient locks,
    // and external-document pointers before pseudonymizing retained history.
    await execute(sequelize, 'DELETE FROM "SoftphoneRelayCommands"', transaction);
    await execute(sequelize, 'DELETE FROM "SoftphoneRelayDevices"', transaction);
    await execute(sequelize, 'DELETE FROM "UserSoftphoneAccounts"', transaction);
    await execute(sequelize, 'DELETE FROM "ApiKeys"', transaction);
    await execute(sequelize, 'DELETE FROM "DocumentAttachments"', transaction);
    await execute(sequelize, 'DELETE FROM "CallCenterLocks"', transaction);
    await execute(sequelize, 'DELETE FROM "PatientLocks"', transaction);

    await execute(sequelize, `
      UPDATE "Users"
         SET "firstName" = 'Test',
             "lastName" = 'User ' || "id",
             "username" = 'user_' || "id",
             "email" = 'user_' || "id" || '@example.test',
             "passwordHash" = :passwordHash,
             "notes" = NULL,
             "twoFactorSecret" = NULL,
             "twoFactorEnabled" = FALSE,
             "backupCodes" = NULL,
             "failedLoginCount" = 0,
             "lockedUntil" = NULL,
             "tokenVersion" = COALESCE("tokenVersion", 0) + 1,
             "phoneAccountSetupAllowed" = FALSE,
             "isMaster" = FALSE,
             "updatedAt" = NOW()
    `, transaction, { passwordHash: disabledPasswordHash });

    await execute(sequelize, `
      UPDATE "Patients"
         SET "firstName" = 'Test',
             "lastName" = 'Patient ' || "id",
             "dob" = DATE '1970-01-01' + (("id" % 10000)::integer),
             "address" = "id" || ' Example Way',
             "phone" = (2025550100 + ("id" % 100))::text,
             "patientCode" = 'SAN-' || LPAD("id"::text, 8, '0'),
             "notes" = NULL,
             "updatedAt" = NOW()
    `, transaction);

    await pseudonymizeReferenceTable(sequelize, transaction, 'Clinics', 'name', 'Clinic', { hasAddress: true });
    await pseudonymizeReferenceTable(sequelize, transaction, 'Pharmacies', 'name', 'Pharmacy', { hasAddress: true });
    await pseudonymizeReferenceTable(sequelize, transaction, 'PatientTransportCompanies', 'companyName', 'Patient Transport');
    await pseudonymizeReferenceTable(sequelize, transaction, 'PharmacyTransportCompanies', 'companyName', 'Pharmacy Transport');

    await execute(sequelize, `
      UPDATE "PatientTags"
         SET "name" = 'Patient Tag ' || "id",
             "groupName" = CASE WHEN "groupName" IS NULL THEN NULL ELSE 'Tag Group' END,
             "notes" = NULL,
             "updatedAt" = NOW()
    `, transaction);

    await execute(sequelize, `
      UPDATE "RXWorkflowTrackings"
         SET "driverNameSnapshot" = CASE
               WHEN "driverNameSnapshot" IS NULL THEN NULL
               WHEN "driverId" IS NULL THEN 'Driver Snapshot'
               ELSE 'Pharmacy Transport ' || "driverId"
             END,
             "notes" = CASE WHEN "notes" IS NULL THEN NULL ELSE 'Sanitized workflow note' END,
             "updatedAt" = NOW()
    `, transaction);

    await execute(sequelize, `
      UPDATE "RXDriverAssignmentHistories"
         SET "previousDriverName" = CASE
               WHEN "previousDriverName" IS NULL THEN NULL
               WHEN "previousDriverId" IS NULL THEN 'Driver Snapshot'
               ELSE 'Pharmacy Transport ' || "previousDriverId"
             END,
             "driverName" = CASE
               WHEN "driverName" IS NULL THEN NULL
               WHEN "driverId" IS NULL THEN 'Driver Snapshot'
               ELSE 'Pharmacy Transport ' || "driverId"
             END,
             "reason" = 'Sanitized driver assignment history'
    `, transaction);

    await execute(sequelize, `
      UPDATE "RXProfileSyncReviewEvents"
         SET "reason" = CASE WHEN "reason" IS NULL THEN NULL ELSE 'Sanitized RX profile review reason' END
    `, transaction);

    await execute(sequelize, `
      UPDATE "PatientNotes"
         SET "note" = 'Sanitized patient note',
             "updatedAt" = NOW()
    `, transaction);

    await execute(sequelize, `
      UPDATE "Medications"
         SET "name" = 'Medication ' || "id",
             "notes" = NULL,
             "updatedAt" = NOW()
    `, transaction);

    await execute(sequelize, `
      UPDATE "RXHistories"
         SET "snapshot" = '{"sanitized":true}',
             "changedFields" = NULL,
             "note" = NULL
    `, transaction);

    await execute(sequelize, `
      UPDATE "AuditLogs"
         SET "previousValue" = CASE WHEN "previousValue" IS NULL THEN NULL ELSE '{"sanitized":true}'::json END,
             "newValue" = CASE WHEN "newValue" IS NULL THEN NULL ELSE '{"sanitized":true}'::json END,
             "ipAddress" = NULL,
             "updatedAt" = NOW()
    `, transaction);

    await execute(sequelize, `
      UPDATE "ErrorLogs"
         SET "message" = 'Sanitized error record',
             "stack" = NULL,
             "url" = NULL,
             "userAgent" = NULL,
             "ipAddress" = NULL,
             "updatedAt" = NOW()
    `, transaction);

    await execute(sequelize, `
      UPDATE "UserActivityLogs"
         SET "usernameSnapshot" = CASE WHEN "userId" IS NULL THEN 'anonymous' ELSE 'user_' || "userId" END,
             "pageUrl" = NULL,
             "pagePath" = NULL,
             "pageTitle" = NULL,
             "ipAddress" = NULL,
             "userAgent" = NULL,
             "referrer" = NULL,
             "updatedAt" = NOW()
    `, transaction);

    await execute(sequelize, `
      UPDATE "CallCenterCallAttempts"
         SET "patientCode" = CASE WHEN "patientId" IS NULL THEN NULL ELSE 'SAN-' || LPAD("patientId"::text, 8, '0') END,
             "patientName" = CASE WHEN "patientId" IS NULL THEN 'Deleted patient' ELSE 'Test Patient ' || "patientId" END,
             "clinicName" = CASE WHEN "clinicName" IS NULL THEN NULL ELSE 'Sanitized Clinic' END,
             "agentName" = CASE WHEN "userId" IS NULL THEN 'Deleted user' ELSE 'Test User ' || "userId" END,
             "extension" = CASE WHEN "extension" IS NULL THEN NULL ELSE 'TEST' END,
             "dialedNumber" = (2025550100 + (COALESCE("patientId", "id") % 100))::text,
             "sipReason" = NULL,
             "updatedAt" = NOW()
    `, transaction);

    await execute(sequelize, `
      UPDATE "PatientServiceDateHistories"
         SET "reason" = CASE WHEN "reason" IS NULL THEN NULL ELSE 'Sanitized service-date history' END,
             "metadata" = CASE WHEN "metadata" IS NULL THEN NULL ELSE '{"sanitized":true}'::json END,
             "updatedAt" = NOW()
    `, transaction);

    await execute(sequelize, `
      UPDATE "PatientServiceDateCycles"
         SET "metadata" = CASE WHEN "metadata" IS NULL THEN NULL ELSE '{"sanitized":true}'::json END,
             "updatedAt" = NOW()
    `, transaction);

    await execute(sequelize, `
      UPDATE "SystemSettings"
         SET "value" = CASE
           WHEN "key" = 'app_timezone' THEN 'America/New_York'
           WHEN "key" = 'app_name' THEN 'Patient RX NEXT Sanitized'
           WHEN "key" = 'require_2fa' THEN 'true'
           WHEN "key" = 'smtp_host' THEN 'smtp.example.test'
           WHEN "key" = 'smtp_port' THEN '587'
           WHEN "key" IN ('smtp_user', 'smtp_pass', 'email_alerts_recipients') THEN ''
           WHEN "key" = 'smtp_from_name' THEN 'Patient RX NEXT Sanitized'
           WHEN "key" = 'email_alerts_enabled' THEN 'false'
           WHEN "key" = 'email_alert_rules' THEN '{}'
           WHEN "key" = 'email_alert_user_subscriptions' THEN '{}'
           WHEN "key" = 'email_alert_failed_login_threshold' THEN '5'
           WHEN "key" = 'email_alert_missing_auth_threshold' THEN '10'
           WHEN "key" = 'email_alert_cooldown_minutes' THEN '60'
           WHEN "key" = 'email_alert_digest_time' THEN '08:00'
           WHEN "key" = 'session_timeout_minutes' THEN '30'
           WHEN "key" = 'max_failed_logins' THEN '5'
           ELSE ''
         END,
             "updatedAt" = NOW()
    `, transaction);

    // Apply one unpublished offset to every date/timestamp column. This keeps
    // intervals, ordering, ring time, talk time, and cross-table date
    // relationships useful without retaining exact real-world event dates.
    await shiftAllTemporalColumns(sequelize, transaction, dateShiftDays);

    const validation = await validateSanitizedDatabase(db, { transaction });
    if (!validation.ok) {
      const summary = validation.violations.map((item) => `${item.check}=${item.count}`).join(', ');
      throw new Error(`Sanitization validation failed: ${summary}`);
    }

    await transaction.commit();
    return validation;
  } catch (error) {
    if (!transaction.finished) await transaction.rollback();
    throw error;
  }
}

async function validateSanitizedDatabase(db, options = {}) {
  const sequelize = db.sequelize;
  const checks = [
    ['user_identity', `SELECT COUNT(*)::integer AS count FROM "Users" WHERE NOT (("username" ~ '^user_[0-9]+$' AND "email" ~ '^user_[0-9]+@example\\.test$') OR ("username" = 'sanitized_admin' AND "email" = 'sanitized_admin@example.test')) OR "notes" IS NOT NULL`],
    ['user_credentials', `SELECT COUNT(*)::integer AS count FROM "Users" WHERE "twoFactorSecret" IS NOT NULL OR "backupCodes" IS NOT NULL OR "twoFactorEnabled" IS TRUE OR "phoneAccountSetupAllowed" IS TRUE OR ("isMaster" IS TRUE AND "username" <> 'sanitized_admin')`],
    ['patient_identity', `SELECT COUNT(*)::integer AS count FROM "Patients" WHERE "firstName" <> 'Test' OR "lastName" !~ '^Patient [0-9]+$' OR "patientCode" !~ '^SAN-[0-9]{8}$' OR "phone" !~ '^20255501[0-9]{2}$' OR "notes" IS NOT NULL`],
    ['clinic_identity', `SELECT COUNT(*)::integer AS count FROM "Clinics" WHERE "name" !~ '^Clinic [0-9]+$' OR ("address" IS NOT NULL AND "address" !~ '^[0-9]+ Example Way$') OR ("phone" IS NOT NULL AND "phone" !~ '^20255501[0-9]{2}$') OR ("contactPerson" IS NOT NULL AND "contactPerson" !~ '^Test Contact [0-9]+$') OR "notes" IS NOT NULL`],
    ['pharmacy_identity', `SELECT COUNT(*)::integer AS count FROM "Pharmacies" WHERE "name" !~ '^Pharmacy [0-9]+$' OR ("address" IS NOT NULL AND "address" !~ '^[0-9]+ Example Way$') OR ("phone" IS NOT NULL AND "phone" !~ '^20255501[0-9]{2}$') OR ("contactPerson" IS NOT NULL AND "contactPerson" !~ '^Test Contact [0-9]+$') OR "notes" IS NOT NULL`],
    ['patient_transport_identity', `SELECT COUNT(*)::integer AS count FROM "PatientTransportCompanies" WHERE "companyName" !~ '^Patient Transport [0-9]+$' OR ("phone" IS NOT NULL AND "phone" !~ '^20255501[0-9]{2}$') OR ("contactPerson" IS NOT NULL AND "contactPerson" !~ '^Test Contact [0-9]+$') OR "notes" IS NOT NULL`],
    ['pharmacy_transport_identity', `SELECT COUNT(*)::integer AS count FROM "PharmacyTransportCompanies" WHERE "companyName" !~ '^Pharmacy Transport [0-9]+$' OR ("phone" IS NOT NULL AND "phone" !~ '^20255501[0-9]{2}$') OR ("contactPerson" IS NOT NULL AND "contactPerson" !~ '^Test Contact [0-9]+$') OR "notes" IS NOT NULL`],
    ['patient_tags', `SELECT COUNT(*)::integer AS count FROM "PatientTags" WHERE "name" !~ '^Patient Tag [0-9]+$' OR ("groupName" IS NOT NULL AND "groupName" <> 'Tag Group') OR "notes" IS NOT NULL`],
    ['workflow_driver_snapshots', `SELECT COUNT(*)::integer AS count FROM "RXWorkflowTrackings" WHERE ("driverNameSnapshot" IS NOT NULL AND (("driverId" IS NULL AND "driverNameSnapshot" <> 'Driver Snapshot') OR ("driverId" IS NOT NULL AND "driverNameSnapshot" <> 'Pharmacy Transport ' || "driverId"))) OR ("notes" IS NOT NULL AND "notes" <> 'Sanitized workflow note')`],
    ['driver_history_payloads', `SELECT COUNT(*)::integer AS count FROM "RXDriverAssignmentHistories" WHERE ("previousDriverName" IS NOT NULL AND (("previousDriverId" IS NULL AND "previousDriverName" <> 'Driver Snapshot') OR ("previousDriverId" IS NOT NULL AND "previousDriverName" <> 'Pharmacy Transport ' || "previousDriverId"))) OR ("driverName" IS NOT NULL AND (("driverId" IS NULL AND "driverName" <> 'Driver Snapshot') OR ("driverId" IS NOT NULL AND "driverName" <> 'Pharmacy Transport ' || "driverId"))) OR "reason" IS DISTINCT FROM 'Sanitized driver assignment history'`],
    ['rx_profile_review_payloads', `SELECT COUNT(*)::integer AS count FROM "RXProfileSyncReviewEvents" WHERE "reason" IS NOT NULL AND "reason" <> 'Sanitized RX profile review reason'`],
    ['patient_notes', `SELECT COUNT(*)::integer AS count FROM "PatientNotes" WHERE "note" <> 'Sanitized patient note'`],
    ['medications', `SELECT COUNT(*)::integer AS count FROM "Medications" WHERE "name" !~ '^Medication [0-9]+$' OR "notes" IS NOT NULL`],
    ['audit_payloads', `SELECT COUNT(*)::integer AS count FROM "AuditLogs" WHERE ("previousValue" IS NOT NULL AND "previousValue"::jsonb <> '{"sanitized":true}'::jsonb) OR ("newValue" IS NOT NULL AND "newValue"::jsonb <> '{"sanitized":true}'::jsonb) OR "ipAddress" IS NOT NULL`],
    ['rx_history_payloads', `SELECT COUNT(*)::integer AS count FROM "RXHistories" WHERE "snapshot" <> '{"sanitized":true}' OR "changedFields" IS NOT NULL OR "note" IS NOT NULL`],
    ['call_attempt_snapshots', `SELECT COUNT(*)::integer AS count FROM "CallCenterCallAttempts" WHERE "dialedNumber" !~ '^20255501[0-9]{2}$' OR "sipReason" IS NOT NULL`],
    ['error_log_payloads', `SELECT COUNT(*)::integer AS count FROM "ErrorLogs" WHERE "message" <> 'Sanitized error record' OR "stack" IS NOT NULL OR "url" IS NOT NULL OR "userAgent" IS NOT NULL OR "ipAddress" IS NOT NULL`],
    ['activity_log_payloads', `SELECT COUNT(*)::integer AS count FROM "UserActivityLogs" WHERE "pageUrl" IS NOT NULL OR "pagePath" IS NOT NULL OR "pageTitle" IS NOT NULL OR "ipAddress" IS NOT NULL OR "userAgent" IS NOT NULL OR "referrer" IS NOT NULL`],
    ['api_keys', 'SELECT COUNT(*)::integer AS count FROM "ApiKeys"'],
    ['softphone_accounts', 'SELECT COUNT(*)::integer AS count FROM "UserSoftphoneAccounts"'],
    ['softphone_devices', 'SELECT COUNT(*)::integer AS count FROM "SoftphoneRelayDevices"'],
    ['softphone_commands', 'SELECT COUNT(*)::integer AS count FROM "SoftphoneRelayCommands"'],
    ['document_pointers', 'SELECT COUNT(*)::integer AS count FROM "DocumentAttachments"'],
    ['patient_locks', 'SELECT COUNT(*)::integer AS count FROM "PatientLocks"'],
    ['call_center_locks', 'SELECT COUNT(*)::integer AS count FROM "CallCenterLocks"'],
    ['sensitive_settings', `SELECT COUNT(*)::integer AS count FROM "SystemSettings" WHERE ("key" IN ('smtp_user', 'smtp_pass', 'email_alerts_recipients') AND COALESCE("value", '') <> '') OR ("key" = 'email_alert_user_subscriptions' AND COALESCE("value", '') <> '{}') OR ("key" = 'email_alerts_enabled' AND COALESCE("value", '') <> 'false') OR ("key" NOT IN ('app_timezone', 'app_name', 'require_2fa', 'smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'smtp_from_name', 'email_alerts_enabled', 'email_alerts_recipients', 'email_alert_rules', 'email_alert_user_subscriptions', 'email_alert_failed_login_threshold', 'email_alert_missing_auth_threshold', 'email_alert_cooldown_minutes', 'email_alert_digest_time', 'session_timeout_minutes', 'max_failed_logins') AND COALESCE("value", '') <> '')`]
  ];

  const violations = [];
  for (const [check, sql] of checks) {
    const [rows] = await sequelize.query(sql, { transaction: options.transaction });
    const count = Number(rows[0]?.count || 0);
    if (count > 0) violations.push({ check, count });
  }

  return {
    ok: violations.length === 0,
    checkedAt: new Date().toISOString(),
    database: sequelize.config.database,
    violations
  };
}

async function createSanitizedAdmin(db, options = {}) {
  assertSafeCopyTarget(db, options.confirmDatabase);
  const password = String(options.password || '');
  if (password.length < 12) throw new Error('Sanitized administrator password must contain at least 12 characters.');

  const adminRole = await db.Role.findOne({ where: { name: 'Administrator' } });
  if (!adminRole) throw new Error('Administrator role is missing.');

  const passwordHash = await bcrypt.hash(password, 12);
  let user = await db.User.findOne({ where: { roleId: adminRole.id }, order: [['id', 'ASC']] });
  if (!user) {
    user = await db.User.create({
      firstName: 'Test',
      lastName: 'Administrator',
      username: 'sanitized_admin',
      email: 'sanitized_admin@example.test',
      passwordHash,
      roleId: adminRole.id,
      isActive: true,
      isMaster: true
    });
  } else {
    await user.update({
      firstName: 'Test',
      lastName: 'Administrator',
      username: 'sanitized_admin',
      email: 'sanitized_admin@example.test',
      passwordHash,
      isActive: true,
      isMaster: true,
      twoFactorSecret: null,
      twoFactorEnabled: false,
      backupCodes: null,
      failedLoginCount: 0,
      lockedUntil: null,
      tokenVersion: Number(user.tokenVersion || 0) + 1,
      phoneAccountSetupAllowed: false,
      notes: null
    });
  }

  return { id: user.id, username: user.username };
}

function assertSafeCopyTarget(db, confirmDatabase) {
  const actual = String(db.sequelize.config.database || '').trim();
  const confirmed = String(confirmDatabase || '').trim();
  if (!confirmed || confirmed !== actual) {
    throw new Error(`Exact database confirmation required: --confirm-database ${actual}`);
  }
  if (!SAFE_COPY_NAME.test(actual)) {
    throw new Error(
      `Refusing destructive sanitization of ${actual}. The target name must contain sanitized, copy, qa, test, sandbox, rehearsal, or scratch.`
    );
  }
}

async function pseudonymizeReferenceTable(sequelize, transaction, tableName, nameColumn, prefix, options = {}) {
  const addressAssignment = options.hasAddress
    ? `"address" = CASE WHEN "address" IS NULL THEN NULL ELSE "id" || ' Example Way' END,`
    : '';
  await execute(sequelize, `
    UPDATE "${tableName}"
       SET "${nameColumn}" = '${prefix} ' || "id",
           ${addressAssignment}
           "phone" = CASE WHEN "phone" IS NULL THEN NULL ELSE (2025550100 + ("id" % 100))::text END,
           "contactPerson" = CASE WHEN "contactPerson" IS NULL THEN NULL ELSE 'Test Contact ' || "id" END,
           "notes" = NULL,
           "updatedAt" = NOW()
  `, transaction);
}

async function execute(sequelize, sql, transaction, replacements = {}) {
  return sequelize.query(sql, { transaction, replacements });
}

async function shiftAllTemporalColumns(sequelize, transaction, dateShiftDays) {
  const [columns] = await sequelize.query(`
    SELECT relation.relname AS table_name,
           attribute.attname AS column_name,
           column_type.typname AS data_type
      FROM pg_catalog.pg_attribute AS attribute
      JOIN pg_catalog.pg_class AS relation
        ON relation.oid = attribute.attrelid
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = relation.relnamespace
      JOIN pg_catalog.pg_type AS column_type
        ON column_type.oid = attribute.atttypid
     WHERE namespace.nspname = 'public'
       AND relation.relkind IN ('r', 'p')
       AND relation.relispartition = FALSE
       AND attribute.attnum > 0
       AND attribute.attisdropped = FALSE
       AND column_type.typname IN ('date', 'timestamp', 'timestamptz')
     ORDER BY relation.relname, attribute.attnum
  `, { transaction });

  for (const column of columns) {
    const tableName = `${quoteIdentifier('public')}.${quoteIdentifier(column.table_name)}`;
    const columnName = quoteIdentifier(column.column_name);
    const expression = column.data_type === 'date'
      ? `${columnName} + :dateShiftDays`
      : `${columnName} + (:dateShiftDays * INTERVAL '1 day')`;
    await sequelize.query(
      `UPDATE ${tableName} SET ${columnName} = ${expression} WHERE ${columnName} IS NOT NULL`,
      { transaction, replacements: { dateShiftDays } }
    );
  }
}

function quoteIdentifier(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

module.exports = {
  SAFE_COPY_NAME,
  assertSafeCopyTarget,
  sanitizeDatabase,
  validateSanitizedDatabase,
  createSanitizedAdmin,
  shiftAllTemporalColumns
};
