const db = require('../models');
const Op = db.Sequelize.Op;
const QueryTypes = db.Sequelize.QueryTypes;

function cleanString(value) {
    return value === undefined || value === null ? '' : String(value).trim();
}

function parsePositiveInt(value, fallback, min, max) {
    const parsed = parseInt(value, 10);
    if (isNaN(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
}

function isDateOnly(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(cleanString(value));
}

function normalizeDir(value) {
    return cleanString(value).toLowerCase() === 'asc' ? 'asc' : 'desc';
}

function patientReportInclude() {
    return [db.PatientTransportCompany, db.PharmacyTransportCompany, db.Clinic];
}

function rxReportInclude() {
    return [
        db.Patient,
        db.Pharmacy,
        { model: db.RXWorkflowTracking, include: [db.WorkflowAction] }
    ];
}

function enrichRxReportRows(rows) {
    return rows.map(row => {
        const plain = row.toJSON ? row.toJSON() : row;
        plain.completedSteps = (plain.RXWorkflowTrackings || []).map(t => t.workflowActionId);
        return plain;
    });
}

function orderedRows(rows, ids) {
    const byId = new Map(rows.map(row => [row.id, row]));
    return ids.map(id => byId.get(id)).filter(Boolean);
}

function patientReportFilters(query, replacements) {
    const where = ['(p."isDeleted" = FALSE OR p."isDeleted" IS NULL)'];
    const status = cleanString(query.status);
    const patientCode = cleanString(query.patientCode).toLowerCase();
    const firstName = cleanString(query.firstName).toLowerCase();
    const lastName = cleanString(query.lastName).toLowerCase();
    const phone = cleanString(query.phone).toLowerCase();
    const transport = cleanString(query.transport).toLowerCase();
    const clinic = cleanString(query.clinic).toLowerCase();
    const dateFrom = isDateOnly(query.dateFrom) ? query.dateFrom : '';
    const dateTo = isDateOnly(query.dateTo) ? query.dateTo : '';

    if (status === 'true' || status === 'false') {
        replacements.status = status === 'true';
        where.push('p."isActive" = :status');
    }
    if (patientCode) {
        replacements.patientCode = `%${patientCode}%`;
        where.push('LOWER(COALESCE(p."patientCode", \'\')) LIKE :patientCode');
    }
    if (firstName) {
        replacements.firstName = `%${firstName}%`;
        where.push('LOWER(COALESCE(p."firstName", \'\')) LIKE :firstName');
    }
    if (lastName) {
        replacements.lastName = `%${lastName}%`;
        where.push('LOWER(COALESCE(p."lastName", \'\')) LIKE :lastName');
    }
    if (phone) {
        replacements.phone = `%${phone}%`;
        where.push('LOWER(COALESCE(p."phone", \'\')) LIKE :phone');
    }
    if (transport) {
        replacements.transport = `%${transport}%`;
        where.push(`(
            LOWER(COALESCE(pt."companyName", '')) LIKE :transport
            OR LOWER(COALESCE(pht."companyName", '')) LIKE :transport
        )`);
    }
    if (clinic) {
        replacements.clinic = `%${clinic}%`;
        where.push('LOWER(COALESCE(c."name", \'\')) LIKE :clinic');
    }
    if (dateFrom) {
        replacements.dateFrom = dateFrom;
        where.push('p."serviceDate" >= :dateFrom');
    }
    if (dateTo) {
        replacements.dateTo = dateTo;
        where.push('p."serviceDate" <= :dateTo');
    }
    return where;
}

function patientReportFromSql() {
    return `
        FROM "Patients" p
        LEFT JOIN "PatientTransportCompanies" pt ON pt.id = p."patientTransportCompanyId"
        LEFT JOIN "PharmacyTransportCompanies" pht ON pht.id = p."pharmacyTransportCompanyId"
        LEFT JOIN "Clinics" c ON c.id = p."clinicId"
    `;
}

function patientReportSortSql(sort) {
    const allowed = {
        patientCode: 'LOWER(COALESCE(p."patientCode", \'\'))',
        firstName: 'LOWER(COALESCE(p."firstName", \'\'))',
        lastName: 'LOWER(COALESCE(p."lastName", \'\'))',
        dob: 'p."dob"',
        phone: 'LOWER(COALESCE(p."phone", \'\'))',
        address: 'LOWER(COALESCE(p."address", \'\'))',
        serviceDate: 'p."serviceDate"',
        isActive: 'p."isActive"',
        'Clinic.name': 'LOWER(COALESCE(c."name", \'\'))',
        'PatientTransportCompany.companyName': 'LOWER(COALESCE(pt."companyName", \'\'))',
        'PharmacyTransportCompany.companyName': 'LOWER(COALESCE(pht."companyName", \'\'))',
        id: 'p.id'
    };
    return allowed[sort] || allowed.id;
}

async function getPaginatedPatientReport(query) {
    const pageSize = parsePositiveInt(query.pageSize, 10, 1, 500);
    const requestedPage = parsePositiveInt(query.page, 1, 1, 1000000);
    const sort = cleanString(query.sort) || 'id';
    const dir = normalizeDir(query.dir);
    const replacements = {};
    const where = patientReportFilters(query, replacements);
    const fromSql = patientReportFromSql();
    const whereClause = `WHERE ${where.join(' AND ')}`;
    const countRows = await db.sequelize.query(
        `SELECT COUNT(*)::integer AS total ${fromSql} ${whereClause}`,
        { type: QueryTypes.SELECT, replacements }
    );
    const total = parseInt(countRows[0] && countRows[0].total, 10) || 0;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(requestedPage, totalPages);
    const offset = query.exportAll === 'true' ? 0 : (page - 1) * pageSize;
    const limit = query.exportAll === 'true' ? Math.max(total, 1) : pageSize;
    const ids = total === 0 ? [] : (await db.sequelize.query(
        `SELECT p.id ${fromSql} ${whereClause}
         ORDER BY ${patientReportSortSql(sort)} ${dir === 'asc' ? 'ASC' : 'DESC'} NULLS LAST, p.id DESC
         LIMIT :limit OFFSET :offset`,
        { type: QueryTypes.SELECT, replacements: Object.assign({}, replacements, { limit, offset }) }
    )).map(row => row.id);
    const rows = ids.length
        ? orderedRows(await db.Patient.findAll({ where: { id: { [Op.in]: ids } }, include: patientReportInclude() }), ids)
        : [];
    return { rows, total, page, pageSize, totalPages, sort, dir };
}

function rxReportFilters(query, replacements, totalSteps) {
    const where = ['(r."isDeleted" = FALSE OR r."isDeleted" IS NULL)'];
    const rxId = cleanString(query.rxId || query.id);
    const firstName = cleanString(query.firstName).toLowerCase();
    const lastName = cleanString(query.lastName).toLowerCase();
    const patientCode = cleanString(query.patientCode).toLowerCase();
    const pharmacy = cleanString(query.pharmacy).toLowerCase();
    const progress = cleanString(query.progress);
    const dateFrom = isDateOnly(query.dateFrom) ? query.dateFrom : '';
    const dateTo = isDateOnly(query.dateTo) ? query.dateTo : '';
    const completedExpr = 'COALESCE(wc.completed_steps, 0)';
    replacements.totalSteps = totalSteps;

    if (rxId) {
        replacements.rxIdLike = `%${rxId}%`;
        where.push('CAST(r.id AS TEXT) LIKE :rxIdLike');
    }
    if (firstName) {
        replacements.firstName = `%${firstName}%`;
        where.push('LOWER(COALESCE(p."firstName", \'\')) LIKE :firstName');
    }
    if (lastName) {
        replacements.lastName = `%${lastName}%`;
        where.push('LOWER(COALESCE(p."lastName", \'\')) LIKE :lastName');
    }
    if (patientCode) {
        replacements.patientCode = `%${patientCode}%`;
        where.push('LOWER(COALESCE(p."patientCode", \'\')) LIKE :patientCode');
    }
    if (pharmacy) {
        replacements.pharmacy = `%${pharmacy}%`;
        where.push('LOWER(COALESCE(ph."name", \'\')) LIKE :pharmacy');
    }
    if (dateFrom) {
        replacements.dateFrom = dateFrom;
        where.push('r."serviceDate" >= :dateFrom');
    }
    if (dateTo) {
        replacements.dateTo = dateTo;
        where.push('r."serviceDate" <= :dateTo');
    }
    if (progress === 'complete') {
        where.push(':totalSteps > 0');
        where.push(`${completedExpr} >= :totalSteps`);
    } else if (progress === 'pending') {
        where.push(`${completedExpr} < :totalSteps`);
    }
    return where;
}

function rxReportFromSql() {
    return `
        FROM "RXRecords" r
        LEFT JOIN "Patients" p ON p.id = r."patientId"
        LEFT JOIN "Pharmacies" ph ON ph.id = r."pharmacyId"
        LEFT JOIN (
            SELECT "rxRecordId", COUNT(*)::integer AS completed_steps
            FROM "RXWorkflowTrackings"
            GROUP BY "rxRecordId"
        ) wc ON wc."rxRecordId" = r.id
    `;
}

function rxReportSortSql(sort) {
    const allowed = {
        id: 'r.id',
        'Patient.firstName': 'LOWER(COALESCE(p."firstName", \'\'))',
        'Patient.patientCode': 'LOWER(COALESCE(p."patientCode", \'\'))',
        'Pharmacy.name': 'LOWER(COALESCE(ph."name", \'\'))',
        serviceDate: 'r."serviceDate"'
    };
    return allowed[sort] || allowed.id;
}

async function getPaginatedRxReport(query) {
    const pageSize = parsePositiveInt(query.pageSize, 10, 1, 500);
    const requestedPage = parsePositiveInt(query.page, 1, 1, 1000000);
    const sort = cleanString(query.sort) || 'id';
    const dir = normalizeDir(query.dir);
    const totalSteps = await db.WorkflowAction.count({ where: { isActive: true } });
    const replacements = {};
    const where = rxReportFilters(query, replacements, totalSteps);
    const fromSql = rxReportFromSql();
    const whereClause = `WHERE ${where.join(' AND ')}`;
    const countRows = await db.sequelize.query(
        `SELECT COUNT(*)::integer AS total ${fromSql} ${whereClause}`,
        { type: QueryTypes.SELECT, replacements }
    );
    const total = parseInt(countRows[0] && countRows[0].total, 10) || 0;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(requestedPage, totalPages);
    const offset = query.exportAll === 'true' ? 0 : (page - 1) * pageSize;
    const limit = query.exportAll === 'true' ? Math.max(total, 1) : pageSize;
    const ids = total === 0 ? [] : (await db.sequelize.query(
        `SELECT r.id ${fromSql} ${whereClause}
         ORDER BY ${rxReportSortSql(sort)} ${dir === 'asc' ? 'ASC' : 'DESC'} NULLS LAST, r.id DESC
         LIMIT :limit OFFSET :offset`,
        { type: QueryTypes.SELECT, replacements: Object.assign({}, replacements, { limit, offset }) }
    )).map(row => row.id);
    const rows = ids.length
        ? orderedRows(enrichRxReportRows(await db.RXRecord.findAll({ where: { id: { [Op.in]: ids } }, include: rxReportInclude() })), ids)
        : [];
    return { rows, total, page, pageSize, totalPages, sort, dir };
}

exports.getPatientReport = async (req, res) => {
    try {
        if (req.query.paginated === 'true') {
            return res.json(await getPaginatedPatientReport(req.query));
        }
        // BUG-12 FIX: Exclude soft-deleted patients from reports
        const patients = await db.Patient.findAll({
            where: { [Op.or]: [{ isDeleted: false }, { isDeleted: null }] },
            include: patientReportInclude()
        });
        res.json(patients);
    } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.getRXReceiptReport = async (req, res) => {
    try {
        if (req.query.paginated === 'true') {
            return res.json(await getPaginatedRxReport(req.query));
        }
        const rxRecords = await db.RXRecord.findAll({
            where: { [Op.or]: [{ isDeleted: false }, { isDeleted: null }] },
            include: rxReportInclude()
        });
        res.json(enrichRxReportRows(rxRecords));
    } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.getRXActionReport = async (req, res) => {
    try {
        if (req.query.paginated === 'true') {
            return res.json(await getPaginatedRxReport(req.query));
        }
        const rxRecords = await db.RXRecord.findAll({
            where: { [Op.or]: [{ isDeleted: false }, { isDeleted: null }] },
            include: rxReportInclude()
        });
        res.json(enrichRxReportRows(rxRecords));
    } catch (err) { res.status(500).json({ error: err.message }); }
};
