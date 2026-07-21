'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Users', 'phoneAccountSetupAllowed', {
      allowNull: false,
      defaultValue: false,
      type: Sequelize.BOOLEAN
    });

    // Remove the short-lived role-wide key if it was applied in staging while
    // this workflow was being tested. Production roles normally have no key.
    const roles = await queryInterface.sequelize.query(
      'SELECT id, permissions FROM "Roles" ORDER BY id',
      { type: Sequelize.QueryTypes.SELECT }
    );
    for (const role of roles) {
      let permissions = role.permissions || {};
      if (typeof permissions === 'string') {
        try { permissions = JSON.parse(permissions); } catch (_err) { permissions = {}; }
      }
      if (!permissions || !Object.prototype.hasOwnProperty.call(permissions, 'phone_account_setup')) continue;
      delete permissions.phone_account_setup;
      await queryInterface.sequelize.query(
        'UPDATE "Roles" SET permissions = :permissions, "updatedAt" = :updatedAt WHERE id = :id',
        { replacements: { id: role.id, permissions: JSON.stringify(permissions), updatedAt: new Date() } }
      );
    }
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('Users', 'phoneAccountSetupAllowed');
  }
};
