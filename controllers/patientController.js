const db = require('../models');
const { Op, literal } = require('sequelize');
const { parseDate } = require('../utils/dateUtils');
const { isServiceDateOverrideEnabled, getServiceWindowDays } = require('../utils/globalSettings');
const {
    evaluateServiceWindow,
    getEligibilityCutoffIso,
    getCallCenterCutoffIso
} = require('../utils/serviceWindowEligibility');
const { getRequestPermission } = require('../middleware/rbac');
const {
    attachRelatedRxServiceRecords,
    recordPatientServiceDateChange
} = require('../services/patientServiceDateHistoryService');
const {
    buildPatientContextSnapshot,
    syncPatientServiceDateCycles
} = require('../services/patientServiceDateCycleService');

function toUpperName(value) {
    return String(value || '').trim().toUpperCase();
}

function summarizeServiceDateCycle(cycle) {
    const plain = typeof cycle.toJSON === 'function' ? cycle.toJSON() : cycle;
    const rxRecords = Array.isArray(plain.RXRecords) ? plain.RXRecords : [];
    return {
        id: plain.id,
        patientId: plain.patientId,
        serviceDate: plain.serviceDate,
        status: plain.status,
        startedAt: plain.startedAt,
        endedAt: plain.endedAt,
        metadata: plain.metadata || null,
        rxCount: rxRecords.length,
        rxRecordIds: rxRecords.map(rx => rx.id)
    };
}

function idsEqual(left, right) {
    const clean = value => value === '' || value === undefined || value === null ? null : String(value);
    return clean(left) === clean(right);
}

function serviceDatesEqual(left, right) {
    const clean = value => parseDate(value) || null;
    return clean(left) === clean(right);
}

function httpError(status, message) {
    const err = new Error(message);
    err.status = status;
    return err;
}

function patientContextFieldsChanged(patient, payload) {
    return ['clinicId', 'pharmacyId', 'patientTransportCompanyId', 'pharmacyTransportCompanyId']
        .some(field => payload.hasOwnProperty(field) && !idsEqual(payload[field], patient[field]));
}

function patientContextChangedFields(previousContext, nextContext) {
    const comparable = snapshot => ({
        clinic: snapshot && snapshot.clinic ? snapshot.clinic : null,
        defaultPharmacy: snapshot && snapshot.defaultPharmacy ? snapshot.defaultPharmacy : null,
        patientTransport: snapshot && snapshot.patientTransport ? snapshot.patientTransport : null,
        pharmacyTransport: snapshot && snapshot.pharmacyTransport ? snapshot.pharmacyTransport : null
    });
    const previous = comparable(previousContext);
    const next = comparable(nextContext);
    return Object.keys(previous).filter(key => JSON.stringify(previous[key]) !== JSON.stringify(next[key]));
}

async function loadPatientServiceDateCycles(patient, options) {
    options = options || {};
    await syncPatientServiceDateCycles(patient, options);
    const queryOptions = {
        where: { patientId: patient.id },
        include: [{
            model: db.RXRecord,
            attributes: ['id', 'patientServiceDateCycleId', 'serviceDate'],
            where: { [Op.or]: [{ isDeleted: false }, { isDeleted: null }] },
            required: false
        }],
        order: [['serviceDate', 'DESC'], ['id', 'DESC']]
    };
    if (options.transaction) queryOptions.transaction = options.transaction;
    const cycles = await db.PatientServiceDateCycle.findAll(queryOptions);
    return cycles.map(summarizeServiceDateCycle);
}

function isWorkflowCycleNeedsAction(serviceDate, rxRecords, totalWorkflowSteps) {
    if (!serviceDate || !Array.isArray(rxRecords) || totalWorkflowSteps <= 0) {
        return false;
    }

    const svcDay = new Date(serviceDate);
    if (isNaN(svcDay.getTime())) return false;
    svcDay.setHours(0, 0, 0, 0);

    const svcExpiry = new Date(svcDay);
    svcExpiry.setDate(svcExpiry.getDate() + getServiceWindowDays());

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (today <= svcExpiry) return false;

    return rxRecords.some((rx) => {
        const tracked = Array.isArray(rx.RXWorkflowTrackings) ? rx.RXWorkflowTrackings.length : 0;
        return tracked < totalWorkflowSteps;
    });
}

function cleanString(value) {
    return String(value || '').trim();
}

function cleanLower(value) {
    return cleanString(value).toLowerCase();
}

function isPresent(value) {
    return value !== null && value !== undefined && String(value) !== '';
}

function optionLabel(record, labelKeys) {
    if (!record) return '';
    for (const key of labelKeys) {
        if (record[key]) return record[key];
    }
    return '';
}

function patientInclude(options) {
    options = options || {};
    const noteInclude = options.includeFullNotes
        ? {
            model: db.PatientNote,
            as: 'PatientNotes',
            attributes: ['id', 'note', 'createdAt', 'userId'],
            include: [{ model: db.User, as: 'Author', attributes: ['id', 'firstName', 'lastName', 'username'] }],
            order: [['createdAt', 'DESC'], ['id', 'DESC']],
            separate: true
        }
        : { model: db.PatientNote, as: 'PatientNotes', attributes: ['id'] };

    return [
        db.PatientTransportCompany,
        db.PharmacyTransportCompany,
        db.Clinic,
        db.Pharmacy,
        noteInclude,
        {
            model: db.RXRecord,
            attributes: ['id'],
            include: [{
                model: db.RXWorkflowTracking,
                attributes: ['id']
            }],
            where: { [Op.or]: [{ isDeleted: false }, { isDeleted: null }] },
            required: false
        }
    ];
}

function enrichPatientRows(data, totalWorkflowSteps) {
    return data.map((patient) => {
        const plain = patient.toJSON();
        plain.needsAction = isWorkflowCycleNeedsAction(
            plain.serviceDate,
            plain.RXRecords,
            totalWorkflowSteps
        );
        return plain;
    });
}

function parsePositiveInt(value, fallback, min, max) {
    const parsed = parseInt(value, 10);
    if (isNaN(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
}

function impossiblePatientCondition() {
    return literal('1 = 0');
}

function noActiveRxExistsCondition() {
    return literal(`NOT EXISTS (
        SELECT 1
        FROM "RXRecords" AS rx_page
        WHERE rx_page."patientId" = "Patient"."id"
          AND COALESCE(rx_page."isDeleted", false) = false
    )`);
}

function needsActionExistsCondition(totalWorkflowSteps) {
    const stepCount = Number.isInteger(Number(totalWorkflowSteps))
        ? Math.max(0, Number(totalWorkflowSteps))
        : 0;
    if (stepCount <= 0) return impossiblePatientCondition();
    return literal(`EXISTS (
        SELECT 1
        FROM "RXRecords" AS rx_action
        WHERE rx_action."patientId" = "Patient"."id"
          AND COALESCE(rx_action."isDeleted", false) = false
          AND (
              SELECT COUNT(*)
              FROM "RXWorkflowTrackings" AS tracking_action
              WHERE tracking_action."rxRecordId" = rx_action.id
          ) < ${stepCount}
    )`);
}

function buildPatientDatabaseWhere(query, totalWorkflowSteps) {
    query = query || {};
    const clauses = [];
    const textContains = (field, value) => {
        const clean = cleanString(value);
        if (clean) clauses.push({ [field]: { [Op.iLike]: `%${clean}%` } });
    };

    if (query.includeDeleted !== 'true') {
        clauses.push({ [Op.or]: [{ isDeleted: false }, { isDeleted: null }] });
    }

    const id = cleanString(query.id);
    if (id) {
        const parsedId = Number(id);
        clauses.push(Number.isInteger(parsedId) && parsedId > 0
            ? { id: parsedId }
            : impossiblePatientCondition());
    }

    textContains('firstName', query.firstName);
    textContains('lastName', query.lastName);
    textContains('phone', query.phone);
    textContains('patientCode', query.patientCode);

    const dob = cleanString(query.dob);
    if (dob) clauses.push({ dob });

    const status = cleanString(query.status);
    if (status) {
        if (status === 'true' || status === 'false') {
            clauses.push({ isActive: status === 'true' });
        } else {
            clauses.push(impossiblePatientCondition());
        }
    }

    const exactIdFilters = [
        ['clinicId', query.clinicId],
        ['pharmacyId', query.pharmacyId],
        ['patientTransportCompanyId', query.patientTransportId],
        ['pharmacyTransportCompanyId', query.pharmacyTransportId]
    ];
    exactIdFilters.forEach(([field, rawValue]) => {
        const value = cleanString(rawValue);
        if (!value) return;
        const parsed = Number(value);
        clauses.push(Number.isInteger(parsed) && parsed > 0
            ? { [field]: parsed }
            : impossiblePatientCondition());
    });

    const serviceFrom = cleanString(query.serviceFrom);
    if (serviceFrom) {
        // Preserve the existing Patients-screen behavior: undated patients
        // remain visible when only a date boundary is selected.
        clauses.push({
            [Op.or]: [
                { serviceDate: null },
                { serviceDate: { [Op.gte]: serviceFrom } }
            ]
        });
    }
    const serviceTo = cleanString(query.serviceTo);
    if (serviceTo) {
        clauses.push({
            [Op.or]: [
                { serviceDate: null },
                { serviceDate: { [Op.lte]: serviceTo } }
            ]
        });
    }

    const patientType = cleanString(query.patientType);
    if (patientType === 'company') {
        clauses.push({ [Op.or]: [{ isNonCompanyPatient: false }, { isNonCompanyPatient: null }] });
    } else if (patientType === 'non_company') {
        clauses.push({ isNonCompanyPatient: true });
    } else if (patientType) {
        clauses.push(impossiblePatientCondition());
    }

    const missingInfo = cleanString(query.missingInfo);
    const missingByKey = {
        clinic: { clinicId: null },
        pharmacy: { pharmacyId: null },
        patientTransport: { patientTransportCompanyId: null },
        pharmacyTransport: { pharmacyTransportCompanyId: null }
    };
    if (missingByKey[missingInfo]) {
        clauses.push(missingByKey[missingInfo]);
    } else if (missingInfo === 'any') {
        clauses.push({
            [Op.or]: Object.values(missingByKey)
        });
    } else if (missingInfo === 'all') {
        clauses.push({
            [Op.and]: Object.values(missingByKey)
        });
    } else if (missingInfo) {
        clauses.push(impossiblePatientCondition());
    }

    const eligibility = cleanString(query.eligibility);
    if (eligibility) {
        const eligibilityCutoff = getEligibilityCutoffIso(new Date());
        const callCenterCutoff = getCallCenterCutoffIso(new Date());
        clauses.push({ isActive: true });
        if (eligibility === 'needsAction') {
            // Keep the legacy needs-action boundary: action starts the day
            // after the fixed service window has fully elapsed.
            clauses.push({ serviceDate: { [Op.lt]: eligibilityCutoff } });
            clauses.push(needsActionExistsCondition(totalWorkflowSteps));
        } else if (eligibility === 'none') {
            clauses.push({ serviceDate: null });
        } else if (eligibility === 'eligible') {
            clauses.push({ serviceDate: { [Op.lte]: eligibilityCutoff } });
        } else if (eligibility === 'expiring') {
            clauses.push({
                serviceDate: {
                    [Op.gt]: eligibilityCutoff,
                    [Op.lte]: callCenterCutoff
                }
            });
        } else if (eligibility === 'window') {
            clauses.push({ serviceDate: { [Op.gt]: callCenterCutoff } });
        } else {
            clauses.push(impossiblePatientCondition());
        }
    }

    if (query.noRx === 'true') {
        clauses.push({ isActive: true });
        clauses.push(noActiveRxExistsCondition());
    }

    return clauses.length ? { [Op.and]: clauses } : {};
}

function patientDatabaseOrder(sortKey, sortDir) {
    const direction = sortDir === 'asc' ? 'ASC' : 'DESC';
    const nullOrder = direction === 'ASC' ? 'NULLS FIRST' : 'NULLS LAST';
    const fixedExpressions = {
        firstName: `LOWER(COALESCE("Patient"."firstName", '') || ' ' || COALESCE("Patient"."lastName", '')) ${direction}`,
        'Clinic.name': `LOWER(COALESCE("Clinic"."name", '')) ${direction}`,
        patientCode: `"Patient"."patientCode" ${direction} ${nullOrder}`,
        dob: `"Patient"."dob" ${direction} ${nullOrder}`,
        phone: `"Patient"."phone" ${direction} ${nullOrder}`,
        serviceDate: `"Patient"."serviceDate" ${direction} ${nullOrder}`,
        nextSvcDate: `"Patient"."serviceDate" ${direction} ${nullOrder}`,
        isActive: `"Patient"."isActive" ${direction} ${nullOrder}`
    };
    const expression = fixedExpressions[sortKey] || `"Patient"."id" ${direction}`;
    return [[literal(expression)], ['id', direction]];
}

async function loadPatientFacets(where) {
    const grouped = await db.Patient.findAll({
        attributes: [
            'clinicId',
            'pharmacyId',
            'patientTransportCompanyId',
            'pharmacyTransportCompanyId'
        ],
        where,
        group: [
            'clinicId',
            'pharmacyId',
            'patientTransportCompanyId',
            'pharmacyTransportCompanyId'
        ],
        raw: true
    });
    const uniqueIds = field => Array.from(new Set(
        grouped.map(row => row[field]).filter(isPresent).map(Number)
    ));
    const [clinics, pharmacies, patientTransports, pharmacyTransports] = await Promise.all([
        db.Clinic.findAll({ where: { id: uniqueIds('clinicId') }, attributes: ['id', 'name'], raw: true }),
        db.Pharmacy.findAll({ where: { id: uniqueIds('pharmacyId') }, attributes: ['id', 'name'], raw: true }),
        db.PatientTransportCompany.findAll({
            where: { id: uniqueIds('patientTransportCompanyId') },
            attributes: ['id', 'contactPerson', 'companyName'],
            raw: true
        }),
        db.PharmacyTransportCompany.findAll({
            where: { id: uniqueIds('pharmacyTransportCompanyId') },
            attributes: ['id', 'companyName', 'contactPerson'],
            raw: true
        })
    ]);
    const asOptions = (rows, keys) => rows
        .map(row => ({ id: String(row.id), label: optionLabel(row, keys) }))
        .filter(row => row.label)
        .sort((left, right) => left.label.localeCompare(right.label));
    return {
        clinics: asOptions(clinics, ['name']),
        pharmacies: asOptions(pharmacies, ['name']),
        patientTransports: asOptions(patientTransports, ['contactPerson', 'companyName']),
        pharmacyTransports: asOptions(pharmacyTransports, ['companyName', 'contactPerson'])
    };
}

async function loadPatientRowsByIds(ids, totalWorkflowSteps, includeFullNotes) {
    if (!ids.length) return [];
    const orderIndex = new Map(ids.map((id, index) => [Number(id), index]));
    const rows = [];
    const batchSize = includeFullNotes ? 250 : ids.length;
    for (let offset = 0; offset < ids.length; offset += batchSize) {
        const batchIds = ids.slice(offset, offset + batchSize);
        const batch = await db.Patient.findAll({
            where: { id: batchIds },
            include: patientInclude({ includeFullNotes })
        });
        rows.push(...enrichPatientRows(batch, totalWorkflowSteps));
    }
    rows.sort((left, right) => orderIndex.get(Number(left.id)) - orderIndex.get(Number(right.id)));
    return rows;
}

exports.getAll = async (req, res) => {
    try {
        const totalWorkflowSteps = await db.WorkflowAction.count({ where: { isActive: true } });

        if (req.query.paginated === 'true') {
            const pageSize = parsePositiveInt(req.query.pageSize, 10, 1, 500);
            const page = parsePositiveInt(req.query.page, 1, 1, 1000000);
            const sort = cleanString(req.query.sort) || 'id';
            const dir = cleanString(req.query.dir).toLowerCase() === 'asc' ? 'asc' : 'desc';
            const where = buildPatientDatabaseWhere(req.query, totalWorkflowSteps);
            const needsActionWhere = {
                [Op.and]: [
                    where,
                    { serviceDate: { [Op.lt]: getEligibilityCutoffIso(new Date()) } },
                    needsActionExistsCondition(totalWorkflowSteps)
                ]
            };
            const [total, needsActionTotal, facets] = await Promise.all([
                db.Patient.count({ where }),
                totalWorkflowSteps > 0 ? db.Patient.count({ where: needsActionWhere }) : Promise.resolve(0),
                loadPatientFacets(where)
            ]);
            const totalPages = Math.max(1, Math.ceil(total / pageSize));
            const safePage = Math.min(page, totalPages);
            const offset = (safePage - 1) * pageSize;
            const exportAll = req.query.exportAll === 'true';
            const orderInclude = sort === 'Clinic.name'
                ? [{ model: db.Clinic, attributes: [], required: false }]
                : [];
            const idRows = await db.Patient.findAll({
                attributes: ['id'],
                where,
                include: orderInclude,
                order: patientDatabaseOrder(sort, dir),
                limit: exportAll ? undefined : pageSize,
                offset: exportAll ? undefined : offset,
                subQuery: false,
                raw: true
            });
            const pageRows = await loadPatientRowsByIds(
                idRows.map(row => row.id),
                totalWorkflowSteps,
                exportAll
            );

            return res.json({
                rows: pageRows,
                total,
                page: safePage,
                pageSize,
                totalPages,
                needsActionTotal,
                sort,
                dir,
                facets
            });
        }

        const data = await db.Patient.findAll({
            where: req.query.includeDeleted === 'true'
                ? {}
                : { [Op.or]: [{ isDeleted: false }, { isDeleted: null }] },
            include: patientInclude({ includeFullNotes: req.query.exportAll === 'true' })
        });
        const rows = enrichPatientRows(data, totalWorkflowSteps);
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
};
exports.getOne = async (req, res) => {
    try {
        const data = await db.Patient.findByPk(req.params.id, {
            include: [db.PatientTransportCompany, db.PharmacyTransportCompany, db.Clinic, db.RXRecord]
        });
        if (!data) return res.status(404).json({ message: 'Not found' });
        res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.create = async (req, res) => {
    try {
        let { patientCode, dob, serviceDate, ...otherData } = req.body;
        otherData.firstName = toUpperName(otherData.firstName);
        otherData.lastName = toUpperName(otherData.lastName);

        if (!otherData.firstName || !otherData.lastName) {
            return res.status(400).json({ error: 'First Name and Last Name are required.' });
        }

        // Normalise dates: accept MM/DD/YYYY, YYYY-MM-DD, or any common format
        const normDob         = parseDate(dob);
        const trimmedServiceDate = String(serviceDate || '').trim();
        const normServiceDate = parseDate(trimmedServiceDate);
        if (dob && !normDob) return res.status(400).json({ error: 'Date of Birth is not a valid date. Use MM/DD/YYYY format.' });
        if (!trimmedServiceDate) return res.status(400).json({ error: 'Service Date is required.' });
        if (!normServiceDate) return res.status(400).json({ error: 'Service Date is not valid. Use MM/DD/YYYY format.' });
        otherData.dob         = normDob;
        otherData.serviceDate = normServiceDate;

        // Auto-generate patientCode if not provided
        if (!patientCode || !patientCode.trim()) {
            // H1 FIX: Use a retry loop to handle concurrent creates gracefully.
            // Try up to 10 candidate codes based on the current max id.
            const lastPatient = await db.Patient.findOne({ order: [['id', 'DESC']] });
            let baseId = lastPatient ? lastPatient.id : 0;
            let generated = null;
            for (let attempt = 0; attempt < 10; attempt++) {
                const candidate = 'PAT-' + String(baseId + 1 + attempt).padStart(5, '0');
                const exists = await db.Patient.findOne({ where: { patientCode: candidate } });
                if (!exists) { generated = candidate; break; }
            }
            if (!generated) {
                return res.status(500).json({ error: 'Could not generate a unique Patient ID. Please provide one manually.' });
            }
            patientCode = generated;
        } else {
            patientCode = patientCode.trim();
        }

        // Validate uniqueness of provided patientCode
        const existingCode = await db.Patient.findOne({ where: { patientCode } });
        if (existingCode) {
            return res.status(400).json({ error: `Patient ID "${patientCode}" is already assigned to another patient.` });
        }

        const data = await db.Patient.create({ ...otherData, patientCode });
        await syncPatientServiceDateCycles(data, {
            userId: req.user?.id || null,
            source: 'Patient Create',
            contextChangeReason: 'Initial patient clinic/pharmacy/transport defaults captured.'
        });
        const newPatientContext = await buildPatientContextSnapshot(data, {
            source: 'Patient Create'
        });
        await recordPatientServiceDateChange({
            patientId: data.id,
            previousServiceDate: null,
            newServiceDate: data.serviceDate,
            userId: req.user?.id || null,
            changeSource: 'Patient Create',
            reason: 'Patient created with initial service date.',
            metadata: {
                patientContextChange: {
                    previous: null,
                    next: newPatientContext,
                    changedFields: patientContextChangedFields(null, newPatientContext)
                }
            }
        });
        res.status(201).json(data);
    } catch (err) {
        // H1 FIX: Catch DB-level unique constraint violation (race condition fallback)
        if (err.name === 'SequelizeUniqueConstraintError') {
            return res.status(400).json({ error: 'Patient ID conflict — another record was just created with the same code. Please retry.' });
        }
        res.status(400).json({ error: err.message });
    }
};

exports.update = lockedUpdatePatient;

async function updatePatientLegacy(req, res) {
    try {
        const patient = await db.Patient.findByPk(req.params.id);
        if (!patient) return res.status(404).json({ message: 'Not found' });
        const previousServiceDate = patient.serviceDate;
        const previousPatientContext = await buildPatientContextSnapshot(patient, {
            source: 'Before Patient Update'
        });

        // Normalise incoming dates (accept MM/DD/YYYY or YYYY-MM-DD)
        if (req.body.hasOwnProperty('dob')) {
            const norm = parseDate(req.body.dob);
            if (req.body.dob && !norm) return res.status(400).json({ error: 'Date of Birth is not a valid date. Use MM/DD/YYYY format.' });
            req.body.dob = norm;
        }
        if (req.body.hasOwnProperty('firstName')) {
            req.body.firstName = toUpperName(req.body.firstName);
        }
        if (req.body.hasOwnProperty('lastName')) {
            req.body.lastName = toUpperName(req.body.lastName);
        }
        if (req.body.hasOwnProperty('serviceDate')) {
            const norm = parseDate(req.body.serviceDate);
            if (req.body.serviceDate && !norm) return res.status(400).json({ error: 'Service Date is not valid. Use MM/DD/YYYY format.' });
            req.body.serviceDate = norm || null;
        }

        const patientPerm = await getRequestPermission(req, 'patients');
        const canEditPatient = !!(patientPerm.visible && patientPerm.canEdit);
        const canOverrideExpired = !!(patientPerm.visible && patientPerm.canOverrideExpired);

        if (!canEditPatient && !canOverrideExpired) {
            return res.status(403).json({ error: 'Access denied: you cannot edit patient records.' });
        }

        if (!canEditPatient && canOverrideExpired) {
            Object.keys(req.body).forEach((field) => {
                if (field !== 'serviceDate') delete req.body[field];
            });
        }

        // Validate uniqueness of updated patientCode if provided and changed
        if (req.body.patientCode && req.body.patientCode.trim() !== patient.patientCode) {
            const newCode = req.body.patientCode.trim();
            const existingCode = await db.Patient.findOne({
                where: {
                    patientCode: newCode,
                    id: { [Op.ne]: req.params.id }
                }
            });
            if (existingCode) {
                return res.status(400).json({ error: `Patient ID "${newCode}" is already assigned to another patient.` });
            }
            req.body.patientCode = newCode;
        }

        // Check if service date is being updated (90-day rule)
        const hasServiceDateChange = req.body.hasOwnProperty('serviceDate')
            && String(req.body.serviceDate || '') !== String(patient.serviceDate || '');
        const hasPatientContextChange = patientContextFieldsChanged(patient, req.body);
        if (!isServiceDateOverrideEnabled() && !canOverrideExpired && hasServiceDateChange) {
            if (patient.serviceDate) {
                const prevDate = new Date(patient.serviceDate);
                const currentDate = new Date();
                prevDate.setHours(0, 0, 0, 0);
                currentDate.setHours(0, 0, 0, 0);

                const windowExpiry = new Date(prevDate);
                windowExpiry.setDate(windowExpiry.getDate() + getServiceWindowDays());

                if (currentDate <= windowExpiry) {
                    const daysRemaining = Math.ceil((windowExpiry.getTime() - currentDate.getTime()) / (1000 * 3600 * 24));
                    return res.status(400).json({
                        error: `A new Service Date can only be assigned after the active ${getServiceWindowDays()}-day window expires on ${windowExpiry.toLocaleDateString()}. ${daysRemaining} day${daysRemaining !== 1 ? 's' : ''} remaining.`
                    });
                }
            }
        }

        // Use instance-level set()+save() instead of class-level update() to reliably
        // persist all fields including foreign key columns (pharmacyId, clinicId, etc.)
        const allowedFields = [
            'firstName', 'lastName', 'dob', 'address', 'phone',
            'serviceDate', 'notes', 'isActive', 'patientCode',
            'patientTransportCompanyId', 'pharmacyTransportCompanyId',
            'clinicId', 'pharmacyId', 'isDeleted'
        ];
        allowedFields.forEach(field => {
            if (req.body.hasOwnProperty(field)) {
                // Convert empty string FK values to null
                const val = req.body[field];
                patient[field] = (val === '' || val === undefined) ? null : val;
            }
        });
        await patient.save();

        if (hasServiceDateChange || hasPatientContextChange) {
            await syncPatientServiceDateCycles(patient, {
                userId: req.user?.id || null,
                source: (!canEditPatient && canOverrideExpired) ? 'Patient Override' : 'Patient Update',
                previousPatientContext,
                contextChangeReason: hasServiceDateChange
                    ? 'Patient service date changed; clinic/pharmacy/transport defaults captured for the active cycle.'
                    : 'Patient clinic/pharmacy/transport defaults changed during this service date cycle.'
            });
        }

        if (hasServiceDateChange) {
            const nextPatientContext = await buildPatientContextSnapshot(patient, {
                source: (!canEditPatient && canOverrideExpired) ? 'Patient Override' : 'Patient Update'
            });
            await recordPatientServiceDateChange({
                patientId: patient.id,
                previousServiceDate,
                newServiceDate: patient.serviceDate,
                userId: req.user?.id || null,
                changeSource: (!canEditPatient && canOverrideExpired) ? 'Patient Override' : 'Patient Update',
                reason: 'Patient record service date changed.',
                metadata: {
                    patientContextChange: {
                        previous: previousPatientContext,
                        next: nextPatientContext,
                        changedFields: patientContextChangedFields(previousPatientContext, nextPatientContext)
                    }
                }
            });
        }

        // Cascade: if isActive was explicitly changed, sync RX records accordingly
        if (req.body.hasOwnProperty('isActive')) {
            const active = req.body.isActive === true || req.body.isActive === 'true';
            if (!active) {
                // Patient deactivated → soft-delete all active RX records
                const count = await db.RXRecord.update(
                    { isDeleted: true, deletedAt: new Date() },
                    { where: { patientId: req.params.id, isDeleted: false } }
                );
                console.log(`[Patient Deactivate] Patient #${req.params.id} — ${count[0]} RX record(s) hidden.`);
            } else {
                // Patient re-activated → restore all soft-deleted RX records
                const count = await db.RXRecord.update(
                    { isDeleted: false, deletedAt: null },
                    { where: { patientId: req.params.id, isDeleted: true } }
                );
                console.log(`[Patient Activate] Patient #${req.params.id} — ${count[0]} RX record(s) restored.`);
            }
        }

        const updatedPatient = await db.Patient.findByPk(req.params.id, {
            include: [db.PatientTransportCompany, db.PharmacyTransportCompany, db.Clinic, db.Pharmacy]
        });
        res.json(updatedPatient);
    } catch (err) { res.status(400).json({ error: err.message }); }
};

async function lockedUpdatePatient(req, res) {
    try {
        const payload = { ...(req.body || {}) };

        if (payload.hasOwnProperty('dob')) {
            const norm = parseDate(payload.dob);
            if (payload.dob && !norm) return res.status(400).json({ error: 'Date of Birth is not a valid date. Use MM/DD/YYYY format.' });
            payload.dob = norm;
        }
        if (payload.hasOwnProperty('firstName')) payload.firstName = toUpperName(payload.firstName);
        if (payload.hasOwnProperty('lastName')) payload.lastName = toUpperName(payload.lastName);
        if (payload.hasOwnProperty('serviceDate')) {
            const norm = parseDate(payload.serviceDate);
            if (payload.serviceDate && !norm) return res.status(400).json({ error: 'Service Date is not valid. Use MM/DD/YYYY format.' });
            payload.serviceDate = norm || null;
        }

        const patientPerm = await getRequestPermission(req, 'patients');
        const canEditPatient = !!(patientPerm.visible && patientPerm.canEdit);
        const canOverrideExpired = !!(patientPerm.visible && patientPerm.canOverrideExpired);

        if (!canEditPatient && !canOverrideExpired) {
            return res.status(403).json({ error: 'Access denied: you cannot edit patient records.' });
        }

        if (!canEditPatient && canOverrideExpired) {
            Object.keys(payload).forEach((field) => {
                if (field !== 'serviceDate') delete payload[field];
            });
        }

        const updatedPatient = await db.sequelize.transaction(async (transaction) => {
            const patient = await db.Patient.findByPk(req.params.id, {
                transaction,
                lock: transaction.LOCK.UPDATE
            });
            if (!patient) throw httpError(404, 'Not found');

            const previousServiceDate = parseDate(patient.serviceDate);
            const previousPatientContext = await buildPatientContextSnapshot(patient, {
                transaction,
                source: 'Before Patient Update'
            });

            if (payload.patientCode && payload.patientCode.trim() !== patient.patientCode) {
                const newCode = payload.patientCode.trim();
                const existingCode = await db.Patient.findOne({
                    where: {
                        patientCode: newCode,
                        id: { [Op.ne]: req.params.id }
                    },
                    transaction
                });
                if (existingCode) {
                    throw httpError(400, `Patient ID "${newCode}" is already assigned to another patient.`);
                }
                payload.patientCode = newCode;
            }

            const hasServiceDateChange = payload.hasOwnProperty('serviceDate')
                && !serviceDatesEqual(payload.serviceDate, patient.serviceDate);
            const hasPatientContextChange = patientContextFieldsChanged(patient, payload);

            if (!isServiceDateOverrideEnabled() && !canOverrideExpired && hasServiceDateChange && patient.serviceDate) {
                const prevDate = new Date(patient.serviceDate);
                const currentDate = new Date();
                prevDate.setHours(0, 0, 0, 0);
                currentDate.setHours(0, 0, 0, 0);

                const windowExpiry = new Date(prevDate);
                windowExpiry.setDate(windowExpiry.getDate() + getServiceWindowDays());

                if (currentDate <= windowExpiry) {
                    const daysRemaining = Math.ceil((windowExpiry.getTime() - currentDate.getTime()) / (1000 * 3600 * 24));
                    throw httpError(400, `A new Service Date can only be assigned after the active ${getServiceWindowDays()}-day window expires on ${windowExpiry.toLocaleDateString()}. ${daysRemaining} day${daysRemaining !== 1 ? 's' : ''} remaining.`);
                }
            }

            const allowedFields = [
                'firstName', 'lastName', 'dob', 'address', 'phone',
                'serviceDate', 'notes', 'isActive', 'patientCode',
                'patientTransportCompanyId', 'pharmacyTransportCompanyId',
                'clinicId', 'pharmacyId', 'isDeleted', 'isNonCompanyPatient'
            ];
            allowedFields.forEach(field => {
                if (payload.hasOwnProperty(field)) {
                    const val = payload[field];
                    patient[field] = (val === '' || val === undefined) ? null : val;
                }
            });
            await patient.save({ transaction });

            if (hasServiceDateChange || hasPatientContextChange) {
                await syncPatientServiceDateCycles(patient, {
                    transaction,
                    userId: req.user?.id || null,
                    source: (!canEditPatient && canOverrideExpired) ? 'Patient Override' : 'Patient Update',
                    previousPatientContext,
                    contextChangeReason: hasServiceDateChange
                        ? 'Patient service date changed; clinic/pharmacy/transport defaults captured for the active cycle.'
                        : 'Patient clinic/pharmacy/transport defaults changed during this service date cycle.'
                });
            }

            if (hasServiceDateChange) {
                const nextPatientContext = await buildPatientContextSnapshot(patient, {
                    transaction,
                    source: (!canEditPatient && canOverrideExpired) ? 'Patient Override' : 'Patient Update'
                });
                await recordPatientServiceDateChange({
                    patientId: patient.id,
                    previousServiceDate,
                    newServiceDate: patient.serviceDate,
                    userId: req.user?.id || null,
                    changeSource: (!canEditPatient && canOverrideExpired) ? 'Patient Override' : 'Patient Update',
                    reason: 'Patient record service date changed.',
                    metadata: {
                        patientContextChange: {
                            previous: previousPatientContext,
                            next: nextPatientContext,
                            changedFields: patientContextChangedFields(previousPatientContext, nextPatientContext)
                        }
                    }
                }, { transaction });
            }

            if (payload.hasOwnProperty('isActive')) {
                const active = payload.isActive === true || payload.isActive === 'true';
                if (!active) {
                    const count = await db.RXRecord.update(
                        { isDeleted: true, deletedAt: new Date() },
                        { where: { patientId: req.params.id, isDeleted: false }, transaction }
                    );
                    console.log(`[Patient Deactivate] Patient #${req.params.id} - ${count[0]} RX record(s) hidden.`);
                } else {
                    const count = await db.RXRecord.update(
                        { isDeleted: false, deletedAt: null },
                        { where: { patientId: req.params.id, isDeleted: true }, transaction }
                    );
                    console.log(`[Patient Activate] Patient #${req.params.id} - ${count[0]} RX record(s) restored.`);
                }
            }

            return db.Patient.findByPk(req.params.id, {
                include: [db.PatientTransportCompany, db.PharmacyTransportCompany, db.Clinic, db.Pharmacy],
                transaction
            });
        });

        res.json(updatedPatient);
    } catch (err) {
        res.status(err.status || 400).json({ error: err.message });
    }
}

exports.delete = async (req, res) => {
    try {
        const patient = await db.Patient.findByPk(req.params.id);
        if (!patient) return res.status(404).json({ message: 'Not found' });

        // Soft-delete the patient
        await patient.update({ isDeleted: true });

        // Cascade: soft-delete all RX records belonging to this patient
        const cascadeCount = await db.RXRecord.update(
            { isDeleted: true, deletedAt: new Date() },
            { where: { patientId: req.params.id, isDeleted: false } }
        );
        console.log(`[Patient Delete] Patient #${req.params.id} — ${cascadeCount[0]} RX record(s) soft-deleted.`);

        // Use res.json() (not res.send()) so auditLogger middleware can intercept and log the delete action
        res.json({ ok: true, message: 'Patient deleted', id: parseInt(req.params.id) });
    } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.restore = async (req, res) => {
    try {
        const patient = await db.Patient.findByPk(req.params.id);
        if (!patient) return res.status(404).json({ message: 'Not found' });

        // Restore the patient
        await patient.update({ isDeleted: false });

        // Cascade: restore all RX records that were deleted along with this patient
        const cascadeCount = await db.RXRecord.update(
            { isDeleted: false, deletedAt: null },
            { where: { patientId: req.params.id, isDeleted: true } }
        );
        console.log(`[Patient Restore] Patient #${req.params.id} — ${cascadeCount[0]} RX record(s) restored.`);

        res.status(200).json({ message: 'Restored successfully' });
    } catch (err) { res.status(500).json({ error: err.message }); }
};

// Check for duplicate patients by firstName + lastName + dob
exports.checkDuplicate = async (req, res) => {
    try {
        const { firstName, lastName, dob } = req.query;
        if (!firstName || !lastName || !dob) {
            return res.json({ duplicates: [] });
        }
        const normalizedFirstName = toUpperName(firstName);
        const normalizedLastName = toUpperName(lastName);
        const normalizedDob = parseDate(dob);
        if (!normalizedFirstName || !normalizedLastName || !normalizedDob) {
            return res.json({ duplicates: [] });
        }
        const duplicates = await db.Patient.findAll({
            where: {
                firstName: normalizedFirstName,
                lastName:  normalizedLastName,
                dob:       normalizedDob
            },
            attributes: ['id', 'patientCode', 'firstName', 'lastName', 'dob', 'phone', 'isActive', 'isDeleted']
        });
        res.json({ duplicates });
    } catch (err) { res.status(500).json({ error: err.message }); }
};

// GET /api/patients/:id/service-date-history
exports.getServiceDateHistory = async (req, res) => {
    try {
        const patient = await db.Patient.findByPk(req.params.id, { attributes: ['id'] });
        if (!patient) return res.status(404).json({ message: 'Patient not found' });

        const history = await db.PatientServiceDateHistory.findAll({
            where: { patientId: req.params.id },
            include: [{
                model: db.User,
                as: 'ChangedBy',
                attributes: ['firstName', 'lastName', 'username']
            }],
            order: [['createdAt', 'DESC'], ['id', 'DESC']]
        });

        res.json(await attachRelatedRxServiceRecords(history));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// GET /api/patients/:id/timeline
exports.getTimeline = async (req, res) => {
    try {
        const patient = await db.Patient.findByPk(req.params.id, {
            include: [db.PatientTransportCompany, db.PharmacyTransportCompany, db.Clinic, db.Pharmacy]
        });
        if (!patient) return res.status(404).json({ message: 'Patient not found' });

        const serviceDateCycles = await loadPatientServiceDateCycles(patient, {
            userId: req.user?.id || null,
            source: 'Timeline Review'
        });

        const rxRecords = await db.RXRecord.findAll({
            // LOGIC-02 FIX: Exclude soft-deleted RX records from the timeline
            where: { patientId: req.params.id, isDeleted: false },
            include: [
                { model: db.PatientServiceDateCycle },
                { model: db.Pharmacy },
                { model: db.PatientTransportCompany },
                { model: db.PharmacyTransportCompany },
                { model: db.Medication },
                {
                    model: db.RXWorkflowTracking,
                    include: [
                        { model: db.WorkflowAction },
                        { model: db.User, attributes: ['firstName', 'lastName', 'username'] }
                    ]
                }
            ],
            order: [['serviceDate', 'DESC'], ['id', 'DESC']]
        });

        const allWorkflowActions = await db.WorkflowAction.findAll({
            order: [['sequenceNumber', 'ASC']]
        });

        const serviceDateHistory = await db.PatientServiceDateHistory.findAll({
            where: { patientId: req.params.id },
            include: [{
                model: db.User,
                as: 'ChangedBy',
                attributes: ['firstName', 'lastName', 'username']
            }],
            order: [['createdAt', 'DESC'], ['id', 'DESC']]
        });

        const enrichedServiceDateHistory = await attachRelatedRxServiceRecords(serviceDateHistory);

        res.json({
            patient: patient.toJSON(),
            rxRecords: rxRecords.map(rx => {
                const plain = rx.toJSON();
                plain.completedSteps = (plain.RXWorkflowTrackings || []).map(t => t.workflowActionId);
                return plain;
            }),
            workflowActions: allWorkflowActions.map(a => a.toJSON()),
            serviceDateHistory: enrichedServiceDateHistory,
            serviceDateCycles
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
};
