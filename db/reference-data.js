'use strict';

const { BUILT_IN_DEFAULTS } = require('../middleware/rbac');
const settingsService = require('../services/settingsService');

const WORKFLOW_ACTIONS = [
  ['RX Received', 'Initial receipt of RX', 1],
  ['Pharmacy Contacted', 'Pharmacy has been contacted', 2],
  ['Transportation Assigned', 'Transportation company assigned', 3],
  ['Delivery Scheduled', 'Delivery is scheduled', 4],
  ['RX Delivered', 'RX has been delivered to patient', 5],
  ['Driver Receipt Obtained', 'Signed receipt from driver obtained', 6]
];

async function seedReferenceData(db, logger = console) {
  const transaction = await db.sequelize.transaction();
  const result = {
    rolesCreated: 0,
    rolesPatched: 0,
    workflowActionsCreated: 0,
    settingsCreated: 0,
    settingsEncrypted: 0
  };

  try {
    for (const [name, defaultsFactory] of Object.entries(BUILT_IN_DEFAULTS)) {
      const [role, created] = await db.Role.findOrCreate({
        where: { name },
        defaults: {
          name,
          description: `${name} role`,
          isSystem: true,
          permissions: defaultsFactory()
        },
        transaction
      });

      if (created) {
        result.rolesCreated += 1;
        continue;
      }

      const canonical = defaultsFactory();
      const merged = mergeMissing(role.permissions || {}, canonical);
      const changed = role.isSystem !== true ||
        !role.description ||
        JSON.stringify(merged) !== JSON.stringify(role.permissions || {});

      if (changed) {
        await role.update({
          isSystem: true,
          description: role.description || `${name} role`,
          permissions: merged
        }, { transaction });
        result.rolesPatched += 1;
      }
    }

    for (const [name, description, sequenceNumber] of WORKFLOW_ACTIONS) {
      const [, created] = await db.WorkflowAction.findOrCreate({
        where: { name },
        defaults: { name, description, sequenceNumber, isActive: true },
        transaction
      });
      if (created) result.workflowActionsCreated += 1;
    }

    await transaction.commit();
    const settings = await settingsService.initializeDefaults(db);
    result.settingsCreated = settings.created;
    result.settingsEncrypted = settings.encrypted;

    logger.log(
      `[DB] Reference data ready: ${result.rolesCreated} role(s) created, ` +
      `${result.rolesPatched} role(s) patched, ${result.workflowActionsCreated} workflow action(s) created, ` +
      `${result.settingsCreated} setting(s) created, ${result.settingsEncrypted} sensitive setting(s) encrypted.`
    );
    return result;
  } catch (error) {
    if (!transaction.finished) await transaction.rollback();
    throw error;
  }
}

function mergeMissing(existing, defaults) {
  const output = isPlainObject(existing) ? { ...existing } : {};
  for (const [key, defaultValue] of Object.entries(defaults || {})) {
    if (!Object.prototype.hasOwnProperty.call(output, key)) {
      output[key] = clone(defaultValue);
    } else if (isPlainObject(output[key]) && isPlainObject(defaultValue)) {
      output[key] = mergeMissing(output[key], defaultValue);
    }
  }
  return output;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, clone(nested)]));
}

module.exports = {
  WORKFLOW_ACTIONS,
  mergeMissing,
  seedReferenceData
};
