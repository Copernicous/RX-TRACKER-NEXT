'use strict';

const db = require('../models');
const { getRequestPermission } = require('../middleware/rbac');
const { parseLocalDateOnly } = require('../utils/dateUtils');
const { csvLine, csvHeaders, writeCsv } = require('../utils/historyListing');

const sortColumns = Object.freeze({
    patientCode: 'LOWER("patientCode")', patient: 'LOWER(patient)', clinic: 'LOWER(clinic)', pharmacy: 'LOWER(pharmacy)',
    lastRxServiceDate: '"lastRxServiceDate"', patientActive: 'CASE WHEN "patientActive" THEN 0 ELSE 1 END',
    serviceDate: '"serviceDate"', rxCount: '"rxCount"', rxStatus: 'CASE WHEN "rxCount" = 0 THEN 0 ELSE 1 END',
    serviceDateCount: '"serviceDateCount"', pendingDateCount: '"pendingDateCount"'
});

function parseQuery(query) {
    const invalid = message => { throw Object.assign(new Error(message), { status: 400 }); };
    for (const key of ['search', 'from', 'to', 'status', 'clinicId', 'pharmacyId', 'lastRxFrom', 'lastRxTo', 'lastRxStatus',
        'patientStatus', 'rxHistory', 'coverage', 'patientId', 'sort', 'direction', 'page', 'pageSize']) {
        if (query[key] !== undefined && typeof query[key] !== 'string') invalid('Invalid ' + key + '.');
    }
    const search = (query.search || '').trim();
    if (search.length > 200) invalid('Search must be at most 200 characters.');
    const status = query.status || 'all';
    if (!['all', 'pending', 'exists'].includes(status)) invalid('Invalid RX status.');
    for (const key of ['from', 'to', 'lastRxFrom', 'lastRxTo']) {
        if (query[key] && !parseLocalDateOnly(query[key])) invalid('Invalid service date.');
    }
    if (query.from && query.to && query.from > query.to) invalid('From date must be on or before To date.');
    if (query.lastRxFrom && query.lastRxTo && query.lastRxFrom > query.lastRxTo) invalid('Last RX From date must be on or before To date.');
    for (const key of ['clinicId', 'pharmacyId']) {
        if (!query[key]) continue;
        const values = query[key].split(',');
        if (values.length > 250 || values.some(value => value !== 'none' && (!/^[1-9]\d*$/.test(value) || Number(value) > 2147483647))) invalid('Invalid ' + key + '.');
    }
    const lastRxStatus = query.lastRxStatus || 'all';
    if (!['all', 'dated', 'undated'].includes(lastRxStatus)) invalid('Invalid last RX status.');
    const patientStatus = query.patientStatus || 'all', rxHistory = query.rxHistory || 'all', coverage = query.coverage || 'all';
    if (!['all', 'active', 'inactive'].includes(patientStatus)) invalid('Invalid patient status.');
    if (!['all', 'none', 'has'].includes(rxHistory)) invalid('Invalid RX history.');
    if (!['all', 'pending_only', 'mixed', 'covered_only'].includes(coverage)) invalid('Invalid patient date coverage.');
    const sort = query.sort || 'patientCode', direction = query.direction || 'asc';
    if (!Object.prototype.hasOwnProperty.call(sortColumns, sort) || !['asc', 'desc'].includes(direction)) invalid('Invalid sort.');
    if (query.patientId && (!/^[1-9]\d*$/.test(query.patientId) || Number(query.patientId) > 2147483647)) invalid('Invalid patient.');
    const page = query.page === undefined ? 1 : Number(query.page);
    if (query.page !== undefined && !/^[1-9]\d*$/.test(query.page) || !Number.isSafeInteger(page) || page < 1 || page > 1000000) invalid('Invalid page.');
    const pageSize = query.pageSize === undefined ? 50 : Number(query.pageSize);
    if (![10, 20, 50, 100, 250, 500, 1000].includes(pageSize) || query.pageSize !== undefined && !/^\d+$/.test(query.pageSize)) invalid('Invalid page size.');
    return { search, status, from: query.from || null, to: query.to || null, page,
        pageSize, sort, direction, patientStatus, rxHistory, coverage, patientId: query.patientId || null,
        clinicId: query.clinicId ? [...new Set(query.clinicId.split(','))].join(',') : null,
        pharmacyId: query.pharmacyId ? [...new Set(query.pharmacyId.split(','))].join(',') : null,
        lastRxFrom: query.lastRxFrom || null, lastRxTo: query.lastRxTo || null, lastRxStatus };
}

// UNION preserves each known patient/date once, even when it has no cycle or RX.
// Date matching also covers legacy RX rows without a cycle link. No sync/write occurs.
const reportSql = `WITH dates AS (
    SELECT "patientId", "serviceDate" FROM "PatientServiceDateCycles"
    UNION SELECT id, "serviceDate" FROM "Patients"
    UNION SELECT "patientId", "previousServiceDate" FROM "PatientServiceDateHistories"
    UNION SELECT "patientId", "newServiceDate" FROM "PatientServiceDateHistories"
    UNION SELECT "patientId", "serviceDate" FROM "RXRecords"
), rx_counts AS (
    SELECT "patientId", "serviceDate", COUNT(*)::integer AS "rxCount"
    FROM "RXRecords" WHERE "isDeleted" IS NOT TRUE AND "serviceDate" IS NOT NULL
    GROUP BY "patientId", "serviceDate"
), latest_rx AS (
    SELECT "patientId", MAX("serviceDate") AS "lastRxServiceDate" FROM rx_counts GROUP BY "patientId"
), rx_history AS (
    SELECT "patientId", COUNT(*)::integer AS "totalRxRecords" FROM "RXRecords"
    WHERE "isDeleted" IS NOT TRUE GROUP BY "patientId"
), dated AS (
    SELECT p.id AS "patientId", COALESCE(NULLIF(p."patientCode", ''), p.id::text) AS "patientCode",
        CONCAT_WS(' ', p."firstName", p."lastName") AS patient,
        COALESCE(NULLIF(BTRIM(c.name), ''), 'Not assigned') AS clinic,
        COALESCE(NULLIF(BTRIM(ph.name), ''), 'Not assigned') AS pharmacy,
        lr."lastRxServiceDate",
        p."clinicId", p."pharmacyId", COALESCE(rh."totalRxRecords", 0) AS "totalRxRecords",
        d."serviceDate", COALESCE(r."rxCount", 0) AS "rxCount",
        p."isActive" IS TRUE AS "patientActive"
    FROM dates d JOIN "Patients" p ON p.id = d."patientId"
    LEFT JOIN "Clinics" c ON c.id = p."clinicId"
    LEFT JOIN "Pharmacies" ph ON ph.id = p."pharmacyId"
    LEFT JOIN latest_rx lr ON lr."patientId" = p.id
    LEFT JOIN rx_history rh ON rh."patientId" = p.id
    LEFT JOIN rx_counts r ON r."patientId" = d."patientId" AND r."serviceDate" = d."serviceDate"
    WHERE p."isDeleted" IS NOT TRUE AND d."serviceDate" IS NOT NULL
        AND (:patientId IS NULL OR p.id = CAST(:patientId AS integer))
        AND (:patientStatus = 'all' OR (:patientStatus = 'active' AND p."isActive" IS TRUE)
            OR (:patientStatus = 'inactive' AND p."isActive" IS NOT TRUE))
        AND (:search IS NULL OR CONCAT_WS(' ', p."patientCode", p."firstName", p."lastName", p.id::text) ILIKE :search ESCAPE '!')
        AND (:from IS NULL OR d."serviceDate" >= CAST(:from AS date))
        AND (:to IS NULL OR d."serviceDate" <= CAST(:to AS date))
        AND (:clinicId IS NULL OR COALESCE(p."clinicId"::text, 'none') = ANY(string_to_array(:clinicId, ',')))
        AND (:pharmacyId IS NULL OR COALESCE(p."pharmacyId"::text, 'none') = ANY(string_to_array(:pharmacyId, ',')))
        AND (:lastRxFrom IS NULL OR lr."lastRxServiceDate" >= CAST(:lastRxFrom AS date))
        AND (:lastRxTo IS NULL OR lr."lastRxServiceDate" <= CAST(:lastRxTo AS date))
        AND (:lastRxStatus = 'all' OR (:lastRxStatus = 'dated' AND lr."lastRxServiceDate" IS NOT NULL)
            OR (:lastRxStatus = 'undated' AND lr."lastRxServiceDate" IS NULL))
), counted AS (
    SELECT *, COUNT(*) OVER (PARTITION BY "patientId")::integer AS "serviceDateCount",
        (COUNT(*) FILTER (WHERE "rxCount" = 0) OVER (PARTITION BY "patientId"))::integer AS "pendingDateCount"
    FROM dated
), filtered AS (
    SELECT * FROM counted WHERE (:status = 'all' OR (:status = 'pending' AND "rxCount" = 0)
        OR (:status = 'exists' AND "rxCount" > 0))
        AND (:rxHistory = 'all' OR (:rxHistory = 'none' AND "totalRxRecords" = 0) OR (:rxHistory = 'has' AND "totalRxRecords" > 0))
        AND (:coverage = 'all' OR (:coverage = 'pending_only' AND "pendingDateCount" = "serviceDateCount")
            OR (:coverage = 'mixed' AND "pendingDateCount" > 0 AND "pendingDateCount" < "serviceDateCount")
            OR (:coverage = 'covered_only' AND "pendingDateCount" = 0))
) `;

const summaryColumns = `COUNT(*)::integer AS total, COUNT(DISTINCT "patientId")::integer AS patients,
    (COUNT(*) FILTER (WHERE "rxCount" = 0))::integer AS pending,
    (COUNT(*) FILTER (WHERE "rxCount" > 0))::integer AS covered,
    (COUNT(DISTINCT "patientId") FILTER (WHERE "totalRxRecords" = 0))::integer AS "noRxPatients",
    (COUNT(DISTINCT "patientId") FILTER (WHERE "totalRxRecords" > 0))::integer AS "historyPatients",
    (COUNT(DISTINCT "patientId") FILTER (WHERE "pendingDateCount" = "serviceDateCount"))::integer AS "pendingOnlyPatients",
    (COUNT(DISTINCT "patientId") FILTER (WHERE "pendingDateCount" > 0 AND "pendingDateCount" < "serviceDateCount"))::integer AS "mixedPatients",
    (COUNT(DISTINCT "patientId") FILTER (WHERE "pendingDateCount" = 0))::integer AS "coveredOnlyPatients"`;

exports.getReport = async (req, res) => {
    try {
        const permission = await getRequestPermission(req, 'patients');
        const exporting = req.path.endsWith('/export');
        if (!permission.visible || (exporting && !permission.canExport)) return res.status(403).json({ error: 'Permission denied.' });
        res.setHeader('Cache-Control', 'no-store');
        if (req.query.options === '1' && !exporting) {
            const query = sql => db.sequelize.query(sql, { type: db.Sequelize.QueryTypes.SELECT });
            const clinics = await query('SELECT id, name FROM "Clinics" ORDER BY LOWER(name), id');
            const pharmacies = await query('SELECT id, name FROM "Pharmacies" ORDER BY LOWER(name), id');
            return res.json({ clinics, pharmacies });
        }
        const filter = parseQuery(req.query);
        const replacements = { ...filter, search: filter.search ? '%' + filter.search.replace(/[!%_]/g, '!$&') + '%' : null };
        res.setHeader('Cache-Control', 'no-store');
        // One snapshot keeps counts, pages and streamed export batches consistent.
        await db.sequelize.transaction({ isolationLevel: 'REPEATABLE READ', readOnly: true }, async transaction => {
            const query = (sql, extra = {}) => db.sequelize.query(reportSql + sql, {
                replacements: { ...replacements, ...extra }, transaction, type: db.Sequelize.QueryTypes.SELECT
            });
            const ordered = `SELECT * FROM filtered ORDER BY ${sortColumns[filter.sort]} ${filter.direction.toUpperCase()} NULLS LAST, "patientId" ASC, "serviceDate" DESC`;
            if (exporting) {
                csvHeaders(res, 'patient-service-dates.csv');
                if (!await writeCsv(res, csvLine(['Patient ID', 'Patient', 'Assigned clinic', 'Assigned pharmacy', 'Last RX service date', 'Patient status', 'Service date', 'RX records', 'RX status', 'Patient service dates in range', 'Patient pending dates in range']))) return;
                for (let offset = 0; !res.destroyed; offset += 500) {
                    const rows = await query(ordered + ' LIMIT 500 OFFSET :offset', { offset });
                    for (const row of rows) {
                        if (!await writeCsv(res, csvLine([row.patientCode, row.patient, row.clinic, row.pharmacy, row.lastRxServiceDate || 'No dated RX', row.patientActive ? 'Active' : 'Inactive', row.serviceDate,
                            row.rxCount, row.rxCount ? 'RX exists' : 'Pending RX', row.serviceDateCount, row.pendingDateCount]))) return;
                    }
                    if (rows.length < 500) break;
                }
                res.end();
                return;
            }
            const [summary] = await query(`SELECT ${summaryColumns} FROM filtered`);
            const [available] = await query(`SELECT ${summaryColumns} FROM counted`);
            const totalPages = Math.max(1, Math.ceil(summary.total / filter.pageSize));
            const page = Math.min(filter.page, totalPages);
            const rows = await query(ordered + ' LIMIT :limit OFFSET :offset', { limit: filter.pageSize, offset: (page - 1) * filter.pageSize });
            res.json({ ...summary, available, rows, page, totalPages, pageSize: filter.pageSize,
                sort: filter.sort, direction: filter.direction, canExport: !!permission.canExport });
        });
    } catch (error) {
        if (res.headersSent) return res.destroy(error);
        res.status(error.status || 500).json({ error: error.status === 400 ? error.message : 'Unable to load service-date report.' });
    }
};
