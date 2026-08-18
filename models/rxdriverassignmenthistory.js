'use strict';
const { Model } = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class RXDriverAssignmentHistory extends Model {
    static associate(models) {
      RXDriverAssignmentHistory.belongsTo(models.RXRecord, { foreignKey: 'rxRecordId', onDelete: 'CASCADE' });
      RXDriverAssignmentHistory.belongsTo(models.RXWorkflowTracking, { foreignKey: 'workflowTrackingId', onDelete: 'SET NULL' });
      RXDriverAssignmentHistory.belongsTo(models.User, { foreignKey: 'userId', onDelete: 'SET NULL' });
    }
  }
  RXDriverAssignmentHistory.init({
    rxRecordId: { type: DataTypes.INTEGER, allowNull: false }, workflowTrackingId: DataTypes.INTEGER,
    workflowActionId: DataTypes.INTEGER, workflowActionName: DataTypes.STRING(255),
    previousDriverId: DataTypes.INTEGER, previousDriverName: DataTypes.STRING(160),
    driverId: DataTypes.INTEGER, driverName: DataTypes.STRING(160),
    changeType: { type: DataTypes.STRING(40), allowNull: false },
    reason: { type: DataTypes.TEXT, allowNull: false },
    userId: DataTypes.INTEGER
  }, { sequelize, modelName: 'RXDriverAssignmentHistory', updatedAt: false });
  return RXDriverAssignmentHistory;
};
