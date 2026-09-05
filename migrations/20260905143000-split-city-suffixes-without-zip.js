'use strict';

const {
  splitKnownFloridaCityFromStreetLoose
} = require('../utils/patientAddress');

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const [patients] = await queryInterface.sequelize.query(
        `SELECT id, address, "addressLine1", city, state, "zipCode"
           FROM "Patients"
          WHERE NULLIF(BTRIM(COALESCE("addressLine1", '')), '') IS NOT NULL
            AND NULLIF(BTRIM(COALESCE(city, '')), '') IS NULL
            AND NULLIF(BTRIM(COALESCE(state, '')), '') IS NULL
            AND NULLIF(BTRIM(COALESCE("zipCode", '')), '') IS NULL
          ORDER BY id`,
        { transaction }
      );

      for (const patient of patients) {
        const parsed = splitKnownFloridaCityFromStreetLoose(patient.addressLine1);
        if (!parsed || !parsed.addressLine1 || !parsed.city) continue;
        await queryInterface.sequelize.query(
          `UPDATE "Patients"
              SET "addressLine1" = :addressLine1,
                  "city" = :city,
                  "state" = :state,
                  "updatedAt" = NOW()
            WHERE id = :id`,
          {
            replacements: {
              id: patient.id,
              addressLine1: parsed.addressLine1,
              city: parsed.city,
              state: parsed.state
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
