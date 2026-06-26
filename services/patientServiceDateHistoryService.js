'use strict';

const db = require('../models');

function dateOnly(value) {
    if (value === null || value === undefined || value === '') return null;
    if (value instanceof Date) {
        if (isNaN(value.getTime())) return null;
        return value.toISOString().slice(0, 10);
    }
    const raw = String(value).trim();
    if (!raw) return null;
    const iso = raw.match(/^(\d{4}-\d{2}-\d{2})/);
    if (iso) return iso[1];
    const parsed = new Date(raw);
    if (!isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
    return raw.slice(0, 10);
}

function datesEqual(left, right) {
    return dateOnly(left) === dateOnly(right);
}

function buildHistoryRow(entry, defaults) {
    const previousServiceDate = dateOnly(entry.previousServiceDate);
    const newServiceDate = dateOnly(entry.newServiceDate);
    if (previousServiceDate === newServiceDate) return null;

    return {
        patientId:           entry.patientId,
        previousServiceDate,
        newServiceDate,
        changedByUserId:     entry.userId || defaults.userId || null,
        changeSource:        entry.changeSource || defaults.changeSource || 'Patient Update',
        reason:              entry.reason || defaults.reason || null,
        metadata:            entry.metadata || defaults.metadata || null
    };
}

async function recordPatientServiceDateChange(entry, options) {
    options = options || {};
    const row = buildHistoryRow(entry || {}, options);
    if (!row || !row.patientId) return null;

    try {
        const createOptions = options.transaction ? { transaction: options.transaction } : {};
        return await db.PatientServiceDateHistory.create(row, createOptions);
    } catch (err) {
        console.warn('[PatientServiceDateHistory] Could not record change:', err.message);
        return null;
    }
}

async function bulkRecordPatientServiceDateChanges(entries, options) {
    options = options || {};
    const rows = (entries || [])
        .map(entry => buildHistoryRow(entry || {}, options))
        .filter(row => row && row.patientId);

    if (!rows.length) return [];

    try {
        const bulkOptions = options.transaction ? { transaction: options.transaction } : {};
        return await db.PatientServiceDateHistory.bulkCreate(rows, bulkOptions);
    } catch (err) {
        console.warn('[PatientServiceDateHistory] Could not record bulk changes:', err.message);
        return [];
    }
}

module.exports = {
    dateOnly,
    datesEqual,
    recordPatientServiceDateChange,
    bulkRecordPatientServiceDateChanges
};
