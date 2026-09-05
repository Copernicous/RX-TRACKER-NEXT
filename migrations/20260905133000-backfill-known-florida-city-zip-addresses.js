'use strict';

const { parseAddress } = require('../utils/patientAddress');

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const [patients] = await queryInterface.sequelize.query(
        `SELECT id, address, "addressLine1", city, state, "zipCode"
           FROM "Patients"
          WHERE NULLIF(BTRIM(COALESCE(city, '')), '') IS NULL
            AND NULLIF(BTRIM(COALESCE("zipCode", '')), '') IS NULL
            AND NULLIF(BTRIM(COALESCE("addressLine1", address, '')), '') IS NOT NULL
          ORDER BY id`,
        { transaction }
      );

      for (const patient of patients) {
        const parsed = parseAddress(patient.addressLine1 || patient.address);
        if (!parsed.city || !parsed.zipCode) continue;
        await queryInterface.sequelize.query(
          `UPDATE "Patients"
              SET "addressLine1" = :addressLine1,
                  "city" = :city,
                  "state" = COALESCE(NULLIF(BTRIM(COALESCE("state", '')), ''), :state),
                  "zipCode" = :zipCode,
                  "updatedAt" = NOW()
            WHERE id = :id`,
          { replacements: { id: patient.id, ...parsed }, transaction }
        );
      }
    });
  },

  async down() {
    // Data backfill only. Keep user-visible structured address edits intact.
  }
};
