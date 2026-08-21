'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { Op, QueryTypes } = require('sequelize');

const databaseName = String(process.env.DB_NAME || '');
if (!/(?:qa|test)/i.test(databaseName) || !/(?:driver|pharmacy.*transport)/i.test(databaseName)) {
    throw new Error(
        `Refusing Pharmacy Transport duplicate regression on "${databaseName || '(unset)'}"; ` +
        'set DB_NAME to a dedicated database containing qa/test and driver/pharmacy_transport.'
    );
}

process.env.BACKUP_SCHEDULER_ENABLED = 'false';
process.env.SITE_BACKUP_SCHEDULER_ENABLED = 'false';

const db = require('../models');
const { assertDatabaseReady } = require('../db/schema-verifier');
const controller = require('../controllers/pharmacyTransportController');
const importController = require('../controllers/importController');

const runId = `${Date.now().toString(36)}-${process.pid}`;
const prefix = `QA PT Duplicate ${runId}`;

function request(body = {}, params = {}) {
    return { body, params, query: {}, user: { id: null } };
}

function runHandler(handler, req) {
    return new Promise(resolve => {
        const res = {
            statusCode: 200,
            status(code) { this.statusCode = code; return this; },
            json(payload) { resolve({ status: this.statusCode, payload }); },
            send(payload) { resolve({ status: this.statusCode, payload }); }
        };
        Promise.resolve(handler(req, res)).catch(error => {
            resolve({ status: 500, payload: { error: error.message } });
        });
    });
}

async function cleanup() {
    await db.PharmacyTransportCompany.destroy({
        where: { companyName: { [Op.iLike]: `${prefix}%` } },
        force: true
    });
}

async function main() {
    const appSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');
    assert.match(appSource, /crudState\.module === 'pharmacy-transport' \? p\.canEdit : p\.canDelete/);
    assert.match(appSource, /res\.status === 409 && crudState\.module === 'pharmacy-transport' && err\.duplicate/);
    assert.match(appSource, /inactiveToggle\.checked = true/);

    await assertDatabaseReady(db);
    await cleanup();

    const legacy = await db.PharmacyTransportCompany.create({
        companyName: `${prefix} Angel`,
        isActive: false
    });
    await db.PharmacyTransportCompany.create({
        companyName: `${prefix.toLowerCase()}   angel`,
        isActive: false
    });

    let result = await runHandler(controller.create, request({
        companyName: `  ${prefix.toLowerCase()}   angel  `,
        isActive: true
    }));
    assert.strictEqual(result.status, 409);
    assert.strictEqual(result.payload.duplicate.id, legacy.id);
    assert.strictEqual(result.payload.duplicate.isActive, false);
    assert.match(result.payload.error, /Show Disabled and restore/i);

    result = await runHandler(controller.restore, request({}, { id: legacy.id }));
    assert.strictEqual(result.status, 200, JSON.stringify(result.payload));

    result = await runHandler(controller.update, request({
        companyName: ` ${prefix.toLowerCase()}   angel `,
        phone: '555-0199'
    }, { id: legacy.id }));
    assert.strictEqual(result.status, 200, JSON.stringify(result.payload));
    assert.strictEqual(result.payload.phone, '555-0199');

    result = await runHandler(controller.create, request({ companyName: `${prefix} ANGEL` }));
    assert.strictEqual(result.status, 409);
    assert.strictEqual(result.payload.duplicate.isActive, true);

    result = await runHandler(controller.delete, request({}, { id: legacy.id }));
    assert.strictEqual(result.status, 200);

    result = await runHandler(controller.create, request({
        companyName: ` ${prefix}   Unique `,
        phone: ' 555-0100 ',
        isActive: false,
        id: 999999
    }));
    assert.strictEqual(result.status, 201, JSON.stringify(result.payload));
    const unique = result.payload;
    assert.strictEqual(unique.companyName, `${prefix} Unique`);
    assert.strictEqual(unique.phone, '555-0100');
    assert.strictEqual(unique.isActive, true);
    assert.notStrictEqual(unique.id, 999999);

    result = await runHandler(controller.update, request({
        companyName: `${prefix.toLowerCase()}  angel`
    }, { id: unique.id }));
    assert.strictEqual(result.status, 409);
    assert.strictEqual(result.payload.duplicate.id, legacy.id);

    const replacement = await db.PharmacyTransportCompany.create({
        companyName: `${prefix.toUpperCase()} ANGEL`,
        isActive: true
    });
    result = await runHandler(controller.restore, request({}, { id: legacy.id }));
    assert.strictEqual(result.status, 409);
    assert.strictEqual(result.payload.duplicate.id, replacement.id);

    await assert.rejects(
        db.PharmacyTransportCompany.create({
            companyName: ` ${prefix.toLowerCase()}   angel `,
            isActive: true
        }),
        /unique|duplicate/i
    );

    result = await runHandler(importController.importDataset, {
        params: { dataset: 'pharmacy-transport' },
        file: { buffer: Buffer.from(`companyName,phone,contactPerson,notes,isActive\n"${prefix.toLowerCase()}   angel",,,,true\n`) },
        body: {},
        user: { id: null }
    });
    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.payload.aborted, true);
    assert.match(result.payload.errors[0].error, /already exists as active ID/i);

    const concurrentName = `${prefix} Concurrent`;
    const concurrent = await Promise.all([
        runHandler(controller.create, request({ companyName: concurrentName })),
        runHandler(controller.create, request({ companyName: ` ${prefix.toLowerCase()}   concurrent ` }))
    ]);
    assert.deepStrictEqual(concurrent.map(item => item.status).sort(), [201, 409]);
    assert.strictEqual(await db.PharmacyTransportCompany.count({
        where: { companyName: { [Op.iLike]: `${prefix}%concurrent` } }
    }), 1);

    const indexRows = await db.sequelize.query(
        `SELECT indexname FROM pg_indexes
          WHERE schemaname = current_schema()
            AND tablename = 'PharmacyTransportCompanies'
            AND indexname = 'uq_pharmacy_transport_active_company_name_ci'`,
        { type: QueryTypes.SELECT }
    );
    assert.strictEqual(indexRows.length, 1);

    console.log('PASS: Pharmacy Transport create, edit, restore, import, and database index prevent normalized duplicates while preserving disabled history.');
}

main()
    .then(cleanup)
    .catch(async error => {
        console.error(error.stack || error.message);
        try { await cleanup(); } catch (cleanupError) { console.error(cleanupError.message); }
        process.exitCode = 1;
    })
    .finally(async () => {
        await db.sequelize.close();
    });
