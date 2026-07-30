const db = require('../models');
const { parseDate, parseLocalDateOnly, localDayBoundaryIso } = require('../utils/dateUtils');
const { isServiceDateOverrideEnabled, getServiceWindowDays } = require('../utils/globalSettings');
const { userCanOverrideExpired, getRequestPermission } = require('../middleware/rbac');
const { activeRxWorkflowAggregateSql } = require('../utils/rxWorkflowAggregateSql');
const {
    dateOnly,
    ensureCycleForRx,
    serviceDateMatches
} = require('../services/patientServiceDateCycleService');

const Op = db.Sequelize.Op;

// ---- helper: save a history snapshot ----
async function saveHistory(rxId, userId, changeType, snapshot, changedFields, note, transaction) {
    try {
        const opts = transaction ? { transaction } : {};
        await db.RXHistory.create({
            rxRecordId:    rxId,
            userId:        userId || null,
            changeType,
            snapshot:      JSON.stringify(snapshot),
            changedFields: changedFields ? JSON.stringify(changedFields) : null,
            note:          note || null
        }, opts);
    } catch (e) { /* never break main operation */ }
}

// ---- diff two plain objects for tracked fields ----
function diffObjects(before, after, fields) {
    const changes = [];
    for (const f of fields) {
        const bv = before[f] !== undefined ? before[f] : null;
        const av = after[f]  !== undefined ? after[f]  : null;
        if (String(bv) !== String(av)) changes.push({ field: f, from: bv, to: av });
    }
    return changes;
}

const TRACK_FIELDS = ['patientId','patientServiceDateCycleId','pharmacyId','patientTransportCompanyId',
                      'pharmacyTransportCompanyId','arrivalDate','serviceDate'];

function getRxCycleServiceDate(rx) {
    return rx && (
        (rx.PatientServiceDateCycle && rx.PatientServiceDateCycle.serviceDate) ||
        rx.serviceDate ||
        (rx.Patient && rx.Patient.serviceDate) ||
        null
    );
}

function getWorkflowWindowBlock(rx) {
    const serviceDate = dateOnly(getRxCycleServiceDate(rx));
    if (!serviceDate) {
        return {
            error: 'This RX has no Service Date. Set the patient Service Date and create a new RX record before adding workflow steps.',
            code: 'RX_SERVICE_DATE_REQUIRED'
        };
    }

    const svcDay = new Date(serviceDate);
    if (isNaN(svcDay.getTime())) {
        return {
            error: 'This RX has an invalid Service Date. Correct the service date before adding workflow steps.',
            code: 'RX_SERVICE_DATE_INVALID'
        };
    }

    svcDay.setHours(0, 0, 0, 0);
    const expiryDay = new Date(svcDay);
    expiryDay.setDate(expiryDay.getDate() + getServiceWindowDays());
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (today > expiryDay) {
        return {
            error: `The ${getServiceWindowDays()}-day window for this RX expired on ${expiryDay.toLocaleDateString()}. Start a new patient Service Date and create a new RX record for the new cycle.`,
            code: 'RX_WORKFLOW_WINDOW_EXPIRED',
            serviceDate,
            windowExpiry: expiryDay.toISOString().slice(0, 10)
        };
    }

    return null;
}

function cleanString(value) {
    return value === undefined || value === null ? '' : String(value).trim();
}

function parseSelectedIds(value) {
    return Array.from(new Set(String(value || '').split(',')
        .map(function (item) { return parseInt(item, 10); })
        .filter(function (item) { return Number.isInteger(item) && item > 0; })));
}

function parseSelectedIds(value) {
    return Array.from(new Set(String(value || '').split(',')
        .map(function (item) { return parseInt(item, 10); })
        .filter(function (item) { return Number.isInteger(item) && item > 0; })));
}

function parsePositiveInt(value, fallback, min, max) {
    const parsed = parseInt(value, 10);
    if (isNaN(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
}

function isDateOnly(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(cleanString(value));
}

function maxDateOnly(values) {
    const dates = values.filter(isDateOnly).sort();
    return dates.length ? dates[dates.length - 1] : '';
}

function minDateOnly(values) {
    const dates = values.filter(isDateOnly).sort();
    return dates.length ? dates[0] : '';
}

function rxInclude() {
    return [
        { model: db.Patient },
        { model: db.PatientServiceDateCycle },
        { model: db.Pharmacy },
        { model: db.PatientTransportCompany },
        { model: db.PharmacyTransportCompany },
        { model: db.Medication },
        { model: db.RXWorkflowTracking }
    ];
}

function enrichRxRows(data, activeActionIds) {
    return data.map(rx => {
        const plain = rx.toJSON();
        plain.completedSteps = Array.from(new Set(
            (plain.RXWorkflowTrackings || [])
                .map(tracking => Number(tracking.workflowActionId))
                .filter(actionId => Number.isInteger(actionId) && activeActionIds.has(actionId))
        ));
        return plain;
    });
}

async function getActiveWorkflowActionIds() {
    const rows = await db.WorkflowAction.findAll({
        attributes: ['id'],
        where: { isActive: true },
        raw: true
    });
    return new Set(rows.map(row => Number(row.id)).filter(Number.isInteger));
}

function buildRxWhere(query) {
    const showDeleted = query.deleted === 'true' || query.includeDeleted === 'true';
    const where = showDeleted ? { isDeleted: true } : { [Op.or]: [{ isDeleted: false }, { isDeleted: null }] };
    const rxId = cleanString(query.id);
    const pharmacyIds = parseSelectedIds(query.pharmacyIds || query.pharmacyId);
    const clinicIds = parseSelectedIds(query.clinicIds);
    const patientId = cleanString(query.patientId);
    const patientTransportId = cleanString(query.patientTransportId);
    const pharmacyTransportId = cleanString(query.pharmacyTransportId);
    const warehouseStatus = cleanString(query.warehouseStatus);
    const from = maxDateOnly([query.dateFrom, query.serviceFrom]);
    const to = minDateOnly([query.dateTo, query.serviceTo]);

    if (/^\d+$/.test(rxId)) where.id = parseInt(rxId, 10);
    if (pharmacyIds.length) where.pharmacyId = pharmacyIds.length === 1 ? pharmacyIds[0] : { [Op.in]: pharmacyIds };
    if (clinicIds.length) where['$Patient.clinicId$'] = { [Op.in]: clinicIds };
    if (/^\d+$/.test(patientId)) where.patientId = parseInt(patientId, 10);
    if (/^\d+$/.test(patientTransportId)) where.patientTransportCompanyId = parseInt(patientTransportId, 10);
    if (/^\d+$/.test(pharmacyTransportId)) where.pharmacyTransportCompanyId = parseInt(pharmacyTransportId, 10);
    if (warehouseStatus === 'returned') where.returnedToWarehouse = true;
    if (warehouseStatus === 'not-returned') {
        where[Op.and] = (where[Op.and] || []).concat({
            [Op.or]: [{ returnedToWarehouse: false }, { returnedToWarehouse: null }]
        });
    }
    if (from || to) {
        where.serviceDate = {};
        if (from) where.serviceDate[Op.gte] = from;
        if (to) where.serviceDate[Op.lte] = to;
    }
    return where;
}

function addRxPageFilters(query, replacements, totalSteps) {
    const whereSql = [];
    const showDeleted = query.deleted === 'true' || query.includeDeleted === 'true';
    const rxId = cleanString(query.id);
    const patient = cleanString(query.patient).toLowerCase();
    const patientCode = cleanString(query.patientCode).toLowerCase();
    const patientId = cleanString(query.patientId);
    const pharmacyIds = parseSelectedIds(query.pharmacyIds || query.pharmacyId);
    const clinicIds = parseSelectedIds(query.clinicIds);
    const patientTransportId = cleanString(query.patientTransportId);
    const pharmacyTransportId = cleanString(query.pharmacyTransportId);
    const warehouseStatus = cleanString(query.warehouseStatus);
    const workflowStatus = cleanString(query.workflowStatus);
    const workflowStage = cleanString(query.workflowStage);
    const currentWorkflowStage = cleanString(query.currentWorkflowStage);
    const deliveryOutcome = cleanString(query.deliveryOutcome);
    const currentStageDateFrom = localDayBoundaryIso(query.currentStageDateFrom, 0);
    const currentStageDateToExclusive = localDayBoundaryIso(query.currentStageDateTo, 1);
    const from = maxDateOnly([query.dateFrom, query.serviceFrom]);
    const to = minDateOnly([query.dateTo, query.serviceTo]);
    const completedExpr = 'COALESCE(wc.completed_steps, 0)';
    const expiredExpr = `(r."serviceDate" IS NOT NULL AND (r."serviceDate"::date + INTERVAL '${getServiceWindowDays()} days')::date < CURRENT_DATE AND ${completedExpr} < :totalSteps)`;
    const completedExprSql = `(:totalSteps > 0 AND ${completedExpr} >= :totalSteps)`;

    replacements.totalSteps = totalSteps;
    whereSql.push(showDeleted ? 'r."isDeleted" = TRUE' : '(r."isDeleted" = FALSE OR r."isDeleted" IS NULL)');

    if (/^\d+$/.test(rxId)) {
        replacements.rxId = parseInt(rxId, 10);
        whereSql.push('r.id = :rxId');
    }
    if (/^\d+$/.test(patientId)) {
        replacements.patientId = parseInt(patientId, 10);
        whereSql.push('r."patientId" = :patientId');
    }
    if (pharmacyIds.length) {
        replacements.pharmacyIds = pharmacyIds;
        whereSql.push('r."pharmacyId" IN (:pharmacyIds)');
    }
    if (clinicIds.length) {
        replacements.clinicIds = clinicIds;
        whereSql.push('p."clinicId" IN (:clinicIds)');
    }
    if (/^\d+$/.test(patientTransportId)) {
        replacements.patientTransportId = parseInt(patientTransportId, 10);
        whereSql.push('r."patientTransportCompanyId" = :patientTransportId');
    }
    if (/^\d+$/.test(pharmacyTransportId)) {
        replacements.pharmacyTransportId = parseInt(pharmacyTransportId, 10);
        whereSql.push('r."pharmacyTransportCompanyId" = :pharmacyTransportId');
    }
    if (warehouseStatus === 'returned') {
        whereSql.push('r."returnedToWarehouse" = TRUE');
    } else if (warehouseStatus === 'not-returned') {
        whereSql.push('(r."returnedToWarehouse" = FALSE OR r."returnedToWarehouse" IS NULL)');
    }
    if (from) {
        replacements.serviceFrom = from;
        whereSql.push('r."serviceDate" >= :serviceFrom');
    }
    if (to) {
        replacements.serviceTo = to;
        whereSql.push('r."serviceDate" <= :serviceTo');
    }
    if (patient) {
        replacements.patientLike = `%${patient}%`;
        whereSql.push(`(
            LOWER(COALESCE(p."firstName", '') || ' ' || COALESCE(p."lastName", '')) LIKE :patientLike
            OR LOWER(COALESCE(p."patientCode", '')) LIKE :patientLike
        )`);
    }
    if (patientCode) {
        replacements.patientCodeLike = `%${patientCode}%`;
        whereSql.push('LOWER(COALESCE(p."patientCode", \'\')) LIKE :patientCodeLike');
    }

    if (workflowStatus === 'incomplete') {
        // Dashboard Pending card: every incomplete RX, including expired cycles.
        whereSql.push(`NOT ${completedExprSql}`);
    } else if (workflowStatus === 'pending') {
        // Operational Pending status excludes the separately labeled Expired status.
        whereSql.push(`NOT ${completedExprSql}`);
        whereSql.push(`NOT ${expiredExpr}`);
    } else if (workflowStatus === 'expired') {
        whereSql.push(expiredExpr);
    } else if (workflowStatus === 'completed') {
        whereSql.push(completedExprSql);
    } else if (workflowStatus === 'in-progress') {
        whereSql.push(`${completedExpr} > 0`);
        whereSql.push(`NOT ${completedExprSql}`);
        whereSql.push(`NOT ${expiredExpr}`);
    } else if (workflowStatus === 'not-started') {
        whereSql.push(`${completedExpr} = 0`);
        whereSql.push(`NOT ${expiredExpr}`);
    }

    if (/^\d+$/.test(workflowStage)) {
        replacements.workflowStageDone = parseInt(workflowStage, 10) - 1;
        whereSql.push(`${completedExpr} = :workflowStageDone`);
    }
    if (currentWorkflowStage === 'returned_to_pharmacy' || deliveryOutcome === 'returned_to_pharmacy') {
        whereSql.push('r."deliveryOutcome" = \'returned_to_pharmacy\'');
    } else if (/^\d+$/.test(currentWorkflowStage)) {
        replacements.currentWorkflowStage = parseInt(currentWorkflowStage, 10);
        whereSql.push('wc.current_stage_sequence = :currentWorkflowStage');
    }
    if (currentStageDateFrom) {
        replacements.currentStageDateFrom = currentStageDateFrom;
        whereSql.push('wc.current_stage_at >= CAST(:currentStageDateFrom AS TIMESTAMPTZ)');
    }
    if (currentStageDateToExclusive) {
        replacements.currentStageDateToExclusive = currentStageDateToExclusive;
        whereSql.push('wc.current_stage_at < CAST(:currentStageDateToExclusive AS TIMESTAMPTZ)');
    }

    return whereSql;
}

function rxPageFromSql() {
    return `
        FROM "RXRecords" r
        LEFT JOIN "Patients" p ON p.id = r."patientId"
        LEFT JOIN "Pharmacies" ph ON ph.id = r."pharmacyId"
        LEFT JOIN (
            ${activeRxWorkflowAggregateSql()}
        ) wc ON wc."rxRecordId" = r.id
    `;
}

function rxPageSortSql(sort) {
    const completedExpr = 'COALESCE(wc.completed_steps, 0)';
    const workflowSort = `
        CASE
            WHEN r."serviceDate" IS NOT NULL
             AND (r."serviceDate"::date + INTERVAL '${getServiceWindowDays()} days')::date < CURRENT_DATE
             AND ${completedExpr} < :totalSteps
                THEN 1000 + ${completedExpr}
            WHEN :totalSteps > 0 AND ${completedExpr} >= :totalSteps
                THEN :totalSteps + 100
            ELSE ${completedExpr}
        END
    `;
    const allowed = {
        id: 'r.id',
        'Patient.firstName': `LOWER(COALESCE(p."firstName", '') || ' ' || COALESCE(p."lastName", ''))`,
        serviceDate: 'r."serviceDate"',
        nextSvcDate: `(r."serviceDate"::date + INTERVAL '${getServiceWindowDays()} days')`,
        cycleStatus: `(r."serviceDate"::date + INTERVAL '${getServiceWindowDays()} days')`,
        'Pharmacy.name': 'LOWER(COALESCE(ph."name", \'\'))',
        workflowStatus: workflowSort
    };
    return allowed[sort] || allowed.id;
}

async function getPaginatedRxRecords(query) {
    const pageSize = parsePositiveInt(query.pageSize, 10, 1, 500);
    const requestedPage = parsePositiveInt(query.page, 1, 1, 1000000);
    const sort = cleanString(query.sort) || 'id';
    const dir = cleanString(query.dir).toLowerCase() === 'asc' ? 'asc' : 'desc';
    const activeActionIds = await getActiveWorkflowActionIds();
    const totalWorkflowSteps = activeActionIds.size;
    const replacements = {};
    const whereSql = addRxPageFilters(query, replacements, totalWorkflowSteps);
    const fromSql = rxPageFromSql();
    const whereClause = whereSql.length ? `WHERE ${whereSql.join(' AND ')}` : '';
    const sortSql = rxPageSortSql(sort);
    const dirSql = dir === 'asc' ? 'ASC' : 'DESC';
    const countRows = await db.sequelize.query(
        `SELECT COUNT(*)::integer AS total ${fromSql} ${whereClause}`,
        { type: db.Sequelize.QueryTypes.SELECT, replacements }
    );
    const total = parseInt(countRows[0] && countRows[0].total, 10) || 0;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(requestedPage, totalPages);
    const offset = (safePage - 1) * pageSize;
    const pageLimit = query.exportAll === 'true' ? Math.max(total, 1) : pageSize;
    const pageOffset = query.exportAll === 'true' ? 0 : offset;
    const pageReplacements = Object.assign({}, replacements, {
        limit: pageLimit,
        offset: pageOffset
    });
    const idRows = total === 0 ? [] : await db.sequelize.query(
        `SELECT r.id, wc.current_stage_at AS "currentStageDate" ${fromSql} ${whereClause}
         ORDER BY ${sortSql} ${dirSql} NULLS LAST, r.id DESC
         LIMIT :limit OFFSET :offset`,
        { type: db.Sequelize.QueryTypes.SELECT, replacements: pageReplacements }
    );
    const ids = idRows.map(row => row.id);
    const currentStageDateById = new Map(
        idRows.map(row => [Number(row.id), row.currentStageDate || null])
    );
    let rows = [];
    if (ids.length) {
        const data = await db.RXRecord.findAll({
            where: { id: { [Op.in]: ids } },
            include: rxInclude()
        });
        const byId = new Map(enrichRxRows(data, activeActionIds).map(row => [row.id, row]));
        rows = ids.map(id => byId.get(id)).filter(Boolean).map(row => ({
            ...row,
            currentStageDate: currentStageDateById.get(Number(row.id)) || null
        }));
    }

    return {
        rows,
        total,
        page: safePage,
        pageSize,
        totalPages,
        sort,
        dir
    };
}

// GET /api/rx-records
exports.getAll = async (req, res) => {
    try {
        if (req.query.paginated === 'true') {
            return res.json(await getPaginatedRxRecords(req.query));
        }

        const where = buildRxWhere(req.query);
        const data = await db.RXRecord.findAll({
            where,
            include: rxInclude(),
            order: [['id', 'DESC']]
        });
        const activeActionIds = await getActiveWorkflowActionIds();
        const result = enrichRxRows(data, activeActionIds);

        res.json(result);
    } catch (err) { res.status(500).json({ error: err.message }); }
};

// GET /api/rx-records/:id
exports.getOne = async (req, res) => {
    try {
        const data = await db.RXRecord.findByPk(req.params.id, {
            include: [db.Patient, db.PatientServiceDateCycle, db.Pharmacy, db.Medication, db.RXWorkflowTracking]
        });
        if (!data) return res.status(404).json({ message: 'Not found' });
        const activeActionIds = await getActiveWorkflowActionIds();
        res.json(enrichRxRows([data], activeActionIds)[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
};

// POST /api/rx-records
exports.create = async (req, res) => {
    const transaction = await db.sequelize.transaction();
    try {
        const { medications, ...rxData } = req.body;
        let { arrivalDate, serviceDate } = rxData;

        // Normalise dates: accept MM/DD/YYYY or YYYY-MM-DD
        arrivalDate = parseDate(arrivalDate);
        serviceDate = parseDate(serviceDate);
        rxData.arrivalDate = arrivalDate;
        rxData.serviceDate = serviceDate;

        const arrivalDay = arrivalDate ? new Date(arrivalDate) : null;
        const serviceDay = serviceDate ? new Date(serviceDate) : null;

        // LOGIC-01 FIX: Reject NaN/invalid dates before comparison
        if (!arrivalDate || !serviceDate || !arrivalDay || !serviceDay || isNaN(arrivalDay.getTime()) || isNaN(serviceDay.getTime())) {
            await transaction.rollback();
            return res.status(400).json({ error: 'Arrival date and Service Date are required and must be valid dates (MM/DD/YYYY).' });
        }

        const limitDate = new Date(serviceDay);
        limitDate.setDate(limitDate.getDate() - getServiceWindowDays());

        if (arrivalDay > serviceDay || arrivalDay < limitDate) {
            await transaction.rollback();
            return res.status(400).json({ error: `Arrival date must be within ${getServiceWindowDays()} days prior to Service Date.` });
        }

        // â”€â”€ 90-DAY ELIGIBILITY CHECK â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        // The 90-day window is owned by the PATIENT record's serviceDate field.
        // That is the canonical clock. We check it directly here rather than
        // looking at the latest RX record's serviceDate, so that the Patient
        // record is the single source of truth for cycle management.
        // bypassEligibility=true allows admins to override (e.g. corrections).
        if (rxData.patientId && !req.body.bypassEligibility) {
            const patient = await db.Patient.findByPk(rxData.patientId);

            // â”€â”€ INACTIVE PATIENT GUARD â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
            // Inactive patients cannot receive new RX records under any circumstance.
            if (patient && patient.isActive === false) {
                await transaction.rollback();
                return res.status(400).json({
                    error: `Cannot create an RX record for an inactive patient (${patient.firstName} ${patient.lastName}). Re-activate the patient first before adding new services.`,
                    code: 'PATIENT_INACTIVE'
                });
            }
            // â”€â”€ END INACTIVE GUARD â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

        }
        // â”€â”€ END ELIGIBILITY CHECK â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

        // New RX records belong to the patient's active service-date cycle.
        // Older service dates stay available for review/history, not normal creation.
        if (rxData.patientId) {
            const patient = await db.Patient.findByPk(rxData.patientId, { transaction });
            if (!patient) {
                await transaction.rollback();
                return res.status(400).json({ error: 'Patient not found.', code: 'PATIENT_NOT_FOUND' });
            }

            if (patient.isActive === false) {
                await transaction.rollback();
                return res.status(400).json({
                    error: `Cannot create an RX record for an inactive patient (${patient.firstName} ${patient.lastName}). Re-activate the patient first before adding new services.`,
                    code: 'PATIENT_INACTIVE'
                });
            }

            const rxPerm = await getRequestPermission(req, 'rx_records');
            const canOverrideExpired = isServiceDateOverrideEnabled() || !!(rxPerm.visible && rxPerm.canOverrideExpired);
            const bypassRequested = req.body.bypassEligibility === true || req.body.bypassEligibility === 'true';
            const bypassAllowed = bypassRequested && canOverrideExpired;
            const activeServiceDate = dateOnly(patient.serviceDate);

            if (!activeServiceDate && !bypassAllowed) {
                await transaction.rollback();
                return res.status(400).json({
                    error: 'This patient has no active Service Date. Set the patient Service Date before creating an RX record.',
                    code: 'PATIENT_SERVICE_DATE_REQUIRED'
                });
            }

            if (!bypassAllowed && !serviceDateMatches(serviceDate, activeServiceDate)) {
                await transaction.rollback();
                return res.status(400).json({
                    error: 'New RX records must use the patient active Service Date. Older service dates are available for review only.',
                    code: 'RX_SERVICE_DATE_NOT_ACTIVE'
                });
            }

            const cycleDate = bypassAllowed ? serviceDate : activeServiceDate;
            const cycleStart = new Date(cycleDate);
            cycleStart.setHours(0, 0, 0, 0);
            const cycleExpiry = new Date(cycleStart);
            cycleExpiry.setDate(cycleExpiry.getDate() + getServiceWindowDays());
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            if (!bypassAllowed && today > cycleExpiry) {
                await transaction.rollback();
                return res.status(400).json({
                    error: `The active Service Date expired on ${cycleExpiry.toLocaleDateString()}. Start a new patient Service Date before creating a new RX record.`,
                    code: 'PATIENT_SERVICE_DATE_EXPIRED',
                    serviceDate: activeServiceDate,
                    windowExpiry: cycleExpiry.toISOString().slice(0, 10)
                });
            }

            serviceDate = cycleDate;
            arrivalDate = serviceDate;
            rxData.serviceDate = serviceDate;
            rxData.arrivalDate = arrivalDate;
            const cycle = await ensureCycleForRx(patient, serviceDate, {
                transaction,
                userId: req.user?.id || null,
                source: 'RX Create'
            });
            if (cycle) rxData.patientServiceDateCycleId = cycle.id;
        }

        const rx = await db.RXRecord.create({ ...rxData, arrivalDate, serviceDate }, { transaction });

        if (medications && medications.length > 0) {
            const meds = medications.map(m => ({ ...m, rxRecordId: rx.id }));
            await db.Medication.bulkCreate(meds, { transaction });
        }

        // Auto-complete Step 1 (RX received warehouse) on creation
        const step1 = await db.WorkflowAction.findOne({
            where: { sequenceNumber: 1 },
            order: [['sequenceNumber', 'ASC']],
            transaction
        });
        if (step1) {
            await db.RXWorkflowTracking.create({
                rxRecordId:       rx.id,
                workflowActionId: step1.id,
                completionDate:   new Date(),
                userId:           req.user?.id || null
            }, { transaction });
        }

        await saveHistory(rx.id, req.user?.id, 'Create', rx.toJSON(), null,
            `Record created${step1 ? ' â€” auto-completed: ' + step1.name : ''}`, transaction);

        await transaction.commit();
        res.status(201).json(rx);
    } catch (err) {
        await transaction.rollback();
        res.status(400).json({ error: err.message });
    }
};

// POST /api/rx-records/workflow
exports.updateWorkflow = async (req, res) => {
    try {
        const { rxId, actionId } = req.body;
        const rx = await db.RXRecord.findByPk(rxId, { include: [db.PatientServiceDateCycle, db.Patient] });
        if (!rx) return res.status(404).json({ error: 'RX not found' });

        const windowBlock = getWorkflowWindowBlock(rx);
        if (windowBlock) return res.status(400).json(windowBlock);

        const action = await db.WorkflowAction.findByPk(actionId);
        if (!action) return res.status(404).json({ error: 'Action not found' });

        if (action.sequenceNumber > 1) {
            const prevAction = await db.WorkflowAction.findOne({ where: { sequenceNumber: action.sequenceNumber - 1 } });
            if (prevAction) {
                const prevCompleted = await db.RXWorkflowTracking.findOne({
                    where: { rxRecordId: rxId, workflowActionId: prevAction.id }
                });
                if (!prevCompleted) {
                    return res.status(400).json({ error: `Must complete '${prevAction.name}' before '${action.name}'.` });
                }
            }
        }

        const tracking = await db.RXWorkflowTracking.create({
            rxRecordId: rxId,
            workflowActionId: actionId,
            completionDate: new Date(),
            userId: req.user.id
        });

        // Preserve a patient-refused delivery outcome through later receipt/log steps.
        // Legacy warehouse returns still clear when the RX starts moving again before the delivery step.
        var deliveryAction = (await db.WorkflowAction.findAll({ attributes: ['name', 'sequenceNumber', 'deliveryOutcomeMode'] })).find(function (item) {
            return item.deliveryOutcomeMode === 'delivered_or_returned';
        });
        var isPostDeliveryStep = deliveryAction && action.sequenceNumber > deliveryAction.sequenceNumber;
        if (rx.returnedToWarehouse && action.sequenceNumber > 1 && !isPostDeliveryStep) {
            await rx.update({
                returnedToWarehouse: false,
                warehouseReturnDate: null,
                warehouseReturnNote: null
            });
        }

        await saveHistory(rxId, req.user?.id, 'Workflow', rx.toJSON(), null, `Step completed: ${action.name}`);

        res.json(tracking);
    } catch (err) { res.status(400).json({ error: err.message }); }
};

// POST /api/rx-records/bulk-workflow  (FEAT-10)
// Body: { rxIds: [1,2,3], actionId: 5 }
// Processes each record independently â€” partial success allowed.
exports.bulkWorkflow = async (req, res) => {
    try {
        const { rxIds, actionId } = req.body;

        if (!Array.isArray(rxIds) || rxIds.length === 0) {
            return res.status(400).json({ error: 'rxIds must be a non-empty array.' });
        }
        if (!actionId) {
            return res.status(400).json({ error: 'actionId is required.' });
        }
        // Cap at 200 records per batch to prevent abuse
        if (rxIds.length > 200) {
            return res.status(400).json({ error: 'Maximum 200 records per bulk operation.' });
        }

        const action = await db.WorkflowAction.findByPk(actionId);
        if (!action) return res.status(404).json({ error: 'Workflow action not found.' });

        // Pre-fetch previous step (needed for sequence guard)
        let prevAction = null;
        if (action.sequenceNumber > 1) {
            prevAction = await db.WorkflowAction.findOne({
                where: { sequenceNumber: action.sequenceNumber - 1 }
            });
        }

        var results = [];
        var succeeded = 0;
        var failed = 0;

        for (var i = 0; i < rxIds.length; i++) {
            var rxId = parseInt(rxIds[i], 10);
            if (isNaN(rxId)) {
                results.push({ rxId: rxIds[i], ok: false, error: 'Invalid ID.' });
                failed++;
                continue;
            }

            try {
                var rx = await db.RXRecord.findByPk(rxId, { include: [db.PatientServiceDateCycle, db.Patient] });
                if (!rx) {
                    results.push({ rxId: rxId, ok: false, error: 'Record not found.' });
                    failed++;
                    continue;
                }
                if (rx.isDeleted) {
                    results.push({ rxId: rxId, ok: false, error: 'Record is hidden.' });
                    failed++;
                    continue;
                }
                var windowBlock = getWorkflowWindowBlock(rx);
                if (windowBlock) {
                    results.push({
                        rxId: rxId,
                        ok: false,
                        code: windowBlock.code,
                        error: windowBlock.error
                    });
                    failed++;
                    continue;
                }

                // Sequence guard â€” same logic as updateWorkflow
                if (prevAction) {
                    var prevCompleted = await db.RXWorkflowTracking.findOne({
                        where: { rxRecordId: rxId, workflowActionId: prevAction.id }
                    });
                    if (!prevCompleted) {
                        results.push({
                            rxId: rxId,
                            ok: false,
                            error: 'Step \'' + prevAction.name + '\' not yet completed.'
                        });
                        failed++;
                        continue;
                    }
                }

                // Skip if already completed (idempotent)
                var alreadyDone = await db.RXWorkflowTracking.findOne({
                    where: { rxRecordId: rxId, workflowActionId: actionId }
                });
                if (alreadyDone) {
                    results.push({ rxId: rxId, ok: true, skipped: true, note: 'Already completed.' });
                    succeeded++;
                    continue;
                }

                await db.RXWorkflowTracking.create({
                    rxRecordId:      rxId,
                    workflowActionId: actionId,
                    completionDate:  new Date(),
                    userId:          req.user.id
                });

                // Clear warehouse flag if applicable
                if (rx.returnedToWarehouse && action.sequenceNumber > 1) {
                    await rx.update({
                        returnedToWarehouse: false,
                        warehouseReturnDate: null,
                        warehouseReturnNote: null
                    });
                }

                await saveHistory(rxId, req.user.id, 'Workflow', rx.toJSON(), null,
                    'Bulk step completed: ' + action.name);

                var patientLabel = '';
                try {
                    var fullRx = await db.RXRecord.findByPk(rxId, { include: [db.Patient] });
                    if (fullRx && fullRx.Patient) {
                        patientLabel = fullRx.Patient.firstName + ' ' + fullRx.Patient.lastName;
                    }
                } catch(e) { /* non-critical */ }

                results.push({ rxId: rxId, ok: true, patientName: patientLabel });
                succeeded++;

            } catch (rowErr) {
                results.push({ rxId: rxId, ok: false, error: rowErr.message || 'Unknown error.' });
                failed++;
            }
        }

        res.json({
            results:   results,
            succeeded: succeeded,
            failed:    failed,
            action:    { id: action.id, name: action.name }
        });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// PUT /api/rx-records/workflow-date  (FEAT-11: Step date override)
// Body: { trackingId, newDate }  â€” newDate format: YYYY-MM-DD or ISO string
exports.updateWorkflowDate = async (req, res) => {
    try {
        const { trackingId, newDate } = req.body;
        if (!trackingId) return res.status(400).json({ error: 'trackingId is required.' });
        if (!newDate)    return res.status(400).json({ error: 'newDate is required.' });

        const requestedDate = cleanString(newDate);
        if (!isDateOnly(requestedDate)) {
            return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
        }

        // JavaScript parses a bare YYYY-MM-DD at midnight UTC, which is the
        // previous calendar day in US time zones. This is a date-only field, so
        // local noon safely preserves the day selected in the workflow picker.
        const parsed = parseLocalDateOnly(requestedDate);
        if (!parsed) {
            return res.status(400).json({ error: 'Invalid date.' });
        }

        // Prevent future dates
        const now = new Date();
        now.setHours(23, 59, 59, 999); // allow same-day
        if (parsed > now) return res.status(400).json({ error: 'Completion date cannot be in the future.' });

        const tracking = await db.RXWorkflowTracking.findByPk(trackingId, {
            include: [{ model: db.WorkflowAction }, { model: db.RXRecord, include: [db.Patient] }]
        });
        if (!tracking) return res.status(404).json({ error: 'Workflow tracking record not found.' });

        const rx     = tracking.RXRecord;
        const action = tracking.WorkflowAction;
        if (!rx)     return res.status(404).json({ error: 'Associated RX record not found.' });
        if (!action) return res.status(404).json({ error: 'Associated workflow action not found.' });

        // â”€â”€ Sequential date guard â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        // Fetch all other trackings for this RX with their workflow actions
        const allTrackings = await db.RXWorkflowTracking.findAll({
            where: { rxRecordId: rx.id },
            include: [{ model: db.WorkflowAction }],
            order: [[db.WorkflowAction, 'sequenceNumber', 'ASC'], [db.WorkflowAction, 'id', 'ASC']]
        });

        // Build ordered list: [{seq, name, date}]
        const ordered = allTrackings
            .filter(t => t.WorkflowAction)
            .map(t => ({
                seq:  t.WorkflowAction.sequenceNumber,
                name: t.WorkflowAction.name,
                date: t.completionDate ? new Date(t.completionDate) : null,
                id:   t.id
            }))
            .sort((a, b) => a.seq - b.seq);

        const thisSeq = action.sequenceNumber;

        // Previous step (lower sequence number)
        const prev = ordered.filter(t => t.seq < thisSeq).pop();
        if (prev && prev.date) {
            const prevDay = new Date(prev.date); prevDay.setHours(0, 0, 0, 0);
            const newDay  = new Date(parsed);    newDay.setHours(0, 0, 0, 0);
            if (newDay < prevDay) {
                return res.status(400).json({
                    error: `Date cannot be before "${prev.name}" (${prev.date.toLocaleDateString()}). Steps must follow chronological order.`
                });
            }
        }

        // Next step (higher sequence number, skip the current tracking being edited)
        const next = ordered.find(t => t.seq > thisSeq);
        if (next && next.date) {
            const nextDay = new Date(next.date); nextDay.setHours(0, 0, 0, 0);
            const newDay  = new Date(parsed);    newDay.setHours(0, 0, 0, 0);
            if (newDay > nextDay) {
                return res.status(400).json({
                    error: `Date cannot be after "${next.name}" (${next.date.toLocaleDateString()}). Steps must follow chronological order.`
                });
            }
        }
        const rxPerm = await getRequestPermission(req, 'rx_records');
        const canEditWorkflowDate = !!(rxPerm.visible && rxPerm.canEdit);
        const canOverrideExpired = isServiceDateOverrideEnabled() || !!(rxPerm.visible && rxPerm.canOverrideExpired);
        if (!canEditWorkflowDate && !canOverrideExpired) {
            return res.status(403).json({ error: 'Access denied: you cannot edit workflow dates or override expired RX locks.' });
        }

        // â”€â”€ Step 1: must be >= serviceDate; all steps: must be <= serviceDate + 90 days â”€â”€
        const cycleServiceDate = getRxCycleServiceDate(rx);
        if (cycleServiceDate) {
            const svcDay    = new Date(cycleServiceDate); svcDay.setHours(0,0,0,0);
            const expiryDay = new Date(svcDay); expiryDay.setDate(expiryDay.getDate() + getServiceWindowDays());
            const newDay    = new Date(parsed); newDay.setHours(0,0,0,0);
            const todayDay  = new Date(); todayDay.setHours(0,0,0,0);

            // All steps must be within the 90-day active window
            if (!canOverrideExpired && newDay > expiryDay) {
                return res.status(400).json({
                    code: 'RX_WORKFLOW_DATE_WINDOW_LOCKED',
                    windowExpiry: expiryDay.toISOString().slice(0, 10),
                    error: `Date must be within ${getServiceWindowDays()} days of service date (${svcDay.toLocaleDateString()} â€“ ${expiryDay.toLocaleDateString()}).`
                });
            }
            if (!canEditWorkflowDate && canOverrideExpired && todayDay <= expiryDay) {
                return res.status(403).json({
                    code: 'RX_OVERRIDE_ONLY_ACTIVE_WINDOW',
                    windowExpiry: expiryDay.toISOString().slice(0, 10),
                    error: `Override-only access can edit workflow dates only after the 90-day window expires on ${expiryDay.toLocaleDateString()}.`
                });
            }

            // Step 1 (first in sequence) cannot be before service date
            if (thisSeq === 1 && newDay < svcDay) {
                return res.status(400).json({
                    error: `First step date cannot be before the service date (${svcDay.toLocaleDateString()}).`
                });
            }
        }
        // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

        const oldDate  = tracking.completionDate ? new Date(tracking.completionDate).toLocaleDateString() : '(none)';
        const newLabel = parsed.toLocaleDateString();

        await tracking.update({ completionDate: parsed });

        await saveHistory(
            rx.id,
            req.user?.id,
            'Workflow Date Override',
            rx.toJSON(),
            null,
            `Step "${action.name}" date changed from ${oldDate} to ${newLabel} by ${req.user?.username || 'user'}`
        );

        res.json({ ok: true, trackingId, newDate: requestedDate, stepName: action.name });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// POST /api/rx-records/undo-workflow
exports.undoWorkflow = async (req, res) => {
    const transaction = await db.sequelize.transaction();
    try {
        const { rxId } = req.body;

        // BUG-03 FIX: Guard against null RX record before any further operations
        const rx = await db.RXRecord.findByPk(rxId, { transaction });
        if (!rx) {
            await transaction.rollback();
            return res.status(404).json({ error: 'RX Record not found.' });
        }

        const completedTrackings = await db.RXWorkflowTracking.findAll({
            where: { rxRecordId: rxId },
            include: [{ model: db.WorkflowAction }],
            transaction
        });

        const latestTracking = completedTrackings
            .filter(t => t.WorkflowAction)
            .sort((a, b) => {
                const seqDiff = (b.WorkflowAction.sequenceNumber || 0) - (a.WorkflowAction.sequenceNumber || 0);
                if (seqDiff) return seqDiff;
                const actionIdDiff = (b.WorkflowAction.id || 0) - (a.WorkflowAction.id || 0);
                if (actionIdDiff) return actionIdDiff;
                const dateDiff = new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
                if (dateDiff) return dateDiff;
                return (b.id || 0) - (a.id || 0);
            })[0] || completedTrackings
            .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())[0];

        if (!latestTracking) {
            await transaction.rollback();
            return res.status(400).json({ error: 'No workflow steps to undo.' });
        }

        const action = latestTracking.WorkflowAction;
        const stepName = action ? action.name : 'step';
        const undoingDeliveryOutcome = action && action.deliveryOutcomeMode === 'delivered_or_returned';
        await latestTracking.destroy({ transaction });

        if (undoingDeliveryOutcome) {
            await rx.update({
                deliveryOutcome: 'none',
                deliveryOutcomeDate: null,
                deliveryOutcomeNote: null
            }, { transaction });
        }

        await saveHistory(
            rxId,
            req.user?.id,
            'Workflow',
            rx.toJSON(),
            null,
            undoingDeliveryOutcome ? `Delivery outcome undone: ${stepName}` : `Step undone: ${stepName}`,
            transaction
        );
        await transaction.commit();

        res.status(200).json({ message: 'Undo successful' });
    } catch (err) {
        await transaction.rollback();
        res.status(400).json({ error: err.message });
    }
};
// POST /api/rx-records/reopen-warehouse-return
exports.reopenWarehouseReturn = async (req, res) => {
    const transaction = await db.sequelize.transaction();
    try {
        const { rxId } = req.body || {};
        const rx = await db.RXRecord.findByPk(rxId, { transaction });
        if (!rx) {
            await transaction.rollback();
            return res.status(404).json({ error: 'RX Record not found.' });
        }
        if (!rx.returnedToWarehouse) {
            await transaction.rollback();
            return res.status(400).json({ error: 'This RX is not marked as returned to warehouse.' });
        }

        await rx.update({
            returnedToWarehouse: false,
            warehouseReturnDate: null,
            warehouseReturnNote: null
        }, { transaction });
        await saveHistory(
            rx.id,
            req.user?.id,
            'Workflow',
            rx.toJSON(),
            null,
            'Warehouse return reopened; resume the delivery workflow and record the delivery outcome.',
            transaction
        );
        await transaction.commit();
        res.json({ message: 'Warehouse return reopened. Continue the delivery workflow.' });
    } catch (err) {
        await transaction.rollback();
        res.status(400).json({ error: err.message });
    }
};
// POST /api/rx-records/return-to-warehouse
exports.returnToWarehouse = async (req, res) => {
    const transaction = await db.sequelize.transaction();
    try {
        const { rxId, note } = req.body;
        const rx = await db.RXRecord.findByPk(rxId);
        if (!rx) return res.status(404).json({ error: 'RX Record not found.' });

        // Find Step 1 (warehouse step â€” the first workflow action by sequenceNumber)
        const step1 = await db.WorkflowAction.findOne({
            where: { sequenceNumber: 1 },
            order: [['sequenceNumber', 'ASC']]
        });

        // Clear ALL workflow tracking steps
        await db.RXWorkflowTracking.destroy({ where: { rxRecordId: rxId }, transaction });

        // Auto-complete Step 1 (warehouse) so the RX sits at the warehouse position
        if (step1) {
            await db.RXWorkflowTracking.create({
                rxRecordId: rxId,
                workflowActionId: step1.id,
                completionDate: new Date(),
                userId: req.user.id
            }, { transaction });
        }

        // Mark the RX as returned to warehouse
        await rx.update({
            returnedToWarehouse: true,
            warehouseReturnDate: new Date(),
            warehouseReturnNote: note || null,
            deliveryOutcome: 'none',
            deliveryOutcomeDate: null,
            deliveryOutcomeNote: null
        }, { transaction });

        await saveHistory(rxId, req.user?.id, 'Workflow', rx.toJSON(), null,
            `Returned to Warehouse${note ? ': ' + note : ''}${step1 ? ' â€” reset to Step 1: ' + step1.name : ''}`);

        await transaction.commit();
        res.status(200).json({ message: 'Returned to warehouse. Workflow reset to Step 1.' });
    } catch (err) {
        await transaction.rollback();
        res.status(400).json({ error: err.message });
    }
};

// PUT /api/rx-records/:id
// H2 FIX: Explicit field whitelist â€” prevents arbitrary column writes via req.body
const RX_ALLOWED_FIELDS = [
    'patientId', 'arrivalDate', 'serviceDate',
    'pharmacyId', 'patientTransportCompanyId', 'pharmacyTransportCompanyId',
    'notes'
];

exports.update = async (req, res) => {
    try {
        const before = await db.RXRecord.findByPk(req.params.id);
        if (!before) return res.status(404).json({ message: 'Not found' });
        const snapshot = before.toJSON();

        // Build a safe update payload from the whitelist only
        const safeData = {};
        RX_ALLOWED_FIELDS.forEach(field => {
            if (Object.prototype.hasOwnProperty.call(req.body, field)) {
                const val = req.body[field];
                safeData[field] = (val === '' || val === undefined) ? null : val;
            }
        });

        // â”€â”€ 90-DAY SERVICE DATE LOCK â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        // Block changes to serviceDate while the current 90-day window is still active.
        // This prevents silently resetting the eligibility clock mid-cycle.
        // bypassEligibility=true allows admin override (e.g., data corrections).
        const canOverrideExpired = isServiceDateOverrideEnabled() || await userCanOverrideExpired(req, 'rx_records');
        if (
            safeData.serviceDate !== undefined &&
            before.serviceDate &&
            !req.body.bypassEligibility &&
            !canOverrideExpired
        ) {
            const incomingDate  = safeData.serviceDate ? parseDate(safeData.serviceDate) : null;
            const currentSvcStr = before.serviceDate instanceof Date
                ? before.serviceDate.toISOString().slice(0, 10)
                : String(before.serviceDate).slice(0, 10);

            // Only check if the date is actually changing
            const isChanging = incomingDate && incomingDate !== currentSvcStr;
            if (isChanging) {
                const currentSvc    = new Date(before.serviceDate); currentSvc.setHours(0, 0, 0, 0);
                const windowExpiry  = new Date(currentSvc); windowExpiry.setDate(windowExpiry.getDate() + getServiceWindowDays());
                const todayLock     = new Date(); todayLock.setHours(0, 0, 0, 0);

                if (todayLock <= windowExpiry) {
                    const daysLeft = Math.ceil((windowExpiry - todayLock) / 864e5);
                    return res.status(400).json({
                        error: `The Service Date cannot be changed during an active ${getServiceWindowDays()}-day window. ` +
                               `Current window expires on ${windowExpiry.toLocaleDateString()} ` +
                               `(${daysLeft} day${daysLeft !== 1 ? 's' : ''} remaining). ` +
                               `Wait until the window expires before updating the service date.`,
                        code:           'SERVICE_DATE_LOCKED',
                        windowExpiry:   windowExpiry.toISOString().slice(0, 10),
                        daysRemaining:  daysLeft,
                        currentServiceDate: currentSvcStr
                    });
                }
            }
        }
        // â”€â”€ END SERVICE DATE LOCK â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

        const nextPatientId = safeData.patientId !== undefined ? safeData.patientId : before.patientId;
        const nextServiceDate = safeData.serviceDate !== undefined ? parseDate(safeData.serviceDate) : dateOnly(before.serviceDate);
        if (nextPatientId && nextServiceDate) {
            const patient = await db.Patient.findByPk(nextPatientId);
            if (patient) {
                const cycle = await ensureCycleForRx(patient, nextServiceDate, {
                    userId: req.user?.id || null,
                    source: 'RX Update'
                });
                if (cycle) safeData.patientServiceDateCycleId = cycle.id;
            }
        }

        const [updated] = await db.RXRecord.update(safeData, { where: { id: req.params.id } });
        if (!updated) return res.status(404).json({ message: 'Not found' });

        const after = await db.RXRecord.findByPk(req.params.id);
        const changed = diffObjects(snapshot, after.toJSON(), TRACK_FIELDS);
        await saveHistory(before.id, req.user?.id, 'Update', snapshot, changed, null);

        res.json(after);
    } catch (err) { res.status(400).json({ error: err.message }); }
};

// DELETE /api/rx-records/:id (soft)
exports.delete = async (req, res) => {
    try {
        const rx = await db.RXRecord.findByPk(req.params.id);
        if (!rx) return res.status(404).json({ message: 'Not found' });
        const snapshot = rx.toJSON();
        await rx.update({ isDeleted: true, deletedAt: new Date() });
        await saveHistory(rx.id, req.user?.id, 'Delete', snapshot, null, 'Record soft-deleted');
        res.status(200).json({ message: 'Record hidden successfully.' });
    } catch (err) { res.status(500).json({ error: err.message }); }
};

// PUT /api/rx-records/:id/restore
exports.restore = async (req, res) => {
    try {
        const rx = await db.RXRecord.findByPk(req.params.id);
        if (!rx) return res.status(404).json({ message: 'Not found' });
        const snapshot = rx.toJSON();
        await rx.update({ isDeleted: false, deletedAt: null });
        await saveHistory(rx.id, req.user?.id, 'Restore', snapshot, null, 'Record restored');
        res.status(200).json({ message: 'Record restored successfully.' });
    } catch (err) { res.status(500).json({ error: err.message }); }
};

// POST /api/rx-records/:id/close-expired-workflow
exports.closeExpiredWorkflow = async (req, res) => {
    const transaction = await db.sequelize.transaction();
    try {
        const rx = await db.RXRecord.findByPk(req.params.id, {
            include: [db.Patient, db.PatientServiceDateCycle],
            transaction
        });
        if (!rx) {
            await transaction.rollback();
            return res.status(404).json({ error: 'RX Record not found.' });
        }
        const cycleServiceDate = getRxCycleServiceDate(rx);
        if (!cycleServiceDate) {
            await transaction.rollback();
            return res.status(400).json({ error: 'RX Record has no service date to evaluate.' });
        }

        const svcDay = new Date(cycleServiceDate); svcDay.setHours(0, 0, 0, 0);
        const expiryDay = new Date(svcDay); expiryDay.setDate(expiryDay.getDate() + getServiceWindowDays());
        const today = new Date(); today.setHours(0, 0, 0, 0);
        if (today <= expiryDay) {
            await transaction.rollback();
            return res.status(400).json({
                error: `This RX is still inside the active ${getServiceWindowDays()}-day window until ${expiryDay.toLocaleDateString()}.`
            });
        }

        const actions = await db.WorkflowAction.findAll({
            where: { isActive: true },
            order: [['sequenceNumber', 'ASC'], ['id', 'ASC']],
            transaction
        });
        if (!actions.length) {
            await transaction.rollback();
            return res.status(400).json({ error: 'No active workflow actions are configured.' });
        }

        const existingTrackings = await db.RXWorkflowTracking.findAll({
            where: { rxRecordId: rx.id },
            transaction
        });
        const completedActionIds = new Set(existingTrackings.map(t => t.workflowActionId));
        const missingActions = actions.filter(action => !completedActionIds.has(action.id));

        if (!missingActions.length) {
            await transaction.commit();
            return res.json({ ok: true, closedSteps: 0, message: 'RX workflow is already closed.' });
        }

        const completionDate = new Date(expiryDay);
        await db.RXWorkflowTracking.bulkCreate(missingActions.map(action => ({
            rxRecordId: rx.id,
            workflowActionId: action.id,
            completionDate,
            userId: req.user?.id || null
        })), { transaction });

        if (rx.returnedToWarehouse) {
            await rx.update({
                returnedToWarehouse: false,
                warehouseReturnDate: null,
                warehouseReturnNote: null
            }, { transaction });
        }

        await saveHistory(
            rx.id,
            req.user?.id,
            'Workflow Closed',
            rx.toJSON(),
            null,
            `Expired RX workflow closed with ${missingActions.length} step(s) completed at ${completionDate.toLocaleDateString()} by ${req.user?.username || 'user'}.`,
            transaction
        );

        await transaction.commit();
        res.json({
            ok: true,
            closedSteps: missingActions.length,
            completionDate: completionDate.toISOString().slice(0, 10)
        });
    } catch (err) {
        await transaction.rollback();
        res.status(500).json({ error: err.message });
    }
};

// GET /api/rx-records/:id/history
exports.getHistory = async (req, res) => {
    try {
        const history = await db.RXHistory.findAll({
            where: { rxRecordId: req.params.id },
            include: [{ model: db.User, as: 'ChangedBy', attributes: ['firstName', 'lastName', 'username'] }],
            order: [['createdAt', 'DESC']]
        });
        res.json(history);
    } catch (err) { res.status(500).json({ error: err.message }); }
};

// POST /api/rx-records/:id/reset-cycle
// Legacy endpoint kept only to fail safely. New service cycles are created from
// the patient service date, then new RX records are linked to that cycle.
exports.resetRxCycle = async (req, res) => {
    return res.status(410).json({
        code: 'RX_CYCLE_RESET_DISABLED',
        error: 'RX cycle reset is disabled to preserve workflow history. Update the patient service date from the patient profile, then create a new RX record for the new 90-day cycle. Existing RX records remain linked to their original service-date cycle.'
    });
};
