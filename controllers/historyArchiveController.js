'use strict';
const service = require('../services/historyArchiveService');
const db = require('../models');
const { sourceModel } = require('../utils/historySource');
const crypto = require('crypto');
const { dateRange, filenameDateRange } = require('../utils/archiveDateRange');
const settings = require('../services/settingsService');
const gzip = require('util').promisify(require('zlib').gzip);
const handle = fn => async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try { await fn(req, res); }
    catch (e) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Archive operation failed. No uncommitted transfers were applied.' }); }
};
exports.status = handle(async (req, res) => res.json(await service.status()));
exports.save = handle(async (req, res) => res.json(await service.savePolicy(req.body, req.user.id)));
exports.preview = handle(async (req, res) => res.json(await service.preview(req.body.kind, req.body.days)));
exports.run = handle(async (req, res) => {
    const policy = await service.policy();
    if (!Object.hasOwn(policy.types, req.body.kind)) { const e = Error('Unknown archive section.'); e.status = 400; throw e; }
    if (req.body.days !== undefined && req.body.days !== policy.types[req.body.kind].days) { const e = Error('Retention changed since preview. Refresh and preview again.'); e.status = 409; throw e; }
    res.json(await service.run(req.body.kind, policy.types[req.body.kind].days, req.user.id));
});
async function archiveRevision() {
    const [row] = await db.sequelize.query(`SELECT COALESCE(MAX(id), 0)::text AS revision FROM "AuditLogs"
        WHERE "module" = 'History Archive' AND "action" = 'History archived'`, { type: db.Sequelize.QueryTypes.SELECT });
    return row.revision;
}
function section(kind) {
    if (!Object.hasOwn(service.TYPES, kind)) { const e = Error('Unknown archive section.'); e.status = 400; throw e; }
    const { Op } = db.Sequelize;
    const where = {};
    if (kind === 'imports') Object.assign(where, { module: 'Data Import', action: 'Patient import report' });
    if (kind === 'corrections') Object.assign(where, { module: 'Data Import', action: ['Patient import correction file', 'Patient import correction revision', 'Patient import correction resolved'] });
    if (kind === 'audit') where[Op.or] = [{ module: null }, { module: { [Op.ne]: 'Data Import' } }];
    return { model: sourceModel(db, service.TYPES[kind].model, 'archived'), where, pageSize: ['imports', 'corrections'].includes(kind) ? 1 : 250, dateField: service.TYPES[kind].date };
}
function archiveTimeZone() {
    const zone = settings.get('app_timezone') || 'America/New_York';
    try { new Intl.DateTimeFormat('en-US', { timeZone: zone }).format(); return zone; } catch { return 'UTC'; }
}
function invalid(message, status = 400) { const e = Error(message); e.status = status; throw e; }
async function pageInfo(req) {
    const s = section(req.params.kind);
    const page = req.query.page === undefined ? 1 : Number(req.query.page);
    if (!Number.isSafeInteger(page) || page < 1) invalid('Page must be a positive whole number.');
    const revision = await archiveRevision();
    if (req.query.revision !== undefined && req.query.revision !== revision) invalid('Archive changed. Refresh the archive pages before continuing.', 409);
    const totalRecords = await s.model.count({ where: s.where });
    const totalPages = Math.ceil(totalRecords / s.pageSize);
    if (page > Math.max(1, totalPages)) invalid('That archive page does not exist.');
    const [overall] = await s.model.findAll({ where: s.where, raw: true, attributes: [
        [db.sequelize.fn('MIN', db.sequelize.col(s.dateField)), 'dateFrom'], [db.sequelize.fn('MAX', db.sequelize.col(s.dateField)), 'dateTo']
    ] });
    const firstPage = Math.max(1, page-2), lastPage = Math.min(totalPages, page+2);
    const nearby = totalPages ? await s.model.findAll({ where: s.where, attributes: ['id', s.dateField], raw: true,
        order: [['id','ASC']], offset: (firstPage-1)*s.pageSize, limit: (lastPage-firstPage+1)*s.pageSize }) : [];
    const pages = [];
    for (let n = firstPage; n <= lastPage; n++) {
        const records = nearby.slice((n-firstPage)*s.pageSize, (n-firstPage+1)*s.pageSize);
        pages.push({ page: n, ...dateRange(records, s.dateField) });
    }
    if (revision !== await archiveRevision()) invalid('Archive changed. Refresh the archive pages before continuing.', 409);
    const [identity] = await db.sequelize.query('SELECT oid::text AS oid FROM pg_database WHERE datname = current_database()', { type: db.Sequelize.QueryTypes.SELECT });
    const scope = crypto.createHash('sha256').update(JSON.stringify([db.sequelize.config.database, identity.oid, req.user.id, req.params.kind])).digest('hex');
    return { ...s, metadata: { kind: req.params.kind, scope, revision, page, pageSize: s.pageSize, totalRecords, totalPages,
        dateField: s.dateField, timeZone: archiveTimeZone(), dateFrom: overall.dateFrom, dateTo: overall.dateTo, pages,
        firstRecord: totalRecords ? (page - 1) * s.pageSize + 1 : 0, lastRecord: Math.min(page * s.pageSize, totalRecords) } };
}
exports.pages = handle(async (req, res) => res.json((await pageInfo(req)).metadata));
// Bounded export pages preserve original JSON types and UTC timestamps.
exports.download = handle(async (req, res) => {
    if (req.query.page !== undefined) {
        if (req.query.revision === undefined) invalid('Refresh the archive pages before downloading.');
        const { model, where, metadata, dateField } = await pageInfo(req);
        if (!metadata.totalRecords) invalid('This section has no archived records.');
        const records = await model.findAll({ where, order: [['id', 'ASC']], offset: (metadata.page - 1) * metadata.pageSize, limit: metadata.pageSize, raw: true });
        if (metadata.revision !== await archiveRevision()) invalid('Archive changed during export. Refresh the archive pages before continuing.', 409);
        if (records.length !== metadata.lastRecord - metadata.firstRecord + 1) invalid('Archive page changed. Refresh the archive pages.', 409);
        const bytes = Buffer.from(JSON.stringify(records));
        const range = dateRange(records, dateField);
        const { pages, ...exportMetadata } = metadata;
        const packet = { format: 'rx-history-archive', version: 1, kind: req.params.kind, exportedAt: new Date().toISOString(),
            manifest: { ...exportMetadata, archiveDateFrom: metadata.dateFrom, archiveDateTo: metadata.dateTo, ...range, count: records.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), checksumEncoding: 'UTF-8 JSON.stringify(records)' }, records };
        const filename = `rx-history-${req.params.kind}-${filenameDateRange(range, metadata.timeZone)}-r${metadata.revision}-page-${String(metadata.page).padStart(4, '0')}-of-${String(metadata.totalPages).padStart(4, '0')}.json.gz`;
        res.set('Content-Type', 'application/gzip'); res.set('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(await gzip(Buffer.from(JSON.stringify(packet))));
        return;
    }
    const type = Object.hasOwn(service.TYPES, req.params.kind) && service.TYPES[req.params.kind];
    if (!type) { const e = Error('Unknown archive section.'); e.status = 400; throw e; }
    const after = req.query.after === undefined ? 0 : Number(req.query.after);
    if (!Number.isSafeInteger(after) || after < 0) { const e = Error('Invalid archive cursor.'); e.status = 400; throw e; }
    const revision = await archiveRevision();
    if ((after > 0 && req.query.revision === undefined) || (req.query.revision !== undefined && req.query.revision !== revision)) {
        const e = Error('Archive changed or export cursor expired. Restart this section download; earlier pages may be incomplete.'); e.status = 409; throw e;
    }
    const { Op } = db.Sequelize;
    const where = { id: { [Op.gt]: after } };
    if (req.params.kind === 'imports') Object.assign(where, { module: 'Data Import', action: 'Patient import report' });
    if (req.params.kind === 'corrections') Object.assign(where, { module: 'Data Import', action: ['Patient import correction file', 'Patient import correction revision', 'Patient import correction resolved'] });
    if (req.params.kind === 'audit') where[Op.or] = [{ module: null }, { module: { [Op.ne]: 'Data Import' } }];
    const pageSize = ['imports', 'corrections'].includes(req.params.kind) ? 1 : 250;
    const rows = await sourceModel(db, type.model, 'archived').findAll({ where, order: [['id', 'ASC']], limit: pageSize + 1, raw: true });
    if (revision !== await archiveRevision()) { const e = Error('Archive changed during export. Restart this section download.'); e.status = 409; throw e; }
    const records = rows.slice(0, pageSize);
    const range = dateRange(records, type.date), timeZone = archiveTimeZone();
    const bytes = Buffer.from(JSON.stringify(records));
    const packet = { format: 'rx-history-archive', version: 1, kind: req.params.kind, exportedAt: new Date().toISOString(),
        manifest: { revision, ...range, dateField: type.date, timeZone, count: records.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
            checksumEncoding: 'UTF-8 JSON.stringify(records)', nextAfter: rows.length > pageSize ? records[records.length - 1].id : null }, records };
    res.set('Content-Type', 'application/gzip');
    res.set('X-Archive-Next-After', packet.manifest.nextAfter === null ? '' : String(packet.manifest.nextAfter));
    res.set('X-Archive-Revision', revision);
    res.set('Content-Disposition', `attachment; filename="rx-history-${req.params.kind}-${filenameDateRange(range,timeZone)}-after-${after}.json.gz"`);
    res.send(await gzip(Buffer.from(JSON.stringify(packet))));
});
