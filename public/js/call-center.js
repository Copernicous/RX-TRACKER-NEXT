// call-center.js -- dedicated restricted Call Center workspace
(function() {
    'use strict';

    var api = (function() {
        function h(id, fallback) {
            var el = document.getElementById(id);
            var raw = typeof window.rxElementHref === 'function'
                ? window.rxElementHref(el)
                : '';
            if (typeof window.rxUrl === 'function' && raw) {
                return window.rxUrl(String(raw));
            }
            if (raw) return raw;
            return typeof fallback === 'string' ? fallback : '';
        }
        return {
            patients: h('xa-cc-patients', '/api/call-center/patients'),
            metrics: h('xa-cc-metrics', '/api/call-center/metrics/me'),
            lockRefresh: h('xa-cc-lock-refresh', '/api/call-center/locks/refresh'),
            lockRelease: h('xa-cc-lock-release', '/api/call-center/locks/release'),
            lockStatus: h('xa-cc-lock-status', '/api/call-center/locks/status'),
            phoneAccount: h('xa-cc-phone-account', '/api/call-center/phone-account'),
            phoneRegistration: h('xa-cc-phone-registration', '/api/call-center/phone-account/registration'),
            callAttempts: h('xa-cc-call-attempts', '/api/call-center/call-attempts'),
            relayPairing: h('xa-cc-relay-pairing', '/api/call-center/softphone-relay/pairing-code'),
            relayStatus: h('xa-cc-relay-status', '/api/call-center/softphone-relay/status'),
            relayCalls: h('xa-cc-relay-calls', '/api/call-center/softphone-relay/calls')
        };
    })();

    var lockedPatientIds = [];
    var lockHeartbeatTimer = null;
    var lockStatusTimer = null;
    var lockStatusPromise = null;
    var serviceWindowDays = Number(window.SERVICE_WINDOW_DAYS) || 90;
    var callCenterLeadDays = Number(window.CALL_CENTER_LEAD_DAYS) || 0;
    // Build the loopback URL at runtime. FortiGate SSL-VPN web mode rewrites
    // literal absolute URLs in downloaded JavaScript into its own /proxy/... URL,
    // which prevents the browser from ever reaching the desktop softphone.
    var rxSoftphoneBaseUrl = [
        'http',
        '://',
        ['127', '0', '0', '1'].join('.'),
        ':',
        String(5188)
    ].join('');
    var rxSoftphoneFetch = null;
    var rxSoftphoneFetchFrame = null;

    function getRxSoftphoneFetch() {
        if (rxSoftphoneFetch) return rxSoftphoneFetch;

        // FortiGate also injects sslvpn.js, which replaces window.fetch and
        // redirects runtime loopback requests through the VPN web proxy. A
        // dynamically-created same-origin frame has its own native fetch realm
        // and therefore reaches only the fixed desktop loopback API below.
        var frame = document.createElement('iframe');
        frame.hidden = true;
        frame.tabIndex = -1;
        frame.setAttribute('aria-hidden', 'true');
        frame.setAttribute('title', 'RX Softphone local connection');
        (document.body || document.documentElement).appendChild(frame);

        var frameWindow = frame.contentWindow;
        if (!frameWindow || typeof frameWindow.fetch !== 'function') {
            frame.remove();
            throw new Error('The browser could not create a direct local softphone connection.');
        }
        rxSoftphoneFetchFrame = frame;
        rxSoftphoneFetch = frameWindow.fetch.bind(frameWindow);
        return rxSoftphoneFetch;
    }
    var rxPhone = {
        reachable: false,
        snapshot: null,
        probePromise: null,
        monitorTimer: null,
        loopbackPermission: 'unknown',
        account: null,
        accountLoaded: false,
        accountPromise: null,
        registrationPromise: null,
        autoRegistrationAttempted: false,
        suppressAutoRegistration: false,
        savingAccount: false,
        activeCall: null,
        transport: null,
        relayStatus: null,
        relayPromise: null,
        localFailures: 0,
        reconciledCallId: '',
        acknowledgements: {},
        callClients: {}
    };

    var state = {
        page: 1,
        pageSize: 10,
        total: 0,
        totalPages: 1,
        activityTotal: null,
        activityLabel: '',
        q: '',
        view: 'queue',
        activeCard: 'queue',
        sort: '',
        dir: 'asc',
        eligibilityCutoff: '',
        phoneClient: 'microsip'
    };

    var cardTitles = {
        queue: 'New Call Queue',
        calls: 'Calls This Login',
        patients: 'Patients Called This Login',
        dates: 'Service Dates This Login',
        efficiency: 'Service Dates Behind Efficiency'
    };

    var cardSubtitles = {
        queue: 'Patients ready for the next call.',
        calls: 'Call records from this login, grouped by patient. Repeat calls appear in Call Dates.',
        patients: 'Unique patients called during this login.',
        dates: 'Patients where a new service date was entered during this login.',
        efficiency: 'Patients with service dates entered during this login. Efficiency is service dates divided by calls.'
    };

    function esc(value) {
        return String(value === undefined || value === null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function normalizeDialNumber(value) {
        var raw = String(value === undefined || value === null ? '' : value).trim();
        if (!raw) return '';
        var digits = raw.replace(/\D/g, '');
        if (!digits) return '';
        return raw.charAt(0) === '+' ? ('+' + digits) : digits;
    }

    function normalizePhoneClient(value) {
        return ['microsip', 'rx_softphone', 'auto'].indexOf(value) !== -1 ? value : 'microsip';
    }

    function phoneClientLabel() {
        if (state.phoneClient === 'rx_softphone') return 'RX Softphone';
        if (state.phoneClient === 'auto') return 'RX Softphone or MicroSIP';
        return 'MicroSIP';
    }

    function renderPhone(row, canUpdate) {
        var phone = String(row.phone || '').trim();
        var dialNumber = normalizeDialNumber(phone);
        var phoneHtml = '<span class="cc-phone">' + esc(phone || '--') + '</span>';
        if (!dialNumber) return '<div class="cc-phone-wrap">' + phoneHtml + '</div>';

        if (!canUpdate) {
            return '<div class="cc-phone-wrap">' + phoneHtml +
                '<span class="cc-call-link disabled" title="Calling is unavailable because this patient is no longer in the active call queue" aria-hidden="true">' +
                    '<i class="fas fa-phone-alt"></i>' +
                '</span>' +
            '</div>';
        }

        var label = 'Call ' + (phone || dialNumber) + ' with ' + phoneClientLabel();
        return '<div class="cc-phone-wrap">' + phoneHtml +
            '<span class="cc-phone-action-stack">' +
                '<a class="cc-call-link" data-action="phone-call" data-patient-id="' + esc(row.id) + '" data-dial-number="' + esc(dialNumber) + '" href="callto:' + esc(dialNumber) + '"' +
                    ' data-call-label="' + esc(label) + '" title="' + esc(label) + '" aria-label="' + esc(label) + '">' +
                    '<i class="fas fa-phone-alt" aria-hidden="true"></i>' +
                    '<span class="cc-cooldown-countdown" aria-hidden="true"></span>' +
                '</a>' +
                '<button type="button" class="cc-row-hangup d-none" data-action="phone-hangup" data-patient-id="' + esc(row.id) + '" title="Hang up this call" aria-label="Hang up this call">' +
                    '<i class="fas fa-phone-slash" aria-hidden="true"></i>' +
                '</button>' +
            '</span>' +
            '<small class="cc-phone-lock-status" data-lock-label-for="' + esc(row.id) + '" aria-live="polite"></small>' +
        '</div>';
    }

    function displayedPatientIds() {
        var links = document.querySelectorAll('[data-action="phone-call"][data-patient-id]');
        var ids = [];
        for (var i = 0; i < links.length; i++) {
            var id = parseInt(links[i].getAttribute('data-patient-id'), 10);
            if (Number.isFinite(id) && ids.indexOf(id) === -1) ids.push(id);
        }
        return ids;
    }

    function formatConnectedDuration(seconds) {
        var total = Math.max(0, Math.floor(Number(seconds) || 0));
        var hours = Math.floor(total / 3600);
        var minutes = Math.floor((total % 3600) / 60);
        var remainder = total % 60;
        if (hours) {
            return hours + ':' + String(minutes).padStart(2, '0') + ':' + String(remainder).padStart(2, '0');
        }
        return minutes + ':' + String(remainder).padStart(2, '0');
    }

    function connectedAtForStatus(status, patientId) {
        var connectedAt = status && status.connectedAt ? status.connectedAt : null;
        var snapshot = rxPhone.snapshot || {};
        if (!connectedAt
            && status && status.mine
            && rxPhone.activeCall
            && String(rxPhone.activeCall.patientId) === String(patientId)
            && snapshot.call === 'connected') {
            connectedAt = snapshot.connectedAt || null;
        }
        var startedMs = connectedAt ? new Date(connectedAt).getTime() : NaN;
        return Number.isFinite(startedMs) ? startedMs : null;
    }

    function sharedCallStateLabel(value) {
        var callState = String(value || '').trim().toLowerCase();
        var labels = {
            dialing: 'Dialing',
            trying: 'Trying',
            ringing: 'Ringing',
            answering: 'Answering',
            connected: 'Connected',
            incoming: 'Incoming call'
        };
        return labels[callState] || 'Call active';
    }

    function applyPhoneAvailability(statuses) {
        var statusByPatient = {};
        for (var i = 0; i < (statuses || []).length; i++) {
            var item = statuses[i] || {};
            statusByPatient[String(item.patientId)] = item;
        }

        var links = document.querySelectorAll('[data-action="phone-call"][data-patient-id]');
        for (var j = 0; j < links.length; j++) {
            var link = links[j];
            var patientId = link.getAttribute('data-patient-id');
            var status = statusByPatient[patientId] || { status: 'available' };
            var stateName = status.status === 'active' || status.status === 'cooldown'
                ? status.status
                : 'available';
            var owner = status.mine ? 'You' : (status.user || 'Another user');
            var baseLabel = link.getAttribute('data-call-label') || 'Call patient';
            var label = link.closest('.cc-phone-wrap').querySelector('[data-lock-label-for="' + patientId + '"]');
            var countdown = link.querySelector('.cc-cooldown-countdown');

            link.classList.remove('cc-availability-active', 'cc-availability-cooldown');
            link.setAttribute('data-lock-status', stateName);
            link.removeAttribute('aria-disabled');
            link.removeAttribute('data-lock-message');
            if (label) {
                label.className = 'cc-phone-lock-status';
                label.textContent = '';
                label.title = '';
            }
            if (countdown) {
                countdown.classList.remove('visible', 'connected');
                countdown.textContent = '';
                countdown.title = '';
            }

            if (stateName === 'active') {
                var sharedState = sharedCallStateLabel(status.callState);
                var connectedAtMs = connectedAtForStatus(status, patientId);
                var connectedSeconds = connectedAtMs === null
                    ? null
                    : Math.max(0, Math.floor((Date.now() - connectedAtMs) / 1000));
                var connectedDuration = connectedSeconds === null ? '' : formatConnectedDuration(connectedSeconds);
                var activeMessage = 'In use by ' + owner + ' · ' + sharedState + (connectedDuration ? ' ' + connectedDuration : '');
                link.classList.add('cc-availability-active');
                link.setAttribute('aria-disabled', 'true');
                link.setAttribute('data-lock-message', activeMessage);
                link.title = activeMessage;
                link.setAttribute('aria-label', activeMessage);
                if (label) {
                    label.classList.add('visible', 'active');
                    label.textContent = activeMessage;
                    label.title = activeMessage;
                }
                if (countdown && connectedDuration) {
                    countdown.textContent = connectedDuration;
                    countdown.title = 'Connected for ' + connectedDuration;
                    countdown.classList.add('visible', 'connected');
                }
            } else if (stateName === 'cooldown') {
                var seconds = Math.max(0, Number(status.secondsRemaining) || 0);
                var cooldownMessage = 'Cooldown: ' + owner + (seconds ? ' · ' + seconds + 's' : '');
                link.classList.add('cc-availability-cooldown');
                link.setAttribute('aria-disabled', 'true');
                link.setAttribute('data-lock-message', cooldownMessage);
                link.title = cooldownMessage;
                link.setAttribute('aria-label', cooldownMessage);
                if (label) {
                    label.classList.add('visible', 'cooldown');
                    label.textContent = cooldownMessage;
                    label.title = cooldownMessage;
                }
                if (countdown && seconds) {
                    countdown.textContent = String(seconds);
                    countdown.classList.add('visible');
                }
            } else {
                link.title = baseLabel;
                link.setAttribute('aria-label', baseLabel);
            }
        }
    }

    async function refreshPhoneAvailability() {
        var patientIds = displayedPatientIds();
        if (!patientIds.length || lockStatusPromise) return lockStatusPromise;
        lockStatusPromise = fetchWithAuth(api.lockStatus + '?patientIds=' + encodeURIComponent(patientIds.join(',')), { silent: true })
            .then(async function(res) {
                if (!res || !res.ok) return;
                var data = await res.json();
                applyPhoneAvailability(data.statuses || []);
            })
            .catch(function() {})
            .finally(function() { lockStatusPromise = null; });
        return lockStatusPromise;
    }

    function setText(id, value) {
        var el = document.getElementById(id);
        if (el) el.textContent = value;
    }

    function toast(message, type) {
        if (typeof showToast === 'function') showToast(message, type || 'info');
    }

    async function createRelayPairingCode(button) {
        var code = document.getElementById('ccRelayPairingCode');
        var expiry = document.getElementById('ccRelayPairingExpiry');
        var original = button && button.innerHTML;
        if (button) {
            button.disabled = true;
            button.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Generating';
        }
        if (code) code.textContent = '--------';
        if (expiry) expiry.textContent = 'Creating a secure one-time code...';
        try {
            var response = await fetchWithAuth(api.relayPairing, { method: 'POST', body: '{}' });
            var data = response ? await response.json().catch(function() { return {}; }) : {};
            if (!response || !response.ok) throw new Error(data.error || data.message || 'Could not generate a pairing code.');
            if (code) code.textContent = data.pairingCode || '--------';
            if (expiry) expiry.textContent = 'Expires in 10 minutes and can be used once.';
        } catch (err) {
            if (expiry) expiry.textContent = (err && err.message) || 'Could not generate a pairing code.';
            toast((err && err.message) || 'Could not generate a pairing code.', 'danger');
        } finally {
            if (button) {
                button.disabled = false;
                button.innerHTML = original;
            }
        }
    }

    async function rxFetch(path, options) {
        var requestOptions = Object.assign({}, options || {});
        var timeoutMs = Number(requestOptions.timeoutMs) || 2500;
        delete requestOptions.timeoutMs;
        var controller = typeof AbortController === 'function' ? new AbortController() : null;
        var timeout = controller ? setTimeout(function() { controller.abort(); }, timeoutMs) : null;
        var fetchOptions = Object.assign({
            mode: 'cors',
            cache: 'no-store',
            targetAddressSpace: 'loopback'
        }, requestOptions);
        if (controller) fetchOptions.signal = controller.signal;
        if (fetchOptions.body) {
            fetchOptions.headers = Object.assign({ 'Content-Type': 'application/json' }, fetchOptions.headers || {});
        }
        try {
            var response = await getRxSoftphoneFetch()(rxSoftphoneBaseUrl + path, fetchOptions);
            var data = await response.json().catch(function() { return {}; });
            if (!response.ok) {
                var error = new Error((data && (data.error || data.detail || data.title)) || 'RX Softphone request failed.');
                error.status = response.status;
                throw error;
            }
            return data;
        } finally {
            if (timeout) clearTimeout(timeout);
        }
    }

    function isRxCallActive(snapshot) {
        var callState = snapshot && snapshot.call ? snapshot.call : 'idle';
        return ['dialing', 'trying', 'ringing', 'answering', 'connected', 'incoming'].indexOf(callState) !== -1;
    }

    function renderPhoneClientStatus() {
        var badge = document.getElementById('ccPhoneClientStatus');
        var setup = document.getElementById('ccPhoneSetupBtn');
        var help = document.getElementById('ccSoftphoneHelp');
        if (!badge) return;

        badge.classList.remove('online', 'calling', 'fallback');
        if (state.phoneClient === 'microsip') {
            badge.innerHTML = '<i class="fas fa-phone-alt"></i> MicroSIP';
            if (help) help.textContent = 'Calls open in MicroSIP. After the call, mark Called and Save.';
        } else if (rxPhone.reachable && rxPhone.snapshot && rxPhone.snapshot.registration === 'registered') {
            var callState = rxPhone.snapshot.call || 'idle';
            if (isRxCallActive(rxPhone.snapshot)) {
                badge.classList.add('calling');
                badge.innerHTML = '<i class="fas fa-phone-volume"></i> RX' + (rxPhone.transport === 'relay' ? ' Relay' : '') + ': ' + esc(callState);
            } else {
                badge.classList.add('online');
                badge.innerHTML = '<i class="fas fa-check-circle"></i> RX Softphone ready' + (rxPhone.transport === 'relay' ? ' via relay' : '');
            }
            if (help) help.textContent = (rxPhone.transport === 'relay'
                ? 'The paired Windows RX Softphone is connected through the outbound relay. Audio remains on that Windows PC. '
                : '') + 'RX Softphone records attempts and answered calls automatically. Save is only for a note or new service date.';
        } else if (state.phoneClient === 'auto') {
            badge.classList.add('fallback');
            badge.innerHTML = '<i class="fas fa-random"></i> MicroSIP fallback';
            if (help) help.textContent = 'RX Softphone is not registered, so calls will open in MicroSIP.';
        } else {
            badge.classList.add('fallback');
            badge.innerHTML = '<i class="fas fa-exclamation-triangle"></i> RX Softphone offline';
            if (help) help.textContent = rxPhone.reachable
                ? 'Open RX Softphone and register it to the PBX before calling.'
                : 'RX Softphone must run on the same computer as this browser. Remote browsers such as Kasm cannot use a softphone running on your Windows PC.';
        }

        var relayPair = document.getElementById('ccRelayPairBtn');
        if (relayPair) relayPair.classList.toggle('d-none', state.phoneClient === 'microsip');

        var activePatientId = rxPhone.activeCall && isRxCallActive(rxPhone.snapshot)
            ? String(rxPhone.activeCall.patientId)
            : '';
        var rowHangups = document.querySelectorAll('.cc-row-hangup');
        for (var i = 0; i < rowHangups.length; i++) {
            var rowHangup = rowHangups[i];
            var isActivePatient = rxPhone.reachable
                && activePatientId
                && rowHangup.getAttribute('data-patient-id') === activePatientId;
            rowHangup.classList.toggle('d-none', !isActivePatient);
            if (!isActivePatient) rowHangup.disabled = false;
        }
        if (setup) {
            var registered = !!(rxPhone.snapshot && rxPhone.snapshot.registration === 'registered');
            setup.classList.toggle('d-none', state.phoneClient === 'microsip');
            setup.innerHTML = registered
                ? '<i class="fas fa-user-cog me-1"></i>Phone account'
                : '<i class="fas fa-plug me-1"></i>Register phone';
        }
        renderRegistrationFormState();
    }

    function setRegistrationMessage(message, type) {
        var el = document.getElementById('ccPhoneRegistrationMessage');
        if (!el) return;
        el.className = 'alert cc-registration-message alert-' + (type || 'secondary');
        el.textContent = message;
    }

    function populateRegistrationForm(account, snapshot) {
        var accountResponse = account || {};
        var canManage = accountResponse.canManage === true;
        account = account && account.configured ? account : {};
        var values = {
            server: account.server || (snapshot && snapshot.server) || '192.168.15.200',
            port: account.port || (snapshot && snapshot.port) || 5060,
            username: account.username || (snapshot && snapshot.username) || '',
            displayName: account.displayName || (snapshot && snapshot.displayName) || (snapshot && snapshot.username) || '',
            localSipPort: account.localSipPort === undefined ? 0 : account.localSipPort
        };
        var fields = {
            ccSipServer: values.server,
            ccSipPort: values.port,
            ccSipUsername: values.username,
            ccSipDisplayName: values.displayName,
            ccSipLocalPort: values.localSipPort
        };
        Object.keys(fields).forEach(function(id) {
            var input = document.getElementById(id);
            if (input) input.value = fields[id];
        });
        var password = document.getElementById('ccSipPassword');
        if (password) {
            password.value = '';
            password.required = canManage && !account.passwordConfigured;
            password.placeholder = account.passwordConfigured ? 'Leave blank to keep the saved password' : 'Required for first setup';
        }
        var adminPinGroup = document.getElementById('ccSipAdminPinGroup');
        var adminPin = document.getElementById('ccSipAdminPin');
        var pinRequired = canManage && accountResponse.adminPinRequired === true;
        if (adminPinGroup) adminPinGroup.hidden = !pinRequired;
        if (adminPin) {
            adminPin.value = '';
            adminPin.required = pinRequired;
        }
    }

    async function readResponseBody(response) {
        return response ? response.clone().json().catch(function() { return {}; }) : {};
    }

    async function loadPhoneAccount(force) {
        if (rxPhone.accountPromise) return rxPhone.accountPromise;
        if (rxPhone.accountLoaded && !force) return rxPhone.account;
        rxPhone.accountPromise = fetchWithAuth(api.phoneAccount, { silent: true })
            .then(async function(response) {
                var data = await readResponseBody(response);
                if (!response || !response.ok) {
                    throw new Error(data.error || data.message || 'Could not load the assigned softphone account.');
                }
                rxPhone.account = data;
                rxPhone.accountLoaded = true;
                renderRegistrationFormState();
                return data;
            })
            .catch(function(err) {
                rxPhone.accountLoaded = false;
                setRegistrationMessage((err && err.message) || 'Could not load the assigned softphone account.', 'danger');
                return null;
            })
            .finally(function() {
                rxPhone.accountPromise = null;
            });
        return rxPhone.accountPromise;
    }

    function renderRegistrationFormState() {
        var modal = document.getElementById('ccPhoneSetupModal');
        if (!modal) return;
        var account = rxPhone.account;
        var snapshot = rxPhone.snapshot;
        var registration = snapshot && snapshot.registration ? snapshot.registration : 'offline';
        var busy = rxPhone.savingAccount || !!rxPhone.registrationPromise;
        var canManage = !!(account && account.canManage === true);
        ['ccSipServer', 'ccSipPort', 'ccSipUsername', 'ccSipDisplayName', 'ccSipPassword', 'ccSipLocalPort', 'ccSipAdminPin'].forEach(function(id) {
            var input = document.getElementById(id);
            if (input) input.disabled = busy || !canManage;
        });

        var registerButton = document.getElementById('ccPhoneRegisterBtn');
        var unregisterButton = document.getElementById('ccPhoneUnregisterBtn');
        var password = document.getElementById('ccSipPassword');
        var adminPin = document.getElementById('ccSipAdminPin');
        var pinRequired = canManage && !!(account && account.adminPinRequired);
        if (password) {
            password.required = canManage && !(account && account.passwordConfigured);
            password.placeholder = account && account.passwordConfigured
                ? 'Leave blank to keep the saved password'
                : 'Required for first setup';
        }
        if (adminPin) adminPin.required = pinRequired;
        if (registerButton) {
            registerButton.disabled = busy || !canManage;
            registerButton.classList.toggle('d-none', !canManage);
        }
        var passwordToggle = document.getElementById('ccSipPasswordToggle');
        if (passwordToggle) passwordToggle.disabled = busy || !canManage;
        if (unregisterButton) unregisterButton.disabled = busy || !rxPhone.reachable || registration === 'offline';

        if (!rxPhone.accountLoaded) {
            setRegistrationMessage('Loading the softphone account assigned to your RX user.', 'secondary');
        } else if (!canManage && account && account.configured && registration === 'registered') {
            setRegistrationMessage('Connected as extension ' + (snapshot.username || '') + '. Phone settings are read-only and managed by an Administrator.', 'success');
        } else if (!canManage && account && account.configured) {
            setRegistrationMessage('Phone settings are read-only and managed by an Administrator. This account will connect automatically when RX Softphone is available.', 'info');
        } else if (!canManage) {
            setRegistrationMessage('No phone account is assigned. Contact an Administrator; Call Center users cannot create or change phone settings.', 'warning');
        } else if (!account || !account.configured) {
            setRegistrationMessage('No softphone account is assigned to your RX user. Enter the SIP account once, then Save & Connect.', 'warning');
        } else if (!rxPhone.reachable) {
            setRegistrationMessage('Account saved on the server. Start RX Softphone 0.3.0 or later on this workstation; it will connect when Call Center loads.', 'warning');
        } else if (registration === 'registered') {
            setRegistrationMessage('Connected as extension ' + (snapshot.username || '') + ' to ' + (snapshot.server || '') + ':' + (snapshot.port || 5060) + '. The server assignment remains editable.', 'success');
        } else if (registration === 'registering') {
            setRegistrationMessage('Sending the SIP registration to the PBX.', 'info');
        } else if (registration === 'retrying') {
            setRegistrationMessage('Registration did not complete. RX Softphone is retrying; review the account or PBX connection.', 'warning');
        } else if (registration === 'failed') {
            setRegistrationMessage('Registration failed. Verify the extension, password, PBX address, and port, then try again.', 'danger');
        } else {
            setRegistrationMessage('The account is saved on the server but this workstation is disconnected. Select Save & Connect, or reload Call Center to connect automatically.', 'secondary');
        }
    }

    async function connectAssignedPhone(force, notifyUser) {
        if (state.phoneClient === 'microsip') return null;
        if (rxPhone.transport === 'relay') return rxPhone.snapshot;
        if (rxPhone.registrationPromise) return rxPhone.registrationPromise;
        if (rxPhone.suppressAutoRegistration && !force) return rxPhone.snapshot;
        if (rxPhone.autoRegistrationAttempted && !force) return rxPhone.snapshot;
        rxPhone.autoRegistrationAttempted = true;
        if (force) rxPhone.suppressAutoRegistration = false;

        rxPhone.registrationPromise = (async function() {
            var account = await loadPhoneAccount(false);
            if (!account || !account.configured || account.isEnabled === false) {
                if (account && account.isEnabled === false) {
                    var disabledSnapshot = await probeRxPhone();
                    if (disabledSnapshot && disabledSnapshot.registration !== 'offline' && disabledSnapshot.registration !== 'unregistered') {
                        disabledSnapshot = await rxFetch('/api/unregister', { method: 'POST', body: '{}' });
                        handleRxSnapshot(disabledSnapshot);
                    }
                }
                renderRegistrationFormState();
                return rxPhone.snapshot;
            }

            var snapshot = await probeRxPhone();
            if (!snapshot) return null;
            var sameAccount = snapshot.registration === 'registered'
                && String(snapshot.server || '').toLowerCase() === String(account.server || '').toLowerCase()
                && Number(snapshot.port || 5060) === Number(account.port || 5060)
                && String(snapshot.username || '') === String(account.username || '');
            if (sameAccount && !force) return snapshot;

            var response = await fetchWithAuth(api.phoneRegistration, {
                method: 'POST',
                body: '{}',
                silent: true
            });
            var registration = await readResponseBody(response);
            if (!response || !response.ok) {
                throw new Error(registration.error || registration.message || 'Could not load the assigned softphone registration.');
            }
            if (!registration.configured) return snapshot;

            var localRequestBody = JSON.stringify({
                server: registration.server,
                port: registration.port,
                username: registration.username,
                password: registration.password,
                displayName: registration.displayName || registration.username,
                localSipPort: registration.localSipPort || 0
            });
            registration.password = '';
            snapshot = await rxFetch('/api/register', { method: 'POST', body: localRequestBody });
            localRequestBody = '';
            rxPhone.reachable = true;
            handleRxSnapshot(snapshot);
            if (notifyUser) toast('RX Softphone account saved and connection started.', 'success');
            setTimeout(probeRxPhone, 800);
            return snapshot;
        })().catch(function(err) {
            setRegistrationMessage((err && err.message) || 'Could not connect RX Softphone.', 'danger');
            if (notifyUser) toast((err && err.message) || 'Could not connect RX Softphone.', 'danger');
            return null;
        }).finally(function() {
            rxPhone.registrationPromise = null;
            renderRegistrationFormState();
        });
        renderRegistrationFormState();
        return rxPhone.registrationPromise;
    }

    async function saveRxPhoneAccount(form, button) {
        if (!form.reportValidity()) return;
        var account = {
            server: document.getElementById('ccSipServer').value.trim(),
            port: Number(document.getElementById('ccSipPort').value),
            username: document.getElementById('ccSipUsername').value.trim(),
            displayName: document.getElementById('ccSipDisplayName').value.trim(),
            localSipPort: Number(document.getElementById('ccSipLocalPort').value || 0)
        };
        var passwordInput = document.getElementById('ccSipPassword');
        var adminPinInput = document.getElementById('ccSipAdminPin');
        account.password = passwordInput ? passwordInput.value : '';
        account.adminPin = adminPinInput ? adminPinInput.value : '';
        var oldHtml = button.innerHTML;
        rxPhone.savingAccount = true;
        button.disabled = true;
        button.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Saving';
        try {
            var savePromise = fetchWithAuth(api.phoneAccount, {
                method: 'PUT',
                body: JSON.stringify(account)
            });
            account.password = '';
            account.adminPin = '';
            if (passwordInput) passwordInput.value = '';
            if (adminPinInput) adminPinInput.value = '';
            var response = await savePromise;
            var data = await readResponseBody(response);
            if (!response || !response.ok) {
                throw new Error(data.error || data.message || 'Could not save the softphone account.');
            }
            rxPhone.account = data.account;
            rxPhone.accountLoaded = true;
            populateRegistrationForm(rxPhone.account, rxPhone.snapshot);
            rxPhone.savingAccount = false;
            await connectAssignedPhone(true, true);
        } catch (err) {
            setRegistrationMessage((err && err.message) || 'Could not save the softphone account.', 'danger');
            toast((err && err.message) || 'Could not save the softphone account.', 'danger');
        } finally {
            rxPhone.savingAccount = false;
            account.password = '';
            account.adminPin = '';
            if (adminPinInput) adminPinInput.value = '';
            button.innerHTML = oldHtml;
            renderRegistrationFormState();
        }
    }

    async function unregisterRxPhone(button) {
        if (isRxCallActive(rxPhone.snapshot) && !window.confirm('End the active call and unregister RX Softphone?')) return;
        var oldHtml = button.innerHTML;
        button.disabled = true;
        button.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Unregistering';
        try {
            var snapshot = await rxFetch('/api/unregister', { method: 'POST', body: '{}' });
            var password = document.getElementById('ccSipPassword');
            if (password) password.value = '';
            rxPhone.reachable = true;
            rxPhone.suppressAutoRegistration = true;
            handleRxSnapshot(snapshot);
            populateRegistrationForm(rxPhone.account, snapshot);
            toast('RX Softphone disconnected on this PC. It will reconnect the next time Call Center loads.', 'info');
        } catch (err) {
            setRegistrationMessage((err && err.message) || 'Could not unregister RX Softphone.', 'danger');
        } finally {
            button.innerHTML = oldHtml;
            renderRegistrationFormState();
        }
    }

    function markAnsweredCall(patientId, attempt) {
        var key = String(patientId);
        var previousAcknowledgement = rxPhone.acknowledgements[key];
        var attemptId = attempt && attempt.id;
        var isNewAttempt = !previousAcknowledgement || (
            attemptId && String(previousAcknowledgement.attemptId || '') !== String(attemptId)
        );
        if (isNewAttempt) {
            rxPhone.acknowledgements[key] = {
                phoneClient: 'rx_softphone',
                answeredAt: (attempt && attempt.answeredAt) || new Date().toISOString(),
                endedAt: attempt && attempt.endedAt || null,
                durationSeconds: attempt && attempt.conversationDurationSeconds,
                autoRecorded: true,
                attemptId: attempt && attempt.id
            };
            toast('Answered call recorded automatically. Save is needed only for a note or new service date.', 'success');
            loadMetrics();
        } else if (attempt) {
            previousAcknowledgement.endedAt = attempt.endedAt || previousAcknowledgement.endedAt;
            previousAcknowledgement.durationSeconds = attempt.conversationDurationSeconds;
        }

        var row = document.querySelector('tr[data-id="' + key.replace(/"/g, '') + '"]');
        var checkbox = row ? row.querySelector('.cc-called') : null;
        var wrap = row ? row.querySelector('.cc-called-wrap') : null;
        if (checkbox) {
            checkbox.checked = true;
            checkbox.disabled = true;
        }
        if (wrap) {
            wrap.classList.add('rx-answered');
            wrap.title = 'Answered and recorded automatically through RX Softphone';
        }
    }

    function snapshotAttemptPayload(snapshot) {
        var callState = snapshot && snapshot.call ? snapshot.call : 'idle';
        return {
            state: callState === 'idle' ? 'ended' : callState,
            ringingAt: snapshot && snapshot.ringingAt || null,
            answeredAt: snapshot && snapshot.connectedAt || null,
            endedAt: snapshot && snapshot.endedAt || null,
            outcome: snapshot && snapshot.outcome || null,
            sipResponseCode: snapshot && snapshot.sipResponseCode || null,
            sipReason: snapshot && snapshot.sipReason || null
        };
    }

    async function updateAttemptRecord(active, snapshot) {
        if (!active || !active.attemptId) return null;
        var response = await fetchWithAuth(api.callAttempts + '/' + encodeURIComponent(active.attemptId), {
            method: 'PATCH',
            body: JSON.stringify(snapshotAttemptPayload(snapshot))
        });
        var data = response ? await response.json().catch(function() { return {}; }) : {};
        if (!response || !response.ok) throw new Error(data.error || data.message || 'Could not update the call record.');
        return data;
    }

    function finalizeActiveCall(active) {
        var link = document.querySelector('[data-action="phone-call"][data-patient-id="' + String(active.patientId) + '"]');
        if (link) link.classList.remove('is-calling');
        lockedPatientIds = lockedPatientIds.filter(function(patientId) {
            return String(patientId) !== String(active.patientId);
        });
        if (rxPhone.activeCall === active) rxPhone.activeCall = null;
        renderPhoneClientStatus();
    }

    function syncActiveAttempt(snapshot) {
        var active = rxPhone.activeCall;
        if (!active || !active.attemptId) return;
        var payload = snapshotAttemptPayload(snapshot);
        if (['dialing', 'trying', 'ringing', 'connected', 'ended', 'failed'].indexOf(payload.state) === -1) return;
        var signature = JSON.stringify(payload);
        active.syncSignatures = active.syncSignatures || {};
        if (active.syncSignatures[signature] || signature === active.syncedSignature) return;
        active.syncSignatures[signature] = true;
        active.syncChain = (active.syncChain || Promise.resolve()).then(async function() {
            var data = await updateAttemptRecord(active, snapshot);
            active.syncedSignature = signature;
            var attempt = data && data.attempt;
            if (attempt && attempt.calledRecorded) {
                active.answered = true;
                markAnsweredCall(active.patientId, attempt);
            }
            if (payload.state === 'ended' || payload.state === 'failed') finalizeActiveCall(active);
        }).catch(function(err) {
            delete active.syncSignatures[signature];
            toast((err && err.message) || 'The call happened, but its analytics update will retry.', 'danger');
        });
    }

    async function reconcileRxAttempt(snapshot) {
        var callId = snapshot && snapshot.callId ? String(snapshot.callId) : '';
        if (!callId || rxPhone.activeCall || rxPhone.reconciledCallId === callId) return;
        rxPhone.reconciledCallId = callId;
        try {
            var response = await fetchWithAuth(api.callAttempts + '/by-correlation/' + encodeURIComponent(callId), { silent: true });
            if (!response || !response.ok) return;
            var data = await response.json();
            var attempt = data && data.attempt;
            if (!attempt) return;
            rxPhone.activeCall = {
                patientId: attempt.patientId,
                dialNumber: attempt.dialedNumber,
                attemptId: attempt.id,
                correlationId: attempt.correlationId,
                answered: !!attempt.answeredAt,
                lastState: attempt.state || 'dialing',
                syncedSignature: ''
            };
            syncActiveAttempt(snapshot);
            renderPhoneClientStatus();
        } catch (_) {}
    }

    function handleRxSnapshot(snapshot) {
        rxPhone.snapshot = snapshot || null;
        var active = rxPhone.activeCall;
        var callState = snapshot && snapshot.call ? snapshot.call : 'idle';
        if (active) {
            active.lastState = callState;
            syncActiveAttempt(snapshot);
        } else if (snapshot && snapshot.callId) {
            reconcileRxAttempt(snapshot);
        }
        renderPhoneClientStatus();
    }

    async function probeRxPhone() {
        if (state.phoneClient === 'microsip') return null;
        if (rxPhone.probePromise) return rxPhone.probePromise;
        var wasReachable = rxPhone.reachable;
        rxPhone.probePromise = rxFetch('/api/status')
            .then(function(snapshot) {
                rxPhone.reachable = true;
                rxPhone.transport = 'local';
                rxPhone.localFailures = 0;
                handleRxSnapshot(snapshot);
                if (!wasReachable
                    && rxPhone.autoRegistrationAttempted
                    && !rxPhone.suppressAutoRegistration
                    && !rxPhone.registrationPromise
                    && rxPhone.account
                    && rxPhone.account.configured
                    && snapshot.registration !== 'registered') {
                    rxPhone.autoRegistrationAttempted = false;
                    setTimeout(function() { connectAssignedPhone(false, false); }, 0);
                }
                return snapshot;
            })
            .catch(function() {
                rxPhone.localFailures += 1;
                return probeRelayPhone().then(function(snapshot) {
                    var windowsBrowser = /Windows/i.test(String(navigator.userAgent || ''));
                    if (snapshot || (rxPhone.localFailures >= 2 && !windowsBrowser)) switchRxPhonePolling(true);
                    return snapshot;
                });
            })
            .finally(function() {
                rxPhone.probePromise = null;
            });
        return rxPhone.probePromise;
    }

    async function probeRelayPhone() {
        if (state.phoneClient === 'microsip') return null;
        if (rxPhone.relayPromise) return rxPhone.relayPromise;
        rxPhone.relayPromise = fetchWithAuth(api.relayStatus, { silent: true })
            .then(async function(response) {
                var data = response ? await response.json().catch(function() { return {}; }) : {};
                if (!response || !response.ok) return null;
                rxPhone.relayStatus = data;
                if (!data.online || !data.snapshot) {
                    rxPhone.reachable = false;
                    rxPhone.transport = null;
                    rxPhone.snapshot = null;
                    renderPhoneClientStatus();
                    return null;
                }
                rxPhone.reachable = true;
                rxPhone.transport = 'relay';
                handleRxSnapshot(data.snapshot);
                return data.snapshot;
            })
            .catch(function() {
                rxPhone.reachable = false;
                rxPhone.transport = null;
                rxPhone.snapshot = null;
                renderPhoneClientStatus();
                return null;
            })
            .finally(function() { rxPhone.relayPromise = null; });
        return rxPhone.relayPromise;
    }

    async function probeRxPhoneFromUserGesture() {
        try {
            // Do not reuse the background monitor promise here. Chrome requires a
            // user-initiated loopback request before it can show the local-device
            // permission prompt for a public HTTPS origin.
            var snapshot = await rxFetch('/api/status', { timeoutMs: 30000 });
            rxPhone.reachable = true;
            rxPhone.transport = 'local';
            rxPhone.localFailures = 0;
            rxPhone.loopbackPermission = 'granted';
            handleRxSnapshot(snapshot);
            switchRxPhonePolling(false);
            return snapshot;
        } catch (err) {
            return probeRelayPhone();
        }
    }

    function isPublicHttpsPage() {
        if (window.location.protocol !== 'https:') return false;
        var host = String(window.location.hostname || '').toLowerCase();
        if (host === 'localhost' || host === '::1' || /^127\./.test(host)) return false;
        if (/^10\./.test(host) || /^192\.168\./.test(host)) return false;
        var private172 = host.match(/^172\.(\d{1,3})\./);
        if (private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31) return false;
        return true;
    }

    async function readLoopbackPermission() {
        if (!isPublicHttpsPage()) return 'not-required';
        if (!navigator.permissions || typeof navigator.permissions.query !== 'function') return 'unsupported';
        try {
            var permission = await navigator.permissions.query({ name: 'loopback-network' });
            return permission && permission.state ? permission.state : 'prompt';
        } catch (_) {
            // Browsers released before the split loopback permission do not know
            // this descriptor and should continue using the existing probe path.
            return 'unsupported';
        }
    }

    function startRxPhonePolling(relayOnly) {
        if (state.phoneClient === 'microsip' || rxPhone.monitorTimer) return;
        rxPhone.monitorTimer = setInterval(relayOnly ? probeRelayPhone : probeRxPhone, relayOnly ? 2000 : 1200);
    }

    function switchRxPhonePolling(relayOnly) {
        if (rxPhone.monitorTimer) clearInterval(rxPhone.monitorTimer);
        rxPhone.monitorTimer = null;
        startRxPhonePolling(relayOnly);
    }

    async function configurePhoneMonitor() {
        if (rxPhone.monitorTimer) {
            clearInterval(rxPhone.monitorTimer);
            rxPhone.monitorTimer = null;
        }
        renderPhoneClientStatus();
        if (state.phoneClient === 'microsip') return;
        rxPhone.autoRegistrationAttempted = false;
        rxPhone.suppressAutoRegistration = false;
        rxPhone.loopbackPermission = await readLoopbackPermission();
        if (rxPhone.loopbackPermission === 'prompt' || rxPhone.loopbackPermission === 'denied') {
            // A public HTTPS page must not consume Chrome's loopback permission
            // request from an automatic poll. The phone click below supplies the
            // user gesture that Chrome can associate with its permission prompt.
            await probeRelayPhone();
            startRxPhonePolling(true);
            return;
        }
        probeRxPhone().then(function() {
            connectAssignedPhone(false, false);
        });
        startRxPhonePolling();
    }

    function openMicroSip(dialNumber, fallback, patientId) {
        if (Number.isFinite(patientId)) rxPhone.callClients[String(patientId)] = 'microsip';
        toast((fallback ? 'RX Softphone is unavailable. Opening MicroSIP with ' : 'Opening MicroSIP with ') + dialNumber + '.', fallback ? 'warning' : 'info');
        window.location.href = 'callto:' + dialNumber;
    }

    async function startPhoneCall(link) {
        if (link.getAttribute('aria-disabled') === 'true') {
            toast(link.getAttribute('data-lock-message') || 'This phone is not available yet.', 'warning');
            refreshPhoneAvailability();
            return;
        }
        var dialNumber = link.getAttribute('data-dial-number') || '';
        var patientId = parseInt(link.getAttribute('data-patient-id'), 10);
        if (!dialNumber) return;
        if (state.phoneClient === 'microsip') {
            if (!await claimRow(patientId)) return;
            openMicroSip(dialNumber, false, patientId);
            return;
        }

        if (!rxPhone.reachable) {
            toast('Connecting to RX Softphone. If Chrome asks, allow access to other apps and services on this device.', 'info');
        }
        var snapshot = rxPhone.reachable && rxPhone.snapshot
            ? rxPhone.snapshot
            : await probeRxPhoneFromUserGesture();
        if ((!snapshot || snapshot.registration !== 'registered') && rxPhone.transport !== 'relay') {
            snapshot = await connectAssignedPhone(false, false) || snapshot;
        }
        var ready = !!(snapshot && snapshot.registration === 'registered');
        if (!ready) {
            if (state.phoneClient === 'auto') {
                if (!await claimRow(patientId)) return;
                openMicroSip(dialNumber, true, patientId);
            }
            else {
                if (!snapshot) {
                    toast('RX Softphone could not be reached. If this page is inside Kasm or another remote browser, pair RX Softphone 0.4.0 on the Windows PC with this RX user. Direct local and FortiGate calling still work without the relay.', 'warning');
                } else {
                    toast('RX Softphone is not registered. Ask an Administrator to allow Phone Account Setup if the saved account must be corrected.', 'warning');
                }
            }
            return;
        }
        if (isRxCallActive(snapshot)) {
            toast('RX Softphone already has a call in progress.', 'warning');
            return;
        }
        if (!await claimRow(patientId)) return;

        link.classList.add('is-calling');
        var attempt = null;
        try {
            var attemptResponse = await fetchWithAuth(api.callAttempts, {
                method: 'POST',
                body: JSON.stringify({ patientId: patientId, dialedNumber: dialNumber })
            });
            var attemptData = attemptResponse ? await attemptResponse.json().catch(function() { return {}; }) : {};
            if (!attemptResponse || !attemptResponse.ok || !attemptData.attempt) {
                throw new Error(attemptData.error || attemptData.message || 'The call record could not be created, so the call was not placed.');
            }
            attempt = attemptData.attempt;
            rxPhone.activeCall = {
                patientId: patientId,
                dialNumber: dialNumber,
                attemptId: attempt.id,
                correlationId: attempt.correlationId,
                answered: false,
                lastState: 'dialing',
                syncedSignature: ''
            };
            var dialSnapshot;
            if (rxPhone.transport === 'relay') {
                var relayResponse = await fetchWithAuth(api.relayCalls, {
                    method: 'POST',
                    body: JSON.stringify({ attemptId: attempt.id })
                });
                var relayData = relayResponse ? await relayResponse.json().catch(function() { return {}; }) : {};
                if (!relayResponse || !relayResponse.ok) {
                    throw new Error(relayData.error || relayData.message || 'The Windows softphone did not accept the relay call.');
                }
                dialSnapshot = Object.assign({}, snapshot, {
                    call: 'dialing',
                    callId: attempt.correlationId,
                    peer: dialNumber,
                    dialedAt: attempt.dialedAt
                });
            } else {
                dialSnapshot = await rxFetch('/api/calls', {
                    method: 'POST',
                    body: JSON.stringify({ destination: dialNumber, correlationId: attempt.correlationId })
                });
            }
            rxPhone.activeCall.lastState = dialSnapshot.call || 'dialing';
            rxPhone.callClients[String(patientId)] = 'rx_softphone';
            rxPhone.reachable = true;
            handleRxSnapshot(dialSnapshot);
            toast('Calling ' + dialNumber + ' with RX Softphone' + (rxPhone.transport === 'relay' ? ' through the Windows relay.' : '.'), 'info');
        } catch (err) {
            link.classList.remove('is-calling');
            if (attempt && rxPhone.activeCall) {
                await updateAttemptRecord(rxPhone.activeCall, {
                    call: 'failed',
                    endedAt: new Date().toISOString(),
                    outcome: 'failed',
                    sipReason: (err && err.message) || 'RX Softphone could not place the call.'
                }).catch(function() {});
                rxPhone.activeCall = null;
            }
            await releasePatientLocks([patientId]);
            toast((err && err.message) || 'RX Softphone could not place the call.', 'danger');
            await probeRxPhone();
        }
    }

    async function hangupRxCall(button) {
        button.disabled = true;
        try {
            if (rxPhone.transport === 'relay') {
                var response = await fetchWithAuth(api.relayCalls + '/current', { method: 'DELETE' });
                var data = response ? await response.json().catch(function() { return {}; }) : {};
                if (!response || !response.ok) throw new Error(data.error || data.message || 'The relay could not send hangup.');
                toast('Hangup sent to the Windows RX Softphone.', 'info');
            } else {
                var snapshot = await rxFetch('/api/calls/current', { method: 'DELETE' });
                rxPhone.reachable = true;
                handleRxSnapshot(snapshot);
                toast('RX Softphone call ended.', 'info');
            }
        } catch (err) {
            toast((err && err.message) || 'Could not end the RX Softphone call.', 'danger');
        } finally {
            button.disabled = false;
        }
    }

    function fmtDateTime(value) {
        if (!value) return '';
        var d = new Date(value);
        if (isNaN(d.getTime())) return String(value);
        return d.toLocaleString([], {
            month: '2-digit',
            day: '2-digit',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit'
        });
    }

    function queryUrl() {
        var parts = [
            'page=' + encodeURIComponent(state.page),
            'pageSize=' + encodeURIComponent(state.pageSize),
            'view=' + encodeURIComponent(state.view)
        ];
        if (state.sort) {
            parts.push('sort=' + encodeURIComponent(state.sort));
            parts.push('dir=' + encodeURIComponent(state.dir));
        }
        if (state.q) parts.push('q=' + encodeURIComponent(state.q));
        return api.patients + '?' + parts.join('&');
    }

    async function releasePatientLocks(patientIds) {
        var ids = (patientIds || []).map(function(id) { return parseInt(id, 10); }).filter(function(id, index, values) {
            return Number.isFinite(id) && values.indexOf(id) === index;
        });
        if (!ids.length) return;
        lockedPatientIds = lockedPatientIds.filter(function(id) { return ids.indexOf(id) === -1; });
        try {
            await fetchWithAuth(api.lockRelease, {
                method: 'POST',
                body: JSON.stringify({ patientIds: ids }),
                silent: true
            });
        } catch (err) {}
    }

    async function releaseCurrentLocks() {
        return releasePatientLocks(lockedPatientIds.slice());
    }

    async function refreshCurrentLocks() {
        if (!lockedPatientIds.length) return;
        try {
            var res = await fetchWithAuth(api.lockRefresh, {
                method: 'POST',
                body: JSON.stringify({ patientIds: lockedPatientIds }),
                silent: true
            });
            if (!res || !res.ok) return;
            var data = await res.json();
            if (data.conflicts && data.conflicts.length) {
                for (var i = 0; i < data.conflicts.length; i++) {
                    var conflictId = parseInt(data.conflicts[i] && data.conflicts[i].patientId, 10);
                    if (Number.isFinite(conflictId)) {
                        lockedPatientIds = lockedPatientIds.filter(function(id) {
                            return id !== conflictId;
                        });
                    }
                }
                toast('One or more patients were claimed by another user. Refreshing queue.', 'warning');
                loadPatients();
            }
        } catch (err) {}
    }

    async function claimRow(id) {
        id = parseInt(id, 10);
        if (!Number.isFinite(id)) return false;
        try {
            var res = await fetchWithAuth(api.patients + '/' + encodeURIComponent(id) + '/claim', {
                method: 'POST',
                body: JSON.stringify({}),
                silent: true
            });
            if (!res) {
                toast('Could not claim patient. Please retry.', 'warning');
                return false;
            }
            var data = await res.json().catch(function() { return {}; });
            if (res && res.ok) {
                if (lockedPatientIds.indexOf(id) === -1) {
                    lockedPatientIds.push(id);
                }
                refreshPhoneAvailability();
                return true;
            }
            if (res && res.status === 401) {
                toast('Could not claim patient. Your session has expired. Please log in again.', 'warning');
                return false;
            }
            if (res && res.status === 403) {
                var deniedMessage = data && (data.error || data.message) ? (data.error || data.message) : 'Access denied.';
                toast('Could not claim patient. ' + deniedMessage + '.', 'warning');
                return false;
            }
            lockedPatientIds = lockedPatientIds.filter(function(patientId) {
                return patientId !== id;
            });
            var lock = data && data.lock ? (' by ' + (data.lock.user || 'another user')) : '';
            var claimError = data && (data.error || data.message) ? (data.error || data.message) : 'This patient is already claimed';
            toast(claimError + lock + '.', 'warning');
            refreshPhoneAvailability();
            return false;
        } catch (err) {
            toast('Could not claim patient. Try refreshing.', 'warning');
            return false;
        }
    }

    async function loadMetrics() {
        var res = await fetchWithAuth(api.metrics, { silent: true });
        if (!res || !res.ok) return;
        var data = await res.json();
        var totals = data.totals || {};
        serviceWindowDays = Number(data.serviceWindowDays) || serviceWindowDays;
        callCenterLeadDays = Number(data.callCenterLeadDays) || 0;
        state.eligibilityCutoff = data.eligibilityCutoff || state.eligibilityCutoff;
        setText('ccEligibleWindowLabel', 'Calling from day ' + (serviceWindowDays - callCenterLeadDays) + ' · Service eligible day ' + serviceWindowDays);
        setText('ccMetricEligible', data.eligibleTotal || 0);
        setText('ccMetricCalls', totals.calls || 0);
        setText('ccMetricUnique', totals.uniquePatientsCalled || 0);
        setText('ccMetricDates', totals.serviceDates || 0);
        setText('ccMetricEfficiency', (totals.efficiency || 0) + '%');
    }

    async function loadPatients() {
        var tbody = document.getElementById('ccPatientRows');
        if (tbody) {
            tbody.innerHTML = '<tr><td class="text-center text-muted py-4"><i class="fas fa-spinner fa-spin me-2"></i>Loading</td></tr>';
        }
        var res = await fetchWithAuth(queryUrl());
        if (!res || !res.ok) {
            if (tbody) tbody.innerHTML = '<tr><td class="text-center text-muted py-4">No access</td></tr>';
            return;
        }
        var data = await res.json();
        serviceWindowDays = Number(data.serviceWindowDays) || serviceWindowDays;
        callCenterLeadDays = Number(data.callCenterLeadDays) || 0;
        var previousPhoneClient = state.phoneClient;
        state.phoneClient = normalizePhoneClient(data.phoneClient);
        if (previousPhoneClient !== state.phoneClient || !rxPhone.monitorTimer) configurePhoneMonitor();
        state.eligibilityCutoff = data.eligibilityCutoff || state.eligibilityCutoff;
        setText('ccEligibleWindowLabel', 'Calling from day ' + (serviceWindowDays - callCenterLeadDays) + ' · Service eligible day ' + serviceWindowDays);
        state.page = data.page || 1;
        state.pageSize = data.pageSize || state.pageSize;
        var pageSizeControl = document.getElementById('ccPageSize');
        if (pageSizeControl) pageSizeControl.value = String(state.pageSize);
        state.total = data.total || 0;
        state.totalPages = data.totalPages || 1;
        state.activityTotal = data.activityTotal === undefined ? null : data.activityTotal;
        state.activityLabel = data.activityLabel || '';
        state.view = data.view || state.view;
        renderRows(data.rows || []);
        renderPaging();
        renderActiveView();
    }

    function renderRows(rows) {
        var tbody = document.getElementById('ccPatientRows');
        if (!tbody) return;
        if (!rows.length) {
            tbody.innerHTML = '<tr><td class="text-center text-muted py-4">No eligible patients found.</td></tr>';
            return;
        }
        var html = '';
        for (var i = 0; i < rows.length; i++) {
            var row = rows[i];
            var canUpdate = row.isCurrentlyEligible === true;
            var disabled = canUpdate ? '' : ' disabled';
            var answeredAcknowledgement = rxPhone.acknowledgements[String(row.id)];
            var calledWrapClass = answeredAcknowledgement ? 'cc-called-wrap rx-answered' : 'cc-called-wrap';
            var calledTitle = answeredAcknowledgement
                ? 'Answered and recorded automatically through RX Softphone'
                : (state.view === 'queue' ? 'Called' : 'Call again');
            var saveButton = canUpdate
                ? '<button class="btn btn-success btn-sm cc-save" data-action="save" title="Save"><i class="fas fa-save"></i></button>'
                : '<span class="badge bg-success">Done</span>';
            html += '<tr data-id="' + esc(row.id) + '">' +
                '<td class="cc-record-td">' +
                    '<div class="cc-record-line cc-record-all">' +
                        '<div class="cc-record-cell cc-patient-full-name"><span class="cc-name-cell">' + esc(row.firstName) + '</span><span class="cc-name-cell">' + esc(row.lastName) + '</span></div>' +
                        '<div class="cc-record-cell"><div class="cc-clinic-name">' + esc(row.clinicName || 'Unassigned') + '</div></div>' +
                        '<div class="cc-record-cell"><div class="cc-patient-transport-name">' + esc(row.patientTransportName || 'Unassigned') + '</div></div>' +
                        '<div class="cc-record-cell">' + renderPhone(row, canUpdate) + '</div>' +
                        '<div class="cc-record-cell"><div class="cc-note-preview">' + renderNotes(row) + '</div></div>' +
                        '<div class="cc-record-cell"><input type="date" class="form-control form-control-sm cc-new-date" data-field="newServiceDate"' +
                            (state.eligibilityCutoff ? ' min="' + esc(state.eligibilityCutoff) + '"' : '') + disabled + '></div>' +
                        '<div class="cc-record-cell"><textarea class="form-control form-control-sm cc-row-note" data-field="note" maxlength="4000" rows="1"' + disabled + '></textarea></div>' +
                        '<div class="cc-record-cell text-center"><label class="' + calledWrapClass + '" title="' + calledTitle + '"><input type="checkbox" class="form-check-input cc-called" data-field="called"' + (answeredAcknowledgement ? ' checked disabled' : disabled) + '></label></div>' +
                        '<div class="cc-record-cell cc-record-cell-history">' + renderCallHistory(row) + '</div>' +
                        '<div class="cc-record-cell cc-record-cell-save">' + saveButton + '</div>' +
                    '</div>' +
                '</td>' +
            '</tr>';
        }
        tbody.innerHTML = html;
        renderPhoneClientStatus();
        refreshPhoneAvailability();
    }

    function resizeRowNote(textarea) {
        if (!textarea || !textarea.classList.contains('cc-row-note')) return;
        textarea.style.height = '34px';
        textarea.style.height = Math.max(34, textarea.scrollHeight) + 'px';
    }

    function renderNotes(row) {
        var entries = row.noteEntries || [];
        if (!entries.length && !row.notes) return '<span class="text-muted">--</span>';
        if (!entries.length) return esc(row.notes || '');
        var html = '';
        for (var i = 0; i < entries.length; i++) {
            var n = entries[i] || {};
            var source = n.source || 'Patient';
            var badgeClass = source === 'Call Center' ? 'bg-info' : 'bg-secondary';
            var meta = [];
            if (n.author) meta.push(n.author);
            if (n.createdAt) meta.push(fmtDateTime(n.createdAt));
            html += '<div class="mb-2">' +
                '<span class="badge ' + badgeClass + ' me-1">' + esc(source) + '</span>' +
                (meta.length ? '<small class="text-muted">' + esc(meta.join(' - ')) + '</small>' : '') +
                '<div>' + esc(n.note || '') + '</div>' +
            '</div>';
        }
        return html;
    }

    function renderCallHistory(row) {
        var count = row.callCount || 0;
        var calls = row.recentCalls || [];
        var statusClass = row.isCurrentlyEligible ? (row.calledToday ? 'bg-warning text-dark' : 'bg-success') : 'bg-success';
        var html = '<div class="d-flex flex-wrap gap-1 align-items-center">' +
            '<span class="badge bg-info">' + count + '</span>' +
            '<span class="badge ' + statusClass + '">' + esc(row.statusText || '') + '</span>' +
        '</div>';
        if (!calls.length) return html + '<div class="cc-history-list text-muted">--</div>';
        html += '<div class="cc-history-list mt-1">';
        for (var i = 0; i < calls.length; i++) {
            html += '<div><i class="fas fa-phone-alt me-1"></i>' + esc(fmtDateTime(calls[i].at)) +
                (calls[i].user ? '<br><span class="ms-3">' + esc(calls[i].user) + '</span>' : '') +
                '</div>';
        }
        var extra = count - calls.length;
        if (extra > 0) html += '<div>+' + extra + ' more</div>';
        html += '</div>';
        return html;
    }

    function renderPaging() {
        var start = state.total ? ((state.page - 1) * state.pageSize) + 1 : 0;
        var end = Math.min(state.page * state.pageSize, state.total);
        var label = state.total ? (start + '-' + end + ' of ' + state.total) : '0';
        if (state.activityTotal !== null && state.activityTotal !== undefined && state.activityLabel) {
            label += ' / ' + state.activityTotal + ' ' + state.activityLabel;
        }
        setText('ccRangeLabel', label);
        setText('ccPageLabel', 'Page ' + state.page + ' of ' + state.totalPages);
        var prev = document.getElementById('ccPrevBtn');
        var next = document.getElementById('ccNextBtn');
        if (prev) prev.disabled = state.page <= 1;
        if (next) next.disabled = state.page >= state.totalPages;
    }

    function renderActiveView() {
        var cards = document.querySelectorAll('.cc-metric[data-view]');
        for (var i = 0; i < cards.length; i++) {
            var cardKey = cards[i].getAttribute('data-card') || cards[i].getAttribute('data-view');
            cards[i].classList.toggle('active', cardKey === state.activeCard);
        }
        setText('ccListTitle', cardTitles[state.activeCard] || 'New Call Queue');
        setText('ccListSubtitle', cardSubtitles[state.activeCard] || '');
        renderSortHeaders();
    }

    function renderSortHeaders() {
        var buttons = document.querySelectorAll('.cc-sort[data-sort]');
        for (var i = 0; i < buttons.length; i++) {
            var btn = buttons[i];
            var icon = btn.querySelector('i');
            var active = btn.getAttribute('data-sort') === state.sort;
            btn.classList.toggle('active', active);
            if (icon) {
                icon.className = active
                    ? (state.dir === 'desc' ? 'fas fa-sort-down' : 'fas fa-sort-up')
                    : 'fas fa-sort';
            }
        }
    }

    async function saveRow(button) {
        var tr = button.closest('tr[data-id]');
        if (!tr) return;
        var id = tr.getAttribute('data-id');
        var called = tr.querySelector('.cc-called');
        var note = tr.querySelector('.cc-row-note');
        var date = tr.querySelector('.cc-new-date');
        var payload = {
            called: !!(called && called.checked && !(rxPhone.acknowledgements[String(id)] || {}).autoRecorded),
            note: note ? note.value.trim() : '',
            newServiceDate: date ? date.value : ''
        };
        var acknowledgement = rxPhone.acknowledgements[String(id)];
        var launchedPhoneClient = rxPhone.callClients[String(id)];
        if (payload.called && acknowledgement) {
            payload.phoneClient = acknowledgement.phoneClient;
            payload.callAnsweredAt = acknowledgement.answeredAt;
            payload.callEndedAt = acknowledgement.endedAt;
            payload.callDurationSeconds = acknowledgement.durationSeconds;
        } else if (payload.called && launchedPhoneClient) {
            payload.phoneClient = launchedPhoneClient;
        }

        if (!payload.called && !payload.note && !payload.newServiceDate) {
            toast('Select Called, add a note, or enter a new service date.', 'warning');
            return;
        }
        var claimed = await claimRow(id);
        if (!claimed) {
            button.disabled = false;
            return;
        }

        button.disabled = true;
        var oldHtml = button.innerHTML;
        button.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        try {
            var res = await fetchWithAuth(api.patients + '/' + encodeURIComponent(id) + '/actions', {
                method: 'POST',
                body: JSON.stringify(payload)
            });
            var data = res ? await res.json().catch(function() { return {}; }) : {};
            if (res && res.ok) {
                delete rxPhone.acknowledgements[String(id)];
                delete rxPhone.callClients[String(id)];
                toast((data && data.message) || 'Saved.', 'success');
                await releasePatientLocks([id]);
                await loadMetrics();
                await loadPatients();
            } else {
                if (data && data.lock && Number.isFinite(parseInt(data.lock.patientId, 10))) {
                    var conflictPatientId = parseInt(data.lock.patientId, 10);
                    lockedPatientIds = lockedPatientIds.filter(function(patientId) {
                        return patientId !== conflictPatientId;
                    });
                }
                var lock = data && data.lock ? (' by ' + (data.lock.user || 'another user')) : '';
                var saveErrorMessage = (data && (data.error || data.message)) || 'Save failed.';
                toast((saveErrorMessage + lock) || 'Save failed.', 'danger');
                if (res && res.status === 409) loadPatients();
            }
        } catch (err) {
            toast('Network error.', 'danger');
        } finally {
            button.disabled = false;
            button.innerHTML = oldHtml;
        }
    }

    function bindEvents() {
        var pageSize = document.getElementById('ccPageSize');
        var search = document.getElementById('ccSearch');
        var searchBtn = document.getElementById('ccSearchBtn');
        var refreshBtn = document.getElementById('ccRefreshBtn');
        var prev = document.getElementById('ccPrevBtn');
        var next = document.getElementById('ccNextBtn');
        var rows = document.getElementById('ccPatientRows');
        var phoneSetup = document.getElementById('ccPhoneSetupBtn');
        var phoneSetupForm = document.getElementById('ccPhoneSetupForm');
        var phoneSetupModal = document.getElementById('ccPhoneSetupModal');
        var phoneRegister = document.getElementById('ccPhoneRegisterBtn');
        var phoneUnregister = document.getElementById('ccPhoneUnregisterBtn');
        var passwordToggle = document.getElementById('ccSipPasswordToggle');
        var relayPair = document.getElementById('ccRelayPairBtn');
        var relayGenerate = document.getElementById('ccRelayGenerateBtn');
        var relayModalElement = document.getElementById('ccRelayPairModal');
        var cards = document.querySelectorAll('.cc-metric[data-view]');
        var sortButtons = document.querySelectorAll('.cc-sort[data-sort]');

        if (pageSize) {
            pageSize.addEventListener('change', function() {
                var requestedSize = Number(this.value);
                state.pageSize = [5, 10, 25, 50].indexOf(requestedSize) !== -1 ? requestedSize : 10;
                state.page = 1;
                releaseCurrentLocks().then(loadPatients);
            });
        }
        if (searchBtn) {
            searchBtn.addEventListener('click', function() {
                state.q = search ? search.value.trim() : '';
                state.page = 1;
                releaseCurrentLocks().then(loadPatients);
            });
        }
        if (search) {
            search.addEventListener('keydown', function(e) {
                if (e.key === 'Enter') {
                    state.q = search.value.trim();
                    state.page = 1;
                    releaseCurrentLocks().then(loadPatients);
                }
            });
        }
        if (refreshBtn) {
            refreshBtn.addEventListener('click', function() {
                loadMetrics();
                releaseCurrentLocks().then(loadPatients);
            });
        }
        if (prev) {
            prev.addEventListener('click', function() {
                if (state.page > 1) {
                    state.page -= 1;
                    releaseCurrentLocks().then(loadPatients);
                }
            });
        }
        if (next) {
            next.addEventListener('click', function() {
                if (state.page < state.totalPages) {
                    state.page += 1;
                    releaseCurrentLocks().then(loadPatients);
                }
            });
        }
        if (rows) {
            rows.addEventListener('click', function(e) {
                var callLink = e.target.closest('[data-action="phone-call"]');
                if (callLink) {
                    e.preventDefault();
                    startPhoneCall(callLink);
                    return;
                }
                var hangupButton = e.target.closest('[data-action="phone-hangup"]');
                if (hangupButton) {
                    e.preventDefault();
                    hangupRxCall(hangupButton);
                    return;
                }
                var btn = e.target.closest('[data-action="save"]');
                if (btn) saveRow(btn);
            });
            rows.addEventListener('input', function(e) {
                if (e.target && e.target.classList.contains('cc-row-note')) resizeRowNote(e.target);
            });
        }
        if (phoneSetupForm && phoneRegister) {
            phoneSetupForm.addEventListener('submit', function(e) {
                e.preventDefault();
                saveRxPhoneAccount(phoneSetupForm, phoneRegister);
            });
        }
        if (phoneUnregister) {
            phoneUnregister.addEventListener('click', function() {
                unregisterRxPhone(phoneUnregister);
            });
        }
        if (passwordToggle) {
            passwordToggle.addEventListener('click', function() {
                var password = document.getElementById('ccSipPassword');
                if (!password) return;
                var show = password.type === 'password';
                password.type = show ? 'text' : 'password';
                passwordToggle.textContent = show ? 'Hide' : 'Show';
                passwordToggle.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
            });
        }
        if (relayPair && relayModalElement) {
            relayPair.addEventListener('click', function() {
                var modal = bootstrap.Modal.getOrCreateInstance(relayModalElement);
                modal.show();
                createRelayPairingCode(relayGenerate);
            });
        }
        if (relayGenerate) {
            relayGenerate.addEventListener('click', function() { createRelayPairingCode(relayGenerate); });
        }
        if (phoneSetupModal) {
            phoneSetupModal.addEventListener('hidden.bs.modal', function() {
                var password = document.getElementById('ccSipPassword');
                if (password) {
                    password.value = '';
                    password.type = 'password';
                }
                if (passwordToggle) {
                    passwordToggle.textContent = 'Show';
                    passwordToggle.setAttribute('aria-label', 'Show password');
                }
            });
        }
        for (var i = 0; i < cards.length; i++) {
            cards[i].addEventListener('click', function() {
                state.view = this.getAttribute('data-view') || 'queue';
                state.activeCard = this.getAttribute('data-card') || state.view;
                state.page = 1;
                releaseCurrentLocks().then(loadPatients);
            });
        }
        for (var si = 0; si < sortButtons.length; si++) {
            sortButtons[si].addEventListener('click', function() {
                var nextSort = this.getAttribute('data-sort') || '';
                if (state.sort === nextSort) {
                    state.dir = state.dir === 'asc' ? 'desc' : 'asc';
                } else {
                    state.sort = nextSort;
                    state.dir = 'asc';
                }
                state.page = 1;
                releaseCurrentLocks().then(loadPatients);
            });
        }
    }

    document.addEventListener('DOMContentLoaded', function() {
        if (typeof setupSidebar === 'function') setupSidebar();
        if (typeof setupTheme === 'function') setupTheme();
        if (typeof setupLogout === 'function') setupLogout();
        if (typeof setupSessionTimeout === 'function') setupSessionTimeout();
        if (typeof setupNavDate === 'function') setupNavDate();
        if (typeof setScreenCopyProtection === 'function') setScreenCopyProtection(true, 'Screen copy disabled for this role.');

        var user = typeof getCurrentAuthUser === 'function' ? getCurrentAuthUser() : (window.__RX_AUTH_USER || null);
        var greeting = document.getElementById('userGreeting');
        if (greeting && user) {
            var name = ((user.firstName || '') + ' ' + (user.lastName || '')).trim() || user.username || 'Call Center';
            greeting.textContent = 'Hello, ' + name;
        }

        bindEvents();
        loadMetrics();
        loadPatients();
        lockHeartbeatTimer = setInterval(refreshCurrentLocks, 30000);
        lockStatusTimer = setInterval(refreshPhoneAvailability, 1000);
        window.addEventListener('beforeunload', function() {
            if (rxPhone.monitorTimer) clearInterval(rxPhone.monitorTimer);
            if (lockStatusTimer) clearInterval(lockStatusTimer);
            if (!lockedPatientIds.length) return;
            try {
                fetch(api.lockRelease, {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ patientIds: lockedPatientIds }),
                    keepalive: true
                });
            } catch (err) {}
        });
    });
})();
