'use strict';

async function createIndex(queryInterface, name, expression) {
  await queryInterface.sequelize.query(`CREATE INDEX IF NOT EXISTS ${name} ${expression}`);
}

async function dropIndex(queryInterface, name) {
  await queryInterface.sequelize.query(`DROP INDEX IF EXISTS ${name}`);
}

module.exports = {
  async up(queryInterface) {
    await createIndex(
      queryInterface,
      'idx_patients_call_center_queue',
      'ON "Patients" ("serviceDate", id) WHERE "isActive" = true AND COALESCE("isDeleted", false) = false AND COALESCE("isNonCompanyPatient", false) = false AND "serviceDate" IS NOT NULL'
    );
    await createIndex(
      queryInterface,
      'idx_call_attempts_patient_state_active',
      'ON "CallCenterCallAttempts" ("patientId", state, "dialedAt" DESC) WHERE "endedAt" IS NULL'
    );
    await createIndex(
      queryInterface,
      'idx_call_center_locks_active_patient_user',
      'ON "CallCenterLocks" ("expiresAt", "patientId", "userId")'
    );
  },

  async down(queryInterface) {
    const names = [
      'idx_call_center_locks_active_patient_user',
      'idx_call_attempts_patient_state_active',
      'idx_patients_call_center_queue'
    ];
    for (const name of names) {
      await dropIndex(queryInterface, name);
    }
  }
};
