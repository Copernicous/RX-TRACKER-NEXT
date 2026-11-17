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
            ALTER TABLE "Patients" ADD COLUMN "clinicId" integer, ADD COLUMN "pharmacyId" integer,
                ADD COLUMN dob date, ADD COLUMN phone text, ADD COLUMN address text;
            CREATE TEMP TABLE "Clinics" (id integer, name text) ON COMMIT DROP;
            CREATE TEMP TABLE "Pharmacies" (id integer, name text) ON COMMIT DROP;
            CREATE TEMP TABLE "RXRecords" (id integer, "patientId" integer, "serviceDate" date, "isDeleted" boolean) ON COMMIT DROP;
            ALTER TABLE "RXRecords" ADD COLUMN "arrivalDate" date, ADD COLUMN "pharmacyId" integer, ADD COLUMN "returnedToWarehouse" boolean;
            CREATE TEMP TABLE "Medications" (id integer, "rxRecordId" integer, name text, quantity integer) ON COMMIT DROP;
            CREATE TEMP TABLE "WorkflowActions" (id integer, "isActive" boolean) ON COMMIT DROP;
            CREATE TEMP TABLE "RXWorkflowTrackings" (id integer, "rxRecordId" integer, "workflowActionId" integer) ON COMMIT DROP;
            INSERT INTO "Medications" VALUES (1,1,'Synthetic medication',10);
            INSERT INTO "WorkflowActions" VALUES (1,true),(2,true),(3,false);
            INSERT INTO "RXWorkflowTrackings" VALUES (1,1,1),(2,1,1),(3,1,3),(4,1,99);
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
        let rxPermission = { visible: true };
        const file = path.resolve(__dirname, '../controllers/serviceDateReportController.js');
        const localRequire = createRequire(file);
        const context = { exports: {}, console, require(name) {
            if (name === '../models') return { Sequelize: db.Sequelize, sequelize: {
                transaction: (_options, callback) => callback(transaction),
                query: (text, options) => db.sequelize.query(text, { ...options, transaction })
            } };
            if (name === '../middleware/rbac') return { getRequestPermission: async (_req, module) => {
                assert.ok(['patients','rx_records'].includes(module), 'Validation permissions');
                return module === 'rx_records' ? rxPermission : permission;
            } };
            return localRequire(name);
        } };
        vm.runInNewContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
        const detailsFile = path.resolve(__dirname,'../controllers/serviceDateDetailController.js');
        const detailsContext = { exports:{}, require:context.require };
        vm.runInNewContext(fs.readFileSync(detailsFile,'utf8'),detailsContext,{ filename:detailsFile });
        async function detail(query = {}, id = '1') {
            const res = { code:200, status(code) { this.code=code; return this; }, setHeader() {}, json(body) { this.body=body; } };
            await detailsContext.exports.getDetails({ query,params:{id} },res);
            assert.notEqual(res.code,500,JSON.stringify(res.body)); return res;
        }
        const overview = await detail();
        assert.equal(overview.body.patient.patientCode,'XYZ');
        assert.equal(overview.body.total,3,'All-history RX includes undated and NULL deletion flags');
        assert.equal(overview.body.rows.at(-1).serviceDate,null);
        const exactDate = (await detail({ serviceDate:'2026-09-01' })).body;
        assert.equal(exactDate.total,2);
        assert.ok(exactDate.rows.every(row=>row.serviceDate==='2026-09-01'));
        const detailedRx = exactDate.rows.find(row=>row.id===1);
        assert.equal(detailedRx.completedSteps,1,'Duplicate, retired and orphan workflow steps are excluded');
        assert.equal(detailedRx.totalSteps,2);
        assert.equal(detailedRx.medications[0].name,'Synthetic medication');
        assert.equal(detailedRx.medications[0].quantity,10);
        assert.equal((await detail({ serviceDate:'2026-10-01' })).body.total,0,'Deleted RX cannot satisfy the selected date');
        assert.equal((await detail({},'3')).code,404,'Deleted patients stay inaccessible');
        assert.equal((await detail({},'999')).code,404);
        for (const query of [{ serviceDate:'2026-02-30' },{ serviceDate:[] },{ page:'0' },{ page:'1.5' },{ page:[] }]) assert.equal((await detail(query)).code,400);
        assert.equal((await detail({},'1;DROP')).code,400);
        rxPermission = { visible:false };
        const restricted = (await detail()).body;
        assert.equal(restricted.rxAccess,false); assert.equal(restricted.rows.length,0); assert.equal(restricted.total,null);
        assert.ok(restricted.patient.patientCode);
        rxPermission = { visible:true };
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
        const summary = (await run({ status: 'pending' })).body;
        assert.equal(summary.total, 5);
        assert.equal(summary.patients, 3);
        assert.equal(summary.available.total, 7, 'Available totals ignore quick filters');
        assert.equal(summary.available.covered, 2);
        assert.equal(summary.noRxPatients, 1);
        assert.equal(summary.historyPatients, 2);
        assert.equal(summary.pendingOnlyPatients, 1);
        assert.equal(summary.mixedPatients, 2, 'Coverage remains mixed when showing only pending dates');
        assert.equal(summary.coveredOnlyPatients, 0);
        assert.equal((await run({ patientStatus: 'active' })).body.total, 3);
        assert.equal((await run({ patientStatus: 'inactive' })).body.total, 4);
        assert.equal((await run({ patientId: '1' })).body.total, 2);
        assert.equal((await run({ rxHistory: 'none' })).body.total, 1);
        assert.equal((await run({ rxHistory: 'has' })).body.total, 6);
        assert.equal((await run({ coverage: 'pending_only' })).body.total, 1);
        assert.equal((await run({ coverage: 'mixed', status: 'pending' })).body.total, 4);
        assert.equal((await run({ coverage: 'covered_only' })).body.total, 0);
        assert.equal((await run({ search: 'XYZ', from: '2026-10-01', coverage: 'pending_only' })).body.total, 1, 'Coverage uses selected date range');
        for (const sort of ['patientCode','patient','clinic','pharmacy','lastRxServiceDate','patientActive','serviceDate','rxCount','rxStatus','serviceDateCount','pendingDateCount']) {
            for (const direction of ['asc','desc']) {
                const sorted = (await run({ sort, direction })).body;
                assert.equal(sorted.total, 7); assert.equal(sorted.rows.length, 7);
                assert.equal(sorted.sort, sort); assert.equal(sorted.direction, direction);
            }
        }
        assert.equal((await run({ sort:'rxCount', direction:'desc' })).body.rows[0].rxCount, 2);
        assert.equal((await run({ sort:'lastRxServiceDate', direction:'desc' })).body.rows.at(-1).lastRxServiceDate, null, 'Undated RX sorts last');
        for (const query of [{ from: '2026-02-30' }, { from: '2026-10-02', to: '2026-10-01' }, { page: '-1' }, { status: 'other' }, { search: [] },
            { clinicId: '0' }, { pharmacyId: '1;DROP' }, { clinicId: [] }, { clinicId: '1,,2' }, { pharmacyId: 'none,bad' }, { lastRxStatus: 'bad' }, { lastRxFrom: '2026-02-30' },
            { lastRxFrom: '2026-10-01', lastRxTo: '2026-09-01' }, { patientStatus:'deleted' }, { rxHistory:'bad' }, { coverage:'bad' },
            { patientId:'1 OR 1=1' }, { sort:'patient;DROP' }, { direction:'DESC NULLS FIRST' }, { page:'1.5' }, { pageSize:'5000' }, { pageSize:[] }]) {
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
        for (const size of [10,20,50,100,250,500,1000]) {
            const paged = (await run({ search:'100%_literal', pageSize:String(size), page:'9999', sort:'serviceDate', direction:'asc' })).body;
            assert.equal(paged.totalPages, Math.ceil(506 / size)); assert.equal(paged.page, paged.totalPages);
            assert.equal(paged.rows.length, 506 - (paged.page - 1) * size);
            assert.equal(paged.rows.at(-1).serviceDate, '2026-10-01');
        }
        const sortedPage = (await run({ patientId:'4', pageSize:'10', page:'2', sort:'serviceDate', direction:'asc' })).body;
        assert.equal(sortedPage.rows[0].serviceDate, '2024-01-11', 'Sort occurs before pagination');
        const sortedCsv = await run({ patientId:'4', sort:'serviceDate', direction:'asc', status:'pending', rxHistory:'none' }, true);
        assert.equal(sortedCsv.text.trim().split('\r\n').length, 507);
        assert.ok(sortedCsv.text.split('\r\n')[1].includes('2024-01-01'), 'CSV follows the selected global sort');
        // An undated RX prevents a patient from being classified as having no RX ever.
        await sql(`INSERT INTO "RXRecords" VALUES (6,4,null,null);`);
        assert.equal((await run({ rxHistory:'none' })).body.total, 0);
        assert.equal((await run({ patientId:'4', lastRxStatus:'undated', rxHistory:'has' })).body.total, 506);
        const { noRxPatientSql } = require('../utils/patientRxPresence');
        const liveNoRx = async () => (await db.sequelize.query(`SELECT id FROM "Patients" AS "Patient" WHERE ${noRxPatientSql} ORDER BY id`, { transaction, type:db.Sequelize.QueryTypes.SELECT })).map(row => row.id);
        assert.deepEqual(await liveNoRx(), [5], 'Dashboard includes patients with no service dates; undated and legacy NULL-deleted RX count');
        await sql(`UPDATE "RXRecords" SET "isDeleted"=true WHERE "patientId"=4;`);
        assert.deepEqual(await liveNoRx(), [4,5], 'Deleted RX does not satisfy the all-history patient count');
        const dashboardFile = path.resolve(__dirname, '../controllers/dashboardController.js');
        const dashboardRequire = createRequire(dashboardFile);
        const dashboard = { exports:{}, require(name) {
            if (name === '../models') return {
                Patient: {
                    count: async options => options.where.val ? (assert.equal(options.where.val,noRxPatientSql), (await liveNoRx()).length) : 0,
                    findAll: async options => { assert.equal(options.where.val,noRxPatientSql); return (await liveNoRx()).map(id => ({ id })); }
                },
                RXRecord:{ count:async () => 0 }, WorkflowAction:{ count:async () => 0 }, AuditLogHistory:{ findAll:async () => [] }
            };
            if (name === '../services/snapshotService') return { getFreshCurrentSnapshot:async () => ({ patientsWithNoRx:99999, updatedAt:'synthetic' }) };
            return dashboardRequire(name);
        } };
        vm.runInNewContext(fs.readFileSync(dashboardFile,'utf8'), dashboard, { filename:dashboardFile });
        async function dashboardRun(handler,query = {}) {
            const res = { status(code) { this.code=code; return this; }, json(body) { this.body=body; } };
            await handler({ query },res); assert.ok(!res.code,JSON.stringify(res.body)); return res.body;
        }
        assert.equal((await dashboardRun(dashboard.exports.getStats)).patientsWithNoRx, 2, 'Live card ignores poisoned snapshot totals');
        assert.equal((await dashboardRun(dashboard.exports.getStats,{ from:'1900-01-01', to:'1900-01-02' })).patientsWithNoRx, 2, 'All-history card ignores dashboard date range');
        assert.equal((await dashboardRun(dashboard.exports.getPatientsWithNoRx)).length, 2, 'Dashboard drilldown matches the card');
        await sql(`INSERT INTO "RXRecords" (id,"patientId","serviceDate","isDeleted") SELECT 100+n,1,'2026-09-01',false FROM generate_series(0,29)n;`);
        assert.equal((await detail({ serviceDate:'2026-09-01' })).body.rows.length,25);
        const detailPage = (await detail({ serviceDate:'2026-09-01',page:'999' })).body;
        assert.equal(detailPage.page,2); assert.equal(detailPage.rows.length,7); assert.equal(detailPage.total,32);
        permission = { visible: true, canExport: false };
        assert.equal((await run({}, true)).code, 403);
        assert.equal((await run()).body.canExport, false);
        permission = { visible: false, canExport: true };
        assert.equal((await run()).code, 403);
        assert.equal((await detail()).code,403);
        console.log('PASS: service-date SQL, missing RX, legacy history, filters, pagination, full CSV and permissions.');
    } finally {
        try { if (transaction) await transaction.rollback(); }
        finally { await db.sequelize.close(); }
    }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
