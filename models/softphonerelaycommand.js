'use strict';

const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class SoftphoneRelayCommand extends Model {
    static associate(models) {
      SoftphoneRelayCommand.belongsTo(models.SoftphoneRelayDevice, { foreignKey: 'deviceId', as: 'Device', onUpdate: 'CASCADE', onDelete: 'CASCADE' });
      SoftphoneRelayCommand.belongsTo(models.CallCenterCallAttempt, { foreignKey: 'attemptId', as: 'Attempt', onUpdate: 'CASCADE', onDelete: 'SET NULL' });
      SoftphoneRelayCommand.belongsTo(models.User, { foreignKey: 'userId', as: 'User', onUpdate: 'CASCADE', onDelete: 'CASCADE' });
    }
  }

  SoftphoneRelayCommand.init({
    deviceId: { type: DataTypes.INTEGER, allowNull: false },
    userId: { type: DataTypes.INTEGER, allowNull: false },
    attemptId: { type: DataTypes.INTEGER, allowNull: true },
    commandType: { type: DataTypes.STRING(24), allowNull: false },
    payload: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    status: { type: DataTypes.STRING(24), allowNull: false, defaultValue: 'queued' },
    expiresAt: { type: DataTypes.DATE, allowNull: false },
    deliveredAt: { type: DataTypes.DATE, allowNull: true },
    completedAt: { type: DataTypes.DATE, allowNull: true },
    errorMessage: { type: DataTypes.STRING(255), allowNull: true }
  }, {
    sequelize,
    modelName: 'SoftphoneRelayCommand',
    tableName: 'SoftphoneRelayCommands',
    indexes: [
      { fields: ['deviceId', 'status', 'createdAt'] },
      { fields: ['attemptId'] },
      { fields: ['expiresAt'] }
    ]
  });

  return SoftphoneRelayCommand;
};
