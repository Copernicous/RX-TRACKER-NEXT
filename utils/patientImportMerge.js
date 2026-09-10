'use strict';

const { identityKey } = require('./patientImportDuplicates');
const FIELDS = [
    ['firstName', 'First name'], ['lastName', 'Last name'], ['dob', 'DOB'], ['phone', 'Phone'],
    ['address', 'Address (street, city, state, ZIP)'], ['notes', 'Notes'],
    ['clinicId', 'Clinic'], ['patientTransportCompanyId', 'Patient transport'],
    ['pharmacyTransportCompanyId', 'Pharmacy transport'], ['serviceDate', 'Service date']
];
const ADDRESS_FIELDS = ['address', 'addressLine1', 'city', 'state', 'zipCode'];
const SNAPSHOT_FIELDS = ['notes', 'clinicId', 'patientTransportCompanyId', 'pharmacyTransportCompanyId', 'serviceDate', 'updatedAt'];
const empty = value => value === null || value === undefined || String(value).trim() === '';
function fieldValue(patient, field) {
    if (field === 'address') return Object.fromEntries(ADDRESS_FIELDS.map(key => [key, patient[key] || null]));
    return patient[field] ?? null;
}
function emptyField(patient, field) {
    return field === 'address' ? ADDRESS_FIELDS.every(key => empty(patient[key])) : empty(patient[field]);
}
function mergePatch(target, incoming, choices) {
    if (!choices || typeof choices !== 'object' || Array.isArray(choices)) throw Error('Choose the fields to merge.');
    const allowed = new Set(FIELDS.map(([key]) => key));
    const patch = {};
    for (const [field, choice] of Object.entries(choices)) {
        if (!allowed.has(field) || !['keep', 'incoming', 'fill', ...(field === 'notes' ? ['append'] : [])].includes(choice)) {
            throw Error('Invalid merge field or action. Review the row again.');
        }
        // Missing/blank CSV values never erase stored data, even with "Use incoming".
        if (choice === 'keep' || emptyField(incoming, field) || (choice === 'fill' && !emptyField(target, field))) continue;
        if (field === 'address') Object.assign(patch, fieldValue(incoming, field));
        else if (field === 'notes' && choice === 'append') patch.notes = [target.notes, incoming.notes].filter(value => !empty(value)).join('\n');
        else patch[field] = incoming[field];
    }
    for (const key of Object.keys(patch)) if (JSON.stringify(patch[key] ?? null) === JSON.stringify(target[key] ?? null)) delete patch[key];
    return patch;
}
function buildPlan(incoming, existing, warnings, decisions, canEdit) {
    if (!Array.isArray(decisions)) throw Error('Review decisions must be a list.');
    const byRow = new Map(warnings.map(w => [w.row, w]));
    const choices = new Map();
    for (const decision of decisions) {
        if (!decision || !Number.isInteger(decision.row) || !byRow.has(decision.row) || choices.has(decision.row) ||
            !['import', 'skip', 'merge'].includes(decision.action)) throw Error('Invalid or repeated row decision. Review the file again.');
        choices.set(decision.row, decision);
    }
    const targets = new Set();
    const plan = incoming.map((patient, i) => {
        const row = i + 2, warning = byRow.get(row), decision = choices.get(row);
        if (warning && !decision) throw Error(`Choose an action for CSV row ${row}.`);
        const action = decision?.action || 'import';
        if (action === 'skip') return { row, action };
        if (action === 'import') {
            if (warning && !warning.canCreate) throw Error(`Row ${row}: matching name/DOB or Patient ID cannot create another patient. Merge or discard the row.`);
            return { row, action, patient };
        }
        if (!canEdit) throw Error('Patient Edit permission is required to merge.');
        const targetId = decision.targetId;
        if (!Number.isInteger(targetId) || !warning.matches.some(m => m.source === 'database' && m.patient.id === targetId)) {
            throw Error(`Row ${row}: select an existing patient shown in this review.`);
        }
        const target = existing.find(p => p.id === targetId);
        if (!target) throw Error(`Row ${row}: the existing patient is unavailable.`);
        const restore = !!target.isDeleted || target.isActive === false;
        if (restore && decision.confirmRestore !== true) throw Error(`Row ${row}: explicitly confirm restore/reactivate and merge.`);
        if (targets.has(targetId)) throw Error('Two rows cannot merge into the same patient in one import. Combine the incoming rows first.');
        targets.add(targetId);
        const patch = mergePatch(target, patient, decision.fields);
        return { row, action, targetId, patch, patient, target, restore, choices: decision.fields };
    });
    // Check the projected final identities together, including merges and new patients.
    const projected = new Map(existing.map(p => [p.id, p]));
    for (const item of plan) if (item.action === 'merge') projected.set(item.targetId, { ...item.target, ...item.patch });
    const newKeys = new Set();
    const newCodes = new Set();
    for (const item of plan) {
        if (item.action === 'skip') continue;
        const final = item.action === 'merge' ? projected.get(item.targetId) : item.patient;
        const key = identityKey(final);
        if (item.action === 'import' || key !== identityKey(item.target)) {
            if ([...projected.values()].some(p => p.id !== item.targetId && identityKey(p) === key) || newKeys.has(key)) {
                throw Error(`Row ${item.row}: the selected changes would create a duplicate name and DOB.`);
            }
        }
        if (item.action === 'import') {
            const code = String(final.patientCode).trim().toLowerCase();
            if (newCodes.has(code) || [...projected.values()].some(p => String(p.patientCode).trim().toLowerCase() === code)) throw Error(`Row ${item.row}: Patient ID already exists.`);
            newKeys.add(key); newCodes.add(code);
        }
    }
    return plan;
}
module.exports = { FIELDS, SNAPSHOT_FIELDS, fieldValue, emptyField, mergePatch, buildPlan };
