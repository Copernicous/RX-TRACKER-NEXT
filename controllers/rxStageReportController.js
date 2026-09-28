'use strict';

const db = require('../models');
const { getRequestPermission } = require('../middleware/rbac');
const { parseLocalDateOnly, localDayBoundaryIso } = require('../utils/dateUtils');
const { activeRxWorkflowAggregateSql } = require('../utils/rxWorkflowAggregateSql');
const { csvLine, csvHeaders, writeCsv } = require('../utils/historyListing');

function parseQuery(query) {
    const invalid = message => { throw Object.assign(new Error(message), { status: 400 }); };
    const scope = query.scope || 'current';
    const direction = query.direction || 'asc';
    if (!['current', 'reached'].includes(scope)) invalid('Invalid stage scope.');
    if (!['asc', 'desc'].includes(direction)) invalid('Invalid sort direction.');
    if (typeof query.stages !== 'string' || !/^\d+(,\d+)*$/.test(query.stages)) invalid('Select at least one stage.');
    const stages = [...new Set(query.stages.split(',').map(Number))];
    if (stages.length > 100 || stages.some(id => !Number.isSafeInteger(id) || id < 1)) invalid('Invalid stages.');
    for (const key of ['from', 'to']) {
        if (query[key] && (typeof query[key] !== 'string' || !parseLocalDateOnly(query[key]))) invalid('Invalid stage date.');
    }
    if (query.from && query.to && query.from > query.to) invalid('From date must be on or before To date.');
    const page = query.page === undefined ? 1 : Number(query.page);
    if (!Number.isSafeInteger(page) || page < 1 || page > 1000000) invalid('Invalid page.');
    return { scope, direction, stages, page, from: localDayBoundaryIso(query.from, 0), to: localDayBoundaryIso(query.to, 1) };
}

function calendarDay(date) {
    return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
}
function present(row, now) {
    const date = row.stageDate ? new Date(row.stageDate) : null;
    const valid = date && Number.isFinite(date.getTime());
    return { ...row, stageDate: valid ? date.toISOString() : null,
        stageDateDisplay: valid ? date.toLocaleString('en-US') : 'Date not recorded',
        daysElapsed: valid ? Math.floor((calendarDay(now) - calendarDay(date)) / 86400000) : null };
}

exports.getReport = async (req, res) => {
    try {
        const permission = await getRequestPermission(req, 'rx_records');
        const exporting = req.path.endsWith('/export');
        if (!permission.visible || (exporting && !permission.canExport)) return res.status(403).json({ error: 'Permission denied.' });
        res.setHeader('Cache-Control', 'no-store');
        const options = await db.WorkflowAction.findAll({ where: { isActive: true }, attributes: ['id', 'name', 'sequenceNumber'], order: [['sequenceNumber', 'ASC'], ['id', 'ASC']], raw: true });
        if (req.query.options === '1' && !exporting) return res.json({ stages: options, canExport: !!permission.canExport });
        const filter = parseQuery(req.query);
        if (filter.stages.some(id => !options.some(action => Number(action.id) === id))) return res.status(400).json({ error: 'Select active workflow stages.' });
        const historicalDriver = permission.canViewDriverHistory || permission.canCorrectDriver || permission.canSyncDriverHistory;
        const driverSql = filter.scope === 'current'
            ? `COALESCE(NULLIF(driver."contactPerson", ''), driver."companyName", '')`
            : historicalDriver ? `COALESCE(t."driverNameSnapshot", '')` : `''`;
        const replacements = { stages: filter.stages, from: filter.from, to: filter.to };
        const base = `WITH stages AS (
            SELECT DISTINCT ON (wt."rxRecordId", wt."workflowActionId") wt.*, wa.name AS stage, wa."sequenceNumber" AS sequence
            FROM "RXWorkflowTrackings" wt JOIN "WorkflowActions" wa ON wa.id = wt."workflowActionId" AND wa."isActive" = TRUE
            ORDER BY wt."rxRecordId", wt."workflowActionId", wt."completionDate" DESC NULLS LAST, wt.id DESC
        ), current_workflow AS (${activeRxWorkflowAggregateSql()})
        SELECT r.id AS "rxId", COALESCE(NULLIF(p."patientCode", ''), p.id::text) AS "patientCode",
            CONCAT_WS(' ', p."firstName", p."lastName") AS patient, c.name AS clinic,
            ${driverSql} AS driver, t.stage, t."workflowActionId" AS "stageId", t.sequence,
            t."completionDate" AS "stageDate"
        FROM stages t JOIN "RXRecords" r ON r.id = t."rxRecordId"
        JOIN "Patients" p ON p.id = r."patientId"
        LEFT JOIN "Clinics" c ON c.id = p."clinicId"
        LEFT JOIN "PharmacyTransportCompanies" driver ON driver.id = r."pharmacyTransportCompanyId"
        JOIN current_workflow cw ON cw."rxRecordId" = r.id
        WHERE r."isDeleted" IS NOT TRUE AND t."workflowActionId" IN (:stages)
        ${filter.scope === 'current' ? 'AND t.sequence = cw.current_stage_sequence' : ''}
        ${filter.from ? 'AND t."completionDate" >= CAST(:from AS TIMESTAMPTZ)' : ''}
        ${filter.to ? 'AND t."completionDate" < CAST(:to AS TIMESTAMPTZ)' : ''}`;
        const ordered = `${base} ORDER BY t.sequence ASC NULLS LAST, t."workflowActionId" ASC, t."completionDate" ${filter.direction.toUpperCase()} NULLS LAST, r.id ASC`;
        const query = (sql, extra = {}) => db.sequelize.query(sql, { replacements: { ...replacements, ...extra }, type: db.Sequelize.QueryTypes.SELECT });
        const now = new Date();
        const driverHeading = filter.scope === 'current' ? 'Current driver' : 'Stage driver';
        if (exporting) {
            // One query provides a consistent complete result, independent of the displayed page.
            const rows = await query(ordered);
            csvHeaders(res, 'rx-stage-report.csv');
            if (!await writeCsv(res, '\uFEFF' + csvLine(['RX ID', 'Patient ID', 'Patient', 'Clinic', driverHeading, 'Stage', 'Stage date', 'Stage date (UTC)', 'Days elapsed', 'Stage scope']))) return;
            for (const raw of rows) {
                const row = present(raw, now);
                if (!await writeCsv(res, csvLine([row.rxId, row.patientCode, row.patient, row.clinic, row.driver, row.stage, row.stageDateDisplay, row.stageDate, row.daysElapsed, filter.scope]))) return;
            }
            return res.end();
        }
        const counts = await query(`SELECT COUNT(*)::integer AS total FROM (${base}) report`);
        const rows = await query(`${ordered} LIMIT 50 OFFSET :offset`, { offset: (filter.page - 1) * 50 });
        return res.json({ rows: rows.map(row => present(row, now)), total: counts[0].total, page: filter.page, pageSize: 50,
            driverHeading, driverRestricted: filter.scope === 'reached' && !historicalDriver,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, canExport: !!permission.canExport });
    } catch (error) {
        if (res.headersSent) return res.destroy(error);
        return res.status(error.status || 500).json({ error: error.status ? error.message : 'Unable to load stage report.' });
    }
};

exports.parseQuery = parseQuery;
exports.present = present;
