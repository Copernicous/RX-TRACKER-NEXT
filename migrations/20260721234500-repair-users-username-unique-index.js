'use strict';

/**
 * Repairs a production drift observed in a real RX Tracker 3.3.1 dump where
 * the startup-managed schema contained Users.username but the migration's
 * unique index had never been created. No user values are logged.
 */
module.exports = {
  async up(queryInterface) {
    const indexes = await queryInterface.showIndex('Users');
    if (hasUniqueUsernameIndex(indexes)) return;

    const [rows] = await queryInterface.sequelize.query(`
      SELECT COUNT(*)::integer AS "count"
        FROM (
          SELECT "username"
            FROM "Users"
           WHERE "username" IS NOT NULL
           GROUP BY "username"
          HAVING COUNT(*) > 1
        ) AS duplicate_usernames
    `);
    const duplicateGroups = Number(rows[0] && rows[0].count || 0);
    if (duplicateGroups > 0) {
      throw new Error(
        `Cannot create Users(username) unique index: ${duplicateGroups} duplicate username group(s) require administrator review.`
      );
    }

    await queryInterface.addIndex('Users', ['username'], {
      name: 'uq_users_username',
      unique: true
    });
  },

  async down(queryInterface) {
    const indexes = await queryInterface.showIndex('Users');
    if (indexes.some((index) => index.name === 'uq_users_username')) {
      await queryInterface.removeIndex('Users', 'uq_users_username');
    }
  }
};

function hasUniqueUsernameIndex(indexes) {
  return indexes.some((index) => {
    if (!index.unique) return false;
    const fields = (index.fields || [])
      .map((field) => String(field.attribute || field.name || '').toLowerCase())
      .filter(Boolean);
    return fields.length === 1 && fields[0] === 'username';
  });
}
