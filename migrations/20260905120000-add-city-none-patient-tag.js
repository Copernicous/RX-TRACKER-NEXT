'use strict';

const CITY_GROUP = 'City';
const NONE = 'None';
const MIAMI = 'Miami';

async function tableExists(queryInterface, tableName, transaction) {
  const tables = await queryInterface.showAllTables({ transaction });
  return tables.some((entry) => {
    if (typeof entry === 'string') return entry === tableName;
    return entry.tableName === tableName || entry.table_name === tableName || entry.name === tableName;
  });
}

async function ensureCityNoneTag(queryInterface, transaction) {
  const [existing] = await queryInterface.sequelize.query(
    `SELECT id
       FROM "PatientTags"
      WHERE LOWER(BTRIM("groupName")) = 'city'
        AND LOWER(BTRIM(name)) = 'none'
      ORDER BY id
      LIMIT 1`,
    { transaction }
  );

  if (existing.length) {
    await queryInterface.sequelize.query(
      `UPDATE "PatientTags"
          SET name = :name,
              "groupName" = :groupName,
              color = COALESCE(color, :color),
              "isDefault" = FALSE,
              "isActive" = TRUE,
              "updatedAt" = NOW()
        WHERE id = :id`,
      {
        replacements: {
          id: existing[0].id,
          name: NONE,
          groupName: CITY_GROUP,
          color: '#64748b'
        },
        transaction
      }
    );
    return existing[0].id;
  }

  const [inserted] = await queryInterface.sequelize.query(
    `INSERT INTO "PatientTags" (name, "groupName", color, notes, "isDefault", "isActive", "createdAt", "updatedAt")
     VALUES (:name, :groupName, :color, :notes, FALSE, TRUE, NOW(), NOW())
     RETURNING id`,
    {
      replacements: {
        name: NONE,
        groupName: CITY_GROUP,
        color: '#64748b',
        notes: 'Seeded for blank-address patient classification during the city tag rollout.'
      },
      transaction
    }
  );
  return inserted[0].id;
}

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      if (!await tableExists(queryInterface, 'PatientTags', transaction) ||
          !await tableExists(queryInterface, 'PatientTagAssignments', transaction)) {
        throw new Error('Patient tag tables are required before adding the City: None tag.');
      }

      const noneId = await ensureCityNoneTag(queryInterface, transaction);

      await queryInterface.sequelize.query(
        `DELETE FROM "PatientTagAssignments" assignments
          USING "Patients" patients, "PatientTags" tags
         WHERE assignments."patientId" = patients.id
           AND assignments."patientTagId" = tags.id
           AND LOWER(BTRIM(tags."groupName")) = 'city'
           AND LOWER(BTRIM(tags.name)) = 'miami'
           AND NULLIF(BTRIM(COALESCE(patients.address, '')), '') IS NULL`,
        { transaction }
      );

      await queryInterface.sequelize.query(
        `INSERT INTO "PatientTagAssignments" ("patientId", "patientTagId", "createdAt", "updatedAt")
         SELECT patients.id, :noneId, NOW(), NOW()
           FROM "Patients" patients
          WHERE NULLIF(BTRIM(COALESCE(patients.address, '')), '') IS NULL
         ON CONFLICT ("patientId", "patientTagId") DO NOTHING`,
        { replacements: { noneId }, transaction }
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      if (!await tableExists(queryInterface, 'PatientTags', transaction) ||
          !await tableExists(queryInterface, 'PatientTagAssignments', transaction)) {
        return;
      }

      const [tags] = await queryInterface.sequelize.query(
        `SELECT id, LOWER(BTRIM(name)) AS normalized_name
           FROM "PatientTags"
          WHERE LOWER(BTRIM("groupName")) = 'city'
            AND LOWER(BTRIM(name)) IN ('none', 'miami')`,
        { transaction }
      );
      const none = tags.find(tag => tag.normalized_name === 'none');
      const miami = tags.find(tag => tag.normalized_name === 'miami');
      if (!none) return;

      if (miami) {
        await queryInterface.sequelize.query(
          `INSERT INTO "PatientTagAssignments" ("patientId", "patientTagId", "createdAt", "updatedAt")
           SELECT assignments."patientId", :miamiId, NOW(), NOW()
             FROM "PatientTagAssignments" assignments
            WHERE assignments."patientTagId" = :noneId
           ON CONFLICT ("patientId", "patientTagId") DO NOTHING`,
          { replacements: { noneId: none.id, miamiId: miami.id }, transaction }
        );
      }

      await queryInterface.sequelize.query(
        `DELETE FROM "PatientTagAssignments"
          WHERE "patientTagId" = :noneId`,
        { replacements: { noneId: none.id }, transaction }
      );
      await queryInterface.sequelize.query(
        `DELETE FROM "PatientTags"
          WHERE id = :noneId`,
        { replacements: { noneId: none.id }, transaction }
      );
    });
  }
};
