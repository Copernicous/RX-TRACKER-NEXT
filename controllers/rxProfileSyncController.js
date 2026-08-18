'use strict';

const db = require('../models');
const { Op } = require('sequelize');

const SYNC_FIELDS = [
    'pharmacyId',
    'patientTransportCompanyId',
    'pharmacyTransportCompanyId'
];
const SYNC_FIELD_LABELS = {
    pharmacyId: 'Pharmacy',
    patientTransportCompanyId: 'Patient Transport',
    pharmacyTransportCompanyId: 'Pharmacy Transport'
};

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

function normalizedSearchText(value) {
    return String(value || '').toLocaleLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function rowMatchesProfileSearch(row, search) {
    const terms = normalizedSearchText(search).split(' ').filter(Boolean);
    if (!terms.length) return true;
    const values = [
        row.patientName, row.patientCode, row.patientId, row.rxId,
        `patient ${row.patientId}`, `rx ${row.rxId}`,
        ...row.differences.map(field => SYNC_FIELD_LABELS[field] || field),
        row.patientValues.pharmacy.label, row.rxValues.pharmacy.label,
        row.patientValues.patientTransport.label, row.rxValues.patientTransport.label,
        row.patientValues.pharmacyTransport.label, row.rxValues.pharmacyTransport.label
    ];
    const searchable = normalizedSearchText(values.join(' '));
    return terms.every(term => searchable.includes(term));
}

function decodeCursor(value) {
    if (!value || typeof value !== 'string') return null;
    try {
        const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
        const id = positiveId(parsed && parsed.id);
        const createdAt = parsed && new Date(parsed.createdAt);
        return id && createdAt && !Number.isNaN(createdAt.getTime()) ? { id, createdAt } : null;
    } catch {
        return null;
    }
}

function encodeCursor(record) {
    return Buffer.from(JSON.stringify({ id: record.id, createdAt: record.createdAt })).toString('base64url');
}

function auditValues(record) {
    return {
        pharmacyId: fieldValue(record, 'pharmacyId'),
        patientTransportCompanyId: fieldValue(record, 'patientTransportCompanyId'),
        pharmacyTransportCompanyId: fieldValue(record, 'pharmacyTransportCompanyId')
    };
}

function fieldValue(record, field) {
    const value = record && typeof record.get === 'function'
        ? record.get(field)
        : record && record[field];
    return positiveId(value);
}

function fieldsToSync(rx, patient, requestedFields) {
    const requested = Array.isArray(requestedFields)
        ? [...new Set(requestedFields.filter(field => SYNC_FIELDS.includes(field)))]
        : SYNC_FIELDS;
    return requested.filter(field => {
        const patientValue = fieldValue(patient, field);
        return patientValue && fieldValue(rx, field) !== patientValue;
    });
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
        const requestedDifferenceFields = new Set(String(req.query.differenceFields || '').split(',').filter(field => SYNC_FIELDS.includes(field)));
        const rxHistoryScope = ['single', 'multi'].includes(req.query.rxHistoryScope) ? req.query.rxHistoryScope : 'all';
        const includeMatchingHistory = showAll || rxHistoryScope === 'multi';
        const pageSize = Math.min(Math.max(Number.parseInt(req.query.pageSize, 10) || 100, 1), 250);
        const cursor = decodeCursor(req.query.cursor);
        const recordConditions = [activeRecordCondition()];
        const lookups = await loadLookups();
        const labels = fieldLabels(lookups);
        const candidates = [];
        let scanCursor = cursor;
        let reachedEnd = false;
        while (candidates.length <= pageSize && !reachedEnd) {
            const conditions = [...recordConditions];
            if (scanCursor) {
                conditions.push({ [Op.or]: [
                    { createdAt: { [Op.gt]: scanCursor.createdAt } },
                    { [Op.and]: [{ createdAt: scanCursor.createdAt }, { id: { [Op.gt]: scanCursor.id } }] }
                ] });
            }
            const records = await db.RXRecord.findAll({
                where: { [Op.and]: conditions },
                attributes: ['id', 'patientId', 'arrivalDate', 'serviceDate', 'pharmacyId', 'patientTransportCompanyId', 'pharmacyTransportCompanyId', 'createdAt'],
                include: [{
                    model: db.Patient,
                    required: true,
                    attributes: ['id', 'patientCode', 'firstName', 'lastName', 'clinicId', 'pharmacyId', 'patientTransportCompanyId', 'pharmacyTransportCompanyId', 'isDeleted'],
                    where: activeRecordCondition()
                }],
                order: [['createdAt', 'ASC'], ['id', 'ASC']],
                limit: 250
            });
            if (!records.length) {
                reachedEnd = true;
                break;
            }
            const patientIds = [...new Set(records.map(record => Number(record.patientId)).filter(Number.isInteger))];
            const patientRxCounts = new Map((await db.RXRecord.findAll({
                where: { [Op.and]: [activeRecordCondition(), { patientId: { [Op.in]: patientIds } }] },
                attributes: ['patientId', [db.sequelize.fn('COUNT', db.sequelize.col('id')), 'count']],
                group: ['patientId'], raw: true
            })).map(row => [Number(row.patientId), Number(row.count)]));
            for (const record of records) {
                const rx = record.get({ plain: true });
                const patient = rx.Patient;
                const differences = fieldsToSync(rx, patient);
                const patientRxCount = patientRxCounts.get(Number(patient.id)) || 0;
                    if ((includeMatchingHistory || differences.length) && (!requestedDifferenceFields.size || differences.some(field => requestedDifferenceFields.has(field)) || (rxHistoryScope === 'multi' && !differences.length)) && (rxHistoryScope === 'all' || (rxHistoryScope === 'single' && patientRxCount === 1) || (rxHistoryScope === 'multi' && patientRxCount > 1)) && rowMatchesProfileSearch({
                        patientName: `${patient.firstName || ''} ${patient.lastName || ''}`.trim() || `Patient #${patient.id}`,
                        patientCode: patient.patientCode || '', patientId: patient.id, rxId: rx.id,
                        differences, patientValues: valuesWithLabels(auditValues(patient), labels), rxValues: valuesWithLabels(auditValues(rx), labels)
                    }, search)) {
                        const patientValues = valuesWithLabels(auditValues(patient), labels);
                        const rxValues = valuesWithLabels(auditValues(rx), labels);
                        candidates.push({
                        cursor: encodeCursor(rx),
                        row: {
                            rxId: rx.id, patientId: patient.id, patientRxCount,
                            patientName: `${patient.firstName || ''} ${patient.lastName || ''}`.trim() || `Patient #${patient.id}`,
                            patientCode: patient.patientCode || '', rxCreatedAt: rx.createdAt || null, arrivalDate: rx.arrivalDate || null, serviceDate: rx.serviceDate || null,
                            clinicId: patient.clinicId || null, clinicLabel: patient.clinicId ? 'Inherited from Patient profile' : 'Not set on Patient profile',
                            differences, patientValues, rxValues
                        }
                    });
                    if (candidates.length > pageSize) break;
                }
            }
            const last = records[records.length - 1].get({ plain: true });
            scanCursor = { id: last.id, createdAt: last.createdAt };
            reachedEnd = records.length < 250;
        }
        const hasMore = candidates.length > pageSize;
        const displayed = candidates.slice(0, pageSize);
        res.json({ rows: displayed.map(candidate => candidate.row), total: displayed.length, includesMatchingHistory: includeMatchingHistory, hasMore, nextCursor: hasMore ? displayed[displayed.length - 1].cursor : null });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

async function syncRxRecord({ rxId, requestedFields, user, ipAddress }) {
    return db.sequelize.transaction(async transaction => {
        const rx = await db.RXRecord.findOne({
            where: { id: rxId, [Op.and]: [activeRecordCondition()] },
            include: [{ model: db.Patient, required: true, where: activeRecordCondition() }],
            transaction,
            lock: transaction.LOCK.UPDATE
        });
        if (!rx) throw new Error('RX record was not found or is deleted.');
        const patient = rx.Patient;
        const fields = fieldsToSync(rx, patient, requestedFields);
        if (!fields.length) return { updated: false, rxId, patientId: patient.id, changes: [] };

        const before = rx.get({ plain: true });
        const update = {};
        const changes = fields.map(field => {
            const value = fieldValue(patient, field);
            update[field] = value;
            return { field, from: fieldValue(before, field), to: value };
        });
        if (fields.includes('pharmacyId')) {
            await rx.update({ pharmacyId: update.pharmacyId }, { transaction });
        }
        const transportFields = fields.filter(field => field !== 'pharmacyId');
        if (transportFields.length) {
            transportFields.forEach(field => rx.setDataValue(field, update[field]));
            await rx.save({ fields: transportFields, transaction });
        }

        await rx.reload({
            attributes: ['id', ...SYNC_FIELDS],
            transaction
        });
        const failedFields = fields.filter(field => fieldValue(rx, field) !== fieldValue(patient, field));
        if (failedFields.length) {
            throw new Error(`RX profile sync did not persist: ${failedFields.join(', ')}.`);
        }
        await db.RXHistory.create({
            rxRecordId: rx.id,
            userId: user ? user.id : null,
            changeType: 'Profile Sync',
            snapshot: JSON.stringify(before),
            changedFields: JSON.stringify(changes),
            note: 'Administrator synced selected RX profile fields from the current Patient profile.'
        }, { transaction });
        const patientName = `${patient.firstName || ''} ${patient.lastName || ''}`.trim();
        await db.AuditLog.create({
            userId: user ? user.id : null,
            date: new Date().toISOString().slice(0, 10),
            time: new Date().toTimeString().slice(0, 8),
            module: 'RX Profile Sync',
            action: 'Sync',
            recordId: rx.id,
            previousValue: {
                rxId: rx.id,
                patientId: patient.id,
                patientCode: patient.patientCode || '',
                patientName,
                fields: changes.map(change => ({ field: change.field, value: change.from }))
            },
            newValue: {
                rxId: rx.id,
                patientId: patient.id,
                patientCode: patient.patientCode || '',
                patientName,
                source: 'Patient profile',
                fields: changes.map(change => ({ field: change.field, value: change.to }))
            },
            ipAddress: ipAddress || 'unknown'
        }, { transaction });
        return {
            updated: true,
            rxId,
            patientId: patient.id,
            changes,
            values: auditValues(rx)
        };
    });
}

exports.sync = async (req, res) => {
    const rxId = positiveId(req.params.rxId);
    if (!rxId) return res.status(400).json({ error: 'A valid RX record is required.' });
    try {
        const result = await syncRxRecord({
            rxId,
            requestedFields: req.body && req.body.fields,
            user: req.user,
            ipAddress: req.ip || req.socket?.remoteAddress || 'unknown'
        });
        res.json(result);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
};

exports.bulkSync = async (req, res) => {
    const entries = req.body && Array.isArray(req.body.entries) ? req.body.entries : [];
    if (!entries.length) return res.status(400).json({ error: 'Select at least one RX record.' });
    if (entries.length > 100) return res.status(400).json({ error: 'A maximum of 100 RX records can be synchronized at once.' });

    const normalized = [];
    const seen = new Set();
    for (const entry of entries) {
        const rxId = positiveId(entry && entry.rxId);
        const fields = entry && Array.isArray(entry.fields)
            ? [...new Set(entry.fields.filter(field => SYNC_FIELDS.includes(field)))]
            : [];
        if (!rxId || seen.has(rxId) || !fields.length) continue;
        seen.add(rxId);
        normalized.push({ rxId, fields });
    }
    if (!normalized.length) return res.status(400).json({ error: 'The selected RX records have no valid fields to synchronize.' });

    const results = [];
    for (const entry of normalized) {
        try {
            const result = await syncRxRecord({
                rxId: entry.rxId,
                requestedFields: entry.fields,
                user: req.user,
                ipAddress: req.ip || req.socket?.remoteAddress || 'unknown'
            });
            results.push({ ...result, ok: true });
        } catch (error) {
            results.push({ rxId: entry.rxId, ok: false, updated: false, error: error.message });
        }
    }
    res.json({
        requested: normalized.length,
        updated: results.filter(result => result.ok && result.updated).length,
        unchanged: results.filter(result => result.ok && !result.updated).length,
        failed: results.filter(result => !result.ok).length,
        results
    });
};

function csvCell(value) {
    const text = value === null || value === undefined ? '' : String(value);
    const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
    return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function auditObject(value) {
    if (!value) return {};
    if (typeof value === 'object') return value;
    try { return JSON.parse(value); } catch { return {}; }
}

exports.exportHistory = async (req, res) => {
    try {
        const logs = await db.AuditLog.findAll({
            where: { module: 'RX Profile Sync', action: 'Sync' },
            include: [{ model: db.User, attributes: ['id', 'username', 'firstName', 'lastName'], required: false }],
            order: [['createdAt', 'ASC'], ['id', 'ASC']]
        });
        const columns = [
            'Audit Log ID', 'Timestamp', 'User ID', 'Username', 'RX Record ID',
            'Patient ID', 'Patient Code', 'Patient Name', 'Field', 'Field Key',
            'Previous ID', 'New ID', 'Source', 'IP Address'
        ];
        const rows = [];
        logs.forEach(logRecord => {
            const log = logRecord.get ? logRecord.get({ plain: true }) : logRecord;
            const previous = auditObject(log.previousValue);
            const next = auditObject(log.newValue);
            const previousFields = new Map((previous.fields || []).map(field => [field.field, field.value]));
            const nextFields = Array.isArray(next.fields) ? next.fields : [];
            const user = log.User || {};
            nextFields.forEach(field => {
                rows.push([
                    log.id,
                    log.createdAt ? new Date(log.createdAt).toISOString() : `${log.date || ''} ${log.time || ''}`.trim(),
                    log.userId || user.id || '',
                    user.username || '',
                    next.rxId || previous.rxId || log.recordId || '',
                    next.patientId || previous.patientId || '',
                    next.patientCode || previous.patientCode || '',
                    next.patientName || previous.patientName || '',
                    SYNC_FIELD_LABELS[field.field] || field.field || '',
                    field.field || '',
                    previousFields.get(field.field) || '',
                    field.value || '',
                    next.source || 'Patient profile',
                    log.ipAddress || ''
                ]);
            });
        });
        const csv = '\uFEFF' + [columns, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n');
        const filename = `rx-profile-sync-history-${new Date().toISOString().slice(0, 10)}.csv`;
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(csv);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
