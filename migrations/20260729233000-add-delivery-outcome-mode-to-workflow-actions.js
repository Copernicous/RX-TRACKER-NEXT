'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const columns = await queryInterface.describeTable('WorkflowActions');
    if (!columns.deliveryOutcomeMode) {
      await queryInterface.addColumn('WorkflowActions', 'deliveryOutcomeMode', {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: 'none'
      });
    }
  },

  async down(queryInterface) {
    const columns = await queryInterface.describeTable('WorkflowActions');
    if (columns.deliveryOutcomeMode) await queryInterface.removeColumn('WorkflowActions', 'deliveryOutcomeMode');
  }
};
