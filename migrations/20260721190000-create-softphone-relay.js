'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('SoftphoneRelayDevices', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      userId: { allowNull: false, type: Sequelize.INTEGER, references: { model: 'Users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE' },
      deviceKey: { allowNull: true, type: Sequelize.UUID },
      deviceName: { allowNull: true, type: Sequelize.STRING(128) },
      tokenHash: { allowNull: true, type: Sequelize.STRING(64) },
      pairingCodeHash: { allowNull: true, type: Sequelize.STRING(64) },
      pairingExpiresAt: { allowNull: true, type: Sequelize.DATE },
      pairedAt: { allowNull: true, type: Sequelize.DATE },
      lastSeenAt: { allowNull: true, type: Sequelize.DATE },
      isEnabled: { allowNull: false, defaultValue: true, type: Sequelize.BOOLEAN },
      registrationState: { allowNull: false, defaultValue: 'offline', type: Sequelize.STRING(24) },
      callState: { allowNull: false, defaultValue: 'idle', type: Sequelize.STRING(24) },
      callId: { allowNull: true, type: Sequelize.STRING(64) },
      peer: { allowNull: true, type: Sequelize.STRING(128) },
      snapshot: { allowNull: true, type: Sequelize.JSONB },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE }
    });
    await queryInterface.addIndex('SoftphoneRelayDevices', ['userId'], { unique: true });
    await queryInterface.addIndex('SoftphoneRelayDevices', ['deviceKey'], { unique: true });
    await queryInterface.addIndex('SoftphoneRelayDevices', ['tokenHash'], { unique: true });
    await queryInterface.addIndex('SoftphoneRelayDevices', ['lastSeenAt']);

    await queryInterface.createTable('SoftphoneRelayCommands', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      deviceId: { allowNull: false, type: Sequelize.INTEGER, references: { model: 'SoftphoneRelayDevices', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE' },
      userId: { allowNull: false, type: Sequelize.INTEGER, references: { model: 'Users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE' },
      attemptId: { allowNull: true, type: Sequelize.INTEGER, references: { model: 'CallCenterCallAttempts', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      commandType: { allowNull: false, type: Sequelize.STRING(24) },
      payload: { allowNull: false, defaultValue: {}, type: Sequelize.JSONB },
      status: { allowNull: false, defaultValue: 'queued', type: Sequelize.STRING(24) },
      expiresAt: { allowNull: false, type: Sequelize.DATE },
      deliveredAt: { allowNull: true, type: Sequelize.DATE },
      completedAt: { allowNull: true, type: Sequelize.DATE },
      errorMessage: { allowNull: true, type: Sequelize.STRING(255) },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE }
    });
    await queryInterface.addIndex('SoftphoneRelayCommands', ['deviceId', 'status', 'createdAt']);
    await queryInterface.addIndex('SoftphoneRelayCommands', ['attemptId']);
    await queryInterface.addIndex('SoftphoneRelayCommands', ['expiresAt']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('SoftphoneRelayCommands');
    await queryInterface.dropTable('SoftphoneRelayDevices');
  }
};
