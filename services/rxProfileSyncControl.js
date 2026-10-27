'use strict';
const db = require('../models');
const KEY = 'rx_profile_sync_control_v1';
const LOCK = 7261040;
const defaults = () => ({ enabled: false, startDate: null });
function validate(input) {
    if (!input || typeof input.enabled !== 'boolean') throw Error('Choose whether RX Profile Sync is enabled.');
    const startDate = input.startDate || null;
    if (startDate !== null && (typeof startDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)
        || !Number.isFinite(Date.parse(startDate + 'T00:00:00.000Z'))
        || new Date(startDate + 'T00:00:00.000Z').toISOString().slice(0, 10) !== startDate)) throw Error('Choose a valid starting date.');
    if (input.enabled && !startDate) throw Error('Choose a starting date before enabling RX Profile Sync.');
    return { enabled: input.enabled, startDate };
}
async function get(transaction) {
    const row = await db.SystemSetting.findOne({ where: { key: KEY }, raw: true, ...(transaction ? { transaction } : {}) });
    return row ? validate(JSON.parse(row.value)) : defaults();
}
async function lock(transaction) { await db.sequelize.query('SELECT pg_advisory_xact_lock(:key)', { replacements: { key: LOCK }, transaction }); }
async function save(input, user) {
    const value = validate(input);
    await db.sequelize.transaction(async transaction => {
        await lock(transaction);
        await db.SystemSetting.upsert({ key: KEY, value: JSON.stringify(value), description: 'RX Profile Sync pause and inclusive RX creation date (UTC)' }, { transaction });
        await db.AuditLog.create({ userId: user.id, module: 'RX Profile Sync', action: 'Control changed', newValue: value,
            date: new Date().toISOString().slice(0, 10), time: new Date().toISOString().slice(11, 19) }, { transaction });
    });
    return value;
}
async function requireEnabled(transaction) {
    await lock(transaction); const value = await get(transaction);
    if (!value.enabled) { const error = Error('RX Profile Sync is paused. Review/ignore is still available; copying values is disabled.'); error.status = 409; throw error; }
    return value;
}
function inRange(rx, control) {
    return !control.startDate || (rx.createdAt && new Date(rx.createdAt).getTime() >= Date.parse(control.startDate + 'T00:00:00.000Z'));
}
module.exports = { KEY, defaults, validate, get, save, requireEnabled, inRange };
