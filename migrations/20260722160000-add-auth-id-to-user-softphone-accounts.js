'use strict';

async function tableExists(queryInterface, tableName) {
  const tables = await queryInterface.showAllTables();
  return tables.some((table) => String(typeof table === 'string' ? table : (table.tableName || table.name || '')) === tableName);
}

module.exports = {
  async up(queryInterface, Sequelize) {
    const tableName = 'UserSoftphoneAccounts';
    if (!await tableExists(queryInterface, tableName)) {
      throw new Error(`${tableName} must exist before adding SIP Auth ID support.`);
    }

    const columns = await queryInterface.describeTable(tableName);
    if (!columns.authId) {
      await queryInterface.addColumn(tableName, 'authId', {
        allowNull: true,
        type: Sequelize.STRING(128)
      });
    }
  },

  async down(queryInterface) {
    const tableName = 'UserSoftphoneAccounts';
    if (!await tableExists(queryInterface, tableName)) return;
    const columns = await queryInterface.describeTable(tableName);
    if (columns.authId) await queryInterface.removeColumn(tableName, 'authId');
  }
};
