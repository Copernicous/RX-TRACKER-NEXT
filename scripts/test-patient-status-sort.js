'use strict';

// Synthetic in-memory SQL fixtures only; never loads application database config.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { DatabaseSync } = require('node:sqlite');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const server = read('controllers/patientController.js');
const client = read('public/js/patients.js');
const context = { literal: value => value };
vm.runInNewContext(server.slice(server.indexOf('function patientDatabaseOrder('),
    server.indexOf('async function loadPatientFacets(')), context);
const sortStart = client.indexOf('filteredPatients.sort((a, b) => {');
assert(sortStart >= 0);
const clientSort = client.slice(sortStart, client.indexOf('updatePatientSortIcons();', sortStart));
const fixtures = [
    { id: 1, isActive: true, isDeleted: false },
    { id: 2, isActive: true, isDeleted: true },
    { id: 3, isActive: false, isDeleted: false },
    { id: 4, isActive: false, isDeleted: true },
    { id: 5, isActive: true, isDeleted: null },
    { id: 6, isActive: null, isDeleted: null },
    { id: 7, isActive: null, isDeleted: true }
];
const status = row => row.isDeleted ? 'Deleted' : row.isActive ? 'Active' : 'Inactive';
const database = new DatabaseSync(':memory:');
try {
    database.exec('CREATE TABLE "Patients" (id INTEGER, "isActive" BOOLEAN, "isDeleted" BOOLEAN)');
    const insert = database.prepare('INSERT INTO "Patients" VALUES (?, ?, ?)');
    for (const row of fixtures) insert.run(row.id,
        row.isActive === null ? null : Number(row.isActive),
        row.isDeleted === null ? null : Number(row.isDeleted));
    for (const dir of ['asc', 'desc']) {
        const expectedIds = dir === 'asc' ? [3, 6, 1, 5, 2, 4, 7] : [7, 4, 2, 5, 1, 6, 3];
        const order = context.patientDatabaseOrder('isActive', dir);
        const sql = `SELECT * FROM "Patients" AS "Patient" ORDER BY ${order[0][0]}, "id" ${order[1][1]}`;
        const rows = database.prepare(sql).all();
        assert.deepEqual(rows.map(row => row.id), expectedIds);
        // Check grouping before LIMIT/OFFSET, including groups spanning pages.
        const paged = [];
        for (let offset = 0; offset < fixtures.length; offset += 2) {
            paged.push(...database.prepare(`${sql} LIMIT 2 OFFSET ?`).all(offset));
        }
        assert.deepEqual(paged.map(row => row.id), expectedIds);
        const browser = { filteredPatients: fixtures.map(row => ({ ...row })), pSortCol: 'isActive', pSortDir: dir };
        vm.runInNewContext(clientSort, browser);
        assert.deepEqual(browser.filteredPatients.map(status), rows.map(status));
        console.log(`PASS: ${dir} status groups, deleted active/inactive/null flags, SQL pagination and client parity`);
    }
} finally {
    database.close();
}
