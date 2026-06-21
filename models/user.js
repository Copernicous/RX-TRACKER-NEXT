'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class User extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      User.belongsTo(models.Role, { foreignKey: 'roleId' });
    }
    
    async validPassword(password) {
      const bcrypt = require('bcrypt');
      return await bcrypt.compare(password, this.passwordHash);
    }
  }
  User.init({
    firstName:        DataTypes.STRING,
    lastName:         DataTypes.STRING,
    username:         DataTypes.STRING,
    passwordHash:     DataTypes.STRING,
    email:            DataTypes.STRING,
    roleId:           DataTypes.INTEGER,
    isActive:         DataTypes.BOOLEAN,
    notes:            DataTypes.TEXT,
    // 2FA fields
    twoFactorSecret:  DataTypes.TEXT,
    twoFactorEnabled: { type: DataTypes.BOOLEAN, defaultValue: false },
    // Account lockout fields
    failedLoginCount: { type: DataTypes.INTEGER, defaultValue: 0 },
    lockedUntil:      DataTypes.DATE,
    permissions: {
        type: DataTypes.TEXT,
        get() {
            const rawValue = this.getDataValue('permissions');
            return rawValue ? JSON.parse(rawValue) : null;
        },
        set(value) {
            this.setDataValue('permissions', value ? JSON.stringify(value) : null);
        }
    }
}, {
    sequelize,
    modelName: 'User',
});
return User;
};