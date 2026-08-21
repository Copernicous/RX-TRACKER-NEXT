'use strict';

function cleanCompanyName(value) {
    return String(value === null || value === undefined ? '' : value)
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeCompanyName(value) {
    return cleanCompanyName(value).toLocaleLowerCase('en-US');
}

function findCompanyNameConflict(records, companyName, excludedId = null) {
    const normalized = normalizeCompanyName(companyName);
    if (!normalized) return null;

    const matches = (records || []).filter(record => (
        Number(record.id) !== Number(excludedId) &&
        normalizeCompanyName(record.companyName) === normalized
    )).sort((left, right) => Number(left.id) - Number(right.id));
    return matches.find(record => record.isActive !== false) || matches[0] || null;
}

function duplicateCompanyMessage(record) {
    const id = Number(record && record.id);
    const name = cleanCompanyName(record && record.companyName) || 'this name';
    if (record && record.isActive === false) {
        return `Pharmacy Transport "${name}" already exists as disabled ID ${id}. Turn on Show Disabled and restore that record instead of creating a new ID.`;
    }
    return `Pharmacy Transport "${name}" already exists as active ID ${id}. Use or update the existing record instead of creating a duplicate.`;
}

module.exports = {
    cleanCompanyName,
    normalizeCompanyName,
    findCompanyNameConflict,
    duplicateCompanyMessage
};
