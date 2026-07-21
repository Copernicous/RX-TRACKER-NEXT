'use strict';

const assert = require('assert');
const db = require('../models');
const callCenterController = require('../controllers/callCenterController');

async function main() {
    const originalFindLocks = db.CallCenterLock.findAll;
    const originalFindAttempts = db.CallCenterCallAttempt.findAll;
    try {
        db.CallCenterLock.findAll = async () => [{
            patientId: 5,
            userId: 1,
            lockedAt: new Date(Date.now() - 5000),
            expiresAt: new Date(Date.now() + 60000),
            User: {
                id: 1,
                username: 'agent-one',
                firstName: 'Agent',
                lastName: 'One'
            }
        }];
        db.CallCenterCallAttempt.findAll = async () => [{
            patientId: 5,
            userId: 1,
            state: 'ringing',
            dialedAt: new Date(Date.now() - 4000),
            answeredAt: null
        }];

        let payload = null;
        let cacheControl = null;
        await callCenterController.getLockStatuses({
            query: { patientIds: '5' },
            user: { id: 2, role: 'Call Center' }
        }, {
            set(name, value) {
                if (name === 'Cache-Control') cacheControl = value;
            },
            json(value) {
                payload = value;
                return this;
            },
            status() {
                return this;
            }
        });

        assert(payload && Array.isArray(payload.statuses), 'Shared phone availability response is missing.');
        assert.strictEqual(payload.statuses.length, 1, 'The active patient must be visible to another user.');
        assert.deepStrictEqual({
            patientId: payload.statuses[0].patientId,
            status: payload.statuses[0].status,
            mine: payload.statuses[0].mine,
            user: payload.statuses[0].user,
            callState: payload.statuses[0].callState
        }, {
            patientId: 5,
            status: 'active',
            mine: false,
            user: 'Agent One',
            callState: 'ringing'
        }, 'Another user did not receive the shared ringing state and owner.');
        assert.strictEqual(cacheControl, 'no-store', 'Shared call state must never be served from cache.');

        console.log('PASS Call Center shares active call owner and state across users.');
    } finally {
        db.CallCenterLock.findAll = originalFindLocks;
        db.CallCenterCallAttempt.findAll = originalFindAttempts;
    }
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});
