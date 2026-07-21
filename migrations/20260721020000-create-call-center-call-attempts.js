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

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tableName = 'CallCenterCallAttempts';
    if (!await tableExists(queryInterface, tableName)) {
      await queryInterface.createTable(tableName, {
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
    } else {
      await requireColumns(queryInterface, tableName, [
        'id', 'patientId', 'userId', 'calledAuditLogId', 'correlationId',
        'phoneClient', 'direction', 'state', 'outcome', 'patientCode',
        'patientName', 'clinicName', 'agentName', 'extension', 'dialedNumber',
        'sipResponseCode', 'sipReason', 'dialedAt', 'ringingAt', 'answeredAt',
        'endedAt', 'ringDurationSeconds', 'conversationDurationSeconds',
        'createdAt', 'updatedAt'
      ]);
    }

    await ensureIndex(queryInterface, tableName, ['correlationId'], { unique: true });
    await ensureIndex(queryInterface, tableName, ['patientId', 'dialedAt']);
    await ensureIndex(queryInterface, tableName, ['userId', 'dialedAt']);
    await ensureIndex(queryInterface, tableName, ['outcome', 'dialedAt']);
    await ensureIndex(queryInterface, tableName, ['extension', 'dialedAt']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('CallCenterCallAttempts');
  }
};
