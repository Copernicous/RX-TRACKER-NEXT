const db = require('../models');

const Model = db.Pharmacy;
const TEXT_FIELDS = ['address', 'phone', 'contactPerson', 'notes'];

function hasOwn(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj || {}, key);
}

function cleanText(value) {
    if (value === undefined) return undefined;
    if (value === null) return null;
    const text = String(value).trim();
    return text === '' ? null : text;
}

function pharmacyPayload(body, requireName) {
    const payload = {};
    if (hasOwn(body, 'name')) {
        const name = cleanText(body.name);
        if (!name) throw new Error('Pharmacy name is required.');
        payload.name = name;
    } else if (requireName) {
        throw new Error('Pharmacy name is required.');
    }

    TEXT_FIELDS.forEach(field => {
        if (hasOwn(body, field)) payload[field] = cleanText(body[field]);
    });
    if (hasOwn(body, 'isActive')) payload.isActive = body.isActive !== false;
    return payload;
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
        const data = await Model.create({ ...pharmacyPayload(req.body, true), isActive: true });
        res.status(201).json(data);
    } catch (err) { res.status(400).json({ error: err.message }); }
};

exports.update = async (req, res) => {
    try {
        const [updated] = await Model.update(pharmacyPayload(req.body, false), { where: { id: req.params.id } });
        if (!updated) return res.status(404).json({ message: 'Not found' });
        const data = await Model.findByPk(req.params.id);
        res.json(data);
    } catch (err) { res.status(400).json({ error: err.message }); }
};

// Soft-disable: set isActive = false (all RX history preserved)
exports.delete = async (req, res) => {
    try {
        const record = await Model.findByPk(req.params.id);
        if (!record) return res.status(404).json({ message: 'Not found' });
        const rxCount = await db.RXRecord.count({ where: { pharmacyId: req.params.id } });
        await record.update({ isActive: false });
        const msg = rxCount > 0
            ? `Pharmacy disabled. ${rxCount} RX record(s) still reference it — history preserved.`
            : 'Pharmacy disabled.';
        res.status(200).json({ message: msg });
    } catch (err) { res.status(500).json({ error: err.message }); }
};

// Restore: re-enable
exports.restore = async (req, res) => {
    try {
        const record = await Model.findByPk(req.params.id);
        if (!record) return res.status(404).json({ message: 'Not found' });
        await record.update({ isActive: true });
        res.status(200).json({ message: 'Pharmacy restored.' });
    } catch (err) { res.status(500).json({ error: err.message }); }
};

// PURGE: hard-delete ALL pharmacy records (admin only)
exports.purge = async (req, res) => {
    const transaction = await db.sequelize.transaction();
    try {
        // Nullify pharmacyId on all RX records referencing any pharmacy
        const linked = await db.RXRecord.count({ where: db.sequelize.literal('pharmacyId IS NOT NULL') });
        if (linked > 0) {
            await db.RXRecord.update(
                { pharmacyId: null },
                { where: db.sequelize.literal('pharmacyId IS NOT NULL'), transaction }
            );
        }

        const deleted = await db.Pharmacy.destroy({ where: {}, truncate: true, transaction });

        await transaction.commit();
        res.status(200).json({
            message: `All pharmacy records purged successfully.`,
            rxRecordsUnlinked: linked
        });
    } catch (err) {
        await transaction.rollback();
        res.status(500).json({ error: err.message });
    }
};
