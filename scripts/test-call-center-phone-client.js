'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rx-phone-client-'));
process.env.APP_WRITABLE_ROOT = runtimeRoot;

try {
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

    const webRoutes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'webRoutes.js'), 'utf8');
    assert(webRoutes.includes('http://127.0.0.1:5188'), 'Call Center CSP must allow the local softphone origin.');

    console.log('PASS Call Center phone-client selector and RX Softphone integration regression.');
} finally {
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
}
