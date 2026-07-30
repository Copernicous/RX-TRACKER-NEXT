'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const canonicalChecksums = require('./migration-checksums');

// Static requires are deliberate: they allow both Node.js and the compiled
// rx-db.exe lifecycle tool to execute the exact same audited migration list.
module.exports = [
  entry('20260619191502-create-role.js', require('../migrations/20260619191502-create-role.js')),
  entry('20260619191503-create-user.js', require('../migrations/20260619191503-create-user.js')),
  entry('20260619191505-create-pharmacy.js', require('../migrations/20260619191505-create-pharmacy.js')),
  entry('20260619191506-create-patient-transport-company.js', require('../migrations/20260619191506-create-patient-transport-company.js')),
  entry('20260619191507-create-pharmacy-transport-company.js', require('../migrations/20260619191507-create-pharmacy-transport-company.js')),
  entry('20260619191509-create-workflow-action.js', require('../migrations/20260619191509-create-workflow-action.js')),
  entry('20260619191510-create-patient.js', require('../migrations/20260619191510-create-patient.js')),
  entry('20260619191512-create-rx-record.js', require('../migrations/20260619191512-create-rx-record.js')),
  entry('20260619191513-create-medication.js', require('../migrations/20260619191513-create-medication.js')),
  entry('20260619191514-create-rx-workflow-tracking.js', require('../migrations/20260619191514-create-rx-workflow-tracking.js')),
  entry('20260619191516-create-audit-log.js', require('../migrations/20260619191516-create-audit-log.js')),
  entry('20260619201500-add-patientCode-to-patients.js', require('../migrations/20260619201500-add-patientCode-to-patients.js')),
  entry('20260619202600-create-clinics.js', require('../migrations/20260619202600-create-clinics.js')),
  entry('20260619202700-add-clinicId-to-patients.js', require('../migrations/20260619202700-add-clinicId-to-patients.js')),
  entry('20260619222541-add-isDeleted-to-patients.js', require('../migrations/20260619222541-add-isDeleted-to-patients.js')),
  entry('20260620003500-add-isDeleted-to-rxrecords.js', require('../migrations/20260620003500-add-isDeleted-to-rxrecords.js')),
  entry('20260620164500-add-pharmacyId-to-patients.js', require('../migrations/20260620164500-add-pharmacyId-to-patients.js')),
  entry('20260620170920-add-isNonCompanyPatient-to-patients.js', require('../migrations/20260620170920-add-isNonCompanyPatient-to-patients.js')),
  entry('20260620171000-create-medication-catalog.js', require('../migrations/20260620171000-create-medication-catalog.js')),
  entry('20260620191656-create-daily-snapshots.js', require('../migrations/20260620191656-create-daily-snapshots.js')),
  entry('20260622200000-add-2fa-security-fields-to-users.js', require('../migrations/20260622200000-add-2fa-security-fields-to-users.js')),
  entry('20260623114800-add-performance-indexes.js', require('../migrations/20260623114800-add-performance-indexes.js')),
  entry('20260624130000-create-document-attachments.js', require('../migrations/20260624130000-create-document-attachments.js')),
  entry('20260625120000-create-user-activity-logs.js', require('../migrations/20260625120000-create-user-activity-logs.js')),
  entry('20260626120000-create-patient-service-date-histories.js', require('../migrations/20260626120000-create-patient-service-date-histories.js')),
  entry('20260626153000-create-patient-service-date-cycles.js', require('../migrations/20260626153000-create-patient-service-date-cycles.js')),
  entry('20260628103000-add-dashboard-trend-metrics-to-daily-snapshots.js', require('../migrations/20260628103000-add-dashboard-trend-metrics-to-daily-snapshots.js')),
  entry('20260720210000-create-user-softphone-accounts.js', require('../migrations/20260720210000-create-user-softphone-accounts.js')),
  entry('20260721020000-create-call-center-call-attempts.js', require('../migrations/20260721020000-create-call-center-call-attempts.js')),
  entry('20260721103000-add-phone-account-setup-permission.js', require('../migrations/20260721103000-add-phone-account-setup-permission.js')),
  entry('20260721110000-add-phone-account-setup-allowed-to-users.js', require('../migrations/20260721110000-add-phone-account-setup-allowed-to-users.js')),
  entry('20260721190000-create-softphone-relay.js', require('../migrations/20260721190000-create-softphone-relay.js')),
  entry('20260721230000-complete-v331-startup-schema.js', require('../migrations/20260721230000-complete-v331-startup-schema.js')),
  entry('20260721234500-repair-users-username-unique-index.js', require('../migrations/20260721234500-repair-users-username-unique-index.js')),
  entry('20260722160000-add-auth-id-to-user-softphone-accounts.js', require('../migrations/20260722160000-add-auth-id-to-user-softphone-accounts.js')),
  entry('20260725110000-add-patient-list-query-indexes.js', require('../migrations/20260725110000-add-patient-list-query-indexes.js')),
  entry('20260725160000-add-growth-query-indexes.js', require('../migrations/20260725160000-add-growth-query-indexes.js')),
  entry('20260729233000-add-delivery-outcome-mode-to-workflow-actions.js', require('../migrations/20260729233000-add-delivery-outcome-mode-to-workflow-actions.js')),
  entry('20260730000000-add-rx-delivery-outcome.js', require('../migrations/20260730000000-add-rx-delivery-outcome.js'))
];

function entry(name, migration) {
  if (!migration || typeof migration.up !== 'function') {
    throw new Error(`Migration ${name} does not export an up() function.`);
  }
  return Object.freeze({ name, migration, checksum: checksumMigration(name) });
}

function checksumMigration(name) {
  const expected = canonicalChecksums[name];
  if (!expected) {
    throw new Error(`Migration ${name} has no canonical checksum.`);
  }

  // Packagers can transform files in their virtual filesystem. The executable
  // therefore uses the audited constant above, while source mode proves that
  // the checked-in migration still matches that constant before doing any DB
  // work.
  if (process.pkg) return expected;

  const filePath = path.join(__dirname, '..', 'migrations', name);
  const normalized = fs.readFileSync(filePath, 'utf8')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n');
  const actual = crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
  if (actual !== expected) {
    throw new Error(`Migration source checksum drift detected: ${name}`);
  }
  return expected;
}
