'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const writableRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rx-delivery-archive-test-'));
process.env.APP_WRITABLE_ROOT = writableRoot;

const controller = require('../controllers/deliveryLogArchiveController');
const db = require('../models');
const archiveTest = controller._test;
const archiveDirectory = path.join(writableRoot, 'administration', 'delivery-log-archives');

function responseRecorder() {
    return {
        statusCode: 200,
        headers: {},
        body: null,
        status(code) { this.statusCode = code; return this; },
        set(headers) { Object.assign(this.headers, headers); return this; },
        json(body) { this.body = body; return this; },
        send(body) { this.body = body; return this; }
    };
}

function expectRequestFailure(callback, pattern) {
    assert.throws(callback, pattern);
}

function canonicalInput(now) {
    return {
        rxRecordIds: [101],
        drivers: new Map([[7, 'Local Driver']]),
        generatedAtEpoch: now,
        timezoneOffsetMinutes: 240,
        timezoneName: 'America/New_York',
        period: '07/01/2026 - 07/31/2026',
        filters: 'Pharmacy: Test Pharmacy'
    };
}

function canonicalGroups(patientName) {
    return [{
        pharmacyId: 7,
        pharmacy: 'Test Pharmacy',
        driver: 'Local Driver',
        rows: [{
            rxId: 101,
            receivedDate: '07/31/2026',
            receivedAt: '07/31/2026, 09:10 AM',
            reference: 'RX-000101',
            patient: patientName || 'Test Patient',
            dob: '01/02/1980',
            status: 'PENDING',
            notes: 'Pending delivery receipt'
        }]
    }];
}

async function run() {
    const now = Date.now();
    const validRequest = {
        rxRecordIds: [101],
        drivers: [{ pharmacyId: 7, driver: 'Local Driver' }],
        generatedAtEpoch: now,
        timezoneOffsetMinutes: 240,
        timezoneName: 'America/New_York',
        requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        period: '07/01/2026 - 07/31/2026',
        filters: 'Pharmacy: Test Pharmacy'
    };

    const validated = archiveTest.validateCreateRequest(validRequest, now);
    assert.deepStrictEqual(validated.rxRecordIds, [101]);
    assert.strictEqual(validated.drivers.get(7), 'Local Driver');
    expectRequestFailure(
        () => archiveTest.validateCreateRequest({ ...validRequest, documentHtml: '<script>bad()</script>' }, now),
        /unsupported fields: documentHtml/
    );
    expectRequestFailure(
        () => archiveTest.validateCreateRequest({ ...validRequest, rxRecordIds: Array.from({ length: archiveTest.MAX_ROWS + 1 }, (_, i) => i + 1) }, now),
        /cannot contain more than/
    );
    expectRequestFailure(
        () => archiveTest.validateCreateRequest({ ...validRequest, rxRecordIds: [101, 101] }, now),
        /must not contain duplicates/
    );
    expectRequestFailure(
        () => archiveTest.validateCreateRequest({ ...validRequest, drivers: [{ pharmacyId: 7, driver: 'x'.repeat(161) }] }, now),
        /must not exceed 160/
    );

    const first = archiveTest.buildArchiveRecord(
        canonicalInput(now),
        canonicalGroups('<script>patientAttack()</script>'),
        { id: 2, username: 'tester' },
        { id: '11111111-1111-4111-8111-111111111111', now }
    );
    const second = archiveTest.buildArchiveRecord(
        canonicalInput(now),
        canonicalGroups('Test Patient'),
        { id: 2, username: 'tester' },
        { id: '22222222-2222-4222-8222-222222222222', now }
    );
    assert.notStrictEqual(first.reference, second.reference, 'Every server-issued reference must bind to its unique archive id.');
    assert.match(first.verification, /^SHA256-[a-f0-9]{64}$/);
    assert.match(first.artifactHash, /^[a-f0-9]{64}$/);
    assert.strictEqual(typeof first.documentHtml, 'string', 'The exact server-rendered artifact must be stored for carbon-copy reprints.');
    assert.strictEqual(first.reference, 'LOG-' + archiveTest.localDateToken(now, 240) + '-' + first.id.toUpperCase());
    assert.strictEqual(archiveTest.assertRecordIntegrity(first), first);

    const changedVerification = JSON.parse(JSON.stringify(first));
    changedVerification.verification = 'SHA256-' + '0'.repeat(64);
    expectRequestFailure(() => archiveTest.assertRecordIntegrity(changedVerification), /verification label/);
    const changedPatient = JSON.parse(JSON.stringify(first));
    changedPatient.pharmacyGroups[0].rows[0].patient = 'Changed Patient';
    expectRequestFailure(() => archiveTest.assertRecordIntegrity(changedPatient), /integrity verification failed/);
    const changedArtifact = JSON.parse(JSON.stringify(first));
    changedArtifact.documentHtml = changedArtifact.documentHtml.replace('Controlled Copy', 'Changed Copy');
    expectRequestFailure(() => archiveTest.assertRecordIntegrity(changedArtifact), /printable artifact/);

    const safeHtml = archiveTest.renderArchiveHtml(first);
    assert(!safeHtml.includes('<script>patientAttack()</script>'), 'Canonical HTML must not render patient text as markup.');
    assert(safeHtml.includes('&lt;script&gt;patientAttack()&lt;/script&gt;'), 'Canonical HTML must escape patient text.');
    assert(!safeHtml.includes('documentHtml'), 'Canonical HTML must not contain a client-provided HTML field.');
    assert(safeHtml.includes('/css/rx-delivery-log-archive-v2.css'), 'Canonical archive must use its immutable v2 print stylesheet.');
    assert(safeHtml.includes('<body class="delivery-log-archive">'), 'Archived HTML must be nonprintable until an audited client authorization is applied.');
    assert(safeHtml.includes('<span class="driver-header-value">Local Driver</span>'), 'Archived driver names must render as full controlled-copy text.');
    assert(!safeHtml.includes('class="driver-header-field"'), 'Archived driver names must not use a truncating form input.');
    const longDriverGroups = canonicalGroups('Test Patient');
    longDriverGroups[0].driver = 'D'.repeat(160);
    const longDriverRecord = archiveTest.buildArchiveRecord(
        canonicalInput(now),
        longDriverGroups,
        { id: 2, username: 'tester' },
        { id: '55555555-5555-4555-8555-555555555555', now }
    );
    assert(longDriverRecord.documentHtml.includes('D'.repeat(160)), 'The full allowed driver name must remain in the frozen artifact.');

    const legacy = archiveTest.normalizeLegacyRecord({
        id: 'legacy-source-id',
        reference: 'LOG-LEGACY',
        generated: '07/31/2026, 11:00 PM',
        documentHtml: '<script>rawLegacyAttack()</script>',
        pharmacyGroups: [{
            pharmacy: '<img src=x onerror=pharmacyAttack()>',
            driver: '<svg onload=driverAttack()>',
            rows: [{
                reference: 'RX-1',
                patient: '<img src=x onerror=patientAttack()>',
                dob: '01/02/1980',
                status: 'PENDING',
                notes: '<script>notesAttack()</script>'
            }]
        }]
    });
    const legacyHtml = archiveTest.renderArchiveHtml(legacy);
    assert(!legacyHtml.includes('rawLegacyAttack'), 'Stored legacy documentHtml must never be served.');
    assert(!legacyHtml.includes('<img src=x'), 'Legacy fields must not render active elements.');
    assert(!legacyHtml.includes('<script>notesAttack'), 'Legacy notes must not render active scripts.');
    assert(legacyHtml.includes('&lt;img src=x onerror=patientAttack()&gt;'), 'Legacy patient markup must be escaped.');

    const utcBoundary = Date.UTC(2026, 7, 1, 1, 15, 0);
    assert.strictEqual(archiveTest.localDateToken(utcBoundary, 240), '20260731', 'Reference date must use browser-local offset, not UTC date.');
    assert.match(archiveTest.formatLocalTimestamp(utcBoundary, 240), /^07\/31\/2026/);
    const winterBoundary = Date.UTC(2026, 0, 15, 4, 30, 0);
    assert.strictEqual(
        archiveTest.formatDatabaseDate(winterBoundary, false, 'America/New_York', 240),
        '01/14/2026',
        'Historical dates must use the named PC timezone and its date-specific DST offset.'
    );

    fs.mkdirSync(archiveDirectory, { recursive: true });

    const recoveryRecord = archiveTest.buildArchiveRecord(
        canonicalInput(now),
        canonicalGroups('Recovery Patient'),
        { id: 2, username: 'tester' },
        { id: '44444444-4444-4444-8444-444444444444', now }
    );
    const interruptedDeletePath = path.join(archiveDirectory, recoveryRecord.id + '.json.deleting-interrupted');
    fs.writeFileSync(interruptedDeletePath, JSON.stringify(recoveryRecord, null, 2), 'utf8');
    const staleCreatePath = path.join(archiveDirectory, recoveryRecord.id + '.json.tmp-interrupted');
    fs.writeFileSync(staleCreatePath, JSON.stringify(recoveryRecord, null, 2), 'utf8');
    const staleTime = new Date(now - (11 * 60 * 1000));
    fs.utimesSync(staleCreatePath, staleTime, staleTime);
    const recoveryResponse = responseRecorder();
    await controller.list({}, recoveryResponse);
    assert.strictEqual(recoveryResponse.statusCode, 200);
    assert(fs.existsSync(path.join(archiveDirectory, recoveryRecord.id + '.json')), 'Interrupted deletion must restore the archive to a visible filename.');
    assert(!fs.existsSync(staleCreatePath), 'Stale create staging files must be removed during recovery.');
    fs.unlinkSync(path.join(archiveDirectory, recoveryRecord.id + '.json'));

    const createAuditRows = [];
    const originalWorkflowFindAll = db.WorkflowAction.findAll;
    const originalRxFindAll = db.RXRecord.findAll;
    const originalCreateAudit = db.AuditLog.create;
    db.WorkflowAction.findAll = async () => [{ id: 5, name: 'Mark as Received to Print Log' }];
    db.RXRecord.findAll = async () => [{
        id: 101,
        isDeleted: false,
        deliveryOutcome: 'none',
        deliveryOutcomeDate: null,
        deliveryOutcomeNote: null,
        Patient: { id: 44, firstName: 'Database', lastName: 'Patient', dob: '1980-01-02' },
        Pharmacy: { id: 7, name: 'Test Pharmacy' },
        RXWorkflowTrackings: []
    }];
    db.AuditLog.create = async row => { createAuditRows.push(row); return row; };
    try {
        const createResponse = responseRecorder();
        await controller.create({
            body: validRequest,
            user: { id: 2, username: 'tester' },
            ip: '127.0.0.1'
        }, createResponse);
        assert.strictEqual(createResponse.statusCode, 201);
        assert.match(createResponse.body.reference, /^LOG-\d{8}-[A-F0-9-]+$/);
        const stored = JSON.parse(fs.readFileSync(path.join(archiveDirectory, createResponse.body.id + '.json'), 'utf8'));
        assert.strictEqual(stored.pharmacyGroups[0].rows[0].patient, 'Database Patient', 'Archive rows must be derived from PostgreSQL.');
        assert.strictEqual(stored.period, 'No completed delivery dates', 'Printed period evidence must be derived from canonical rows.');
        assert(stored.filters.includes('server-verified open RX record'), 'Printed selection evidence must be server-derived.');
        assert(stored.documentHtml.includes('Database Patient'), 'Archive must store its exact server-rendered carbon copy.');
        assert(!stored.documentHtml.includes('client-provided'), 'Archive must never persist client-rendered HTML.');
        assert.deepStrictEqual(createAuditRows.map(row => row.action), ['Create Prepared', 'Create for Print']);
        assert(!JSON.stringify(createAuditRows).includes('Database Patient'), 'Create audits must contain summary metadata only.');

        const replayResponse = responseRecorder();
        await controller.create({
            body: validRequest,
            user: { id: 2, username: 'tester' },
            ip: '127.0.0.1'
        }, replayResponse);
        assert.strictEqual(replayResponse.statusCode, 200);
        assert.strictEqual(replayResponse.body.id, createResponse.body.id);
        assert.strictEqual(replayResponse.body.idempotentReplay, true);
        assert.deepStrictEqual(
            createAuditRows.map(row => row.action),
            ['Create Prepared', 'Create for Print', 'Create Print Reauthorized'],
            'Every fresh print authorization must have its own audit event.'
        );
    } finally {
        db.WorkflowAction.findAll = originalWorkflowFindAll;
        db.RXRecord.findAll = originalRxFindAll;
        db.AuditLog.create = originalCreateAudit;
    }

    const archiveFile = path.join(archiveDirectory, first.id + '.json');
    fs.writeFileSync(archiveFile, JSON.stringify(first, null, 2), 'utf8');

    const auditRows = [];
    const originalAuditCreate = db.AuditLog.create;
    db.AuditLog.create = async row => { auditRows.push(row); return row; };
    try {
        const reprintResponse = responseRecorder();
        await controller.reprint({
            params: { id: first.id },
            body: { reprintedAtEpoch: now, timezoneOffsetMinutes: 240, timezoneName: 'America/New_York' },
            user: { id: 2 },
            ip: '127.0.0.1'
        }, reprintResponse);
        assert.strictEqual(reprintResponse.statusCode, 200);
        assert.match(reprintResponse.body.reprinted, /^\d{2}\/\d{2}\/\d{4}/);
        assert.strictEqual(auditRows.length, 1);
        assert.strictEqual(auditRows[0].action, 'Reprint');
        assert.strictEqual(auditRows[0].recordId, null, 'UUID archive ids must not be stored in integer AuditLog.recordId.');
        assert(!JSON.stringify(auditRows[0].newValue).includes('patientAttack'), 'Audit summary must not duplicate patient rows.');

        const directPrintResponse = responseRecorder();
        await controller.print({ params: { id: first.id }, query: {}, user: { id: 2 } }, directPrintResponse);
        assert.strictEqual(directPrintResponse.statusCode, 403, 'Direct GET printing must require a fresh audited authorization.');

        const authorizedUrl = new URL(reprintResponse.body.printUrl, 'http://localhost');
        const printResponse = responseRecorder();
        await controller.print({
            params: { id: first.id },
            query: { printToken: authorizedUrl.searchParams.get('printToken') },
            user: { id: 2 }
        }, printResponse);
        assert.strictEqual(printResponse.statusCode, 200);
        assert.strictEqual(printResponse.headers['Cache-Control'], 'no-store');
        assert(printResponse.headers['Content-Security-Policy'].includes("default-src 'none'"));
        assert(!printResponse.body.includes('<script>patientAttack()</script>'));

        const replayPrintResponse = responseRecorder();
        await controller.print({
            params: { id: first.id },
            query: { printToken: authorizedUrl.searchParams.get('printToken') },
            user: { id: 2 }
        }, replayPrintResponse);
        assert.strictEqual(replayPrintResponse.statusCode, 403, 'Print authorizations must be single-use.');

        const renamedId = '33333333-3333-4333-8333-333333333333';
        fs.copyFileSync(archiveFile, path.join(archiveDirectory, renamedId + '.json'));
        const renamedResponse = responseRecorder();
        await controller.reprint({
            params: { id: renamedId },
            body: { reprintedAtEpoch: now, timezoneOffsetMinutes: 240, timezoneName: 'America/New_York' },
            user: { id: 2 },
            ip: '127.0.0.1'
        }, renamedResponse);
        assert.strictEqual(renamedResponse.statusCode, 409, 'A v2 archive must be bound to its filename id.');
        assert.strictEqual(renamedResponse.body.code, 'ARCHIVE_INTEGRITY_FAILED');
    } finally {
        db.AuditLog.create = originalAuditCreate;
    }

    const clientSource = fs.readFileSync(path.resolve(__dirname, '..', 'public', 'js', 'rx-delivery-log.js'), 'utf8');
    const hooks = {};
    let fetchResponses = [];
    const browserWindow = {
        __RX_DELIVERY_LOG_TEST_HOOKS__: hooks,
        rxUrl: value => value,
        fetchWithAuth: () => Promise.resolve(fetchResponses.shift())
    };
    vm.runInNewContext(clientSource, {
        window: browserWindow,
        document: { addEventListener() {} },
        URLSearchParams,
        Blob,
        Promise,
        Date,
        String,
        Number,
        Array,
        Object,
        Math,
        console
    }, { filename: 'rx-delivery-log.js' });

    fetchResponses = [{
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: 'Archive disk unavailable' })
    }];
    let printReadyCalls = 0;
    await assert.rejects(
        hooks.withPersistedDeliveryLogArchive(
            hooks.persistDeliveryLogArchive({ rxRecordIds: [101] }),
            () => { printReadyCalls += 1; }
        ),
        /Archive disk unavailable/
    );
    assert.strictEqual(printReadyCalls, 0, 'A failed archive save must block the print-ready callback.');

    fetchResponses = [
        { ok: true, status: 201, json: () => Promise.resolve({ id: first.id, printUrl: '/api/reports/delivery-log-archives/' + first.id + '/print' }) },
        { ok: true, status: 200, text: () => Promise.resolve('<!doctype html><html><body>safe archive</body></html>') }
    ];
    await hooks.withPersistedDeliveryLogArchive(
        hooks.persistDeliveryLogArchive({ rxRecordIds: [101] }),
        (_saved, html) => {
            assert(html.includes('safe archive'));
            printReadyCalls += 1;
        }
    );
    assert.strictEqual(printReadyCalls, 1, 'A confirmed archive must reach the print-ready callback exactly once.');

    console.log('PASS: delivery-log archive security, integrity, local-time, persistence, and reprint regressions.');
}

run().catch(error => {
    console.error(error);
    process.exitCode = 1;
}).finally(() => {
    fs.rmSync(writableRoot, { recursive: true, force: true });
    if (db.sequelize && typeof db.sequelize.close === 'function') db.sequelize.close().catch(() => {});
});
