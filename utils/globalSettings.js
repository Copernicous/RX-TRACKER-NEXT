'use strict';

const fs = require('fs');
const path = require('path');
const { getWritableRoot } = require('./runtimePaths');

const WRITABLE_ROOT = getWritableRoot();
const SETTINGS_PATH = path.join(WRITABLE_ROOT, 'data', 'settings.json');

const DEFAULT_SETTINGS = {
    backupPath: path.join(WRITABLE_ROOT, 'backups'),
    backupRetentionDays: 30,
    appName: 'Patient RX',
    sessionTimeoutMinutes: 60,
    maxLoginAttempts: 5,
    maintenanceMode: false,
    serviceDateOverrideEnabled: false,
    serviceWindowDays: 90,
    callCenterLeadDays: 10,
    callCenterPhoneClient: 'microsip',
    callCenterInactiveClaimSeconds: 15
};

function ensureSettingsDir() {
    const dir = path.dirname(SETTINGS_PATH);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function readSettings() {
    try {
        ensureSettingsDir();
        const parsed = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
        return { ...DEFAULT_SETTINGS, ...parsed };
    } catch (e) {
        return { ...DEFAULT_SETTINGS };
    }
}

function writeSettings(next) {
    ensureSettingsDir();
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(next, null, 2), 'utf8');
    return next;
}

function isTruthy(value) {
    return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function isServiceDateOverrideEnabled() {
    if (process.env.SERVICE_DATE_OVERRIDE_ENABLED !== undefined) {
        return isTruthy(process.env.SERVICE_DATE_OVERRIDE_ENABLED);
    }
    return readSettings().serviceDateOverrideEnabled === true;
}

function getServiceWindowDays() {
    return 90;
}

function getCallCenterLeadDays() {
    const settings = readSettings();
    let value = Number.parseInt(settings.callCenterLeadDays, 10);
    // Upgrade compatibility: v3.0.3-v3.0.5 stored the calling threshold
    // itself (for example 80). Convert that to lead days (90 - 80 = 10).
    if ((!Number.isInteger(value) || value === 10) && Number(settings.serviceWindowDays) !== 90) {
        const legacyThreshold = Number.parseInt(settings.serviceWindowDays, 10);
        if (Number.isInteger(legacyThreshold)) value = 90 - legacyThreshold;
    }
    return Number.isInteger(value) && value >= 0 && value <= 89 ? value : DEFAULT_SETTINGS.callCenterLeadDays;
}

function getCallCenterPhoneClient() {
    const value = String(readSettings().callCenterPhoneClient || '').trim().toLowerCase();
    return ['microsip', 'rx_softphone', 'auto'].includes(value)
        ? value
        : DEFAULT_SETTINGS.callCenterPhoneClient;
}

function getCallCenterInactiveClaimSeconds() {
    const value = Number.parseInt(readSettings().callCenterInactiveClaimSeconds, 10);
    return Number.isInteger(value) && value >= 5 && value <= 300
        ? value
        : DEFAULT_SETTINGS.callCenterInactiveClaimSeconds;
}

module.exports = {
    DEFAULT_SETTINGS,
    SETTINGS_PATH,
    readSettings,
    writeSettings,
    isServiceDateOverrideEnabled,
    getServiceWindowDays,
    getCallCenterLeadDays,
    getCallCenterPhoneClient,
    getCallCenterInactiveClaimSeconds
};
