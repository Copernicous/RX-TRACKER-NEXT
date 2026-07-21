'use strict';

const crypto = require('crypto');
const settings = require('./settingsService');

const sessions = new Map();
const DEFAULT_TIMEOUT_MINUTES = 30;
const MIN_TIMEOUT_MINUTES = 1;
const MAX_TIMEOUT_MINUTES = 480;
let lastPruneAt = 0;

function cleanTimeoutMinutes(value) {
    const parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed)) return DEFAULT_TIMEOUT_MINUTES;
    return Math.min(Math.max(parsed, MIN_TIMEOUT_MINUTES), MAX_TIMEOUT_MINUTES);
}

function getTimeoutMinutes() {
    return cleanTimeoutMinutes(
        settings.get('session_timeout_minutes') ||
        process.env.SESSION_TIMEOUT_MINUTES ||
        DEFAULT_TIMEOUT_MINUTES
    );
}

function getTimeoutMs() {
    return getTimeoutMinutes() * 60 * 1000;
}

function createSessionId() {
    return crypto.randomBytes(24).toString('base64url');
}

function getSessionKey(token, decoded) {
    if (decoded && decoded.sid) return String(decoded.sid);
    return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function getTokenIssuedAt(decoded, now) {
    const iatMs = decoded && decoded.iat ? Number(decoded.iat) * 1000 : 0;
    return Number.isFinite(iatMs) && iatMs > 0 ? iatMs : now;
}

function getOrCreateEntry(key, decoded, now) {
    const existing = sessions.get(key);
    if (existing) return existing;

    const issuedAt = getTokenIssuedAt(decoded, now);
    const entry = {
        userId: decoded && decoded.id ? decoded.id : null,
        startedAt: issuedAt,
        lastActivityAt: issuedAt
    };
    sessions.set(key, entry);
    return entry;
}

function pruneExpired(now, timeoutMs) {
    if (now - lastPruneAt < 60 * 1000) return;
    lastPruneAt = now;
    sessions.forEach((entry, key) => {
        if (now - entry.lastActivityAt > timeoutMs) sessions.delete(key);
    });
}

function validate(token, decoded, opts) {
    opts = opts || {};
    const now = opts.now || Date.now();
    const key = getSessionKey(token, decoded);
    const timeoutMs = opts.timeoutMs || getTimeoutMs();
    pruneExpired(now, timeoutMs);
    const entry = getOrCreateEntry(key, decoded, now);
    const idleMs = now - entry.lastActivityAt;

    if (idleMs > timeoutMs) {
        sessions.delete(key);
        return {
            ok: false,
            key,
            reason: 'idle_timeout',
            timeoutMinutes: Math.round(timeoutMs / 60000),
            idleMs
        };
    }

    return {
        ok: true,
        key,
        timeoutMinutes: Math.round(timeoutMs / 60000),
        idleMs
    };
}

function touch(token, decoded, opts) {
    opts = opts || {};
    const now = opts.now || Date.now();
    const key = getSessionKey(token, decoded);
    pruneExpired(now, getTimeoutMs());
    const existing = sessions.get(key);
    sessions.set(key, {
        userId: decoded && decoded.id ? decoded.id : (existing ? existing.userId : null),
        startedAt: existing ? existing.startedAt : getTokenIssuedAt(decoded, now),
        lastActivityAt: now
    });
    return key;
}

function start(token, decoded, opts) {
    return touch(token, decoded, opts);
}

function end(token, decoded) {
    if (!token && !(decoded && decoded.sid)) return;
    sessions.delete(getSessionKey(token, decoded));
}

function getSessionInfo(token, decoded) {
    return sessions.get(getSessionKey(token, decoded)) || null;
}

function resetForTests() {
    sessions.clear();
    lastPruneAt = 0;
}

module.exports = {
    cleanTimeoutMinutes,
    createSessionId,
    end,
    getSessionInfo,
    getTimeoutMinutes,
    getTimeoutMs,
    resetForTests,
    start,
    touch,
    validate
};
