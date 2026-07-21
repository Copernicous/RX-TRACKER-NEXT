'use strict';

const { Op } = require('sequelize');
const db = require('../models');
const { getCallCenterInactiveClaimSeconds } = require('../utils/globalSettings');

const ACTIVE_CALL_STATES = ['dialing', 'trying', 'ringing', 'connected'];
const ACTIVE_CALL_CLAIM_MS = 10 * 60 * 1000;

function makeCallCenterClaimExpiresAt(active, now) {
    const base = now instanceof Date ? now : new Date();
    const durationMs = active
        ? ACTIVE_CALL_CLAIM_MS
        : getCallCenterInactiveClaimSeconds() * 1000;
    return new Date(base.getTime() + durationMs);
}

async function hasActiveCallAttempt(patientId, userId, options) {
    const count = await db.CallCenterCallAttempt.count({
        where: {
            patientId,
            userId,
            state: { [Op.in]: ACTIVE_CALL_STATES },
            endedAt: null
        },
        transaction: options && options.transaction
    });
    return count > 0;
}

async function updateOwnedCallCenterClaim(patientId, userId, active, options) {
    options = options || {};
    const now = new Date();
    const where = { patientId, userId };
    if (options.requireUnexpired !== false) where.expiresAt = { [Op.gt]: now };
    const [updated] = await db.CallCenterLock.update({
        expiresAt: makeCallCenterClaimExpiresAt(active, now)
    }, {
        where,
        transaction: options.transaction
    });
    return updated > 0;
}

async function refreshOwnedCallCenterClaim(patientId, userId) {
    const active = await hasActiveCallAttempt(patientId, userId);
    const refreshed = await updateOwnedCallCenterClaim(patientId, userId, active, {
        requireUnexpired: true
    });
    return { refreshed, active };
}

module.exports = {
    ACTIVE_CALL_STATES,
    ACTIVE_CALL_CLAIM_MS,
    makeCallCenterClaimExpiresAt,
    hasActiveCallAttempt,
    updateOwnedCallCenterClaim,
    refreshOwnedCallCenterClaim
};
