'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const rxSource = fs.readFileSync(path.join(root, 'public', 'js', 'rx-delivery-log.js'), 'utf8');
const reportsSource = fs.readFileSync(path.join(root, 'public', 'js', 'reports.js'), 'utf8');
const backofficeSource = fs.readFileSync(path.join(root, 'public', 'js', 'backoffice-features.js'), 'utf8');
const rxViewSource = fs.readFileSync(path.join(root, 'views', 'rx-records.ejs'), 'utf8');
const reportsViewSource = fs.readFileSync(path.join(root, 'views', 'reports.ejs'), 'utf8');
const backofficeViewSource = fs.readFileSync(path.join(root, 'views', 'backoffice.ejs'), 'utf8');
const archiveCss = fs.readFileSync(path.join(root, 'public', 'css', 'rx-delivery-log-archive-v2.css'), 'utf8');

function timezoneIntl() {
    return {
        DateTimeFormat: function () {
            return { resolvedOptions: function () { return { timeZone: 'America/New_York' }; } };
        }
    };
}

function loadRxClient(cryptoApi) {
    const hooks = {};
    const fetchCalls = [];
    const fetchResponses = [];
    const browserWindow = {
        __RX_DELIVERY_LOG_TEST_HOOKS__: hooks,
        crypto: cryptoApi,
        rxUrl: value => value,
        fetchWithAuth: (url, options) => {
            fetchCalls.push({ url, options: options || {} });
            return Promise.resolve(fetchResponses.shift());
        }
    };
    vm.runInNewContext(rxSource, {
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
        Uint8Array,
        Intl: timezoneIntl(),
        console
    }, { filename: 'rx-delivery-log.js' });
    return { hooks, fetchCalls, fetchResponses };
}

function classListState() {
    const values = new Set();
    return {
        add(value) { values.add(value); },
        remove(value) { values.delete(value); },
        contains(value) { return values.has(value); }
    };
}

function auditStrip(document) {
    let stamp = null;
    return {
        querySelector(selector) { return selector === '.reprint-stamp' ? stamp : null; },
        appendChild(node) { stamp = node; },
        stamp() { return stamp; },
        document
    };
}

function printWindow(strips, printAssertion) {
    const listeners = {};
    let fallback = null;
    const bodyClasses = classListState();
    const printButton = {
        disabled: false,
        textContent: 'Print / Save PDF',
        addEventListener() {}
    };
    const document = {
        body: { classList: bodyClasses },
        title: '',
        open() {},
        write() {},
        close() {},
        querySelectorAll(selector) { return selector === '.audit-strip' ? strips : []; },
        querySelector() { return null; },
        createElement() { return { className: '', textContent: '' }; },
        getElementById(id) { return id === 'printReportBtn' ? printButton : null; }
    };
    const win = {
        document,
        focus() {},
        close() {},
        print() { printAssertion(bodyClasses); },
        addEventListener(name, callback) { listeners[name] = callback; },
        removeEventListener(name, callback) {
            if (listeners[name] === callback) delete listeners[name];
        },
        setTimeout(callback) { fallback = callback; return 1; },
        clearTimeout() { fallback = null; }
    };
    return {
        win,
        bodyClasses,
        printButton,
        afterprint() { assert(listeners.afterprint, 'The print flow must register afterprint cleanup.'); listeners.afterprint(); },
        fallback() { assert(fallback, 'The print flow must register fallback cleanup.'); fallback(); }
    };
}

async function run() {
    assert.match(rxViewSource, /\/js\/base\.js\?v=<%= encodeURIComponent\(String\(locals\.appBuild \|\| 'dev'\)\) %>/,
        'RX Records must cache-bust the shared print-readiness helper.');
    assert.match(rxViewSource, /\/js\/rx-delivery-log\.js\?v=<%= encodeURIComponent\(String\(locals\.appBuild \|\| 'dev'\)\) %>/,
        'RX Records must cache-bust the delivery-log print flow.');
    assert.match(reportsViewSource, /\/js\/base\.js\?v=<%= encodeURIComponent\(String\(locals\.appBuild \|\| 'dev'\)\) %>/,
        'Reports must cache-bust the shared print-readiness helper.');
    assert.match(backofficeViewSource, /<tbody id="dlArchiveList">[\s\S]*?<\/tbody>/,
        'Backoffice archive headers and rows must share one table.');
    assert.match(backofficeViewSource, /<th[^>]*>Period<\/th>/,
        'Backoffice cleanup must show the archive period.');

    let randomUuidCalls = 0;
    const fixedRequestId = '11111111-1111-4111-8111-111111111111';
    const rx = loadRxClient({
        randomUUID() { randomUuidCalls += 1; return fixedRequestId; }
    });
    const draftState = rx.hooks.createArchiveDraftState();
    assert.strictEqual(draftState.requestId, fixedRequestId);
    draftState.archiveRecord = { id: 'saved-once' };
    draftState.archiveRecord = null;
    assert.strictEqual(draftState.requestId, fixedRequestId, 'Retry state must retain the original request id.');
    assert.strictEqual(randomUuidCalls, 1, 'A draft must generate exactly one request id.');

    const fallbackRx = loadRxClient({
        getRandomValues(bytes) {
            for (let index = 0; index < bytes.length; index += 1) bytes[index] = index;
            return bytes;
        }
    });
    assert.match(
        fallbackRx.hooks.createArchiveRequestId(),
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        'The getRandomValues fallback must produce an RFC 4122 version 4 UUID.'
    );

    rx.fetchResponses.push({
        ok: true,
        status: 201,
        json: () => Promise.resolve({ id: 'archive-1', printUrl: '/print?token=create-token' })
    });
    await rx.hooks.persistDeliveryLogArchive({ requestId: draftState.requestId, rxRecordIds: [101] });
    assert.strictEqual(JSON.parse(rx.fetchCalls[0].options.body).requestId, fixedRequestId);

    const stampDocument = { createElement: () => ({ className: '', textContent: '' }) };
    const rxStrips = [auditStrip(stampDocument), auditStrip(stampDocument)];
    rx.hooks.setReprintLabel({
        document: {
            querySelectorAll: () => rxStrips,
            createElement: stampDocument.createElement
        }
    }, '08/01/2026, 10:30 AM EDT');
    rxStrips.forEach(strip => assert.strictEqual(strip.stamp().textContent, 'Reprinted: 08/01/2026, 10:30 AM EDT'));

    let rxPrintCalls = 0;
    const authorizedRxWindow = printWindow([], classes => {
        rxPrintCalls += 1;
        assert(classes.contains('print-authorized'), 'RX print must be authorized before window.print().');
    });
    rx.hooks.printAuthorizedArchivedReport(authorizedRxWindow.win);
    assert.strictEqual(rxPrintCalls, 1);
    authorizedRxWindow.afterprint();
    assert(!authorizedRxWindow.bodyClasses.contains('print-authorized'), 'RX afterprint must revoke print authorization.');

    const reportHooks = {};
    const reportFetchCalls = [];
    const reportResponses = [
        { ok: true, status: 200, json: () => Promise.resolve({ reprinted: 'First stamp', printUrl: '/print?token=first' }) },
        { ok: true, status: 200, text: () => Promise.resolve('<!doctype html><html><body>first</body></html>') },
        { ok: true, status: 200, json: () => Promise.resolve({ reprinted: 'Second stamp', printUrl: '/print?token=second' }) },
        { ok: true, status: 200, text: () => Promise.resolve('<!doctype html><html><body>second</body></html>') }
    ];
    const toastMessages = [];
    const reportWindow = {
        __RX_REPORTS_TEST_HOOKS__: reportHooks,
        rxUrl: value => value,
        rxWaitForDeliveryLogArchivePrintReady: () => Promise.resolve(),
        setTimeout,
        clearTimeout
    };
    vm.runInNewContext(reportsSource, {
        window: reportWindow,
        document: { addEventListener() {} },
        fetchWithAuth: (url, options) => {
            reportFetchCalls.push({ url, options: options || {} });
            return Promise.resolve(reportResponses.shift());
        },
        showToast: message => toastMessages.push(message),
        URLSearchParams,
        Blob,
        Promise,
        Date,
        String,
        Number,
        Array,
        Object,
        Math,
        Intl: timezoneIntl(),
        console,
        setTimeout,
        clearTimeout
    }, { filename: 'reports.js' });

    const archiveSummary = {
        id: '1243d668b99ee70dabc4dfcf599d94ed',
        reference: 'LOG-20260801-1243D668B99EE70DABC4DFCF599D94ED',
        verification: 'SHA256-' + '6'.repeat(64),
        artifactHash: '7'.repeat(64),
        total: 10,
        counts: { received: 10, returned: 0, pending: 0 },
        generated: '08/01/2026, 11:49:45 AM',
        createdAt: '2026-08-01T15:49:45.000Z',
        period: '07/31/2026',
        filters: '10 server-verified <open> RX records',
        formatVersion: 2
    };
    assert.strictEqual(reportHooks.deliveryLogArchiveCode(archiveSummary), 'Archive 1243D668B99E');
    assert.strictEqual(reportHooks.deliveryLogArchiveContents(archiveSummary), '10 RX / 10 received');
    assert.strictEqual(reportHooks.deliveryLogArchiveIntegrity(archiveSummary).label, 'Verified');
    assert.strictEqual(reportHooks.deliveryLogArchiveIntegrity({
        reference: '(corrupt or unsupported record)',
        verification: 'unavailable'
    }).printable, false);
    const reportEvidence = reportHooks.deliveryLogArchiveEvidence(archiveSummary);
    assert(reportEvidence.includes(archiveSummary.reference), 'Full reference must remain available under Evidence.');
    assert(reportEvidence.includes(archiveSummary.verification), 'Full verification must remain available under Evidence.');
    assert(reportEvidence.includes('&lt;open&gt;'), 'Archive evidence must escape server selection text.');

    const backofficeContext = {};
    vm.runInNewContext(backofficeSource, backofficeContext, { filename: 'backoffice-features.js' });
    assert.strictEqual(backofficeContext._dlArchiveCode(archiveSummary), 'Archive 1243D668B99E');
    assert.strictEqual(backofficeContext._dlArchiveContents(archiveSummary), '10 RX / 10 received');
    assert.strictEqual(backofficeContext._dlArchiveIntegrity(archiveSummary).label, 'Verified');
    const backofficeEvidence = backofficeContext._dlArchiveEvidence(archiveSummary);
    assert(backofficeEvidence.includes(archiveSummary.reference));
    assert(backofficeEvidence.includes('&lt;open&gt;'));

    const archiveListElement = { innerHTML: '' };
    backofficeContext.document = {
        getElementById(id) { return id === 'dlArchiveList' ? archiveListElement : null; }
    };
    backofficeContext.apiFetch = async () => ({
        ok: true,
        json: async () => [archiveSummary]
    });
    await backofficeContext.loadDeliveryLogArchiveList();
    assert(archiveListElement.innerHTML.includes('07/31/2026'),
        'Backoffice archive rows must include the period used to identify duplicates.');
    assert(archiveListElement.innerHTML.includes('Archive 1243D668B99E'));
    assert(!archiveListElement.innerHTML.includes('<table'),
        'Backoffice must insert rows into the view-owned table instead of nesting a second table.');

    let reportPrintCalls = 0;
    const reportStrips = [auditStrip(), auditStrip()];
    const archivedWindow = printWindow(reportStrips, classes => {
        reportPrintCalls += 1;
        assert(classes.contains('print-authorized'), 'Reports print must be authorized before window.print().');
    });
    await reportHooks.runDeliveryLogReprint(archivedWindow.win, 'archive-1', null);
    archivedWindow.afterprint();
    await reportHooks.runDeliveryLogReprint(archivedWindow.win, 'archive-1', archivedWindow.printButton);
    archivedWindow.fallback();

    assert.deepStrictEqual(reportFetchCalls.map(call => call.url), [
        '/api/reports/delivery-log-archives/archive-1/reprint',
        '/print?token=first',
        '/api/reports/delivery-log-archives/archive-1/reprint',
        '/print?token=second'
    ], 'Every print must POST an audit before consuming its fresh one-time print URL.');
    assert.strictEqual(reportFetchCalls[0].options.method, 'POST');
    assert.strictEqual(reportFetchCalls[1].options.cache, 'no-store');
    assert.strictEqual(JSON.parse(reportFetchCalls[0].options.body).timezoneName, 'America/New_York');
    assert.strictEqual(reportPrintCalls, 2);
    assert.strictEqual(toastMessages.length, 0);
    reportStrips.forEach(strip => assert.strictEqual(strip.stamp().textContent, 'Reprinted: Second stamp'));
    assert(!archivedWindow.bodyClasses.contains('print-authorized'), 'Fallback cleanup must revoke print authorization.');

    assert(rxSource.includes('<body class="delivery-log-draft">'), 'The unarchived draft must carry its print-blocking body class.');
    assert(rxSource.includes('body.delivery-log-draft>*{display:none!important}'), 'The unarchived draft must be blank under native printing.');
    assert(archiveCss.includes('body.delivery-log-archive:not(.print-authorized)>*{display:none!important}'), 'Archived HTML must be nonprintable without temporary authorization.');
    assert(archiveCss.includes('.report-actions{display:none!important}'), 'Archived print controls must be hidden with !important.');

    console.log('PASS: delivery-log client idempotency, audited print ordering, all-page stamps, and native-print gates.');
}

run().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
