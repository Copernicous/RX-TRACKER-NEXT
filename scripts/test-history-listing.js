'use strict';

// Synthetic fixtures only: no application models, configuration, or database connection.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const Sequelize = require('sequelize');
const { parseHistoryQuery, csvLine } = require('../utils/historyListing');
const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'rx-history-fixture-'));
const archiveDir = path.join(temp, 'administration', 'delivery-log-archives');
fs.mkdirSync(archiveDir, { recursive: true });

function loadController(name, overrides) {
    const filename = path.join(root, 'controllers', name + '.js');
    const localRequire = createRequire(filename);
    const context = { exports: {}, __dirname: path.dirname(filename), Buffer, process, console, require: dependency => {
        if (Object.hasOwn(overrides, dependency)) return overrides[dependency];
        if (dependency.startsWith('../services/') || dependency === '../utils/globalSettings' || dependency === '../utils/pharmacyTransportIdentity') return {};
        return localRequire(dependency);
    } };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context, { filename });
    return context.exports;
}
function response() {
    return {
        statusCode: 200, headers: {}, text: '', headersSent: false, destroyed: false,
        status(code) { this.statusCode = code; return this; },
        setHeader(key, value) { this.headers[key] = value; },
        json(value) { this.body = value; return this; },
        write(text) { this.headersSent = true; this.text += text; return true; },
        end() { this.ended = true; }, destroy(error) { throw error; }
    };
}
async function invoke(handler, query = {}, user = { id: 7 }) {
    const res = response();
    await handler({ query, user }, res);
    return res;
}
function legacy(id, createdAt, pharmacy = 'Fixture Pharmacy') {
    return { id, reference: 'REF-' + id, createdAt, period: 'Fixture period', pharmacyGroups: [{
        pharmacy, rows: [{ rxId: 1, patient: 'Synthetic Patient', dob: '01/01/1980', status: 'PENDING' }]
    }] };
}
function archiveWrite(id, date, pharmacy) {
    fs.writeFileSync(path.join(archiveDir, id + '.json'), JSON.stringify(legacy(id, date, pharmacy)));
}
async function archiveTests() {
    let reads = 0;
    const wrappedFs = { ...fs, promises: { ...fs.promises, readFile: async (...args) => { reads++; return fs.promises.readFile(...args); } } };
    const controller = loadController('deliveryLogArchiveController', {
        '../models': {}, fs: wrappedFs, '../utils/runtimePaths': { resolveWritablePath: (...parts) => path.join(temp, ...parts) }
    });
    for (let i = 0; i < 55; i++) archiveWrite('fixture-' + String(i).padStart(3, '0'), '2026-09-15T12:00:00.000Z');
    archiveWrite('old-fixture', '2025-01-01T00:00:00.000Z', '=OLD, "PHARMACY"');
    fs.writeFileSync(path.join(archiveDir, 'broken.json'), '{');
    const first = await invoke(controller.history);
    assert.equal(first.statusCode, 200);
    assert.equal(first.body.total, 57);
    assert.equal(first.body.records.length, 20);
    assert.equal(first.body.records[0].id, 'fixture-054');
    const initialReads = reads;
    const second = await invoke(controller.history, { page: '2' });
    assert.equal(second.body.records[0].id, 'fixture-034');
    assert.equal(reads - initialReads, 1, 'Only the corrupt file is retried; unchanged original files are not re-read.');
    const range = { start: '2026-09-01T00:00:00.000Z', end: '2026-10-01T00:00:00.000Z' };
    const filtered = await invoke(controller.history, { ...range, page: '99', pageSize: '50' });
    assert.equal(filtered.body.total, 55);
    assert.equal(filtered.body.page, 2);
    assert.equal(filtered.body.records.length, 5);
    const csv = await invoke(controller.exportHistory, { ...range, page: '3' });
    assert.equal(csv.text.trim().split('\r\n').length, 56, 'Export includes all matching pages.');
    assert(!csv.text.includes('old-fixture'));
    assert.equal((await invoke(controller.history, { search: 'old, "pharmacy"' })).body.total, 1);
    const oldCsv = await invoke(controller.exportHistory, { search: 'old-fixture' });
    assert(oldCsv.text.includes("'=OLD"), 'Spreadsheet formulas are neutralized.');
    archiveWrite('fixture-054', '2026-09-15T12:00:00.000Z', 'Changed Pharmacy Name');
    assert.equal((await invoke(controller.history, { search: 'Changed Pharmacy' })).body.total, 1);
    fs.unlinkSync(path.join(archiveDir, 'fixture-054.json'));
    assert.equal((await invoke(controller.history, range)).body.total, 54);
    archiveWrite('boundary-start', range.start);
    archiveWrite('boundary-end', range.end);
    assert.equal((await invoke(controller.history, range)).body.total, 55, 'Start inclusive, end exclusive.');
    assert.equal((await invoke(controller.history, { pageSize: '1000' })).statusCode, 400);
    assert.equal((await invoke(controller.history, { start: range.end, end: range.start })).statusCode, 400);
}

async function importTests() {
    const { Op } = Sequelize;
    const rows = Array.from({ length: 523 }, (_, i) => ({
        id: i + 1, userId: i < 520 ? 7 : 8, createdAt: new Date('2026-09-15T12:00:00.000Z'),
        fileName: i === 0 ? '=SUM(1,2).csv' : 'fixture.csv', createdCount: 1, mergedCount: 2, discardedCount: 0
    })).reverse();
    let auditVisible = false, lastOptions;
    const select = options => {
        lastOptions = options;
        const where = options.where;
        assert.equal(where.module, 'Data Import'); assert.equal(where.action, 'Patient import report');
        assert(!options.attributes.includes('newValue'), 'History must not load full patient snapshots.');
        let selected = rows.filter(row => (where.userId === undefined || row.userId === where.userId)
            && (!where.id || row.id < where.id[Op.lt])
            && (!where.createdAt || ((!where.createdAt[Op.gte] || row.createdAt >= where.createdAt[Op.gte])
                && (!where.createdAt[Op.lt] || row.createdAt < where.createdAt[Op.lt]))));
        return { count: selected.length, rows: selected.slice(options.offset || 0, (options.offset || 0) + options.limit) };
    };
    const controller = loadController('importController', {
        '../models': { Sequelize, AuditLog: {
            findAndCountAll: async options => select(options),
            findAll: async options => select(options).rows
        } },
        '../middleware/rbac': { getRequestPermission: async () => ({ visible: auditVisible }) }
    });
    const first = await invoke(controller.listPatientReports);
    assert.equal(first.body.total, 520); assert.equal(first.body.reports.length, 20);
    const page = await invoke(controller.listPatientReports, { page: '2', pageSize: '50' });
    assert.equal(page.body.reports[0].id, 470);
    assert.equal((await invoke(controller.listPatientReports, { page: '999' })).body.page, 26);
    const csv = await invoke(controller.exportPatientReportHistory, { page: '2', pageSize: '20' });
    assert.equal(csv.text.trim().split('\r\n').length, 521, 'Export spans multiple server batches and excludes other operators.');
    assert(csv.text.includes("'=SUM"));
    auditVisible = true;
    assert.equal((await invoke(controller.listPatientReports)).body.total, 523);
    const empty = await invoke(controller.listPatientReports, { end: '2026-01-01T00:00:00.000Z' });
    assert.equal(empty.body.total, 0); assert.equal(empty.body.page, 1);
    await invoke(controller.listPatientReports, { search: '50%_file' });
    assert(lastOptions.where[Op.or]);
    const sequelize = new Sequelize('fixture', 'fixture', 'fixture', { dialect: 'postgres', logging: false });
    const sql = sequelize.getQueryInterface().queryGenerator.selectQuery('AuditLogs', lastOptions);
    assert(sql.includes('ILIKE'));
    assert(sql.includes('50\\%\\_file'), 'Search wildcards must be escaped before SQL generation.');
    assert.equal((await invoke(controller.listPatientReports, { start: '2026-02-30T00:00:00.000Z' })).statusCode, 400);
    assert.equal((await invoke(controller.exportPatientReportHistory, { search: ['unexpected'] })).statusCode, 400);
}

function browserDateTests() {
    const hooks = {};
    vm.runInNewContext(fs.readFileSync(path.join(root, 'public/js/history-list.js'), 'utf8'), {
        window: { __RX_HISTORY_TEST_HOOKS__: hooks }, Date
    });
    const previous = process.env.TZ;
    process.env.TZ = 'America/New_York';
    try {
        const duration = day => (Date.parse(hooks.dateBoundary(day, true)) - Date.parse(hooks.dateBoundary(day, false))) / 3600000;
        assert.equal(duration('2026-03-08'), 23);
        assert.equal(duration('2026-11-01'), 25);
        assert.throws(() => hooks.dateBoundary('2026-02-30', false));
        const lastMonth = hooks.presetDates('lastMonth', new Date(2026, 0, 15));
        assert.equal(hooks.dateText(lastMonth[0]), '2025-12-01');
        assert.equal(hooks.dateText(lastMonth[1]), '2025-12-31');
        const week = hooks.presetDates('week', new Date(2026, 8, 27));
        assert.equal(hooks.dateText(week[0]), '2026-09-21');
        assert.equal(hooks.dateText(week[1]), '2026-09-27');
    } finally {
        if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous;
    }
}

(async () => {
    try {
        assert.equal(parseHistoryQuery({}).pageSize, 20);
        for (const query of [{ page: '0' }, { page: '-1' }, { page: '1x' }, { pageSize: '500' }, { search: 'x'.repeat(201) }]) {
            assert.throws(() => parseHistoryQuery(query));
        }
        assert.equal(csvLine(['=1+1', 'quoted "value"', 'two\nlines']), '"\'=1+1","quoted ""value""","two\nlines"\r\n');
        browserDateTests();
        await archiveTests();
        await importTests();
        console.log('PASS history listing: pagination, cache refresh, date/DST bounds, search, report visibility and complete CSV exports.');
    } finally { fs.rmSync(temp, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
