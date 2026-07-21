'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rx-phone-client-'));
process.env.APP_WRITABLE_ROOT = runtimeRoot;
const previousCredentialKey = process.env.SOFTPHONE_CREDENTIAL_KEY;
process.env.SOFTPHONE_CREDENTIAL_KEY = 'call-center-phone-client-regression-key';

try {
    const { encryptPassword, decryptPassword } = require('../services/softphoneAccountService');
    const encryptedPassword = encryptPassword(1006, 'temporary-regression-password');
    assert(encryptedPassword.startsWith('rxsoft:v1:'), 'Softphone password must use the versioned encrypted format.');
    assert(!encryptedPassword.includes('temporary-regression-password'), 'Softphone password must not be stored as plaintext.');
    assert.strictEqual(decryptPassword(1006, encryptedPassword), 'temporary-regression-password', 'Encrypted softphone password did not round-trip.');
    assert.throws(
        () => decryptPassword(1007, encryptedPassword),
        /could not be decrypted/,
        'A softphone credential must be cryptographically bound to its assigned RX user.'
    );

    const settings = require('../utils/globalSettings');
    assert.strictEqual(settings.getCallCenterPhoneClient(), 'microsip', 'MicroSIP must remain the upgrade-safe default.');

    settings.writeSettings({ callCenterPhoneClient: 'rx_softphone' });
    assert.strictEqual(settings.getCallCenterPhoneClient(), 'rx_softphone', 'RX Softphone selection was not persisted.');

    settings.writeSettings({ callCenterPhoneClient: 'auto' });
    assert.strictEqual(settings.getCallCenterPhoneClient(), 'auto', 'Automatic phone-client selection was not persisted.');

    settings.writeSettings({ callCenterPhoneClient: 'unsupported' });
    assert.strictEqual(settings.getCallCenterPhoneClient(), 'microsip', 'Unsupported values must fall back to MicroSIP.');

    const db = require('../models');
    db.AuditLog.create = () => Promise.resolve();
    const adminController = require('../controllers/adminController');
    const response = {
        statusCode: 200,
        payload: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(payload) {
            this.payload = payload;
            return this;
        }
    };
    adminController.saveSettings({
        body: { callCenterPhoneClient: 'rx_softphone' },
        user: { id: 1 },
        ip: '127.0.0.1',
        socket: { remoteAddress: '127.0.0.1' }
    }, response);
    assert.strictEqual(response.statusCode, 200, 'Backoffice should accept RX Softphone.');
    assert.strictEqual(settings.getCallCenterPhoneClient(), 'rx_softphone', 'Backoffice selection was not written.');

    response.statusCode = 200;
    response.payload = null;
    adminController.saveSettings({
        body: { callCenterPhoneClient: 'unsupported' },
        user: { id: 1 },
        ip: '127.0.0.1',
        socket: { remoteAddress: '127.0.0.1' }
    }, response);
    assert.strictEqual(response.statusCode, 400, 'Backoffice should reject unsupported phone clients.');
    assert.strictEqual(settings.getCallCenterPhoneClient(), 'rx_softphone', 'Rejected selection must not overwrite settings.');

    const callCenterScript = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'call-center.js'), 'utf8');
    assert(callCenterScript.includes("targetAddressSpace: 'loopback'"), 'Browser request must identify the loopback target.');
    assert(callCenterScript.includes("snapshot.call || 'idle'"), 'Call-state acknowledgement integration is missing.');
    assert(callCenterScript.includes("payload.callAnsweredAt"), 'Answered-call audit metadata is missing.');
    assert(callCenterScript.includes('/api/call-center/phone-account'), 'Server-managed softphone account endpoint is missing.');
    assert(callCenterScript.includes('connectAssignedPhone(false, false)'), 'Automatic per-user softphone registration is missing.');
    assert(!callCenterScript.includes('rxCallCenterSoftphoneProfileV1'), 'Softphone account metadata must not be stored in browser localStorage.');

    const callCenterView = fs.readFileSync(path.join(__dirname, '..', 'views', 'call-center.ejs'), 'utf8');
    assert(callCenterView.includes('cc-record-heading-all'), 'Compact one-line Call Center roster heading is missing.');
    assert(callCenterView.includes('Save &amp; Connect'), 'Server-backed softphone account editor is missing.');
    assert(callCenterScript.includes('data-action="phone-hangup"'), 'Each callable patient row must provide an inline Hang Up control.');
    assert(callCenterView.includes('.cc-phone-action-stack'), 'Dial and Hang Up controls must remain grouped in the patient phone cell.');
    assert(callCenterView.includes('<option value="50">50</option>'), 'Call Center must support a longer scrolling roster.');
    const callCenterController = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'callCenterController.js'), 'utf8');
    assert(callCenterController.includes('[5, 10, 25, 50].includes(size)'), 'Call Center API must accept the expanded roster page sizes.');
    assert(callCenterScript.includes('function resizeRowNote'), 'Call Center comments must expand the patient row while typing.');

    const webRoutes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'webRoutes.js'), 'utf8');
    assert(webRoutes.includes('http://127.0.0.1:5188'), 'Call Center CSP must allow the local softphone origin.');

    console.log('PASS Call Center phone-client selector and RX Softphone integration regression.');
} finally {
    if (previousCredentialKey === undefined) delete process.env.SOFTPHONE_CREDENTIAL_KEY;
    else process.env.SOFTPHONE_CREDENTIAL_KEY = previousCredentialKey;
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
}
