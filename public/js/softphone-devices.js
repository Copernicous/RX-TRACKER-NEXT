(function() {
    'use strict';

    window.__RX_SOFTPHONE_DEVICES_BOOTED = true;

    var users = [];
    var loading = false;
    var refreshTimer = null;
    var REQUEST_TIMEOUT_MS = 15000;

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

    function adminDevicesEndpoint() {
        var anchor = document.getElementById('xa-softphone-devices-api');
        var rewritten = window.rxElementHref && anchor
            ? window.rxElementHref(anchor)
            : '';
        return rewritten || endpoint('/api/admin/softphone-devices');
    }

    async function request(path, options) {
        var controller = typeof AbortController === 'function' ? new AbortController() : null;
        var timer = controller
            ? setTimeout(function() { controller.abort(); }, REQUEST_TIMEOUT_MS)
            : null;
        try {
            var requestOptions = Object.assign({ credentials: 'include' }, options || {});
            if (controller) requestOptions.signal = controller.signal;
            var response = await fetch(endpoint(path), requestOptions);
            var data = await response.json().catch(function() { return {}; });
            if (response.status === 401) {
                if (window.rxNav) window.rxNav('/login');
                throw new Error('Authentication required.');
            }
            if (!response.ok) throw new Error(data.error || data.message || ('Request failed (' + response.status + ').'));
            return data;
        } catch (error) {
            if (error && error.name === 'AbortError') {
                throw new Error('FortiGate did not return the Phone Devices request within 15 seconds. Refresh the SSL-VPN session and try again.');
            }
            throw error;
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    function pill(text, kind, icon) {
        return '<span class="device-pill ' + kind + '"><i class="fas ' + icon + '"></i>' + esc(text) + '</span>';
    }

    function userLabel(user) {
        var name = ((user.firstName || '') + ' ' + (user.lastName || '')).trim();
        return name || user.username || ('User #' + user.id);
    }

    function formatDate(value) {
        if (!value) return 'Never';
        var date = new Date(value);
        return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString();
    }

    function searchable(user) {
        var account = user.account || {};
        var device = user.device || {};
        return [userLabel(user), user.username, user.email, user.roleName, account.server, account.username, account.authId, account.displayName, device.deviceName, device.clientVersion]
            .join(' ').toLowerCase();
    }

    function renderStats() {
        var paired = users.filter(function(user) { return user.device && user.device.paired; });
        document.getElementById('deviceStatPaired').textContent = paired.length;
        document.getElementById('deviceStatOnline').textContent = paired.filter(function(user) { return user.device.online; }).length;
        document.getElementById('deviceStatRegistered').textContent = paired.filter(function(user) { return user.device.registrationState === 'registered'; }).length;
        document.getElementById('deviceStatManaged').textContent = paired.filter(function(user) { return user.device.managedMode && !user.device.updateRequired; }).length;
        document.getElementById('deviceStatUpgrade').textContent = paired.filter(function(user) { return user.device.updateRequired || !user.device.managedMode; }).length;
    }

    function renderRows() {
        var body = document.getElementById('deviceRows');
        var query = document.getElementById('deviceSearch').value.trim().toLowerCase();
        var filtered = users.filter(function(user) { return !query || searchable(user).includes(query); });
        if (!filtered.length) {
            body.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-5">No users match this filter.</td></tr>';
            return;
        }

        body.innerHTML = filtered.map(function(user) {
            var account = user.account || { configured: false };
            var device = user.device || { paired: false };
            var authIdDetail = account.authId && account.authId !== account.username
                ? ' · Auth ID ' + esc(account.authId)
                : '';
            var accountHtml = account.configured
                ? '<div class="fw-semibold">Ext. ' + esc(account.username) + '</div><div class="device-meta">' + esc(account.server) + ':' + esc(account.port) + authIdDetail + (account.isEnabled ? '' : ' · disabled') + '</div>'
                : '<span class="text-muted">Not configured</span>';
            var deviceHtml = device.paired
                ? '<div class="fw-semibold">' + esc(device.deviceName || 'Windows RX Softphone') + '</div><div class="device-meta">Paired ' + esc(formatDate(device.pairedAt)) + '</div>'
                : '<span class="text-muted">Not paired</span>';
            var policyHtml = !device.paired
                ? pill('No device', 'neutral', 'fa-minus-circle')
                : device.updateRequired
                    ? pill('Upgrade to ' + esc(device.minimumClientVersion), 'warn', 'fa-arrow-up') + '<div class="device-meta">Reported ' + esc(device.clientVersion || 'unknown') + '</div>'
                    : device.managedMode
                        ? pill('Managed ' + esc(device.clientVersion || ''), 'good', 'fa-shield-alt')
                        : pill('Not managed', 'bad', 'fa-exclamation-triangle');
            var registrationKind = device.registrationState === 'registered' ? 'good' : device.registrationState === 'failed' ? 'bad' : device.online ? 'warn' : 'neutral';
            var registrationHtml = pill(device.online ? device.registrationState : 'offline', registrationKind, device.registrationState === 'registered' ? 'fa-check-circle' : 'fa-phone-slash');
            if (device.online && device.callState && device.callState !== 'idle') {
                registrationHtml += ' ' + pill(device.callState, device.callState === 'connected' ? 'bad' : 'warn', 'fa-phone-volume');
            }
            if (device.paired && account.configured) {
                registrationHtml += '<div class="device-meta">' + (device.accountSynchronized ? 'Account synchronized' : 'Waiting for account sync') + '</div>';
            }
            var action = device.paired
                ? '<button class="btn btn-outline-danger btn-sm" data-revoke-user="' + Number(user.id) + '" data-revoke-label="' + esc(userLabel(user)) + '" data-revoke-device="' + esc(device.deviceName || 'Windows RX Softphone') + '"' + (device.online && ['dialing','trying','ringing','answering','connected','incoming'].includes(device.callState) ? ' disabled title="End the active call before revoking"' : '') + '><i class="fas fa-unlink me-1"></i>Revoke</button>'
                : '<span class="text-muted small">—</span>';
            return '<tr>' +
                '<td><div class="fw-semibold">' + esc(userLabel(user)) + '</div><div class="device-meta">@' + esc(user.username) + ' · ' + esc(user.roleName || 'No role') + (user.isActive ? '' : ' · disabled') + '</div></td>' +
                '<td>' + accountHtml + '</td>' +
                '<td>' + deviceHtml + '</td>' +
                '<td>' + policyHtml + '</td>' +
                '<td>' + registrationHtml + '</td>' +
                '<td><span class="small">' + esc(formatDate(device.lastSeenAt)) + '</span><div class="device-meta">' + (device.online ? 'Heartbeat current' : device.paired ? 'Device not currently connected' : '') + '</div></td>' +
                '<td class="text-end">' + action + '</td>' +
                '</tr>';
        }).join('');
    }

    function showToast(message, kind) {
        var holder = document.getElementById('deviceToasts');
        var item = document.createElement('div');
        item.className = 'toast show align-items-center text-bg-' + (kind || 'success') + ' border-0 mb-2';
        item.setAttribute('role', 'status');
        item.innerHTML = '<div class="d-flex"><div class="toast-body"></div><button type="button" class="btn-close btn-close-white me-2 m-auto" aria-label="Close"></button></div>';
        item.querySelector('.toast-body').textContent = message;
        item.querySelector('button').addEventListener('click', function() { item.remove(); });
        holder.appendChild(item);
        setTimeout(function() { item.remove(); }, 5500);
    }

    async function loadDevices(silent) {
        if (loading) return;
        loading = true;
        var refresh = document.getElementById('deviceRefresh');
        if (!silent) refresh.disabled = true;
        try {
            var data = await request(adminDevicesEndpoint());
            users = Array.isArray(data.users) ? data.users : [];
            renderStats();
            renderRows();
        } catch (error) {
            if (!silent) showToast(error.message, 'danger');
            document.getElementById('deviceRows').innerHTML = '<tr><td colspan="7" class="text-center text-danger py-5"><i class="fas fa-exclamation-triangle me-2"></i>' + esc(error.message) + '</td></tr>';
        } finally {
            loading = false;
            refresh.disabled = false;
        }
    }

    async function revoke(button) {
        var userId = Number(button.dataset.revokeUser);
        var userLabelValue = button.dataset.revokeLabel || ('User #' + userId);
        var deviceName = button.dataset.revokeDevice || 'Windows RX Softphone';
        if (!window.confirm('Revoke ' + deviceName + ' from ' + userLabelValue + '?\n\nThe workstation will unregister and must pair again before receiving calls.')) return;
        button.disabled = true;
        try {
            var data = await request(adminDevicesEndpoint() + '/' + encodeURIComponent(userId), { method: 'DELETE' });
            showToast(data.message || 'RX Softphone pairing revoked.', 'success');
            await loadDevices(true);
        } catch (error) {
            showToast(error.message, 'danger');
            button.disabled = false;
        }
    }

    document.addEventListener('DOMContentLoaded', function() {
        document.getElementById('deviceSearch').addEventListener('input', renderRows);
        document.getElementById('deviceRefresh').addEventListener('click', function() { loadDevices(false); });
        document.getElementById('deviceRows').addEventListener('click', function(event) {
            var button = event.target.closest('[data-revoke-user]');
            if (button && !button.disabled) revoke(button);
        });
        loadDevices(false);
        refreshTimer = setInterval(function() { loadDevices(true); }, 10000);
        window.addEventListener('beforeunload', function() { clearInterval(refreshTimer); }, { once: true });
    });
})();
