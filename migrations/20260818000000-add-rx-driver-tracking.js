'use strict';

async function tableExists(queryInterface, tableName, transaction) {
  const tables = await queryInterface.showAllTables({ transaction });
  return tables.some((entry) => {
    if (typeof entry === 'string') return entry === tableName;
    return entry.tableName === tableName || entry.table_name === tableName || entry.name === tableName;
  });
}

async function columnExists(queryInterface, tableName, columnName, transaction) {
  if (!await tableExists(queryInterface, tableName, transaction)) return false;
  const columns = await queryInterface.describeTable(tableName, { transaction });
  return Boolean(columns[columnName]);
}

async function addColumnIfMissing(queryInterface, tableName, columnName, definition, transaction) {
  if (!await columnExists(queryInterface, tableName, columnName, transaction)) {
    await queryInterface.addColumn(tableName, columnName, definition, { transaction });
  }
}

async function removeColumnIfPresent(queryInterface, tableName, columnName, transaction) {
  if (await columnExists(queryInterface, tableName, columnName, transaction)) {
    await queryInterface.removeColumn(tableName, columnName, { transaction });
  }
}

async function addIndexIfMissing(queryInterface, tableName, fields, options, transaction) {
  const indexes = await queryInterface.showIndex(tableName, { transaction }).catch(() => []);
  if (!indexes.some((index) => index.name === options.name)) {
    await queryInterface.addIndex(tableName, fields, { ...options, transaction });
  }
}

async function constraintExists(queryInterface, tableName, constraintName, transaction) {
  const [rows] = await queryInterface.sequelize.query(`
    SELECT 1
      FROM pg_constraint AS constraint_record
      JOIN pg_class AS table_record
        ON table_record.oid = constraint_record.conrelid
      JOIN pg_namespace AS namespace_record
        ON namespace_record.oid = table_record.relnamespace
     WHERE namespace_record.nspname = current_schema()
       AND table_record.relname = :tableName
       AND constraint_record.conname = :constraintName
     LIMIT 1
  `, { replacements: { tableName, constraintName }, transaction });
  return rows.length > 0;
}

async function addForeignKeyIfMissing(queryInterface, tableName, options, transaction) {
  if (!await constraintExists(queryInterface, tableName, options.name, transaction)) {
    await queryInterface.addConstraint(tableName, {
      fields: [options.field],
      type: 'foreign key',
      name: options.name,
      references: { table: options.referencesTable, field: 'id' },
      onUpdate: 'CASCADE',
      onDelete: options.onDelete,
      transaction
    });
  }
}

function parsePermissions(value) {
  let permissions = value;
  if (typeof permissions === 'string') {
    try {
      permissions = JSON.parse(permissions);
    } catch (error) {
      throw new Error(`Cannot migrate role permissions because a Roles.permissions value is invalid JSON: ${error.message}`);
    }
  }
  if (permissions === null || permissions === undefined) return {};
  if (typeof permissions !== 'object' || Array.isArray(permissions)) {
    throw new Error('Cannot migrate role permissions because a Roles.permissions value is not an object.');
  }
  return permissions;
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

async function addRolePermissions(queryInterface, transaction) {
  const [roles] = await queryInterface.sequelize.query(
    'SELECT id, name, permissions FROM "Roles"',
    { transaction }
  );
  const builtIn = {
    Administrator: { view: true, assign: true, correct: true, sync: true },
    Supervisor: { view: true, assign: true, correct: true, sync: true },
    Operator: { view: true, assign: true, correct: false, sync: false },
    'Read Only': { view: true, assign: false, correct: false, sync: false },
    'Call Center': { view: false, assign: false, correct: false, sync: false }
  };

  for (const role of roles) {
    const permissions = parsePermissions(role.permissions);
    const defaults = builtIn[role.name] || {
      view: false,
      assign: false,
      correct: false,
      sync: false
    };
    let changed = false;

    if (!isObject(permissions.rx_records)) {
      permissions.rx_records = {};
      changed = true;
    }
    const rxPermissions = permissions.rx_records;
    const driverPermissionDefaults = {
      canViewDriverHistory: defaults.view,
      canAssignDriver: defaults.assign,
      canCorrectDriver: defaults.correct,
      canSyncDriverHistory: defaults.sync
    };
    for (const [permissionName, defaultValue] of Object.entries(driverPermissionDefaults)) {
      if (rxPermissions[permissionName] === undefined) {
        rxPermissions[permissionName] = defaultValue;
        changed = true;
      }
    }

    if (changed) {
      await queryInterface.sequelize.query(
        'UPDATE "Roles" SET permissions = :permissions, "updatedAt" = :updatedAt WHERE id = :id',
        {
          replacements: {
            id: role.id,
            permissions: JSON.stringify(permissions),
            updatedAt: new Date()
          },
          transaction
        }
      );
    }
  }
}

async function removeRolePermissions(queryInterface, transaction) {
  const [roles] = await queryInterface.sequelize.query(
    'SELECT id, permissions FROM "Roles"',
    { transaction }
  );
  for (const role of roles) {
    const permissions = parsePermissions(role.permissions);
    let changed = false;
    if (isObject(permissions.rx_records)) {
      for (const permissionName of [
        'canViewDriverHistory',
        'canAssignDriver',
        'canCorrectDriver',
        'canSyncDriverHistory'
      ]) {
        if (Object.prototype.hasOwnProperty.call(permissions.rx_records, permissionName)) {
          delete permissions.rx_records[permissionName];
          changed = true;
        }
      }
    }
    if (changed) {
      await queryInterface.sequelize.query(
        'UPDATE "Roles" SET permissions = :permissions, "updatedAt" = :updatedAt WHERE id = :id',
        {
          replacements: {
            id: role.id,
            permissions: JSON.stringify(permissions),
            updatedAt: new Date()
          },
          transaction
        }
      );
    }
  }
}

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await addColumnIfMissing(queryInterface, 'RXWorkflowTrackings', 'driverId', {
        type: Sequelize.INTEGER,
        allowNull: true
      }, transaction);
      await addColumnIfMissing(queryInterface, 'RXWorkflowTrackings', 'driverNameSnapshot', {
        type: Sequelize.STRING(160),
        allowNull: true
      }, transaction);

      if (!await tableExists(queryInterface, 'RXDriverAssignmentHistories', transaction)) {
        await queryInterface.createTable('RXDriverAssignmentHistories', {
          id: {
            allowNull: false,
            autoIncrement: true,
            primaryKey: true,
            type: Sequelize.INTEGER
          },
          rxRecordId: { allowNull: false, type: Sequelize.INTEGER },
          workflowTrackingId: { allowNull: true, type: Sequelize.INTEGER },
          workflowActionId: { allowNull: true, type: Sequelize.INTEGER },
          workflowActionName: { allowNull: true, type: Sequelize.STRING(255) },
          previousDriverId: { allowNull: true, type: Sequelize.INTEGER },
          previousDriverName: { allowNull: true, type: Sequelize.STRING(160) },
          driverId: { allowNull: true, type: Sequelize.INTEGER },
          driverName: { allowNull: true, type: Sequelize.STRING(160) },
          changeType: { allowNull: false, type: Sequelize.STRING(40) },
          reason: { allowNull: false, type: Sequelize.TEXT },
          userId: { allowNull: true, type: Sequelize.INTEGER },
          createdAt: { allowNull: false, type: Sequelize.DATE }
        }, { transaction });
      }
      // Also repairs an environment where the unregistered draft migration
      // created the table before these audit fields were widened.
      await queryInterface.changeColumn('RXDriverAssignmentHistories', 'workflowActionName', {
        allowNull: true,
        type: Sequelize.STRING(255)
      }, { transaction });
      await queryInterface.changeColumn('RXDriverAssignmentHistories', 'reason', {
        allowNull: false,
        type: Sequelize.TEXT
      }, { transaction });

      await addIndexIfMissing(queryInterface, 'RXWorkflowTrackings', ['driverId'], {
        name: 'idx_rxworkflow_driver'
      }, transaction);
      await addIndexIfMissing(queryInterface, 'RXDriverAssignmentHistories', ['rxRecordId', 'createdAt'], {
        name: 'idx_rx_driver_history_record_created'
      }, transaction);
      await addIndexIfMissing(queryInterface, 'RXDriverAssignmentHistories', ['workflowTrackingId'], {
        name: 'idx_rx_driver_history_tracking'
      }, transaction);

      await addForeignKeyIfMissing(queryInterface, 'RXWorkflowTrackings', {
        name: 'fk_rxworkflowtrackings_driver',
        field: 'driverId',
        referencesTable: 'PharmacyTransportCompanies',
        onDelete: 'SET NULL'
      }, transaction);
      await addForeignKeyIfMissing(queryInterface, 'RXDriverAssignmentHistories', {
        name: 'fk_rx_driver_histories_rx_record',
        field: 'rxRecordId',
        referencesTable: 'RXRecords',
        onDelete: 'CASCADE'
      }, transaction);
      await addForeignKeyIfMissing(queryInterface, 'RXDriverAssignmentHistories', {
        name: 'fk_rx_driver_histories_workflow_tracking',
        field: 'workflowTrackingId',
        referencesTable: 'RXWorkflowTrackings',
        onDelete: 'SET NULL'
      }, transaction);
      await addForeignKeyIfMissing(queryInterface, 'RXDriverAssignmentHistories', {
        name: 'fk_rx_driver_histories_workflow_action',
        field: 'workflowActionId',
        referencesTable: 'WorkflowActions',
        onDelete: 'SET NULL'
      }, transaction);
      await addForeignKeyIfMissing(queryInterface, 'RXDriverAssignmentHistories', {
        name: 'fk_rx_driver_histories_previous_driver',
        field: 'previousDriverId',
        referencesTable: 'PharmacyTransportCompanies',
        onDelete: 'SET NULL'
      }, transaction);
      await addForeignKeyIfMissing(queryInterface, 'RXDriverAssignmentHistories', {
        name: 'fk_rx_driver_histories_driver',
        field: 'driverId',
        referencesTable: 'PharmacyTransportCompanies',
        onDelete: 'SET NULL'
      }, transaction);
      await addForeignKeyIfMissing(queryInterface, 'RXDriverAssignmentHistories', {
        name: 'fk_rx_driver_histories_user',
        field: 'userId',
        referencesTable: 'Users',
        onDelete: 'SET NULL'
      }, transaction);

      if (await tableExists(queryInterface, 'Roles', transaction)) {
        await addRolePermissions(queryInterface, transaction);
      }
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      if (await tableExists(queryInterface, 'Roles', transaction)) {
        await removeRolePermissions(queryInterface, transaction);
      }

      for (const indexName of [
        'idx_rx_driver_history_tracking',
        'idx_rx_driver_history_record_created',
        'idx_rxworkflow_driver'
      ]) {
        await queryInterface.sequelize.query(`DROP INDEX IF EXISTS "${indexName}"`, { transaction });
      }

      if (await tableExists(queryInterface, 'RXDriverAssignmentHistories', transaction)) {
        await queryInterface.dropTable('RXDriverAssignmentHistories', { transaction });
      }
      await removeColumnIfPresent(
        queryInterface,
        'RXWorkflowTrackings',
        'driverNameSnapshot',
        transaction
      );
      await removeColumnIfPresent(queryInterface, 'RXWorkflowTrackings', 'driverId', transaction);
    });
  }
};
