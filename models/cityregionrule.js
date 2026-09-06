'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class CityRegionRule extends Model {
    static associate(models) {
      CityRegionRule.belongsTo(models.PatientTag, {
        foreignKey: 'patientTagId',
        as: 'RegionTag'
      });
    }
  }

  CityRegionRule.init({
    city: {
      type: DataTypes.STRING,
      allowNull: false
    },
    patientTagId: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    }
  }, {
    sequelize,
    modelName: 'CityRegionRule'
  });

  return CityRegionRule;
};
