'use strict';

const crypto = require('crypto');
const db = require('../models');
const { updateOwnedCallCenterClaim } = require('../services/callCenterClaimService');

const STATES = new Set(['dialing', 'trying', 'ringing', 'connected', 'ended', 'failed']);
const TERMINAL_STATES = new Set(['ended', 'failed']);
const OUTCOMES = new Set(['answered', 'no_answer', 'busy', 'rejected', 'unavailable', 'cancelled', 'failed']);

function cleanText(value, maxLength) {
    const clean = String(value || '').trim().replace(/[\u0000-\u001f\u007f]/g, ' ');
    return clean.slice(0, maxLength);
}

function normalizeDialNumber(value) {
    return String(value || '').trim().replace(/[^0-9+*#]/g, '').slice(0, 64);
}

function timestamp(value) {
    if (!value) return null;
    const parsed = new Date(String(value));
    return isNaN(parsed.getTime()) ? null : parsed;
}

function secondsBetween(start, end) {
    if (!start || !end) return null;
    const duration = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000);
    return Number.isFinite(duration) ? Math.max(0, Math.min(duration, 24 * 60 * 60)) : null;
}

function userLabel(user) {
    const full = `${user && user.firstName || ''} ${user && user.lastName || ''}`.trim();
    return full || (user && user.username) || (user && user.id ? `User ${user.id}` : 'System');
}

function requestIp(req) {
    const forwarded = req.headers && req.headers['x-forwarded-for'];
    return cleanText(forwarded ? String(forwarded).split(',')[0] : (req.ip || req.connection && req.connection.remoteAddress || ''), 64);
}

function auditDateParts(value) {
    const date = value instanceof Date ? value : new Date(value);
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return { date: `${y}-${m}-${d}`, time: date.toTimeString().split(' ')[0] };
}

function publicAttempt(attempt) {
    const plain = attempt && typeof attempt.toJSON === 'function' ? attempt.toJSON() : attempt;
    if (!plain) return null;
    return {
        id: plain.id,
        patientId: plain.patientId,
        correlationId: plain.correlationId,
        phoneClient: plain.phoneClient,
        direction: plain.direction,
        state: plain.state,
        outcome: plain.outcome,
        patientCode: plain.patientCode,
        patientName: plain.patientName,
        clinicName: plain.clinicName,
        agentName: plain.agentName,
        extension: plain.extension,
        dialedNumber: plain.dialedNumber,
        sipResponseCode: plain.sipResponseCode,
        sipReason: plain.sipReason,
        dialedAt: plain.dialedAt,
        ringingAt: plain.ringingAt,
        answeredAt: plain.answeredAt,
        endedAt: plain.endedAt,
        ringDurationSeconds: plain.ringDurationSeconds,
        conversationDurationSeconds: plain.conversationDurationSeconds,
        calledRecorded: !!plain.calledAuditLogId
    };
}

function deriveOutcome(attempt, state, requestedOutcome) {
    if (attempt.answeredAt || state === 'connected') return 'answered';
    if (OUTCOMES.has(requestedOutcome)) return requestedOutcome;
    if (state === 'failed') return 'failed';
    if (state === 'ended') return 'cancelled';
    return null;
}

async function recordAnsweredCall(ipAddress, attempt, transaction) {
    if (attempt.calledAuditLogId || !attempt.answeredAt || !attempt.patientId) return false;
    const patient = await db.Patient.findByPk(attempt.patientId, { transaction });
    if (!patient) return false;

    const now = new Date(attempt.answeredAt);
    const parts = auditDateParts(now);
    const audit = await db.AuditLog.create({
        userId: attempt.userId,
        date: parts.date,
        time: parts.time,
        module: 'Call Center',
        action: 'Called',
        recordId: patient.id,
        previousValue: null,
        newValue: {
            phoneClient: 'rx_softphone',
            autoRecorded: true,
            callAttemptId: attempt.id,
            answerAcknowledged: true,
            callDialedAt: attempt.dialedAt,
            callAnsweredAt: attempt.answeredAt,
            callEndedAt: attempt.endedAt,
            callDurationSeconds: attempt.conversationDurationSeconds
        },
        ipAddress: cleanText(ipAddress, 64)
    }, { transaction });
    attempt.calledAuditLogId = audit.id;
    return true;
}

async function updateCalledAudit(attempt, transaction) {
    if (!attempt.calledAuditLogId) return;
    const audit = await db.AuditLog.findByPk(attempt.calledAuditLogId, { transaction });
    if (!audit) {
        attempt.calledAuditLogId = null;
        return;
    }
    const previous = audit.newValue && typeof audit.newValue === 'object' ? audit.newValue : {};
    audit.newValue = Object.assign({}, previous, {
        callEndedAt: attempt.endedAt,
        callDurationSeconds: attempt.conversationDurationSeconds,
        callOutcome: attempt.outcome,
        sipResponseCode: attempt.sipResponseCode,
        sipReason: attempt.sipReason
    });
    await audit.save({ transaction });
}

exports.startAttempt = async (req, res) => {
    try {
        const patientId = parseInt(req.body && req.body.patientId, 10);
        if (!Number.isFinite(patientId)) return res.status(400).json({ error: 'A valid patient is required.' });

        const patient = await db.Patient.findOne({
            where: {
                id: patientId,
                [db.Sequelize.Op.or]: [{ isDeleted: false }, { isDeleted: null }]
            },
            include: [{ model: db.Clinic, attributes: ['name'], required: false }]
        });
        if (!patient) return res.status(404).json({ error: 'Patient not found.' });

        const patientNumber = normalizeDialNumber(patient.phone);
        const requestedNumber = normalizeDialNumber(req.body && req.body.dialedNumber);
        if (!patientNumber) return res.status(400).json({ error: 'The patient does not have a callable phone number.' });
        if (requestedNumber && requestedNumber !== patientNumber) {
            return res.status(400).json({ error: 'Dialed number does not match the selected patient.' });
        }

        const account = await db.UserSoftphoneAccount.findOne({ where: { userId: req.user.id, isEnabled: true } });
        const attempt = await db.sequelize.transaction(async transaction => {
            const claimExtended = await updateOwnedCallCenterClaim(patient.id, req.user.id, true, {
                transaction,
                requireUnexpired: true
            });
            if (!claimExtended) {
                const error = new Error('Patient claim expired. Click the phone icon and try again.');
                error.status = 409;
                throw error;
            }
            return db.CallCenterCallAttempt.create({
                patientId: patient.id,
                userId: req.user.id,
                correlationId: crypto.randomUUID(),
                phoneClient: 'rx_softphone',
                direction: 'outbound',
                state: 'dialing',
                patientCode: cleanText(patient.patientCode, 60),
                patientName: cleanText(`${patient.firstName || ''} ${patient.lastName || ''}`.trim(), 255),
                clinicName: cleanText(patient.Clinic && patient.Clinic.name, 255),
                agentName: cleanText(userLabel(req.user), 255),
                extension: cleanText(account && account.username, 128),
                dialedNumber: patientNumber,
                dialedAt: new Date()
            }, { transaction });
        });
        res.status(201).json({ attempt: publicAttempt(attempt) });
    } catch (err) {
        const status = err.status || 500;
        if (status >= 500) console.error('[Call Attempts] start error:', err);
        res.status(status).json({ error: status >= 500 ? 'Could not start the call-attempt record.' : err.message });
    }
};

exports.getOwnAttemptByCorrelation = async (req, res) => {
    try {
        const correlationId = cleanText(req.params.correlationId, 64);
        const attempt = await db.CallCenterCallAttempt.findOne({ where: { correlationId, userId: req.user.id } });
        if (!attempt) return res.status(404).json({ error: 'Call attempt not found.' });
        res.json({ attempt: publicAttempt(attempt) });
    } catch (err) {
        res.status(500).json({ error: 'Could not load the call-attempt record.' });
    }
};

async function updateAttemptForUser(userId, attemptId, body, ipAddress) {
    let calledRecorded = false;
    const updated = await db.sequelize.transaction(async transaction => {
            const attempt = await db.CallCenterCallAttempt.findOne({
                where: { id: attemptId, userId },
                transaction,
                lock: transaction.LOCK.UPDATE
            });
            if (!attempt) {
                const err = new Error('Call attempt not found.');
                err.status = 404;
                throw err;
            }

            const state = cleanText(body.state, 24).toLowerCase();
            if (!STATES.has(state)) {
                const err = new Error('Unsupported call state.');
                err.status = 400;
                throw err;
            }

            const ringingAt = timestamp(body.ringingAt);
            const answeredAt = timestamp(body.answeredAt);
            const endedAt = timestamp(body.endedAt);
            if (!attempt.ringingAt && ringingAt) attempt.ringingAt = ringingAt;
            if (!attempt.answeredAt && (answeredAt || state === 'connected')) attempt.answeredAt = answeredAt || new Date();
            if (TERMINAL_STATES.has(state) && !attempt.endedAt) attempt.endedAt = endedAt || new Date();
            attempt.state = state;

            const responseCode = Number(body.sipResponseCode);
            if (Number.isInteger(responseCode) && responseCode >= 100 && responseCode <= 699) {
                attempt.sipResponseCode = responseCode;
            }
            const reason = cleanText(body.sipReason, 255);
            if (reason) attempt.sipReason = reason;

            const requestedOutcome = cleanText(body.outcome, 32).toLowerCase();
            attempt.outcome = deriveOutcome(attempt, state, requestedOutcome);
            const ringEnd = attempt.answeredAt || attempt.endedAt;
            attempt.ringDurationSeconds = secondsBetween(attempt.ringingAt || attempt.dialedAt, ringEnd);
            attempt.conversationDurationSeconds = secondsBetween(attempt.answeredAt, attempt.endedAt);

            calledRecorded = await recordAnsweredCall(ipAddress, attempt, transaction);
            if (attempt.calledAuditLogId && TERMINAL_STATES.has(state)) {
                await updateCalledAudit(attempt, transaction);
            }
            await attempt.save({ transaction });
            await updateOwnedCallCenterClaim(attempt.patientId, attempt.userId, !TERMINAL_STATES.has(state), {
                transaction,
                requireUnexpired: false
            });
            return attempt;
        });

    return { attempt: publicAttempt(updated), calledRecorded };
}

exports.updateAttempt = async (req, res) => {
    try {
        const attemptId = parseInt(req.params.id, 10);
        if (!Number.isFinite(attemptId)) return res.status(400).json({ error: 'Invalid call-attempt id.' });
        const result = await updateAttemptForUser(req.user.id, attemptId, req.body || {}, requestIp(req));

        res.json(result);
    } catch (err) {
        const status = err.status || 500;
        if (status >= 500) console.error('[Call Attempts] update error:', err);
        res.status(status).json({ error: status >= 500 ? 'Could not update the call-attempt record.' : err.message });
    }
};

exports.publicAttempt = publicAttempt;
exports.updateAttemptForUser = updateAttemptForUser;
