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
            lockRelease: h('xa-cc-lock-release', '/api/call-center/locks/release')
        };
    })();

    var lockedPatientIds = [];
    var lockHeartbeatTimer = null;
    var serviceWindowDays = Number(window.SERVICE_WINDOW_DAYS) || 90;
    var callCenterLeadDays = Number(window.CALL_CENTER_LEAD_DAYS) || 0;
    var rxSoftphoneBaseUrl = 'http://127.0.0.1:5188';
    var rxPhone = {
        reachable: false,
        snapshot: null,
        probePromise: null,
        monitorTimer: null,
        activeCall: null,
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
            '<a class="cc-call-link" data-action="phone-call" data-patient-id="' + esc(row.id) + '" data-dial-number="' + esc(dialNumber) + '" href="callto:' + esc(dialNumber) + '"' +
                ' title="' + esc(label) + '" aria-label="' + esc(label) + '">' +
                '<i class="fas fa-phone-alt" aria-hidden="true"></i>' +
            '</a>' +
        '</div>';
    }

    function setText(id, value) {
        var el = document.getElementById(id);
        if (el) el.textContent = value;
    }

    function toast(message, type) {
        if (typeof showToast === 'function') showToast(message, type || 'info');
    }

    async function rxFetch(path, options) {
        var controller = typeof AbortController === 'function' ? new AbortController() : null;
        var timeout = controller ? setTimeout(function() { controller.abort(); }, 2500) : null;
        var fetchOptions = Object.assign({
            mode: 'cors',
            cache: 'no-store',
            targetAddressSpace: 'loopback'
        }, options || {});
        if (controller) fetchOptions.signal = controller.signal;
        if (fetchOptions.body) {
            fetchOptions.headers = Object.assign({ 'Content-Type': 'application/json' }, fetchOptions.headers || {});
        }
        try {
            var response = await fetch(rxSoftphoneBaseUrl + path, fetchOptions);
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
        var hangup = document.getElementById('ccPhoneHangupBtn');
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
                badge.innerHTML = '<i class="fas fa-phone-volume"></i> RX: ' + esc(callState);
            } else {
                badge.classList.add('online');
                badge.innerHTML = '<i class="fas fa-check-circle"></i> RX Softphone ready';
            }
            if (help) help.textContent = 'RX Softphone reports answered calls here. Confirm any note or service date, then Save.';
        } else if (state.phoneClient === 'auto') {
            badge.classList.add('fallback');
            badge.innerHTML = '<i class="fas fa-random"></i> MicroSIP fallback';
            if (help) help.textContent = 'RX Softphone is not registered, so calls will open in MicroSIP.';
        } else {
            badge.classList.add('fallback');
            badge.innerHTML = '<i class="fas fa-exclamation-triangle"></i> RX Softphone offline';
            if (help) help.textContent = rxPhone.reachable
                ? 'Open RX Softphone and register it to the PBX before calling.'
                : 'Start RX Softphone on this computer, then wait for this status to become ready.';
        }

        if (hangup) {
            hangup.classList.toggle('d-none', !(rxPhone.reachable && isRxCallActive(rxPhone.snapshot)));
            hangup.disabled = false;
        }
    }

    function markAnsweredCall(patientId, snapshot) {
        var key = String(patientId);
        if (!rxPhone.acknowledgements[key]) {
            rxPhone.acknowledgements[key] = {
                phoneClient: 'rx_softphone',
                answeredAt: (snapshot && snapshot.connectedAt) || new Date().toISOString(),
                endedAt: null,
                durationSeconds: null
            };
            toast('RX Softphone reports that the call was answered. Called is selected; click Save after adding any note or service date.', 'success');
        }

        var row = document.querySelector('tr[data-id="' + key.replace(/"/g, '') + '"]');
        var checkbox = row ? row.querySelector('.cc-called') : null;
        var wrap = row ? row.querySelector('.cc-called-wrap') : null;
        if (checkbox && !checkbox.disabled) checkbox.checked = true;
        if (wrap) {
            wrap.classList.add('rx-answered');
            wrap.title = 'Answered through RX Softphone; click Save to record the call';
        }
    }

    function handleRxSnapshot(snapshot) {
        rxPhone.snapshot = snapshot || null;
        var active = rxPhone.activeCall;
        var callState = snapshot && snapshot.call ? snapshot.call : 'idle';
        if (active && callState === 'connected') {
            active.answered = true;
            markAnsweredCall(active.patientId, snapshot);
        }

        if (active && ['ended', 'failed', 'idle'].indexOf(callState) !== -1 && active.lastState && active.lastState !== 'idle') {
            var acknowledgement = rxPhone.acknowledgements[String(active.patientId)];
            if (acknowledgement) {
                acknowledgement.endedAt = new Date().toISOString();
                var startMs = new Date(acknowledgement.answeredAt).getTime();
                var endMs = new Date(acknowledgement.endedAt).getTime();
                if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs) {
                    acknowledgement.durationSeconds = Math.round((endMs - startMs) / 1000);
                }
            }
            var link = document.querySelector('[data-action="phone-call"][data-patient-id="' + String(active.patientId) + '"]');
            if (link) link.classList.remove('is-calling');
            rxPhone.activeCall = null;
        } else if (active) {
            active.lastState = callState;
        }
        renderPhoneClientStatus();
    }

    async function probeRxPhone() {
        if (state.phoneClient === 'microsip') return null;
        if (rxPhone.probePromise) return rxPhone.probePromise;
        rxPhone.probePromise = rxFetch('/api/status')
            .then(function(snapshot) {
                rxPhone.reachable = true;
                handleRxSnapshot(snapshot);
                return snapshot;
            })
            .catch(function() {
                rxPhone.reachable = false;
                rxPhone.snapshot = null;
                renderPhoneClientStatus();
                return null;
            })
            .finally(function() {
                rxPhone.probePromise = null;
            });
        return rxPhone.probePromise;
    }

    function configurePhoneMonitor() {
        if (rxPhone.monitorTimer) {
            clearInterval(rxPhone.monitorTimer);
            rxPhone.monitorTimer = null;
        }
        renderPhoneClientStatus();
        if (state.phoneClient === 'microsip') return;
        probeRxPhone();
        rxPhone.monitorTimer = setInterval(probeRxPhone, 1200);
    }

    function openMicroSip(dialNumber, fallback, patientId) {
        if (Number.isFinite(patientId)) rxPhone.callClients[String(patientId)] = 'microsip';
        toast((fallback ? 'RX Softphone is unavailable. Opening MicroSIP with ' : 'Opening MicroSIP with ') + dialNumber + '.', fallback ? 'warning' : 'info');
        window.location.href = 'callto:' + dialNumber;
    }

    async function startPhoneCall(link) {
        var dialNumber = link.getAttribute('data-dial-number') || '';
        var patientId = parseInt(link.getAttribute('data-patient-id'), 10);
        if (!dialNumber) return;
        if (state.phoneClient === 'microsip') {
            openMicroSip(dialNumber, false, patientId);
            return;
        }

        var snapshot = await probeRxPhone();
        var ready = !!(snapshot && snapshot.registration === 'registered');
        if (!ready) {
            if (state.phoneClient === 'auto') openMicroSip(dialNumber, true, patientId);
            else if (!snapshot) toast('RX Softphone could not be reached. Start version 0.2.0 or later and allow this site to connect to the local softphone.', 'warning');
            else toast('RX Softphone is not registered. Open it and register to the PBX before calling.', 'warning');
            return;
        }
        if (isRxCallActive(snapshot)) {
            toast('RX Softphone already has a call in progress.', 'warning');
            return;
        }
        if (!await claimRow(patientId)) return;

        link.classList.add('is-calling');
        try {
            var dialSnapshot = await rxFetch('/api/calls', {
                method: 'POST',
                body: JSON.stringify({ destination: dialNumber })
            });
            rxPhone.activeCall = {
                patientId: patientId,
                dialNumber: dialNumber,
                answered: false,
                lastState: dialSnapshot.call || 'dialing'
            };
            rxPhone.callClients[String(patientId)] = 'rx_softphone';
            rxPhone.reachable = true;
            handleRxSnapshot(dialSnapshot);
            toast('Calling ' + dialNumber + ' with RX Softphone.', 'info');
        } catch (err) {
            link.classList.remove('is-calling');
            toast((err && err.message) || 'RX Softphone could not place the call.', 'danger');
            await probeRxPhone();
        }
    }

    async function hangupRxCall(button) {
        button.disabled = true;
        try {
            var snapshot = await rxFetch('/api/calls/current', { method: 'DELETE' });
            rxPhone.reachable = true;
            handleRxSnapshot(snapshot);
            toast('RX Softphone call ended.', 'info');
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

    async function releaseCurrentLocks() {
        if (!lockedPatientIds.length) return;
        var ids = lockedPatientIds.slice();
        lockedPatientIds = [];
        try {
            await fetchWithAuth(api.lockRelease, {
                method: 'POST',
                body: JSON.stringify({ patientIds: ids }),
                silent: true
            });
        } catch (err) {}
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
            tbody.innerHTML = '<tr><td colspan="11" class="text-center text-muted py-4"><i class="fas fa-spinner fa-spin me-2"></i>Loading</td></tr>';
        }
        var res = await fetchWithAuth(queryUrl());
        if (!res || !res.ok) {
            if (tbody) tbody.innerHTML = '<tr><td colspan="11" class="text-center text-muted py-4">No access</td></tr>';
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
        state.total = data.total || 0;
        state.totalPages = data.totalPages || 1;
        state.activityTotal = data.activityTotal === undefined ? null : data.activityTotal;
        state.activityLabel = data.activityLabel || '';
        state.view = data.view || state.view;
        renderRows(data.rows || []);
        lockedPatientIds = (state.view === 'queue' && data.locksAcquired !== false)
            ? (data.rows || []).map(function(row) { return row.id; })
            : lockedPatientIds.filter(function() { return false; });
        renderPaging();
        renderActiveView();
    }

    function renderRows(rows) {
        var tbody = document.getElementById('ccPatientRows');
        if (!tbody) return;
        if (!rows.length) {
            tbody.innerHTML = '<tr><td colspan="11" class="text-center text-muted py-4">No eligible patients found.</td></tr>';
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
                ? 'Answered through RX Softphone; click Save to record the call'
                : (state.view === 'queue' ? 'Called' : 'Call again');
            var saveButton = canUpdate
                ? '<button class="btn btn-success btn-sm cc-save" data-action="save" title="Save"><i class="fas fa-save"></i></button>'
                : '<span class="badge bg-success">Done</span>';
            html += '<tr data-id="' + esc(row.id) + '">' +
                '<td><div class="cc-name-cell">' + esc(row.firstName) + '</div></td>' +
                '<td><div class="cc-name-cell">' + esc(row.lastName) + '</div></td>' +
                '<td><div class="cc-clinic-name">' + esc(row.clinicName || 'Unassigned') + '</div></td>' +
                '<td><div class="cc-patient-transport-name">' + esc(row.patientTransportName || 'Unassigned') + '</div></td>' +
                '<td>' + renderPhone(row, canUpdate) + '</td>' +
                '<td><div class="cc-note-preview">' + renderNotes(row) + '</div></td>' +
                '<td><input type="date" class="form-control form-control-sm cc-new-date" data-field="newServiceDate"' +
                    (state.eligibilityCutoff ? ' min="' + esc(state.eligibilityCutoff) + '"' : '') + disabled + '></td>' +
                '<td><textarea class="form-control form-control-sm cc-row-note" data-field="note" maxlength="4000"' + disabled + '></textarea></td>' +
                '<td class="text-center"><label class="' + calledWrapClass + '" title="' + calledTitle + '"><input type="checkbox" class="form-check-input cc-called" data-field="called"' + (answeredAcknowledgement ? ' checked' : '') + disabled + '></label></td>' +
                '<td>' + renderCallHistory(row) + '</td>' +
                '<td class="text-end">' + saveButton + '</td>' +
            '</tr>';
        }
        tbody.innerHTML = html;
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
            called: !!(called && called.checked),
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
        var hangup = document.getElementById('ccPhoneHangupBtn');
        var cards = document.querySelectorAll('.cc-metric[data-view]');
        var sortButtons = document.querySelectorAll('.cc-sort[data-sort]');

        if (pageSize) {
            pageSize.addEventListener('change', function() {
                state.pageSize = this.value === '5' ? 5 : 10;
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
                var btn = e.target.closest('[data-action="save"]');
                if (btn) saveRow(btn);
            });
        }
        if (hangup) {
            hangup.addEventListener('click', function() {
                hangupRxCall(hangup);
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
        window.addEventListener('beforeunload', function() {
            if (rxPhone.monitorTimer) clearInterval(rxPhone.monitorTimer);
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
