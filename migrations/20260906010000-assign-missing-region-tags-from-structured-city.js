'use strict';

const { TAMPA_REGION_CITIES } = require('../utils/patientAddress');

const REGIONAL_GROUPS = ['region', 'city'];
const REGIONAL_NAMES = ['miami', 'tampa', 'none'];

async function tableExists(queryInterface, tableName, transaction) {
  const tables = await queryInterface.showAllTables({ transaction });
  return tables.some((entry) => {
    if (typeof entry === 'string') return entry === tableName;
    return entry.tableName === tableName || entry.table_name === tableName || entry.name === tableName;
  });
}

async function getRegionalTagId(queryInterface, transaction, name) {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT id
       FROM "PatientTags"
      WHERE LOWER(BTRIM("groupName")) IN (:groups)
        AND LOWER(BTRIM(name)) = :name
        AND "isActive" IS TRUE
      ORDER BY CASE WHEN LOWER(BTRIM("groupName")) = 'region' THEN 0 ELSE 1 END, id
      LIMIT 1`,
    { replacements: { groups: REGIONAL_GROUPS, name }, transaction }
  );
  if (!rows.length) {
    throw new Error(`Missing active ${name} Region/City Patient Tag.`);
  }
  return rows[0].id;
}

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      if (!await tableExists(queryInterface, 'Patients', transaction) ||
          !await tableExists(queryInterface, 'PatientTags', transaction) ||
          !await tableExists(queryInterface, 'PatientTagAssignments', transaction)) {
        throw new Error('Patients and patient tag tables are required before missing Region assignment cleanup.');
      }

      const miamiId = await getRegionalTagId(queryInterface, transaction, 'miami');
      const tampaId = await getRegionalTagId(queryInterface, transaction, 'tampa');
      const noneId = await getRegionalTagId(queryInterface, transaction, 'none');
      const tampaCities = TAMPA_REGION_CITIES.map((city) => city.toLowerCase());

      await queryInterface.sequelize.query(
        `WITH regional AS (
           SELECT p.id,
                  CASE
                    WHEN NULLIF(BTRIM(COALESCE(p.city, '')), '') IS NOT NULL
                         AND LOWER(BTRIM(p.city)) IN (:tampaCities) THEN :tampaId
                    WHEN NULLIF(BTRIM(COALESCE(p.city, '')), '') IS NOT NULL THEN :miamiId
                    WHEN NULLIF(BTRIM(COALESCE(p.address, p."addressLine1", '')), '') IS NULL THEN :noneId
                    ELSE NULL
                  END AS "targetTagId",
                  BOOL_OR(existing_tag."isActive" IS TRUE
                    AND LOWER(BTRIM(existing_tag."groupName")) IN (:groups)
                    AND LOWER(BTRIM(existing_tag.name)) IN (:names)) AS "hasRegionalTag"
             FROM "Patients" p
             LEFT JOIN "PatientTagAssignments" existing_assignment
               ON existing_assignment."patientId" = p.id
             LEFT JOIN "PatientTags" existing_tag
               ON existing_tag.id = existing_assignment."patientTagId"
            GROUP BY p.id, p.city, p.address, p."addressLine1"
         )
         INSERT INTO "PatientTagAssignments" ("patientId", "patientTagId", "createdAt", "updatedAt")
         SELECT id, "targetTagId", NOW(), NOW()
           FROM regional
          WHERE "targetTagId" IS NOT NULL
            AND "hasRegionalTag" IS NOT TRUE
         ON CONFLICT ("patientId", "patientTagId") DO NOTHING`,
        {
          replacements: {
            groups: REGIONAL_GROUPS,
            names: REGIONAL_NAMES,
            tampaCities,
            miamiId,
            tampaId,
            noneId
          },
          transaction
        }
      );
    });
  },

  async down() {
    // Data completion only. Preserve operator-reviewed Region assignments.
  }
};
