'use strict';

const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class SoftphoneRelayDevice extends Model {
    static associate(models) {
      SoftphoneRelayDevice.belongsTo(models.User, { foreignKey: 'userId', as: 'User', onUpdate: 'CASCADE', onDelete: 'CASCADE' });
      SoftphoneRelayDevice.hasMany(models.SoftphoneRelayCommand, { foreignKey: 'deviceId', as: 'Commands', onUpdate: 'CASCADE', onDelete: 'CASCADE' });
    }
  }

  SoftphoneRelayDevice.init({
    userId: { type: DataTypes.INTEGER, allowNull: false },
    deviceKey: { type: DataTypes.UUID, allowNull: true },
    deviceName: { type: DataTypes.STRING(128), allowNull: true },
    tokenHash: { type: DataTypes.STRING(64), allowNull: true },
    pairingCodeHash: { type: DataTypes.STRING(64), allowNull: true },
    pairingExpiresAt: { type: DataTypes.DATE, allowNull: true },
    pairedAt: { type: DataTypes.DATE, allowNull: true },
    lastSeenAt: { type: DataTypes.DATE, allowNull: true },
    isEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    registrationState: { type: DataTypes.STRING(24), allowNull: false, defaultValue: 'offline' },
    callState: { type: DataTypes.STRING(24), allowNull: false, defaultValue: 'idle' },
    callId: { type: DataTypes.STRING(64), allowNull: true },
    peer: { type: DataTypes.STRING(128), allowNull: true },
    snapshot: { type: DataTypes.JSONB, allowNull: true }
  }, {
    sequelize,
    modelName: 'SoftphoneRelayDevice',
    tableName: 'SoftphoneRelayDevices',
    indexes: [
      { unique: true, fields: ['userId'] },
      { unique: true, fields: ['deviceKey'] },
      { unique: true, fields: ['tokenHash'] },
      { fields: ['lastSeenAt'] }
    ]
  });

  return SoftphoneRelayDevice;
};
