'use strict';

const crypto = require('crypto');
const { parseDate } = require('./dateUtils');

// A restart invalidates outstanding reviews and simply asks the importer to review again.
const reviewSecret = crypto.randomBytes(32);
const normalizeName = value => String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
const identityKey = patient => JSON.stringify([
    normalizeName(patient.firstName), normalizeName(patient.lastName), parseDate(patient.dob)
]);
const normalizePhone = value => {
    let digits = String(value || '').replace(/\D/g, '');
    if (digits.length === 11 && digits[0] === '1') digits = digits.slice(1);
    return digits.length === 10 && !/^(\d)\1+$/.test(digits) ? digits : '';
};
const addressText = value => normalizeName(value).replace(/[.,]/g, '');
function addressKey(patient) {
    if (patient.addressLine1 && (patient.zipCode || (patient.city && patient.state))) {
        return JSON.stringify([addressText(patient.addressLine1), patient.zipCode
            ? String(patient.zipCode).slice(0, 5) : addressText(patient.city) + '|' + addressText(patient.state)]);
    }
    const full = addressText(patient.address);
    return full.length >= 10 && /\d/.test(full) ? full : '';
}
function displayPatient(patient, fields = []) {
    return Object.fromEntries(['id', 'patientCode', 'firstName', 'lastName', 'dob', 'phone',
        'address', 'addressLine1', 'city', 'state', 'zipCode', 'isActive', 'isDeleted', ...fields].map(key => [key, patient[key] ?? null]));
}
function findWarnings(incoming, existing, options = {}) {
    const names = new Map();
    const phones = new Map();
    const addresses = new Map();
    const codes = new Map();
    const nameKey = p => JSON.stringify([normalizeName(p.firstName), normalizeName(p.lastName)]);
    function add(map, key, value) {
        if (!key) return;
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(value);
    }
    function index(patient, source, row) {
        const entry = { patient, source, row };
        add(names, nameKey(patient), entry);
        add(phones, normalizePhone(patient.phone), entry);
        add(addresses, addressKey(patient), entry);
        add(codes, normalizeName(patient.patientCode), entry);
    }
    existing.forEach(p => index(p, 'database', null));
    const warnings = [];
    incoming.forEach((patient, i) => {
        const row = i + 2;
        const name = nameKey(patient);
        const phone = normalizePhone(patient.phone);
        const address = addressKey(patient);
        const candidates = new Set([...(names.get(name) || []), ...(phones.get(phone) || []), ...(addresses.get(address) || []),
            ...(options.includeExact ? codes.get(normalizeName(patient.patientCode)) || [] : [])]);
        const matches = [];
        for (const candidate of candidates) {
            const other = candidate.patient;
            const exact = identityKey(patient) === identityKey(other);
            const sameCode = normalizeName(patient.patientCode) && normalizeName(patient.patientCode) === normalizeName(other.patientCode);
            if (exact && !options.includeExact) continue; // Legacy import/manual-create hard error.
            const reasons = [];
            if (exact) reasons.push('Same name and DOB: creating another patient is blocked');
            else if (name === nameKey(other)) reasons.push('Same first and last name, different DOB');
            if (sameCode && options.includeExact) reasons.push('Same Patient ID: creating another patient is blocked');
            if (phone && phone === normalizePhone(other.phone)) reasons.push('Same phone number (may be shared by a household)');
            if (address && address === addressKey(other) &&
                (normalizeName(patient.firstName) === normalizeName(other.firstName) || normalizeName(patient.lastName) === normalizeName(other.lastName))) {
                reasons.push('Same address and matching first or last name');
            }
            if (reasons.length) matches.push({ source: candidate.source, row: candidate.row, patient: displayPatient(other, options.fields), reasons,
                ...(options.includeExact ? { blocksCreate: !!(exact || sameCode) } : {}) });
        }
        if (matches.length) warnings.push({ row, patient: displayPatient(patient, options.fields), matches,
            ...(options.includeExact ? { canCreate: !matches.some(match => match.blocksCreate) } : {}) });
        index(patient, 'file', row);
    });
    return warnings;
}
function signature(file, userId, warnings, expires) {
    return crypto.createHmac('sha256', reviewSecret).update(file).update(JSON.stringify([userId ?? null, warnings, expires])).digest('hex');
}
function createReviewToken(file, userId, warnings) {
    const expires = Date.now() + 15 * 60 * 1000;
    return `${expires}.${signature(file, userId, warnings, expires)}`;
}
function validReviewToken(token, file, userId, warnings) {
    if (typeof token !== 'string' || !/^\d{13}\.[a-f0-9]{64}$/.test(token)) return false;
    const [expiry, supplied] = token.split('.');
    const expires = Number(expiry);
    if (expires < Date.now() || expires > Date.now() + 15 * 60 * 1000) return false;
    return crypto.timingSafeEqual(Buffer.from(supplied, 'hex'), Buffer.from(signature(file, userId, warnings, expires), 'hex'));
}

module.exports = { normalizeName, normalizePhone, identityKey, findWarnings, createReviewToken, validReviewToken };
