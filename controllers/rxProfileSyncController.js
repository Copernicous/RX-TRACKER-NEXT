'use strict';

const db = require('../models');
const { Op } = require('sequelize');
const crypto = require('crypto');

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

function reviewFingerprint(rxId, field, rxValueId, patientValueId) {
    return crypto.createHash('sha256')
        .update([rxId, field, rxValueId || '', patientValueId || ''].join('|'))
        .digest('hex');
}

async function applyReviewState(rows, reviewStatus, transaction) {
    const rxIds = [...new Set(rows.map(row => positiveId(row.rxId)).filter(Boolean))];
    const events = rxIds.length ? await db.RXProfileSyncReviewEvent.findAll({
        where: { rxRecordId: { [Op.in]: rxIds } },
        order: [['createdAt', 'DESC'], ['id', 'DESC']],
        transaction
    }) : [];
    const latest = new Map();
    events.forEach(event => {
        if (!latest.has(event.fingerprint)) latest.set(event.fingerprint, event);
    });
    rows.forEach(row => {
        const allDifferences = [...row.differences];
        const reviews = {};
        const reviewedDifferences = [];
        const pendingDifferences = [];
        allDifferences.forEach(field => {
            const rxValue = fieldValue(row.rxValues[field === 'pharmacyId' ? 'pharmacy' : field === 'patientTransportCompanyId' ? 'patientTransport' : 'pharmacyTransport'], 'id');
            const patientValue = fieldValue(row.patientValues[field === 'pharmacyId' ? 'pharmacy' : field === 'patientTransportCompanyId' ? 'patientTransport' : 'pharmacyTransport'], 'id');
            const fingerprint = reviewFingerprint(row.rxId, field, rxValue, patientValue);
            const event = latest.get(fingerprint);
            const reviewed = !!(event && event.action === 'reviewed');
            reviews[field] = event ? {
                fingerprint,
                reviewed,
                action: event.action,
                reason: event.reason || '',
                userId: event.userId || null,
                createdAt: event.createdAt || null
            } : { fingerprint, reviewed: false };
            (reviewed ? reviewedDifferences : pendingDifferences).push(field);
        });
        row.allDifferences = allDifferences;
        row.reviewedDifferences = reviewedDifferences;
        row.pendingDifferences = pendingDifferences;
        row.differenceReviews = reviews;
        row.reviewStatus = pendingDifferences.length ? 'pending' : reviewedDifferences.length ? 'reviewed' : 'matching';
        row.differences = reviewStatus === 'reviewed'
            ? reviewedDifferences
            : reviewStatus === 'all' ? allDifferences : pendingDifferences;
    });
    return rows;
}

function matchesReviewStatus(row, reviewStatus, showAll) {
    if (reviewStatus === 'reviewed') return row.reviewedDifferences.length > 0;
    if (reviewStatus === 'all') return row.allDifferences.length > 0 || showAll;
    return row.pendingDifferences.length > 0;
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
        const reviewStatus = ['pending', 'reviewed', 'all'].includes(req.query.reviewStatus) ? req.query.reviewStatus : 'pending';
        const includeMatchingHistory = showAll;
        const pageSize = Math.min(Math.max(Number.parseInt(req.query.pageSize, 10) || 100, 1), 250);
        const cursor = decodeCursor(req.query.cursor);
        const recordConditions = [activeRecordCondition()];
        const lookups = await loadLookups();
        const labels = fieldLabels(lookups);
        if (rxHistoryScope === 'multi') {
            const records = await db.RXRecord.findAll({
                where: { [Op.and]: recordConditions },
                attributes: ['id', 'patientId', 'arrivalDate', 'serviceDate', 'pharmacyId', 'patientTransportCompanyId', 'pharmacyTransportCompanyId', 'createdAt'],
                include: [{
                    model: db.Patient,
                    required: true,
                    attributes: ['id', 'patientCode', 'firstName', 'lastName', 'clinicId', 'pharmacyId', 'patientTransportCompanyId', 'pharmacyTransportCompanyId', 'isDeleted'],
                    where: activeRecordCondition()
                }],
                order: [['patientId', 'ASC'], ['createdAt', 'ASC'], ['id', 'ASC']]
            });
            const groups = new Map();
            records.forEach(record => {
                const rx = record.get({ plain: true });
                const patient = rx.Patient;
                const differences = fieldsToSync(rx, patient);
                const row = {
                    rxId: rx.id, patientId: patient.id,
                    patientName: `${patient.firstName || ''} ${patient.lastName || ''}`.trim() || `Patient #${patient.id}`,
                    patientCode: patient.patientCode || '', rxCreatedAt: rx.createdAt || null, arrivalDate: rx.arrivalDate || null, serviceDate: rx.serviceDate || null,
                    clinicId: patient.clinicId || null, clinicLabel: patient.clinicId ? 'Inherited from Patient profile' : 'Not set on Patient profile',
                    differences, patientValues: valuesWithLabels(auditValues(patient), labels), rxValues: valuesWithLabels(auditValues(rx), labels)
                };
                const group = groups.get(patient.id) || [];
                group.push(row);
                groups.set(patient.id, group);
            });
            const rows = [];
            [...groups.values()].forEach(group => {
                if (group.length < 2) return;
                group.forEach(row => { row.patientRxCount = group.length; });
                rows.push(...group);
            });
            await applyReviewState(rows, reviewStatus);
            const displayedRows = [];
            const reviewedGroups = new Map();
            rows.forEach(row => {
                const group = reviewedGroups.get(row.patientId) || [];
                group.push(row);
                reviewedGroups.set(row.patientId, group);
            });
            [...reviewedGroups.values()].forEach(group => {
                const qualifyingRows = group.filter(row => {
                    const differenceMatch = !requestedDifferenceFields.size || row.differences.some(field => requestedDifferenceFields.has(field));
                    return matchesReviewStatus(row, reviewStatus, showAll) && differenceMatch && rowMatchesProfileSearch(row, search);
                });
                if (!qualifyingRows.length) return;
                // A multi-RX result is a patient history card. Once a card
                // qualifies, history-review mode includes every active RX.
                const rowsForCard = showAll ? group : qualifyingRows;
                rowsForCard.forEach(row => {
                    row.patientRxCount = group.length;
                    row.patientPendingRxCount = group.filter(item => item.pendingDifferences.length > 0).length;
                    row.patientReviewedRxCount = group.filter(item => item.reviewedDifferences.length > 0).length;
                    displayedRows.push(row);
                });
            });
            displayedRows.sort((left, right) => left.patientName.localeCompare(right.patientName) || new Date(left.rxCreatedAt || 0) - new Date(right.rxCreatedAt || 0) || left.rxId - right.rxId);
            return res.json({ rows: displayedRows, total: displayedRows.length, reviewStatus, includesMatchingHistory: showAll, hasMore: false, nextCursor: null, patientCardPaging: true });
        }
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
            const preparedRows = records.map(record => {
                const rx = record.get({ plain: true });
                const patient = rx.Patient;
                const differences = fieldsToSync(rx, patient);
                const patientRxCount = patientRxCounts.get(Number(patient.id)) || 0;
                return {
                    cursor: encodeCursor(rx),
                    row: {
                        rxId: rx.id, patientId: patient.id, patientRxCount,
                        patientName: `${patient.firstName || ''} ${patient.lastName || ''}`.trim() || `Patient #${patient.id}`,
                        patientCode: patient.patientCode || '', rxCreatedAt: rx.createdAt || null, arrivalDate: rx.arrivalDate || null, serviceDate: rx.serviceDate || null,
                        clinicId: patient.clinicId || null, clinicLabel: patient.clinicId ? 'Inherited from Patient profile' : 'Not set on Patient profile',
                        differences,
                        patientValues: valuesWithLabels(auditValues(patient), labels),
                        rxValues: valuesWithLabels(auditValues(rx), labels)
                    }
                };
            });
            await applyReviewState(preparedRows.map(candidate => candidate.row), reviewStatus);
            for (const prepared of preparedRows) {
                const row = prepared.row;
                const patientRxCount = row.patientRxCount;
                    if (matchesReviewStatus(row, reviewStatus, includeMatchingHistory) && (!requestedDifferenceFields.size || row.differences.some(field => requestedDifferenceFields.has(field))) && (rxHistoryScope === 'all' || (rxHistoryScope === 'single' && patientRxCount === 1) || (rxHistoryScope === 'multi' && patientRxCount > 1)) && rowMatchesProfileSearch(row, search)) {
                        candidates.push({
                            cursor: prepared.cursor,
                            row
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
        res.json({ rows: displayed.map(candidate => candidate.row), total: displayed.length, reviewStatus, includesMatchingHistory: includeMatchingHistory, hasMore, nextCursor: hasMore ? displayed[displayed.length - 1].cursor : null });
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

async function changeReviewState({ rxId, requestedFields, action, reason, user, ipAddress }) {
    return db.sequelize.transaction(async transaction => {
        const rx = await db.RXRecord.findOne({
            where: { id: rxId, [Op.and]: [activeRecordCondition()] },
            transaction,
            lock: transaction.LOCK.UPDATE
        });
        if (!rx) throw new Error('RX record was not found or is deleted.');
        const patient = await db.Patient.findOne({
            where: { id: rx.patientId, [Op.and]: [activeRecordCondition()] },
            transaction,
            lock: transaction.LOCK.UPDATE
        });
        if (!patient) throw new Error('The linked Patient profile was not found or is deleted.');
        const fields = fieldsToSync(rx, patient, requestedFields);
        if (!fields.length) return { changed: false, rxId, fields: [] };

        const comparisons = fields.map(field => {
            const rxValueId = fieldValue(rx, field);
            const patientValueId = fieldValue(patient, field);
            return {
                field,
                rxValueId,
                patientValueId,
                fingerprint: reviewFingerprint(rx.id, field, rxValueId, patientValueId)
            };
        });
        const existingEvents = await db.RXProfileSyncReviewEvent.findAll({
            where: { fingerprint: { [Op.in]: comparisons.map(item => item.fingerprint) } },
            order: [['createdAt', 'DESC'], ['id', 'DESC']],
            transaction
        });
        const latest = new Map();
        existingEvents.forEach(event => {
            if (!latest.has(event.fingerprint)) latest.set(event.fingerprint, event);
        });
        const desiredAction = action === 'reopened' ? 'reopened' : 'reviewed';
        const changes = comparisons.filter(item => {
            const current = latest.get(item.fingerprint);
            return desiredAction === 'reopened'
                ? !!(current && current.action === 'reviewed')
                : !current || current.action !== 'reviewed';
        });
        if (!changes.length) return { changed: false, rxId, fields: [] };

        await db.RXProfileSyncReviewEvent.bulkCreate(changes.map(item => ({
            rxRecordId: rx.id,
            fieldName: item.field,
            rxValueId: item.rxValueId,
            patientValueId: item.patientValueId,
            fingerprint: item.fingerprint,
            action: desiredAction,
            reason: reason || null,
            userId: user ? user.id : null
        })), { transaction });

        const patientName = `${patient.firstName || ''} ${patient.lastName || ''}`.trim();
        await db.AuditLog.create({
            userId: user ? user.id : null,
            date: new Date().toISOString().slice(0, 10),
            time: new Date().toTimeString().slice(0, 8),
            module: 'RX Profile Sync',
            action: desiredAction === 'reviewed' ? 'Review' : 'Reopen',
            recordId: rx.id,
            previousValue: {
                rxId: rx.id,
                patientId: patient.id,
                patientCode: patient.patientCode || '',
                patientName,
                fields: changes.map(item => ({ field: item.field, rxValueId: item.rxValueId, patientValueId: item.patientValueId }))
            },
            newValue: {
                reviewState: desiredAction,
                reason: reason || '',
                fields: changes.map(item => ({ field: item.field, fingerprint: item.fingerprint }))
            },
            ipAddress: ipAddress || 'unknown'
        }, { transaction });
        return { changed: true, rxId, action: desiredAction, fields: changes.map(item => item.field) };
    });
}

async function handleReviewState(req, res, action) {
    const rxId = positiveId(req.params.rxId);
    if (!rxId) return res.status(400).json({ error: 'A valid RX record is required.' });
    const fields = req.body && Array.isArray(req.body.fields)
        ? [...new Set(req.body.fields.filter(field => SYNC_FIELDS.includes(field)))]
        : [];
    if (!fields.length) return res.status(400).json({ error: 'Select at least one profile difference.' });
    const reason = String(req.body && req.body.reason || '').trim();
    if (reason.length > 2000) return res.status(400).json({ error: 'Review reason cannot exceed 2000 characters.' });
    try {
        const result = await changeReviewState({
            rxId,
            requestedFields: fields,
            action,
            reason,
            user: req.user,
            ipAddress: req.ip || req.socket?.remoteAddress || 'unknown'
        });
        res.json(result);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
}

exports.review = (req, res) => handleReviewState(req, res, 'reviewed');
exports.reopenReview = (req, res) => handleReviewState(req, res, 'reopened');

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
    const safe = /^\s*[=+\-@]/.test(text) ? `'${text}` : text;
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
            where: { module: 'RX Profile Sync', action: { [Op.in]: ['Sync', 'Review', 'Reopen'] } },
            include: [{ model: db.User, attributes: ['id', 'username', 'firstName', 'lastName'], required: false }],
            order: [['createdAt', 'ASC'], ['id', 'ASC']]
        });
        const columns = [
            'Audit Log ID', 'Timestamp', 'Activity', 'User ID', 'Username', 'RX Record ID',
            'Patient ID', 'Patient Code', 'Patient Name', 'Field', 'Field Key',
            'Previous ID', 'New ID', 'Review State', 'Reason', 'Source', 'IP Address'
        ];
        const rows = [];
        logs.forEach(logRecord => {
            const log = logRecord.get ? logRecord.get({ plain: true }) : logRecord;
            const previous = auditObject(log.previousValue);
            const next = auditObject(log.newValue);
            const previousFields = new Map((previous.fields || []).map(field => [field.field, field.value]));
            const nextFields = Array.isArray(next.fields) ? next.fields : [];
            const user = log.User || {};
            const outputFields = log.action === 'Sync' ? nextFields : (Array.isArray(previous.fields) ? previous.fields : []);
            outputFields.forEach(field => {
                rows.push([
                    log.id,
                    log.createdAt ? new Date(log.createdAt).toISOString() : `${log.date || ''} ${log.time || ''}`.trim(),
                    log.action || '',
                    log.userId || user.id || '',
                    user.username || '',
                    next.rxId || previous.rxId || log.recordId || '',
                    next.patientId || previous.patientId || '',
                    next.patientCode || previous.patientCode || '',
                    next.patientName || previous.patientName || '',
                    SYNC_FIELD_LABELS[field.field] || field.field || '',
                    field.field || '',
                    log.action === 'Sync' ? (previousFields.get(field.field) || '') : (field.rxValueId || ''),
                    log.action === 'Sync' ? (field.value || '') : (field.patientValueId || ''),
                    next.reviewState || '',
                    next.reason || '',
                    next.source || (log.action === 'Sync' ? 'Patient profile' : 'Manual review'),
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
