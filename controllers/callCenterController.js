'use strict';

const { Op } = require('sequelize');
const db = require('../models');
const { parseDate, formatDate } = require('../utils/dateUtils');
const {
    hasCallCenterAccess,
    canReviewCallCenter,
    normalizeRoleName
} = require('../utils/callCenterAccess');
const { recordPatientServiceDateChange } = require('../services/patientServiceDateHistoryService');
const {
    buildPatientContextSnapshot,
    syncPatientServiceDateCycles
} = require('../services/patientServiceDateCycleService');
const sessionIdleService = require('../services/sessionIdleService');
const { getServiceWindowDays } = require('../utils/globalSettings');
const {
    getEligibilityCutoffIso,
    evaluateServiceWindow
} = require('../utils/serviceWindowEligibility');

const MODULE_NAME = 'Call Center';
const CALL_ACTION = 'Called';
const NOTE_ACTION = 'Note Added';
const SERVICE_DATE_ACTION = 'Service Date Added';
const CALL_LOCK_TTL_MS = 10 * 60 * 1000;

function localDateOnly(date) {
    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return null;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function todayStart() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
}

function endOfDay(isoDate) {
    const d = new Date(`${isoDate}T00:00:00`);
    d.setHours(23, 59, 59, 999);
    return d;
}

function todayRange() {
    const from = todayStart();
    const to = new Date(from);
    to.setHours(23, 59, 59, 999);
    return { from, to, iso: localDateOnly(from) };
}

function currentSessionStart(req) {
    const sessionInfo = sessionIdleService.getSessionInfo(req.authToken, req.user);
    const startedAt = sessionInfo && sessionInfo.startedAt ? new Date(sessionInfo.startedAt) : null;
    if (startedAt && !isNaN(startedAt.getTime())) return startedAt;
    if (req.user && req.user.iat) {
        const issuedAt = new Date(Number(req.user.iat) * 1000);
        if (!isNaN(issuedAt.getTime())) return issuedAt;
    }
    return todayStart();
}

function currentSessionTodayRange(req) {
    const day = todayRange();
    const sessionStart = currentSessionStart(req);
    return {
        from: sessionStart > day.from ? sessionStart : day.from,
        to: day.to,
        iso: day.iso
    };
}

function eligibilityCutoffIso() {
    return getEligibilityCutoffIso();
}

function addDaysIso(iso, days) {
    if (!iso) return null;
    const d = new Date(`${iso}T00:00:00`);
    if (isNaN(d.getTime())) return null;
    d.setDate(d.getDate() + days);
    return localDateOnly(d);
}

function dateOnly(value) {
    return parseDate(value);
}

function cleanNote(value) {
    return String(value || '').trim().slice(0, 4000);
}

function getUserLabel(user) {
    if (!user) return 'System';
    const first = user.firstName || '';
    const last = user.lastName || '';
    const full = `${first} ${last}`.trim();
    return full || user.username || `User ${user.id}`;
}

function isQueueWorker(user) {
    const role = normalizeRoleName(user);
    if (role === 'administrator' || role === 'supervisor') return false;
    if (role === 'call center') return true;
    const p = user && user.permissions && user.permissions.call_center;
    return !!(p && p.canAdd);
}

function lockHolderToUser(lock) {
    const plain = lock && typeof lock.toJSON === 'function' ? lock.toJSON() : lock;
    const holder = plain && plain.User ? plain.User : null;
    if (!holder) return null;
    return {
        id: holder.id,
        username: holder.username,
        firstName: holder.firstName,
        lastName: holder.lastName,
        role: holder.Role ? holder.Role.name : holder.role,
        permissions: holder.Role ? holder.Role.permissions : holder.permissions
    };
}

function requestIp(req) {
    return req.headers['x-forwarded-for'] || req.ip || (req.connection && req.connection.remoteAddress) || null;
}

function auditDateParts(now) {
    return {
        date: localDateOnly(now),
        time: now.toTimeString().split(' ')[0]
    };
}

function baseEligibleWhere() {
    return {
        [Op.and]: [
            { isActive: true },
            { serviceDate: { [Op.ne]: null } },
            { [Op.or]: [{ isDeleted: false }, { isDeleted: null }] }
        ]
    };
}

function isEligiblePatient(patient) {
    if (!patient || patient.isActive !== true) return false;
    if (patient.isDeleted === true) return false;
    return evaluateServiceWindow(patient.serviceDate).eligible;
}

function patientMatchesSearch(patient, q) {
    if (!q) return true;
    const haystack = [
        patient.firstName || '',
        patient.lastName || '',
        `${patient.firstName || ''} ${patient.lastName || ''}`.trim(),
        patient.phone || ''
    ].join(' ').toLowerCase();
    const normalizedPhone = String(patient.phone || '').replace(/\D/g, '');
    const needle = String(q || '').trim().toLowerCase();
    const phoneNeedle = needle.replace(/\D/g, '');
    return haystack.includes(needle) || (!!phoneNeedle && normalizedPhone.includes(phoneNeedle));
}

function parsePaging(query) {
    const size = parseInt(query.pageSize || query.limit || 10, 10);
    const pageSize = size === 5 ? 5 : 10;
    const page = Math.max(parseInt(query.page || 1, 10) || 1, 1);
    return { page, pageSize };
}

function parseSort(query) {
    const allowed = new Set(['firstName', 'lastName', 'phone', 'notes', 'serviceDate', 'status', 'callCount', 'lastCall']);
    const sort = allowed.has(String(query.sort || '')) ? String(query.sort) : '';
    const dir = String(query.dir || 'asc').toLowerCase() === 'desc' ? -1 : 1;
    return { sort, dir };
}

function compareValues(left, right) {
    const a = left === null || left === undefined ? '' : String(left).toLowerCase();
    const b = right === null || right === undefined ? '' : String(right).toLowerCase();
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
}

function sortPatients(rows, sortConfig, callHistory) {
    if (!sortConfig || !sortConfig.sort) return rows;
    const dir = sortConfig.dir || 1;
    const sorted = rows.slice();
    sorted.sort((left, right) => {
        const l = left && typeof left.toJSON === 'function' ? left.toJSON() : left;
        const r = right && typeof right.toJSON === 'function' ? right.toJSON() : right;
        if (sortConfig.sort === 'callCount') {
            const lc = (callHistory[String(l.id)] || {}).count || 0;
            const rc = (callHistory[String(r.id)] || {}).count || 0;
            return (lc - rc) * dir;
        }
        if (sortConfig.sort === 'lastCall') {
            const lc = (callHistory[String(l.id)] || {}).lastCalledAt || '';
            const rc = (callHistory[String(r.id)] || {}).lastCalledAt || '';
            return compareValues(lc, rc) * dir;
        }
        if (sortConfig.sort === 'status') {
            return compareValues(isEligiblePatient(l) ? 'eligible' : 'completed', isEligiblePatient(r) ? 'eligible' : 'completed') * dir;
        }
        return compareValues(l[sortConfig.sort], r[sortConfig.sort]) * dir;
    });
    return sorted;
}

function makeLockExpiresAt() {
    return new Date(Date.now() + CALL_LOCK_TTL_MS);
}

function parsePatientIds(values) {
    return Array.from(new Set((values || [])
        .map((value) => parseInt(value, 10))
        .filter((value) => Number.isFinite(value))));
}

function serializeLock(lock) {
    const plain = lock && typeof lock.toJSON === 'function' ? lock.toJSON() : lock;
    if (!plain) return null;
    return {
        patientId: plain.patientId,
        userId: plain.userId,
        user: getUserLabel(plain.User),
        lockedAt: plain.lockedAt,
        expiresAt: plain.expiresAt
    };
}

async function getActiveLockedPatientIds(excludeUserId) {
    const where = { expiresAt: { [Op.gt]: new Date() } };
    if (excludeUserId) where.userId = { [Op.ne]: excludeUserId };
    const locks = await db.CallCenterLock.findAll({
        where,
        attributes: ['patientId'],
        include: [{
            model: db.User,
            as: 'User',
            attributes: ['id', 'username', 'firstName', 'lastName'],
            required: false,
            include: [{ model: db.Role, attributes: ['name', 'permissions'], required: false }]
        }]
    });
    const set = new Set();
    locks.forEach((lock) => {
        if (!isQueueWorker(lockHolderToUser(lock))) return;
        const id = parseInt(lock.patientId, 10);
        if (Number.isFinite(id)) set.add(id);
    });
    return set;
}

async function acquireCallCenterLock(patientId, req, options) {
    options = options || {};
    const transaction = options.transaction || null;
    const userId = req.user && req.user.id ? req.user.id : null;
    if (!userId) return { ok: false, status: 401, error: 'Unauthorized.' };

    const queryOptions = { where: { patientId } };
    if (transaction) {
        queryOptions.transaction = transaction;
        queryOptions.lock = transaction.LOCK.UPDATE;
    }

    let lock = await db.CallCenterLock.findOne(queryOptions);
    const now = new Date();
    if (lock && new Date(lock.expiresAt) > now && lock.userId !== userId) {
        const withUser = await db.CallCenterLock.findOne({
            where: { patientId },
            include: [{
                model: db.User,
                as: 'User',
                attributes: ['id', 'firstName', 'lastName', 'username'],
                required: false,
                include: [{ model: db.Role, attributes: ['name', 'permissions'], required: false }]
            }],
            transaction
        });
        const holderIsQueueWorker = isQueueWorker(lockHolderToUser(withUser || lock));
        if (holderIsQueueWorker) {
            return {
                ok: false,
                status: 409,
                error: 'This patient is already claimed by another Call Center user.',
                lock: serializeLock(withUser || lock)
            };
        }
    }

    if (lock) {
        await lock.update({
            userId,
            lockedAt: lock.userId === userId && new Date(lock.expiresAt) > now ? lock.lockedAt : now,
            expiresAt: makeLockExpiresAt()
        }, transaction ? { transaction } : {});
        return { ok: true, lock };
    }

    try {
        lock = await db.CallCenterLock.create({
            patientId,
            userId,
            lockedAt: now,
            expiresAt: makeLockExpiresAt()
        }, transaction ? { transaction } : {});
        return { ok: true, lock };
    } catch (err) {
        if (err.name === 'SequelizeUniqueConstraintError' && !options._retried) {
            return acquireCallCenterLock(patientId, req, { ...options, _retried: true });
        }
        throw err;
    }
}

async function releaseCallCenterLocks(userId, patientIds) {
    if (!userId) return 0;
    const where = { userId };
    const ids = parsePatientIds(patientIds);
    if (ids.length) where.patientId = { [Op.in]: ids };
    return db.CallCenterLock.destroy({ where });
}

function serializeCallLog(log) {
    const plain = log && typeof log.toJSON === 'function' ? log.toJSON() : log;
    if (!plain) return null;
    return {
        id: plain.id,
        at: plain.createdAt,
        display: formatDate(plain.createdAt) || localDateOnly(plain.createdAt),
        user: getUserLabel(plain.User)
    };
}

async function getCallHistoryForPatients(patientIds) {
    if (!patientIds.length) return {};
    const range = todayRange();
    const logs = await db.AuditLog.findAll({
        where: {
            module: MODULE_NAME,
            action: CALL_ACTION,
            recordId: { [Op.in]: patientIds }
        },
        include: [{ model: db.User, attributes: ['id', 'firstName', 'lastName', 'username'], required: false }],
        order: [['createdAt', 'DESC']]
    });

    const map = {};
    logs.forEach((log) => {
        const plain = log && typeof log.toJSON === 'function' ? log.toJSON() : log;
        const key = String(plain.recordId);
        if (!map[key]) {
            map[key] = {
                count: 0,
                todayCount: 0,
                lastCalledAt: null,
                lastCalledBy: null,
                lastCalledTodayAt: null,
                recent: []
            };
        }
        map[key].count += 1;
        if (plain.createdAt && new Date(plain.createdAt) >= range.from && new Date(plain.createdAt) <= range.to) {
            map[key].todayCount += 1;
            if (!map[key].lastCalledTodayAt) map[key].lastCalledTodayAt = plain.createdAt;
        }
        if (!map[key].lastCalledAt) {
            map[key].lastCalledAt = plain.createdAt;
            map[key].lastCalledBy = getUserLabel(plain.User);
        }
        if (map[key].recent.length < 5) {
            map[key].recent.push(serializeCallLog(plain));
        }
    });
    return map;
}

function auditServiceDate(value) {
    if (!value) return null;
    const payload = typeof value === 'string'
        ? (() => {
            try { return JSON.parse(value); } catch (err) { return {}; }
        })()
        : value;
    return parseDate(payload.serviceDate || payload.newServiceDate);
}

async function getRecentNotesForPatients(patientIds) {
    if (!patientIds.length) return {};
    const notes = await db.PatientNote.findAll({
        where: { patientId: { [Op.in]: patientIds } },
        include: [{ model: db.User, as: 'Author', attributes: ['id', 'firstName', 'lastName', 'username'], required: false }],
        order: [['createdAt', 'DESC']]
    });

    const map = {};
    notes.forEach((note) => {
        const plain = note && typeof note.toJSON === 'function' ? note.toJSON() : note;
        const key = String(plain.patientId);
        if (!map[key]) map[key] = [];
        if (map[key].length >= 5) return;
        map[key].push({
            id: plain.id,
            note: plain.note || '',
            source: plain.source || 'Patient',
            createdAt: plain.createdAt,
            author: getUserLabel(plain.Author)
        });
    });
    return map;
}

function buildNotesDisplay(patientNotes, recentNotes) {
    const parts = [];
    if (patientNotes) {
        parts.push({
            source: 'Patient',
            note: patientNotes,
            createdAt: null,
            author: null
        });
    }
    (recentNotes || []).forEach((note) => parts.push(note));
    return parts;
}

function serializePatient(patient, callHistory, noteHistory) {
    const plain = patient && typeof patient.toJSON === 'function' ? patient.toJSON() : patient;
    const serviceDate = dateOnly(plain.serviceDate);
    const history = callHistory[String(plain.id)] || { count: 0, todayCount: 0, lastCalledAt: null, lastCalledBy: null, lastCalledTodayAt: null, recent: [] };
    const notes = buildNotesDisplay(plain.notes || '', noteHistory[String(plain.id)] || []);
    const currentlyEligible = isEligiblePatient(plain);
    const calledToday = history.todayCount > 0;
    return {
        id: plain.id,
        firstName: plain.firstName || '',
        lastName: plain.lastName || '',
        phone: plain.phone || '',
        serviceDate,
        serviceDateDisplay: formatDate(serviceDate),
        eligibleSince: evaluateServiceWindow(serviceDate).eligibleSince,
        eligibleSinceDisplay: formatDate(evaluateServiceWindow(serviceDate).eligibleSince),
        notes: notes.map((item) => `[${item.source || 'Patient'}] ${item.note || ''}`).join('\n\n'),
        noteEntries: notes,
        isCurrentlyEligible: currentlyEligible,
        calledToday,
        calledTodayCount: history.todayCount,
        statusText: currentlyEligible
            ? (calledToday ? 'Called today - waiting service date' : 'Ready to call')
            : 'Service date entered',
        callCount: history.count,
        lastCalledAt: history.lastCalledAt,
        lastCalledTodayAt: history.lastCalledTodayAt,
        lastCalledBy: history.lastCalledBy,
        recentCalls: history.recent || []
    };
}

async function createAudit(req, action, patient, previousValue, newValue, transaction) {
    const now = new Date();
    const parts = auditDateParts(now);
    return db.AuditLog.create({
        userId: req.user && req.user.id ? req.user.id : null,
        date: parts.date,
        time: parts.time,
        module: MODULE_NAME,
        action,
        recordId: patient ? patient.id : null,
        previousValue: previousValue || null,
        newValue: newValue || null,
        ipAddress: requestIp(req)
    }, transaction ? { transaction } : {});
}

function requireAccess(req, res, next) {
    if (hasCallCenterAccess(req.user)) return next();
    return res.status(403).json({ message: 'Call Center access required.' });
}

function requireWriteAccess(req, res, next) {
    if (!hasCallCenterAccess(req.user)) {
        return res.status(403).json({ message: 'Call Center access required.' });
    }
    const role = normalizeRoleName(req.user);
    const p = req.user && req.user.permissions && req.user.permissions.call_center;
    if (role === 'administrator' || role === 'supervisor' || role === 'call center' || (p && p.canAdd)) {
        return next();
    }
    return res.status(403).json({ message: 'Call Center update permission required.' });
}

function requireReviewAccess(req, res, next) {
    if (canReviewCallCenter(req.user)) return next();
    return res.status(403).json({ message: 'Call Center review access required.' });
}

exports.requireAccess = requireAccess;
exports.requireWriteAccess = requireWriteAccess;
exports.requireReviewAccess = requireReviewAccess;

exports.claimPatient = async (req, res) => {
    const patientId = parseInt(req.params.id, 10);
    if (!Number.isFinite(patientId)) return res.status(400).json({ error: 'Invalid patient id.' });
    try {
        const claim = await acquireCallCenterLock(patientId, req);
        if (!claim.ok) return res.status(claim.status || 409).json({ error: claim.error, lock: claim.lock || null });
        res.json({ ok: true, expiresAt: claim.lock.expiresAt });
    } catch (err) {
        console.error('[Call Center] claimPatient error:', err);
        res.status(500).json({ error: err.message });
    }
};

exports.refreshLocks = async (req, res) => {
    try {
        const patientIds = parsePatientIds((req.body && req.body.patientIds) || []);
        const refreshed = [];
        const conflicts = [];
        for (const patientId of patientIds) {
            const claim = await acquireCallCenterLock(patientId, req);
            if (claim.ok) refreshed.push(patientId);
            else conflicts.push({ patientId, lock: claim.lock || null, error: claim.error });
        }
        res.json({ ok: true, refreshed, conflicts });
    } catch (err) {
        console.error('[Call Center] refreshLocks error:', err);
        res.status(500).json({ error: err.message });
    }
};

exports.releaseLocks = async (req, res) => {
    try {
        const patientIds = parsePatientIds((req.body && req.body.patientIds) || []);
        const released = await releaseCallCenterLocks(req.user && req.user.id, patientIds);
        res.json({ ok: true, released });
    } catch (err) {
        console.error('[Call Center] releaseLocks error:', err);
        res.status(500).json({ error: err.message });
    }
};

exports.listPatients = async (req, res) => {
    try {
        const view = String((req.query && req.query.view) || 'queue').trim().toLowerCase();
        if (view === 'called-today' || view === 'patients-called' || view === 'service-dates-today') {
            return listActivityPatients(req, res, view);
        }

        const paging = parsePaging(req.query || {});
        const sortConfig = parseSort(req.query || {});
        const q = String((req.query && req.query.q) || '').trim();
        const rows = await db.Patient.findAll({
            attributes: ['id', 'firstName', 'lastName', 'phone', 'serviceDate', 'notes', 'isActive', 'isDeleted'],
            where: baseEligibleWhere(),
            order: [['serviceDate', 'ASC'], ['lastName', 'ASC'], ['firstName', 'ASC'], ['id', 'ASC']]
        });

        const shouldClaimRows = isQueueWorker(req.user);
        const lockedByOthers = shouldClaimRows
            ? await getActiveLockedPatientIds(req.user && req.user.id)
            : new Set();
        let filtered = rows.filter((row) =>
            isEligiblePatient(row) &&
            !lockedByOthers.has(row.id) &&
            patientMatchesSearch(row, q)
        );
        const sortHistory = ['callCount', 'lastCall'].includes(sortConfig.sort)
            ? await getCallHistoryForPatients(filtered.map((row) => row.id))
            : {};
        filtered = sortPatients(filtered, sortConfig, sortHistory);
        const total = filtered.length;
        const totalPages = Math.max(Math.ceil(total / paging.pageSize), 1);
        const page = Math.min(paging.page, totalPages);
        const start = (page - 1) * paging.pageSize;
        const pageRows = [];
        for (let i = start; i < filtered.length && pageRows.length < paging.pageSize; i += 1) {
            if (!shouldClaimRows) {
                pageRows.push(filtered[i]);
                continue;
            }
            const claim = await acquireCallCenterLock(filtered[i].id, req);
            if (claim.ok) pageRows.push(filtered[i]);
        }
        const ids = pageRows.map((row) => row.id);
        const callHistory = await getCallHistoryForPatients(ids);
        const noteHistory = await getRecentNotesForPatients(ids);

        res.json({
            page,
            pageSize: paging.pageSize,
            total,
            totalPages,
            view: 'queue',
            serviceWindowDays: getServiceWindowDays(),
            eligibilityCutoff: eligibilityCutoffIso(),
            locksAcquired: shouldClaimRows,
            rows: pageRows.map((row) => serializePatient(row, callHistory, noteHistory))
        });
    } catch (err) {
        console.error('[Call Center] listPatients error:', err);
        res.status(500).json({ error: err.message });
    }
};

async function listActivityPatients(req, res, view) {
    const paging = parsePaging(req.query || {});
    const sortConfig = parseSort(req.query || {});
    const q = String((req.query && req.query.q) || '').trim();
    const range = currentSessionTodayRange(req);
    const action = view === 'service-dates-today' ? SERVICE_DATE_ACTION : CALL_ACTION;

    const logs = await db.AuditLog.findAll({
        where: {
            module: MODULE_NAME,
            action,
            recordId: { [Op.ne]: null },
            userId: req.user && req.user.id ? req.user.id : null,
            createdAt: { [Op.between]: [range.from, range.to] }
        },
        order: [['createdAt', 'DESC']],
        attributes: ['id', 'recordId', 'createdAt', 'userId', 'action']
    });

    const ids = [];
    const seen = new Set();
    logs.forEach((log) => {
        const id = parseInt(log.recordId, 10);
        if (!Number.isFinite(id) || seen.has(id)) return;
        seen.add(id);
        ids.push(id);
    });
    const activityTotal = view === 'patients-called' ? ids.length : logs.length;
    const activityLabel = view === 'service-dates-today' ? 'dates' : (view === 'patients-called' ? 'patients' : 'calls');

    if (!ids.length) {
        return res.json({
            page: 1,
            pageSize: paging.pageSize,
            total: 0,
            totalPages: 1,
            view,
            serviceWindowDays: getServiceWindowDays(),
            eligibilityCutoff: eligibilityCutoffIso(),
            activityTotal,
            activityLabel,
            rows: []
        });
    }

    const patients = await db.Patient.findAll({
        attributes: ['id', 'firstName', 'lastName', 'phone', 'serviceDate', 'notes', 'isActive', 'isDeleted'],
        where: { id: { [Op.in]: ids } }
    });
    const byId = new Map();
    patients.forEach((patient) => byId.set(patient.id, patient));

    const ordered = ids.map((id) => byId.get(id)).filter(Boolean);
    let filtered = ordered.filter((row) => patientMatchesSearch(row, q));
    const allCallHistory = ['callCount', 'lastCall'].includes(sortConfig.sort)
        ? await getCallHistoryForPatients(filtered.map((row) => row.id))
        : {};
    filtered = sortPatients(filtered, sortConfig, allCallHistory);
    const total = filtered.length;
    const totalPages = Math.max(Math.ceil(total / paging.pageSize), 1);
    const page = Math.min(paging.page, totalPages);
    const start = (page - 1) * paging.pageSize;
    const pageRows = filtered.slice(start, start + paging.pageSize);
    const pageIds = pageRows.map((row) => row.id);
    const callHistory = await getCallHistoryForPatients(pageIds);
    const noteHistory = await getRecentNotesForPatients(pageIds);

    res.json({
        page,
        pageSize: paging.pageSize,
        total,
        totalPages,
        view,
        serviceWindowDays: getServiceWindowDays(),
        eligibilityCutoff: eligibilityCutoffIso(),
        activityTotal,
        activityLabel,
        rows: pageRows.map((row) => serializePatient(row, callHistory, noteHistory))
    });
}

exports.savePatientAction = async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid patient id.' });

    const body = req.body || {};
    const called = body.called === true || body.called === 'true' || body.called === '1';
    const note = cleanNote(body.note);
    const newServiceDateRaw = body.newServiceDate === undefined ? '' : String(body.newServiceDate || '').trim();
    const newServiceDate = newServiceDateRaw ? parseDate(newServiceDateRaw) : null;

    if (newServiceDateRaw && !newServiceDate) {
        return res.status(400).json({ error: 'Invalid new service date.' });
    }
    if (newServiceDate && newServiceDate <= eligibilityCutoffIso()) {
        const minimumDate = addDaysIso(eligibilityCutoffIso(), 1);
        return res.status(400).json({
            error: `New service date must be ${formatDate(minimumDate)} or later so the patient leaves the ${getServiceWindowDays()}-day eligible queue.`
        });
    }
    if (!called && !note && !newServiceDate) {
        return res.status(400).json({ error: 'Select Called, add a note, or enter a new service date.' });
    }

    try {
        let actionCount = 0;
        await db.sequelize.transaction(async (transaction) => {
            const claim = await acquireCallCenterLock(id, req, { transaction });
            if (!claim.ok) {
                const err = new Error(claim.error || 'Patient is currently claimed by another user.');
                err.status = claim.status || 409;
                err.lock = claim.lock || null;
                throw err;
            }

            const patient = await db.Patient.findByPk(id, { transaction });
            if (!patient) {
                const err = new Error('Patient not found.');
                err.status = 404;
                throw err;
            }
            if (!isEligiblePatient(patient)) {
                const err = new Error('Patient is not currently Call Center eligible.');
                err.status = 409;
                throw err;
            }

            const patientLabel = `${patient.firstName || ''} ${patient.lastName || ''}`.trim();
            const previousServiceDate = dateOnly(patient.serviceDate);

            if (newServiceDate && newServiceDate !== previousServiceDate) {
                const previousContext = await buildPatientContextSnapshot(patient, {
                    transaction,
                    source: 'Call Center Before Service Date'
                });

                await patient.update({ serviceDate: newServiceDate }, { transaction });

                await syncPatientServiceDateCycles(patient, {
                    transaction,
                    userId: req.user && req.user.id,
                    source: 'Call Center',
                    previousPatientContext: previousContext,
                    contextChangeReason: 'Call Center service date entry',
                    metadata: { callCenter: true }
                });

                await recordPatientServiceDateChange({
                    patientId: patient.id,
                    previousServiceDate,
                    newServiceDate,
                    userId: req.user && req.user.id,
                    changeSource: 'Call Center',
                    reason: 'Call Center service date entry',
                    metadata: {
                        callCenter: true,
                        patientName: patientLabel
                    }
                }, { transaction });

                await createAudit(req, SERVICE_DATE_ACTION, patient, {
                    serviceDate: previousServiceDate
                }, {
                    serviceDate: newServiceDate,
                    patientName: patientLabel
                }, transaction);
                actionCount += 1;
            }

            if (note) {
                await db.PatientNote.create({
                    patientId: patient.id,
                    userId: req.user && req.user.id ? req.user.id : null,
                    note,
                    source: 'Call Center'
                }, { transaction });
                await createAudit(req, NOTE_ACTION, patient, null, {
                    note,
                    patientName: patientLabel
                }, transaction);
                actionCount += 1;
            }

            if (called) {
                await createAudit(req, CALL_ACTION, patient, null, {
                    patientName: patientLabel,
                    phone: patient.phone || '',
                    noteAdded: !!note,
                    serviceDateAdded: !!(newServiceDate && newServiceDate !== previousServiceDate)
                }, transaction);
                actionCount += 1;
            }
        });

        if (!actionCount) {
            return res.status(400).json({ error: 'No new action was saved.' });
        }
        if (called || newServiceDate) {
            await releaseCallCenterLocks(req.user && req.user.id, [id]);
        }
        res.json({ message: 'Call Center action saved.', actions: actionCount });
    } catch (err) {
        const status = err.status || 500;
        if (status >= 500) console.error('[Call Center] savePatientAction error:', err);
        res.status(status).json({ error: err.message, lock: err.lock || null });
    }
};

async function eligibleTotal() {
    const patients = await db.Patient.findAll({
        attributes: ['serviceDate', 'isActive', 'isDeleted'],
        where: baseEligibleWhere()
    });
    return patients.filter(isEligiblePatient).length;
}

async function availableEligibleTotal(userId) {
    const patients = await db.Patient.findAll({
        attributes: ['id', 'serviceDate', 'isActive', 'isDeleted'],
        where: baseEligibleWhere()
    });
    const eligiblePatients = patients.filter(isEligiblePatient);
    const lockedByOthers = await getActiveLockedPatientIds(userId);
    return eligiblePatients.filter((patient) =>
        !lockedByOthers.has(patient.id)
    ).length;
}

function getRange(query) {
    const today = localDateOnly(new Date());
    const fromIso = parseDate(query && query.from) || today;
    const toIso = parseDate(query && query.to) || fromIso;
    const from = new Date(`${fromIso}T00:00:00`);
    const to = endOfDay(toIso);
    return { fromIso, toIso, from, to };
}

async function getHistoryRange(query) {
    const today = localDateOnly(new Date());
    let fromIso = parseDate(query && query.historyFrom);
    const toIso = parseDate(query && query.historyTo) || today;

    if (!fromIso && query && query.historyRange === 'all') {
        const firstLog = await db.AuditLog.findOne({
            attributes: ['createdAt'],
            where: {
                module: MODULE_NAME,
                action: { [Op.in]: [CALL_ACTION, NOTE_ACTION, SERVICE_DATE_ACTION] }
            },
            order: [['createdAt', 'ASC']],
            raw: true
        });
        fromIso = firstLog && firstLog.createdAt ? localDateOnly(firstLog.createdAt) : toIso;
    }

    if (!fromIso) {
        const from = new Date(`${toIso}T00:00:00`);
        from.setDate(from.getDate() - 29);
        fromIso = localDateOnly(from);
    }

    const cleanFrom = fromIso > toIso ? toIso : fromIso;
    return {
        fromIso: cleanFrom,
        toIso,
        from: new Date(`${cleanFrom}T00:00:00`),
        to: endOfDay(toIso)
    };
}

function dateKeysBetween(fromIso, toIso) {
    const keys = [];
    const maxDays = 370;
    const d = new Date(`${fromIso}T00:00:00`);
    for (let i = 0; i < maxDays && localDateOnly(d) <= toIso; i += 1) {
        keys.push(localDateOnly(d));
        d.setDate(d.getDate() + 1);
    }
    return keys;
}

function summarizeHistory(logs, labels) {
    const byDate = {};
    const usersById = {};
    labels.forEach((label) => {
        byDate[label] = {
            calls: 0,
            patients: new Set(),
            serviceDates: 0,
            notes: 0
        };
    });

    logs.forEach((log) => {
        const plain = log && typeof log.toJSON === 'function' ? log.toJSON() : log;
        const key = localDateOnly(plain.createdAt);
        if (plain.userId) {
            usersById[String(plain.userId)] = {
                userId: plain.userId,
                user: getUserLabel(plain.User)
            };
        }
        if (!key || !byDate[key]) return;
        if (plain.action === CALL_ACTION) {
            byDate[key].calls += 1;
            if (plain.recordId) byDate[key].patients.add(String(plain.recordId));
        } else if (plain.action === NOTE_ACTION) {
            byDate[key].notes += 1;
        } else if (plain.action === SERVICE_DATE_ACTION) {
            byDate[key].serviceDates += 1;
        }
    });

    const history = {
        labels,
        calls: [],
        uniquePatientsCalled: [],
        serviceDates: [],
        repeatCalls: [],
        notes: [],
        efficiency: [],
        conversionRate: [],
        repeatRate: [],
        callsPerServiceDate: [],
        notesPerCall: []
    };

    labels.forEach((label) => {
        const row = byDate[label];
        const unique = row.patients.size;
        history.calls.push(row.calls);
        history.uniquePatientsCalled.push(unique);
        history.serviceDates.push(row.serviceDates);
        history.repeatCalls.push(Math.max(row.calls - unique, 0));
        history.notes.push(row.notes);
        history.efficiency.push(row.calls ? Math.round((row.serviceDates / row.calls) * 100) : 0);
        history.conversionRate.push(unique ? Math.round((row.serviceDates / unique) * 100) : 0);
        history.repeatRate.push(row.calls ? Math.round((Math.max(row.calls - unique, 0) / row.calls) * 100) : 0);
        history.callsPerServiceDate.push(row.serviceDates ? Math.round((row.calls / row.serviceDates) * 10) / 10 : 0);
        history.notesPerCall.push(row.calls ? Math.round((row.notes / row.calls) * 10) / 10 : 0);
    });

    return {
        series: history,
        users: Object.keys(usersById)
            .map((key) => usersById[key])
            .sort((a, b) => String(a.user).localeCompare(String(b.user)))
    };
}

function selectedHistoryUserId(query) {
    const selectedUserId = parseInt(query && query.historyUserId, 10);
    return Number.isFinite(selectedUserId) && selectedUserId > 0 ? selectedUserId : null;
}

async function buildHistory(query, userOnly, userId) {
    const range = await getHistoryRange(query || {});
    const labels = dateKeysBetween(range.fromIso, range.toIso);
    const selectedUserId = !userOnly ? selectedHistoryUserId(query) : null;
    const where = {
        module: MODULE_NAME,
        action: { [Op.in]: [CALL_ACTION, NOTE_ACTION, SERVICE_DATE_ACTION] },
        createdAt: { [Op.between]: [range.from, range.to] }
    };
    if (userOnly && userId) where.userId = userId;

    const logs = await db.AuditLog.findAll({
        where,
        attributes: ['createdAt', 'action', 'recordId', 'userId'],
        include: [{ model: db.User, attributes: ['id', 'firstName', 'lastName', 'username'], required: false }],
        order: [['createdAt', 'ASC']]
    });
    const allSummarized = summarizeHistory(logs, labels);
    const chartLogs = selectedUserId
        ? logs.filter((log) => {
            const plain = log && typeof log.toJSON === 'function' ? log.toJSON() : log;
            return parseInt(plain.userId, 10) === selectedUserId;
        })
        : logs;
    const chartSummarized = selectedUserId ? summarizeHistory(chartLogs, labels) : allSummarized;

    return {
        range: { from: range.fromIso, to: range.toIso },
        selectedUserId: userOnly ? (userId || null) : selectedUserId,
        series: chartSummarized.series,
        users: allSummarized.users
    };
}

function getMetricsRange(req, sessionOnly) {
    const range = getRange(req.query || {});
    if (sessionOnly) {
        const sessionStart = currentSessionStart(req);
        if (sessionStart > range.from) range.from = sessionStart;
    }
    return range;
}

function summarizeMetrics(logs) {
    const totals = {
        calls: 0,
        uniquePatientsCalled: 0,
        repeatCalls: 0,
        notes: 0,
        serviceDates: 0,
        efficiency: 0,
        conversionRate: 0,
        repeatRate: 0,
        callsPerServiceDate: 0,
        notesPerCall: 0,
        lastActionAt: null
    };
    const uniquePatients = new Set();
    const byUser = {};

    logs.forEach((log) => {
        const plain = log && typeof log.toJSON === 'function' ? log.toJSON() : log;
        const userKey = String(plain.userId || 'system');
        if (!byUser[userKey]) {
            byUser[userKey] = {
                userId: plain.userId || null,
                user: getUserLabel(plain.User),
                calls: 0,
                uniquePatientsCalled: 0,
                repeatCalls: 0,
                notes: 0,
                serviceDates: 0,
                efficiency: 0,
                lastActionAt: null
            };
            byUser[userKey]._patients = new Set();
        }
        const row = byUser[userKey];
        if (!row.lastActionAt || new Date(plain.createdAt) > new Date(row.lastActionAt)) row.lastActionAt = plain.createdAt;
        if (!totals.lastActionAt || new Date(plain.createdAt) > new Date(totals.lastActionAt)) totals.lastActionAt = plain.createdAt;

        if (plain.action === CALL_ACTION) {
            totals.calls += 1;
            row.calls += 1;
            if (plain.recordId) {
                uniquePatients.add(plain.recordId);
                row._patients.add(plain.recordId);
            }
        } else if (plain.action === NOTE_ACTION) {
            totals.notes += 1;
            row.notes += 1;
        } else if (plain.action === SERVICE_DATE_ACTION) {
            totals.serviceDates += 1;
            row.serviceDates += 1;
        }
    });

    totals.uniquePatientsCalled = uniquePatients.size;
    totals.repeatCalls = Math.max(totals.calls - uniquePatients.size, 0);
    totals.efficiency = totals.calls ? Math.round((totals.serviceDates / totals.calls) * 100) : 0;
    totals.conversionRate = totals.uniquePatientsCalled ? Math.round((totals.serviceDates / totals.uniquePatientsCalled) * 100) : 0;
    totals.repeatRate = totals.calls ? Math.round((totals.repeatCalls / totals.calls) * 100) : 0;
    totals.callsPerServiceDate = totals.serviceDates ? Math.round((totals.calls / totals.serviceDates) * 10) / 10 : 0;
    totals.notesPerCall = totals.calls ? Math.round((totals.notes / totals.calls) * 10) / 10 : 0;

    const users = Object.keys(byUser).map((key) => {
        const row = byUser[key];
        row.uniquePatientsCalled = row._patients.size;
        row.repeatCalls = Math.max(row.calls - row._patients.size, 0);
        row.efficiency = row.calls ? Math.round((row.serviceDates / row.calls) * 100) : 0;
        row.conversionRate = row.uniquePatientsCalled ? Math.round((row.serviceDates / row.uniquePatientsCalled) * 100) : 0;
        row.repeatRate = row.calls ? Math.round((row.repeatCalls / row.calls) * 100) : 0;
        row.callsPerServiceDate = row.serviceDates ? Math.round((row.calls / row.serviceDates) * 10) / 10 : 0;
        row.notesPerCall = row.calls ? Math.round((row.notes / row.calls) * 10) / 10 : 0;
        delete row._patients;
        return row;
    }).sort((a, b) => b.calls - a.calls || b.serviceDates - a.serviceDates || String(a.user).localeCompare(String(b.user)));

    return { totals, users };
}

async function metricsFor(req, userOnly, options) {
    options = options || {};
    const range = getMetricsRange(req, options.sessionOnly === true);
    const where = {
        module: MODULE_NAME,
        action: { [Op.in]: [CALL_ACTION, NOTE_ACTION, SERVICE_DATE_ACTION] },
        createdAt: { [Op.between]: [range.from, range.to] }
    };
    if (userOnly && req.user && req.user.id) where.userId = req.user.id;
    if (!userOnly) {
        const selectedUserId = selectedHistoryUserId(req.query || {});
        if (selectedUserId) where.userId = selectedUserId;
    }

    const logs = await db.AuditLog.findAll({
        where,
        include: [{ model: db.User, attributes: ['id', 'firstName', 'lastName', 'username'], required: false }],
        order: [['createdAt', 'DESC']]
    });

    const summary = summarizeMetrics(logs);
    const result = {
        range: { from: range.fromIso, to: range.toIso },
        serviceWindowDays: getServiceWindowDays(),
        eligibilityCutoff: eligibilityCutoffIso(),
        eligibleTotal: await eligibleTotal(),
        availableEligibleTotal: await availableEligibleTotal(req.user && req.user.id),
        totals: summary.totals,
        users: summary.users
    };
    if (options.includeHistory === true) {
        result.history = await buildHistory(req.query || {}, userOnly, req.user && req.user.id);
    }
    return result;
}

exports.getMyMetrics = async (req, res) => {
    try {
        res.json(await metricsFor(req, true, { sessionOnly: true }));
    } catch (err) {
        console.error('[Call Center] getMyMetrics error:', err);
        res.status(500).json({ error: err.message });
    }
};

exports.getQueueMetrics = async (req, res) => {
    try {
        const data = await metricsFor(req, true, { sessionOnly: true });
        data.users = [];
        res.json(data);
    } catch (err) {
        console.error('[Call Center] getQueueMetrics error:', err);
        res.status(500).json({ error: err.message });
    }
};

exports.getReviewMetrics = async (req, res) => {
    try {
        res.json(await metricsFor(req, false, { sessionOnly: false, includeHistory: true }));
    } catch (err) {
        console.error('[Call Center] getReviewMetrics error:', err);
        res.status(500).json({ error: err.message });
    }
};

function drilldownConfig(metric) {
    const key = String(metric || '').trim().toLowerCase();
    const map = {
        calls: {
            title: 'Call Center Calls',
            actions: [CALL_ACTION],
            description: 'Patients with call records in the selected range.'
        },
        patients: {
            title: 'Patients Called',
            actions: [CALL_ACTION],
            description: 'Unique patients called in the selected range.'
        },
        dates: {
            title: 'Service Dates Entered',
            actions: [SERVICE_DATE_ACTION],
            description: 'Patients where a new service date was entered in the selected range.'
        },
        repeats: {
            title: 'Repeat Calls',
            actions: [CALL_ACTION],
            repeatOnly: true,
            description: 'Patients with more than one call in the selected range.'
        },
        efficiency: {
            title: 'Efficiency Service Dates',
            actions: [SERVICE_DATE_ACTION],
            description: 'Patients behind the service-date side of the efficiency calculation.'
        },
        conversion: {
            title: 'Conversion Service Dates',
            actions: [SERVICE_DATE_ACTION],
            description: 'Patients behind the service-date side of the conversion calculation.'
        },
        'repeat-rate': {
            title: 'Repeat Rate Patients',
            actions: [CALL_ACTION],
            repeatOnly: true,
            description: 'Patients behind the repeat-call side of the repeat-rate calculation.'
        },
        'calls-per-date': {
            title: 'Calls Per Service Date',
            actions: [CALL_ACTION, SERVICE_DATE_ACTION],
            serviceDateOnly: true,
            description: 'Patients with service dates, including their call counts in the range.'
        },
        'notes-per-call': {
            title: 'Call Center Notes',
            actions: [NOTE_ACTION],
            description: 'Patients with Call Center notes in the selected range.'
        },
        'last-activity': {
            title: 'Last Call Center Activity',
            actions: [CALL_ACTION, NOTE_ACTION, SERVICE_DATE_ACTION],
            description: 'Patients with any Call Center activity in the selected range.'
        }
    };
    return map[key] ? { key, ...map[key] } : { key: 'calls', ...map.calls };
}

function emptyPatientStats() {
    return {
        calls: 0,
        serviceDates: 0,
        notes: 0,
        repeatCalls: 0,
        lastActionAt: null,
        lastActionBy: null,
        actions: 0
    };
}

function updatePatientStats(stats, log) {
    const plain = log && typeof log.toJSON === 'function' ? log.toJSON() : log;
    if (!plain) return;
    stats.actions += 1;
    if (plain.action === CALL_ACTION) stats.calls += 1;
    if (plain.action === SERVICE_DATE_ACTION) stats.serviceDates += 1;
    if (plain.action === NOTE_ACTION) stats.notes += 1;
    stats.repeatCalls = Math.max(stats.calls - 1, 0);
    if (!stats.lastActionAt || new Date(plain.createdAt) > new Date(stats.lastActionAt)) {
        stats.lastActionAt = plain.createdAt;
        stats.lastActionBy = getUserLabel(plain.User);
    }
}

function sortDrilldownRows(rows, metric) {
    return rows.sort((a, b) => {
        if (metric === 'repeats' || metric === 'repeat-rate') return (b.repeatCalls - a.repeatCalls) || (b.calls - a.calls);
        if (metric === 'calls') return (b.calls - a.calls) || String(b.lastActionAt || '').localeCompare(String(a.lastActionAt || ''));
        if (metric === 'dates' || metric === 'efficiency' || metric === 'conversion' || metric === 'calls-per-date') {
            return (b.serviceDates - a.serviceDates) || String(b.lastActionAt || '').localeCompare(String(a.lastActionAt || ''));
        }
        if (metric === 'notes-per-call') return (b.notes - a.notes) || String(b.lastActionAt || '').localeCompare(String(a.lastActionAt || ''));
        return String(b.lastActionAt || '').localeCompare(String(a.lastActionAt || ''));
    });
}

function emptyDrilldownHistory() {
    return {
        calls: [],
        serviceDates: [],
        notes: []
    };
}

function getDrilldownHistoryBucket(map, patientId) {
    const key = String(patientId);
    if (!map[key]) map[key] = emptyDrilldownHistory();
    return map[key];
}

async function getReviewDrilldownHistory(patientIds, range, selectedUserId) {
    const ids = parsePatientIds(patientIds);
    const history = {};
    ids.forEach((id) => { history[String(id)] = emptyDrilldownHistory(); });
    if (!ids.length) return history;

    const auditWhere = {
        module: MODULE_NAME,
        action: { [Op.in]: [CALL_ACTION, SERVICE_DATE_ACTION] },
        recordId: { [Op.in]: ids },
        createdAt: { [Op.between]: [range.from, range.to] }
    };
    if (selectedUserId) auditWhere.userId = selectedUserId;

    const noteWhere = {
        patientId: { [Op.in]: ids },
        source: 'Call Center',
        createdAt: { [Op.between]: [range.from, range.to] }
    };
    if (selectedUserId) noteWhere.userId = selectedUserId;

    const [auditLogs, notes] = await Promise.all([
        db.AuditLog.findAll({
            where: auditWhere,
            attributes: ['createdAt', 'action', 'recordId', 'userId', 'newValue'],
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

    auditLogs.forEach((log) => {
        const plain = log && typeof log.toJSON === 'function' ? log.toJSON() : log;
        const id = parseInt(plain && plain.recordId, 10);
        if (!Number.isFinite(id)) return;
        const bucket = getDrilldownHistoryBucket(history, id);
        if (plain.action === CALL_ACTION) {
            bucket.calls.push({
                at: plain.createdAt,
                user: getUserLabel(plain.User)
            });
        } else if (plain.action === SERVICE_DATE_ACTION) {
            bucket.serviceDates.push({
                at: plain.createdAt,
                user: getUserLabel(plain.User),
                serviceDate: auditServiceDate(plain.newValue)
            });
        }
    });

    notes.forEach((note) => {
        const plain = note && typeof note.toJSON === 'function' ? note.toJSON() : note;
        const id = parseInt(plain && plain.patientId, 10);
        if (!Number.isFinite(id)) return;
        getDrilldownHistoryBucket(history, id).notes.push({
            at: plain.createdAt,
            user: getUserLabel(plain.Author),
            note: plain.note || ''
        });
    });

    return history;
}

exports.getReviewDrilldown = async (req, res) => {
    try {
        const config = drilldownConfig(req.query && req.query.metric);
        const range = getMetricsRange(req, false);
        const where = {
            module: MODULE_NAME,
            action: { [Op.in]: config.actions },
            recordId: { [Op.ne]: null },
            createdAt: { [Op.between]: [range.from, range.to] }
        };
        const selectedUserId = selectedHistoryUserId(req.query || {});
        if (selectedUserId) where.userId = selectedUserId;

        const logs = await db.AuditLog.findAll({
            where,
            attributes: ['id', 'createdAt', 'action', 'recordId', 'userId'],
            include: [{ model: db.User, attributes: ['id', 'firstName', 'lastName', 'username'], required: false }],
            order: [['createdAt', 'DESC']]
        });

        const byPatient = {};
        logs.forEach((log) => {
            const plain = log && typeof log.toJSON === 'function' ? log.toJSON() : log;
            const id = parseInt(plain && plain.recordId, 10);
            if (!Number.isFinite(id)) return;
            const key = String(id);
            if (!byPatient[key]) byPatient[key] = emptyPatientStats();
            updatePatientStats(byPatient[key], log);
        });

        let patientIds = Object.keys(byPatient).map((id) => parseInt(id, 10)).filter((id) => Number.isFinite(id));
        if (config.repeatOnly) patientIds = patientIds.filter((id) => (byPatient[String(id)].calls || 0) > 1);
        if (config.serviceDateOnly) patientIds = patientIds.filter((id) => (byPatient[String(id)].serviceDates || 0) > 0);

        if (!patientIds.length) {
            return res.json({
                metric: config.key,
                title: config.title,
                description: config.description,
                range: { from: range.fromIso, to: range.toIso },
                rows: [],
                totals: { patients: 0, calls: 0, serviceDates: 0, notes: 0, repeatCalls: 0 }
            });
        }

        const [patients, patientHistory] = await Promise.all([
            db.Patient.findAll({
            where: { id: { [Op.in]: patientIds } },
            attributes: ['id', 'patientCode', 'firstName', 'lastName', 'phone', 'serviceDate', 'isActive'],
            include: [{ model: db.Clinic, attributes: ['name'], required: false }]
            }),
            getReviewDrilldownHistory(patientIds, range, selectedUserId)
        ]);

        const rows = patients.map((patient) => {
            const plain = patient && typeof patient.toJSON === 'function' ? patient.toJSON() : patient;
            const stats = byPatient[String(plain.id)] || emptyPatientStats();
            const history = patientHistory[String(plain.id)] || emptyDrilldownHistory();
            return {
                id: plain.id,
                patientCode: plain.patientCode || `PAT-${plain.id}`,
                firstName: plain.firstName || '',
                lastName: plain.lastName || '',
                phone: plain.phone || '',
                serviceDate: plain.serviceDate || null,
                status: plain.isActive ? 'Active' : 'Inactive',
                clinicName: plain.Clinic ? plain.Clinic.name : null,
                calls: stats.calls,
                serviceDates: stats.serviceDates,
                notes: stats.notes,
                repeatCalls: stats.repeatCalls,
                lastActionAt: stats.lastActionAt,
                lastActionBy: stats.lastActionBy,
                callHistory: history.calls,
                serviceDateHistory: history.serviceDates,
                noteHistory: history.notes
            };
        });
        sortDrilldownRows(rows, config.key);

        const totals = rows.reduce((memo, row) => {
            memo.calls += row.calls || 0;
            memo.serviceDates += row.serviceDates || 0;
            memo.notes += row.notes || 0;
            memo.repeatCalls += row.repeatCalls || 0;
            return memo;
        }, { patients: rows.length, calls: 0, serviceDates: 0, notes: 0, repeatCalls: 0 });

        res.json({
            metric: config.key,
            title: config.title,
            description: config.description,
            range: { from: range.fromIso, to: range.toIso },
            selectedUserId,
            totals,
            rows
        });
    } catch (err) {
        console.error('[Call Center] getReviewDrilldown error:', err);
        res.status(500).json({ error: err.message });
    }
};
