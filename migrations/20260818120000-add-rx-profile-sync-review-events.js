'use strict';

async function tableExists(queryInterface, tableName, transaction) {
  const tables = await queryInterface.showAllTables({ transaction });
  return tables.some(entry => typeof entry === 'string'
    ? entry === tableName
    : entry.tableName === tableName || entry.table_name === tableName || entry.name === tableName);
}

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async transaction => {
      if (!await tableExists(queryInterface, 'RXProfileSyncReviewEvents', transaction)) {
        await queryInterface.createTable('RXProfileSyncReviewEvents', {
          id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
          rxRecordId: { allowNull: false, type: Sequelize.INTEGER },
          fieldName: { allowNull: false, type: Sequelize.STRING(64) },
          rxValueId: { allowNull: true, type: Sequelize.INTEGER },
          patientValueId: { allowNull: false, type: Sequelize.INTEGER },
          fingerprint: { allowNull: false, type: Sequelize.STRING(64) },
          action: { allowNull: false, type: Sequelize.STRING(16) },
          reason: { allowNull: true, type: Sequelize.TEXT },
          userId: { allowNull: true, type: Sequelize.INTEGER },
          createdAt: { allowNull: false, type: Sequelize.DATE }
        }, { transaction });

        await queryInterface.addConstraint('RXProfileSyncReviewEvents', {
          fields: ['rxRecordId'], type: 'foreign key', name: 'fk_rx_profile_review_rx',
          references: { table: 'RXRecords', field: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE', transaction
        });
        await queryInterface.addConstraint('RXProfileSyncReviewEvents', {
          fields: ['userId'], type: 'foreign key', name: 'fk_rx_profile_review_user',
          references: { table: 'Users', field: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL', transaction
        });
        await queryInterface.addIndex('RXProfileSyncReviewEvents', ['rxRecordId', 'fingerprint', 'createdAt', 'id'], {
          name: 'idx_rx_profile_review_current', transaction
        });
      }
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async transaction => {
      if (await tableExists(queryInterface, 'RXProfileSyncReviewEvents', transaction)) {
        await queryInterface.dropTable('RXProfileSyncReviewEvents', { transaction });
      }
    });
  }
};
