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
    assert(!callCenterScript.includes('http://127.0.0.1:5188'), 'FortiGate must not receive a literal loopback URL that its web proxy can rewrite.');
    assert(callCenterScript.includes("['127', '0', '0', '1'].join('.')"), 'The browser must construct the RX Softphone loopback address at runtime.');
    assert(callCenterScript.includes('function getRxSoftphoneFetch'), 'RX Softphone requests must use a browser realm isolated from FortiGate sslvpn.js.');
    assert(callCenterScript.includes('frameWindow.fetch.bind(frameWindow)'), 'The FortiGate-safe loopback request must use the clean frame fetch implementation.');
    assert(callCenterScript.includes('getRxSoftphoneFetch()(rxSoftphoneBaseUrl + path'), 'RX Softphone status and call requests must bypass the injected FortiGate fetch wrapper.');
    assert(callCenterScript.includes("targetAddressSpace: 'loopback'"), 'Browser request must identify Chrome\'s loopback address space for 127.0.0.1.');
    assert(callCenterScript.includes('probeRxPhoneFromUserGesture'), 'Phone clicks must issue a fresh loopback request from the user gesture.');
    assert(callCenterScript.includes("navigator.permissions.query({ name: 'loopback-network' })"), 'Call Center must inspect Chrome\'s split loopback permission before polling.');
    assert(callCenterScript.includes("rxPhone.loopbackPermission === 'prompt' || rxPhone.loopbackPermission === 'denied'"), 'Automatic polling must wait while loopback permission requires a user gesture.');
    assert(callCenterScript.includes("rxFetch('/api/status', { timeoutMs: 30000 })"), 'The user-gesture probe must remain open long enough to approve Chrome\'s permission prompt.');
    assert(callCenterScript.includes('startRxPhonePolling();'), 'Successful user-gesture access must start normal softphone monitoring.');
    assert(callCenterScript.includes('allow access to other apps and services on this device'), 'Loopback permission guidance must use Chrome\'s current local-device wording.');
    assert(callCenterScript.includes('inside Kasm or another remote browser'), 'Unreachable-softphone guidance must explain the remote-browser loopback limitation.');
    assert(callCenterScript.includes("snapshot.call || 'idle'"), 'Call-state acknowledgement integration is missing.');
    assert(callCenterScript.includes("payload.callAnsweredAt"), 'Answered-call audit metadata is missing.');
    assert(callCenterScript.includes('/api/call-center/phone-account'), 'Server-managed softphone account endpoint is missing.');
    assert(callCenterScript.includes('connectAssignedPhone(false, false)'), 'Automatic per-user softphone registration is missing.');
    assert(callCenterScript.includes('function probeRelayPhone'), 'Kasm fallback must probe the paired outbound softphone relay.');
    assert(callCenterScript.includes("rxPhone.transport === 'relay'"), 'Call Center must route dial and hangup through the relay only when selected.');
    assert(callCenterScript.includes('api.relayCalls'), 'Relay call command endpoint is missing from Call Center.');
    assert(callCenterScript.includes('function snapshotMatchesActiveCall'), 'Call Center must correlate relay snapshots before updating an active attempt.');
    assert(callCenterScript.includes('if (!snapshotMatchesActiveCall(active, snapshot)) return;'), 'A previous relay call snapshot must not update or replace the active call.');
    assert(/dialSnapshot = Object\.assign\(\{\}, snapshot, \{[\s\S]*?ringingAt: null,[\s\S]*?connectedAt: null,[\s\S]*?endedAt: null,[\s\S]*?outcome: null,[\s\S]*?sipResponseCode: null,[\s\S]*?sipReason: null/.test(callCenterScript), 'A new relay dialing snapshot must clear terminal metadata inherited from the previous call.');
    assert(!callCenterScript.includes("toast('Phone registration window is unavailable."), 'Call failures must not open the retired phone-registration modal.');
    assert(!callCenterScript.includes('rxCallCenterSoftphoneProfileV1'), 'Softphone account metadata must not be stored in browser localStorage.');

    const callCenterView = fs.readFileSync(path.join(__dirname, '..', 'views', 'call-center.ejs'), 'utf8');
    assert(callCenterView.includes('cc-record-heading-all'), 'Compact one-line Call Center roster heading is missing.');
    assert(!callCenterView.includes('ccPhoneSetupModal'), 'Call Center must not expose phone-account configuration controls.');
    assert(callCenterView.includes('ccRelayPairModal'), 'Call Center must expose one-time Windows softphone pairing without exposing SIP settings.');
    assert(callCenterScript.includes('data-action="phone-hangup"'), 'Each callable patient row must provide an inline Hang Up control.');
    assert(callCenterView.includes('.cc-phone-action-stack'), 'Dial and Hang Up controls must remain grouped in the patient phone cell.');
    assert(callCenterView.includes('<option value="50">50</option>'), 'Call Center must support a longer scrolling roster.');
    const callCenterController = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'callCenterController.js'), 'utf8');
    assert(callCenterController.includes('[5, 10, 25, 50].includes(size)'), 'Call Center API must accept the expanded roster page sizes.');
    assert(callCenterController.includes("claimMode: 'on_dial'"), 'Call Center queue must claim patients only when an agent starts a call.');
    assert(!callCenterController.includes('await acquireCallCenterLock(filtered[i].id, req)'), 'Viewing a Call Center queue page must not claim every displayed patient.');
    assert(/if \(!await claimRow\(patientId\)\) return;\r?\n\s+openMicroSip/.test(callCenterScript), 'MicroSIP dialing must claim the patient before launch.');
    assert(callCenterScript.includes('function resizeRowNote'), 'Call Center comments must expand the patient row while typing.');
    assert(callCenterScript.includes('function refreshPhoneAvailability'), 'Call Center must refresh phone availability without reloading patient rows.');
    assert(callCenterScript.includes('cc-availability-active'), 'Active calls must render a red phone availability state.');
    assert(callCenterScript.includes('cc-availability-cooldown'), 'Inactive claims must render an amber cooldown state.');
    assert(callCenterScript.includes('cc-cooldown-countdown'), 'Amber cooldown must display a live seconds badge on the phone icon.');
    assert(callCenterScript.includes('function formatConnectedDuration'), 'Connected calls must format a live elapsed duration on the phone icon.');
    assert(callCenterScript.includes('function sharedCallStateLabel'), 'Other users must receive a readable shared dialing, ringing, or connected state.');
    assert(callCenterScript.includes('sharedCallStateLabel(status.callState)'), 'Phone availability must render the server-provided call state for every user.');
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
    const devicesView = fs.readFileSync(path.join(__dirname, '..', 'views', 'softphone-devices.ejs'), 'utf8');
    const devicesScript = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'softphone-devices.js'), 'utf8');
    const livePhonesView = fs.readFileSync(path.join(__dirname, '..', 'views', 'live-rx-phones.ejs'), 'utf8');
    const livePhonesScript = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'live-rx-phones.js'), 'utf8');
    const apiRoutes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'apiRoutes.js'), 'utf8');
    const sidebarView = fs.readFileSync(path.join(__dirname, '..', 'views', 'partials', 'sidebar.ejs'), 'utf8');
    assert(setupView.includes('This is a one-time setup'), 'Phone Account Setup must explain the one-time workflow.');
    assert(setupScript.includes('/api/phone-account/setup'), 'Self-service phone-account setup API integration is missing.');
    assert(setupScript.includes('phoneSetupPasswordConfirm'), 'Self-service setup must confirm the SIP password before saving.');
    assert(setupView.includes('phoneSetupAuthId'), 'Phone Account Setup must expose the optional PBX Authentication ID.');
    assert(setupScript.includes("authId: field('phoneSetupAuthId').value.trim()"), 'Phone Account Setup must send the optional Authentication ID.');
    assert(sidebarView.includes('locals.phoneAccountSetupAllowed === true'), 'Phone Account Setup navigation must require per-user authorization.');
    assert(!sidebarView.includes("sv('phone_account_setup')"), 'Phone Account Setup must not depend on a role-wide permission.');
    assert(apiRoutes.includes("/users/:id/phone-account/setup-access"), 'Administrator setup re-enable endpoint is missing.');
    assert(!apiRoutes.includes("/admin/softphone-accounts"), 'Retired Backoffice phone-account assignment API must not remain exposed.');
    assert(apiRoutes.includes("/admin/softphone-devices"), 'Administrator managed-device inventory API is missing.');
    assert(apiRoutes.includes("/admin/softphone-devices/:userId"), 'Administrator workstation revocation API is missing.');
    assert(apiRoutes.includes("/admin/softphone-devices/:userId/account"), 'Administrator phone-line retirement API is missing.');
    assert(sidebarView.includes('Phone Devices'), 'Administrator Phone Devices navigation is missing.');
    assert(sidebarView.includes('Live RX Phones'), 'Administrator Live RX Phones navigation is missing.');
    assert(devicesView.includes('id="xa-softphone-devices-api"'), 'Phone Devices must expose a FortiGate-rewritten API anchor.');
    assert(devicesView.includes('/js/softphone-devices.js?v='), 'Phone Devices script must be versioned to bypass FortiGate session caching.');
    assert(devicesScript.includes('window.rxElementHref(anchor)'), 'Phone Devices must read the FortiGate-rewritten API URL.');
    assert(devicesScript.includes('REQUEST_TIMEOUT_MS = 15000'), 'Phone Devices must not remain indefinitely in its loading state.');
    assert(devicesScript.includes('__RX_SOFTPHONE_DEVICES_BOOTED'), 'Phone Devices must report a script-loading failure.');
    assert(devicesScript.includes('var rowsHtml = filtered.map(function(user)'), 'Phone Devices must build table rows before assigning innerHTML for FortiGate compatibility.');
    assert(devicesScript.includes('body.innerHTML = rowsHtml;'), 'Phone Devices must assign the completed row markup in a FortiGate-safe statement.');
    assert(!devicesScript.includes('body.innerHTML = filtered.map(function(user)'), 'Phone Devices must not use the compound innerHTML expression FortiGate rewrites with invalid JavaScript.');
    assert(devicesScript.includes('data-retire-user='), 'Phone Devices must expose a separate phone-line retirement action.');
    assert(devicesScript.includes('Historical calls and audit records are preserved.'), 'Phone-line retirement must explain its history-preservation behavior.');
    assert(devicesScript.includes("' · retired'"), 'Disabled phone assignments must be labeled as retired in the device inventory.');
    assert(livePhonesView.includes('id="xa-live-rx-phones-api"'), 'Live RX Phones must expose a FortiGate-rewritten API anchor.');
    assert(livePhonesView.includes('/js/live-rx-phones.js?v='), 'Live RX Phones script must be versioned to bypass FortiGate session caching.');
    assert(livePhonesView.includes('does not listen to audio'), 'Live RX Phones must clearly identify its status-only scope.');
    assert(livePhonesView.includes('id="livePhoneStatusFilter"'), 'Live RX Phones status filter is missing.');
    assert(livePhonesScript.includes('window.rxElementHref(anchor)'), 'Live RX Phones must read the FortiGate-rewritten API URL.');
    assert(livePhonesScript.includes('REQUEST_TIMEOUT_MS = 15000'), 'Live RX Phones must use a bounded FortiGate request timeout.');
    assert(livePhonesScript.includes('__RX_LIVE_PHONES_BOOTED'), 'Live RX Phones must report a script-loading failure.');
    assert(livePhonesScript.includes("setInterval(function() { loadPhones(true); }, 5000)"), 'Live RX Phones must refresh operational state every five seconds.');
    assert(livePhonesScript.includes('setInterval(updateDurations, 1000)'), 'Live RX Phones must update active call durations every second.');
    assert(livePhonesScript.includes('var cardsHtml = filtered.map(function(user)'), 'Live RX Phones must build cards before assigning markup for FortiGate compatibility.');
    assert(livePhonesScript.includes('board.innerHTML = cardsHtml;'), 'Live RX Phones must use a FortiGate-safe two-step board assignment.');
    assert(livePhonesScript.includes('user.account.isEnabled !== false'), 'Live RX Phones must hide disabled or retired SIP assignments.');
    assert(!livePhonesScript.includes('fetch(endpoint(path), { method:'), 'Live RX Phones must remain view-only.');

    const webRoutes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'webRoutes.js'), 'utf8');
    assert(webRoutes.includes('http://127.0.0.1:5188'), 'Call Center CSP must allow the local softphone origin.');
    assert(webRoutes.includes("'/softphone-devices'"), 'Administrator Phone Devices page route is missing.');
    assert(/router\.get\('\/live-rx-phones', requireWebLogin, requireAdministratorWeb/.test(webRoutes), 'Live RX Phones page must require an Administrator.');

    const softphoneProgram = fs.readFileSync(path.join(__dirname, '..', 'rx-softphone-desktop', 'Program.cs'), 'utf8');
    const softphoneRelay = fs.readFileSync(path.join(__dirname, '..', 'rx-softphone-desktop', 'SoftphoneRelayService.cs'), 'utf8');
    const softphoneSip = fs.readFileSync(path.join(__dirname, '..', 'rx-softphone-desktop', 'SipPhoneService.cs'), 'utf8');
    const softphoneUi = fs.readFileSync(path.join(__dirname, '..', 'rx-softphone-desktop', 'wwwroot', 'app.js'), 'utf8');
    const softphonePage = fs.readFileSync(path.join(__dirname, '..', 'rx-softphone-desktop', 'wwwroot', 'index.html'), 'utf8');
    const softphoneConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'rx-softphone-desktop', 'appsettings.json'), 'utf8'));
    assert(softphoneProgram.includes('GetValue("Softphone:ManagedMode", true)'), 'Packaged RX Softphone must default to managed mode.');
    assert(softphoneProgram.includes('managed pairing can be revoked only from RX Tracker'), 'Local unpairing must be blocked in managed mode.');
    assert(softphoneRelay.includes('MaximumFailureDelay = TimeSpan.FromSeconds(5)'), 'Relay failures must use bounded network backoff.');
    assert(softphoneRelay.includes('InvalidatePairingAsync'), 'Revoked device tokens must clear the local pairing and registration.');
    assert(softphoneSip.includes('Automatic registration stopped'), 'Permanent SIP failures must stop the credential retry cycle.');
    assert(softphoneSip.includes('var authId = string.IsNullOrWhiteSpace(request.AuthId)'), 'RX Softphone must fall back to the extension when Auth ID is blank.');
    assert(softphoneSip.includes('SIPCallDescriptor(') && softphoneSip.includes('_authId'), 'Authenticated outbound calls must use the separate Auth ID.');
    assert(softphonePage.includes('Managed by RX Tracker'), 'Managed client UI must identify the Administrator-owned account.');
    assert(softphonePage.includes('Authentication ID'), 'Standalone RX Softphone must expose optional Authentication ID setup.');
    assert(softphoneUi.includes('elements.registrationActions.hidden = managed'), 'Managed client UI must hide local registration controls.');
    assert.strictEqual(softphoneConfig.Softphone.ManagedMode, true, 'Distributed softphone configuration must remain managed.');
    assert(!softphoneConfig.Softphone.AllowedOrigins.includes('https://portal.rbandrc.com'), 'Kasm portal must use the relay instead of direct loopback access.');
    assert(!softphoneConfig.Softphone.AllowedOrigins.some(origin => origin.includes('192.168.15.87')), 'Development origins must not ship in the production softphone allowlist.');

    console.log('PASS Call Center phone-client selector and RX Softphone integration regression.');
} finally {
    if (previousCredentialKey === undefined) delete process.env.SOFTPHONE_CREDENTIAL_KEY;
    else process.env.SOFTPHONE_CREDENTIAL_KEY = previousCredentialKey;
    if (previousAdminPin === undefined) delete process.env.SOFTPHONE_ACCOUNT_ADMIN_PIN;
    else process.env.SOFTPHONE_ACCOUNT_ADMIN_PIN = previousAdminPin;
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
}
