'use strict';

const db = require('../models');
const { getServiceWindowDays, isServiceDateOverrideEnabled } = require('../utils/globalSettings');
const { syncPatientServiceDateCycles, buildPatientContextSnapshot } = require('./patientServiceDateCycleService');
const { recordPatientServiceDateChange } = require('./patientServiceDateHistoryService');
const { applyRegionalTagRuleToIds } = require('./cityRegionRuleService');
const { FIELDS, fieldValue } = require('../utils/patientImportMerge');
const reviewError = message => Object.assign(new Error(message), { status: 400 });

async function applyMerge(item, req, transaction, permission) {
    const patient = await db.Patient.findByPk(item.targetId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!patient || ((patient.isDeleted || patient.isActive === false) && !item.restore)) throw reviewError('The merge target is unavailable. Review again.');
    const patch = { ...item.patch, ...(item.restore ? { isDeleted: false, isActive: true } : {}) };
    const changedFields = Object.keys(patch);
    const previousServiceDate = patient.serviceDate;
    const dateChanged = changedFields.includes('serviceDate');
    const contextChanged = dateChanged || ['clinicId', 'patientTransportCompanyId', 'pharmacyTransportCompanyId'].some(key => changedFields.includes(key));
    if (dateChanged && previousServiceDate && !isServiceDateOverrideEnabled() && !permission.canOverrideExpired) {
        const expiry = new Date(previousServiceDate + 'T00:00:00');
        expiry.setDate(expiry.getDate() + getServiceWindowDays());
        const today = new Date(); today.setHours(0, 0, 0, 0);
        if (today <= expiry) throw reviewError(`Row ${item.row}: the existing service-date window has not expired. Keep the existing service date.`);
    }
    const previousContext = contextChanged ? await buildPatientContextSnapshot(patient, { transaction, source: 'Before Patient Import Merge' }) : null;
    const previousValue = Object.fromEntries(changedFields.map(key => [key, patient[key] ?? null]));
    if (changedFields.length) await patient.update(patch, { transaction });
    let restoredRxCount = 0;
    if (item.restore) {
        [restoredRxCount] = await db.RXRecord.update({ isDeleted: false, deletedAt: null },
            { where: { patientId: patient.id, isDeleted: true }, transaction });
    }
    if (['address', 'addressLine1', 'city', 'state', 'zipCode'].some(key => changedFields.includes(key))) {
        const tags = await patient.getPatientTags({ transaction });
        const ids = await applyRegionalTagRuleToIds(tags.map(tag => tag.id), { transaction, address: patient.address, city: patient.city });
        await patient.setPatientTags(ids, { transaction });
    }
    if (contextChanged) await syncPatientServiceDateCycles(patient, { transaction, userId: req.user?.id || null,
        source: 'Patient Import Merge', previousPatientContext: previousContext,
        contextChangeReason: 'Selected patient defaults updated by reviewed CSV merge.' });
    if (dateChanged) await recordPatientServiceDateChange({ patientId: patient.id, previousServiceDate,
        newServiceDate: patient.serviceDate, userId: req.user?.id || null, changeSource: 'Patient Import Merge',
        reason: 'Service date explicitly selected in CSV merge.' }, { transaction });
    await db.AuditLog.create({ userId: req.user?.id || null, date: new Date().toISOString().slice(0, 10),
        time: new Date().toTimeString().slice(0, 8), module: 'Data Import', action: 'Merge patient import row', recordId: patient.id,
        previousValue, newValue: { csvRow: item.row, changedFields, choices: item.choices, values: patch, restored: item.restore, restoredRxCount },
        ipAddress: req.ip || req.socket?.remoteAddress || 'unknown' }, { transaction });
    return { row: item.row, patientId: patient.id, patientCode: patient.patientCode, changedFields, restored: item.restore,
        fields: [...(item.restore ? [
            { field: 'Patient status', choice: 'Restore/reactivate and merge', before: item.target.isDeleted ? 'Deleted' : 'Inactive', incoming: null, after: 'Active' },
            { field: 'Restored RX records', choice: 'Restore linked hidden RX records', before: restoredRxCount, incoming: null, after: restoredRxCount }
        ] : []), ...FIELDS.map(([field, label]) => ({ field: label, choice: item.choices[field] || 'keep',
            before: fieldValue(item.target, field), incoming: fieldValue(item.patient, field), after: fieldValue(patient, field) }))] };
}
module.exports = { applyMerge };
