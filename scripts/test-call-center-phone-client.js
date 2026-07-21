'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rx-phone-client-'));
process.env.APP_WRITABLE_ROOT = runtimeRoot;
const previousCredentialKey = process.env.SOFTPHONE_CREDENTIAL_KEY;
const previousAdminPin = process.env.SOFTPHONE_ACCOUNT_ADMIN_PIN;
process.env.SOFTPHONE_CREDENTIAL_KEY = 'call-center-phone-client-regression-key';

try {
    const { encryptPassword, decryptPassword, isAdminPinRequired, verifyAdminPin } = require('../services/softphoneAccountService');
    const encryptedPassword = encryptPassword(1006, 'temporary-regression-password');
    assert(encryptedPassword.startsWith('rxsoft:v1:'), 'Softphone password must use the versioned encrypted format.');
    assert(!encryptedPassword.includes('temporary-regression-password'), 'Softphone password must not be stored as plaintext.');
    assert.strictEqual(decryptPassword(1006, encryptedPassword), 'temporary-regression-password', 'Encrypted softphone password did not round-trip.');
    assert.throws(
        () => decryptPassword(1007, encryptedPassword),
        /could not be decrypted/,
        'A softphone credential must be cryptographically bound to its assigned RX user.'
    );
    delete process.env.SOFTPHONE_ACCOUNT_ADMIN_PIN;
    assert.strictEqual(isAdminPinRequired(), false, 'Phone-account PIN must remain optional until configured by the administrator.');
    assert.strictEqual(verifyAdminPin(''), true, 'An unconfigured PIN must not block existing installations.');
    process.env.SOFTPHONE_ACCOUNT_ADMIN_PIN = 'regression-admin-pin';
    assert.strictEqual(isAdminPinRequired(), true, 'Configured administrator PIN was not detected.');
    assert.strictEqual(verifyAdminPin('regression-admin-pin'), true, 'Correct administrator PIN was rejected.');
    assert.strictEqual(verifyAdminPin('wrong-pin'), false, 'Incorrect administrator PIN was accepted.');

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
    const softphoneAccountController = require('../controllers/softphoneAccountController');
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
        body: { callCenterPhoneClient: 'rx_softphone', callCenterInactiveClaimSeconds: 15 },
        user: { id: 1 },
        ip: '127.0.0.1',
        socket: { remoteAddress: '127.0.0.1' }
    }, response);
    assert.strictEqual(response.statusCode, 200, 'Backoffice should accept RX Softphone.');
    assert.strictEqual(settings.getCallCenterPhoneClient(), 'rx_softphone', 'Backoffice selection was not written.');
    assert.strictEqual(settings.getCallCenterInactiveClaimSeconds(), 15, 'Backoffice inactive patient-claim timeout was not written.');

    response.statusCode = 200;
    response.payload = null;
    softphoneAccountController.saveOwnAccount({
        body: { server: 'wrong.invalid', username: '9999', adminPin: 'regression-admin-pin' },
        user: { id: 99, role: 'Call Center' },
        headers: {},
        socket: { remoteAddress: '127.0.0.1' }
    }, response);
    assert.strictEqual(response.statusCode, 403, 'Call Center users must never be allowed to save phone-account changes.');
    assert.match(response.payload.error, /Only an Administrator/, 'Phone-account rejection must explain the Administrator-only rule.');

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
    assert(callCenterScript.includes("targetAddressSpace: 'loopback'"), 'Browser request must identify Chrome\'s loopback address space for 127.0.0.1.');
    assert(callCenterScript.includes('probeRxPhoneFromUserGesture'), 'Phone clicks must issue a fresh loopback request from the user gesture.');
    assert(callCenterScript.includes("navigator.permissions.query({ name: 'loopback-network' })"), 'Call Center must inspect Chrome\'s split loopback permission before polling.');
    assert(callCenterScript.includes("rxPhone.loopbackPermission === 'prompt' || rxPhone.loopbackPermission === 'denied'"), 'Automatic polling must wait while loopback permission requires a user gesture.');
    assert(callCenterScript.includes('startRxPhonePolling();'), 'Successful user-gesture access must start normal softphone monitoring.');
    assert(callCenterScript.includes('allow access to other apps and services on this device'), 'Loopback permission guidance must use Chrome\'s current local-device wording.');
    assert(callCenterScript.includes("snapshot.call || 'idle'"), 'Call-state acknowledgement integration is missing.');
    assert(callCenterScript.includes("payload.callAnsweredAt"), 'Answered-call audit metadata is missing.');
    assert(callCenterScript.includes('/api/call-center/phone-account'), 'Server-managed softphone account endpoint is missing.');
    assert(callCenterScript.includes('connectAssignedPhone(false, false)'), 'Automatic per-user softphone registration is missing.');
    assert(!callCenterScript.includes("toast('Phone registration window is unavailable."), 'Call failures must not open the retired phone-registration modal.');
    assert(!callCenterScript.includes('rxCallCenterSoftphoneProfileV1'), 'Softphone account metadata must not be stored in browser localStorage.');

    const callCenterView = fs.readFileSync(path.join(__dirname, '..', 'views', 'call-center.ejs'), 'utf8');
    assert(callCenterView.includes('cc-record-heading-all'), 'Compact one-line Call Center roster heading is missing.');
    assert(!callCenterView.includes('ccPhoneSetupModal'), 'Call Center must not expose phone-account configuration controls.');
    assert(callCenterScript.includes('data-action="phone-hangup"'), 'Each callable patient row must provide an inline Hang Up control.');
    assert(callCenterView.includes('.cc-phone-action-stack'), 'Dial and Hang Up controls must remain grouped in the patient phone cell.');
    assert(callCenterView.includes('<option value="50">50</option>'), 'Call Center must support a longer scrolling roster.');
    const callCenterController = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'callCenterController.js'), 'utf8');
    assert(callCenterController.includes('[5, 10, 25, 50].includes(size)'), 'Call Center API must accept the expanded roster page sizes.');
    assert(callCenterController.includes("claimMode: 'on_dial'"), 'Call Center queue must claim patients only when an agent starts a call.');
    assert(!callCenterController.includes('await acquireCallCenterLock(filtered[i].id, req)'), 'Viewing a Call Center queue page must not claim every displayed patient.');
    assert(callCenterScript.includes("if (!await claimRow(patientId)) return;\n            openMicroSip"), 'MicroSIP dialing must claim the patient before launch.');
    assert(callCenterScript.includes('function resizeRowNote'), 'Call Center comments must expand the patient row while typing.');
    assert(callCenterScript.includes('function refreshPhoneAvailability'), 'Call Center must refresh phone availability without reloading patient rows.');
    assert(callCenterScript.includes('cc-availability-active'), 'Active calls must render a red phone availability state.');
    assert(callCenterScript.includes('cc-availability-cooldown'), 'Inactive claims must render an amber cooldown state.');
    assert(callCenterScript.includes('cc-cooldown-countdown'), 'Amber cooldown must display a live seconds badge on the phone icon.');
    assert(callCenterScript.includes('function formatConnectedDuration'), 'Connected calls must format a live elapsed duration on the phone icon.');
    assert(callCenterScript.includes("countdown.classList.add('visible', 'connected')"), 'Connected calls must activate the duration badge above the phone icon.');
    assert(callCenterView.includes('.cc-cooldown-countdown.connected'), 'Connected duration badge styling is missing.');
    assert(callCenterView.includes('cc-phone-lock-status'), 'Phone availability must display the claiming agent beside the phone action.');

    const backofficeView = fs.readFileSync(path.join(__dirname, '..', 'views', 'backoffice.ejs'), 'utf8');
    const backofficeScript = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'backoffice-features.js'), 'utf8');
    assert(backofficeView.includes('sCallCenterInactiveClaimSeconds'), 'Backoffice inactive patient-claim timeout control is missing.');
    assert(backofficeScript.includes('callCenterInactiveClaimSeconds'), 'Backoffice inactive patient-claim timeout save/load integration is missing.');
    assert(!backofficeView.includes('tabPhoneAccounts'), 'Backoffice must not expose the retired phone-account assignment tab.');

    const setupView = fs.readFileSync(path.join(__dirname, '..', 'views', 'phone-account-setup.ejs'), 'utf8');
    const setupScript = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'phone-account-setup.js'), 'utf8');
    const apiRoutes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'apiRoutes.js'), 'utf8');
    const sidebarView = fs.readFileSync(path.join(__dirname, '..', 'views', 'partials', 'sidebar.ejs'), 'utf8');
    assert(setupView.includes('This is a one-time setup'), 'Phone Account Setup must explain the one-time workflow.');
    assert(setupScript.includes('/api/phone-account/setup'), 'Self-service phone-account setup API integration is missing.');
    assert(setupScript.includes('phoneSetupPasswordConfirm'), 'Self-service setup must confirm the SIP password before saving.');
    assert(sidebarView.includes('locals.phoneAccountSetupAllowed === true'), 'Phone Account Setup navigation must require per-user authorization.');
    assert(!sidebarView.includes("sv('phone_account_setup')"), 'Phone Account Setup must not depend on a role-wide permission.');
    assert(apiRoutes.includes("/users/:id/phone-account/setup-access"), 'Administrator setup re-enable endpoint is missing.');
    assert(!apiRoutes.includes("/admin/softphone-accounts"), 'Retired Backoffice phone-account assignment API must not remain exposed.');

    const webRoutes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'webRoutes.js'), 'utf8');
    assert(webRoutes.includes('http://127.0.0.1:5188'), 'Call Center CSP must allow the local softphone origin.');

    console.log('PASS Call Center phone-client selector and RX Softphone integration regression.');
} finally {
    if (previousCredentialKey === undefined) delete process.env.SOFTPHONE_CREDENTIAL_KEY;
    else process.env.SOFTPHONE_CREDENTIAL_KEY = previousCredentialKey;
    if (previousAdminPin === undefined) delete process.env.SOFTPHONE_ACCOUNT_ADMIN_PIN;
    else process.env.SOFTPHONE_ACCOUNT_ADMIN_PIN = previousAdminPin;
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
}
