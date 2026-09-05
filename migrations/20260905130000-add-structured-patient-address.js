'use strict';

const { DataTypes } = require('sequelize');
const { parseAddress } = require('../utils/patientAddress');

const COLUMNS = [
  ['addressLine1', { type: 'STRING' }],
  ['city', { type: 'STRING' }],
  ['state', { type: 'STRING' }],
  ['zipCode', { type: 'STRING' }]
];

async function columnExists(queryInterface, tableName, columnName, transaction) {
  const table = await queryInterface.describeTable(tableName, { transaction });
  return Boolean(table[columnName]);
}

async function addColumnIfMissing(queryInterface, tableName, columnName, definition, transaction) {
  if (await columnExists(queryInterface, tableName, columnName, transaction)) return;
  await queryInterface.addColumn(tableName, columnName, {
    type: DataTypes[definition.type],
    allowNull: true
  }, { transaction });
}

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      for (const [name, definition] of COLUMNS) {
        await addColumnIfMissing(queryInterface, 'Patients', name, definition, transaction);
      }

      const [patients] = await queryInterface.sequelize.query(
        `SELECT id, address
           FROM "Patients"
          WHERE ("addressLine1" IS NULL OR "city" IS NULL OR "state" IS NULL OR "zipCode" IS NULL)
            AND NULLIF(BTRIM(COALESCE(address, '')), '') IS NOT NULL
          ORDER BY id`,
        { transaction }
      );

      for (const patient of patients) {
        const parsed = parseAddress(patient.address);
        await queryInterface.sequelize.query(
          `UPDATE "Patients"
              SET "addressLine1" = COALESCE("addressLine1", :addressLine1),
                  "city" = COALESCE("city", :city),
                  "state" = COALESCE("state", :state),
                  "zipCode" = COALESCE("zipCode", :zipCode),
                  "updatedAt" = NOW()
            WHERE id = :id`,
          { replacements: { id: patient.id, ...parsed }, transaction }
        );
      }
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      for (const [name] of COLUMNS.slice().reverse()) {
        if (await columnExists(queryInterface, 'Patients', name, transaction)) {
          await queryInterface.removeColumn('Patients', name, { transaction });
        }
      }
    });
  }
};
