'use strict';

process.env.SECURITY_ALERT_DRY_RUN = 'true';
process.env.SECURITY_ALERT_CRITICAL_ERROR_THRESHOLD = '1';

const { Op } = require('sequelize');
const { prepareStagingEnv } = require('./lib/staging-env');

const config = prepareStagingEnv();
const db = require('../models');
const settings = require('../services/settingsService');
const securityAlertService = require('../services/securityAlertService');

const SETTING_KEYS = [
    'email_alerts_enabled',
    'email_alerts_recipients',
    'email_alert_rules',
    'email_alert_failed_login_threshold',
    'email_alert_missing_auth_threshold',
    'email_alert_cooldown_minutes'
];

const REQUIRED_ALERT_KEYS = [
    'failed_login_threshold',
    'account_locked',
    'missing_auth_spike',
    'permission_denied_spike',
    'admin_login',
    'security_settings_changed',
    'api_key_changed',
    'backup_failed',
    'backup_missing',
    'critical_error'
];

function parseJsonObject(raw, fallback) {
    if (!raw) return fallback;
    try {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        return parsed && typeof parsed === 'object' ? parsed : fallback;
    } catch (e) {
        return fallback;
    }
}

function mockReq(overrides) {
    return Object.assign({
        method: 'GET',
        originalUrl: '/api/staging-security-alert-smoke',
        path: '/api/staging-security-alert-smoke',
        ip: '127.0.0.1',
        headers: { 'user-agent': 'staging-security-alert-smoke' },
        user: { id: 1, username: 'security-smoke-admin', role: 'Administrator', isMaster: false }
    }, overrides || {});
}

async function configureAlerts() {
    const original = {};
    SETTING_KEYS.forEach(key => { original[key] = settings.get(key); });

    const rules = parseJsonObject(settings.get('email_alert_rules'), {});
    REQUIRED_ALERT_KEYS.forEach(key => { rules[key] = true; });

    await settings.set('email_alerts_enabled', 'true');
    await settings.set('email_alerts_recipients', 'security-smoke@example.test');
    await settings.set('email_alert_rules', JSON.stringify(rules));
    await settings.set('email_alert_failed_login_threshold', '2');
    await settings.set('email_alert_missing_auth_threshold', '2');
    await settings.set('email_alert_cooldown_minutes', '0');

    return original;
}

async function restoreSettings(original) {
    for (const key of SETTING_KEYS) {
        if (original[key] !== undefined && original[key] !== null) {
            await settings.set(key, String(original[key]));
        }
    }
}

function flattenResults(results) {
    return results.flatMap(item => Array.isArray(item) ? item : [item]).filter(Boolean);
}

async function main() {
    const startedAt = new Date();
    let originalSettings = null;

    console.log('Staging automatic security alert smoke test');
    console.log('DB : ' + (process.env.DB_HOST || '127.0.0.1') + ':' + (process.env.DB_PORT || '5432') + '/' + process.env.DB_NAME);
    console.log('Mode: dry-run email delivery');

    try {
        await db.sequelize.authenticate();
        await settings.load();
        securityAlertService._resetForTests();
        originalSettings = await configureAlerts();

        const req = mockReq();
        const results = flattenResults([
            await securityAlertService.recordFailedLogin({
                req,
                username: 'security-smoke-user',
                count: 2,
                maxFailedAttempts: 5,
                reason: 'smoke_failed_login_threshold'
            }),
            await securityAlertService.recordFailedLogin({
                req,
                username: 'security-smoke-user',
                count: 5,
                maxFailedAttempts: 5,
                reason: 'smoke_account_locked'
            }),
            await securityAlertService.recordMissingAuth({ req: mockReq({ user: null }), reason: 'smoke_missing_auth_1' }),
            await securityAlertService.recordMissingAuth({ req: mockReq({ user: null }), reason: 'smoke_missing_auth_2' }),
            await securityAlertService.recordPermissionDenied({ req, moduleKey: 'patients', requiredAction: 'delete', reason: 'smoke_permission_1' }),
            await securityAlertService.recordPermissionDenied({ req, moduleKey: 'patients', requiredAction: 'delete', reason: 'smoke_permission_2' }),
            await securityAlertService.recordCriticalError({
                req,
                source: 'backend',
                severity: 'error',
                message: 'Smoke critical error',
                stack: 'smoke stack'
            }),
            await securityAlertService.recordBackupFailure({
                kind: 'database',
                entry: {
                    status: 'failed',
                    triggeredBy: 'Smoke',
                    error: 'Smoke backup failure',
                    timestamp: new Date().toISOString()
                }
            }),
            await securityAlertService.recordBackupMissing({
                kind: 'database',
                schedule: '0 2 * * *',
                lastSuccessAt: null,
                expectedWindowHours: 26
            }),
            await securityAlertService.recordAdminLogin({ req, user: req.user }),
            await securityAlertService.recordSettingsChanged({ req, user: req.user, changedKeys: ['max_failed_logins'] }),
            await securityAlertService.recordApiKeyChanged({
                req,
                user: req.user,
                action: 'created',
                apiKeyId: 12345,
                apiKeyName: 'Smoke key',
                keyPrefix: 'rxk_smoke'
            })
        ]);

        const triggeredKeys = new Set(results.filter(result => result && result.ok && result.dryRun).map(result => result.alertKey));
        const missingKeys = REQUIRED_ALERT_KEYS.filter(key => !triggeredKeys.has(key));
        if (missingKeys.length) {
            throw new Error('Missing expected dry-run alert trigger(s): ' + missingKeys.join(', '));
        }

        const auditRows = await db.AuditLog.findAll({
            where: {
                module: 'Security Alerts',
                action: { [Op.like]: 'Security Alert Dry Run%' },
                createdAt: { [Op.gte]: startedAt }
            }
        });
        if (auditRows.length < REQUIRED_ALERT_KEYS.length) {
            throw new Error('Expected at least ' + REQUIRED_ALERT_KEYS.length + ' dry-run audit rows, found ' + auditRows.length + '.');
        }

        console.log('PASS automatic alert rules triggered in dry-run mode');
        console.log('PASS dry-run alert audit rows were written');
        console.log('Triggered: ' + Array.from(triggeredKeys).sort().join(', '));
    } finally {
        if (originalSettings) {
            await restoreSettings(originalSettings);
        }
        await db.AuditLog.destroy({
            where: {
                module: 'Security Alerts',
                action: { [Op.like]: 'Security Alert Dry Run%' },
                createdAt: { [Op.gte]: startedAt }
            }
        }).catch(() => {});
        await db.sequelize.close().catch(() => {});
    }
}

main().catch(err => {
    console.error('[staging:security-alerts] ' + err.message);
    process.exit(1);
});
