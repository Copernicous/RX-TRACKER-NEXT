'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class PatientTagAssignment extends Model {
    static associate(models) {
      PatientTagAssignment.belongsTo(models.Patient, { foreignKey: 'patientId' });
      PatientTagAssignment.belongsTo(models.PatientTag, { foreignKey: 'patientTagId' });
    }
  }

  PatientTagAssignment.init({
    patientId: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    patientTagId: {
      type: DataTypes.INTEGER,
      allowNull: false
    }
  }, {
    sequelize,
    modelName: 'PatientTagAssignment',
    indexes: [
      { unique: true, fields: ['patientId', 'patientTagId'] }
    ]
  });

  return PatientTagAssignment;
};
