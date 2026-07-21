'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('CallCenterCallAttempts', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      patientId: {
        allowNull: true,
        type: Sequelize.INTEGER,
        references: { model: 'Patients', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      },
      userId: {
        allowNull: true,
        type: Sequelize.INTEGER,
        references: { model: 'Users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      },
      calledAuditLogId: {
        allowNull: true,
        type: Sequelize.INTEGER,
        references: { model: 'AuditLogs', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      },
      correlationId: { allowNull: false, type: Sequelize.STRING(64) },
      phoneClient: { allowNull: false, defaultValue: 'rx_softphone', type: Sequelize.STRING(32) },
      direction: { allowNull: false, defaultValue: 'outbound', type: Sequelize.STRING(16) },
      state: { allowNull: false, defaultValue: 'dialing', type: Sequelize.STRING(24) },
      outcome: { allowNull: true, type: Sequelize.STRING(32) },
      patientCode: { allowNull: true, type: Sequelize.STRING(60) },
      patientName: { allowNull: true, type: Sequelize.STRING(255) },
      clinicName: { allowNull: true, type: Sequelize.STRING(255) },
      agentName: { allowNull: true, type: Sequelize.STRING(255) },
      extension: { allowNull: true, type: Sequelize.STRING(128) },
      dialedNumber: { allowNull: false, type: Sequelize.STRING(64) },
      sipResponseCode: { allowNull: true, type: Sequelize.INTEGER },
      sipReason: { allowNull: true, type: Sequelize.STRING(255) },
      dialedAt: { allowNull: false, type: Sequelize.DATE },
      ringingAt: { allowNull: true, type: Sequelize.DATE },
      answeredAt: { allowNull: true, type: Sequelize.DATE },
      endedAt: { allowNull: true, type: Sequelize.DATE },
      ringDurationSeconds: { allowNull: true, type: Sequelize.INTEGER },
      conversationDurationSeconds: { allowNull: true, type: Sequelize.INTEGER },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE }
    });

    await queryInterface.addIndex('CallCenterCallAttempts', ['correlationId'], { unique: true });
    await queryInterface.addIndex('CallCenterCallAttempts', ['patientId', 'dialedAt']);
    await queryInterface.addIndex('CallCenterCallAttempts', ['userId', 'dialedAt']);
    await queryInterface.addIndex('CallCenterCallAttempts', ['outcome', 'dialedAt']);
    await queryInterface.addIndex('CallCenterCallAttempts', ['extension', 'dialedAt']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('CallCenterCallAttempts');
  }
};
