'use strict';

const INDEX_NAME = 'uq_pharmacy_transport_active_company_name_ci';

module.exports = {
  async up(queryInterface) {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      const [existingIndex] = await queryInterface.sequelize.query(
        `SELECT 1
           FROM pg_indexes
          WHERE schemaname = current_schema()
            AND tablename = 'PharmacyTransportCompanies'
            AND indexname = :indexName`,
        { replacements: { indexName: INDEX_NAME }, transaction }
      );

      if (!existingIndex.length) {
        const [duplicates] = await queryInterface.sequelize.query(
          `SELECT LOWER(BTRIM(REGEXP_REPLACE("companyName", '[[:space:]]+', ' ', 'g'))) AS normalized_name,
                  ARRAY_AGG(id ORDER BY id) AS ids
             FROM "PharmacyTransportCompanies"
            WHERE "isActive" IS TRUE
              AND NULLIF(BTRIM("companyName"), '') IS NOT NULL
            GROUP BY 1
           HAVING COUNT(*) > 1`,
          { transaction }
        );
        if (duplicates.length) {
          const summary = duplicates.map(row => `${row.normalized_name} (IDs ${row.ids.join(', ')})`).join('; ');
          throw new Error(`Cannot protect Pharmacy Transport names while active duplicates exist: ${summary}`);
        }

        await queryInterface.sequelize.query(
          `CREATE UNIQUE INDEX "${INDEX_NAME}"
             ON "PharmacyTransportCompanies"
             (LOWER(BTRIM(REGEXP_REPLACE("companyName", '[[:space:]]+', ' ', 'g'))))
          WHERE "isActive" IS TRUE
            AND NULLIF(BTRIM("companyName"), '') IS NOT NULL`,
          { transaction }
        );
      }

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  async down(queryInterface) {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      await queryInterface.sequelize.query(
        `DROP INDEX IF EXISTS "${INDEX_NAME}"`,
        { transaction }
      );
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }
};
