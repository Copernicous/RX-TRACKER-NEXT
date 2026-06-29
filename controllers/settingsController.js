const settings       = require('../services/settingsService');
const { extractRoutes } = require('../utils/routeInspector');
const routeManifest  = require('../config/routeManifest');
const emailService   = require('../services/emailService');
const db             = require('../models');
const securityAlertService = require('../services/securityAlertService');

// GET /api/settings — returns all current settings (sensitive keys masked)
exports.getAll = (req, res) => {
    res.json(settings.getAll(false)); // false = mask passwords
};

// GET /api/settings/timezones — returns list of valid timezone options
exports.getTimezones = (req, res) => {
    res.json(settings.KNOWN_TIMEZONES);
};

// GET /api/session-config - authenticated users can read non-sensitive session timing.
exports.getSessionConfig = (req, res) => {
    const rawMinutes = parseInt(settings.get('session_timeout_minutes') || process.env.SESSION_TIMEOUT_MINUTES || '30', 10);
    const sessionTimeoutMinutes = Number.isFinite(rawMinutes) ? Math.min(Math.max(rawMinutes, 5), 480) : 30;
    res.json({
        sessionTimeoutMinutes,
        warningSeconds: 120
    });
};

// GET /api/settings/email-status — returns SMTP config without password, + configured flag
exports.getEmailStatus = (req, res) => {
    res.json({
        configured:    settings.isSmtpConfigured(),
        smtp_host:     settings.get('smtp_host')      || '',
        smtp_port:     settings.get('smtp_port')      || '587',
        smtp_user:     settings.get('smtp_user')      || '',
        smtp_from_name:settings.get('smtp_from_name') || 'Patient RX System',
        smtp_pass_set: !!(settings.get('smtp_pass'))  // just boolean — never send the value
    });
};

function parseJsonObject(raw, fallback) {
    if (!raw) return fallback;
    try {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        return parsed && typeof parsed === 'object' ? parsed : fallback;
    } catch (e) {
        return fallback;
    }
}

function formatAlertLabel(alertKey) {
    return String(alertKey || 'sample_alert')
        .split('_')
        .filter(Boolean)
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
}

function maskSettingValue(key, value) {
    if (/pass|secret|token|key/i.test(String(key || ''))) {
        return value ? '[redacted]' : '';
    }
    return String(value == null ? '' : value);
}

// GET /api/settings/email-alerts/user/:userId — inspect one user's granular alert subscriptions
exports.getUserEmailAlertConfig = async (req, res) => {
    try {
        const userId = parseInt(req.params.userId, 10);
        if (!Number.isInteger(userId) || userId < 1) {
            return res.status(400).json({ error: 'Invalid user ID.' });
        }

        const user = await db.User.findByPk(userId, {
            attributes: ['id', 'firstName', 'lastName', 'username', 'email', 'isActive']
        });
        if (!user) {
            return res.status(404).json({ error: 'User not found.' });
        }

        const rules = parseJsonObject(settings.get('email_alert_rules'), {});
        const subscriptions = parseJsonObject(settings.get('email_alert_user_subscriptions'), {});
        const userRules = subscriptions[String(userId)] || subscriptions[userId] || {};
        const enabledKeys = Object.keys(userRules).filter(key => userRules[key] === true);
        const inactiveGlobalKeys = enabledKeys.filter(key => rules[key] !== true);

        res.json({
            user: {
                id: user.id,
                firstName: user.firstName,
                lastName: user.lastName,
                username: user.username,
                email: user.email,
                isActive: user.isActive
            },
            alertsEnabled: settings.get('email_alerts_enabled') === 'true',
            globalRecipients: String(settings.get('email_alerts_recipients') || '')
                .split(',')
                .map(v => v.trim())
                .filter(Boolean),
            subscriptions: userRules,
            enabledAlertKeys: enabledKeys,
            enabledCount: enabledKeys.length,
            inactiveGlobalAlertKeys: inactiveGlobalKeys
        });
    } catch (e) {
        console.error('[settings.getUserEmailAlertConfig]', e.message);
        res.status(500).json({ error: e.message });
    }
};

// POST /api/settings/email-alerts/test — send a sample alert using saved recipients/subscriptions
exports.sendTestEmailAlert = async (req, res) => {
    try {
        if (!emailService.isConfigured()) {
            return res.status(422).json({
                error: 'Email is not configured.',
                hint: 'Configure SMTP first in System Settings -> Email Setup.'
            });
        }

        const alertKey = String(req.body?.alertKey || '').trim();
        if (!alertKey) {
            return res.status(400).json({ error: 'alertKey is required.' });
        }

        const rules = parseJsonObject(settings.get('email_alert_rules'), {});
        const subscriptions = parseJsonObject(settings.get('email_alert_user_subscriptions'), {});
        const manualRecipients = String(settings.get('email_alerts_recipients') || '')
            .split(',')
            .map(v => v.trim().toLowerCase())
            .filter(Boolean);

        const users = await db.User.findAll({
            attributes: ['id', 'username', 'email'],
            where: { isActive: true }
        });

        const subscribedRecipients = users
            .filter(user => {
                const userRules = subscriptions[String(user.id)] || subscriptions[user.id] || {};
                return user.email && userRules[alertKey] === true;
            })
            .map(user => String(user.email).trim().toLowerCase());

        const recipients = Array.from(new Set(manualRecipients.concat(subscribedRecipients)));
        if (!recipients.length) {
            return res.status(400).json({
                error: 'No recipients are configured for this alert.',
                hint: 'Add alert recipients or enable a per-user subscription for the selected alert.'
            });
        }

        const alertEnabled = settings.get('email_alerts_enabled') === 'true';
        const ruleEnabled = rules[alertKey] === true;
        const label = formatAlertLabel(alertKey);
        const now = new Date().toLocaleString('en-US', { timeZone: process.env.TZ || 'America/New_York' });
        const actorName = req.user?.username || 'Administrator';
        const subject = `Patient RX Alert Test - ${label}`;
        const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
body { font-family: Arial, sans-serif; background: #f4f6fb; margin: 0; padding: 24px; color: #334155; }
.card { max-width: 720px; margin: 0 auto; background: #ffffff; border-radius: 14px; overflow: hidden; box-shadow: 0 10px 30px rgba(15,23,42,.08); border: 1px solid #e2e8f0; }
.hero { background: linear-gradient(135deg, #22c55e 0%, #0ea5e9 100%); color: white; padding: 26px 30px; }
.hero h1 { margin: 0 0 6px; font-size: 22px; }
.hero p { margin: 0; font-size: 13px; opacity: .9; }
.body { padding: 28px 30px; }
.pill { display: inline-block; padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 700; margin-right: 8px; }
.on { background: #dcfce7; color: #166534; }
.off { background: #fee2e2; color: #991b1b; }
.meta { width: 100%; border-collapse: collapse; margin-top: 18px; }
.meta td { border-bottom: 1px solid #e2e8f0; padding: 10px 0; vertical-align: top; font-size: 14px; }
.meta td:first-child { width: 180px; color: #64748b; font-weight: 700; }
.note { margin-top: 18px; padding: 14px 16px; border-radius: 10px; background: #eff6ff; color: #1d4ed8; font-size: 13px; }
</style>
</head>
<body>
  <div class="card">
    <div class="hero">
      <h1>Sample Email Alert</h1>
      <p>This is a manual verification email sent from System Settings.</p>
    </div>
    <div class="body">
      <div style="margin-bottom:12px;">
        <span class="pill ${alertEnabled ? 'on' : 'off'}">Alerts ${alertEnabled ? 'Enabled' : 'Disabled'}</span>
        <span class="pill ${ruleEnabled ? 'on' : 'off'}">Rule ${ruleEnabled ? 'Active' : 'Inactive'}</span>
      </div>
      <p><strong>${label}</strong> was triggered as a test so you can verify recipients, formatting, and SMTP delivery.</p>
      <table class="meta">
        <tr><td>Alert key</td><td>${alertKey}</td></tr>
        <tr><td>Sent by</td><td>${actorName}</td></tr>
        <tr><td>Server time</td><td>${now}</td></tr>
        <tr><td>Saved recipients</td><td>${manualRecipients.length ? manualRecipients.join(', ') : 'None'}</td></tr>
        <tr><td>Subscribed users</td><td>${subscribedRecipients.length ? subscribedRecipients.join(', ') : 'None'}</td></tr>
        <tr><td>Delivered to</td><td>${recipients.join(', ')}</td></tr>
      </table>
      <div class="note">
        If this message arrived successfully, the email alert configuration is ready for live alert wiring.
      </div>
    </div>
  </div>
</body>
</html>`;

        await emailService.sendEmail({ to: recipients, subject, html });

        await db.AuditLog.create({
            userId: req.user?.id || null,
            date: new Date(),
            time: new Date(),
            module: 'System Settings',
            action: `Sent sample email alert (${alertKey})`,
            recordId: null,
            previousValue: null,
            newValue: { alertKey, recipients },
            ipAddress: req.ip
        });

        res.json({
            ok: true,
            alertKey,
            recipients,
            recipientCount: recipients.length,
            message: `Sample alert sent to ${recipients.length} recipient(s).`
        });
    } catch (e) {
        console.error('[settings.sendTestEmailAlert]', e.message);
        securityAlertService.notify('email_config_failure', {
            event: 'email_config_failure',
            message: e.message,
            alertKey: req.body?.alertKey || null,
            ip: req.ip,
            userId: req.user?.id || null,
            username: req.user?.username || null
        }).catch(() => {});
        res.status(500).json({ error: e.message });
    }
};

// PUT /api/settings — update one or more settings (Admin only)
exports.update = async (req, res) => {
    try {
        const updates = req.body; // { key: value, ... }
        if (!updates || typeof updates !== 'object') {
            return res.status(400).json({ error: 'Request body must be a JSON object of { key: value } pairs.' });
        }

        const auditChanges = [];
        for (const [key, value] of Object.entries(updates)) {
            // Timezone validation
            if (key === 'app_timezone' && !settings.KNOWN_TIMEZONES.includes(value)) {
                return res.status(400).json({ error: `Unknown timezone: "${value}". Please select a value from the list.` });
            }
            // Port must be numeric
            if (key === 'smtp_port' && (isNaN(value) || parseInt(value) < 1 || parseInt(value) > 65535)) {
                return res.status(400).json({ error: 'SMTP port must be a number between 1 and 65535.' });
            }
            // Allow clearing smtp_pass by sending empty string (don't overwrite with empty)
            if (key === 'smtp_pass' && value === '') {
                continue; // skip — don't erase existing password with empty
            }
            const previousValue = settings.get(key);
            await settings.set(key, String(value));
            auditChanges.push({
                key,
                previousValue: maskSettingValue(key, previousValue),
                newValue: maskSettingValue(key, value)
            });
        }

        if (auditChanges.length) {
            await db.AuditLog.create({
                userId: req.user?.id || null,
                date: new Date(),
                time: new Date(),
                module: 'System Settings',
                action: 'Settings Updated',
                recordId: null,
                previousValue: auditChanges.map(change => ({ key: change.key, value: change.previousValue })),
                newValue: auditChanges.map(change => ({ key: change.key, value: change.newValue })),
                ipAddress: req.ip
            }).catch(() => {});
        }

        const securityKeys = auditChanges
            .map(change => change.key)
            .filter(key => /^(require_2fa|session_timeout_minutes|max_failed_logins|email_alert_|smtp_)/.test(key));
        if (securityKeys.length) {
            securityAlertService.recordSettingsChanged({
                req,
                user: req.user,
                changedKeys: securityKeys
            }).catch(() => {});
        }

        // Return masked copy
        res.json({ ok: true, settings: settings.getAll(false) });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

// GET /api/settings/api-routes — returns all live routes merged with manifest metadata
// The Express app is lazily required to avoid a circular dependency at boot time.
exports.getApiRoutes = (req, res) => {
    try {
        const app = require('../app');           // lazy require — safe after boot
        const routes = extractRoutes(app, '');

        const CATEGORY_ORDER = ['patients','rx','dashboard','reports','email','settings','auth','admin'];
        const CATEGORY_LABELS = {
            patients:'Patients', rx:'RX Records', dashboard:'Dashboard',
            reports:'Reports', email:'Email', settings:'Reference & Settings',
            auth:'Authentication', admin:'Admin Only'
        };
        const CATEGORY_COLORS = {
            patients:'#6366f1', rx:'#22c55e', dashboard:'#f59e0b',
            reports:'#06b6d4', email:'#8b5cf6', settings:'#64748b',
            auth:'#0ea5e9', admin:'#ef4444'
        };

        // Group routes by category using manifest; unknowns go to 'other'
        const groups = {};
        for (const route of routes) {
            const key = route.method + " " + route.path;
            const meta = routeManifest[key] || {};
            const cat  = meta.category || 'other';
            if (!groups[cat]) groups[cat] = [];
            groups[cat].push({
                method:  route.method,
                path:    route.path,
                desc:    meta.desc   || 'No description available.',
                perm:    meta.perm   || 'Authenticated',
                admin:   !!meta.admin,
                query:   meta.query  || null,
                body:    meta.body   || null,
                inManifest: !!routeManifest[key]
            });
        }

        // Build ordered sections
        const sections = [];
        const orderedCats = [...CATEGORY_ORDER, ...Object.keys(groups).filter(c => !CATEGORY_ORDER.includes(c))];
        for (const cat of orderedCats) {
            if (!groups[cat]) continue;
            sections.push({
                id:       cat,
                label:    CATEGORY_LABELS[cat] || cat.charAt(0).toUpperCase() + cat.slice(1),
                color:    CATEGORY_COLORS[cat] || '#6b7280',
                endpoints: groups[cat]
            });
        }

        res.json({
            totalRoutes: routes.length,
            sections,
            generatedAt: new Date().toISOString()
        });
    } catch (e) {
        console.error('[getApiRoutes]', e.message);
        res.status(500).json({ error: e.message });
    }
};
