'use strict';

const {
  cleanAddressCityWithZipReference
} = require('../utils/patientAddress');

function same(left, right) {
  return String(left || '').trim() === String(right || '').trim();
}

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const [patients] = await queryInterface.sequelize.query(
        `SELECT id, address, "addressLine1", city, state, "zipCode"
           FROM "Patients"
          WHERE NULLIF(BTRIM(COALESCE("zipCode", '')), '') IS NOT NULL
          ORDER BY id`,
        { transaction }
      );

      for (const patient of patients) {
        const parsed = cleanAddressCityWithZipReference(patient);
        if (!parsed || !parsed.city || !parsed.zipCode) continue;
        if (
          same(patient.addressLine1, parsed.addressLine1) &&
          same(patient.city, parsed.city) &&
          same(patient.state, parsed.state) &&
          same(patient.zipCode, parsed.zipCode)
        ) continue;

        await queryInterface.sequelize.query(
          `UPDATE "Patients"
              SET "addressLine1" = :addressLine1,
                  "city" = :city,
                  "state" = :state,
                  "zipCode" = :zipCode,
                  "updatedAt" = NOW()
            WHERE id = :id`,
          {
            replacements: {
              id: patient.id,
              ...parsed
            },
            transaction
          }
        );
      }
    });
  },

  async down() {
    // Data cleanup only. Keep user-visible structured address edits intact.
  }
};
