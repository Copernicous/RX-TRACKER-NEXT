'use strict';

// Small host-specific PostgreSQL check: synthetic TEMP tables only, always rolled back.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
if (process.env.RX_SERVICE_DATE_REPORT_TEST_DB_NAME) {
    const name = process.env.RX_SERVICE_DATE_REPORT_TEST_DB_NAME;
    if (!/(?:^|_)(?:test|qa|staging|sandbox)(?:_|$)/i.test(name) || process.env.RX_SERVICE_DATE_REPORT_TEST_CONFIRM_DB_NAME !== name) {
        throw Error('Service-date regression requires an explicitly confirmed test database.');
    }
    process.env.DB_NAME = name;
} else {
    require('./lib/staging-env').prepareStagingEnv();
}
const db = require('../models');

(async () => {
    let transaction;
    try {
        transaction = await db.sequelize.transaction();
        const sql = text => db.sequelize.query(text, { transaction });
        await sql(`SET LOCAL statement_timeout = '10s';
            CREATE TEMP TABLE "Patients" (id integer, "patientCode" text, "firstName" text, "lastName" text, "serviceDate" date, "isActive" boolean, "isDeleted" boolean) ON COMMIT DROP;
            ALTER TABLE "Patients" ADD COLUMN "clinicId" integer, ADD COLUMN "pharmacyId" integer;
            CREATE TEMP TABLE "Clinics" (id integer, name text) ON COMMIT DROP;
            CREATE TEMP TABLE "Pharmacies" (id integer, name text) ON COMMIT DROP;
            CREATE TEMP TABLE "RXRecords" (id integer, "patientId" integer, "serviceDate" date, "isDeleted" boolean) ON COMMIT DROP;
            CREATE TEMP TABLE "PatientServiceDateCycles" ("patientId" integer, "serviceDate" date) ON COMMIT DROP;
            CREATE TEMP TABLE "PatientServiceDateHistories" ("patientId" integer, "previousServiceDate" date, "newServiceDate" date) ON COMMIT DROP;
            INSERT INTO "Patients" (id,"patientCode","firstName","lastName","serviceDate","isActive","isDeleted") VALUES (1,'XYZ','=Synthetic','Patient','2026-10-01',true,false),
                (2,'INACTIVE','Inactive','Patient',null,false,false), (3,'DELETED','Deleted','Patient','2026-10-01',true,true),
                (4,'100%_literal','Literal','Patient','2026-10-01',true,false), (5,'EMPTY','Empty','Patient',null,true,false);
            INSERT INTO "Clinics" VALUES (1,'Test Clinic');
            INSERT INTO "Pharmacies" VALUES (1,'Test Pharmacy');
            UPDATE "Patients" SET "clinicId"=1,"pharmacyId"=1 WHERE id=1;
            INSERT INTO "PatientServiceDateCycles" VALUES (1,'2026-09-01'),(1,'2026-10-01'),(2,'2026-08-01');
            INSERT INTO "PatientServiceDateHistories" VALUES (1,'2026-09-01','2026-10-01'),(2,'2026-06-01','2026-07-01');
            INSERT INTO "RXRecords" VALUES (1,1,'2026-09-01',false),(2,1,'2026-09-01',null),
                (3,1,'2026-10-01',true),(4,2,'2026-05-01',false),(5,1,null,false);`);
        let permission = { visible: true, canExport: true };
        const file = path.resolve(__dirname, '../controllers/serviceDateReportController.js');
        const localRequire = createRequire(file);
        const context = { exports: {}, console, require(name) {
            if (name === '../models') return { Sequelize: db.Sequelize, sequelize: {
                transaction: (_options, callback) => callback(transaction),
                query: (text, options) => db.sequelize.query(text, { ...options, transaction })
            } };
            if (name === '../middleware/rbac') return { getRequestPermission: async (_req, module) => {
                assert.equal(module, 'patients', 'Validation uses Patients permissions');
                return permission;
            } };
            return localRequire(name);
        } };
        vm.runInNewContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
        async function run(query = {}, exporting = false) {
            const res = { code: 200, text: '', headers: {}, status(code) { this.code = code; return this; },
                json(body) { this.body = body; }, setHeader(key, value) { this.headers[key] = value; },
                write(text) { this.text += text; return true; }, end() {}, destroy(error) { throw error; } };
            await context.exports.getReport({ query, path: '/patients/service-date-validation' + (exporting ? '/export' : '') }, res);
            assert.notEqual(res.code, 500, JSON.stringify(res.body));
            return res;
        }
        let result = await run({ search: 'XYZ' });
        assert.equal(result.body.total, 2, 'All sources deduplicate to two dates');
        assert.equal(result.body.pending, 1);
        assert.equal(result.body.rows[0].clinic, 'Test Clinic');
        assert.equal(result.body.rows[0].pharmacy, 'Test Pharmacy');
        assert.equal(result.body.rows[0].lastRxServiceDate, '2026-09-01', 'Deleted later RX is excluded from the last date');
        assert.equal((await run({ clinicId: '1', pharmacyId: '1', status: 'pending' })).body.total, 1);
        assert.equal((await run({ clinicId: '2' })).body.total, 0);
        assert.equal((await run({ pharmacyId: '2' })).body.total, 0);
        assert.equal((await run({ clinicId: 'none', pharmacyId: 'none' })).body.total, 5);
        assert.equal((await run({ clinicId: '1,none', pharmacyId: '1,none' })).body.total, 7, 'Multiple assignments can include unassigned patients');
        assert.equal((await run({ clinicId: '1,2', pharmacyId: '1,2' })).body.total, 2, 'OR within each dropdown');
        assert.equal((await run({ clinicId: '1,1', pharmacyId: 'none,2' })).body.total, 0, 'AND between clinic and pharmacy; duplicate selections do not duplicate results');
        assert.equal((await run({ lastRxFrom: '2026-09-01', lastRxTo: '2026-09-01', status: 'pending' })).body.total, 1);
        assert.equal((await run({ search: 'XYZ', from: '2026-10-01' })).body.rows[0].lastRxServiceDate, '2026-09-01', 'Last RX date is not limited by service-date filters');
        assert.equal((await run({ lastRxStatus: 'undated' })).body.total, 1);
        assert.equal((await run({ lastRxStatus: 'dated' })).body.total, 6);
        const options = await run({ options: '1' });
        assert.equal(options.body.clinics[0].name, 'Test Clinic');
        assert.equal(options.body.pharmacies[0].name, 'Test Pharmacy');
        assert.equal(result.body.rows[0].serviceDate, '2026-10-01');
        assert.equal(result.body.rows[0].rxCount, 0, 'Deleted RX cannot satisfy a date');
        assert.equal(result.body.rows[1].rxCount, 2, 'Multiple RX on one date do not cover another');
        result = await run({ search: 'XYZ', status: 'pending' });
        assert.equal(result.body.total, 1);
        assert.equal(result.body.rows[0].serviceDateCount, 2);
        assert.equal(result.body.rows[0].pendingDateCount, 1);
        assert.equal((await run({ search: 'XYZ', status: 'exists' })).body.rows[0].serviceDate, '2026-09-01');
        assert.equal((await run({ search: 'XYZ', from: '2026-10-01', to: '2026-10-01' })).body.total, 1);
        result = await run({ search: 'INACTIVE' });
        assert.equal(result.body.total, 4, 'History-only and RX-only dates are retained');
        assert.equal(result.body.pending, 3);
        assert.equal(result.body.rows[0].clinic, 'Not assigned');
        assert.equal(result.body.rows[0].pharmacy, 'Not assigned');
        assert.equal(result.body.rows[0].patientActive, false);
        assert.equal((await run({ search: 'DELETED' })).body.total, 0);
        assert.equal((await run({ search: 'EMPTY' })).body.total, 0);
        assert.equal((await run({ search: '%_' })).body.total, 1, 'Search wildcards are literal');
        for (const query of [{ from: '2026-02-30' }, { from: '2026-10-02', to: '2026-10-01' }, { page: '-1' }, { status: 'other' }, { search: [] },
            { clinicId: '0' }, { pharmacyId: '1;DROP' }, { clinicId: [] }, { clinicId: '1,,2' }, { pharmacyId: 'none,bad' }, { lastRxStatus: 'bad' }, { lastRxFrom: '2026-02-30' },
            { lastRxFrom: '2026-10-01', lastRxTo: '2026-09-01' }]) {
            assert.equal((await run(query)).code, 400);
        }
        const csv = await run({ search: 'XYZ', status: 'pending' }, true);
        assert.equal(csv.text.trim().split('\r\n').length, 2);
        assert.ok(csv.text.includes("'=Synthetic Patient"), 'CSV formulas are neutralized');
        assert.ok(csv.text.includes('2026-10-01'));
        assert.ok(csv.text.includes('"Assigned clinic","Assigned pharmacy"'));
        assert.ok(csv.text.includes('"Test Clinic","Test Pharmacy"'));
        assert.ok(csv.text.includes('"Last RX service date"'));
        assert.ok(csv.text.includes('"2026-09-01"'));
        assert.ok(csv.text.includes('"2026-10-01","0","Pending RX"'));
        const filteredCsv = await run({ pharmacyId: '1', clinicId: '1', lastRxFrom: '2026-09-01', status: 'pending' }, true);
        assert.equal(filteredCsv.text.trim().split('\r\n').length, 2);
        const multiCsv = await run({ clinicId: '1,none', pharmacyId: '1,none', status: 'pending' }, true);
        assert.equal(multiCsv.text.trim().split('\r\n').length, 6, 'CSV preserves combined selections');
        await sql(`INSERT INTO "PatientServiceDateCycles" SELECT 4, '2024-01-01'::date + n FROM generate_series(0,504) n;`);
        result = await run({ search: '100%_literal', page: '2' });
        assert.equal(result.body.total, 506);
        assert.equal(result.body.rows.length, 50);
        const complete = await run({ search: '100%_literal' }, true);
        assert.equal(complete.text.trim().split('\r\n').length, 507, 'Export includes every batch beyond page one');
        permission = { visible: true, canExport: false };
        assert.equal((await run({}, true)).code, 403);
        assert.equal((await run()).body.canExport, false);
        permission = { visible: false, canExport: true };
        assert.equal((await run()).code, 403);
        console.log('PASS: service-date SQL, missing RX, legacy history, filters, pagination, full CSV and permissions.');
    } finally {
        try { if (transaction) await transaction.rollback(); }
        finally { await db.sequelize.close(); }
    }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
