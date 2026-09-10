'use strict';

// Uses only a newly created, uniquely named database. Never imports app models.
const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { Sequelize } = require('sequelize');
const { createBusinessFingerprint } = require('../db/business-fingerprint');
const migration = require('../migrations/20260906010000-assign-missing-region-tags-from-structured-city');

async function main() {
  assert.equal(process.env.DB_HOST, '127.0.0.1', 'Explicit localhost maintenance credentials required');
  assert.ok(process.env.DB_USER && process.env.DB_PASS);
  const name = `rx_region_test_${crypto.randomBytes(6).toString('hex')}`;
  const options = { dialect: 'postgres', host: process.env.DB_HOST, port: process.env.DB_PORT || 5432, logging: false };
  const connect = database => new Sequelize(database, process.env.DB_USER, process.env.DB_PASS, options);
  const admin = connect('postgres');
  let db; let created = false;
  try {
    await admin.query(`CREATE DATABASE "${name}"`); created = true;
    db = connect(name);
    await db.query(`
      CREATE TABLE "Patients" (id integer PRIMARY KEY, city text, address text, "addressLine1" text);
      CREATE TABLE "PatientTags" (id integer PRIMARY KEY, name text, "groupName" text, "isActive" boolean);
      CREATE TABLE "PatientTagAssignments" ("patientId" integer, "patientTagId" integer, "createdAt" timestamptz, "updatedAt" timestamptz, UNIQUE("patientId", "patientTagId"));
      INSERT INTO "PatientTags" VALUES (1,'Miami','Region',true),(2,'Tampa','City',true),(3,'None','Region',true),(4,'Custom','Other',true);
      INSERT INTO "Patients" SELECT n, CASE WHEN n <= 13 THEN 'Tampa' WHEN n <= 26 THEN 'Miami' ELSE NULL END, NULL, NULL FROM generate_series(1,39) n;
      INSERT INTO "Patients" VALUES (40,NULL,'Unclassified synthetic address',NULL),(41,' ',' ',NULL),(42,NULL,NULL,'Unclassified line one'),(43,NULL,'', 'Ignored by historical COALESCE'),(44,'Tampa',NULL,NULL);
      INSERT INTO "PatientTagAssignments" VALUES (41,3,NOW(),NOW()),(43,3,NOW(),NOW()),(44,2,NOW(),NOW());
    `);
    const before = await createBusinessFingerprint({ sequelize: db });
    assert.equal(before.regionalAssignmentGaps, 39);
    await migration.up(db.getQueryInterface());
    const after = await createBusinessFingerprint({ sequelize: db });
    assert.equal(after.regionalAssignmentGaps, 0);
    assert.equal(after.tableCounts.PatientTagAssignments - before.tableCounts.PatientTagAssignments, 39);
    const [unknown] = await db.query('SELECT * FROM "PatientTagAssignments" WHERE "patientId" IN (40,42)');
    assert.equal(unknown.length, 0, 'Unclassified addresses must remain unchanged');
    await migration.up(db.getQueryInterface());
    assert.deepEqual(await createBusinessFingerprint({ sequelize: db }), after, 'Historical backfill must be idempotent');
    const folder = path.resolve('output', name);
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'before.json'), JSON.stringify(before));
    fs.writeFileSync(path.join(folder, 'after.json'), JSON.stringify(after));
    const test = spawnSync(process.platform === 'win32' ? 'powershell.exe' : 'pwsh', ['-NoProfile', '-File', path.join(__dirname, 'test-release-preflight.ps1'), '-Fixture', folder], { encoding: 'utf8' });
    process.stdout.write(test.stdout || ''); process.stderr.write(test.stderr || '');
    assert.equal(test.status, 0, 'PowerShell business validation and updater preflight');
    console.log('PASS historical migration: 39 eligible additions, unclassified addresses preserved, idempotence, strict updater validation.');
  } finally {
    if (db) await db.close();
    if (created && /^rx_region_test_[a-f0-9]{12}$/.test(name)) await admin.query(`DROP DATABASE "${name}"`);
    await admin.close();
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
