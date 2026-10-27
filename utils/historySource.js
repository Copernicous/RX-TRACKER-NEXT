'use strict';

function sourceModel(db, name, source = 'all') {
    if (!['active', 'archived', 'all'].includes(source)) {
        const error = Error('History source must be active, archived or all.');
        error.status = 400;
        throw error;
    }
    return source === 'active' ? db[name] : db[name + (source === 'archived' ? 'Archive' : 'History')];
}

function registerHistoryModels(db, sequelize) {
    for (const name of ['AuditLog', 'UserActivityLog', 'ErrorLog']) {
        const original = db[name];
        for (const suffix of ['Archive', 'History']) {
            const attributes = Object.fromEntries(Object.entries(original.rawAttributes).map(([key, value]) =>
                [key, { type: value.type, primaryKey: !!value.primaryKey, allowNull: value.allowNull, field: value.field }]));
            const model = sequelize.define(name + suffix, attributes, {
                tableName: original.getTableName() + suffix, timestamps: false, historyReadModel: true,
                hooks: Object.fromEntries(['beforeCreate', 'beforeUpdate', 'beforeDestroy', 'beforeBulkCreate', 'beforeBulkUpdate', 'beforeBulkDestroy']
                    .map(hook => [hook, () => { throw Error('Archived history is read-only.'); }]))
            });
            model.belongsTo(db.User, { foreignKey: 'userId' });
            db[name + suffix] = model;
        }
    }
}
module.exports = { sourceModel, registerHistoryModels };
