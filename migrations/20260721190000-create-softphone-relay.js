'use strict';

async function tableExists(queryInterface, tableName) {
  const tables = await queryInterface.showAllTables();
  return tables.some((table) => String(typeof table === 'string' ? table : (table.tableName || table.name || '')) === tableName);
}

async function requireColumns(queryInterface, tableName, required) {
  const columns = await queryInterface.describeTable(tableName);
  const missing = required.filter((name) => !columns[name]);
  if (missing.length) throw new Error(`${tableName} exists but is missing columns: ${missing.join(', ')}`);
}

async function ensureIndex(queryInterface, tableName, fields, options) {
  const indexes = await queryInterface.showIndex(tableName);
  const signature = fields.join(',');
  const found = indexes.some((index) => index.fields.map((field) => field.attribute).join(',') === signature
    && (!(options && options.unique) || index.unique === true));
  if (!found) await queryInterface.addIndex(tableName, fields, options || {});
}

module.exports = {
  async up(queryInterface, Sequelize) {
    const deviceTable = 'SoftphoneRelayDevices';
    if (!await tableExists(queryInterface, deviceTable)) {
      await queryInterface.createTable(deviceTable, {
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
    } else {
      await requireColumns(queryInterface, deviceTable, [
        'id', 'userId', 'deviceKey', 'deviceName', 'tokenHash', 'pairingCodeHash',
        'pairingExpiresAt', 'pairedAt', 'lastSeenAt', 'isEnabled',
        'registrationState', 'callState', 'callId', 'peer', 'snapshot',
        'createdAt', 'updatedAt'
      ]);
    }
    await ensureIndex(queryInterface, deviceTable, ['userId'], { unique: true });
    await ensureIndex(queryInterface, deviceTable, ['deviceKey'], { unique: true });
    await ensureIndex(queryInterface, deviceTable, ['tokenHash'], { unique: true });
    await ensureIndex(queryInterface, deviceTable, ['lastSeenAt']);

    const commandTable = 'SoftphoneRelayCommands';
    if (!await tableExists(queryInterface, commandTable)) {
      await queryInterface.createTable(commandTable, {
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
    } else {
      await requireColumns(queryInterface, commandTable, [
        'id', 'deviceId', 'userId', 'attemptId', 'commandType', 'payload',
        'status', 'expiresAt', 'deliveredAt', 'completedAt', 'errorMessage',
        'createdAt', 'updatedAt'
      ]);
    }
    await ensureIndex(queryInterface, commandTable, ['deviceId', 'status', 'createdAt']);
    await ensureIndex(queryInterface, commandTable, ['attemptId']);
    await ensureIndex(queryInterface, commandTable, ['expiresAt']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('SoftphoneRelayCommands');
    await queryInterface.dropTable('SoftphoneRelayDevices');
  }
};
