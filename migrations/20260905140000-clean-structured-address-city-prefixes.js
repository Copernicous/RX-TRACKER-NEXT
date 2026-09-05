'use strict';

const { parseAddress } = require('../utils/patientAddress');

function changed(current, next) {
  return String(current || '').trim() !== String(next || '').trim();
}

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const [patients] = await queryInterface.sequelize.query(
        `SELECT id, address, "addressLine1", city, state, "zipCode"
           FROM "Patients"
          WHERE NULLIF(BTRIM(COALESCE(address, "addressLine1", '')), '') IS NOT NULL
          ORDER BY id`,
        { transaction }
      );

      for (const patient of patients) {
        const parsed = parseAddress(patient.address || patient.addressLine1);
        if (!parsed.city || !parsed.zipCode) continue;
        if (
          !changed(patient.addressLine1, parsed.addressLine1) &&
          !changed(patient.city, parsed.city) &&
          !changed(patient.state, parsed.state) &&
          !changed(patient.zipCode, parsed.zipCode)
        ) continue;

        await queryInterface.sequelize.query(
          `UPDATE "Patients"
              SET "addressLine1" = :addressLine1,
                  "city" = :city,
                  "state" = :state,
                  "zipCode" = :zipCode,
                  "updatedAt" = NOW()
            WHERE id = :id`,
          { replacements: { id: patient.id, ...parsed }, transaction }
        );
      }
    });
  },

  async down() {
    // Data cleanup only. Keep user-visible structured address edits intact.
  }
};
