'use strict';

const { normalizeStructuredAddressForReference } = require('../utils/patientAddress');

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim() || null;
}

function same(left, right) {
  return clean(left) === clean(right);
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
        const parsed = normalizeStructuredAddressForReference(patient);
        if (!parsed.addressLine1 && !parsed.city && !parsed.state && !parsed.zipCode) continue;
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
    // Data cleanup only. Preserve the original full address reference.
  }
};
