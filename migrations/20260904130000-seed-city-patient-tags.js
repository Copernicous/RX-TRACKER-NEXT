'use strict';

const CITY_GROUP = 'City';
const MIAMI = 'Miami';
const TAMPA = 'Tampa';

async function tableExists(queryInterface, tableName, transaction) {
  const tables = await queryInterface.showAllTables({ transaction });
  return tables.some((entry) => {
    if (typeof entry === 'string') return entry === tableName;
    return entry.tableName === tableName || entry.table_name === tableName || entry.name === tableName;
  });
}

async function ensureCityTag(queryInterface, transaction, name, color, isDefault) {
  const [existing] = await queryInterface.sequelize.query(
    `SELECT id
       FROM "PatientTags"
      WHERE "groupName" = :groupName
        AND name = :name
        AND "isActive" IS TRUE
      ORDER BY id
      LIMIT 1`,
    { replacements: { groupName: CITY_GROUP, name }, transaction }
  );
  if (existing.length) {
    await queryInterface.sequelize.query(
      `UPDATE "PatientTags"
          SET "isDefault" = :isDefault,
              color = COALESCE(color, :color),
              "updatedAt" = NOW()
        WHERE id = :id`,
      { replacements: { id: existing[0].id, color, isDefault }, transaction }
    );
    return existing[0].id;
  }

  const [inserted] = await queryInterface.sequelize.query(
    `INSERT INTO "PatientTags" (name, "groupName", color, notes, "isDefault", "isActive", "createdAt", "updatedAt")
     VALUES (:name, :groupName, :color, :notes, :isDefault, TRUE, NOW(), NOW())
     RETURNING id`,
    {
      replacements: {
        name,
        groupName: CITY_GROUP,
        color,
        notes: 'Seeded for one-time city classification during the patient tags rollout.',
        isDefault
      },
      transaction
    }
  );
  return inserted[0].id;
}

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      if (!await tableExists(queryInterface, 'PatientTags', transaction)) {
        throw new Error('PatientTags table is required before seeding city patient tags.');
      }
      if (!await tableExists(queryInterface, 'PatientTagAssignments', transaction)) {
        throw new Error('PatientTagAssignments table is required before assigning city patient tags.');
      }

      const miamiId = await ensureCityTag(queryInterface, transaction, MIAMI, '#2563eb', true);
      const tampaId = await ensureCityTag(queryInterface, transaction, TAMPA, '#16a34a', false);

      await queryInterface.sequelize.query(
        `INSERT INTO "PatientTagAssignments" ("patientId", "patientTagId", "createdAt", "updatedAt")
         SELECT p.id,
                CASE
                  WHEN COALESCE(p.address, '') ~* '(^|[^[:alpha:]])tampa([^[:alpha:]]|$)' THEN :tampaId
                  ELSE :miamiId
                END AS "patientTagId",
                NOW(),
                NOW()
           FROM "Patients" p
          WHERE NOT EXISTS (
                SELECT 1
                  FROM "PatientTagAssignments" existing_assignment
                  JOIN "PatientTags" existing_tag ON existing_tag.id = existing_assignment."patientTagId"
                 WHERE existing_assignment."patientId" = p.id
                   AND existing_tag."isActive" IS TRUE
                   AND LOWER(BTRIM(existing_tag."groupName")) = 'city'
          )
         ON CONFLICT ("patientId", "patientTagId") DO NOTHING`,
        { replacements: { miamiId, tampaId }, transaction }
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      if (!await tableExists(queryInterface, 'PatientTags', transaction) ||
          !await tableExists(queryInterface, 'PatientTagAssignments', transaction)) {
        return;
      }

      await queryInterface.sequelize.query(
        `DELETE FROM "PatientTagAssignments" assignments
          USING "PatientTags" tags
         WHERE tags.id = assignments."patientTagId"
           AND tags."groupName" = :groupName
           AND tags.name IN (:names)`,
        { replacements: { groupName: CITY_GROUP, names: [MIAMI, TAMPA] }, transaction }
      );
      await queryInterface.sequelize.query(
        `DELETE FROM "PatientTags"
         WHERE "groupName" = :groupName
           AND name IN (:names)`,
        { replacements: { groupName: CITY_GROUP, names: [MIAMI, TAMPA] }, transaction }
      );
    });
  }
};
