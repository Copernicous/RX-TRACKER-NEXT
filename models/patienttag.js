'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class PatientTag extends Model {
    static associate(models) {
      PatientTag.belongsToMany(models.Patient, {
        through: models.PatientTagAssignment,
        foreignKey: 'patientTagId',
        otherKey: 'patientId'
      });
    }
  }

  PatientTag.init({
    name: {
      type: DataTypes.STRING,
      allowNull: false
    },
    groupName: {
      type: DataTypes.STRING,
      allowNull: true
    },
    color: {
      type: DataTypes.STRING,
      allowNull: true
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    isDefault: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    }
  }, {
    sequelize,
    modelName: 'PatientTag'
  });

  return PatientTag;
};
