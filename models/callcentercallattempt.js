'use strict';

const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class CallCenterCallAttempt extends Model {
    static associate(models) {
      CallCenterCallAttempt.belongsTo(models.Patient, { foreignKey: 'patientId', as: 'Patient', onUpdate: 'CASCADE', onDelete: 'SET NULL' });
      CallCenterCallAttempt.belongsTo(models.User, { foreignKey: 'userId', as: 'Agent', onUpdate: 'CASCADE', onDelete: 'SET NULL' });
      CallCenterCallAttempt.belongsTo(models.AuditLog, { foreignKey: 'calledAuditLogId', as: 'CalledAuditLog', onUpdate: 'CASCADE', onDelete: 'SET NULL' });
    }
  }

  CallCenterCallAttempt.init({
    patientId: DataTypes.INTEGER,
    userId: DataTypes.INTEGER,
    calledAuditLogId: DataTypes.INTEGER,
    correlationId: {
      type: DataTypes.STRING(64),
      allowNull: false
    },
    phoneClient: {
      type: DataTypes.STRING(32),
      allowNull: false,
      defaultValue: 'rx_softphone'
    },
    direction: {
      type: DataTypes.STRING(16),
      allowNull: false,
      defaultValue: 'outbound'
    },
    state: {
      type: DataTypes.STRING(24),
      allowNull: false,
      defaultValue: 'dialing'
    },
    outcome: DataTypes.STRING(32),
    patientCode: DataTypes.STRING(60),
    patientName: DataTypes.STRING(255),
    clinicName: DataTypes.STRING(255),
    agentName: DataTypes.STRING(255),
    extension: DataTypes.STRING(128),
    dialedNumber: {
      type: DataTypes.STRING(64),
      allowNull: false
    },
    sipResponseCode: DataTypes.INTEGER,
    sipReason: DataTypes.STRING(255),
    dialedAt: {
      type: DataTypes.DATE,
      allowNull: false
    },
    ringingAt: DataTypes.DATE,
    answeredAt: DataTypes.DATE,
    endedAt: DataTypes.DATE,
    ringDurationSeconds: DataTypes.INTEGER,
    conversationDurationSeconds: DataTypes.INTEGER
  }, {
    sequelize,
    modelName: 'CallCenterCallAttempt',
    tableName: 'CallCenterCallAttempts',
    indexes: [
      { unique: true, fields: ['correlationId'] },
      { fields: ['patientId', 'dialedAt'] },
      { fields: ['userId', 'dialedAt'] },
      { fields: ['outcome', 'dialedAt'] },
      { fields: ['extension', 'dialedAt'] }
    ]
  });

  return CallCenterCallAttempt;
};
