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
    const sort = query.sort || 'stageDate';
    if (!['rxId', 'patientCode', 'patient', 'clinic', 'driver', 'stage', 'stageDate', 'daysElapsed', 'baselineDate', 'daysSinceBaseline'].includes(sort)) invalid('Invalid sort column.');
    if (!['current', 'reached', 'both'].includes(scope)) invalid('Select at least one stage scope.');
    if (!['asc', 'desc'].includes(direction)) invalid('Invalid sort direction.');
    if (typeof query.stages !== 'string' || !/^\d+(,\d+)*$/.test(query.stages)) invalid('Select at least one stage.');
    const stages = [...new Set(query.stages.split(',').map(Number))];
    if (stages.length > 100 || stages.some(id => !Number.isSafeInteger(id) || id < 1)) invalid('Invalid stages.');
    const baselineStage = query.baselineStage === undefined ? null : Number(query.baselineStage);
    if (baselineStage !== null && (typeof query.baselineStage !== 'string' || !/^\d+$/.test(query.baselineStage) || !Number.isSafeInteger(baselineStage) || baselineStage < 1)) invalid('Select a valid baseline stage.');
    if (baselineStage !== null && stages.includes(baselineStage)) invalid('The baseline stage cannot also be a comparison stage.');
    for (const key of ['from', 'to']) {
        if (query[key] && (typeof query[key] !== 'string' || !parseLocalDateOnly(query[key]))) invalid('Invalid stage date.');
    }
    if (query.from && query.to && query.from > query.to) invalid('From date must be on or before To date.');
    const page = query.page === undefined ? 1 : Number(query.page);
    if (!Number.isSafeInteger(page) || page < 1 || page > 1000000) invalid('Invalid page.');
    return { scope, direction, sort, stages, baselineStage, page, from: localDayBoundaryIso(query.from, 0), to: localDayBoundaryIso(query.to, 1) };
}

function calendarDay(date) {
    return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
}
function present(row, now) {
    const date = row.stageDate ? new Date(row.stageDate) : null;
    const valid = date && Number.isFinite(date.getTime());
    const baseline = row.baselineDate ? new Date(row.baselineDate) : null;
    const baselineValid = baseline && Number.isFinite(baseline.getTime());
    return { ...row, baselineDate: baselineValid ? baseline.toISOString() : null,
        baselineDateDisplay: baselineValid ? baseline.toLocaleString('en-US') : 'Not recorded',
        daysSinceBaseline: valid && baselineValid ? Math.round((calendarDay(date) - calendarDay(baseline)) / 86400000) : null,
        stageDate: valid ? date.toISOString() : null,
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
        const baselineStage = options.find(action => Number(action.id) === filter.baselineStage);
        if (filter.baselineStage !== null && !baselineStage) return res.status(400).json({ error: 'Select an active baseline stage.' });
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const historicalDriver = permission.canViewDriverHistory || permission.canCorrectDriver || permission.canSyncDriverHistory;
        const driverSql = filter.scope === 'current'
            ? `COALESCE(NULLIF(driver."contactPerson", ''), driver."companyName", '')`
            : historicalDriver ? `COALESCE(t."driverNameSnapshot", '')` : `''`;
        const replacements = { stages: filter.stages, baselineStage: filter.baselineStage, timezone, from: filter.from, to: filter.to };
        const base = `WITH stages AS (
            SELECT DISTINCT ON (wt."rxRecordId", wt."workflowActionId") wt.*, wa.name AS stage, wa."sequenceNumber" AS sequence
            FROM "RXWorkflowTrackings" wt JOIN "WorkflowActions" wa ON wa.id = wt."workflowActionId" AND wa."isActive" = TRUE
            ORDER BY wt."rxRecordId", wt."workflowActionId", wt."completionDate" DESC NULLS LAST, wt.id DESC
        ), current_workflow AS (${activeRxWorkflowAggregateSql()})
        SELECT r.id AS "rxId", COALESCE(NULLIF(p."patientCode", ''), p.id::text) AS "patientCode",
            CONCAT_WS(' ', p."firstName", p."lastName") AS patient, c.name AS clinic,
            ${driverSql} AS driver, t.stage, t."workflowActionId" AS "stageId", t.sequence,
            t."completionDate" AS "stageDate", b."completionDate" AS "baselineDate"
        FROM stages t JOIN "RXRecords" r ON r.id = t."rxRecordId"
        LEFT JOIN stages b ON b."rxRecordId" = r.id AND b."workflowActionId" = :baselineStage
        JOIN "Patients" p ON p.id = r."patientId"
        LEFT JOIN "Clinics" c ON c.id = p."clinicId"
        LEFT JOIN "PharmacyTransportCompanies" driver ON driver.id = r."pharmacyTransportCompanyId"
        JOIN current_workflow cw ON cw."rxRecordId" = r.id
        WHERE r."isDeleted" IS NOT TRUE AND t."workflowActionId" IN (:stages)
        ${filter.scope === 'current' ? 'AND t.sequence = cw.current_stage_sequence' : ''}
        ${filter.from ? 'AND t."completionDate" >= CAST(:from AS TIMESTAMPTZ)' : ''}
        ${filter.to ? 'AND t."completionDate" < CAST(:to AS TIMESTAMPTZ)' : ''}`;
        const direction = filter.direction.toUpperCase();
        const sortColumns = { rxId: 'r.id', patientCode: `LOWER(COALESCE(NULLIF(p."patientCode", ''), p.id::text))`,
            patient: `LOWER(CONCAT_WS(' ', p."firstName", p."lastName"))`, clinic: 'LOWER(c.name)',
            driver: `LOWER(${driverSql})`, stage: 'LOWER(t.stage)', stageDate: 't."completionDate"', daysElapsed: 't."completionDate"', baselineDate: 'b."completionDate"',
            daysSinceBaseline: `(t."completionDate" AT TIME ZONE :timezone)::date - (b."completionDate" AT TIME ZONE :timezone)::date` };
        // Keep stage groups together; elapsed days run in the opposite direction to dates.
        const rowDirection = filter.sort === 'daysElapsed' ? (direction === 'ASC' ? 'DESC' : 'ASC') : direction;
        const groups = filter.sort === 'stage' ? `LOWER(t.stage) ${direction}, t."workflowActionId" ASC`
            : 't.sequence ASC NULLS LAST, t."workflowActionId" ASC';
        const ordered = `${base} ORDER BY ${groups}, ${sortColumns[filter.sort]} ${rowDirection} NULLS LAST, t."completionDate" ASC NULLS LAST, r.id ASC`;
        const query = (sql, extra = {}) => db.sequelize.query(sql, { replacements: { ...replacements, ...extra }, type: db.Sequelize.QueryTypes.SELECT });
        const now = new Date();
        const driverHeading = filter.scope === 'current' ? 'Current driver' : 'Stage driver';
        if (exporting) {
            // One query provides a consistent complete result, independent of the displayed page.
            const rows = await query(ordered);
            csvHeaders(res, 'rx-stage-report.csv');
            if (!await writeCsv(res, '\uFEFF' + csvLine(['RX ID', 'Patient ID', 'Patient', 'Clinic', driverHeading, 'Baseline stage', 'Compared stage', 'Baseline date', 'Baseline date (UTC)', 'Stage date', 'Stage date (UTC)', 'Days since baseline', 'Stage scope']))) return;
            for (const raw of rows) {
                const row = present(raw, now);
                if (!await writeCsv(res, csvLine([row.rxId, row.patientCode, row.patient, row.clinic, row.driver, baselineStage ? baselineStage.name : '', row.stage, row.baselineDateDisplay, row.baselineDate, row.stageDateDisplay, row.stageDate, row.daysSinceBaseline, filter.scope]))) return;
            }
            return res.end();
        }
        const counts = await query(`SELECT COUNT(*)::integer AS total FROM (${base}) report`);
        const rows = await query(`${ordered} LIMIT 50 OFFSET :offset`, { offset: (filter.page - 1) * 50 });
        return res.json({ rows: rows.map(row => present(row, now)), total: counts[0].total, page: filter.page, pageSize: 50,
            driverHeading, driverRestricted: filter.scope !== 'current' && !historicalDriver,
            timezone, baselineStage: baselineStage || null, canExport: !!permission.canExport });
    } catch (error) {
        if (res.headersSent) return res.destroy(error);
        return res.status(error.status || 500).json({ error: error.status ? error.message : 'Unable to load stage report.' });
    }
};

exports.parseQuery = parseQuery;
exports.present = present;
