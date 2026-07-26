const db = require('../models');
const Op = db.Sequelize.Op;
const QueryTypes = db.Sequelize.QueryTypes;
const { getServiceWindowDays } = require('../utils/globalSettings');
const {
    getEligibilityCutoffIso,
    getCallCenterCutoffIso
} = require('../utils/serviceWindowEligibility');
const patientRxCompleteCsv = require('../utils/patientRxCompleteCsv');

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
    return [db.PatientTransportCompany, db.PharmacyTransportCompany, db.Clinic, db.Pharmacy];
}

function rxReportInclude() {
    return [
        { model: db.Patient, include: [db.Clinic] },
        db.Pharmacy,
        db.PatientTransportCompany,
        db.PharmacyTransportCompany,
        {
            model: db.RXWorkflowTracking,
            include: [
                db.WorkflowAction,
                { model: db.User, attributes: ['id', 'username', 'firstName', 'lastName'] }
            ]
        }
    ];
}

function enrichRxReportRows(rows) {
    return rows.map(row => {
        const plain = row.toJSON ? row.toJSON() : row;
        const stageHistory = (plain.RXWorkflowTrackings || [])
            .map(tracking => ({
                trackingId: tracking.id,
                actionId: tracking.workflowActionId,
                stage: tracking.WorkflowAction ? tracking.WorkflowAction.name : `Stage ${tracking.workflowActionId}`,
                sequenceNumber: tracking.WorkflowAction ? tracking.WorkflowAction.sequenceNumber : null,
                completionDate: tracking.completionDate || null,
                completedBy: getUserLabel(tracking.User)
            }))
            .sort((a, b) => {
                const sequenceA = Number.isFinite(Number(a.sequenceNumber)) ? Number(a.sequenceNumber) : Number.MAX_SAFE_INTEGER;
                const sequenceB = Number.isFinite(Number(b.sequenceNumber)) ? Number(b.sequenceNumber) : Number.MAX_SAFE_INTEGER;
                if (sequenceA !== sequenceB) return sequenceA - sequenceB;
                const dateA = a.completionDate ? new Date(a.completionDate).getTime() : 0;
                const dateB = b.completionDate ? new Date(b.completionDate).getTime() : 0;
                return dateA - dateB || Number(a.trackingId || 0) - Number(b.trackingId || 0);
            });
        plain.completedSteps = [...new Set(stageHistory.map(stage => stage.actionId).filter(Boolean))];
        plain.stageHistory = stageHistory;
        plain.currentStage = stageHistory.length ? stageHistory[stageHistory.length - 1] : null;
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

function exactPositiveId(rawValue) {
    const value = cleanString(rawValue);
    if (!value) return null;
    return /^\d+$/.test(value) && Number(value) > 0 ? Number(value) : false;
}

function patientReportFilters(query, replacements, totalSteps) {
    const where = ['(p."isDeleted" = FALSE OR p."isDeleted" IS NULL)'];
    const status = cleanString(query.status);
    const patientCode = cleanString(query.patientCode).toLowerCase();
    const firstName = cleanString(query.firstName).toLowerCase();
    const lastName = cleanString(query.lastName).toLowerCase();
    const phone = cleanString(query.phone).toLowerCase();
    const dob = isDateOnly(query.dob) ? query.dob : '';
    const transport = cleanString(query.transport).toLowerCase();
    const clinic = cleanString(query.clinic).toLowerCase();
    const dateFrom = isDateOnly(query.serviceFrom || query.dateFrom) ? (query.serviceFrom || query.dateFrom) : '';
    const dateTo = isDateOnly(query.serviceTo || query.dateTo) ? (query.serviceTo || query.dateTo) : '';
    const patientType = cleanString(query.patientType);
    const missingInfo = cleanString(query.missingInfo);
    const eligibility = cleanString(query.eligibility);
    const rxStatus = cleanString(query.rxStatus);
    const exactIds = [
        ['clinicId', query.clinicId, 'p."clinicId"'],
        ['pharmacyId', query.pharmacyId, 'p."pharmacyId"'],
        ['patientTransportId', query.patientTransportId, 'p."patientTransportCompanyId"'],
        ['pharmacyTransportId', query.pharmacyTransportId, 'p."pharmacyTransportCompanyId"']
    ];
    replacements.totalSteps = totalSteps;

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
    if (dob) {
        replacements.dob = dob;
        where.push('p."dob" = :dob');
    }
    exactIds.forEach(([key, rawValue, sql]) => {
        const value = exactPositiveId(rawValue);
        if (value === null) return;
        if (value === false) {
            where.push('FALSE');
            return;
        }
        replacements[key] = value;
        where.push(`${sql} = :${key}`);
    });
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
    if (patientType === 'company') {
        where.push('(p."isNonCompanyPatient" = FALSE OR p."isNonCompanyPatient" IS NULL)');
    } else if (patientType === 'non_company') {
        where.push('p."isNonCompanyPatient" = TRUE');
    } else if (patientType) {
        where.push('FALSE');
    }

    const missingByKey = {
        clinic: 'p."clinicId" IS NULL',
        pharmacy: 'p."pharmacyId" IS NULL',
        patientTransport: 'p."patientTransportCompanyId" IS NULL',
        pharmacyTransport: 'p."pharmacyTransportCompanyId" IS NULL'
    };
    if (missingByKey[missingInfo]) {
        where.push(missingByKey[missingInfo]);
    } else if (missingInfo === 'any') {
        where.push(`(${Object.values(missingByKey).join(' OR ')})`);
    } else if (missingInfo === 'all') {
        where.push(`(${Object.values(missingByKey).join(' AND ')})`);
    } else if (missingInfo) {
        where.push('FALSE');
    }

    if (eligibility) {
        replacements.eligibilityCutoff = getEligibilityCutoffIso(new Date());
        replacements.callCenterCutoff = getCallCenterCutoffIso(new Date());
        where.push('p."isActive" = TRUE');
        if (eligibility === 'needsAction') {
            where.push('p."serviceDate" < :eligibilityCutoff');
            where.push(`:totalSteps > 0 AND EXISTS (
                SELECT 1
                FROM "RXRecords" rx_action
                WHERE rx_action."patientId" = p.id
                  AND COALESCE(rx_action."isDeleted", FALSE) = FALSE
                  AND (
                      SELECT COUNT(*)
                      FROM "RXWorkflowTrackings" tracking_action
                      WHERE tracking_action."rxRecordId" = rx_action.id
                  ) < :totalSteps
            )`);
        } else if (eligibility === 'none') {
            where.push('p."serviceDate" IS NULL');
        } else if (eligibility === 'eligible') {
            where.push('p."serviceDate" <= :eligibilityCutoff');
        } else if (eligibility === 'expiring') {
            where.push('p."serviceDate" > :eligibilityCutoff');
            where.push('p."serviceDate" <= :callCenterCutoff');
        } else if (eligibility === 'window') {
            where.push('p."serviceDate" > :callCenterCutoff');
        } else {
            where.push('FALSE');
        }
    }

    const activeRxExists = `EXISTS (
        SELECT 1
        FROM "RXRecords" rx_presence
        WHERE rx_presence."patientId" = p.id
          AND COALESCE(rx_presence."isDeleted", FALSE) = FALSE
    )`;
    if (rxStatus === 'has_rx') {
        where.push(activeRxExists);
    } else if (rxStatus === 'no_rx') {
        where.push(`NOT ${activeRxExists}`);
    } else if (rxStatus) {
        where.push('FALSE');
    }
    return where;
}

function patientReportFromSql() {
    return `
        FROM "Patients" p
        LEFT JOIN "PatientTransportCompanies" pt ON pt.id = p."patientTransportCompanyId"
        LEFT JOIN "PharmacyTransportCompanies" pht ON pht.id = p."pharmacyTransportCompanyId"
        LEFT JOIN "Clinics" c ON c.id = p."clinicId"
        LEFT JOIN "Pharmacies" ph ON ph.id = p."pharmacyId"
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
        isNonCompanyPatient: 'p."isNonCompanyPatient"',
        'Clinic.name': 'LOWER(COALESCE(c."name", \'\'))',
        'Pharmacy.name': 'LOWER(COALESCE(ph."name", \'\'))',
        'PatientTransportCompany.companyName': 'LOWER(COALESCE(pt."companyName", \'\'))',
        'PharmacyTransportCompany.companyName': 'LOWER(COALESCE(pht."companyName", \'\'))',
        id: 'p.id'
    };
    return allowed[sort] || allowed.id;
}

async function getPatientRxDetailRows(query, patientIdsOverride) {
    const totalSteps = await db.WorkflowAction.count({ where: { isActive: true } });
    const replacements = {};
    const where = patientReportFilters(query, replacements, totalSteps);
    if (Array.isArray(patientIdsOverride)) {
        if (!patientIdsOverride.length) return [];
        replacements.exportPatientIds = patientIdsOverride;
        where.push('p.id IN (:exportPatientIds)');
    }
    const fromSql = patientReportFromSql();
    const rows = await db.sequelize.query(
        `
        WITH filtered_patients AS (
            SELECT p.id
            ${fromSql}
            WHERE ${where.join(' AND ')}
        )
        SELECT
            p.id AS "patientDatabaseId",
            p."patientCode",
            p."firstName",
            p."lastName",
            p.dob,
            p.phone,
            p.address,
            p."serviceDate" AS "patientServiceDate",
            p."isActive" AS "patientIsActive",
            p."isNonCompanyPatient",
            p."clinicId",
            p."pharmacyId" AS "defaultPharmacyId",
            p."patientTransportCompanyId" AS "defaultPatientTransportId",
            p."pharmacyTransportCompanyId" AS "defaultPharmacyTransportId",
            p.notes AS "patientNotes",
            p."createdAt" AS "patientCreatedAt",
            p."updatedAt" AS "patientUpdatedAt",
            c.name AS "clinicName",
            c.address AS "clinicAddress",
            c.phone AS "clinicPhone",
            ph.name AS "defaultPharmacyName",
            ph.address AS "defaultPharmacyAddress",
            ph.phone AS "defaultPharmacyPhone",
            pt."companyName" AS "defaultPatientTransport",
            pt.phone AS "defaultPatientTransportPhone",
            pht."companyName" AS "defaultPharmacyTransport",
            pht.phone AS "defaultPharmacyTransportPhone",
            COUNT(r.id) OVER (PARTITION BY p.id)::integer AS "patientRxCount",
            CASE WHEN r.id IS NULL THEN NULL
                 ELSE ROW_NUMBER() OVER (PARTITION BY p.id ORDER BY r.id)::integer
            END AS "patientRxRow",
            r.id AS "rxId",
            r."patientServiceDateCycleId",
            r."arrivalDate" AS "rxArrivalDate",
            r."serviceDate" AS "rxServiceDate",
            r."pharmacyId" AS "rxPharmacyId",
            r."patientTransportCompanyId" AS "rxPatientTransportId",
            r."pharmacyTransportCompanyId" AS "rxPharmacyTransportId",
            rx_ph.name AS "rxPharmacyName",
            rx_ph.address AS "rxPharmacyAddress",
            rx_ph.phone AS "rxPharmacyPhone",
            rx_pt."companyName" AS "rxPatientTransport",
            rx_pt.phone AS "rxPatientTransportPhone",
            rx_pht."companyName" AS "rxPharmacyTransport",
            rx_pht.phone AS "rxPharmacyTransportPhone",
            r."returnedToWarehouse",
            r."warehouseReturnDate",
            r."warehouseReturnNote",
            r."createdAt" AS "rxCreatedAt",
            r."updatedAt" AS "rxUpdatedAt",
            COALESCE(med.medications, '') AS medications,
            COALESCE(wf."completedSteps", 0)::integer AS "completedSteps",
            :totalSteps::integer AS "totalWorkflowSteps",
            current_stage."currentStage",
            current_stage."currentStageDate",
            current_stage."currentStageCompletedBy",
            next_stage."nextPendingStage",
            COALESCE(wf."workflowStageHistory", '') AS "workflowStageHistory",
            COALESCE(wf."workflowStageDetails", '[]'::jsonb) AS "workflowStageDetails",
            COALESCE(patient_notes."patientNoteHistory", '') AS "patientNoteHistory",
            COALESCE(service_history."serviceDateHistory", '') AS "serviceDateHistory"
        FROM filtered_patients fp
        JOIN "Patients" p ON p.id = fp.id
        LEFT JOIN "Clinics" c ON c.id = p."clinicId"
        LEFT JOIN "Pharmacies" ph ON ph.id = p."pharmacyId"
        LEFT JOIN "PatientTransportCompanies" pt ON pt.id = p."patientTransportCompanyId"
        LEFT JOIN "PharmacyTransportCompanies" pht ON pht.id = p."pharmacyTransportCompanyId"
        LEFT JOIN "RXRecords" r
          ON r."patientId" = p.id
         AND COALESCE(r."isDeleted", FALSE) = FALSE
        LEFT JOIN "Pharmacies" rx_ph ON rx_ph.id = r."pharmacyId"
        LEFT JOIN "PatientTransportCompanies" rx_pt ON rx_pt.id = r."patientTransportCompanyId"
        LEFT JOIN "PharmacyTransportCompanies" rx_pht ON rx_pht.id = r."pharmacyTransportCompanyId"
        LEFT JOIN LATERAL (
            SELECT STRING_AGG(
                CONCAT(
                    COALESCE(m.name, ''),
                    CASE WHEN m.quantity IS NOT NULL THEN CONCAT(' (Qty ', m.quantity, ')') ELSE '' END,
                    CASE WHEN NULLIF(BTRIM(COALESCE(m.notes, '')), '') IS NOT NULL
                         THEN CONCAT(' - ', REGEXP_REPLACE(m.notes, E'[\\r\\n]+', ' ', 'g'))
                         ELSE '' END
                ),
                E'\\n' ORDER BY m.id
            ) AS medications
            FROM "Medications" m
            WHERE m."rxRecordId" = r.id
        ) med ON TRUE
        LEFT JOIN LATERAL (
            SELECT
                COUNT(*)::integer AS "completedSteps",
                STRING_AGG(
                    CONCAT(
                        COALESCE(wa."sequenceNumber"::text, '?'), '. ',
                        COALESCE(wa.name, CONCAT('Stage ', wt."workflowActionId")),
                        ' | ', TO_CHAR(wt."completionDate", 'YYYY-MM-DD HH24:MI:SS'),
                        ' | ', COALESCE(
                            NULLIF(BTRIM(CONCAT_WS(' ', u."firstName", u."lastName")), ''),
                            u.username,
                            'System'
                        )
                    ),
                    E'\\n' ORDER BY wa."sequenceNumber", wt."completionDate", wt.id
                ) AS "workflowStageHistory",
                JSONB_AGG(
                    JSONB_BUILD_OBJECT(
                        'workflowActionId', wt."workflowActionId",
                        'sequenceNumber', wa."sequenceNumber",
                        'stage', COALESCE(wa.name, CONCAT('Stage ', wt."workflowActionId")),
                        'completionDate', wt."completionDate",
                        'completedBy', COALESCE(
                            NULLIF(BTRIM(CONCAT_WS(' ', u."firstName", u."lastName")), ''),
                            u.username,
                            'System'
                        )
                    )
                    ORDER BY wa."sequenceNumber", wt."completionDate", wt.id
                ) AS "workflowStageDetails"
            FROM "RXWorkflowTrackings" wt
            LEFT JOIN "WorkflowActions" wa ON wa.id = wt."workflowActionId"
            LEFT JOIN "Users" u ON u.id = wt."userId"
            WHERE wt."rxRecordId" = r.id
        ) wf ON TRUE
        LEFT JOIN LATERAL (
            SELECT
                wa.name AS "currentStage",
                wt."completionDate" AS "currentStageDate",
                COALESCE(
                    NULLIF(BTRIM(CONCAT_WS(' ', u."firstName", u."lastName")), ''),
                    u.username,
                    'System'
                ) AS "currentStageCompletedBy"
            FROM "RXWorkflowTrackings" wt
            LEFT JOIN "WorkflowActions" wa ON wa.id = wt."workflowActionId"
            LEFT JOIN "Users" u ON u.id = wt."userId"
            WHERE wt."rxRecordId" = r.id
            ORDER BY wa."sequenceNumber" DESC NULLS LAST, wt."completionDate" DESC, wt.id DESC
            LIMIT 1
        ) current_stage ON TRUE
        LEFT JOIN LATERAL (
            SELECT wa.name AS "nextPendingStage"
            FROM "WorkflowActions" wa
            WHERE r.id IS NOT NULL
              AND wa."isActive" = TRUE
              AND NOT EXISTS (
                  SELECT 1
                  FROM "RXWorkflowTrackings" wt
                  WHERE wt."rxRecordId" = r.id
                    AND wt."workflowActionId" = wa.id
              )
            ORDER BY wa."sequenceNumber", wa.id
            LIMIT 1
        ) next_stage ON TRUE
        LEFT JOIN LATERAL (
            SELECT STRING_AGG(
                CONCAT(
                    TO_CHAR(pn."createdAt", 'YYYY-MM-DD HH24:MI:SS'),
                    ' | ', COALESCE(pn.source, 'Patient'),
                    ' | ', COALESCE(
                        NULLIF(BTRIM(CONCAT_WS(' ', note_user."firstName", note_user."lastName")), ''),
                        note_user.username,
                        'System'
                    ),
                    ' | ', REGEXP_REPLACE(COALESCE(pn.note, ''), E'[\\r\\n]+', ' ', 'g')
                ),
                E'\\n' ORDER BY pn."createdAt", pn.id
            ) AS "patientNoteHistory"
            FROM "PatientNotes" pn
            LEFT JOIN "Users" note_user ON note_user.id = pn."userId"
            WHERE pn."patientId" = p.id
        ) patient_notes ON TRUE
        LEFT JOIN LATERAL (
            SELECT STRING_AGG(
                CONCAT(
                    TO_CHAR(psh."createdAt", 'YYYY-MM-DD HH24:MI:SS'),
                    ' | ', COALESCE(psh."previousServiceDate"::text, 'blank'),
                    ' -> ', COALESCE(psh."newServiceDate"::text, 'blank'),
                    ' | ', COALESCE(psh."changeSource", 'Patient Update'),
                    ' | ', COALESCE(
                        NULLIF(BTRIM(CONCAT_WS(' ', date_user."firstName", date_user."lastName")), ''),
                        date_user.username,
                        'System'
                    ),
                    CASE WHEN NULLIF(BTRIM(COALESCE(psh.reason, '')), '') IS NOT NULL
                         THEN CONCAT(' | ', REGEXP_REPLACE(psh.reason, E'[\\r\\n]+', ' ', 'g'))
                         ELSE '' END
                ),
                E'\\n' ORDER BY psh."createdAt", psh.id
            ) AS "serviceDateHistory"
            FROM "PatientServiceDateHistories" psh
            LEFT JOIN "Users" date_user ON date_user.id = psh."changedByUserId"
            WHERE psh."patientId" = p.id
        ) service_history ON TRUE
        ORDER BY
            LOWER(COALESCE(p."patientCode", '')),
            LOWER(COALESCE(p."lastName", '')),
            LOWER(COALESCE(p."firstName", '')),
            p.id,
            r.id
        `,
        { type: QueryTypes.SELECT, replacements }
    );
    return rows;
}

const PATIENT_RX_EXPORT_USER_ATTRIBUTES = ['id', 'username', 'firstName', 'lastName'];
const PATIENT_RX_ONLY_FIELDS = [
    'patientRxRow',
    'rxId',
    'patientServiceDateCycleId',
    'rxArrivalDate',
    'rxServiceDate',
    'rxPharmacyId',
    'rxPatientTransportId',
    'rxPharmacyTransportId',
    'rxPharmacyName',
    'rxPharmacyAddress',
    'rxPharmacyPhone',
    'rxPatientTransport',
    'rxPatientTransportPhone',
    'rxPharmacyTransport',
    'rxPharmacyTransportPhone',
    'returnedToWarehouse',
    'warehouseReturnDate',
    'warehouseReturnNote',
    'rxCreatedAt',
    'rxUpdatedAt',
    'medications',
    'completedSteps',
    'totalWorkflowSteps',
    'currentStage',
    'currentStageDate',
    'currentStageCompletedBy',
    'nextPendingStage',
    'workflowStageHistory',
    'workflowStageDetails'
];

function patientOnlyExportBase(row) {
    const result = { ...row };
    PATIENT_RX_ONLY_FIELDS.forEach(field => { result[field] = null; });
    return result;
}

function plainExportRow(row) {
    return row && typeof row.toJSON === 'function' ? row.toJSON() : row;
}

function exportJson(value) {
    if (value === undefined || value === null || value === '') return '';
    if (typeof value === 'string') return value;
    try { return JSON.stringify(value); } catch (error) { return String(value); }
}

function groupExportRows(rows, field) {
    const groups = new Map();
    (rows || []).forEach(item => {
        const row = plainExportRow(item);
        const key = row && row[field];
        if (key === undefined || key === null) return;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(row);
    });
    return groups;
}

function completeExportRow(base, recordType, recordScope, details) {
    return {
        ...base,
        exportSchemaVersion: 1,
        recordType,
        recordScope,
        detailRecordId: '',
        detailDefinitionId: '',
        detailParentId: '',
        detailSequence: '',
        detailStatus: '',
        detailName: '',
        eventDate: '',
        eventEndDate: '',
        actor: '',
        previousValue: '',
        newValue: '',
        quantity: '',
        source: '',
        detailNotes: '',
        metadataJson: '',
        detailCreatedAt: '',
        detailUpdatedAt: '',
        attachmentOwnerType: '',
        attachmentOriginalName: '',
        attachmentStoredName: '',
        attachmentMimeType: '',
        attachmentSizeBytes: '',
        attachmentProvider: '',
        attachmentExternalFileId: '',
        attachmentLink: '',
        attachmentLocalPath: '',
        attachmentDeletedAt: '',
        callCorrelationId: '',
        callDirection: '',
        callPhoneClient: '',
        callExtension: '',
        callDialedNumber: '',
        callSipResponseCode: '',
        callSipReason: '',
        callRingingAt: '',
        callAnsweredAt: '',
        callRingSeconds: '',
        callConversationSeconds: '',
        ...(details || {})
    };
}

async function getPatientRxCompleteExportRows(query, patientIdsOverride) {
    const summaryRows = await getPatientRxDetailRows(query, patientIdsOverride);
    if (!summaryRows.length) return [];

    const patientIds = [...new Set(summaryRows.map(row => row.patientDatabaseId).filter(Boolean))];
    const rxIds = [...new Set(summaryRows.map(row => row.rxId).filter(value => value !== null && value !== undefined))];
    const userInclude = attributes => ({
        model: db.User,
        as: attributes,
        attributes: PATIENT_RX_EXPORT_USER_ATTRIBUTES,
        required: false
    });

    const [
        medications,
        workflowTrackings,
        workflowActions,
        rxHistories,
        patientNotes,
        serviceDateHistories,
        serviceDateCycles,
        documents,
        callAttempts
    ] = await Promise.all([
        rxIds.length
            ? db.Medication.findAll({ where: { rxRecordId: { [Op.in]: rxIds } }, order: [['rxRecordId', 'ASC'], ['id', 'ASC']] })
            : [],
        rxIds.length
            ? db.RXWorkflowTracking.findAll({
                where: { rxRecordId: { [Op.in]: rxIds } },
                include: [
                    { model: db.WorkflowAction, required: false },
                    { model: db.User, attributes: PATIENT_RX_EXPORT_USER_ATTRIBUTES, required: false }
                ],
                order: [['rxRecordId', 'ASC'], ['completionDate', 'ASC'], ['id', 'ASC']]
            })
            : [],
        rxIds.length
            ? db.WorkflowAction.findAll({ order: [['sequenceNumber', 'ASC'], ['id', 'ASC']] })
            : [],
        rxIds.length
            ? db.RXHistory.findAll({
                where: { rxRecordId: { [Op.in]: rxIds } },
                include: [userInclude('ChangedBy')],
                order: [['rxRecordId', 'ASC'], ['createdAt', 'ASC'], ['id', 'ASC']]
            })
            : [],
        db.PatientNote.findAll({
            where: { patientId: { [Op.in]: patientIds } },
            include: [userInclude('Author')],
            order: [['patientId', 'ASC'], ['createdAt', 'ASC'], ['id', 'ASC']]
        }),
        db.PatientServiceDateHistory.findAll({
            where: { patientId: { [Op.in]: patientIds } },
            include: [userInclude('ChangedBy')],
            order: [['patientId', 'ASC'], ['createdAt', 'ASC'], ['id', 'ASC']]
        }),
        db.PatientServiceDateCycle.findAll({
            where: { patientId: { [Op.in]: patientIds } },
            include: [userInclude('CreatedBy')],
            order: [['patientId', 'ASC'], ['serviceDate', 'ASC'], ['id', 'ASC']]
        }),
        db.DocumentAttachment.findAll({
            where: {
                [Op.or]: [
                    { patientId: { [Op.in]: patientIds } },
                    ...(rxIds.length ? [{ rxRecordId: { [Op.in]: rxIds } }] : [])
                ]
            },
            include: [userInclude('UploadedBy')],
            order: [['patientId', 'ASC'], ['rxRecordId', 'ASC'], ['createdAt', 'ASC'], ['id', 'ASC']]
        }),
        db.CallCenterCallAttempt.findAll({
            where: { patientId: { [Op.in]: patientIds } },
            include: [userInclude('Agent')],
            order: [['patientId', 'ASC'], ['dialedAt', 'ASC'], ['id', 'ASC']]
        })
    ]);

    const medicationByRx = groupExportRows(medications, 'rxRecordId');
    const trackingByRx = groupExportRows(workflowTrackings, 'rxRecordId');
    const historyByRx = groupExportRows(rxHistories, 'rxRecordId');
    const notesByPatient = groupExportRows(patientNotes, 'patientId');
    const serviceHistoryByPatient = groupExportRows(serviceDateHistories, 'patientId');
    const cyclesByPatient = groupExportRows(serviceDateCycles, 'patientId');
    const callsByPatient = groupExportRows(callAttempts, 'patientId');
    const documentsByPatient = new Map();
    const documentsByRx = new Map();
    documents.map(plainExportRow).forEach(document => {
        const target = document.rxRecordId ? documentsByRx : documentsByPatient;
        const key = document.rxRecordId || document.patientId;
        if (key === undefined || key === null) return;
        if (!target.has(key)) target.set(key, []);
        target.get(key).push(document);
    });

    const actionRows = workflowActions.map(plainExportRow);
    const patientGroups = new Map();
    summaryRows.forEach(row => {
        if (!patientGroups.has(row.patientDatabaseId)) {
            patientGroups.set(row.patientDatabaseId, { base: patientOnlyExportBase(row), rxRows: [] });
        }
        if (row.rxId === null || row.rxId === undefined) {
            patientGroups.get(row.patientDatabaseId).noRxRow = row;
        } else {
            patientGroups.get(row.patientDatabaseId).rxRows.push(row);
        }
    });

    const result = [];
    const addDocument = (base, document, scope) => {
        result.push(completeExportRow(base, 'DOCUMENT_ATTACHMENT', scope, {
            detailRecordId: document.id,
            detailParentId: document.rxRecordId || document.patientId || '',
            detailStatus: document.isDeleted ? 'Deleted' : 'Active',
            detailName: document.originalName || '',
            eventDate: document.createdAt || '',
            actor: getUserLabel(document.UploadedBy),
            source: document.provider || '',
            detailNotes: document.mimeType || '',
            detailCreatedAt: document.createdAt || '',
            detailUpdatedAt: document.updatedAt || '',
            attachmentOwnerType: document.ownerType || '',
            attachmentOriginalName: document.originalName || '',
            attachmentStoredName: document.storedName || '',
            attachmentMimeType: document.mimeType || '',
            attachmentSizeBytes: document.sizeBytes || 0,
            attachmentProvider: document.provider || '',
            attachmentExternalFileId: document.driveFileId || '',
            attachmentLink: document.driveWebViewLink || '',
            attachmentLocalPath: document.localPath || '',
            attachmentDeletedAt: document.deletedAt || ''
        }));
    };

    patientGroups.forEach(group => {
        const patientBase = group.base;
        const patientId = patientBase.patientDatabaseId;

        if (!group.rxRows.length) {
            result.push(completeExportRow(group.noRxRow || patientBase, 'PATIENT_RX', 'PATIENT', {
                detailParentId: patientId,
                detailStatus: 'No RX'
            }));
        } else {
            group.rxRows.forEach(rxBase => {
                result.push(completeExportRow(rxBase, 'PATIENT_RX', 'RX', {
                    detailRecordId: rxBase.rxId,
                    detailParentId: patientId,
                    detailStatus: 'Current',
                    detailName: `RX-${rxBase.rxId}`,
                    eventDate: rxBase.rxCreatedAt || ''
                }));
            });
        }

        (notesByPatient.get(patientId) || []).forEach(note => {
            result.push(completeExportRow(patientBase, 'PATIENT_NOTE', 'PATIENT', {
                detailRecordId: note.id,
                detailParentId: patientId,
                detailStatus: 'Recorded',
                detailName: 'Patient Note',
                eventDate: note.createdAt || '',
                actor: getUserLabel(note.Author),
                source: note.source || 'Patient',
                detailNotes: note.note || '',
                detailCreatedAt: note.createdAt || '',
                detailUpdatedAt: note.updatedAt || ''
            }));
        });
        (serviceHistoryByPatient.get(patientId) || []).forEach(history => {
            result.push(completeExportRow(patientBase, 'SERVICE_DATE_HISTORY', 'PATIENT', {
                detailRecordId: history.id,
                detailParentId: patientId,
                detailStatus: 'Changed',
                detailName: 'Patient Service Date',
                eventDate: history.createdAt || '',
                actor: getUserLabel(history.ChangedBy),
                previousValue: history.previousServiceDate || '',
                newValue: history.newServiceDate || '',
                source: history.changeSource || '',
                detailNotes: history.reason || '',
                metadataJson: exportJson(history.metadata),
                detailCreatedAt: history.createdAt || '',
                detailUpdatedAt: history.updatedAt || ''
            }));
        });
        (cyclesByPatient.get(patientId) || []).forEach(cycle => {
            result.push(completeExportRow(patientBase, 'SERVICE_DATE_CYCLE', 'PATIENT', {
                detailRecordId: cycle.id,
                detailParentId: patientId,
                detailStatus: cycle.status || '',
                detailName: 'Patient Service Date Cycle',
                eventDate: cycle.startedAt || cycle.createdAt || '',
                eventEndDate: cycle.endedAt || '',
                actor: getUserLabel(cycle.CreatedBy),
                newValue: cycle.serviceDate || '',
                source: cycle.source || '',
                metadataJson: exportJson(cycle.metadata),
                detailCreatedAt: cycle.createdAt || '',
                detailUpdatedAt: cycle.updatedAt || ''
            }));
        });
        (callsByPatient.get(patientId) || []).forEach(call => {
            result.push(completeExportRow(patientBase, 'CALL_ATTEMPT', 'PATIENT', {
                detailRecordId: call.id,
                detailParentId: patientId,
                detailStatus: call.outcome || call.state || '',
                detailName: 'Call Attempt',
                eventDate: call.dialedAt || '',
                eventEndDate: call.endedAt || '',
                actor: call.Agent ? getUserLabel(call.Agent) : (call.agentName || 'System'),
                source: `${call.phoneClient || ''}${call.direction ? ` / ${call.direction}` : ''}`,
                detailNotes: call.sipReason || '',
                metadataJson: exportJson({
                    state: call.state,
                    patientCodeSnapshot: call.patientCode,
                    patientNameSnapshot: call.patientName,
                    clinicNameSnapshot: call.clinicName,
                    agentNameSnapshot: call.agentName,
                    calledAuditLogId: call.calledAuditLogId
                }),
                detailCreatedAt: call.createdAt || '',
                detailUpdatedAt: call.updatedAt || '',
                callCorrelationId: call.correlationId || '',
                callDirection: call.direction || '',
                callPhoneClient: call.phoneClient || '',
                callExtension: call.extension || '',
                callDialedNumber: call.dialedNumber || '',
                callSipResponseCode: call.sipResponseCode || '',
                callSipReason: call.sipReason || '',
                callRingingAt: call.ringingAt || '',
                callAnsweredAt: call.answeredAt || '',
                callRingSeconds: call.ringDurationSeconds === null ? '' : call.ringDurationSeconds,
                callConversationSeconds: call.conversationDurationSeconds === null ? '' : call.conversationDurationSeconds
            }));
        });
        (documentsByPatient.get(patientId) || []).forEach(document => addDocument(patientBase, document, 'PATIENT'));

        group.rxRows.forEach(rxBase => {
            const rxId = rxBase.rxId;
            (medicationByRx.get(rxId) || []).forEach(medication => {
                result.push(completeExportRow(rxBase, 'MEDICATION', 'RX', {
                    detailRecordId: medication.id,
                    detailParentId: rxId,
                    detailStatus: 'Recorded',
                    detailName: medication.name || '',
                    eventDate: medication.createdAt || '',
                    quantity: medication.quantity === null ? '' : medication.quantity,
                    source: 'RX Medication',
                    detailNotes: medication.notes || '',
                    detailCreatedAt: medication.createdAt || '',
                    detailUpdatedAt: medication.updatedAt || ''
                }));
            });

            const trackedRows = trackingByRx.get(rxId) || [];
            const trackingByAction = groupExportRows(trackedRows, 'workflowActionId');
            const emittedTrackingIds = new Set();
            actionRows.filter(action => action.isActive).forEach(action => {
                const matches = trackingByAction.get(action.id) || [];
                if (!matches.length) {
                    result.push(completeExportRow(rxBase, 'WORKFLOW_STEP', 'RX', {
                        detailDefinitionId: action.id,
                        detailParentId: rxId,
                        detailSequence: action.sequenceNumber,
                        detailStatus: 'Pending',
                        detailName: action.name || '',
                        source: 'RX Workflow',
                        detailNotes: action.description || '',
                        metadataJson: exportJson({ workflowActionActive: true })
                    }));
                    return;
                }
                matches.forEach(tracking => {
                    emittedTrackingIds.add(tracking.id);
                    result.push(completeExportRow(rxBase, 'WORKFLOW_STEP', 'RX', {
                        detailRecordId: tracking.id,
                        detailDefinitionId: action.id,
                        detailParentId: rxId,
                        detailSequence: action.sequenceNumber,
                        detailStatus: 'Completed',
                        detailName: action.name || '',
                        eventDate: tracking.completionDate || '',
                        actor: getUserLabel(tracking.User),
                        source: 'RX Workflow',
                        detailNotes: action.description || '',
                        metadataJson: exportJson({ workflowActionActive: true }),
                        detailCreatedAt: tracking.createdAt || '',
                        detailUpdatedAt: tracking.updatedAt || ''
                    }));
                });
            });
            trackedRows.filter(tracking => !emittedTrackingIds.has(tracking.id)).forEach(tracking => {
                const action = tracking.WorkflowAction || {};
                result.push(completeExportRow(rxBase, 'WORKFLOW_STEP', 'RX', {
                    detailRecordId: tracking.id,
                    detailDefinitionId: tracking.workflowActionId || '',
                    detailParentId: rxId,
                    detailSequence: action.sequenceNumber || '',
                    detailStatus: 'Completed Historical',
                    detailName: action.name || `Stage ${tracking.workflowActionId || ''}`,
                    eventDate: tracking.completionDate || '',
                    actor: getUserLabel(tracking.User),
                    source: 'RX Workflow',
                    detailNotes: action.description || '',
                    metadataJson: exportJson({ workflowActionActive: Boolean(action.isActive) }),
                    detailCreatedAt: tracking.createdAt || '',
                    detailUpdatedAt: tracking.updatedAt || ''
                }));
            });

            (historyByRx.get(rxId) || []).forEach(history => {
                result.push(completeExportRow(rxBase, 'RX_CHANGE_HISTORY', 'RX', {
                    detailRecordId: history.id,
                    detailParentId: rxId,
                    detailStatus: history.changeType || 'Update',
                    detailName: 'RX Change',
                    eventDate: history.createdAt || '',
                    actor: getUserLabel(history.ChangedBy),
                    previousValue: history.snapshot || '',
                    newValue: history.changedFields || '',
                    source: 'RX History',
                    detailNotes: history.note || '',
                    detailCreatedAt: history.createdAt || ''
                }));
            });
            (documentsByRx.get(rxId) || []).forEach(document => addDocument(rxBase, document, 'RX'));
        });
    });

    return result;
}

async function getPatientRxExportPatientIds(query) {
    const totalSteps = await db.WorkflowAction.count({ where: { isActive: true } });
    const replacements = {};
    const where = patientReportFilters(query, replacements, totalSteps);
    const rows = await db.sequelize.query(
        `SELECT p.id
         ${patientReportFromSql()}
         WHERE ${where.join(' AND ')}
         ORDER BY
             LOWER(COALESCE(p."patientCode", '')),
             LOWER(COALESCE(p."lastName", '')),
             LOWER(COALESCE(p."firstName", '')),
             p.id`,
        { type: QueryTypes.SELECT, replacements }
    );
    return rows.map(row => row.id);
}

function writeExportChunk(res, chunk) {
    if (res.write(chunk)) return Promise.resolve();
    return new Promise(resolve => {
        const finish = () => {
            res.removeListener('drain', finish);
            res.removeListener('close', finish);
            resolve();
        };
        res.once('drain', finish);
        res.once('close', finish);
    });
}

async function streamPatientRxCompleteCsv(req, res) {
    const patientIds = await getPatientRxExportPatientIds(req.query || {});
    const filename = `patient_rx_complete_history_${new Date().toISOString().slice(0, 10)}.csv`;
    res.status(200);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    await writeExportChunk(res, `\uFEFF${patientRxCompleteCsv.headerLine()}\r\n`);

    const batchSize = 250;
    for (let offset = 0; offset < patientIds.length; offset += batchSize) {
        if (res.destroyed || res.writableEnded) return;
        const batchIds = patientIds.slice(offset, offset + batchSize);
        const rows = await getPatientRxCompleteExportRows(req.query || {}, batchIds);
        for (const row of rows) {
            if (res.destroyed || res.writableEnded) return;
            await writeExportChunk(res, `${patientRxCompleteCsv.rowLine(row)}\r\n`);
        }
    }
    res.end();
}

async function getPaginatedPatientReport(query) {
    const pageSize = parsePositiveInt(query.pageSize, 10, 1, 500);
    const requestedPage = parsePositiveInt(query.page, 1, 1, 1000000);
    const sort = cleanString(query.sort) || 'id';
    const dir = normalizeDir(query.dir);
    const totalSteps = await db.WorkflowAction.count({ where: { isActive: true } });
    const replacements = {};
    const where = patientReportFilters(query, replacements, totalSteps);
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
    const workflowStatus = cleanString(query.workflowStatus || query.progress);
    const workflowStage = cleanString(query.workflowStage);
    const completedStageId = exactPositiveId(query.completedStageId);
    const stageFrom = isDateOnly(query.stageFrom) ? query.stageFrom : '';
    const stageTo = isDateOnly(query.stageTo) ? query.stageTo : '';
    const patientType = cleanString(query.patientType);
    const warehouseStatus = cleanString(query.warehouseStatus);
    const dateFrom = isDateOnly(query.serviceFrom || query.dateFrom) ? (query.serviceFrom || query.dateFrom) : '';
    const dateTo = isDateOnly(query.serviceTo || query.dateTo) ? (query.serviceTo || query.dateTo) : '';
    const arrivalFrom = isDateOnly(query.arrivalFrom) ? query.arrivalFrom : '';
    const arrivalTo = isDateOnly(query.arrivalTo) ? query.arrivalTo : '';
    const completedExpr = 'COALESCE(wc.completed_steps, 0)';
    const expiredExpr = `(r."serviceDate" IS NOT NULL
        AND (r."serviceDate"::date + INTERVAL '${getServiceWindowDays()} days')::date < CURRENT_DATE
        AND ${completedExpr} < :totalSteps)`;
    const completedExprSql = `(:totalSteps > 0 AND ${completedExpr} >= :totalSteps)`;
    const exactIds = [
        ['pharmacyId', query.pharmacyId, 'r."pharmacyId"'],
        ['clinicId', query.clinicId, 'p."clinicId"'],
        ['patientTransportId', query.patientTransportId, 'r."patientTransportCompanyId"'],
        ['pharmacyTransportId', query.pharmacyTransportId, 'r."pharmacyTransportCompanyId"']
    ];
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
    exactIds.forEach(([key, rawValue, sql]) => {
        const value = exactPositiveId(rawValue);
        if (value === null) return;
        if (value === false) {
            where.push('FALSE');
            return;
        }
        replacements[key] = value;
        where.push(`${sql} = :${key}`);
    });
    if (dateFrom) {
        replacements.dateFrom = dateFrom;
        where.push('r."serviceDate" >= :dateFrom');
    }
    if (dateTo) {
        replacements.dateTo = dateTo;
        where.push('r."serviceDate" <= :dateTo');
    }
    if (arrivalFrom) {
        replacements.arrivalFrom = arrivalFrom;
        where.push('r."arrivalDate" >= :arrivalFrom');
    }
    if (arrivalTo) {
        replacements.arrivalTo = arrivalTo;
        where.push('r."arrivalDate" <= :arrivalTo');
    }
    if (patientType === 'company') {
        where.push('(p."isNonCompanyPatient" = FALSE OR p."isNonCompanyPatient" IS NULL)');
    } else if (patientType === 'non_company') {
        where.push('p."isNonCompanyPatient" = TRUE');
    } else if (patientType) {
        where.push('FALSE');
    }
    if (warehouseStatus === 'returned') {
        where.push('r."returnedToWarehouse" = TRUE');
    } else if (warehouseStatus === 'not-returned') {
        where.push('(r."returnedToWarehouse" = FALSE OR r."returnedToWarehouse" IS NULL)');
    } else if (warehouseStatus) {
        where.push('FALSE');
    }

    if (workflowStatus === 'complete' || workflowStatus === 'completed') {
        where.push(completedExprSql);
    } else if (workflowStatus === 'pending') {
        where.push(`NOT ${completedExprSql}`);
        where.push(`NOT ${expiredExpr}`);
    } else if (workflowStatus === 'expired') {
        where.push(expiredExpr);
    } else if (workflowStatus === 'in-progress') {
        where.push(`${completedExpr} > 0`);
        where.push(`NOT ${completedExprSql}`);
        where.push(`NOT ${expiredExpr}`);
    } else if (workflowStatus === 'not-started') {
        where.push(`${completedExpr} = 0`);
        where.push(`NOT ${expiredExpr}`);
    } else if (workflowStatus) {
        where.push('FALSE');
    }
    if (/^\d+$/.test(workflowStage)) {
        replacements.workflowStageDone = Math.max(0, parseInt(workflowStage, 10) - 1);
        where.push(`${completedExpr} = :workflowStageDone`);
    } else if (workflowStage) {
        where.push('FALSE');
    }
    if (completedStageId === false) {
        where.push('FALSE');
    } else if (completedStageId !== null || stageFrom || stageTo) {
        const stageActivityWhere = ['stage_activity."rxRecordId" = r.id'];
        if (completedStageId !== null) {
            replacements.completedStageId = completedStageId;
            stageActivityWhere.push('stage_activity."workflowActionId" = :completedStageId');
        }
        if (stageFrom) {
            replacements.stageFrom = stageFrom;
            stageActivityWhere.push('stage_activity."completionDate" >= CAST(:stageFrom AS DATE)');
        }
        if (stageTo) {
            replacements.stageTo = stageTo;
            stageActivityWhere.push('stage_activity."completionDate" < (CAST(:stageTo AS DATE) + INTERVAL \'1 day\')');
        }
        where.push(`EXISTS (
            SELECT 1
            FROM "RXWorkflowTrackings" stage_activity
            WHERE ${stageActivityWhere.join(' AND ')}
        )`);
    }
    return where;
}

function rxReportFromSql() {
    return `
        FROM "RXRecords" r
        LEFT JOIN "Patients" p ON p.id = r."patientId"
        LEFT JOIN "Pharmacies" ph ON ph.id = r."pharmacyId"
        LEFT JOIN "Clinics" c ON c.id = p."clinicId"
        LEFT JOIN "PatientTransportCompanies" pt ON pt.id = r."patientTransportCompanyId"
        LEFT JOIN "PharmacyTransportCompanies" pht ON pht.id = r."pharmacyTransportCompanyId"
        LEFT JOIN (
            SELECT
                wt."rxRecordId",
                COUNT(*)::integer AS completed_steps,
                (ARRAY_AGG(
                    wt."completionDate"
                    ORDER BY wa."sequenceNumber" DESC NULLS LAST, wt."completionDate" DESC, wt.id DESC
                ))[1] AS current_stage_at
            FROM "RXWorkflowTrackings" wt
            LEFT JOIN "WorkflowActions" wa ON wa.id = wt."workflowActionId"
            GROUP BY wt."rxRecordId"
        ) wc ON wc."rxRecordId" = r.id
    `;
}

function rxReportSortSql(sort) {
    const allowed = {
        id: 'r.id',
        'Patient.firstName': 'LOWER(COALESCE(p."firstName", \'\'))',
        'Patient.patientCode': 'LOWER(COALESCE(p."patientCode", \'\'))',
        'Pharmacy.name': 'LOWER(COALESCE(ph."name", \'\'))',
        'Clinic.name': 'LOWER(COALESCE(c."name", \'\'))',
        'PatientTransportCompany.companyName': 'LOWER(COALESCE(pt."companyName", \'\'))',
        'PharmacyTransportCompany.companyName': 'LOWER(COALESCE(pht."companyName", \'\'))',
        arrivalDate: 'r."arrivalDate"',
        serviceDate: 'r."serviceDate"',
        returnedToWarehouse: 'r."returnedToWarehouse"',
        workflowStatus: 'COALESCE(wc.completed_steps, 0)',
        stageDate: 'wc.current_stage_at'
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

exports.getPatientRxDetailReport = async (req, res) => {
    try {
        const query = req.query || {};
        if (query.completeHistory === 'true' && query.format === 'csv') {
            return await streamPatientRxCompleteCsv(req, res);
        }
        const rows = query.completeHistory === 'true'
            ? await getPatientRxCompleteExportRows(query)
            : await getPatientRxDetailRows(query);
        res.json({ rows });
    } catch (err) {
        console.error('[Reports] Patient + RX detail export error:', err);
        if (res.headersSent) {
            if (!res.writableEnded) res.end();
            return;
        }
        res.status(500).json({ error: err.message });
    }
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
