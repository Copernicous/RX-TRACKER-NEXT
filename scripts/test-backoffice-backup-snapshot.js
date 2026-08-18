'use strict';

process.env.BACKUP_SCHEDULER_ENABLED = 'false';
process.env.SITE_BACKUP_SCHEDULER_ENABLED = 'false';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const db = require('../models');
const fileSettings = require('../utils/globalSettings');
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

async function main() {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rx-review-snapshot-'));
    const originalReadSettings = fileSettings.readSettings;
    const originalQuery = db.sequelize.query;
    const observedSql = [];

    const catalogRows = [
        { table_schema: 'public', table_name: 'AuditLogs', column_name: 'id', ordinal_position: 1, data_type: 'integer', udt_name: 'int4' },
        { table_schema: 'public', table_name: 'AuditLogs', column_name: 'formula', ordinal_position: 2, data_type: 'text', udt_name: 'text' },
        { table_schema: 'public', table_name: 'AuditLogs', column_name: 'payload', ordinal_position: 3, data_type: 'jsonb', udt_name: 'jsonb' },
        { table_schema: 'public', table_name: 'AuditLogs', column_name: 'recordedAt', ordinal_position: 4, data_type: 'timestamp with time zone', udt_name: 'timestamptz' },
        { table_schema: 'public', table_name: 'AuditLogs', column_name: 'binaryValue', ordinal_position: 5, data_type: 'bytea', udt_name: 'bytea' },
        { table_schema: 'public', table_name: 'AuditLogs', column_name: '=heading', ordinal_position: 6, data_type: 'text', udt_name: 'text' },
        { table_schema: 'public', table_name: 'EmptyFeatureTable', column_name: 'id', ordinal_position: 1, data_type: 'bigint', udt_name: 'int8' },
        { table_schema: 'public', table_name: 'EmptyFeatureTable', column_name: 'note', ordinal_position: 2, data_type: 'character varying', udt_name: 'varchar' },
        { table_schema: 'public', table_name: 'Odd"Table', column_name: 'id', ordinal_position: 1, data_type: 'integer', udt_name: 'int4' }
    ];

    fileSettings.readSettings = () => ({
        backupPath: tempRoot,
        backupRetentionDays: 30
    });
    db.sequelize.query = async sql => {
        const normalized = String(sql).replace(/\s+/g, ' ').trim();
        observedSql.push(normalized);
        if (normalized.includes('FROM information_schema.tables AS tables')) return catalogRows;
        if (normalized === 'SELECT * FROM "public"."AuditLogs"') {
            return [{
                id: 1,
                formula: '=2+2',
                payload: { patient: 'Example', values: [1, 2] },
                recordedAt: new Date('2026-08-01T12:34:56.000Z'),
                binaryValue: Buffer.from([0, 1, 255]),
                '=heading': '@command'
            }];
        }
        if (normalized === 'SELECT * FROM "public"."EmptyFeatureTable"') return [];
        if (normalized === 'SELECT * FROM "public"."Odd""Table"') return [{ id: 9 }];
        throw new Error(`Unexpected SQL in snapshot test: ${normalized}`);
    };

    try {
        const createRes = makeResponse();
        await adminController.createBackup({ user: { id: 1 } }, createRes);

        assert.strictEqual(createRes.statusCode, 200, 'snapshot creation status');
        assert.strictEqual(createRes.body.success, true, 'snapshot creation response');
        assert.strictEqual(createRes.body.restorable, false, 'CSV snapshot is explicitly not restorable');
        assert.strictEqual(createRes.body.files.length, 3, 'every discovered public base table is included');
        assert.ok(observedSql[0].includes("tables.table_type = 'BASE TABLE'"), 'discovery is limited to public base tables');
        assert.ok(observedSql[0].includes('JOIN pg_catalog.pg_class'), 'catalog validation is part of discovery');
        assert.ok(observedSql.includes('SELECT * FROM "public"."Odd""Table"'), 'catalog identifier is safely quoted');

        const snapshotDir = path.join(tempRoot, createRes.body.backupDir);
        const manifest = JSON.parse(fs.readFileSync(path.join(snapshotDir, 'manifest.json'), 'utf8'));
        assert.strictEqual(manifest.formatVersion, 2, 'manifest format version');
        assert.strictEqual(manifest.artifactType, 'database-csv-review-snapshot', 'manifest artifact type');
        assert.strictEqual(manifest.restorable, false, 'manifest restore warning');
        assert.strictEqual(manifest.containsSensitiveData, true, 'manifest marks the snapshot as sensitive');
        assert.strictEqual(manifest.tableCount, 3, 'manifest table count');

        for (const table of manifest.tables) {
            assert.match(table.file, /^\d{3}-[A-Za-z0-9_-]+\.csv$/, `safe file name for ${table.table}`);
            assert.ok(fs.existsSync(path.join(snapshotDir, table.file)), `CSV exists for ${table.table}`);
        }

        const emptyEntry = manifest.tables.find(table => table.table === 'EmptyFeatureTable');
        assert.ok(emptyEntry, 'empty table has a manifest entry');
        assert.strictEqual(emptyEntry.rows, 0, 'empty table row count');
        assert.strictEqual(
            fs.readFileSync(path.join(snapshotDir, emptyEntry.file), 'utf8'),
            'id,note\r\n',
            'empty table CSV contains its catalog headers'
        );

        const auditEntry = manifest.tables.find(table => table.table === 'AuditLogs');
        const auditCsv = fs.readFileSync(path.join(snapshotDir, auditEntry.file), 'utf8');
        assert.match(auditCsv, /'\=heading/, 'formula-like column headers are inert');
        assert.match(auditCsv, /'\=2\+2/, 'formula-like text values are inert');
        assert.match(auditCsv, /'@command/, 'at-prefixed text values are inert');
        assert.match(auditCsv, /2026-08-01T12:34:56\.000Z/, 'dates are serialized in ISO form');
        assert.match(auditCsv, /base64:AAH\//, 'binary values use an explicit base64 representation');
        assert.match(auditCsv, /"\{""patient"":""Example"",""values"":\[1,2\]\}"/, 'JSON values are valid escaped CSV cells');

        const listRes = makeResponse();
        adminController.listBackups({}, listRes);
        assert.strictEqual(listRes.statusCode, 200, 'snapshot list status');
        assert.strictEqual(listRes.body.backups[0].fileCount, 3, 'list counts empty-table CSV files');
        assert.strictEqual(listRes.body.backups[0].restorable, false, 'list preserves review-only status');

        const purgeRes = makeResponse();
        await adminController.purge({ body: { tables: ['EmptyFeatureTable'] } }, purgeRes);
        assert.strictEqual(purgeRes.statusCode, 400, 'catalog discovery does not expand destructive purge scope');
        assert.match(purgeRes.body.error, /Unknown tables/, 'purge remains bound to the curated whitelist');

        const backofficeView = fs.readFileSync(path.join(__dirname, '..', 'views', 'backoffice.ejs'), 'utf8');
        const backofficeClient = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'backoffice.js'), 'utf8');
        assert.match(backofficeView, /Managed Tables/, 'Backoffice identifies the curated table controls');
        assert.match(backofficeView, /not every database table/, 'Backoffice explains the managed-table boundary');
        assert.match(backofficeView, /cannot be used as a database restore/, 'CSV snapshot help rejects restore use');
        assert.match(backofficeClient, /Managed Records/, 'managed-table totals are not labeled as whole-database totals');

        console.log('Backoffice catalog-driven CSV review snapshot tests passed.');
    } finally {
        fileSettings.readSettings = originalReadSettings;
        db.sequelize.query = originalQuery;
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
}).finally(async () => {
    await db.sequelize.close().catch(() => {});
});
