'use strict';

const CITY_GROUP = 'City';
const CITY_TAGS = [
  { canonical: 'Miami', color: '#2563eb', isDefault: true },
  { canonical: 'Tampa', color: '#16a34a', isDefault: false }
];

async function tableExists(queryInterface, tableName, transaction) {
  const tables = await queryInterface.showAllTables({ transaction });
  return tables.some((entry) => {
    if (typeof entry === 'string') return entry === tableName;
    return entry.tableName === tableName || entry.table_name === tableName || entry.name === tableName;
  });
}

async function normalizeCityTag(queryInterface, transaction, config) {
  const [matches] = await queryInterface.sequelize.query(
    `SELECT id, name
       FROM "PatientTags"
      WHERE LOWER(BTRIM("groupName")) = 'city'
        AND LOWER(BTRIM(name)) = LOWER(BTRIM(:name))
      ORDER BY CASE WHEN name = :name THEN 0 ELSE 1 END, id`,
    { replacements: { name: config.canonical }, transaction }
  );

  let canonicalId = matches[0]?.id;
  if (!canonicalId) {
    const [inserted] = await queryInterface.sequelize.query(
      `INSERT INTO "PatientTags" (name, "groupName", color, notes, "isDefault", "isActive", "createdAt", "updatedAt")
       VALUES (:name, :groupName, :color, :notes, :isDefault, TRUE, NOW(), NOW())
       RETURNING id`,
      {
        replacements: {
          name: config.canonical,
          groupName: CITY_GROUP,
          color: config.color,
          notes: 'Seeded for one-time city classification during the patient tags rollout.',
          isDefault: config.isDefault
        },
        transaction
      }
    );
    canonicalId = inserted[0].id;
  }

  await queryInterface.sequelize.query(
    `UPDATE "PatientTags"
        SET name = :name,
            "groupName" = :groupName,
            color = COALESCE(color, :color),
            "isDefault" = :isDefault,
            "isActive" = TRUE,
            "updatedAt" = NOW()
      WHERE id = :id`,
    {
      replacements: {
        id: canonicalId,
        name: config.canonical,
        groupName: CITY_GROUP,
        color: config.color,
        isDefault: config.isDefault
      },
      transaction
    }
  );

  const duplicateIds = matches.map(row => row.id).filter(id => Number(id) !== Number(canonicalId));
  if (!duplicateIds.length) return canonicalId;

  await queryInterface.sequelize.query(
    `INSERT INTO "PatientTagAssignments" ("patientId", "patientTagId", "createdAt", "updatedAt")
     SELECT DISTINCT "patientId", :canonicalId, NOW(), NOW()
       FROM "PatientTagAssignments"
      WHERE "patientTagId" IN (:duplicateIds)
     ON CONFLICT ("patientId", "patientTagId") DO NOTHING`,
    { replacements: { canonicalId, duplicateIds }, transaction }
  );

  await queryInterface.sequelize.query(
    `DELETE FROM "PatientTagAssignments"
      WHERE "patientTagId" IN (:duplicateIds)`,
    { replacements: { duplicateIds }, transaction }
  );

  await queryInterface.sequelize.query(
    `DELETE FROM "PatientTags"
      WHERE id IN (:duplicateIds)`,
    { replacements: { duplicateIds }, transaction }
  );

  return canonicalId;
}

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      if (!await tableExists(queryInterface, 'PatientTags', transaction) ||
          !await tableExists(queryInterface, 'PatientTagAssignments', transaction)) {
        throw new Error('Patient tag tables are required before normalizing city patient tags.');
      }

      for (const config of CITY_TAGS) {
        await normalizeCityTag(queryInterface, transaction, config);
      }
    });
  },

  async down() {
    // Intentionally no-op: merging duplicate city tag variants is data cleanup.
  }
};
