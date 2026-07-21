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
    const tableName = 'UserSoftphoneAccounts';
    if (!await tableExists(queryInterface, tableName)) {
      await queryInterface.createTable(tableName, {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      userId: {
        allowNull: false,
        type: Sequelize.INTEGER,
        references: { model: 'Users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      server: {
        allowNull: false,
        type: Sequelize.STRING(255)
      },
      port: {
        allowNull: false,
        defaultValue: 5060,
        type: Sequelize.INTEGER
      },
      username: {
        allowNull: false,
        type: Sequelize.STRING(128)
      },
      displayName: {
        allowNull: true,
        type: Sequelize.STRING(128)
      },
      localSipPort: {
        allowNull: false,
        defaultValue: 0,
        type: Sequelize.INTEGER
      },
      encryptedPassword: {
        allowNull: false,
        type: Sequelize.TEXT
      },
      isEnabled: {
        allowNull: false,
        defaultValue: true,
        type: Sequelize.BOOLEAN
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE
      }
      });
    } else {
      await requireColumns(queryInterface, tableName, [
        'id', 'userId', 'server', 'port', 'username', 'displayName',
        'localSipPort', 'encryptedPassword', 'isEnabled', 'createdAt', 'updatedAt'
      ]);
    }

    await ensureIndex(queryInterface, tableName, ['userId'], { unique: true });
    await ensureIndex(queryInterface, tableName, ['username']);
    await ensureIndex(queryInterface, tableName, ['isEnabled']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('UserSoftphoneAccounts');
  }
};
