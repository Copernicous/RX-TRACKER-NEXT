'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await ensureColumn(queryInterface, Sequelize, 'RXRecords', 'returnedToWarehouse', {
      type: Sequelize.BOOLEAN,
      defaultValue: false
    });
    await ensureColumn(queryInterface, Sequelize, 'RXRecords', 'warehouseReturnDate', {
      type: Sequelize.DATE,
      allowNull: true
    });
    await ensureColumn(queryInterface, Sequelize, 'RXRecords', 'warehouseReturnNote', {
      type: Sequelize.STRING,
      allowNull: true
    });

    const indexes = [
      ['Patients', ['isDeleted'], { name: 'idx_patients_isDeleted' }],
      ['Patients', ['lastName', 'firstName'], { name: 'idx_patients_name' }],
      ['Patients', ['clinicId'], { name: 'idx_patients_clinicId' }],
      ['Patients', ['pharmacyId'], { name: 'idx_patients_pharmacyId' }],
      ['Patients', ['patientTransportCompanyId'], { name: 'idx_patients_patientTransportCompanyId' }],
      ['Patients', ['pharmacyTransportCompanyId'], { name: 'idx_patients_pharmacyTransportCompanyId' }],
      ['Patients', ['isActive'], { name: 'idx_patients_isActive' }],
      ['RXRecords', ['patientId'], { name: 'idx_rxrecords_patientId' }],
      ['RXRecords', ['isDeleted'], { name: 'idx_rxrecords_isDeleted' }],
      ['RXRecords', ['patientId', 'isDeleted'], { name: 'idx_rxrecords_patientId_isDeleted' }],
      ['RXRecords', ['arrivalDate'], { name: 'idx_rxrecords_arrivalDate' }],
      ['RXRecords', ['serviceDate'], { name: 'idx_rxrecords_serviceDate' }],
      ['RXRecords', ['pharmacyId'], { name: 'idx_rxrecords_pharmacyId' }],
      ['RXRecords', ['patientTransportCompanyId'], { name: 'idx_rxrecords_patientTransportCompanyId' }],
      ['RXRecords', ['pharmacyTransportCompanyId'], { name: 'idx_rxrecords_pharmacyTransportCompanyId' }],
      ['RXRecords', ['returnedToWarehouse'], { name: 'idx_rxrecords_returnedToWarehouse' }],
      ['Medications', ['rxRecordId'], { name: 'idx_medications_rxRecordId' }],
      ['RXWorkflowTrackings', ['rxRecordId'], { name: 'idx_rxworkflow_rxRecordId' }],
      ['RXWorkflowTrackings', ['workflowActionId'], { name: 'idx_rxworkflow_workflowActionId' }],
      ['RXHistories', ['rxRecordId'], { name: 'idx_rxhistory_rxRecordId' }],
      ['Users', ['username'], { name: 'idx_users_username', unique: true }],
      ['Users', ['roleId'], { name: 'idx_users_roleId' }],
      ['Users', ['isActive'], { name: 'idx_users_isActive' }],
      ['PatientNotes', ['patientId'], { name: 'idx_patientnotes_patientId' }],
      ['AuditLogs', ['userId'], { name: 'idx_auditlogs_userId' }],
      ['AuditLogs', ['createdAt'], { name: 'idx_auditlogs_createdAt' }],
      ['ErrorLogs', ['resolved'], { name: 'idx_errorlogs_resolved' }]
    ];

    for (const [table, columns, options] of indexes) {
      await addIndexIfReady(queryInterface, table, columns, options);
    }
  },

  async down(queryInterface) {
    const indexes = [
      ['Patients', 'idx_patients_isDeleted'],
      ['Patients', 'idx_patients_name'],
      ['Patients', 'idx_patients_clinicId'],
      ['Patients', 'idx_patients_pharmacyId'],
      ['Patients', 'idx_patients_patientTransportCompanyId'],
      ['Patients', 'idx_patients_pharmacyTransportCompanyId'],
      ['Patients', 'idx_patients_isActive'],
      ['RXRecords', 'idx_rxrecords_patientId'],
      ['RXRecords', 'idx_rxrecords_isDeleted'],
      ['RXRecords', 'idx_rxrecords_patientId_isDeleted'],
      ['RXRecords', 'idx_rxrecords_arrivalDate'],
      ['RXRecords', 'idx_rxrecords_serviceDate'],
      ['RXRecords', 'idx_rxrecords_pharmacyId'],
      ['RXRecords', 'idx_rxrecords_patientTransportCompanyId'],
      ['RXRecords', 'idx_rxrecords_pharmacyTransportCompanyId'],
      ['RXRecords', 'idx_rxrecords_returnedToWarehouse'],
      ['Medications', 'idx_medications_rxRecordId'],
      ['RXWorkflowTrackings', 'idx_rxworkflow_rxRecordId'],
      ['RXWorkflowTrackings', 'idx_rxworkflow_workflowActionId'],
      ['RXHistories', 'idx_rxhistory_rxRecordId'],
      ['Users', 'idx_users_username'],
      ['Users', 'idx_users_roleId'],
      ['Users', 'idx_users_isActive'],
      ['PatientNotes', 'idx_patientnotes_patientId'],
      ['AuditLogs', 'idx_auditlogs_userId'],
      ['AuditLogs', 'idx_auditlogs_createdAt'],
      ['ErrorLogs', 'idx_errorlogs_resolved']
    ];

    for (const [table, name] of indexes) {
      await queryInterface.removeIndex(table, name).catch(() => {});
    }
  }
};

async function ensureColumn(queryInterface, Sequelize, table, column, spec) {
  const definition = await describeTable(queryInterface, table);
  if (!definition || definition[column]) return;
  try {
    await queryInterface.addColumn(table, column, spec);
  } catch (error) {
    if (!isBenignAlreadyExists(error)) throw error;
  }
}

async function addIndexIfReady(queryInterface, table, columns, options) {
  const definition = await describeTable(queryInterface, table);
  if (!definition) return;
  if (columns.some((column) => !definition[column])) return;

  try {
    await queryInterface.addIndex(table, columns, options);
  } catch (error) {
    if (!isBenignAlreadyExists(error)) throw error;
  }
}

async function describeTable(queryInterface, table) {
  try {
    return await queryInterface.describeTable(table);
  } catch {
    return null;
  }
}

function isBenignAlreadyExists(error) {
  const code = error?.original?.code || error?.parent?.code || error?.code;
  const message = String(error?.message || error?.original?.message || '');
  return code === '42P07' ||
    code === '42701' ||
    /already exists|duplicate key name|relation .* already exists/i.test(message);
}
