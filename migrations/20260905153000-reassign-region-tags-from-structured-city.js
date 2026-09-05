'use strict';

const { TAMPA_REGION_CITIES } = require('../utils/patientAddress');

const REGIONAL_GROUPS = ['region', 'city'];
const REGIONAL_NAMES = ['Miami', 'Tampa', 'None'];

async function tableExists(queryInterface, tableName, transaction) {
  const tables = await queryInterface.showAllTables({ transaction });
  return tables.some((entry) => {
    if (typeof entry === 'string') return entry === tableName;
    return entry.tableName === tableName || entry.table_name === tableName || entry.name === tableName;
  });
}

async function ensureRegionalTag(queryInterface, transaction, name, color) {
  const [existing] = await queryInterface.sequelize.query(
    `SELECT id
       FROM "PatientTags"
      WHERE LOWER(BTRIM("groupName")) IN (:groups)
        AND LOWER(BTRIM(name)) = LOWER(:name)
        AND "isActive" IS TRUE
      ORDER BY CASE WHEN LOWER(BTRIM("groupName")) = 'region' THEN 0 ELSE 1 END, id
      LIMIT 1`,
    { replacements: { groups: REGIONAL_GROUPS, name }, transaction }
  );
  if (existing.length) return existing[0].id;

  const [inserted] = await queryInterface.sequelize.query(
    `INSERT INTO "PatientTags" (name, "groupName", color, notes, "isDefault", "isActive", "createdAt", "updatedAt")
     VALUES (:name, 'Region', :color, :notes, FALSE, TRUE, NOW(), NOW())
     RETURNING id`,
    {
      replacements: {
        name,
        color,
        notes: 'Seeded for structured-city Region reassignment.'
      },
      transaction
    }
  );
  return inserted[0].id;
}

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      if (!await tableExists(queryInterface, 'Patients', transaction) ||
          !await tableExists(queryInterface, 'PatientTags', transaction) ||
          !await tableExists(queryInterface, 'PatientTagAssignments', transaction)) {
        throw new Error('Patients and patient tag tables are required before Region reassignment.');
      }

      const miamiId = await ensureRegionalTag(queryInterface, transaction, 'Miami', '#2563eb');
      const tampaId = await ensureRegionalTag(queryInterface, transaction, 'Tampa', '#16a34a');
      const noneId = await ensureRegionalTag(queryInterface, transaction, 'None', '#64748b');
      const tampaCities = TAMPA_REGION_CITIES.map(city => city.toLowerCase());

      await queryInterface.sequelize.query(
        `CREATE TEMP TABLE tmp_patient_region_targets ON COMMIT DROP AS
         SELECT p.id AS "patientId",
                CASE
                  WHEN NULLIF(BTRIM(COALESCE(p.city, '')), '') IS NOT NULL
                       AND LOWER(BTRIM(p.city)) IN (:tampaCities) THEN :tampaId
                  WHEN NULLIF(BTRIM(COALESCE(p.city, '')), '') IS NOT NULL THEN :miamiId
                  WHEN NULLIF(BTRIM(COALESCE(p.address, p."addressLine1", '')), '') IS NULL THEN :noneId
                  ELSE NULL
                END AS "targetTagId",
                EXISTS (
                  SELECT 1
                    FROM "PatientTagAssignments" existing_target
                   WHERE existing_target."patientId" = p.id
                     AND existing_target."patientTagId" = CASE
                       WHEN NULLIF(BTRIM(COALESCE(p.city, '')), '') IS NOT NULL
                            AND LOWER(BTRIM(p.city)) IN (:tampaCities) THEN :tampaId
                       WHEN NULLIF(BTRIM(COALESCE(p.city, '')), '') IS NOT NULL THEN :miamiId
                       WHEN NULLIF(BTRIM(COALESCE(p.address, p."addressLine1", '')), '') IS NULL THEN :noneId
                       ELSE NULL
                     END
                ) AS "hadTarget"
           FROM "Patients" p
          WHERE (
                NULLIF(BTRIM(COALESCE(p.city, '')), '') IS NOT NULL
             OR NULLIF(BTRIM(COALESCE(p.address, p."addressLine1", '')), '') IS NULL
          )
            AND EXISTS (
                SELECT 1
                  FROM "PatientTagAssignments" existing_assignment
                  JOIN "PatientTags" existing_tag ON existing_tag.id = existing_assignment."patientTagId"
                 WHERE existing_assignment."patientId" = p.id
                   AND existing_tag."isActive" IS TRUE
                   AND LOWER(BTRIM(existing_tag."groupName")) IN (:groups)
                   AND LOWER(BTRIM(existing_tag.name)) IN ('miami', 'tampa', 'none')
            )`,
        {
          replacements: {
            tampaCities,
            groups: REGIONAL_GROUPS,
            miamiId,
            tampaId,
            noneId
          },
          transaction
        }
      );

      await queryInterface.sequelize.query(
        `INSERT INTO "PatientTagAssignments" ("patientId", "patientTagId", "createdAt", "updatedAt")
         SELECT "patientId", "targetTagId", NOW(), NOW()
           FROM tmp_patient_region_targets
          WHERE "targetTagId" IS NOT NULL
            AND "hadTarget" IS FALSE
         ON CONFLICT ("patientId", "patientTagId") DO NOTHING`,
        { transaction }
      );

      await queryInterface.sequelize.query(
        `DELETE FROM "PatientTagAssignments"
          WHERE id IN (
            SELECT DISTINCT ON (target."patientId") assignment.id
              FROM tmp_patient_region_targets target
              JOIN "PatientTagAssignments" assignment ON assignment."patientId" = target."patientId"
              JOIN "PatientTags" tag ON tag.id = assignment."patientTagId"
             WHERE target."targetTagId" IS NOT NULL
               AND target."hadTarget" IS FALSE
               AND assignment."patientTagId" <> target."targetTagId"
               AND tag."isActive" IS TRUE
               AND LOWER(BTRIM(tag."groupName")) IN (:groups)
               AND LOWER(BTRIM(tag.name)) IN ('miami', 'tampa', 'none')
             ORDER BY target."patientId", assignment.id
          )`,
        { replacements: { groups: REGIONAL_GROUPS }, transaction }
      );
    });
  },

  async down() {
    // One-time data reassignment only. Preserve the current operator-reviewed Region assignments.
  }
};
