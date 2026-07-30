'use strict';

module.exports = {
    async up(queryInterface, Sequelize) {
        const columns = await queryInterface.describeTable('RXRecords');
        if (!columns.deliveryOutcome) {
            await queryInterface.addColumn('RXRecords', 'deliveryOutcome', {
                type: Sequelize.STRING(32),
                allowNull: false,
                defaultValue: 'none'
            });
        }
        if (!columns.deliveryOutcomeDate) {
            await queryInterface.addColumn('RXRecords', 'deliveryOutcomeDate', {
                type: Sequelize.DATE,
                allowNull: true
            });
        }
        if (!columns.deliveryOutcomeNote) {
            await queryInterface.addColumn('RXRecords', 'deliveryOutcomeNote', {
                type: Sequelize.STRING,
                allowNull: true
            });
        }
        await queryInterface.addIndex('RXRecords', ['deliveryOutcome'], {
            name: 'rxrecords_delivery_outcome_idx'
        });
    },

    async down(queryInterface) {
        await queryInterface.removeIndex('RXRecords', 'rxrecords_delivery_outcome_idx');
        await queryInterface.removeColumn('RXRecords', 'deliveryOutcomeNote');
        await queryInterface.removeColumn('RXRecords', 'deliveryOutcomeDate');
        await queryInterface.removeColumn('RXRecords', 'deliveryOutcome');
    }
};
