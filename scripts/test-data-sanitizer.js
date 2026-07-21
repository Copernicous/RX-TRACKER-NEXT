'use strict';

require('dotenv').config();

const assert = require('assert');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../models');
const { assertDatabaseReady } = require('../db/schema-verifier');
const {
  sanitizeDatabase,
  validateSanitizedDatabase,
  createSanitizedAdmin
} = require('../db/data-sanitizer');

async function main() {
  const database = String(db.sequelize.config.database || '');
  if (!/(sanitizer.*test|test.*sanitizer)/i.test(database)) {
    throw new Error(`Refusing sanitizer regression on ${database}; use a dedicated sanitizer test database.`);
  }

  await assertDatabaseReady(db);
  let user = await db.User.findOne({ order: [['id', 'ASC']] });
  if (!user) {
    const adminRole = await db.Role.findOne({ where: { name: 'Administrator' } });
    assert(adminRole, 'Reference seeding must provide the Administrator role.');
    const fixtureId = Date.now();
    user = await db.User.create({
      firstName: 'Fixture',
      lastName: 'Administrator',
      username: `sanitizer_fixture_${fixtureId}`,
      email: `sanitizer_fixture_${fixtureId}@example.test`,
      passwordHash: await bcrypt.hash('Sanitizer-Fixture-Only!42', 8),
      roleId: adminRole.id,
      isActive: true,
      isMaster: true
    });
  }

  const clinic = await db.Clinic.create({
    name: 'Sensitive Clinic', address: '123 Private Road', phone: '3055550199',
    contactPerson: 'Private Contact', notes: 'Private clinic note', isActive: true
  });
  const pharmacy = await db.Pharmacy.create({
    name: 'Sensitive Pharmacy', address: '124 Private Road', phone: '3055550198',
    contactPerson: 'Private Pharmacist', notes: 'Private pharmacy note', isActive: true
  });
  const patientTransport = await db.PatientTransportCompany.create({
    companyName: 'Sensitive Patient Transport', phone: '3055550197',
    contactPerson: 'Private Dispatcher', notes: 'Private transport note', isActive: true
  });
  const pharmacyTransport = await db.PharmacyTransportCompany.create({
    companyName: 'Sensitive Pharmacy Transport', phone: '3055550196',
    contactPerson: 'Private Courier', notes: 'Private courier note', isActive: true
  });
  const patient = await db.Patient.create({
    firstName: 'Private', lastName: 'Patient', dob: '1980-05-04',
    address: '125 Private Road', phone: '3055550195', serviceDate: '2026-01-01',
    patientTransportCompanyId: patientTransport.id,
    pharmacyTransportCompanyId: pharmacyTransport.id,
    clinicId: clinic.id,
    pharmacyId: pharmacy.id,
    patientCode: `PRIVATE-${Date.now()}`,
    notes: 'Private patient note', isActive: true, isDeleted: false
  });
  const rx = await db.RXRecord.create({
    patientId: patient.id, arrivalDate: '2026-01-01', serviceDate: '2026-01-01',
    pharmacyId: pharmacy.id, patientTransportCompanyId: patientTransport.id,
    pharmacyTransportCompanyId: pharmacyTransport.id
  });
  await db.Medication.create({ rxRecordId: rx.id, name: 'Sensitive Medication', quantity: 30, notes: 'Private medication note' });
  await db.PatientNote.create({ patientId: patient.id, userId: user.id, note: 'Sensitive patient note body', source: 'Patient' });
  const audit = await db.AuditLog.create({
    userId: user.id, module: 'Patients', action: 'Update', recordId: patient.id,
    previousValue: { firstName: 'Private' }, newValue: { phone: '3055550195' }, ipAddress: '203.0.113.10'
  });
  await db.RXHistory.create({
    rxRecordId: rx.id, userId: user.id, snapshot: JSON.stringify({ patient: 'Private Patient' }),
    changedFields: JSON.stringify([{ field: 'phone', from: 'old', to: 'new' }]), note: 'Private history note'
  });
  await db.ErrorLog.create({
    source: 'backend', severity: 'error', message: 'Private patient failed', stack: 'private stack',
    url: '/patients/private', userAgent: 'private agent', userId: user.id, ipAddress: '203.0.113.11'
  });
  await db.UserActivityLog.create({
    userId: user.id, usernameSnapshot: user.username, roleSnapshot: 'Administrator',
    pageUrl: 'https://example.invalid/patients/private', pagePath: '/patients', pageTitle: 'Private',
    ipAddress: '203.0.113.12', userAgent: 'private agent', referrer: 'https://example.invalid'
  });
  const dialedAt = new Date();
  const attempt = await db.CallCenterCallAttempt.create({
    patientId: patient.id, userId: user.id, calledAuditLogId: audit.id,
    correlationId: crypto.randomUUID(), phoneClient: 'rx_softphone', direction: 'outbound',
    state: 'ended', outcome: 'answered', patientCode: patient.patientCode,
    patientName: 'Private Patient', clinicName: 'Sensitive Clinic', agentName: 'Private Agent',
    extension: '1006', dialedNumber: '3055550195', sipResponseCode: 200,
    sipReason: 'Sensitive provider response', dialedAt,
    ringingAt: new Date(dialedAt.getTime() + 2000),
    answeredAt: new Date(dialedAt.getTime() + 5000),
    endedAt: new Date(dialedAt.getTime() + 10000),
    ringDurationSeconds: 3, conversationDurationSeconds: 5
  });
  await db.UserSoftphoneAccount.create({
    userId: user.id, server: 'pbx.private.invalid', port: 5060, username: '1006',
    displayName: 'Private Agent', localSipPort: 0, encryptedPassword: 'private-encrypted-value', isEnabled: true
  });
  await db.ApiKey.create({
    name: 'Private key', keyPrefix: 'rxk_private', keyHash: crypto.createHash('sha256').update('private').digest('hex'),
    description: 'Private API key', createdByUserId: user.id, isActive: true
  });
  await db.DocumentAttachment.create({
    ownerType: 'patient', patientId: patient.id, originalName: 'private.pdf', storedName: 'private.pdf',
    mimeType: 'application/pdf', sizeBytes: 100, provider: 'local', localPath: 'private/path', uploadedByUserId: user.id
  });
  await db.PatientLock.create({ patientId: patient.id, userId: user.id, expiresAt: new Date(Date.now() + 60000) });
  await db.CallCenterLock.create({ patientId: patient.id, userId: user.id, expiresAt: new Date(Date.now() + 60000) });
  const relay = await db.SoftphoneRelayDevice.create({
    userId: user.id, deviceKey: crypto.randomUUID(), deviceName: 'Private workstation',
    tokenHash: crypto.createHash('sha256').update('token').digest('hex'), isEnabled: true
  });
  await db.SoftphoneRelayCommand.create({
    deviceId: relay.id, userId: user.id, attemptId: attempt.id, commandType: 'dial',
    payload: { number: '3055550195' }, status: 'queued', expiresAt: new Date(Date.now() + 60000)
  });
  await db.SystemSetting.update({ value: 'private@example.invalid' }, { where: { key: 'smtp_user' } });
  await db.SystemSetting.update({ value: 'private-secret' }, { where: { key: 'smtp_pass' } });

  const patientsBefore = await db.Patient.count();
  const attemptsBefore = await db.CallCenterCallAttempt.count();
  const result = await sanitizeDatabase(db, { confirmDatabase: database });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(await db.Patient.count(), patientsBefore, 'Patient analytics rows must be retained.');
  assert.strictEqual(await db.CallCenterCallAttempt.count(), attemptsBefore, 'Call-attempt analytics rows must be retained.');
  assert.strictEqual(await db.UserSoftphoneAccount.count(), 0);
  assert.strictEqual(await db.SoftphoneRelayDevice.count(), 0);
  assert.strictEqual(await db.ApiKey.count(), 0);
  assert.strictEqual(await db.DocumentAttachment.count(), 0);

  const sanitizedPatient = await db.Patient.findByPk(patient.id);
  const sanitizedAttempt = await db.CallCenterCallAttempt.findByPk(attempt.id);
  assert.strictEqual(sanitizedPatient.firstName, 'Test');
  assert.match(sanitizedPatient.patientCode, /^SAN-[0-9]{8}$/);
  assert.match(sanitizedPatient.phone, /^20255501[0-9]{2}$/);
  const shiftedDays = Math.round((sanitizedAttempt.dialedAt.getTime() - dialedAt.getTime()) / 86400000);
  assert(shiftedDays <= -180 && shiftedDays >= -730, 'Exact event timestamps must receive the randomized privacy offset.');
  assert.strictEqual(sanitizedAttempt.ringDurationSeconds, 3);
  assert.strictEqual(sanitizedAttempt.conversationDurationSeconds, 5);
  assert.strictEqual(
    sanitizedAttempt.endedAt.getTime() - sanitizedAttempt.dialedAt.getTime(),
    10000,
    'Timestamp shifting must preserve call duration.'
  );

  await createSanitizedAdmin(db, {
    confirmDatabase: database,
    password: 'Sanitized-Test-Admin!42'
  });
  const finalValidation = await validateSanitizedDatabase(db);
  assert.strictEqual(finalValidation.ok, true);

  console.log('PASS database sanitization removes credentials and PHI snapshots while retaining relational analytics.');
  console.log(JSON.stringify({ patients: patientsBefore, callAttempts: attemptsBefore, violations: finalValidation.violations.length }));
}

main()
  .catch((error) => {
    console.error('FAIL database sanitizer regression');
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.sequelize.close().catch(() => {});
  });
