// system-settings.js — Extracted from inline script.
// FortiGate .map().join() corruption fix applied.

// ────────────────────────────────────────────────────────────────────────────
// GENERAL TAB — Timezone & App Name
// ────────────────────────────────────────────────────────────────────────────
const TZ_GROUPS = {
    'Eastern US':    ['America/New_York','America/Detroit'],
    'Central US':    ['America/Chicago','America/Winnipeg'],
    'Mountain US':   ['America/Denver','America/Phoenix'],
    'Pacific US':    ['America/Los_Angeles','America/Vancouver'],
    'Other US':      ['America/Anchorage','Pacific/Honolulu'],
    'Caribbean':     ['America/Puerto_Rico','America/Santo_Domingo','America/Barbados','America/Jamaica','Atlantic/Bermuda'],
    'UTC':           ['UTC'],
    'Europe':        ['Europe/London','Europe/Madrid','Europe/Paris','Europe/Berlin','Europe/Lisbon','Europe/Rome'],
    'Latin America': ['America/Bogota','America/Lima','America/Caracas','America/La_Paz','America/Sao_Paulo','America/Argentina/Buenos_Aires','America/Santiago']
};

let currentSettings = {};
let clockInterval   = null;

function updateClocks(tz) {
    tz = tz || currentSettings.app_timezone || 'UTC';
    const now = new Date();
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone:tz, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:true }).format(now);
    const off = now.toLocaleString('en-US', { timeZone:tz, timeZoneName:'short' }).split(' ').pop();
    document.getElementById('liveClock').textContent    = fmt;
    document.getElementById('liveTimezone').textContent = tz + ' (' + off + ')';
    document.getElementById('previewClock').textContent = fmt;
    document.getElementById('previewOffset').textContent = off;
    document.getElementById('previewUtc').textContent   = now.toISOString().replace('T',' ').slice(0,19) + ' UTC';
}

function populateTzSelect(currentTz) {
    const sel = document.getElementById('tzSelect');
    sel.innerHTML = '';
    for (const [group, zones] of Object.entries(TZ_GROUPS)) {
        const og = document.createElement('optgroup');
        og.label = group;
        for (const tz of zones) {
            const opt = document.createElement('option');
            opt.value = tz;
            opt.textContent = tz.replace(/America\//,'').replace(/_/g,' ');
            if (tz === currentTz) opt.selected = true;
            og.appendChild(opt);
        }
        sel.appendChild(og);
    }
    sel.addEventListener('change', () => updateClocks(sel.value));
}

function renderSettingsTable(s) {
    const tbody = document.getElementById('allSettingsBody');
    const entries = Object.entries(s);
    if (!entries.length) { tbody.innerHTML = '<tr><td colspan="2" class="text-muted text-center">No settings found</td></tr>'; return; }
    tbody.innerHTML = (function(){var _en=''; entries.forEach(function(_e){var k=_e[0],v=_e[1]; _en+='<tr><td><code>'+k+'</code></td><td><span class="tz-badge">'+(v||'—')+'</span></td></tr>';}); return _en;})();
}

async function loadSettings() {
    const res = await fetchWithAuth('/api/settings');
    if (!res || !res.ok) return;
    currentSettings = await res.json();
    const tz = currentSettings.app_timezone || 'America/New_York';
    document.getElementById('currentTzBadge').textContent = tz;
    document.getElementById('appNameInput').value = currentSettings.app_name || '';
    populateTzSelect(tz);
    renderSettingsTable(currentSettings);
    updateClocks(tz);
    // Initialize 2FA toggle from loaded settings
    initTwoFaToggle(currentSettings.require_2fa !== 'false');
}

function showSaved(id) {
    const el = document.getElementById(id);
    el.classList.add('visible');
    setTimeout(() => el.classList.remove('visible'), 2500);
}

// ────────────────────────────────────────────────────────────────────────────
// 2FA GLOBAL TOGGLE
// ────────────────────────────────────────────────────────────────────────────
function initTwoFaToggle(enabled) {
    const toggle  = document.getElementById('twoFaToggle');
    if (!toggle) return;
    toggle.checked = enabled;
    _updateTwoFaUI(enabled);
    toggle.addEventListener('change', () => _updateTwoFaUI(toggle.checked));
}

function _updateTwoFaUI(enabled) {
    const badge   = document.getElementById('twoFaBadge');
    const label   = document.getElementById('twoFaToggleLabel');
    const dot     = document.getElementById('twoFaDot');
    const statusT = document.getElementById('twoFaStatusText');
    const warn    = document.getElementById('twoFaDisabledWarning');
    if (enabled) {
        badge.className   = 'badge bg-success';
        badge.textContent = 'Enabled';
        label.innerHTML   = '2FA is <strong>Enabled</strong>';
        dot.style.background = '#22c55e';
        statusT.textContent  = 'Active';
        if (warn) warn.style.display = 'none';
    } else {
        badge.className   = 'badge bg-danger';
        badge.textContent = 'Disabled';
        label.innerHTML   = '2FA is <strong>Disabled</strong>';
        dot.style.background = '#ef4444';
        statusT.textContent  = 'Bypassed';
        if (warn) warn.style.display = '';
    }
}

// ────────────────────────────────────────────────────────────────────────────
// API KEYS TAB
// ────────────────────────────────────────────────────────────────────────────
let deleteKeyId   = null;
let deleteModal   = null;

function formatRelative(dateStr) {
    if (!dateStr) return '<span class="text-muted">—</span>';
    const d   = new Date(dateStr);
    const now = new Date();
    const diff = now - d;
    if (diff < 60000)    return 'just now';
    if (diff < 3600000)  return Math.floor(diff/60000)  + 'm ago';
    if (diff < 86400000) return Math.floor(diff/3600000) + 'h ago';
    return d.toLocaleDateString();
}

function formatExpiry(dateStr) {
    if (!dateStr) return '<span class="text-muted small">Never</span>';
    const d   = new Date(dateStr);
    const now = new Date();
    if (d < now) return '<span class="badge bg-danger">Expired</span>';
    const days = Math.ceil((d - now) / 86400000);
    if (days <= 14) return `<span class="expiry-warning"><i class="fas fa-exclamation-triangle me-1"></i>${days}d left</span>`;
    return `<span class="text-muted small">${d.toLocaleDateString()}</span>`;
}

async function loadApiKeys() {
    const tbody = document.getElementById('apiKeysBody');
    tbody.innerHTML = '<tr><td colspan="8" class="text-center py-3"><i class="fas fa-spinner fa-spin me-2"></i>Loading...</td></tr>';
    const res = await fetchWithAuth('/api/api-keys');
    if (!res || !res.ok) { tbody.innerHTML = '<tr><td colspan="8" class="text-center text-danger">Failed to load keys</td></tr>'; return; }
    const keys = await res.json();
    if (!keys.length) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted py-4"><i class="fas fa-key fa-2x mb-2 d-block opacity-25"></i>No API keys yet — generate one to get started.</td></tr>';
        return;
    }
    var _kHtml=''; for(var _ki=0;_ki<keys.length;_ki++){var k=keys[_ki]; _kHtml+=(function(){
        const creator = k.CreatedBy ? (k.CreatedBy.firstName + ' ' + k.CreatedBy.lastName) : 'System';
        const statusDot = k.isActive
            ? '<span class="status-dot active"></span><span class="text-success small fw-semibold">Active</span>'
            : '<span class="status-dot inactive"></span><span class="text-danger small fw-semibold">Disabled</span>';
        const toggleIcon   = k.isActive ? 'fa-toggle-on text-success' : 'fa-toggle-off text-muted';
        const toggleTitle  = k.isActive ? 'Disable key' : 'Enable key';
        return `
        <tr class="key-row" data-id="${k.id}">
            <td>
                <div class="fw-semibold">${k.name}</div>
                ${k.description ? `<div class="text-muted small">${k.description}</div>` : ''}
            </td>
            <td><span class="key-prefix">${k.keyPrefix}…</span></td>
            <td>${statusDot}</td>
            <td><span class="text-muted small">${creator}</span></td>
            <td><span class="text-muted small">${formatRelative(k.createdAt)}</span></td>
            <td><span class="text-muted small">${formatRelative(k.lastUsedAt)}</span></td>
            <td>${formatExpiry(k.expiresAt)}</td>
            <td class="text-end">
                <button class="btn btn-sm btn-outline-secondary me-1 toggle-key-btn" data-id="${k.id}" title="${toggleTitle}">
                    <i class="fas ${toggleIcon}"></i>
                </button>
                <button class="btn btn-sm btn-outline-danger delete-key-btn" data-id="${k.id}" data-name="${k.name}">
                    <i class="fas fa-trash"></i>
                </button>
            </td>
        </tr>`;
    })(); } tbody.innerHTML=_kHtml;
}

// ────────────────────────────────────────────────────────────────────────────
// TAB SWITCHING
// ────────────────────────────────────────────────────────────────────────────
function switchTab(tab) {
    document.querySelectorAll('#settingsTabs .nav-link').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('[id^="tab-"]').forEach(t => t.classList.add('d-none'));
    document.getElementById('tab-' + tab).classList.remove('d-none');
    document.querySelector(`[data-tab="${tab}"]`).classList.add('active');
    if (tab === 'apikeys') loadApiKeys();
    if (tab === 'email') loadEmailSettings();
}

// ────────────────────────────────────────────────────────────────────────────
// DOMContentLoaded
// ────────────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    initApp();

    const user = JSON.parse(localStorage.getItem('user') || '{}');
    if (user.role !== 'Administrator') {
        document.getElementById('settingsContent').classList.add('d-none');
        document.getElementById('adminGuard').classList.remove('d-none');
        return;
    }

    await loadSettings();
    deleteModal = new bootstrap.Modal(document.getElementById('deleteKeyModal'));

    clockInterval = setInterval(() => {
        const tz = document.getElementById('tzSelect')?.value || currentSettings.app_timezone || 'UTC';
        updateClocks(tz);
    }, 1000);

    // ── Tab switching ──────────────────────────────────────────────────────
    document.querySelectorAll('#settingsTabs .nav-link').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));

    // Auto-open tab from URL param: ?tab=manual, ?tab=email, etc.
    const _urlTab = new URLSearchParams(location.search).get('tab');
    if (_urlTab && document.getElementById('tab-' + _urlTab)) {
        switchTab(_urlTab);
    }
    });

    // ── Save Timezone ──────────────────────────────────────────────────────
    document.getElementById('saveTzBtn').addEventListener('click', async () => {
        const tz  = document.getElementById('tzSelect').value;
        if (!tz) return;
        const btn = document.getElementById('saveTzBtn');
        btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Saving...';
        try {
            const res = await fetchWithAuth('/api/settings', { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ app_timezone:tz }) });
            if (res && res.ok) {
                const data = await res.json();
                currentSettings = data.settings;
                document.getElementById('currentTzBadge').textContent = tz;
                renderSettingsTable(currentSettings);
                showSaved('tzSaveOk');
                showToast('Timezone updated to ' + tz, 'success');
            } else {
                const err = await res.json();
                showToast(err.error || 'Failed to save timezone', 'danger');
            }
        } catch(e) { showToast('Network error', 'danger'); }
        finally { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save me-1"></i>Save Timezone'; }
    });

    // ── Save App Name ──────────────────────────────────────────────────────
    document.getElementById('saveNameBtn').addEventListener('click', async () => {
        const name = document.getElementById('appNameInput').value.trim();
        if (!name) { showToast('App name cannot be empty', 'warning'); return; }
        const btn = document.getElementById('saveNameBtn');
        btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Saving...';
        try {
            const res = await fetchWithAuth('/api/settings', { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ app_name:name }) });
            if (res && res.ok) {
                const data = await res.json();
                currentSettings = data.settings;
                renderSettingsTable(currentSettings);
                showSaved('nameSaveOk');
                showToast('App name updated!', 'success');
            } else { showToast('Failed to save name', 'danger'); }
        } catch(e) { showToast('Network error', 'danger'); }
        finally { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save me-1"></i>Save Name'; }
    });

    // ── Save Global 2FA Setting ────────────────────────────────────────────
    document.getElementById('saveTwoFaBtn')?.addEventListener('click', async () => {
        const enabled = document.getElementById('twoFaToggle').checked;
        const btn = document.getElementById('saveTwoFaBtn');
        btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Saving...';
        try {
            const res = await fetchWithAuth('/api/settings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ require_2fa: String(enabled) })
            });
            if (res && res.ok) {
                const data = await res.json();
                currentSettings = data.settings;
                renderSettingsTable(currentSettings);
                showSaved('twoFaSaveOk');
                showToast('2FA setting ' + (enabled ? 'enabled' : 'disabled') + ' globally', enabled ? 'success' : 'warning');
            } else { showToast('Failed to save 2FA setting', 'danger'); }
        } catch(e) { showToast('Network error', 'danger'); }
        finally { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save me-1"></i>Save 2FA Setting'; }
    });

    // ── Show/Hide generate form ────────────────────────────────────────────
    document.getElementById('showGenerateFormBtn').addEventListener('click', () => {
        document.getElementById('generateFormCard').classList.remove('d-none');
        document.getElementById('showGenerateFormBtn').classList.add('d-none');
        document.getElementById('newKeyBanner').classList.add('d-none');
        document.getElementById('keyName').focus();
    });
    document.getElementById('cancelGenerateBtn').addEventListener('click', () => {
        document.getElementById('generateFormCard').classList.add('d-none');
        document.getElementById('showGenerateFormBtn').classList.remove('d-none');
    });

    // ── Generate API Key ───────────────────────────────────────────────────
    document.getElementById('generateKeyBtn').addEventListener('click', async () => {
        const name = document.getElementById('keyName').value.trim();
        const desc = document.getElementById('keyDescription').value.trim();
        const exp  = document.getElementById('keyExpiry').value;
        if (!name) { showToast('Please enter a name for the API key', 'warning'); document.getElementById('keyName').focus(); return; }

        const btn = document.getElementById('generateKeyBtn');
        btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Generating...';

        try {
            const res = await fetchWithAuth('/api/api-keys', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, description: desc || undefined, expiresIn: exp })
            });
            if (res && res.ok) {
                const data = await res.json();
                // Show the key ONCE
                document.getElementById('newKeyValue').textContent = data.fullKey;
                document.getElementById('newKeyBanner').classList.remove('d-none');
                document.getElementById('generateFormCard').classList.add('d-none');
                document.getElementById('showGenerateFormBtn').classList.remove('d-none');
                // Clear the form
                document.getElementById('keyName').value = '';
                document.getElementById('keyDescription').value = '';
                document.getElementById('keyExpiry').value = 'never';
                // Refresh the list
                await loadApiKeys();
                showToast('API key generated — copy it now!', 'success');
            } else {
                const err = await res.json();
                showToast(err.error || 'Failed to generate key', 'danger');
            }
        } catch(e) { showToast('Network error', 'danger'); }
        finally { btn.disabled = false; btn.innerHTML = '<i class="fas fa-key me-1"></i>Generate Key'; }
    });

    // ── Copy key to clipboard ──────────────────────────────────────────────
    document.getElementById('copyKeyBtn').addEventListener('click', () => {
        const key = document.getElementById('newKeyValue').textContent;
        navigator.clipboard.writeText(key).then(() => {
            const btn = document.getElementById('copyKeyBtn');
            btn.innerHTML = '<i class="fas fa-check me-1"></i>Copied!';
            btn.classList.replace('btn-outline-success','btn-success');
            setTimeout(() => { btn.innerHTML = '<i class="fas fa-copy me-1"></i>Copy Key'; btn.classList.replace('btn-success','btn-outline-success'); }, 2000);
        }).catch(() => showToast('Could not copy — please copy manually', 'warning'));
    });

    // ── Refresh keys list ──────────────────────────────────────────────────
    document.getElementById('refreshKeysBtn').addEventListener('click', loadApiKeys);

    // ── Toggle & Delete (event delegation) ────────────────────────────────
    document.getElementById('apiKeysBody').addEventListener('click', async (e) => {
        const toggleBtn = e.target.closest('.toggle-key-btn');
        const deleteBtn = e.target.closest('.delete-key-btn');

        if (toggleBtn) {
            const id = toggleBtn.dataset.id;
            toggleBtn.disabled = true;
            try {
                const res = await fetchWithAuth(`/api/api-keys/${id}/toggle`, { method:'PATCH' });
                if (res && res.ok) { await loadApiKeys(); }
                else { showToast('Failed to toggle key', 'danger'); }
            } finally { toggleBtn.disabled = false; }
        }

        if (deleteBtn) {
            deleteKeyId = deleteBtn.dataset.id;
            document.getElementById('deleteKeyName').textContent = '"' + deleteBtn.dataset.name + '"';
            deleteModal.show();
        }
    });

    // ── Confirm delete ─────────────────────────────────────────────────────
    document.getElementById('confirmDeleteKeyBtn').addEventListener('click', async () => {
        if (!deleteKeyId) return;
        const btn = document.getElementById('confirmDeleteKeyBtn');
        btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Revoking...';
        try {
            const res = await fetchWithAuth(`/api/api-keys/${deleteKeyId}`, { method:'DELETE' });
            if (res && (res.ok || res.status === 204)) {
                deleteModal.hide();
                await loadApiKeys();
                showToast('API key revoked permanently', 'success');
            } else { showToast('Failed to revoke key', 'danger'); }
        } finally { btn.disabled = false; btn.innerHTML = '<i class="fas fa-trash me-1"></i>Revoke Key'; deleteKeyId = null; }
    });
});



// ────────────────────────────────────────────────────────────────────────────
// EMAIL SETTINGS TAB
// ────────────────────────────────────────────────────────────────────────────
let _emailLoaded = false;

async function loadEmailSettings() {
    if (_emailLoaded) return;
    _emailLoaded = true;
    try {
        const res = await fetchWithAuth('/api/settings/email-status');
        if (!res || !res.ok) return;
        const d = await res.json();

        document.getElementById('smtpHost').value     = d.smtp_host      || '';
        document.getElementById('smtpPort').value     = d.smtp_port      || '587';
        document.getElementById('smtpUser').value     = d.smtp_user      || '';
        document.getElementById('smtpFromName').value = d.smtp_from_name || 'Patient RX System';

        const hint = document.getElementById('smtpPassHint');
        if (d.smtp_pass_set) {
            hint.textContent = '(password already saved — leave blank to keep)';
            hint.style.color = '#22c55e';
        } else {
            hint.textContent = '(not set)';
            hint.style.color = '#f59e0b';
        }

        const badge = document.getElementById('emailStatusBadge');
        if (d.configured) {
            badge.className = 'badge bg-success';
            badge.innerHTML = '<i class="fas fa-check me-1"></i>Configured';
        } else {
            badge.className = 'badge bg-warning text-dark';
            badge.innerHTML = '<i class="fas fa-exclamation-triangle me-1"></i>Not Configured';
        }

        // Show Gmail guide if Gmail is the host
        if (d.smtp_host && d.smtp_host.includes('gmail')) {
            document.getElementById('gmailGuide').classList.remove('d-none');
        }
    } catch(e) { console.error('loadEmailSettings:', e); }
}

document.addEventListener('DOMContentLoaded', () => {

    // Provider quick-fill buttons
    document.getElementById('providerBtns')?.addEventListener('click', (e) => {
        const btn = e.target.closest('.provider-btn');
        if (!btn) return;
        document.getElementById('smtpHost').value = btn.dataset.host;
        document.getElementById('smtpPort').value = btn.dataset.port;
        const guide = document.getElementById('gmailGuide');
        if (btn.dataset.host.includes('gmail')) guide.classList.remove('d-none');
        else guide.classList.add('d-none');
        // Highlight the selected provider button
        document.querySelectorAll('.provider-btn').forEach(b => b.classList.remove('btn-primary', 'text-white'));
        btn.classList.add('btn-primary', 'text-white');
    });

    // Show/hide password
    document.getElementById('togglePassBtn')?.addEventListener('click', () => {
        const input = document.getElementById('smtpPass');
        const icon  = document.querySelector('#togglePassBtn i');
        if (input.type === 'password') { input.type = 'text';     icon.className = 'fas fa-eye-slash'; }
        else                           { input.type = 'password'; icon.className = 'fas fa-eye'; }
    });

    // Save SMTP settings
    document.getElementById('saveSmtpBtn')?.addEventListener('click', async () => {
        const btn = document.getElementById('saveSmtpBtn');
        btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Saving...';
        try {
            const payload = {
                smtp_host:      document.getElementById('smtpHost').value.trim(),
                smtp_port:      document.getElementById('smtpPort').value.trim(),
                smtp_user:      document.getElementById('smtpUser').value.trim(),
                smtp_from_name: document.getElementById('smtpFromName').value.trim()
            };
            const pass = document.getElementById('smtpPass').value;
            if (pass) payload.smtp_pass = pass;

            const res = await fetchWithAuth('/api/settings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (res && res.ok) {
                showSaved('smtpSaveOk');
                showToast('Email settings saved!', 'success');
                document.getElementById('smtpPass').value = '';
                const hint = document.getElementById('smtpPassHint');
                if (pass) { hint.textContent = '(password saved)'; hint.style.color = '#22c55e'; }
                // Update status badge
                const badge = document.getElementById('emailStatusBadge');
                if (payload.smtp_user && (pass || pass === undefined)) {
                    badge.className = 'badge bg-success';
                    badge.innerHTML = '<i class="fas fa-check me-1"></i>Configured';
                }
                _emailLoaded = false; // allow refresh next time tab opens
            } else {
                const err = await res.json();
                showToast(err.error || 'Failed to save settings', 'danger');
            }
        } catch(e) { showToast('Network error: ' + e.message, 'danger'); }
        finally { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save me-1"></i>Save Settings'; }
    });

    // Test connection (SMTP ping only)
    document.getElementById('testSmtpSettingsBtn')?.addEventListener('click', async () => {
        const btn  = document.getElementById('testSmtpSettingsBtn');
        const alert = document.getElementById('smtpTestInlineResult');
        btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Testing...';
        alert.className = 'alert d-none mt-3 mb-0';
        try {
            const res = await fetchWithAuth('/api/email-report/test', { method: 'POST' });
            const data = await res.json();
            if (res.ok && data.ok) {
                alert.className = 'alert alert-success mt-3 mb-0';
                alert.innerHTML = '<i class="fas fa-check-circle me-2"></i><strong>Connection successful!</strong> SMTP is working correctly with <strong>' + (data.user || 'your account') + '</strong>.';
            } else {
                throw new Error(data.error || 'Unknown error');
            }
        } catch(e) {
            alert.className = 'alert alert-danger mt-3 mb-0';
            alert.innerHTML = '<i class="fas fa-times-circle me-2"></i><strong>Connection failed:</strong> ' + e.message + '<br><small class="text-muted mt-1 d-block">Check your email address, password, and port. For Gmail use an App Password.</small>';
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-plug me-1"></i>Test Connection';
            alert.classList.remove('d-none');
        }
    });

    // Send a test email to verify end-to-end
    document.getElementById('sendTestEmailBtn')?.addEventListener('click', async () => {
        const to = document.getElementById('testEmailTo').value.trim();
        if (!to) { document.getElementById('testEmailTo').focus(); return; }
        const btn  = document.getElementById('sendTestEmailBtn');
        const alert = document.getElementById('testEmailResult');
        btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Sending...';
        alert.className = 'alert d-none mt-2 mb-0 py-2 small';
        try {
            const res = await fetchWithAuth('/api/email-report', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    to,
                    reportType: 'summary',
                    subject: 'Patient RX System — Test Email'
                })
            });
            const data = await res.json();
            if (res.ok && data.ok) {
                alert.className = 'alert alert-success mt-2 mb-0 py-2 small';
                alert.innerHTML = '<i class="fas fa-check me-1"></i>Test email sent to <strong>' + to + '</strong>! Check your inbox.';
            } else {
                throw new Error(data.error || (data.hint ? data.error + ' — ' + data.hint : 'Unknown error'));
            }
        } catch(e) {
            alert.className = 'alert alert-danger mt-2 mb-0 py-2 small';
            alert.innerHTML = '<i class="fas fa-times me-1"></i>' + e.message;
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-paper-plane me-1"></i>Send Test';
            alert.classList.remove('d-none');
        }
    });
});
// ────────────────────────────────────────────────────────────────────────────
// API REFERENCE — dynamic, loaded live from /api/settings/api-routes
// ────────────────────────────────────────────────────────────────────────────

let _apiRoutesCache = null;   // cached response to avoid repeat fetches

// ── Render a single endpoint row ─────────────────────────────────────────────
function renderEndpointRow(ep) {
    const m = ep.method.toLowerCase();
    const pathHtml = ep.path.replace(/:([a-zA-Z]+)/g, '<span style="color:#f59e0b">:$1</span>');
    const queryHtml = ep.query ? `<span style="color:#8b949e">${ep.query}</span>` : '';
    const bodyHtml  = ep.body  ? `<span class="text-muted small ms-2" style="font-size:.7rem">Body: <code style="color:#22c55e">${ep.body}</code></span>` : '';
    const permHtml  = `<span class="perm-badge ${ep.admin ? 'admin' : ''}">${ep.admin ? '🔒 ' + ep.perm : ep.perm}</span>`;
    const newBadge  = ep.inManifest === false ? '<span class="badge bg-info ms-1" style="font-size:.65rem">NEW</span>' : '';
    return `
        <div class="endpoint-row ${m}">
            <div class="d-flex align-items-start gap-2">
                <span class="method-badge ${m}">${ep.method}</span>
                <div class="flex-grow-1">
                    <span class="endpoint-path">${ep.path}${pathHtml !== ep.path ? '' : ''}${queryHtml}</span>
                    ${newBadge}
                    ${bodyHtml}
                    <div class="text-muted small mt-1">${ep.desc} &nbsp; ${permHtml}</div>
                </div>
                <button class="btn btn-xs btn-outline-secondary ms-auto copy-endpoint-btn"
                    style="font-size:.7rem;padding:2px 8px;flex-shrink:0;"
                    data-ep="${ep.method} ${window.location.origin}${ep.path}${ep.query || ''}">Copy URL</button>
            </div>
        </div>`;
}

// ── Render sections (filtered) ────────────────────────────────────────────────
function renderApiReference(filter, sections) {
    const container = document.getElementById('apiEndpointsList');
    if (!container) return;
    const toRender = filter === 'all' ? sections : sections.filter(s => s.id === filter);
    if (!toRender.length) {
        container.innerHTML = '<p class="text-muted small">No endpoints in this category.</p>';
        return;
    }
    container.innerHTML = toRender.map(sec => `
        <div class="mb-3">
            <div class="section-divider">
                <span style="color:${sec.color};font-size:.85rem;">●</span>
                &nbsp;${sec.label}
                <span class="ms-2 text-muted" style="font-size:.65rem;font-weight:400">
                    (${sec.endpoints.length} endpoint${sec.endpoints.length !== 1 ? 's' : ''})
                </span>
            </div>
            ${(function(){var _ep=''; sec.endpoints.forEach(function(ep){_ep+=renderEndpointRow(ep);}); return _ep;})()}
        </div>
    `).join('');

    container.querySelectorAll('.copy-endpoint-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            navigator.clipboard.writeText(btn.dataset.ep).then(() => {
                const orig = btn.textContent;
                btn.textContent = 'Copied!';
                setTimeout(() => { btn.textContent = orig; }, 1500);
            });
        });
    });
}

// ── Rebuild filter pills dynamically from loaded sections ─────────────────────
function rebuildFilterPills(sections) {
    const pillsDiv = document.getElementById('apiFilterPills');
    if (!pillsDiv) return;
    var _ph='<button class="btn btn-xs api-filter active" data-filter="all">All ('+sections.reduce(function(sum,s){return sum+s.endpoints.length;},0)+')</button>';
    for(var _pi=0;_pi<sections.length;_pi++){var s=sections[_pi]; _ph+='<button class="btn btn-xs api-filter" data-filter="'+s.id+'">'+s.label+' ('+s.endpoints.length+')</button>';}
    pillsDiv.innerHTML = _ph;
    pillsDiv.querySelectorAll('.api-filter').forEach(pill => {
        pill.addEventListener('click', () => {
            pillsDiv.querySelectorAll('.api-filter').forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
            renderApiReference(pill.dataset.filter, _apiRoutesCache);
        });
    });
}

// ── Load and render the API reference ────────────────────────────────────────
async function loadApiReference() {
    const container = document.getElementById('apiEndpointsList');
    if (!container) return;

    if (_apiRoutesCache) {
        renderApiReference('all', _apiRoutesCache);
        return;
    }

    container.innerHTML = '<div class="text-center text-muted py-3"><i class="fas fa-spinner fa-spin me-2"></i>Loading API reference...</div>';

    try {
        const res = await fetchWithAuth('/api/settings/api-routes');
        if (!res || !res.ok) throw new Error('Failed to fetch routes');
        const data = await res.json();
        _apiRoutesCache = data.sections;

        // Update total count badge in the toggle button
        const totalEl = document.getElementById('apiRoutesTotal');
        if (totalEl) totalEl.textContent = data.totalRoutes + ' endpoints';

        rebuildFilterPills(data.sections);
        renderApiReference('all', data.sections);
    } catch (e) {
        container.innerHTML = `<div class="alert alert-danger py-2 small"><i class="fas fa-times me-1"></i>Could not load API routes: ${e.message}</div>`;
    }
}

// ── Toggle button: load live routes on first open ─────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    const toggleBtn = document.getElementById('toggleApiRefBtn');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            const panel = document.getElementById('apiRefPanel');
            const isHidden = panel.classList.toggle('d-none');
            toggleBtn.innerHTML = isHidden
                ? '<i class="fas fa-book me-1"></i>Show API Reference'
                : '<i class="fas fa-times me-1"></i>Hide Reference';
            if (!isHidden) loadApiReference();   // fetch live routes on first expand
        });
    }

    // Refresh button inside the reference panel
    document.getElementById('refreshApiRoutesBtn')?.addEventListener('click', () => {
        _apiRoutesCache = null;   // bust cache
        loadApiReference();
    });
});


// Copy a command block's text to clipboard
function copyCmd(elementId, btn) {
    const el = document.getElementById(elementId);
    if (!el) return;
    const text = el.innerText || el.textContent;
    navigator.clipboard.writeText(text).then(() => {
        const orig = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-check me-1"></i>Copied!';
        btn.style.background = 'rgba(34,197,94,.3)';
        btn.style.color = '#4ade80';
        setTimeout(() => {
            btn.innerHTML = orig;
            btn.style.background = '';
            btn.style.color = '';
        }, 2000);
    }).catch(() => {
        showToast('Could not copy — please copy manually', 'warning');
    });
}

// Generic copy to clipboard (for IP button)
function copyToClipboard(text, btn) {
    if (!text || !text.trim()) return;
    navigator.clipboard.writeText(text.trim()).then(() => {
        const orig = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-check"></i> Copied!';
        setTimeout(() => { btn.innerHTML = orig; }, 1800);
    });
}

// Copy a command block's text to clipboard
function copyCmd(elementId, btn) {
    const el = document.getElementById(elementId);
    if (!el) return;
    const text = el.innerText || el.textContent;
    navigator.clipboard.writeText(text).then(() => {
        const orig = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-check me-1"></i>Copied!';
        btn.style.background = 'rgba(34,197,94,.3)';
        btn.style.color = '#4ade80';
        setTimeout(() => {
            btn.innerHTML = orig;
            btn.style.background = '';
            btn.style.color = '';
        }, 2000);
    }).catch(() => {
        showToast('Could not copy — please copy manually', 'warning');
    });
}

// Generic copy to clipboard (for IP button)
function copyToClipboard(text, btn) {
    if (!text || !text.trim()) return;
    navigator.clipboard.writeText(text.trim()).then(() => {
        const orig = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-check"></i> Copied!';
        setTimeout(() => { btn.innerHTML = orig; }, 1800);
    });
}