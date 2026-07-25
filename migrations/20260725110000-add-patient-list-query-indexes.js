'use strict';

async function ensureIndex(queryInterface, tableName, fields, options) {
  const indexes = await queryInterface.showIndex(tableName);
  const requestedName = options && options.name;
  const signature = fields.join(',');
  const found = indexes.some(index =>
    (requestedName && index.name === requestedName)
    || index.fields.map(field => field.attribute).join(',') === signature
  );
  if (!found) await queryInterface.addIndex(tableName, fields, options || {});
}

module.exports = {
  async up(queryInterface) {
    await ensureIndex(
      queryInterface,
      'Patients',
      ['isDeleted', 'isActive', 'serviceDate'],
      { name: 'idx_patients_list_status_service' }
    );
    await ensureIndex(
      queryInterface,
      'Patients',
      ['serviceDate'],
      { name: 'idx_patients_serviceDate' }
    );
    await ensureIndex(
      queryInterface,
      'Patients',
      ['patientCode'],
      { name: 'idx_patients_patientCode' }
    );
    await ensureIndex(
      queryInterface,
      'Patients',
      ['isNonCompanyPatient'],
      { name: 'idx_patients_nonCompany' }
    );
    await ensureIndex(
      queryInterface,
      'Patients',
      ['createdAt'],
      { name: 'idx_patients_createdAt' }
    );
  },

  async down(queryInterface) {
    const names = [
      'idx_patients_createdAt',
      'idx_patients_nonCompany',
      'idx_patients_patientCode',
      'idx_patients_serviceDate',
      'idx_patients_list_status_service'
    ];
    for (const name of names) {
      await queryInterface.removeIndex('Patients', name).catch(() => {});
    }
  }
};
