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
// TAB SWITCHING (General, Email, Manual only — API Keys moved to Backoffice)
// ────────────────────────────────────────────────────────────────────────────


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
