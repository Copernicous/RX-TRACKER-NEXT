'use strict';
const {
  Model
} = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class UserActivityLog extends Model {
    static associate(models) {
      UserActivityLog.belongsTo(models.User, { foreignKey: 'userId' });
    }
  }

  UserActivityLog.init({
    userId: DataTypes.INTEGER,
    usernameSnapshot: DataTypes.STRING,
    roleSnapshot: DataTypes.STRING,
    pageUrl: DataTypes.TEXT,
    pagePath: DataTypes.STRING,
    pageTitle: DataTypes.STRING,
    visitedAt: DataTypes.DATE,
    ipAddress: DataTypes.STRING,
    userAgent: DataTypes.TEXT,
    referrer: DataTypes.TEXT,
    statusCode: DataTypes.INTEGER
  }, {
    sequelize,
    modelName: 'UserActivityLog',
  });

  return UserActivityLog;
};
