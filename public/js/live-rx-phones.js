(function() {
    'use strict';

    window.__RX_LIVE_PHONES_BOOTED = true;

    var users = [];
    var loading = false;
    var refreshTimer = null;
    var durationTimer = null;
    var REQUEST_TIMEOUT_MS = 15000;
    var ACTIVE_STATES = ['dialing', 'trying', 'ringing', 'answering', 'connected', 'incoming'];

    function esc(value) {
        return String(value === undefined || value === null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function endpoint(path) {
        return window.rxUrl ? window.rxUrl(path) : path;
    }

    function inventoryEndpoint() {
        var anchor = document.getElementById('xa-live-rx-phones-api');
        var rewritten = window.rxElementHref && anchor
            ? window.rxElementHref(anchor)
            : '';
        return rewritten || endpoint('/api/admin/softphone-devices');
    }

    async function request(path) {
        var controller = typeof AbortController === 'function' ? new AbortController() : null;
        var timer = controller
            ? setTimeout(function() { controller.abort(); }, REQUEST_TIMEOUT_MS)
            : null;
        try {
            var options = { credentials: 'include' };
            if (controller) options.signal = controller.signal;
            var response = await fetch(endpoint(path), options);
            var data = await response.json().catch(function() { return {}; });
            if (response.status === 401) {
                if (window.rxNav) window.rxNav('/login');
                throw new Error('Authentication required.');
            }
            if (!response.ok) throw new Error(data.error || data.message || ('Request failed (' + response.status + ').'));
            return data;
        } catch (error) {
            if (error && error.name === 'AbortError') {
                throw new Error('FortiGate did not return the Live RX Phones request within 15 seconds. Refresh the SSL-VPN session and try again.');
            }
            throw error;
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    function userLabel(user) {
        var name = ((user.firstName || '') + ' ' + (user.lastName || '')).trim();
        return name || user.username || ('User #' + user.id);
    }

    function lines() {
        return users.filter(function(user) {
            return !!(user && (
                (user.account && user.account.configured && user.account.isEnabled !== false)
                || (user.device && user.device.paired)
            ));
        });
    }

    function normalizedCallState(device) {
        return String(device && device.callState || 'idle').trim().toLowerCase();
    }

    function phoneState(user) {
        var account = user.account || {};
        var device = user.device || {};
        var call = normalizedCallState(device);
        if (!device.paired || !device.online) {
            return { key: 'offline', label: device.paired ? 'Offline' : 'Not paired', icon: 'fa-phone-slash' };
        }
        if (user.isActive === false || device.registrationState !== 'registered' || account.isEnabled === false || device.updateRequired || !device.managedMode) {
            return { key: 'issue', label: device.registrationState === 'failed' ? 'Registration failed' : 'Needs attention', icon: 'fa-exclamation-triangle' };
        }
        if (call === 'connected') return { key: 'connected', label: 'In call', icon: 'fa-phone-volume' };
        if (call === 'ringing' || call === 'answering' || call === 'incoming') return { key: 'ringing', label: call === 'incoming' ? 'Incoming' : 'Ringing', icon: 'fa-bell' };
        if (call === 'dialing' || call === 'trying') return { key: 'dialing', label: 'Dialing', icon: 'fa-phone-alt' };
        return { key: 'idle', label: 'Idle', icon: 'fa-check-circle' };
    }

    function searchable(user) {
        var account = user.account || {};
        var device = user.device || {};
        return [
            userLabel(user), user.username, user.roleName,
            account.username, account.displayName,
            device.deviceName, device.clientVersion
        ].join(' ').toLowerCase();
    }

    function parseDate(value) {
        var date = value ? new Date(value) : null;
        return date && !Number.isNaN(date.getTime()) ? date : null;
    }

    function formatDate(value) {
        var date = parseDate(value);
        return date ? date.toLocaleString() : 'Never';
    }

    function formatElapsed(seconds) {
        var safe = Math.max(0, Math.floor(Number(seconds) || 0));
        var hours = Math.floor(safe / 3600);
        var minutes = Math.floor((safe % 3600) / 60);
        var remainder = safe % 60;
        return (hours ? String(hours).padStart(2, '0') + ':' : '')
            + String(minutes).padStart(2, '0') + ':'
            + String(remainder).padStart(2, '0');
    }

    function relativeSeen(value) {
        var date = parseDate(value);
        if (!date) return 'Never reported';
        var seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
        if (seconds < 5) return 'Just now';
        if (seconds < 60) return seconds + 's ago';
        if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
        if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago';
        return Math.floor(seconds / 86400) + 'd ago';
    }

    function activeStart(device, state) {
        if (state.key === 'connected') return device.connectedAt || device.ringingAt || device.dialedAt;
        if (state.key === 'ringing') return device.ringingAt || device.dialedAt;
        if (state.key === 'dialing') return device.dialedAt;
        return null;
    }

    function durationHtml(device, state) {
        var start = activeStart(device, state);
        if (!start) return '';
        return '<div class="mt-2"><span class="phone-meta">' + esc(state.key === 'connected' ? 'Connected' : 'Elapsed') + '</span>'
            + '<div class="phone-duration" data-phone-duration="' + esc(start) + '">00:00</div></div>';
    }

    function lastCallHtml(device, state) {
        if (ACTIVE_STATES.includes(normalizedCallState(device)) || !device.dialedAt) return '';
        var outcome = String(device.outcome || normalizedCallState(device) || 'completed').replace(/_/g, ' ');
        var detail = device.peer ? ' · ' + esc(device.peer) : '';
        return '<div class="phone-meta mt-2"><i class="fas fa-history me-1"></i>Last: '
            + esc(outcome) + detail + '<br>' + esc(formatDate(device.endedAt || device.dialedAt)) + '</div>';
    }

    function sharedExtensionCounts(source) {
        var counts = {};
        source.forEach(function(user) {
            var extension = String(user.account && user.account.username || '').trim();
            if (extension) counts[extension] = (counts[extension] || 0) + 1;
        });
        return counts;
    }

    function renderStats(source) {
        var states = source.map(phoneState);
        document.getElementById('phoneStatRegistered').textContent = source.filter(function(user) {
            return !!(user.device && user.device.online && user.device.registrationState === 'registered');
        }).length;
        document.getElementById('phoneStatIdle').textContent = states.filter(function(state) { return state.key === 'idle'; }).length;
        document.getElementById('phoneStatDialing').textContent = states.filter(function(state) { return state.key === 'dialing'; }).length;
        document.getElementById('phoneStatRinging').textContent = states.filter(function(state) { return state.key === 'ringing'; }).length;
        document.getElementById('phoneStatConnected').textContent = states.filter(function(state) { return state.key === 'connected'; }).length;
        document.getElementById('phoneStatUnavailable').textContent = states.filter(function(state) {
            return state.key === 'offline' || state.key === 'issue';
        }).length;
    }

    function renderBoard() {
        var board = document.getElementById('livePhoneBoard');
        var source = lines();
        var query = document.getElementById('livePhoneSearch').value.trim().toLowerCase();
        var status = document.getElementById('livePhoneStatusFilter').value;
        var counts = sharedExtensionCounts(source);
        var filtered = source.filter(function(user) {
            var state = phoneState(user);
            return (!query || searchable(user).includes(query)) && (!status || state.key === status);
        });
        renderStats(source);
        if (!filtered.length) {
            board.innerHTML = '<div class="phone-empty"><i class="fas fa-phone-slash me-2"></i>'
                + (source.length ? 'No RX Softphone lines match this filter.' : 'No RX Softphone accounts or paired workstations are available.')
                + '</div>';
            return;
        }

        var cardsHtml = filtered.map(function(user) {
            var account = user.account || {};
            var device = user.device || {};
            var state = phoneState(user);
            var extension = account.username || 'Unassigned';
            var shared = counts[String(account.username || '').trim()] > 1
                ? '<span class="phone-shared ms-2"><i class="fas fa-users me-1"></i>Shared by ' + counts[String(account.username || '').trim()] + '</span>'
                : '';
            var activePeer = ACTIVE_STATES.includes(normalizedCallState(device)) && device.peer
                ? '<div class="fw-semibold mt-2"><i class="fas fa-arrow-right me-1"></i>' + esc(device.peer) + '</div>'
                : '';
            var registration = device.online
                ? esc(device.registrationState || 'unknown')
                : 'relay offline';
            var version = device.clientVersion ? ' · v' + esc(device.clientVersion) : '';
            var deviceLine = device.paired
                ? esc(device.deviceName || 'Windows RX Softphone') + version
                : 'No paired Windows phone';
            return '<article class="live-phone-card state-' + esc(state.key) + '" data-phone-state="' + esc(state.key) + '">' +
                '<div class="d-flex align-items-start justify-content-between gap-2">' +
                    '<div class="d-flex align-items-start gap-2">' +
                        '<span class="phone-state-dot mt-1"></span>' +
                        '<div><div class="fw-bold">' + esc(userLabel(user)) + '</div>' +
                        '<div class="phone-meta">@' + esc(user.username || '') + ' · ' + esc(user.roleName || 'No role') + '</div></div>' +
                    '</div>' +
                    '<span class="phone-state-pill"><i class="fas ' + esc(state.icon) + '"></i>' + esc(state.label) + '</span>' +
                '</div>' +
                '<div class="mt-3"><span class="phone-meta">Extension</span><div><span class="phone-extension">' + esc(extension) + '</span>' + shared + '</div></div>' +
                activePeer +
                durationHtml(device, state) +
                lastCallHtml(device, state) +
                '<hr class="my-3">' +
                '<div class="phone-meta"><i class="fas fa-desktop me-1"></i>' + deviceLine + '</div>' +
                '<div class="phone-meta"><i class="fas fa-signal me-1"></i>' + registration + ' · ' + esc(relativeSeen(device.lastSeenAt)) + '</div>' +
                '<div class="phone-meta" title="' + esc(formatDate(device.lastSeenAt)) + '"><i class="fas fa-clock me-1"></i>Last heartbeat: ' + esc(formatDate(device.lastSeenAt)) + '</div>' +
                '</article>';
        }).join('');
        board.innerHTML = cardsHtml;
        updateDurations();
    }

    function updateDurations() {
        document.querySelectorAll('[data-phone-duration]').forEach(function(node) {
            var start = parseDate(node.getAttribute('data-phone-duration'));
            if (start) node.textContent = formatElapsed((Date.now() - start.getTime()) / 1000);
        });
    }

    async function loadPhones(silent) {
        if (loading || (silent && document.hidden)) return;
        loading = true;
        var refresh = document.getElementById('livePhoneRefresh');
        if (!silent) refresh.disabled = true;
        try {
            var data = await request(inventoryEndpoint());
            users = Array.isArray(data.users) ? data.users : [];
            renderBoard();
        } catch (error) {
            document.getElementById('livePhoneBoard').innerHTML = '<div class="phone-empty text-danger"><i class="fas fa-exclamation-triangle me-2"></i>' + esc(error.message) + '</div>';
        } finally {
            loading = false;
            refresh.disabled = false;
        }
    }

    document.addEventListener('DOMContentLoaded', function() {
        document.getElementById('livePhoneSearch').addEventListener('input', renderBoard);
        document.getElementById('livePhoneStatusFilter').addEventListener('change', renderBoard);
        document.getElementById('livePhoneRefresh').addEventListener('click', function() { loadPhones(false); });
        loadPhones(false);
        refreshTimer = setInterval(function() { loadPhones(true); }, 5000);
        durationTimer = setInterval(updateDurations, 1000);
        window.addEventListener('beforeunload', function() {
            clearInterval(refreshTimer);
            clearInterval(durationTimer);
        }, { once: true });
    });
})();
