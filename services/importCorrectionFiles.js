'use strict';
const crypto = require('crypto');
const retainedFile = require('../utils/retainedImportFile');
const { enabled } = require('../utils/importReviewV2');
const FILE = 'Patient import correction file';
const REVISION = 'Patient import correction revision';
const RESOLVED = 'Patient import correction resolved';
const fail = message => { const e = Error(message); e.status = 400; throw e; };
const links = rows => rows.flatMap((row, index) => {
    if (!row._reviewCorrectionId && !row._reviewItemId) return [];
    const id = Number(row._reviewCorrectionId), itemId = row._reviewItemId;
    if (!Number.isSafeInteger(id) || id <= 0 || !/^[a-f0-9]{32}$/.test(itemId || '')) fail('Correction file references are invalid. Download the file again.');
    return [{ id, itemId, row: index + 2 }];
});
async function load(db, userId, ids, transaction) {
    if (!ids.length) return [];
    const reader = transaction ? db.AuditLog : db.AuditLogHistory;
    const records = await reader.findAll({ where: { id: ids, userId, module: 'Data Import', action: FILE },
        order: [['id', 'ASC']], raw: true, ...(transaction ? { transaction, lock: transaction.LOCK.UPDATE } : {}) });
    if (records.length !== ids.length) fail('Correction file is unavailable or belongs to another importer.');
    const events = await reader.findAll({ where: { recordId: ids, userId, module: 'Data Import', action: [REVISION, RESOLVED] },
        order: [['id', 'ASC']], raw: true, ...(transaction ? { transaction } : {}) });
    return records.map(record => {
        const items = new Map(record.newValue.items.map(item => [item.itemId, { ...item }]));
        const completed = [];
        for (const event of events.filter(e => e.recordId === record.id)) {
            if (event.action === REVISION) for (const item of event.newValue.items) {
                if (items.has(item.itemId)) items.set(item.itemId, { ...items.get(item.itemId), ...item });
            }
            else { for (const id of event.newValue.itemIds) items.delete(id); completed.push(event); }
        }
        return { ...record, pending: [...items.values()], completed };
    });
}
async function validate(db, userId, rows, transaction) {
    const incoming = links(rows);
    if (new Set(incoming.map(l => l.id + ':' + l.itemId)).size !== incoming.length) fail('A correction row was submitted more than once.');
    const records = await load(db, userId, [...new Set(incoming.map(l => l.id))].sort((a,b) => a-b), transaction);
    for (const item of incoming) if (!records.find(r => r.id === item.id)?.pending.some(p => p.itemId === item.itemId)) fail('This correction row was already completed. Download the remaining rows again.');
    return incoming;
}
async function audit(db, req, action, recordId, newValue, transaction) {
    return db.AuditLog.create({ userId: req.user.id, module: 'Data Import', action, recordId, newValue,
        date: new Date().toISOString().slice(0,10), time: new Date().toTimeString().slice(0,8), ipAddress: req.ip || 'unknown' }, transaction ? { transaction } : {});
}
async function saveErrors(db, req, rows, errors) {
    return db.sequelize.transaction(async transaction => {
        const key = 'import-correction:' + req.user.id + ':' + crypto.createHash('sha256').update(req.file.buffer).digest('hex');
        await db.sequelize.query('SELECT pg_advisory_xact_lock(hashtext(:key))', { replacements: { key }, transaction });
        return persistErrors(db, req, rows, errors, transaction);
    });
}
async function persistErrors(db, req, rows, errors, transaction) {
    const currentLinks = await validate(db, req.user.id, rows, transaction);
    const messages = new Map();
    errors.forEach(e => { if (!messages.has(e.row)) messages.set(e.row, []); messages.get(e.row).push(e.error); });
    const headers = Object.keys(rows[0] || {}).filter(key => !key.startsWith('_review') && key !== '_import_error');
    const newItems = [], revisions = new Map();
    for (const [rowNumber, errors] of messages) {
        const row = rows[rowNumber - 2]; if (!row) continue;
        const link = currentLinks.find(l => l.row === rowNumber);
        const item = { itemId: link?.itemId || crypto.randomBytes(16).toString('hex'), sourceRow: row._reviewSourceRow || rowNumber,
            values: Object.fromEntries(headers.map(h => [h, row[h] || ''])), error: errors.join('; '), notes: row._reviewNotes || '' };
        if (link) { if (!revisions.has(link.id)) revisions.set(link.id, []); revisions.get(link.id).push(item); }
        else newItems.push(item);
    }
    const ids = [];
    if (newItems.length) {
        const captured = retainedFile.capture(req.file);
        const existing = await db.AuditLogHistory.findOne({ where: { userId: req.user.id, module: 'Data Import', action: FILE, [db.Sequelize.Op.and]: db.Sequelize.where(db.Sequelize.json('newValue.sourceFile.sha256'), captured.sha256) }, order: [['id','DESC']], attributes: ['id'], raw: true, transaction });
        if (existing) ids.push(existing.id);
        else {
        const file = await audit(db, req, FILE, null, { schemaVersion: 1, fileName: String(req.file.originalname || 'patients.csv').replace(/^.*[\\/]/,'').slice(0,255), headers, items: newItems, sourceFile: retainedFile.capture(req.file) }, transaction);
        ids.push(file.id);
        }
    }
    for (const [id, items] of revisions) { await audit(db, req, REVISION, id, { items }, transaction); ids.push(id); }
    return ids;
}
async function resolve(db, req, incomingLinks, savedRows, reportId, transaction) {
    const selected = incomingLinks.filter(link => savedRows.includes(link.row));
    for (const id of new Set(selected.map(l => l.id))) await audit(db, req, RESOLVED, id, {
        itemIds: selected.filter(l => l.id === id).map(l => l.itemId), reportId,
        fileName: String(req.file.originalname || 'corrected.csv').replace(/^.*[\\/]/,'').slice(0,255)
    }, transaction);
}
function packet(record) {
    const headers = [...record.newValue.headers, '_reviewSourceRow', '_reviewError', '_reviewNotes', '_reviewStatus', '_reviewCorrectionId', '_reviewItemId'];
    return { id: record.id, fileName: record.newValue.fileName, headers, rows: record.pending.map(item => ({ ...item.values,
        _reviewSourceRow: item.sourceRow, _reviewError: item.error, _reviewNotes: item.notes, _reviewStatus: 'Needs correction',
        _reviewCorrectionId: record.id, _reviewItemId: item.itemId })) };
}
function requireEnabled() { if (!enabled()) { const e = Error('Correction files are not enabled for this environment.'); e.status = 404; throw e; } }
module.exports = { FILE, RESOLVED, load, validate, saveErrors, resolve, packet, requireEnabled };
