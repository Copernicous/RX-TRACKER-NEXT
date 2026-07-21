/**
 * settingsService.js
 *
 * Singleton service that manages system settings (key/value pairs stored in the DB).
 * On startup it loads settings into memory. Any write also updates the in-memory cache
 * and — for the TZ key — immediately applies the timezone to the current Node process.
 *
 * SMTP settings (smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from_name) are also
 * stored here so admins can configure email from the System Settings UI without editing .env.
 * emailService reads from settingsService first, falling back to process.env.
 */

const crypto = require('crypto');

// ── Sensitive keys — never returned to the frontend ──────────────────────────
const SENSITIVE_KEYS = new Set(['smtp_pass']);
const ENCRYPTED_PREFIX = 'enc:v1:';

const DEFAULT_EMAIL_ALERT_RULES = JSON.stringify({
    failed_login_threshold: false,
    account_locked: false,
    missing_auth_spike: false,
    permission_denied_spike: false,
    admin_login: false,
    security_settings_changed: false,
    api_key_changed: false,
    expired_open_workflow: false,
    expiring_7_days: false,
    no_service_date: false,
    active_no_rx: false,
    missing_required_info: false,
    rx_stuck_workflow: false,
    service_date_override: false,
    backup_failed: false,
    backup_missing: false,
    critical_error: false,
    email_config_failure: false
});

const DEFAULTS = {
    app_timezone:  process.env.TZ          || 'America/New_York',
    app_name:      process.env.APP_NAME    || 'Patient RX System',
    // Global 2FA enforcement toggle (true = 2FA required for users who have it set up)
    require_2fa:   'true',
    // SMTP — seeded from .env if present, otherwise blank (user fills via UI)
    smtp_host:     process.env.SMTP_HOST   || 'smtp.gmail.com',
    smtp_port:     process.env.SMTP_PORT   || '587',
    smtp_user:     process.env.SMTP_USER   || '',
    smtp_pass:     process.env.SMTP_PASS   || '',
    smtp_from_name:process.env.SMTP_FROM_NAME || 'Patient RX System',
    // Email alert conditions. These are configuration only until alert jobs are enabled.
    email_alerts_enabled:              'false',
    email_alerts_recipients:           '',
    email_alert_rules:                 DEFAULT_EMAIL_ALERT_RULES,
    email_alert_user_subscriptions:    '{}',
    email_alert_failed_login_threshold:'5',
    email_alert_missing_auth_threshold:'10',
    email_alert_cooldown_minutes:      '60',
    email_alert_digest_time:           '08:00',
    // Security settings — editable from System Settings > Security card
    session_timeout_minutes: process.env.SESSION_TIMEOUT_MINUTES || '30',
    max_failed_logins:       process.env.MAX_FAILED_LOGINS        || '5'
};

exports.DEFAULTS = Object.freeze({ ...DEFAULTS });

let _cache = { ...DEFAULTS };
let _db = null;

// ── List of valid IANA timezone identifiers (common zones) ────────────────────
const KNOWN_TIMEZONES = [
    // Eastern US
    'America/New_York', 'America/Detroit',
    // Central US
    'America/Chicago', 'America/Winnipeg',
    // Mountain US
    'America/Denver', 'America/Phoenix',
    // Pacific US
    'America/Los_Angeles', 'America/Vancouver',
    // Other US
    'America/Anchorage', 'Pacific/Honolulu',
    // Caribbean / Atlantic
    'America/Puerto_Rico', 'America/Santo_Domingo', 'America/Barbados',
    'America/Jamaica', 'Atlantic/Bermuda',
    // UTC
    'UTC',
    // Europe
    'Europe/London', 'Europe/Madrid', 'Europe/Paris',
    'Europe/Berlin', 'Europe/Lisbon', 'Europe/Rome',
    // Latin America
    'America/Bogota', 'America/Lima', 'America/Caracas',
    'America/La_Paz', 'America/Sao_Paulo',
    'America/Argentina/Buenos_Aires', 'America/Santiago'
];

exports.KNOWN_TIMEZONES = KNOWN_TIMEZONES;

/**
 * Load all settings from the DB into the in-memory cache without writing.
 * Missing rows use in-memory defaults until the explicit database lifecycle
 * command seeds them.
 */
exports.load = async () => {
    if (!_db) _db = require('../models');
    _cache = { ...DEFAULTS };
    const rows = await _db.SystemSetting.findAll();
    for (const row of rows) {
        _cache[row.key] = _decryptSettingValue(row.key, row.value);
    }

    _applyTimezone(_cache['app_timezone']);
    _applySmtp();
    console.log(`[Settings] Loaded read-only. Timezone: ${_cache['app_timezone']} | SMTP: ${_cache['smtp_user'] || '(not set)'}`);
};

/**
 * Explicit lifecycle operation: create missing default rows and encrypt any
 * legacy plaintext sensitive values. This function is never called by normal
 * web-server startup.
 */
exports.initializeDefaults = async (database = null) => {
    if (database) _db = database;
    if (!_db) _db = require('../models');

    const rows = await _db.SystemSetting.findAll();
    const byKey = new Map(rows.map(row => [row.key, row]));
    let created = 0;
    let encrypted = 0;

    for (const [key, value] of Object.entries(DEFAULTS)) {
        const existing = byKey.get(key);
        if (!existing) {
            await _db.SystemSetting.create({
                key,
                value: _encryptSettingValue(key, value),
                description: `Default: ${key}`
            });
            created += 1;
            continue;
        }

        if (SENSITIVE_KEYS.has(key) && existing.value && !_isEncryptedValue(existing.value)) {
            const protectedValue = _encryptSettingValue(key, existing.value);
            if (protectedValue !== existing.value) {
                await existing.update({ value: protectedValue });
                encrypted += 1;
            }
        }
    }

    await exports.load();
    return { created, encrypted };
};

/**
 * Get a setting value by key. Returns the default if not found.
 */
exports.get = (key) => {
    return _cache[key] ?? DEFAULTS[key] ?? null;
};

/**
 * Set a setting value in the DB and update the in-memory cache.
 */
exports.set = async (key, value) => {
    if (!_db) _db = require('../models');
    const storedValue = _encryptSettingValue(key, value);
    const [row] = await _db.SystemSetting.findOrCreate({ where: { key }, defaults: { value: storedValue } });
    row.value = storedValue;
    await row.save();
    _cache[key] = value;

    if (key === 'app_timezone') _applyTimezone(value);

    // Re-apply SMTP settings to process.env whenever any smtp_ key changes
    if (key.startsWith('smtp_')) _applySmtp();
};

/**
 * Get all settings as a plain object, with sensitive keys masked.
 * @param {boolean} includeSensitive - set true for internal server-side use only
 */
exports.getAll = (includeSensitive = false) => {
    const copy = { ..._cache };
    if (!includeSensitive) {
        for (const k of SENSITIVE_KEYS) {
            if (copy[k]) copy[k] = '••••••••';   // mask; don't send password to browser
        }
    }
    return copy;
};

/**
 * Returns true if SMTP is fully configured (user + pass both set).
 */
exports.isSmtpConfigured = () => {
    return !!(_cache['smtp_user'] && _cache['smtp_pass']);
};

// ── Internal helpers ──────────────────────────────────────────────────────────

function _applyTimezone(tz) {
    if (!tz) return;
    process.env.TZ = tz;
}

function _isEncryptedValue(value) {
    return String(value || '').startsWith(ENCRYPTED_PREFIX);
}

function _encryptionSecret() {
    return process.env.SETTINGS_ENCRYPTION_KEY || process.env.JWT_SECRET || process.env.DB_PASS || '';
}

function _encryptionKey() {
    const secret = _encryptionSecret();
    if (!secret) return null;
    return crypto.createHash('sha256').update('patient-rx-settings:' + secret).digest();
}

function _encryptSettingValue(key, value) {
    const plain = String(value == null ? '' : value);
    if (!SENSITIVE_KEYS.has(key) || !plain || _isEncryptedValue(plain)) return plain;
    const keyBytes = _encryptionKey();
    if (!keyBytes) {
        console.warn(`[Settings] ${key} is not encrypted at rest because no encryption secret is configured.`);
        return plain;
    }
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', keyBytes, iv);
    const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ENCRYPTED_PREFIX + [
        iv.toString('base64url'),
        tag.toString('base64url'),
        ciphertext.toString('base64url')
    ].join(':');
}

function _decryptSettingValue(key, value) {
    const raw = String(value == null ? '' : value);
    if (!SENSITIVE_KEYS.has(key) || !raw || !_isEncryptedValue(raw)) return raw;
    const keyBytes = _encryptionKey();
    if (!keyBytes) {
        console.warn(`[Settings] ${key} could not be decrypted because no encryption secret is configured.`);
        return '';
    }
    try {
        const parts = raw.slice(ENCRYPTED_PREFIX.length).split(':');
        if (parts.length !== 3) throw new Error('Invalid encrypted setting format');
        const iv = Buffer.from(parts[0], 'base64url');
        const tag = Buffer.from(parts[1], 'base64url');
        const ciphertext = Buffer.from(parts[2], 'base64url');
        const decipher = crypto.createDecipheriv('aes-256-gcm', keyBytes, iv);
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    } catch (e) {
        console.warn(`[Settings] Could not decrypt ${key}: ${e.message}`);
        return '';
    }
}

/** Push SMTP settings from cache into process.env so nodemailer picks them up */
function _applySmtp() {
    process.env.SMTP_HOST      = _cache['smtp_host'] || '';
    process.env.SMTP_PORT      = _cache['smtp_port'] || '';
    process.env.SMTP_USER      = _cache['smtp_user'] || '';
    process.env.SMTP_PASS      = _cache['smtp_pass'] || '';
    process.env.SMTP_FROM_NAME = _cache['smtp_from_name'] || '';
}
