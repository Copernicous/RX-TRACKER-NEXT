// system-settings.js — General, Email, Manual tabs only.
// API Keys moved to Backoffice.

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
    document.getElementById('liveClock').textContent     = fmt;
    document.getElementById('liveTimezone').textContent  = tz + ' (' + off + ')';
    document.getElementById('previewClock').textContent  = fmt;
    document.getElementById('previewOffset').textContent = off;
    document.getElementById('previewUtc').textContent    = now.toISOString().replace('T',' ').slice(0,19) + ' UTC';
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
    tbody.innerHTML = (function(){ var _en=''; entries.forEach(function(_e){ var k=_e[0],v=_e[1]; _en+='<tr><td><code>'+k+'</code></td><td><span class="tz-badge">'+(v||'—')+'</span></td></tr>'; }); return _en; })();
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
    initTwoFaToggle(currentSettings.require_2fa !== 'false');
    // Security settings
    var sTimeout = document.getElementById('sessionTimeoutInput');
    var sMaxFail = document.getElementById('maxFailedLoginsInput');
    if (sTimeout) sTimeout.value = currentSettings.session_timeout_minutes || '30';
    if (sMaxFail) sMaxFail.value = currentSettings.max_failed_logins || '5';
}

function showSaved(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.add('visible');
    setTimeout(() => el.classList.remove('visible'), 2500);
}

// ────────────────────────────────────────────────────────────────────────────
// 2FA GLOBAL TOGGLE
// ────────────────────────────────────────────────────────────────────────────
function initTwoFaToggle(enabled) {
    const toggle = document.getElementById('twoFaToggle');
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
        if (badge)   { badge.className = 'badge bg-success'; badge.textContent = 'Enabled'; }
        if (label)   label.innerHTML = '2FA is <strong>Enabled</strong>';
        if (dot)     dot.style.background = '#22c55e';
        if (statusT) statusT.textContent = 'Active';
        if (warn)    warn.style.display = 'none';
    } else {
        if (badge)   { badge.className = 'badge bg-danger'; badge.textContent = 'Disabled'; }
        if (label)   label.innerHTML = '2FA is <strong>Disabled</strong>';
        if (dot)     dot.style.background = '#ef4444';
        if (statusT) statusT.textContent = 'Bypassed';
        if (warn)    warn.style.display = '';
    }
}

// ────────────────────────────────────────────────────────────────────────────
// TAB SWITCHING (General, Email, Manual — API Keys moved to Backoffice)
// ────────────────────────────────────────────────────────────────────────────
function switchTab(tab) {
    document.querySelectorAll('#settingsTabs .nav-link').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('[id^="tab-"]').forEach(t => t.classList.add('d-none'));
    const panel = document.getElementById('tab-' + tab);
    if (panel) panel.classList.remove('d-none');
    const btn = document.querySelector(`[data-tab="${tab}"]`);
    if (btn) btn.classList.add('active');
    if (tab === 'email') loadEmailSettings();
    if (tab === 'email-alerts') loadEmailAlertSettings();
}

// ────────────────────────────────────────────────────────────────────────────
// EMAIL SETTINGS TAB
// ────────────────────────────────────────────────────────────────────────────
let _emailLoaded = false;
let _emailAlertsLoaded = false;
let _emailAlertUsersLoaded = false;
let _emailAlertUsersCache = [];

const EMAIL_ALERT_RULE_GROUPS = [
    {
        title: 'Security',
        rules: [
            { key:'failed_login_threshold', title:'Failed login threshold', desc:'Repeated failed logins reach the configured threshold.' },
            { key:'account_locked', title:'Account locked', desc:'A user is locked because of too many failed attempts.' },
            { key:'missing_auth_spike', title:'Missing authentication spike', desc:'Unauthenticated requests reach the configured threshold.' },
            { key:'permission_denied_spike', title:'Permission denied spike', desc:'Access denied events increase above the normal level.' },
            { key:'admin_login', title:'Administrator login', desc:'An administrator or master account signs in.' },
            { key:'security_settings_changed', title:'Security settings changed', desc:'2FA, session timeout, or login limits are updated.' },
            { key:'api_key_changed', title:'API key changed', desc:'An API key is created, disabled, deleted, or regenerated.' }
        ]
    },
    {
        title: 'Patient and RX',
        rules: [
            { key:'expired_open_workflow', title:'Expired 90-day window', desc:'A patient is past the 90-day window with incomplete RX workflow.' },
            { key:'expiring_7_days', title:'7 days left', desc:'A service window is near expiration.' },
            { key:'no_service_date', title:'No service date', desc:'An active patient is missing a service date.' },
            { key:'active_no_rx', title:'Active patient with no RX', desc:'An active patient has no RX records.' },
            { key:'missing_required_info', title:'Missing required information', desc:'Patient or RX records are missing required workflow details.' },
            { key:'rx_stuck_workflow', title:'RX stuck in workflow', desc:'RX records remain in the same workflow stage past the expected time.' },
            { key:'service_date_override', title:'Service date override', desc:'A service date override or manual cycle adjustment is saved.' }
        ]
    },
    {
        title: 'System',
        rules: [
            { key:'backup_failed', title:'Backup failed', desc:'The latest backup job fails.' },
            { key:'backup_missing', title:'Backup missing', desc:'No successful backup is detected inside the expected window.' },
            { key:'critical_error', title:'Critical error spike', desc:'Application errors increase above the expected level.' },
            { key:'email_config_failure', title:'Email configuration failure', desc:'SMTP test or email delivery fails.' }
        ]
    }
];

function getDefaultEmailAlertRules() {
    const rules = {};
    EMAIL_ALERT_RULE_GROUPS.forEach(group => {
        group.rules.forEach(rule => { rules[rule.key] = false; });
    });
    return rules;
}

function getDefaultUserSubscriptions() {
    const subs = {};
    EMAIL_ALERT_RULE_GROUPS.forEach(group => {
        group.rules.forEach(rule => { subs[rule.key] = false; });
    });
    return subs;
}

function parseEmailAlertRules(raw) {
    const defaults = getDefaultEmailAlertRules();
    if (!raw) return defaults;
    try {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (!parsed || typeof parsed !== 'object') return defaults;
        return { ...defaults, ...parsed };
    } catch(e) {
        console.warn('Could not parse email alert rules:', e.message);
        return defaults;
    }
}

function renderEmailAlertRules(rules) {
    const wrap = document.getElementById('emailAlertRuleGroups');
    if (!wrap) return;

    wrap.innerHTML = EMAIL_ALERT_RULE_GROUPS.map(group => {
        const items = group.rules.map(rule => {
            const checked = rules[rule.key] ? 'checked' : '';
            return `
                <div class="col-xl-4 col-md-6">
                    <div class="email-alert-rule h-100">
                        <div class="form-check form-switch mb-0">
                            <input class="form-check-input email-alert-rule-input" type="checkbox" id="emailAlertRule_${rule.key}" data-rule="${rule.key}" ${checked}>
                            <label class="form-check-label w-100" for="emailAlertRule_${rule.key}">
                                <div class="email-alert-rule-title">${rule.title}</div>
                                <div class="email-alert-rule-desc">${rule.desc}</div>
                            </label>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
        return `
            <div class="email-alert-group-title">${group.title}</div>
            <div class="row g-2">${items}</div>
        `;
    }).join('');

    updateEmailAlertsStatus();
    populateEmailAlertTestSelect();
}

function collectEmailAlertRules() {
    const rules = getDefaultEmailAlertRules();
    document.querySelectorAll('.email-alert-rule-input').forEach(input => {
        rules[input.dataset.rule] = input.checked;
    });
    return rules;
}

function updateEmailAlertsStatus() {
    const enabled = !!document.getElementById('emailAlertsEnabled')?.checked;
    const label = document.getElementById('emailAlertsEnabledLabel');
    const badge = document.getElementById('emailAlertsStatusBadge');
    const countEl = document.getElementById('emailAlertsRuleCount');
    const rules = collectEmailAlertRules();
    const activeCount = Object.values(rules).filter(Boolean).length;

    if (label) label.innerHTML = enabled ? 'Alerts are <strong>enabled</strong>' : 'Alerts are disabled';
    if (badge) {
        if (enabled) {
            badge.className = activeCount ? 'badge bg-success' : 'badge bg-warning text-dark';
            badge.textContent = activeCount ? 'Enabled' : 'No conditions selected';
        } else {
            badge.className = 'badge bg-secondary';
            badge.textContent = 'Disabled';
        }
    }
    if (countEl) countEl.textContent = activeCount + ' active';
}

function populateEmailAlertTestSelect() {
    const select = document.getElementById('testEmailAlertKey');
    if (!select) return;
    const currentValue = select.value;
    const options = ['<option value="">Choose a condition...</option>'];
    EMAIL_ALERT_RULE_GROUPS.forEach(group => {
        options.push('<optgroup label="' + group.title + '">');
        group.rules.forEach(rule => {
            options.push('<option value="' + rule.key + '">' + rule.title + '</option>');
        });
        options.push('</optgroup>');
    });
    select.innerHTML = options.join('');
    if (currentValue) select.value = currentValue;
}

function parseUserSubscriptions(raw) {
    if (!raw) return {};
    try {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (e) {
        return {};
    }
}

function renderEmailAlertUsers(users, subscriptions) {
    const thead = document.getElementById('emailAlertUserHead');
    const wrap = document.getElementById('emailAlertUserList');
    if (!wrap) return;
    const flatRules = EMAIL_ALERT_RULE_GROUPS.flatMap(group => group.rules);
    if (thead) {
        thead.innerHTML = `
            <tr>
                <th style="min-width:220px;">User</th>
                ${flatRules.map(rule => `<th class="text-center" style="min-width:120px;">${rule.title}</th>`).join('')}
            </tr>
        `;
    }
    if (!users.length) {
        wrap.innerHTML = `<tr><td colspan="${1 + flatRules.length}" class="text-muted small py-3">No users with email addresses were found.</td></tr>`;
        return;
    }
    wrap.innerHTML = users.map(user => {
        const userSub = subscriptions[user.id] || getDefaultUserSubscriptions();
        return `
            <tr>
                <td>
                    <div class="fw-semibold">${user.firstName || ''} ${user.lastName || ''}</div>
                    <div class="text-muted small">@${user.username || ''} ${user.email ? '&bull; ' + user.email : ''}</div>
                </td>
                ${flatRules.map(rule => `<td class="text-center"><input class="form-check-input email-user-enabled" type="checkbox" data-user-id="${user.id}" data-field="${rule.key}" ${userSub[rule.key] ? 'checked' : ''}></td>`).join('')}
            </tr>
        `;
    }).join('');
}

function populateEmailAlertUserInspector(users) {
    const select = document.getElementById('inspectEmailAlertUser');
    if (!select) return;
    const currentValue = select.value;
    const options = ['<option value="">Choose a user...</option>'];
    users.forEach(user => {
        const name = ((user.firstName || '') + ' ' + (user.lastName || '')).trim() || user.username || ('User #' + user.id);
        const email = user.email ? ' - ' + user.email : '';
        options.push('<option value="' + user.id + '">' + name + ' (@' + (user.username || '') + ')' + email + '</option>');
    });
    select.innerHTML = options.join('');
    if (currentValue) select.value = currentValue;
}

function collectUserAlertSubscriptions() {
    const subs = {};
    document.querySelectorAll('.email-user-enabled').forEach(input => {
        const id = input.dataset.userId;
        const field = input.dataset.field;
        if (!subs[id]) subs[id] = getDefaultUserSubscriptions();
        subs[id][field] = input.checked;
    });
    return subs;
}

async function loadEmailAlertUsers(force) {
    if (_emailAlertUsersLoaded && !force) return;
    _emailAlertUsersLoaded = true;
    try {
        const [userRes, settingsRes] = await Promise.all([
            fetchWithAuth('/api/users?includeInactive=true'),
            fetchWithAuth('/api/settings')
        ]);
        if (!userRes || !userRes.ok || !settingsRes || !settingsRes.ok) return;
        const users = await userRes.json();
        const settingsData = await settingsRes.json();
        const subscriptions = parseUserSubscriptions(settingsData.email_alert_user_subscriptions);
        _emailAlertUsersCache = users.filter(u => u.email);
        renderEmailAlertUsers(_emailAlertUsersCache, subscriptions);
        populateEmailAlertUserInspector(_emailAlertUsersCache);
    } catch (e) {
        console.error('loadEmailAlertUsers:', e);
    }
}

async function saveEmailAlertUsers() {
    const subs = collectUserAlertSubscriptions();
    const res = await fetchWithAuth('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email_alert_user_subscriptions: JSON.stringify(subs) })
    });
    if (res && res.ok) {
        const data = await res.json();
        currentSettings = data.settings;
        renderSettingsTable(currentSettings);
        _emailAlertUsersLoaded = false;
        showToast('Per-user alert subscriptions saved.', 'success');
    } else {
        const err = await res.json();
        showToast(err.error || 'Failed to save user alert subscriptions', 'danger');
    }
}

async function loadEmailAlertSettings(force) {
    if (_emailAlertsLoaded && !force) return;
    _emailAlertsLoaded = true;
    try {
        const res = await fetchWithAuth('/api/settings');
        if (!res || !res.ok) return;
        const data = await res.json();
        currentSettings = data;

        const enabled = data.email_alerts_enabled === 'true';
        const enabledInput = document.getElementById('emailAlertsEnabled');
        const recipients = document.getElementById('emailAlertRecipients');
        if (enabledInput) enabledInput.checked = enabled;
        if (recipients) recipients.value = data.email_alerts_recipients || '';

        const failedLogin = document.getElementById('emailFailedLoginThreshold');
        const missingAuth = document.getElementById('emailMissingAuthThreshold');
        const cooldown = document.getElementById('emailCooldownMinutes');
        const digest = document.getElementById('emailDigestTime');
        if (failedLogin) failedLogin.value = data.email_alert_failed_login_threshold || '5';
        if (missingAuth) missingAuth.value = data.email_alert_missing_auth_threshold || '10';
        if (cooldown) cooldown.value = data.email_alert_cooldown_minutes || '60';
        if (digest) digest.value = data.email_alert_digest_time || '08:00';

        renderEmailAlertRules(parseEmailAlertRules(data.email_alert_rules));
        loadEmailAlertUsers(force).catch(() => {});
    } catch(e) {
        console.error('loadEmailAlertSettings:', e);
        showToast('Could not load email alert settings', 'danger');
    }
}

function resetEmailAlertConditions() {
    renderEmailAlertRules(getDefaultEmailAlertRules());
    showToast('Alert conditions reset in the form. Save to keep the reset.', 'warning');
}

async function saveEmailAlertSettings() {
    const btn = document.getElementById('saveEmailAlertsBtn');
    const enabled = !!document.getElementById('emailAlertsEnabled')?.checked;
    const recipients = (document.getElementById('emailAlertRecipients')?.value || '').trim();
    const rules = collectEmailAlertRules();
    const activeCount = Object.values(rules).filter(Boolean).length;

    if (enabled && !recipients) {
        document.getElementById('emailAlertRecipients')?.focus();
        showToast('Enter at least one alert recipient before enabling alerts.', 'warning');
        return;
    }
    if (enabled && activeCount === 0) {
        showToast('Select at least one alert condition before enabling alerts.', 'warning');
        return;
    }

    const invalidRecipients = recipients
        ? recipients.split(',').map(v => v.trim()).filter(Boolean).filter(v => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))
        : [];
    if (invalidRecipients.length) {
        showToast('Check recipient email: ' + invalidRecipients[0], 'warning');
        return;
    }

    const failedLoginThreshold = parseInt(document.getElementById('emailFailedLoginThreshold')?.value || '5', 10);
    const missingAuthThreshold = parseInt(document.getElementById('emailMissingAuthThreshold')?.value || '10', 10);
    const cooldownMinutes = parseInt(document.getElementById('emailCooldownMinutes')?.value || '60', 10);
    const digestTime = document.getElementById('emailDigestTime')?.value || '08:00';

    if (!Number.isFinite(failedLoginThreshold) || failedLoginThreshold < 1 || failedLoginThreshold > 100) {
        showToast('Failed login threshold must be 1-100.', 'warning');
        return;
    }
    if (!Number.isFinite(missingAuthThreshold) || missingAuthThreshold < 1 || missingAuthThreshold > 500) {
        showToast('Missing auth threshold must be 1-500.', 'warning');
        return;
    }
    if (!Number.isFinite(cooldownMinutes) || cooldownMinutes < 5 || cooldownMinutes > 1440) {
        showToast('Cooldown must be 5-1440 minutes.', 'warning');
        return;
    }

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Saving...';
    }

    try {
        const res = await fetchWithAuth('/api/settings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email_alerts_enabled: String(enabled),
                email_alerts_recipients: recipients,
                email_alert_rules: JSON.stringify(rules),
                email_alert_failed_login_threshold: String(failedLoginThreshold),
                email_alert_missing_auth_threshold: String(missingAuthThreshold),
                email_alert_cooldown_minutes: String(cooldownMinutes),
                email_alert_digest_time: digestTime
            })
        });
        if (res && res.ok) {
            const data = await res.json();
            currentSettings = data.settings;
            renderSettingsTable(currentSettings);
            showSaved('emailAlertsSaveOk');
            updateEmailAlertsStatus();
            showToast('Email alert settings saved.', 'success');
        } else {
            const err = await res.json();
            showToast(err.error || 'Failed to save email alert settings', 'danger');
        }
    } catch(e) {
        showToast('Network error: ' + e.message, 'danger');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-save me-1"></i>Save Alert Settings';
        }
    }
}

async function sendTestEmailAlert() {
    const select = document.getElementById('testEmailAlertKey');
    const alertKey = select?.value || '';
    const btn = document.getElementById('sendTestEmailAlertBtn');
    const result = document.getElementById('testEmailAlertResult');

    if (!alertKey) {
        showToast('Choose an alert condition first.', 'warning');
        if (select) select.focus();
        return;
    }

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Sending...';
    }
    if (result) result.className = 'alert d-none mt-3 mb-0 py-2 small';

    try {
        const url = typeof window.rxUrl === 'function'
            ? window.rxUrl('/api/settings/email-alerts/test')
            : '/api/settings/email-alerts/test';
        const res = await fetchWithAuth(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ alertKey })
        });
        const data = await res.json();
        if (res && res.ok) {
            if (result) {
                result.className = 'alert alert-success mt-3 mb-0 py-2 small';
                result.innerHTML = '<i class="fas fa-check me-1"></i>' + (data.message || 'Sample alert sent.') + ' Recipients: <strong>' + (data.recipients || []).join(', ') + '</strong>';
            }
            showToast('Sample alert email sent.', 'success');
        } else {
            throw new Error(data.error || 'Failed to send sample alert');
        }
    } catch (e) {
        if (result) {
            result.className = 'alert alert-danger mt-3 mb-0 py-2 small';
            result.innerHTML = '<i class="fas fa-times me-1"></i>' + e.message;
        }
        showToast(e.message, 'danger');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-paper-plane me-1"></i>Send Sample Alert';
        }
        if (result) result.classList.remove('d-none');
    }
}

function renderInspectedUserAlertConfig(data) {
    const wrap = document.getElementById('inspectEmailAlertResult');
    if (!wrap) return;
    const user = data.user || {};
    const enabled = Array.isArray(data.enabledAlertKeys) ? data.enabledAlertKeys : [];
    const inactiveGlobal = Array.isArray(data.inactiveGlobalAlertKeys) ? data.inactiveGlobalAlertKeys : [];
    const pretty = {};
    EMAIL_ALERT_RULE_GROUPS.forEach(group => {
        group.rules.forEach(rule => { pretty[rule.key] = rule.title; });
    });

    const lines = [];
    lines.push('<div class="fw-semibold mb-2">' + ((user.firstName || '') + ' ' + (user.lastName || '')).trim() + ' (@' + (user.username || '') + ')</div>');
    lines.push('<div class="mb-2">Email: <strong>' + (user.email || 'No email') + '</strong></div>');
    lines.push('<div class="mb-2">Master alerts: <strong>' + (data.alertsEnabled ? 'Enabled' : 'Disabled') + '</strong></div>');
    lines.push('<div class="mb-2">Enabled rules for this user: <strong>' + enabled.length + '</strong></div>');
    if (enabled.length) {
        lines.push('<div class="mb-2">This user will receive:</div><ul class="mb-2">' + enabled.map(key => '<li>' + (pretty[key] || key) + '</li>').join('') + '</ul>');
    } else {
        lines.push('<div class="mb-2 text-warning">This user has no alert subscriptions enabled.</div>');
    }
    if (inactiveGlobal.length) {
        lines.push('<div class="text-warning">These user rules are checked but globally inactive: <strong>' + inactiveGlobal.map(key => pretty[key] || key).join(', ') + '</strong></div>');
    }
    wrap.innerHTML = lines.join('');
}

async function inspectEmailAlertUserConfig() {
    const select = document.getElementById('inspectEmailAlertUser');
    const userId = select?.value || '';
    const btn = document.getElementById('inspectEmailAlertUserBtn');
    const wrap = document.getElementById('inspectEmailAlertResult');
    if (!userId) {
        showToast('Choose a user first.', 'warning');
        if (select) select.focus();
        return;
    }
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Loading...';
    }
    if (wrap) wrap.innerHTML = 'Loading user configuration...';
    try {
        const url = typeof window.rxUrl === 'function'
            ? window.rxUrl('/api/settings/email-alerts/user/' + encodeURIComponent(userId))
            : '/api/settings/email-alerts/user/' + encodeURIComponent(userId);
        const res = await fetchWithAuth(url);
        const raw = await res.text();
        let data;
        try {
            data = raw ? JSON.parse(raw) : {};
        } catch (parseErr) {
            throw new Error('Server returned HTML instead of JSON. Refresh the page and try again.');
        }
        if (res && res.ok) {
            renderInspectedUserAlertConfig(data);
        } else {
            throw new Error(data.error || 'Failed to load user configuration');
        }
    } catch (e) {
        if (wrap) wrap.innerHTML = '<span class="text-danger">' + e.message + '</span>';
        showToast(e.message, 'danger');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-search me-1"></i>Check User Config';
        }
    }
}

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
        if (hint) {
            if (d.smtp_pass_set) {
                hint.textContent = '(password already saved — leave blank to keep)';
                hint.style.color = '#22c55e';
            } else {
                hint.textContent = '(not set)';
                hint.style.color = '#f59e0b';
            }
        }

        const badge = document.getElementById('emailStatusBadge');
        if (badge) {
            if (d.configured) {
                badge.className = 'badge bg-success';
                badge.innerHTML = '<i class="fas fa-check me-1"></i>Configured';
            } else {
                badge.className = 'badge bg-warning text-dark';
                badge.innerHTML = '<i class="fas fa-exclamation-triangle me-1"></i>Not Configured';
            }
        }

        if (d.smtp_host && d.smtp_host.includes('gmail')) {
            document.getElementById('gmailGuide')?.classList.remove('d-none');
        }
    } catch(e) { console.error('loadEmailSettings:', e); }
}

// ────────────────────────────────────────────────────────────────────────────
// CLIPBOARD HELPERS
// ────────────────────────────────────────────────────────────────────────────
function copyCmd(elementId, btn) {
    const el = document.getElementById(elementId);
    if (!el) return;
    const text = el.innerText || el.textContent;
    navigator.clipboard.writeText(text).then(() => {
        const orig = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-check me-1"></i>Copied!';
        btn.style.background = 'rgba(34,197,94,.3)';
        btn.style.color = '#4ade80';
        setTimeout(() => { btn.innerHTML = orig; btn.style.background = ''; btn.style.color = ''; }, 2000);
    }).catch(() => showToast('Could not copy — please copy manually', 'warning'));
}

function copyToClipboard(text, btn) {
    if (!text || !text.trim()) return;
    navigator.clipboard.writeText(text.trim()).then(() => {
        const orig = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-check"></i> Copied!';
        setTimeout(() => { btn.innerHTML = orig; }, 1800);
    });
}

// ────────────────────────────────────────────────────────────────────────────
// DOMContentLoaded — wire up all buttons and init
// ────────────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    initApp();

    const user = JSON.parse(localStorage.getItem('user') || '{}');
    if (user.role !== 'Administrator') {
        document.getElementById('settingsContent')?.classList.add('d-none');
        document.getElementById('adminGuard')?.classList.remove('d-none');
        return;
    }

    await loadSettings();

    clockInterval = setInterval(() => {
        const tz = document.getElementById('tzSelect')?.value || currentSettings.app_timezone || 'UTC';
        updateClocks(tz);
    }, 1000);

    // ── Tab switching ──────────────────────────────────────────────────────
    document.querySelectorAll('#settingsTabs .nav-link').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // Auto-open tab from URL param: ?tab=manual, ?tab=email, etc.
    const _urlTab = new URLSearchParams(location.search).get('tab');
    if (_urlTab && document.getElementById('tab-' + _urlTab)) {
        switchTab(_urlTab);
    }

    document.getElementById('emailAlertsEnabled')?.addEventListener('change', updateEmailAlertsStatus);
    document.getElementById('emailAlertRuleGroups')?.addEventListener('change', (e) => {
        if (e.target?.classList?.contains('email-alert-rule-input')) updateEmailAlertsStatus();
    });
    document.getElementById('saveEmailAlertsBtn')?.addEventListener('click', saveEmailAlertSettings);
    document.getElementById('resetEmailAlertsBtn')?.addEventListener('click', resetEmailAlertConditions);
    document.getElementById('saveEmailAlertUsersBtn')?.addEventListener('click', saveEmailAlertUsers);
    document.getElementById('sendTestEmailAlertBtn')?.addEventListener('click', sendTestEmailAlert);
    document.getElementById('inspectEmailAlertUserBtn')?.addEventListener('click', inspectEmailAlertUserConfig);

    // ── Save Timezone ──────────────────────────────────────────────────────
    document.getElementById('saveTzBtn')?.addEventListener('click', async () => {
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
    document.getElementById('saveNameBtn')?.addEventListener('click', async () => {
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

    // -- Save Security Settings (Session Timeout + Max Failed Logins) --------
    document.getElementById('saveSecurityBtn')?.addEventListener('click', async () => {
        var timeout  = parseInt(document.getElementById('sessionTimeoutInput')?.value || '30', 10);
        var maxFails = parseInt(document.getElementById('maxFailedLoginsInput')?.value || '5',  10);
        var errEl    = document.getElementById('securityErrMsg');
        var errBox   = document.getElementById('securitySaveErr');
        if (isNaN(timeout)  || timeout  < 1  || timeout  > 480) {
            if (errEl) errEl.textContent = 'Timeout must be 1-480 minutes';
            if (errBox) errBox.classList.add('visible');
            setTimeout(() => errBox && errBox.classList.remove('visible'), 3000);
            return;
        }
        if (isNaN(maxFails) || maxFails < 1  || maxFails > 20) {
            if (errEl) errEl.textContent = 'Max logins must be 1-20';
            if (errBox) errBox.classList.add('visible');
            setTimeout(() => errBox && errBox.classList.remove('visible'), 3000);
            return;
        }
        var btn = document.getElementById('saveSecurityBtn');
        btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Saving...';
        try {
            var res = await fetchWithAuth('/api/settings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    session_timeout_minutes: String(timeout),
                    max_failed_logins:       String(maxFails)
                })
            });
            if (res && res.ok) {
                var data = await res.json();
                currentSettings = data.settings;
                renderSettingsTable(currentSettings);
                showSaved('securitySaveOk');
                showToast('Security settings saved. Restart server to apply session timeout.', 'success');
            } else {
                var err = await res.json();
                showToast(err.error || 'Failed to save security settings', 'danger');
            }
        } catch(e) { showToast('Network error: ' + e.message, 'danger'); }
        finally { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save me-1"></i>Save Security Settings'; }
    });

    // ── Email: Provider quick-fill ─────────────────────────────────────────
    document.getElementById('providerBtns')?.addEventListener('click', (e) => {
        const btn = e.target.closest('.provider-btn');
        if (!btn) return;
        document.getElementById('smtpHost').value = btn.dataset.host;
        document.getElementById('smtpPort').value = btn.dataset.port;
        const guide = document.getElementById('gmailGuide');
        if (guide) {
            if (btn.dataset.host.includes('gmail')) guide.classList.remove('d-none');
            else guide.classList.add('d-none');
        }
        document.querySelectorAll('.provider-btn').forEach(b => b.classList.remove('btn-primary','text-white'));
        btn.classList.add('btn-primary','text-white');
    });

    // ── Email: Show/hide password ──────────────────────────────────────────
    document.getElementById('togglePassBtn')?.addEventListener('click', () => {
        const input = document.getElementById('smtpPass');
        const icon  = document.querySelector('#togglePassBtn i');
        if (input.type === 'password') { input.type = 'text';     if (icon) icon.className = 'fas fa-eye-slash'; }
        else                           { input.type = 'password'; if (icon) icon.className = 'fas fa-eye'; }
    });

    // ── Email: Save SMTP settings ──────────────────────────────────────────
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
                if (pass && hint) { hint.textContent = '(password saved)'; hint.style.color = '#22c55e'; }
                const badge = document.getElementById('emailStatusBadge');
                if (badge && payload.smtp_user) {
                    badge.className = 'badge bg-success';
                    badge.innerHTML = '<i class="fas fa-check me-1"></i>Configured';
                }
                _emailLoaded = false;
            } else {
                const err = await res.json();
                showToast(err.error || 'Failed to save settings', 'danger');
            }
        } catch(e) { showToast('Network error: ' + e.message, 'danger'); }
        finally { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save me-1"></i>Save Settings'; }
    });

    // ── Email: Test SMTP connection ────────────────────────────────────────
    document.getElementById('testSmtpSettingsBtn')?.addEventListener('click', async () => {
        const btn   = document.getElementById('testSmtpSettingsBtn');
        const alert = document.getElementById('smtpTestInlineResult');
        btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Testing...';
        if (alert) alert.className = 'alert d-none mt-3 mb-0';
        try {
            const res  = await fetchWithAuth('/api/email-report/test', { method: 'POST' });
            const data = await res.json();
            if (res.ok && data.ok) {
                if (alert) {
                    alert.className = 'alert alert-success mt-3 mb-0';
                    alert.innerHTML = '<i class="fas fa-check-circle me-2"></i><strong>Connection successful!</strong> SMTP is working with <strong>' + (data.user || 'your account') + '</strong>.';
                }
            } else { throw new Error(data.error || 'Unknown error'); }
        } catch(e) {
            if (alert) {
                alert.className = 'alert alert-danger mt-3 mb-0';
                alert.innerHTML = '<i class="fas fa-times-circle me-2"></i><strong>Connection failed:</strong> ' + e.message + '<br><small class="text-muted mt-1 d-block">Check your email, password, and port. For Gmail use an App Password.</small>';
            }
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-plug me-1"></i>Test Connection';
            if (alert) alert.classList.remove('d-none');
        }
    });

    // ── Email: Send test email ─────────────────────────────────────────────
    document.getElementById('sendTestEmailBtn')?.addEventListener('click', async () => {
        const to   = document.getElementById('testEmailTo').value.trim();
        if (!to) { document.getElementById('testEmailTo')?.focus(); return; }
        const btn   = document.getElementById('sendTestEmailBtn');
        const alert = document.getElementById('testEmailResult');
        btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Sending...';
        if (alert) alert.className = 'alert d-none mt-2 mb-0 py-2 small';
        try {
            const res  = await fetchWithAuth('/api/email-report', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ to, reportType:'summary', subject:'Patient RX System — Test Email' })
            });
            const data = await res.json();
            if (res.ok && data.ok) {
                if (alert) {
                    alert.className = 'alert alert-success mt-2 mb-0 py-2 small';
                    alert.innerHTML = '<i class="fas fa-check me-1"></i>Test email sent to <strong>' + to + '</strong>! Check your inbox.';
                }
            } else { throw new Error(data.error || 'Unknown error'); }
        } catch(e) {
            if (alert) {
                alert.className = 'alert alert-danger mt-2 mb-0 py-2 small';
                alert.innerHTML = '<i class="fas fa-times me-1"></i>' + e.message;
            }
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-paper-plane me-1"></i>Send Test';
            if (alert) alert.classList.remove('d-none');
        }
    });
});
