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
      'idx_patients_city_lower_not_deleted',
      'ON "Patients" (LOWER("city")) WHERE COALESCE("isDeleted", false) = false'
    );
    await createIndex(
      queryInterface,
      'idx_patients_state_lower_not_deleted',
      'ON "Patients" (LOWER("state")) WHERE COALESCE("isDeleted", false) = false'
    );
    await createIndex(
      queryInterface,
      'idx_patients_zip_lower_not_deleted',
      'ON "Patients" (LOWER("zipCode")) WHERE COALESCE("isDeleted", false) = false'
    );
    await createIndex(
      queryInterface,
      'idx_patients_address_line_lower_not_deleted',
      'ON "Patients" (LOWER("addressLine1")) WHERE COALESCE("isDeleted", false) = false'
    );
  },

  async down(queryInterface) {
    const names = [
      'idx_patients_address_line_lower_not_deleted',
      'idx_patients_zip_lower_not_deleted',
      'idx_patients_state_lower_not_deleted',
      'idx_patients_city_lower_not_deleted'
    ];
    for (const name of names) {
      await dropIndex(queryInterface, name);
    }
  }
};
