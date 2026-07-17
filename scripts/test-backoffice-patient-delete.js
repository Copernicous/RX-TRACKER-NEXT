'use strict';

const assert = require('assert');
const db = require('../models');
const adminController = require('../controllers/adminController');

function makeResponse() {
    return {
        statusCode: 200,
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(payload) {
            this.body = payload;
            return this;
        }
    };
}

async function runCase(options) {
    const ids = options.ids || [101];
    const transaction = {
        committed: false,
        rolledBack: false,
        async commit() { this.committed = true; },
        async rollback() { this.rolledBack = true; }
    };
    const calls = [];
    const originalTransaction = db.sequelize.transaction;
    const originalQuery = db.sequelize.query;
    const originalAuditCreate = db.AuditLog.create;

    db.sequelize.transaction = async () => transaction;
    db.sequelize.query = async (sql, queryOptions) => {
        calls.push({ sql, queryOptions });
        const normalized = sql.replace(/\s+/g, ' ').trim();

        if (normalized.startsWith('SELECT id FROM "Patients"') && normalized.includes('FOR UPDATE')) {
            return options.found === false ? [] : ids.map(id => ({ id }));
        }
        if (normalized.startsWith('DELETE FROM "Patients"')) {
            return options.deletedCount === 0 ? [] : ids.map(id => ({ id }));
        }
        if (normalized.startsWith('SELECT id FROM "Patients"')) {
            return options.remaining ? [{ id: ids[0] }] : [];
        }
        if (normalized.startsWith('DELETE FROM')) {
            return [{ id: calls.length + 1000 }];
        }
        throw new Error(`Unexpected SQL in test: ${normalized}`);
    };
    db.AuditLog.create = async () => ({ id: 1 });

    const req = {
        body: { tableName: 'Patients', ids: ids.map(String) },
        user: { id: 7 }
    };
    const res = makeResponse();

    try {
        await adminController.deleteRows(req, res);
        return { res, transaction, calls };
    } finally {
        db.sequelize.transaction = originalTransaction;
        db.sequelize.query = originalQuery;
        db.AuditLog.create = originalAuditCreate;
    }
}

async function main() {
    // Backoffice hard deletion is intentionally independent of active/soft-delete
    // state; both states follow the same validated SQL path.
    for (const state of ['active', 'inactive', 'soft-deleted']) {
        const stateId = { active: 101, inactive: 151, 'soft-deleted': 202 }[state];
        const result = await runCase({ ids: [stateId] });
        assert.strictEqual(result.res.statusCode, 200, `${state}: status`);
        assert.strictEqual(result.res.body.success, true, `${state}: success response`);
        assert.strictEqual(result.res.body.results.deleted, 1, `${state}: accurate parent count`);
        assert.strictEqual(result.transaction.committed, true, `${state}: committed`);
        assert.strictEqual(result.transaction.rolledBack, false, `${state}: not rolled back`);
        assert.ok(result.calls.some(c => c.sql.includes('DELETE FROM "DocumentAttachments"')), `${state}: attachments deleted`);
        assert.ok(result.calls.some(c => c.sql.includes('DELETE FROM "PatientServiceDateCycles"')), `${state}: cycles deleted`);
    }

    const missing = await runCase({ ids: [303], found: false });
    assert.strictEqual(missing.res.statusCode, 404, 'missing target: status');
    assert.match(missing.res.body.error, /Nothing was deleted/, 'missing target: clear response');
    assert.strictEqual(missing.transaction.committed, false, 'missing target: not committed');
    assert.strictEqual(missing.transaction.rolledBack, true, 'missing target: rolled back');
    assert.ok(!missing.calls.some(c => c.sql.startsWith('DELETE')), 'missing target: no DELETE issued');

    const incomplete = await runCase({ ids: [404], deletedCount: 0 });
    assert.strictEqual(incomplete.res.statusCode, 500, 'incorrect delete count: status');
    assert.match(incomplete.res.body.error, /expected 1 row\(s\), deleted 0/, 'incorrect delete count: clear response');
    assert.strictEqual(incomplete.transaction.committed, false, 'incorrect delete count: not committed');
    assert.strictEqual(incomplete.transaction.rolledBack, true, 'incorrect delete count: rolled back');

    const remaining = await runCase({ ids: [505], remaining: true });
    assert.strictEqual(remaining.res.statusCode, 500, 'remaining target: status');
    assert.match(remaining.res.body.error, /still exist/, 'remaining target: clear response');
    assert.strictEqual(remaining.transaction.committed, false, 'remaining target: not committed');
    assert.strictEqual(remaining.transaction.rolledBack, true, 'remaining target: rolled back');

    console.log('Backoffice patient permanent-delete tests passed.');
}

main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
}).finally(async () => {
    await db.sequelize.close().catch(() => {});
});
