'use strict';

const TABLE_NAME = 'CityRegionRules';
const TAMPA_REGION_CITIES = [
  'Bartow',
  'Brandon',
  'Cape Coral',
  'Dover',
  'Holiday',
  'Kissimmee',
  'Lake Wales',
  'Lakeland',
  'Lehigh Acres',
  'Moore Haven',
  'Naples',
  'Orlando',
  'Plant City',
  'Port Richey',
  'Riverview',
  'Ruskin',
  'Sarasota',
  'Seffner',
  'Spring Hill',
  'St Petersburg',
  'Tampa',
  'Temple Terrace',
  'Valrico',
  'Wesley Chapel'
];

async function tableExists(queryInterface) {
  const tables = await queryInterface.showAllTables();
  return tables.some(table => {
    const name = typeof table === 'string' ? table : table.tableName;
    return name === TABLE_NAME;
  });
}

async function findRegionTagId(queryInterface, name) {
  const [rows] = await queryInterface.sequelize.query(`
    SELECT id
    FROM "PatientTags"
    WHERE "isActive" = true
      AND LOWER(TRIM(COALESCE("name", ''))) = LOWER(TRIM(:name))
      AND LOWER(TRIM(COALESCE("groupName", ''))) IN ('region', 'city')
    ORDER BY CASE WHEN LOWER(TRIM(COALESCE("groupName", ''))) = 'region' THEN 0 ELSE 1 END, id
    LIMIT 1
  `, { replacements: { name } });
  return rows && rows[0] ? rows[0].id : null;
}

module.exports = {
  async up(queryInterface, Sequelize) {
    if (!(await tableExists(queryInterface))) {
      await queryInterface.createTable(TABLE_NAME, {
        id: {
          allowNull: false,
          autoIncrement: true,
          primaryKey: true,
          type: Sequelize.INTEGER
        },
        city: {
          allowNull: false,
          type: Sequelize.STRING
        },
        patientTagId: {
          allowNull: false,
          type: Sequelize.INTEGER,
          references: { model: 'PatientTags', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'RESTRICT'
        },
        notes: {
          allowNull: true,
          type: Sequelize.TEXT
        },
        isActive: {
          allowNull: false,
          type: Sequelize.BOOLEAN,
          defaultValue: true
        },
        createdAt: {
          allowNull: false,
          type: Sequelize.DATE,
          defaultValue: Sequelize.fn('NOW')
        },
        updatedAt: {
          allowNull: false,
          type: Sequelize.DATE,
          defaultValue: Sequelize.fn('NOW')
        }
      });
    }

    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_city_region_rules_active_city"
      ON "CityRegionRules" (LOWER(TRIM(city)))
      WHERE "isActive" = true
    `);
    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS "idx_city_region_rules_patient_tag"
      ON "CityRegionRules" ("patientTagId")
    `);

    const tampaTagId = await findRegionTagId(queryInterface, 'Tampa');
    if (!tampaTagId) return;

    for (const city of TAMPA_REGION_CITIES) {
      await queryInterface.sequelize.query(`
        INSERT INTO "CityRegionRules" (city, "patientTagId", notes, "isActive", "createdAt", "updatedAt")
        SELECT :city, :patientTagId, 'Seeded approved Tampa-region city mapping.', true, NOW(), NOW()
        WHERE NOT EXISTS (
          SELECT 1
          FROM "CityRegionRules"
          WHERE "isActive" = true
            AND LOWER(TRIM(city)) = LOWER(TRIM(:city))
        )
      `, { replacements: { city, patientTagId: tampaTagId } });
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable(TABLE_NAME);
  }
};
