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
      'AuditLogs',
      ['module', 'action', 'recordId', 'createdAt'],
      { name: 'idx_auditlogs_call_center_patient_created' }
    );
    await ensureIndex(
      queryInterface,
      'AuditLogs',
      ['module', 'action', 'userId', 'createdAt'],
      { name: 'idx_auditlogs_call_center_user_created' }
    );
    await ensureIndex(
      queryInterface,
      'CallCenterCallAttempts',
      ['dialedAt'],
      { name: 'idx_call_attempts_dialed_at' }
    );
    await ensureIndex(
      queryInterface,
      'RXWorkflowTrackings',
      ['rxRecordId', 'workflowActionId'],
      { name: 'idx_rxworkflow_record_action' }
    );
    await ensureIndex(
      queryInterface,
      'RXWorkflowTrackings',
      ['completionDate'],
      { name: 'idx_rxworkflow_completion_date' }
    );
    await ensureIndex(
      queryInterface,
      'PatientNotes',
      ['patientId', 'createdAt'],
      { name: 'idx_patientnotes_patient_created' }
    );
    await ensureIndex(
      queryInterface,
      'UserActivityLogs',
      ['userId', 'visitedAt'],
      { name: 'idx_user_activity_user_visited' }
    );
    await ensureIndex(
      queryInterface,
      'ErrorLogs',
      ['createdAt'],
      { name: 'idx_errorlogs_created_at' }
    );
  },

  async down(queryInterface) {
    const indexes = [
      ['ErrorLogs', 'idx_errorlogs_created_at'],
      ['UserActivityLogs', 'idx_user_activity_user_visited'],
      ['PatientNotes', 'idx_patientnotes_patient_created'],
      ['RXWorkflowTrackings', 'idx_rxworkflow_completion_date'],
      ['RXWorkflowTrackings', 'idx_rxworkflow_record_action'],
      ['CallCenterCallAttempts', 'idx_call_attempts_dialed_at'],
      ['AuditLogs', 'idx_auditlogs_call_center_user_created'],
      ['AuditLogs', 'idx_auditlogs_call_center_patient_created']
    ];
    for (const [tableName, name] of indexes) {
      await queryInterface.removeIndex(tableName, name).catch(() => {});
    }
  }
};
