'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('UserSoftphoneAccounts', {
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

    await queryInterface.addIndex('UserSoftphoneAccounts', ['userId'], { unique: true });
    await queryInterface.addIndex('UserSoftphoneAccounts', ['username']);
    await queryInterface.addIndex('UserSoftphoneAccounts', ['isEnabled']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('UserSoftphoneAccounts');
  }
};
