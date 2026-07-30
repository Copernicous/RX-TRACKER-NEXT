'use strict';

const db = require('../models');
const { Op } = require('sequelize');

const SYNC_FIELDS = [
    'pharmacyId',
    'patientTransportCompanyId',
    'pharmacyTransportCompanyId'
];

function positiveId(value) {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function activeRecordCondition() {
    return { [Op.or]: [{ isDeleted: false }, { isDeleted: null }] };
}

function profileSearchCondition(value) {
    const search = String(value || '').trim();
    if (!search) return null;

    const numericMatch = /^(?:rx\s*#?\s*)?(\d+)$/i.exec(search);
    const conditions = [];
    if (numericMatch) {
        const identifier = positiveId(numericMatch[1]);
        if (identifier) conditions.push({ [Op.or]: [{ id: identifier }, { patientId: identifier }] });
    }

    conditions.push({ '$Patient.patientCode$': { [Op.iLike]: '%' + search + '%' } });
    const nameTerms = search.split(/\s+/).filter(Boolean);
    if (nameTerms.length) {
        conditions.push({
            [Op.and]: nameTerms.map(term => ({
                [Op.or]: [
                    { '$Patient.firstName$': { [Op.iLike]: '%' + term + '%' } },
                    { '$Patient.lastName$': { [Op.iLike]: '%' + term + '%' } }
                ]
            }))
        });
    }
    return { [Op.or]: conditions };
}

function auditValues(record) {
    return {
        pharmacyId: record.pharmacyId || null,
        patientTransportCompanyId: record.patientTransportCompanyId || null,
        pharmacyTransportCompanyId: record.pharmacyTransportCompanyId || null
    };
}

function fieldsToSync(rx, patient, requestedFields) {
    const requested = Array.isArray(requestedFields) && requestedFields.length
        ? requestedFields.filter(field => SYNC_FIELDS.includes(field))
        : SYNC_FIELDS;
    return requested.filter(field => patient[field] && Number(rx[field] || 0) !== Number(patient[field]));
}

function fieldLabels(lookups) {
    const map = (rows, name) => new Map(rows.map(row => [Number(row.id), row[name] || `#${row.id}`]));
    return {
        pharmacy: map(lookups.pharmacies, 'name'),
        patientTransport: map(lookups.patientTransports, 'companyName'),
        pharmacyTransport: map(lookups.pharmacyTransports, 'companyName')
    };
}

async function loadLookups() {
    const [pharmacies, patientTransports, pharmacyTransports] = await Promise.all([
        db.Pharmacy.findAll({ attributes: ['id', 'name'], raw: true }),
        db.PatientTransportCompany.findAll({ attributes: ['id', 'companyName'], raw: true }),
        db.PharmacyTransportCompany.findAll({ attributes: ['id', 'companyName'], raw: true })
    ]);
    return { pharmacies, patientTransports, pharmacyTransports };
}

function valuesWithLabels(values, labels) {
    return {
        pharmacy: { id: values.pharmacyId || null, label: values.pharmacyId ? labels.pharmacy.get(Number(values.pharmacyId)) || `#${values.pharmacyId}` : 'Not set' },
        patientTransport: { id: values.patientTransportCompanyId || null, label: values.patientTransportCompanyId ? labels.patientTransport.get(Number(values.patientTransportCompanyId)) || `#${values.patientTransportCompanyId}` : 'Not set' },
        pharmacyTransport: { id: values.pharmacyTransportCompanyId || null, label: values.pharmacyTransportCompanyId ? labels.pharmacyTransport.get(Number(values.pharmacyTransportCompanyId)) || `#${values.pharmacyTransportCompanyId}` : 'Not set' }
    };
}

exports.list = async (req, res) => {
    try {
        const search = String(req.query.search || '').trim();
        const showAll = String(req.query.showAll || '') === 'true';
        const searchCondition = profileSearchCondition(search);
        const recordConditions = [activeRecordCondition()];
        if (searchCondition) recordConditions.push(searchCondition);
        const records = await db.RXRecord.findAll({
            where: { [Op.and]: recordConditions },
            attributes: ['id', 'patientId', 'arrivalDate', 'serviceDate', 'pharmacyId', 'patientTransportCompanyId', 'pharmacyTransportCompanyId', 'createdAt'],
            include: [{
                model: db.Patient,
                required: true,
                attributes: ['id', 'patientCode', 'firstName', 'lastName', 'clinicId', 'pharmacyId', 'patientTransportCompanyId', 'pharmacyTransportCompanyId', 'isDeleted'],
                where: activeRecordCondition()
            }],
            order: [['createdAt', 'ASC'], ['id', 'ASC']],
            limit: 1000
        });
        const lookups = await loadLookups();
        const labels = fieldLabels(lookups);
        const rows = records.map(record => {
            const rx = record.get({ plain: true });
            const patient = rx.Patient;
            const differences = fieldsToSync(rx, patient);
            return {
                rxId: rx.id,
                patientId: patient.id,
                patientName: `${patient.firstName || ''} ${patient.lastName || ''}`.trim() || `Patient #${patient.id}`,
                patientCode: patient.patientCode || '',
                arrivalDate: rx.arrivalDate || null,
                serviceDate: rx.serviceDate || null,
                clinicId: patient.clinicId || null,
                clinicLabel: patient.clinicId ? 'Inherited from Patient profile' : 'Not set on Patient profile',
                differences,
                patientValues: valuesWithLabels(auditValues(patient), labels),
                rxValues: valuesWithLabels(auditValues(rx), labels)
            };
        }).filter(row => showAll || row.differences.length > 0);
        res.json({ rows, limited: records.length === 1000, total: rows.length });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.sync = async (req, res) => {
    const rxId = positiveId(req.params.rxId);
    if (!rxId) return res.status(400).json({ error: 'A valid RX record is required.' });
    try {
        const result = await db.sequelize.transaction(async transaction => {
            const rx = await db.RXRecord.findOne({
                where: { id: rxId, [Op.and]: [activeRecordCondition()] },
                include: [{ model: db.Patient, required: true, where: activeRecordCondition() }],
                transaction,
                lock: transaction.LOCK.UPDATE
            });
            if (!rx) throw new Error('RX record was not found or is deleted.');
            const patient = rx.Patient;
            const fields = fieldsToSync(rx, patient, req.body && req.body.fields);
            if (!fields.length) return { updated: false, rxId, changes: [] };

            const before = rx.get({ plain: true });
            const update = {};
            const changes = fields.map(field => {
                update[field] = patient[field];
                return { field, from: before[field] || null, to: patient[field] || null };
            });
            await rx.update(update, { transaction });
            await db.RXHistory.create({
                rxRecordId: rx.id,
                userId: req.user ? req.user.id : null,
                changeType: 'Profile Sync',
                snapshot: JSON.stringify(before),
                changedFields: JSON.stringify(changes),
                note: 'Administrator synced selected RX profile fields from the current Patient profile.'
            }, { transaction });
            await db.AuditLog.create({
                userId: req.user ? req.user.id : null,
                date: new Date().toISOString().slice(0, 10),
                time: new Date().toTimeString().slice(0, 8),
                module: 'RX Profile Sync',
                action: 'Sync',
                recordId: rx.id,
                previousValue: { rxId: rx.id, patientId: patient.id, fields: changes.map(change => ({ field: change.field, value: change.from })) },
                newValue: { rxId: rx.id, patientId: patient.id, source: 'Patient profile', fields: changes.map(change => ({ field: change.field, value: change.to })) },
                ipAddress: req.ip || req.socket?.remoteAddress || 'unknown'
            }, { transaction });
            return { updated: true, rxId, patientId: patient.id, changes };
        });
        res.json(result);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
};