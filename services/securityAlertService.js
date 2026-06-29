'use strict';

const settings = require('./settingsService');
const emailService = require('./emailService');
const db = require('../models');

const EVENT_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_COOLDOWN_MINUTES = 60;
const DEFAULT_SPIKE_THRESHOLD = 5;
const DEFAULT_CRITICAL_ERROR_THRESHOLD = 3;

const counters = new Map();
const cooldowns = new Map();

function parseJsonObject(raw, fallback) {
    if (!raw) return fallback;
    try {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        return parsed && typeof parsed === 'object' ? parsed : fallback;
    } catch (e) {
        return fallback;
    }
}

function parsePositiveInt(value, fallback, min, max) {
    const parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(Math.max(parsed, min), max);
}

function splitRecipients(value) {
    return String(value || '')
        .split(',')
        .map(email => email.trim().toLowerCase())
        .filter(Boolean);
}

function formatAlertLabel(alertKey) {
    return String(alertKey || 'security_alert')
        .split('_')
        .filter(Boolean)
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
}

function escapeHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');
}

function requestInfo(req) {
    if (!req) return {};
    return {
        method: req.method || null,
        path: req.originalUrl || req.path || null,
        ip: req.ip || null,
        userAgent: req.headers ? req.headers['user-agent'] || null : null
    };
}

function userInfo(user) {
    if (!user) return {};
    return {
        userId: user.id || null,
        username: user.username || null,
        role: user.role || (user.Role && user.Role.name) || null,
        isMaster: user.isMaster === true
    };
}

function sanitizeContext(value, depth) {
    if (depth > 4) return '[truncated]';
    if (value == null) return value;
    if (value instanceof Error) return { message: value.message, stack: value.stack };
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return value.slice(0, 25).map(item => sanitizeContext(item, depth + 1));
    if (typeof value === 'object') {
        const out = {};
        Object.entries(value).slice(0, 50).forEach(([key, item]) => {
            if (/pass|password|secret|token|key|authorization|cookie/i.test(key)) {
                out[key] = item ? '[redacted]' : item;
                return;
            }
            out[key] = sanitizeContext(item, depth + 1);
        });
        return out;
    }
    const text = String(value);
    return text.length > 500 ? text.slice(0, 500) + '...' : value;
}

function incrementCounter(counterKey, windowMs) {
    const now = Date.now();
    const existing = counters.get(counterKey);
    if (!existing || existing.expiresAt <= now) {
        counters.set(counterKey, { count: 1, expiresAt: now + windowMs });
        return 1;
    }
    existing.count += 1;
    return existing.count;
}

function getCooldownKey(alertKey, context) {
    const bucket = context.cooldownKey
        || context.groupKey
        || context.username
        || context.userId
        || context.ip
        || 'global';
    return alertKey + ':' + bucket;
}

function isCoolingDown(alertKey, context, cooldownMinutes) {
    if (cooldownMinutes <= 0) return false;
    const key = getCooldownKey(alertKey, context);
    const lastSent = cooldowns.get(key);
    return !!lastSent && (Date.now() - lastSent) < cooldownMinutes * 60 * 1000;
}

function markCooldown(alertKey, context) {
    cooldowns.set(getCooldownKey(alertKey, context), Date.now());
}

async function getRecipients(alertKey) {
    const manualRecipients = splitRecipients(settings.get('email_alerts_recipients'));
    const subscriptions = parseJsonObject(settings.get('email_alert_user_subscriptions'), {});

    const users = await db.User.findAll({
        attributes: ['id', 'email', 'isActive'],
        where: { isActive: true }
    }).catch(() => []);

    const subscribedRecipients = users
        .filter(user => {
            const userRules = subscriptions[String(user.id)] || subscriptions[user.id] || {};
            return user.email && userRules[alertKey] === true;
        })
        .map(user => String(user.email).trim().toLowerCase())
        .filter(Boolean);

    return Array.from(new Set(manualRecipients.concat(subscribedRecipients)));
}

function buildEmailHtml(alertKey, context) {
    const label = formatAlertLabel(alertKey);
    const tz = process.env.TZ || settings.get('app_timezone') || 'America/New_York';
    const now = new Date().toLocaleString('en-US', { timeZone: tz });
    const contextRows = Object.entries(context)
        .filter(([key]) => !['cooldownKey', 'groupKey'].includes(key))
        .map(([key, value]) => {
            const rendered = typeof value === 'object'
                ? JSON.stringify(sanitizeContext(value, 0), null, 2)
                : String(value == null ? '' : value);
            return '<tr><td>' + escapeHtml(key) + '</td><td><pre>' + escapeHtml(rendered) + '</pre></td></tr>';
        })
        .join('');

    return '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' +
        'body{font-family:Arial,sans-serif;background:#f8fafc;margin:0;padding:24px;color:#334155}' +
        '.card{max-width:760px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden}' +
        '.hero{background:#0f172a;color:#fff;padding:22px 26px}.hero h1{font-size:22px;margin:0 0 6px}.hero p{margin:0;color:#cbd5e1}' +
        '.body{padding:24px 26px}.meta{width:100%;border-collapse:collapse}.meta td{border-top:1px solid #e2e8f0;padding:10px 0;vertical-align:top}' +
        '.meta td:first-child{width:190px;color:#64748b;font-weight:700}pre{white-space:pre-wrap;margin:0;font-family:Consolas,monospace;font-size:12px}' +
        '.note{margin-top:16px;background:#eff6ff;color:#1d4ed8;border-radius:10px;padding:12px 14px;font-size:13px}' +
        '</style></head><body><div class="card"><div class="hero"><h1>Security Alert: ' + escapeHtml(label) + '</h1>' +
        '<p>Patient RX automatic security alert</p></div><div class="body">' +
        '<table class="meta"><tr><td>Alert key</td><td>' + escapeHtml(alertKey) + '</td></tr>' +
        '<tr><td>Server time</td><td>' + escapeHtml(now) + '</td></tr>' +
        contextRows + '</table><div class="note">This alert was generated automatically from the server-side security alert service.</div>' +
        '</div></div></body></html>';
}

async function auditAlert(action, payload, ipAddress, userId) {
    await db.AuditLog.create({
        userId: userId || null,
        date: new Date(),
        time: new Date().toTimeString().split(' ')[0],
        module: 'Security Alerts',
        action,
        recordId: null,
        previousValue: null,
        newValue: sanitizeContext(payload, 0),
        ipAddress: ipAddress || null
    }).catch(() => {});
}

async function notify(alertKey, rawContext, options) {
    const context = sanitizeContext(rawContext || {}, 0);
    const opts = options || {};
    const dryRun = opts.dryRun === true || process.env.SECURITY_ALERT_DRY_RUN === 'true';
    const force = opts.force === true;

    if (process.env.SECURITY_ALERTS_DISABLE_AUTO === 'true' && !force) {
        return { ok: true, sent: false, skipped: 'disabled_by_env', alertKey };
    }

    if (!force && settings.get('email_alerts_enabled') !== 'true') {
        return { ok: true, sent: false, skipped: 'alerts_disabled', alertKey };
    }

    const rules = parseJsonObject(settings.get('email_alert_rules'), {});
    if (!force && rules[alertKey] !== true) {
        return { ok: true, sent: false, skipped: 'rule_disabled', alertKey };
    }

    const cooldownMinutes = parsePositiveInt(
        settings.get('email_alert_cooldown_minutes'),
        DEFAULT_COOLDOWN_MINUTES,
        0,
        1440
    );
    if (!force && isCoolingDown(alertKey, context, cooldownMinutes)) {
        return { ok: true, sent: false, skipped: 'cooldown', alertKey };
    }

    const recipients = await getRecipients(alertKey);
    if (!recipients.length) {
        return { ok: true, sent: false, skipped: 'no_recipients', alertKey };
    }

    if (!dryRun && !emailService.isConfigured()) {
        await auditAlert('Security Alert Failed (' + alertKey + ')', {
            alertKey,
            reason: 'smtp_not_configured',
            recipients,
            context
        }, context.ip, context.userId);
        return { ok: false, sent: false, skipped: 'smtp_not_configured', alertKey, recipients };
    }

    const subject = 'Patient RX Security Alert - ' + formatAlertLabel(alertKey);
    const html = buildEmailHtml(alertKey, context);

    try {
        if (!dryRun) {
            await emailService.sendEmail({ to: recipients, subject, html });
        }
        markCooldown(alertKey, context);
        await auditAlert('Security Alert ' + (dryRun ? 'Dry Run' : 'Sent') + ' (' + alertKey + ')', {
            alertKey,
            dryRun,
            recipients,
            context
        }, context.ip, context.userId);
        return { ok: true, sent: !dryRun, dryRun, alertKey, recipients };
    } catch (err) {
        await auditAlert('Security Alert Failed (' + alertKey + ')', {
            alertKey,
            reason: err.message,
            recipients,
            context
        }, context.ip, context.userId);
        return { ok: false, sent: false, error: err.message, alertKey, recipients };
    }
}

async function recordFailedLogin(details) {
    const req = details.req;
    const username = details.username || (details.user && details.user.username) || 'unknown';
    const ip = req ? req.ip : details.ip;
    const maxFailedAttempts = details.maxFailedAttempts || null;
    const failedAlertThreshold = parsePositiveInt(
        settings.get('email_alert_failed_login_threshold'),
        DEFAULT_SPIKE_THRESHOLD,
        1,
        100
    );
    const counterKey = 'failed-login:' + username + ':' + (ip || 'unknown');
    const count = Number.isFinite(details.count)
        ? details.count
        : incrementCounter(counterKey, EVENT_WINDOW_MS);

    const baseContext = {
        event: 'failed_login',
        stage: details.stage || 'password',
        reason: details.reason || 'invalid_credentials',
        username,
        count,
        threshold: failedAlertThreshold,
        maxFailedAttempts,
        groupKey: username + ':' + (ip || 'unknown'),
        ...requestInfo(req),
        ...userInfo(details.user)
    };

    const results = [];
    if (count >= failedAlertThreshold) {
        results.push(await notify('failed_login_threshold', baseContext));
    }
    if (maxFailedAttempts && count >= maxFailedAttempts) {
        results.push(await notify('account_locked', {
            ...baseContext,
            event: 'account_locked',
            lockoutMinutes: details.lockoutMinutes || null
        }));
    }
    return results;
}

async function recordMissingAuth(details) {
    const req = details.req;
    const threshold = parsePositiveInt(settings.get('email_alert_missing_auth_threshold'), DEFAULT_SPIKE_THRESHOLD, 1, 100);
    const ip = req ? req.ip : details.ip;
    const groupKey = ip || 'unknown';
    const count = incrementCounter('missing-auth:' + groupKey, EVENT_WINDOW_MS);
    if (count < threshold) return { ok: true, sent: false, skipped: 'below_threshold', alertKey: 'missing_auth_spike', count, threshold };
    return notify('missing_auth_spike', {
        event: 'missing_auth_spike',
        reason: details.reason || 'missing_or_invalid_auth',
        count,
        threshold,
        groupKey,
        ...requestInfo(req)
    });
}

async function recordPermissionDenied(details) {
    const req = details.req;
    const threshold = parsePositiveInt(settings.get('email_alert_missing_auth_threshold'), DEFAULT_SPIKE_THRESHOLD, 1, 100);
    const user = req ? req.user : details.user;
    const userKey = user && user.id ? 'user:' + user.id : 'ip:' + ((req && req.ip) || details.ip || 'unknown');
    const count = incrementCounter('permission-denied:' + userKey, EVENT_WINDOW_MS);
    if (count < threshold) return { ok: true, sent: false, skipped: 'below_threshold', alertKey: 'permission_denied_spike', count, threshold };
    return notify('permission_denied_spike', {
        event: 'permission_denied_spike',
        moduleKey: details.moduleKey || null,
        requiredAction: details.requiredAction || null,
        reason: details.reason || 'access_denied',
        count,
        threshold,
        groupKey: userKey,
        ...requestInfo(req),
        ...userInfo(user)
    });
}

async function recordCriticalError(details) {
    const req = details.req;
    const threshold = parsePositiveInt(process.env.SECURITY_ALERT_CRITICAL_ERROR_THRESHOLD, DEFAULT_CRITICAL_ERROR_THRESHOLD, 1, 100);
    const source = details.source || 'backend';
    const groupKey = source + ':' + ((req && req.ip) || details.ip || 'global');
    const count = Number.isFinite(details.count)
        ? details.count
        : incrementCounter('critical-error:' + groupKey, EVENT_WINDOW_MS);
    if (count < threshold) return { ok: true, sent: false, skipped: 'below_threshold', alertKey: 'critical_error', count, threshold };
    return notify('critical_error', {
        event: 'critical_error',
        source,
        severity: details.severity || 'error',
        message: details.message || (details.error && details.error.message) || 'Unknown error',
        stack: details.stack || (details.error && details.error.stack) || null,
        ip: details.ip || null,
        count,
        threshold,
        groupKey,
        ...requestInfo(req),
        ...userInfo(details.user || (req && req.user))
    });
}

async function recordBackupFailure(details) {
    const entry = details.entry || {};
    return notify('backup_failed', {
        event: 'backup_failed',
        kind: details.kind || 'database',
        status: entry.status || 'failed',
        filename: entry.filename || null,
        triggeredBy: entry.triggeredBy || null,
        error: entry.error || details.error || null,
        timestamp: entry.timestamp || new Date().toISOString(),
        groupKey: details.kind || 'database'
    });
}

async function recordBackupMissing(details) {
    return notify('backup_missing', {
        event: 'backup_missing',
        kind: details.kind || 'database',
        schedule: details.schedule || null,
        lastSuccessAt: details.lastSuccessAt || null,
        expectedWindowHours: details.expectedWindowHours || null,
        groupKey: details.kind || 'database'
    });
}

async function recordAdminLogin(details) {
    const user = details.user;
    const role = user && (user.role || (user.Role && user.Role.name));
    if (role !== 'Administrator' && user && user.isMaster !== true) {
        return { ok: true, sent: false, skipped: 'not_admin', alertKey: 'admin_login' };
    }
    return notify('admin_login', {
        event: 'admin_login',
        ...requestInfo(details.req),
        ...userInfo(user)
    });
}

async function recordSettingsChanged(details) {
    return notify('security_settings_changed', {
        event: 'security_settings_changed',
        changedKeys: details.changedKeys || [],
        ...requestInfo(details.req),
        ...userInfo(details.user || (details.req && details.req.user))
    });
}

async function recordApiKeyChanged(details) {
    return notify('api_key_changed', {
        event: 'api_key_changed',
        action: details.action || 'changed',
        apiKeyId: details.apiKeyId || null,
        apiKeyName: details.apiKeyName || null,
        keyPrefix: details.keyPrefix || null,
        ...requestInfo(details.req),
        ...userInfo(details.user || (details.req && details.req.user))
    });
}

function _resetForTests() {
    counters.clear();
    cooldowns.clear();
}

module.exports = {
    notify,
    recordFailedLogin,
    recordMissingAuth,
    recordPermissionDenied,
    recordCriticalError,
    recordBackupFailure,
    recordBackupMissing,
    recordAdminLogin,
    recordSettingsChanged,
    recordApiKeyChanged,
    _resetForTests
};
