'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('DailySnapshots');
    const columns = {
      patientsWithNoRx:         { type: Sequelize.INTEGER, defaultValue: 0 },
      eligibleNow:              { type: Sequelize.INTEGER, defaultValue: 0 },
      expiringIn7:              { type: Sequelize.INTEGER, defaultValue: 0 },
      inWindow:                 { type: Sequelize.INTEGER, defaultValue: 0 },
      noServiceDate:            { type: Sequelize.INTEGER, defaultValue: 0 },
      loginEventsToday:         { type: Sequelize.INTEGER, defaultValue: 0 },
      uniqueLoginUsersToday:    { type: Sequelize.INTEGER, defaultValue: 0 },
      userActivityEventsToday:  { type: Sequelize.INTEGER, defaultValue: 0 },
      uniqueActivityUsersToday: { type: Sequelize.INTEGER, defaultValue: 0 }
    };

    for (const name of Object.keys(columns)) {
      if (!table[name]) {
        await queryInterface.addColumn('DailySnapshots', name, columns[name]);
      }
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('DailySnapshots');
    const names = [
      'uniqueActivityUsersToday',
      'userActivityEventsToday',
      'uniqueLoginUsersToday',
      'loginEventsToday',
      'noServiceDate',
      'inWindow',
      'expiringIn7',
      'eligibleNow',
      'patientsWithNoRx'
    ];

    for (const name of names) {
      if (table[name]) {
        await queryInterface.removeColumn('DailySnapshots', name);
      }
    }
  }
};
