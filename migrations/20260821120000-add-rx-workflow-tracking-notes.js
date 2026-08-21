'use strict';

async function tableExists(queryInterface, tableName, transaction) {
  const tables = await queryInterface.showAllTables({ transaction });
  return tables.some((entry) => {
    if (typeof entry === 'string') return entry === tableName;
    return entry.tableName === tableName || entry.table_name === tableName || entry.name === tableName;
  });
}

async function columnExists(queryInterface, tableName, columnName, transaction) {
  if (!await tableExists(queryInterface, tableName, transaction)) return false;
  const description = await queryInterface.describeTable(tableName, { transaction });
  return Object.prototype.hasOwnProperty.call(description, columnName);
}

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      if (!await columnExists(queryInterface, 'RXWorkflowTrackings', 'notes', transaction)) {
        await queryInterface.addColumn('RXWorkflowTrackings', 'notes', {
          type: Sequelize.TEXT,
          allowNull: true
        }, { transaction });
      }
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      if (await columnExists(queryInterface, 'RXWorkflowTrackings', 'notes', transaction)) {
        await queryInterface.removeColumn('RXWorkflowTrackings', 'notes', { transaction });
      }
    });
  }
};
