'use strict';

async function tableExists(queryInterface, tableName, transaction) {
  const tables = await queryInterface.showAllTables({ transaction });
  return tables.some((entry) => {
    if (typeof entry === 'string') return entry === tableName;
    return entry.tableName === tableName || entry.table_name === tableName || entry.name === tableName;
  });
}

async function indexExists(queryInterface, tableName, indexName, transaction) {
  if (!await tableExists(queryInterface, tableName, transaction)) return false;
  const indexes = await queryInterface.showIndex(tableName, { transaction });
  return indexes.some(index => index.name === indexName);
}

async function addRoleModule(queryInterface, Sequelize, transaction) {
  const [roles] = await queryInterface.sequelize.query(
    'SELECT id, name, permissions FROM "Roles"',
    { transaction }
  );
  const full = { visible: true, canAdd: true, canEdit: true, canDelete: true, canExport: true, canPrint: false, canCopy: true, canUndo: false, canWarehouse: false, canOverrideExpired: false };
  const view = { visible: true, canAdd: false, canEdit: false, canDelete: false, canExport: true, canPrint: false, canCopy: true, canUndo: false, canWarehouse: false, canOverrideExpired: false };
  const hide = { visible: false, canAdd: false, canEdit: false, canDelete: false, canExport: false, canPrint: false, canCopy: false, canUndo: false, canWarehouse: false, canOverrideExpired: false };

  for (const role of roles) {
    let permissions = role.permissions;
    if (typeof permissions === 'string') {
      permissions = permissions ? JSON.parse(permissions) : {};
    }
    if (!permissions || typeof permissions !== 'object' || Array.isArray(permissions)) permissions = {};
    if (permissions.patient_tags) continue;
    const roleName = String(role.name || '').toLowerCase();
    permissions.patient_tags = roleName === 'administrator' || roleName === 'supervisor'
      ? full
      : roleName === 'operator'
        ? view
        : hide;
    await queryInterface.sequelize.query(
      'UPDATE "Roles" SET permissions = :permissions, "updatedAt" = :updatedAt WHERE id = :id',
      {
        transaction,
        replacements: {
          id: role.id,
          permissions: JSON.stringify(permissions),
          updatedAt: new Date()
        }
      }
    );
  }
}

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      if (!await tableExists(queryInterface, 'PatientTags', transaction)) {
        await queryInterface.createTable('PatientTags', {
          id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
          name: { type: Sequelize.STRING, allowNull: false },
          groupName: { type: Sequelize.STRING, allowNull: true },
          color: { type: Sequelize.STRING, allowNull: true },
          notes: { type: Sequelize.TEXT, allowNull: true },
          isDefault: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
          isActive: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
          createdAt: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.fn('NOW') },
          updatedAt: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.fn('NOW') }
        }, { transaction });
      }

      if (!await tableExists(queryInterface, 'PatientTagAssignments', transaction)) {
        await queryInterface.createTable('PatientTagAssignments', {
          id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
          patientId: {
            type: Sequelize.INTEGER,
            allowNull: false,
            references: { model: 'Patients', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE'
          },
          patientTagId: {
            type: Sequelize.INTEGER,
            allowNull: false,
            references: { model: 'PatientTags', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'RESTRICT'
          },
          createdAt: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.fn('NOW') },
          updatedAt: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.fn('NOW') }
        }, { transaction });
      }

      if (!await indexExists(queryInterface, 'PatientTags', 'uq_patient_tags_active_group_name', transaction)) {
        await queryInterface.addIndex('PatientTags', ['groupName', 'name'], {
          name: 'uq_patient_tags_active_group_name',
          unique: true,
          where: { isActive: true },
          transaction
        });
      }
      if (!await indexExists(queryInterface, 'PatientTagAssignments', 'uq_patient_tag_assignments_patient_tag', transaction)) {
        await queryInterface.addIndex('PatientTagAssignments', ['patientId', 'patientTagId'], {
          name: 'uq_patient_tag_assignments_patient_tag',
          unique: true,
          transaction
        });
      }
      if (!await indexExists(queryInterface, 'PatientTagAssignments', 'idx_patient_tag_assignments_tag_patient', transaction)) {
        await queryInterface.addIndex('PatientTagAssignments', ['patientTagId', 'patientId'], {
          name: 'idx_patient_tag_assignments_tag_patient',
          transaction
        });
      }

      await addRoleModule(queryInterface, Sequelize, transaction);
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      if (await tableExists(queryInterface, 'PatientTagAssignments', transaction)) {
        await queryInterface.dropTable('PatientTagAssignments', { transaction });
      }
      if (await tableExists(queryInterface, 'PatientTags', transaction)) {
        await queryInterface.dropTable('PatientTags', { transaction });
      }
    });
  }
};
