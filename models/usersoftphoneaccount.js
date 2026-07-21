'use strict';

const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class UserSoftphoneAccount extends Model {
    static associate(models) {
      UserSoftphoneAccount.belongsTo(models.User, { foreignKey: 'userId', as: 'User' });
    }

    toJSON() {
      const values = { ...this.get() };
      delete values.encryptedPassword;
      return values;
    }
  }

  UserSoftphoneAccount.init({
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    server: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    port: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 5060
    },
    username: {
      type: DataTypes.STRING(128),
      allowNull: false
    },
    displayName: {
      type: DataTypes.STRING(128),
      allowNull: true
    },
    localSipPort: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
    },
    encryptedPassword: {
      type: DataTypes.TEXT,
      allowNull: false
    },
    isEnabled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true
    }
  }, {
    sequelize,
    modelName: 'UserSoftphoneAccount',
    tableName: 'UserSoftphoneAccounts',
    indexes: [
      { unique: true, fields: ['userId'] },
      { fields: ['username'] },
      { fields: ['isEnabled'] }
    ]
  });

  return UserSoftphoneAccount;
};
