'use strict';

const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class RXProfileSyncReviewEvent extends Model {
    static associate(models) {
      RXProfileSyncReviewEvent.belongsTo(models.RXRecord, { foreignKey: 'rxRecordId', onDelete: 'CASCADE' });
      RXProfileSyncReviewEvent.belongsTo(models.User, { foreignKey: 'userId', onDelete: 'SET NULL' });
    }
  }

  RXProfileSyncReviewEvent.init({
    rxRecordId: { type: DataTypes.INTEGER, allowNull: false },
    fieldName: { type: DataTypes.STRING(64), allowNull: false },
    rxValueId: { type: DataTypes.INTEGER, allowNull: true },
    patientValueId: { type: DataTypes.INTEGER, allowNull: false },
    fingerprint: { type: DataTypes.STRING(64), allowNull: false },
    action: { type: DataTypes.STRING(16), allowNull: false },
    reason: { type: DataTypes.TEXT, allowNull: true },
    userId: { type: DataTypes.INTEGER, allowNull: true }
  }, {
    sequelize,
    modelName: 'RXProfileSyncReviewEvent',
    updatedAt: false
  });

  return RXProfileSyncReviewEvent;
};
