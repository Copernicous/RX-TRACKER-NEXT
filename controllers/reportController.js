const db = require('../models');
const Op = db.Sequelize.Op;
const QueryTypes = db.Sequelize.QueryTypes;

const CALL_CENTER_MODULE = 'Call Center';
const CC_CALL_ACTION = 'Called';
const CC_NOTE_ACTION = 'Note Added';
const CC_SERVICE_DATE_ACTION = 'Service Date Added';

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

function localDateOnly(value) {
    if (!value) return '';
    const d = value instanceof Date ? value : new Date(value);
    if (isNaN(d.getTime())) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function endOfDay(isoDate) {
    const d = new Date(`${isoDate}T00:00:00`);
    d.setHours(23, 59, 59, 999);
    return d;
}

function getUserLabel(user) {
    if (!user) return 'System';
    const first = user.firstName || '';
    const last = user.lastName || '';
    const full = `${first} ${last}`.trim();
    return full || user.username || `User ${user.id}`;
}

function parseAuditJson(value) {
    if (!value) return {};
    if (typeof value === 'object') return value;
    try { return JSON.parse(value); } catch (e) { return {}; }
}

function auditServiceDate(value) {
    const payload = parseAuditJson(value);
    return payload.serviceDate || payload.newServiceDate || '';
}

function ccRange(query) {
    const dateFrom = isDateOnly(query.dateFrom) ? query.dateFrom : '';
    const dateTo = isDateOnly(query.dateTo) ? query.dateTo : '';
    const fromIso = dateFrom || '';
    const toIso = dateTo || '';
    const where = {};
    if (fromIso && toIso) where[Op.between] = [new Date(`${fromIso}T00:00:00`), endOfDay(toIso)];
    else if (fromIso) where[Op.gte] = new Date(`${fromIso}T00:00:00`);
    else if (toIso) where[Op.lte] = endOfDay(toIso);
    return { fromIso, toIso, where };
}

function ccEmptyRow(patientId) {
    return {
        patientId,
        patientCode: '',
        firstName: '',
        lastName: '',
        phone: '',
        clinicName: '',
        serviceDate: '',
        status: '',
        calls: 0,
        serviceDates: 0,
        notes: 0,
        repeatCalls: 0,
        firstActionAt: null,
        lastActionAt: null,
        lastActionBy: '',
        users: new Set(),
        callHistory: [],
        serviceDateHistory: [],
        noteHistory: []
    };
}

function ccBucket(map, patientId) {
    const key = String(patientId);
    if (!map[key]) map[key] = ccEmptyRow(patientId);
    return map[key];
}

function ccTouchRow(row, at, user) {
    if (user) row.users.add(user);
    if (at && (!row.firstActionAt || new Date(at) < new Date(row.firstActionAt))) row.firstActionAt = at;
    if (at && (!row.lastActionAt || new Date(at) > new Date(row.lastActionAt))) {
        row.lastActionAt = at;
        row.lastActionBy = user || '';
    }
}

function ccHistoryLine(kind, item) {
    const when = item && item.at ? new Date(item.at).toLocaleString() : '';
    const user = item && item.user ? item.user : '';
    if (kind === 'note') return `${when}${user ? ` - ${user}` : ''}: ${item.note || ''}`;
    if (kind === 'serviceDate') return `${when}${user ? ` - ${user}` : ''}${item.serviceDate ? ` -> ${item.serviceDate}` : ''}`;
    return `${when}${user ? ` - ${user}` : ''}`;
}

function ccHistoryText(items, kind) {
    return (items || []).map(item => ccHistoryLine(kind, item)).join(' | ');
}

function ccMatchesText(value, query) {
    if (!query) return true;
    return String(value || '').toLowerCase().includes(query);
}

function ccRowMatchesFilters(row, query) {
    const action = cleanString(query.actionType);
    const status = cleanString(query.status);
    const code = cleanString(query.patientCode).toLowerCase();
    const first = cleanString(query.firstName).toLowerCase();
    const last = cleanString(query.lastName).toLowerCase();
    const phone = cleanString(query.phone).toLowerCase();
    const clinic = cleanString(query.clinic).toLowerCase();
    const serviceFrom = isDateOnly(query.serviceDateFrom) ? query.serviceDateFrom : '';
    const serviceTo = isDateOnly(query.serviceDateTo) ? query.serviceDateTo : '';

    if (action === 'calls' && row.calls <= 0) return false;
    if (action === 'notes' && row.notes <= 0) return false;
    if (action === 'service_dates' && row.serviceDates <= 0) return false;
    if (action === 'repeats' && row.repeatCalls <= 0) return false;
    if (status && row.status !== status) return false;
    if (!ccMatchesText(row.patientCode, code)) return false;
    if (!ccMatchesText(row.firstName, first)) return false;
    if (!ccMatchesText(row.lastName, last)) return false;
    if (!ccMatchesText(row.phone, phone)) return false;
    if (!ccMatchesText(row.clinicName, clinic)) return false;
    if (serviceFrom && (!row.serviceDate || row.serviceDate < serviceFrom)) return false;
    if (serviceTo && (!row.serviceDate || row.serviceDate > serviceTo)) return false;
    return true;
}

function ccSortValue(row, sort) {
    if (sort === 'patientCode') return row.patientCode || '';
    if (sort === 'firstName') return row.firstName || '';
    if (sort === 'lastName') return row.lastName || '';
    if (sort === 'phone') return row.phone || '';
    if (sort === 'clinicName') return row.clinicName || '';
    if (sort === 'serviceDate') return row.serviceDate || '';
    if (sort === 'status') return row.status || '';
    if (sort === 'calls') return Number(row.calls || 0);
    if (sort === 'repeatCalls') return Number(row.repeatCalls || 0);
    if (sort === 'serviceDates') return Number(row.serviceDates || 0);
    if (sort === 'notes') return Number(row.notes || 0);
    if (sort === 'firstActionAt') return row.firstActionAt ? new Date(row.firstActionAt).getTime() : 0;
    if (sort === 'lastActionAt') return row.lastActionAt ? new Date(row.lastActionAt).getTime() : 0;
    if (sort === 'users') return row.usersText || '';
    return row.lastActionAt ? new Date(row.lastActionAt).getTime() : 0;
}

function ccSortRows(rows, sort, dir) {
    const direction = dir === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
        let av = ccSortValue(a, sort);
        let bv = ccSortValue(b, sort);
        if (typeof av === 'number' || typeof bv === 'number') {
            av = Number(av || 0);
            bv = Number(bv || 0);
            return (av - bv) * direction;
        }
        av = String(av || '').toLowerCase();
        bv = String(bv || '').toLowerCase();
        if (av < bv) return -1 * direction;
        if (av > bv) return 1 * direction;
        return 0;
    });
    return rows;
}

async function getCallCenterReportUsers() {
    const auditUsers = await db.AuditLog.findAll({
        where: {
            module: CALL_CENTER_MODULE,
            action: { [Op.in]: [CC_CALL_ACTION, CC_NOTE_ACTION, CC_SERVICE_DATE_ACTION] },
            userId: { [Op.ne]: null }
        },
        attributes: ['userId'],
        group: ['userId'],
        raw: true
    });
    const noteUsers = await db.PatientNote.findAll({
        where: { source: 'Call Center', userId: { [Op.ne]: null } },
        attributes: ['userId'],
        group: ['userId'],
        raw: true
    });
    const attemptUsers = await db.CallCenterCallAttempt.findAll({
        where: { userId: { [Op.ne]: null } },
        attributes: ['userId'],
        group: ['userId'],
        raw: true
    });
    const ids = Array.from(new Set([].concat(auditUsers, noteUsers, attemptUsers)
        .map(row => parseInt(row.userId, 10))
        .filter(id => Number.isFinite(id))));
    if (!ids.length) return [];
    const users = await db.User.findAll({
        where: { id: { [Op.in]: ids } },
        attributes: ['id', 'firstName', 'lastName', 'username']
    });
    return users
        .map(user => ({ userId: user.id, name: getUserLabel(user) }))
        .sort((a, b) => a.name.localeCompare(b.name));
}

async function getPaginatedCallCenterReport(query) {
    const pageSize = parsePositiveInt(query.pageSize, 10, 1, 500);
    const requestedPage = parsePositiveInt(query.page, 1, 1, 1000000);
    const sort = cleanString(query.sort) || 'lastActionAt';
    const dir = normalizeDir(query.dir);
    const selectedUserId = parseInt(query.userId, 10);
    const validUserId = Number.isFinite(selectedUserId) && selectedUserId > 0 ? selectedUserId : null;
    const range = ccRange(query);

    const auditWhere = {
        module: CALL_CENTER_MODULE,
        action: { [Op.in]: [CC_CALL_ACTION, CC_SERVICE_DATE_ACTION] },
        recordId: { [Op.ne]: null }
    };
    if (Object.keys(range.where).length) auditWhere.createdAt = range.where;
    if (validUserId) auditWhere.userId = validUserId;

    const noteWhere = { source: 'Call Center' };
    if (Object.keys(range.where).length) noteWhere.createdAt = range.where;
    if (validUserId) noteWhere.userId = validUserId;

    const [auditLogs, notes] = await Promise.all([
        db.AuditLog.findAll({
            where: auditWhere,
            attributes: ['createdAt', 'action', 'recordId', 'newValue', 'userId'],
            include: [{ model: db.User, attributes: ['id', 'firstName', 'lastName', 'username'], required: false }],
            order: [['createdAt', 'DESC']]
        }),
        db.PatientNote.findAll({
            where: noteWhere,
            attributes: ['patientId', 'note', 'createdAt', 'userId'],
            include: [{ model: db.User, as: 'Author', attributes: ['id', 'firstName', 'lastName', 'username'], required: false }],
            order: [['createdAt', 'DESC']]
        })
    ]);

    const byPatient = {};
    auditLogs.forEach(log => {
        const plain = log.toJSON ? log.toJSON() : log;
        const patientId = parseInt(plain.recordId, 10);
        if (!Number.isFinite(patientId)) return;
        const row = ccBucket(byPatient, patientId);
        const user = getUserLabel(plain.User);
        ccTouchRow(row, plain.createdAt, user);
        if (plain.action === CC_CALL_ACTION) {
            row.calls += 1;
            row.callHistory.push({ at: plain.createdAt, user });
        } else if (plain.action === CC_SERVICE_DATE_ACTION) {
            row.serviceDates += 1;
            row.serviceDateHistory.push({ at: plain.createdAt, user, serviceDate: auditServiceDate(plain.newValue) });
        }
    });

    notes.forEach(note => {
        const plain = note.toJSON ? note.toJSON() : note;
        const patientId = parseInt(plain.patientId, 10);
        if (!Number.isFinite(patientId)) return;
        const row = ccBucket(byPatient, patientId);
        const user = getUserLabel(plain.Author);
        row.notes += 1;
        row.noteHistory.push({ at: plain.createdAt, user, note: plain.note || '' });
        ccTouchRow(row, plain.createdAt, user);
    });

    const patientIds = Object.keys(byPatient).map(id => parseInt(id, 10)).filter(id => Number.isFinite(id));
    const patients = patientIds.length
        ? await db.Patient.findAll({
            where: { id: { [Op.in]: patientIds } },
            attributes: ['id', 'patientCode', 'firstName', 'lastName', 'phone', 'serviceDate', 'isActive', 'isDeleted'],
            include: [{ model: db.Clinic, attributes: ['name'], required: false }]
        })
        : [];
    const patientMap = new Map(patients.map(patient => [patient.id, patient.toJSON ? patient.toJSON() : patient]));

    let rows = Object.keys(byPatient).map(key => {
        const row = byPatient[key];
        const patient = patientMap.get(row.patientId) || {};
        row.patientCode = patient.patientCode || `PAT-${row.patientId}`;
        row.firstName = patient.firstName || '';
        row.lastName = patient.lastName || '';
        row.phone = patient.phone || '';
        row.clinicName = patient.Clinic ? patient.Clinic.name : '';
        row.serviceDate = patient.serviceDate || '';
        row.status = patient.isDeleted ? 'Deleted' : (patient.isActive === false ? 'Inactive' : 'Active');
        row.repeatCalls = Math.max(row.calls - 1, 0);
        row.usersText = Array.from(row.users).sort().join(', ');
        row.callHistoryText = ccHistoryText(row.callHistory, 'call');
        row.serviceDateHistoryText = ccHistoryText(row.serviceDateHistory, 'serviceDate');
        row.noteHistoryText = ccHistoryText(row.noteHistory, 'note');
        delete row.users;
        return row;
    }).filter(row => ccRowMatchesFilters(row, query));

    rows = ccSortRows(rows, sort, dir);
    const total = rows.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(requestedPage, totalPages);
    const start = query.exportAll === 'true' ? 0 : (page - 1) * pageSize;
    const end = query.exportAll === 'true' ? total : start + pageSize;
    const pageRows = rows.slice(start, end);
    const totals = rows.reduce((memo, row) => {
        memo.calls += row.calls || 0;
        memo.repeatCalls += row.repeatCalls || 0;
        memo.serviceDates += row.serviceDates || 0;
        memo.notes += row.notes || 0;
        return memo;
    }, { patients: total, calls: 0, repeatCalls: 0, serviceDates: 0, notes: 0 });

    return {
        rows: pageRows,
        total,
        page,
        pageSize,
        totalPages,
        sort,
        dir,
        totals,
        users: await getCallCenterReportUsers(),
        range: { from: range.fromIso, to: range.toIso }
    };
}

function callAttemptWhere(query) {
    const where = {};
    const range = ccRange(query);
    if (Object.keys(range.where).length) where.dialedAt = range.where;

    const userId = parseInt(query.userId, 10);
    if (Number.isFinite(userId) && userId > 0) where.userId = userId;

    const outcome = cleanString(query.outcome).toLowerCase();
    if (outcome) where.outcome = outcome;

    const filters = [
        ['patientCode', query.patientCode],
        ['patientName', [query.firstName, query.lastName].filter(Boolean).join(' ')],
        ['dialedNumber', query.phone],
        ['clinicName', query.clinic],
        ['extension', query.extension],
        ['agentName', query.agent]
    ];
    filters.forEach(([field, value]) => {
        const clean = cleanString(value);
        if (clean) where[field] = { [Op.iLike]: `%${clean}%` };
    });
    return { where, range };
}

function callAttemptOrder(sort, dir) {
    const allowed = new Set([
        'dialedAt', 'ringingAt', 'answeredAt', 'endedAt', 'outcome',
        'patientCode', 'patientName', 'agentName', 'extension', 'dialedNumber',
        'sipResponseCode', 'ringDurationSeconds', 'conversationDurationSeconds'
    ]);
    const field = allowed.has(sort) ? sort : 'dialedAt';
    return [[field, dir === 'asc' ? 'ASC' : 'DESC'], ['id', 'DESC']];
}

const CALL_ATTEMPT_TERMINAL_OUTCOMES = [
    'answered',
    'no_answer',
    'busy',
    'rejected',
    'unavailable',
    'cancelled',
    'failed'
];

function callAttemptSummaryMetricAttributes() {
    const terminal = CALL_ATTEMPT_TERMINAL_OUTCOMES.map(value => `'${value}'`).join(', ');
    return [
        [db.sequelize.literal('COUNT(*)'), 'attempts'],
        [db.sequelize.literal(`COUNT(*) FILTER (WHERE "outcome" IN (${terminal}))`), 'completed'],
        [db.sequelize.literal(`COUNT(*) FILTER (WHERE "outcome" = 'answered')`), 'answered'],
        [db.sequelize.literal(`COUNT(*) FILTER (WHERE "outcome" = 'no_answer')`), 'noAnswer'],
        [db.sequelize.literal(`COALESCE(SUM(CASE WHEN "outcome" = 'answered' THEN "conversationDurationSeconds" ELSE 0 END), 0)`), 'totalTalkSeconds'],
        [db.sequelize.literal(`COALESCE(ROUND(AVG(CASE WHEN "outcome" = 'answered' THEN "conversationDurationSeconds" END)), 0)`), 'averageTalkSeconds']
    ];
}

function normalizeCallAttemptSummaryRow(row, labelFallback) {
    const attempts = Number(row && row.attempts) || 0;
    const completed = Number(row && row.completed) || 0;
    const answered = Number(row && row.answered) || 0;
    const noAnswer = Number(row && row.noAnswer) || 0;
    const totalTalkSeconds = Number(row && row.totalTalkSeconds) || 0;
    const averageTalkSeconds = Number(row && row.averageTalkSeconds) || 0;
    const rate = value => completed ? Math.round((value / completed) * 1000) / 10 : 0;
    return {
        key: row && row.key !== undefined && row.key !== null ? String(row.key) : '',
        label: cleanString(row && row.label) || labelFallback,
        attempts,
        completed,
        answered,
        noAnswer,
        otherOutcomes: Math.max(0, completed - answered - noAnswer),
        inProgress: Math.max(0, attempts - completed),
        answerRate: rate(answered),
        noAnswerRate: rate(noAnswer),
        totalTalkSeconds,
        averageTalkSeconds
    };
}

async function getCallCenterSupervisorSummary(query) {
    const filters = callAttemptWhere(query);
    const metrics = callAttemptSummaryMetricAttributes();
    const timeZone = cleanString(process.env.TZ) || 'America/New_York';
    const localDateExpression = db.sequelize.literal(
        `TO_CHAR("dialedAt" AT TIME ZONE ${db.sequelize.escape(timeZone)}, 'YYYY-MM-DD')`
    );
    const agentLabelExpression = db.sequelize.literal(
        `COALESCE(NULLIF(BTRIM("agentName"), ''), 'Unknown agent')`
    );
    const clinicLabelExpression = db.sequelize.literal(
        `COALESCE(NULLIF(BTRIM("clinicName"), ''), 'Unassigned')`
    );

    const [totalRow, agentRows, clinicRows, dateRows] = await Promise.all([
        db.CallCenterCallAttempt.findOne({
            where: filters.where,
            attributes: metrics,
            raw: true
        }),
        db.CallCenterCallAttempt.findAll({
            where: filters.where,
            attributes: [
                [db.sequelize.cast(db.sequelize.col('userId'), 'varchar'), 'key'],
                [agentLabelExpression, 'label'],
                ...metrics
            ],
            group: ['userId', 'agentName'],
            raw: true
        }),
        db.CallCenterCallAttempt.findAll({
            where: filters.where,
            attributes: [
                [clinicLabelExpression, 'key'],
                [clinicLabelExpression, 'label'],
                ...metrics
            ],
            group: ['clinicName'],
            raw: true
        }),
        db.CallCenterCallAttempt.findAll({
            where: filters.where,
            attributes: [
                [localDateExpression, 'key'],
                [localDateExpression, 'label'],
                ...metrics
            ],
            group: [localDateExpression],
            raw: true
        })
    ]);

    const byVolumeThenName = (a, b) => b.attempts - a.attempts || a.label.localeCompare(b.label);
    const totals = normalizeCallAttemptSummaryRow(totalRow || {}, 'All calls');
    const byAgent = agentRows.map(row => normalizeCallAttemptSummaryRow(row, 'Unknown agent')).sort(byVolumeThenName);
    const byClinic = clinicRows.map(row => normalizeCallAttemptSummaryRow(row, 'Unassigned')).sort(byVolumeThenName);
    const byDate = dateRows
        .map(row => normalizeCallAttemptSummaryRow(row, 'Unknown date'))
        .sort((a, b) => b.key.localeCompare(a.key));

    return {
        range: { from: filters.range.fromIso, to: filters.range.toIso },
        timeZone,
        totals,
        byAgent,
        byClinic,
        byDate
    };
}

async function getPaginatedCallAttemptReport(query) {
    const pageSize = parsePositiveInt(query.pageSize, 20, 1, 500);
    const requestedPage = parsePositiveInt(query.page, 1, 1, 1000000);
    const sort = cleanString(query.sort) || 'dialedAt';
    const dir = normalizeDir(query.dir);
    const filters = callAttemptWhere(query);
    const total = await db.CallCenterCallAttempt.count({ where: filters.where });
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(requestedPage, totalPages);
    const exportAll = query.exportAll === 'true';
    const rows = await db.CallCenterCallAttempt.findAll({
        where: filters.where,
        order: callAttemptOrder(sort, dir),
        limit: exportAll ? Math.max(total, 1) : pageSize,
        offset: exportAll ? 0 : (page - 1) * pageSize
    });
    const metricRows = await db.CallCenterCallAttempt.findAll({
        where: filters.where,
        attributes: [
            'outcome',
            [db.sequelize.literal('COUNT(*)'), 'attemptCount'],
            [db.sequelize.literal('COUNT("ringDurationSeconds")'), 'ringCount'],
            [db.sequelize.literal('COALESCE(SUM("ringDurationSeconds"), 0)'), 'ringTotal'],
            [db.sequelize.literal('COUNT("conversationDurationSeconds")'), 'conversationCount'],
            [db.sequelize.literal('COALESCE(SUM("conversationDurationSeconds"), 0)'), 'conversationTotal']
        ],
        group: ['outcome'],
        raw: true
    });
    const outcomeCounts = {
        answered: 0,
        no_answer: 0,
        busy: 0,
        rejected: 0,
        unavailable: 0,
        cancelled: 0,
        failed: 0,
        in_progress: 0
    };
    let ringCount = 0;
    let ringTotal = 0;
    let conversationCount = 0;
    let totalConversationSeconds = 0;
    metricRows.forEach(row => {
        const key = row.outcome && Object.hasOwn(outcomeCounts, row.outcome) ? row.outcome : 'in_progress';
        outcomeCounts[key] += Number(row.attemptCount) || 0;
        ringCount += Number(row.ringCount) || 0;
        ringTotal += Number(row.ringTotal) || 0;
        conversationCount += Number(row.conversationCount) || 0;
        totalConversationSeconds += Number(row.conversationTotal) || 0;
    });
    const answered = outcomeCounts.answered;
    const completed = Math.max(0, total - outcomeCounts.in_progress);
    const users = await db.CallCenterCallAttempt.findAll({
        where: { userId: { [Op.ne]: null } },
        attributes: ['userId', 'agentName'],
        group: ['userId', 'agentName'],
        order: [['agentName', 'ASC']],
        raw: true
    });

    return {
        rows,
        total,
        page,
        pageSize,
        totalPages,
        sort,
        dir,
        range: { from: filters.range.fromIso, to: filters.range.toIso },
        users: users.map(row => ({ userId: row.userId, name: row.agentName || `User ${row.userId}` })),
        totals: {
            attempts: total,
            answered,
            completed,
            unanswered: Math.max(0, total - answered - outcomeCounts.in_progress),
            inProgress: outcomeCounts.in_progress,
            answerRate: completed ? Math.round((answered / completed) * 100) : 0,
            averageRingSeconds: ringCount ? Math.round(ringTotal / ringCount) : 0,
            averageConversationSeconds: conversationCount ? Math.round(totalConversationSeconds / conversationCount) : 0,
            totalConversationSeconds,
            outcomes: outcomeCounts
        }
    };
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

exports.getCallCenterReport = async (req, res) => {
    try {
        res.json(await getPaginatedCallCenterReport(req.query || {}));
    } catch (err) {
        console.error('[Reports] Call Center report error:', err);
        res.status(500).json({ error: err.message });
    }
};

exports.getCallCenterAttemptReport = async (req, res) => {
    try {
        res.json(await getPaginatedCallAttemptReport(req.query || {}));
    } catch (err) {
        console.error('[Reports] Call Center attempt report error:', err);
        res.status(500).json({ error: err.message });
    }
};

exports.getCallCenterSupervisorSummary = async (req, res) => {
    try {
        res.json(await getCallCenterSupervisorSummary(req.query || {}));
    } catch (err) {
        console.error('[Reports] Call Center supervisor summary error:', err);
        res.status(500).json({ error: err.message });
    }
};
