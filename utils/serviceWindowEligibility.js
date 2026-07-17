'use strict';

const { parseDate } = require('./dateUtils');
const { getServiceWindowDays, getCallCenterLeadDays } = require('./globalSettings');

function localIsoDate(date) {
    const d = date instanceof Date ? new Date(date) : new Date(date || Date.now());
    if (isNaN(d.getTime())) return null;
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function addDaysIso(iso, days) {
    const clean = parseDate(iso);
    if (!clean) return null;
    const [year, month, day] = clean.split('-').map(Number);
    const date = new Date(year, month - 1, day, 12, 0, 0, 0);
    date.setDate(date.getDate() + days);
    return localIsoDate(date);
}

function getEligibilityCutoffIso(today) {
    const todayIso = localIsoDate(today || new Date());
    return addDaysIso(todayIso, -getServiceWindowDays());
}

function evaluateServiceWindow(serviceDate, today) {
    const cleanServiceDate = parseDate(serviceDate);
    const cutoff = getEligibilityCutoffIso(today);
    const windowDays = getServiceWindowDays();
    if (!cleanServiceDate) {
        return { status: 'none', eligible: false, serviceDate: null, cutoff, windowDays, eligibleSince: null };
    }
    const eligibleSince = addDaysIso(cleanServiceDate, windowDays);
    const eligible = cleanServiceDate <= cutoff;
    const todayIso = localIsoDate(today || new Date());
    const expiryIso = addDaysIso(cleanServiceDate, windowDays);
    const daysLeft = Math.round(
        (new Date(`${expiryIso}T12:00:00`).getTime() - new Date(`${todayIso}T12:00:00`).getTime()) / 864e5
    );
    return {
        status: eligible ? 'eligible' : (daysLeft <= getCallCenterLeadDays() ? 'expiring' : 'window'),
        eligible,
        serviceDate: cleanServiceDate,
        cutoff,
        windowDays,
        eligibleSince,
        expiryDate: expiryIso,
        daysLeft
    };
}

function isCallCenterCandidate(serviceDate, today) {
    const result = evaluateServiceWindow(serviceDate, today);
    return !!result.serviceDate && result.daysLeft <= getCallCenterLeadDays();
}

function getCallCenterThresholdDays() {
    return getServiceWindowDays() - getCallCenterLeadDays();
}

module.exports = {
    localIsoDate,
    addDaysIso,
    getEligibilityCutoffIso,
    evaluateServiceWindow,
    isCallCenterCandidate,
    getCallCenterThresholdDays
};
