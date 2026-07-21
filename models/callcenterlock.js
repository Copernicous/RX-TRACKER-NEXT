'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class CallCenterLock extends Model {
    static associate(models) {
      CallCenterLock.belongsTo(models.Patient, { foreignKey: 'patientId', as: 'Patient' });
      CallCenterLock.belongsTo(models.User, { foreignKey: 'userId', as: 'User' });
    }

    get isActive() {
      return new Date() < new Date(this.expiresAt);
    }
  }

  CallCenterLock.init({
    patientId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      unique: true
    },
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    lockedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    },
    expiresAt: {
      type: DataTypes.DATE,
      allowNull: false
    }
  }, {
    sequelize,
    modelName: 'CallCenterLock',
    tableName: 'CallCenterLocks',
    indexes: [
      { unique: true, fields: ['patientId'] },
      { fields: ['userId'] },
      { fields: ['expiresAt'] }
    ]
  });

  return CallCenterLock;
};
