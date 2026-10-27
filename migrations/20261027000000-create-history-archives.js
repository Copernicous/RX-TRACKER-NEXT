'use strict';

// No rows are moved by this migration. Runtime rotation is explicit or scheduled.
const tables = ['AuditLogs', 'UserActivityLogs', 'ErrorLogs'];
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async transaction => {
      for (const table of tables) {
        // Retain original types, IDs and indexes, but never share an ID sequence.
        await queryInterface.sequelize.query(`CREATE TABLE IF NOT EXISTS "${table}Archive" (LIKE "${table}" INCLUDING CONSTRAINTS INCLUDING INDEXES INCLUDING STORAGE)`, { transaction });
        await queryInterface.sequelize.query(`CREATE OR REPLACE VIEW "${table}History" AS SELECT * FROM "${table}" UNION ALL SELECT * FROM "${table}Archive"`, { transaction });
      }
    });
  },
  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async transaction => {
      for (const table of tables) {
        const [rows] = await queryInterface.sequelize.query(`SELECT 1 FROM "${table}Archive" LIMIT 1`, { transaction });
        if (rows.length) throw Error('History archives must be returned to active storage before reversing this migration.');
        await queryInterface.sequelize.query(`DROP VIEW "${table}History"`, { transaction });
        await queryInterface.sequelize.query(`DROP TABLE "${table}Archive"`, { transaction });
      }
    });
  }
};
