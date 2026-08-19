const db = require('../models');
const {
    cleanCompanyName,
    normalizeCompanyName,
    findCompanyNameConflict,
    duplicateCompanyMessage
} = require('../utils/pharmacyTransportIdentity');

const Model = db.PharmacyTransportCompany;
const TEXT_FIELDS = ['phone', 'contactPerson', 'notes'];

function hasOwn(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj || {}, key);
}

function cleanText(value) {
    if (value === undefined) return undefined;
    if (value === null) return null;
    const text = String(value).trim();
    return text === '' ? null : text;
}

function transportPayload(body, requireName) {
    const payload = {};
    if (hasOwn(body, 'companyName')) {
        const companyName = cleanCompanyName(body.companyName);
        if (!companyName) throw new Error('Company Name is required.');
        payload.companyName = companyName;
    } else if (requireName) {
        throw new Error('Company Name is required.');
    }

    TEXT_FIELDS.forEach(field => {
        if (hasOwn(body, field)) payload[field] = cleanText(body[field]);
    });
    return payload;
}

async function lockIdentityChanges(transaction) {
    await db.sequelize.query(
        "SELECT pg_advisory_xact_lock(hashtext('rx-pharmacy-transport-company-identity'))",
        { transaction }
    );
}

async function findConflict(companyName, excludedId, transaction) {
    const records = await Model.findAll({
        attributes: ['id', 'companyName', 'isActive'],
        transaction
    });
    return findCompanyNameConflict(records, companyName, excludedId);
}

function sendConflict(res, conflict) {
    return res.status(409).json({
        error: duplicateCompanyMessage(conflict),
        duplicate: {
            id: conflict.id,
            companyName: conflict.companyName,
            isActive: conflict.isActive !== false
        }
    });
}

exports.getAll = async (req, res) => {
    try {
        const includeInactive = req.query.includeInactive === 'true';
        const where = includeInactive ? {} : { isActive: true };
        const data = await Model.findAll({ where });
        res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.getOne = async (req, res) => {
    try {
        const data = await Model.findByPk(req.params.id);
        if (!data) return res.status(404).json({ message: 'Not found' });
        res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.create = async (req, res) => {
    try {
        const payload = transportPayload(req.body, true);
        let conflict = null;
        const data = await db.sequelize.transaction(async transaction => {
            await lockIdentityChanges(transaction);
            conflict = await findConflict(payload.companyName, null, transaction);
            if (conflict) return null;
            return Model.create({ ...payload, isActive: true }, { transaction });
        });
        if (conflict) return sendConflict(res, conflict);
        req.auditRecordId = data.id;
        res.status(201).json(data);
    } catch (err) { res.status(400).json({ error: err.message }); }
};

exports.update = async (req, res) => {
    try {
        const payload = transportPayload(req.body, false);
        let conflict = null;
        let found = true;
        const data = await db.sequelize.transaction(async transaction => {
            await lockIdentityChanges(transaction);
            const record = await Model.findByPk(req.params.id, { transaction, lock: transaction.LOCK.UPDATE });
            if (!record) {
                found = false;
                return null;
            }
            if (payload.companyName && normalizeCompanyName(payload.companyName) !== normalizeCompanyName(record.companyName)) {
                conflict = await findConflict(payload.companyName, record.id, transaction);
                if (conflict) return null;
            }
            await record.update(payload, { transaction });
            return record;
        });
        if (!found) return res.status(404).json({ message: 'Not found' });
        if (conflict) return sendConflict(res, conflict);
        res.json(data);
    } catch (err) { res.status(400).json({ error: err.message }); }
};

// Soft-disable: set isActive = false (history preserved)
exports.delete = async (req, res) => {
    try {
        const record = await Model.findByPk(req.params.id);
        if (!record) return res.status(404).json({ message: 'Not found' });
        await record.update({ isActive: false });
        res.status(200).json({ message: 'Record disabled.' });
    } catch (err) { res.status(500).json({ error: err.message }); }
};

// Restore: re-enable
exports.restore = async (req, res) => {
    try {
        let conflict = null;
        let found = true;
        await db.sequelize.transaction(async transaction => {
            await lockIdentityChanges(transaction);
            const record = await Model.findByPk(req.params.id, { transaction, lock: transaction.LOCK.UPDATE });
            if (!record) {
                found = false;
                return;
            }
            conflict = await findConflict(record.companyName, record.id, transaction);
            if (conflict && conflict.isActive === false) conflict = null;
            if (conflict) return;
            await record.update({ isActive: true }, { transaction });
        });
        if (!found) return res.status(404).json({ message: 'Not found' });
        if (conflict) return sendConflict(res, conflict);
        res.status(200).json({ message: 'Record restored.' });
    } catch (err) { res.status(500).json({ error: err.message }); }
};
