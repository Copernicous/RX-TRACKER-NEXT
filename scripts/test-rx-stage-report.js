'use strict';

// Runs SQL against connection-local synthetic temporary tables, rolled back at completion.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
if (process.env.RX_STAGE_REPORT_TEST_DB_NAME) {
    const name = process.env.RX_STAGE_REPORT_TEST_DB_NAME;
    if (!/(?:^|_)(?:test|qa|staging|sandbox)(?:_|$)/i.test(name) || process.env.RX_STAGE_REPORT_TEST_CONFIRM_DB_NAME !== name) {
        throw Error('Stage report regression requires an explicitly confirmed test database.');
    }
    process.env.DB_NAME = name;
} else {
    require('./lib/staging-env').prepareStagingEnv();
}
process.env.TZ = 'America/New_York';
const db = require('../models');

(async () => {
    const transaction = await db.sequelize.transaction();
    try {
        const sql = text => db.sequelize.query(text, { transaction });
        await sql(`CREATE TEMP TABLE "WorkflowActions" (id integer, name text, "sequenceNumber" integer, "isActive" boolean) ON COMMIT DROP;
          CREATE TEMP TABLE "RXWorkflowTrackings" (id integer, "rxRecordId" integer, "workflowActionId" integer, "completionDate" timestamptz, "driverNameSnapshot" text) ON COMMIT DROP;
          CREATE TEMP TABLE "RXRecords" (id integer, "patientId" integer, "pharmacyTransportCompanyId" integer, "isDeleted" boolean) ON COMMIT DROP;
          CREATE TEMP TABLE "Patients" (id integer, "patientCode" text, "firstName" text, "lastName" text, "clinicId" integer) ON COMMIT DROP;
          CREATE TEMP TABLE "Clinics" (id integer, name text) ON COMMIT DROP;
          CREATE TEMP TABLE "PharmacyTransportCompanies" (id integer, "contactPerson" text, "companyName" text) ON COMMIT DROP;
          INSERT INTO "WorkflowActions" VALUES (1,'Received',1,true),(2,'Delivered',2,true),(3,'Retired',3,false);
          INSERT INTO "Patients" VALUES (1,'TEST-1','=Synthetic','Patient',1);
          INSERT INTO "Clinics" VALUES (1,'Test clinic');
          INSERT INTO "PharmacyTransportCompanies" VALUES (1,'Current driver','Test transport');
          INSERT INTO "RXRecords" SELECT n,1,1,false FROM generate_series(1,55) n;
          INSERT INTO "RXWorkflowTrackings" SELECT n,n,1,'2026-09-01 10:00:00-04'::timestamptz + n * interval '1 day','Stage driver' FROM generate_series(1,55) n;
          INSERT INTO "RXWorkflowTrackings" VALUES (100,1,2,'2026-09-10 10:00:00-04','Delivery driver'),(101,2,3,'2026-09-11 10:00:00-04','Retired driver'),(102,2,1,'2026-09-01 10:00:00-04','Older duplicate');`);
        let permission = { visible: true, canExport: true, canViewDriverHistory: true };
        const file = path.resolve(__dirname, '../controllers/rxStageReportController.js');
        const localRequire = createRequire(file);
        const context = { exports: {}, Date, Intl, console, require(name) {
            if (name === '../models') return {
                Sequelize: db.Sequelize,
                WorkflowAction: { findAll: () => db.sequelize.query('SELECT * FROM "WorkflowActions" WHERE "isActive" = true', { transaction, type: db.Sequelize.QueryTypes.SELECT }) },
                sequelize: { query: (text, options) => db.sequelize.query(text, { ...options, transaction }) }
            };
            if (name === '../middleware/rbac') return { getRequestPermission: async () => permission };
            return localRequire(name);
        } };
        vm.runInNewContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
        async function run(query = {}, exporting = false) {
            const res = { code: 200, headers: {}, text: '', status(code) { this.code = code; return this; },
                json(body) { this.body = body; return this; }, setHeader(key, value) { this.headers[key] = value; },
                write(text) { this.text += text; return true; }, end() {}, destroy(error) { throw error; } };
            await context.exports.getReport({ query: { stages: '1', ...query }, path: '/stage-report' + (exporting ? '/export' : '') }, res);
            assert.notEqual(res.code, 500, 'Report SQL must execute successfully');
            return res;
        }
        let result = await run();
        assert.equal(result.body.total, 54); assert.equal(result.body.rows.length, 50);
        assert.equal(result.body.rows[0].rxId, 2); assert.equal(result.body.rows[0].driver, 'Current driver');
        assert.equal((await run({ page: '2' })).body.rows.length, 4);
        result = await run({ scope: 'reached', stages: '1,2' });
        assert.equal(result.body.total, 56); assert.equal(result.body.rows[0].rxId, 1);
        assert.equal(result.body.rows[0].driver, 'Stage driver');
        assert.equal((await run({ direction: 'desc' })).body.rows[0].rxId, 55);
        assert.equal((await run({ from: '2026-09-03', to: '2026-09-03' })).body.total, 1);
        assert.equal((await run({ from: '2026-02-30' })).code, 400);
        assert.equal((await run({ from: '2026-09-03', to: '2026-09-01' })).code, 400);
        assert.equal((await run({ stages: '3' })).code, 400);
        assert.equal((await run({ stages: '1);DROP TABLE' })).code, 400);
        const csv = await run({ scope: 'reached', stages: '1,2' }, true);
        assert.equal(csv.text.trim().split('\r\n').length, 57);
        assert.ok(csv.text.includes("'=Synthetic Patient"));
        assert.ok(csv.text.trim().split('\r\n').at(-1).includes('Delivered'));
        assert.equal((await run({ scope: 'both', stages: '1,2' })).body.total, 56, 'Both scopes must not duplicate entries');
        assert.equal((await run({ sort: 'daysElapsed', direction: 'asc' })).body.rows[0].rxId, 55);
        assert.equal((await run({ sort: 'daysElapsed', direction: 'desc' })).body.rows[0].rxId, 2);
        assert.equal((await run({ sort: 'rxId', direction: 'desc' })).body.rows[0].rxId, 55);
        assert.equal((await run({ scope: 'both', stages: '1,2', sort: 'stage' })).body.rows[0].stage, 'Delivered');
        assert.equal((await run({ sort: 'stageDate; DROP TABLE' })).code, 400);
        await sql(`INSERT INTO "Patients" VALUES (2,'ZZ-2','Zulu','Test',2);
          INSERT INTO "Clinics" VALUES (2,'Zulu clinic');
          INSERT INTO "PharmacyTransportCompanies" VALUES (2,'Zulu driver','Zulu transport');
          UPDATE "RXRecords" SET "patientId"=2, "pharmacyTransportCompanyId"=2 WHERE id=55;`);
        for (const sort of ['patientCode', 'patient', 'clinic', 'driver']) {
            assert.equal((await run({ sort, direction: 'desc' })).body.rows[0].rxId, 55, sort + ' sorts the full result before pagination');
            const sortedCsv = await run({ sort, direction: 'desc' }, true);
            assert.ok(sortedCsv.text.split('\r\n')[1].startsWith('"55",'), sort + ' CSV follows table ordering');
        }
        for (const sort of ['rxId', 'patientCode', 'patient', 'clinic', 'driver', 'stage', 'stageDate', 'daysElapsed']) {
            assert.equal((await run({ sort, direction: 'desc', scope: 'both', stages: '1,2' })).body.total, 56);
        }
        for (const baselineStage of ['', '0', '-1', '1.5', '3', '999', '1,2', '1);DROP TABLE', ['1']]) {
            assert.equal((await run({ baselineStage })).code, 400, 'Reject invalid/inactive baselines');
        }
        result = await run({ baselineStage: '1', stages: '2', from: '2026-09-10', to: '2026-09-10' });
        assert.equal(result.body.total, 1, 'Baseline outside target date bounds is retained');
        assert.equal(result.body.baselineStage.name, 'Received');
        assert.equal(result.body.rows[0].baselineDate, '2026-09-02T14:00:00.000Z');
        assert.equal(result.body.rows[0].daysSinceBaseline, 8);
        assert.equal((await run({ baselineStage: '1', stages: '1' })).code, 400);
        assert.equal((await run({ baselineStage: '1', stages: '1,2' }, true)).code, 400, 'CSV also rejects baseline among comparison stages');
        result = await run({ baselineStage: '2', stages: '1', scope: 'reached', sort: 'daysSinceBaseline' });
        assert.equal(result.body.rows[0].daysSinceBaseline, -8, 'Earlier targets retain signed intervals');
        assert.equal(result.body.rows[1].daysSinceBaseline, null, 'Missing baseline does not remove RX');
        assert.equal(result.body.total, 55, 'Join stays within RX, not patient');
        assert.equal((await run({ baselineStage: '1', stages: '2', sort: 'baselineDate', direction: 'desc' })).body.rows[0].rxId, 1);
        const comparisonCsv = await run({ baselineStage: '1', stages: '2' }, true);
        assert.ok(comparisonCsv.text.includes('"Days since baseline"'));
        assert.ok(comparisonCsv.text.includes('"Received"'));
        assert.ok(comparisonCsv.text.includes('"2026-09-02T14:00:00.000Z"'));
        assert.ok(comparisonCsv.text.includes('"8"'));
        // Different time zones and DST must sort by the displayed calendar interval, not elapsed hours.
        await sql(`INSERT INTO "RXWorkflowTrackings" VALUES
          (200,2,2,'2026-09-12 01:00:00-04','Test driver'),
          (201,3,2,NULL,'Test driver');`);
        result = await run({ baselineStage: '1', stages: '2', sort: 'daysSinceBaseline', direction: 'desc' });
        assert.deepEqual(Array.from(result.body.rows, row => row.daysSinceBaseline), [9, 8, null]);
        assert.equal(result.body.rows[0].baselineDate, '2026-09-03T14:00:00.000Z', 'Latest duplicate baseline wins');
        const dst = context.exports.present({ baselineDate: '2026-03-08T05:00:00Z', stageDate: '2026-03-09T04:00:00Z' }, new Date());
        assert.equal(dst.daysSinceBaseline, 1);
        assert.equal(context.exports.present({ baselineDate: null, stageDate: '2026-09-10' }, new Date()).daysSinceBaseline, null);
        assert.equal(context.exports.present({ baselineDate: '2026-09-10', stageDate: null }, new Date()).daysSinceBaseline, null);
        permission.canViewDriverHistory = false;
        result = await run({ scope: 'reached' }); assert.equal(result.body.driverRestricted, true); assert.equal(result.body.rows[0].driver, '');
        result = await run({ scope: 'both', sort: 'driver' }); assert.equal(result.body.driverRestricted, true); assert.equal(result.body.rows[0].driver, '');
        permission.canExport = false; assert.equal((await run({}, true)).code, 403);
        permission.visible = false; assert.equal((await run()).code, 403);
        const presented = context.exports.present({ stageDate: '2026-03-08T05:00:00Z' }, new Date('2026-03-09T04:00:00Z'));
        assert.equal(presented.daysElapsed, 1, 'Elapsed calendar days must survive DST');
        assert.equal(context.exports.present({ stageDate: null }, new Date()).daysElapsed, null);
        console.log('Stage report SQL, scope, grouping, pagination, dates, CSV and permission checks passed (synthetic temporary tables only).');
    } finally {
        await transaction.rollback();
        await db.sequelize.close();
    }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
