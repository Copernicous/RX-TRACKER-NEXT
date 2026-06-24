'use strict';

const fs = require('fs');
const path = require('path');

const SETTINGS_PATH = path.join(__dirname, '..', 'data', 'settings.json');

const DEFAULT_SETTINGS = {
    backupPath: path.join(__dirname, '..', 'backups'),
    backupRetentionDays: 30,
    appName: 'Daniely RX',
    sessionTimeoutMinutes: 60,
    maxLoginAttempts: 5,
    maintenanceMode: false,
    serviceDateOverrideEnabled: false
};

function readSettings() {
    try {
        const parsed = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
        return { ...DEFAULT_SETTINGS, ...parsed };
    } catch (e) {
        return { ...DEFAULT_SETTINGS };
    }
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

module.exports = {
    DEFAULT_SETTINGS,
    SETTINGS_PATH,
    readSettings,
    isServiceDateOverrideEnabled
};
