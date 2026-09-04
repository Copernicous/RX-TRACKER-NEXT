const db = require('../models');

const Model = db.PatientTag;
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

function hasOwn(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj || {}, key);
}

function cleanText(value) {
    if (value === undefined) return undefined;
    if (value === null) return null;
    const text = String(value).trim();
    return text === '' ? null : text;
}

function cleanColor(value) {
    const color = cleanText(value);
    if (!color) return null;
    if (!COLOR_PATTERN.test(color)) throw new Error('Tag color must be a hex value like #4a90e2.');
    return color.toLowerCase();
}

function patientTagPayload(body, requireName) {
    const payload = {};
    if (hasOwn(body, 'name')) {
        const name = cleanText(body.name);
        if (!name) throw new Error('Patient tag name is required.');
        payload.name = name;
    } else if (requireName) {
        throw new Error('Patient tag name is required.');
    }

    if (hasOwn(body, 'groupName')) payload.groupName = cleanText(body.groupName);
    if (hasOwn(body, 'color')) payload.color = cleanColor(body.color);
    if (hasOwn(body, 'notes')) payload.notes = cleanText(body.notes);
    if (hasOwn(body, 'isDefault')) payload.isDefault = body.isDefault === true || body.isDefault === 'true';
    if (hasOwn(body, 'isActive')) payload.isActive = body.isActive !== false && body.isActive !== 'false';
    return payload;
}

exports.getAll = async (req, res) => {
    try {
        const includeInactive = req.query.includeInactive === 'true';
        const where = includeInactive ? {} : { isActive: true };
        const data = await Model.findAll({ where, order: [['groupName', 'ASC'], ['name', 'ASC'], ['id', 'ASC']] });
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
        const data = await Model.create({ ...patientTagPayload(req.body, true), isActive: true });
        res.status(201).json(data);
    } catch (err) { res.status(400).json({ error: err.message }); }
};

exports.update = async (req, res) => {
    try {
        const [updated] = await Model.update(patientTagPayload(req.body, false), { where: { id: req.params.id } });
        if (!updated) return res.status(404).json({ message: 'Not found' });
        const data = await Model.findByPk(req.params.id);
        res.json(data);
    } catch (err) { res.status(400).json({ error: err.message }); }
};

exports.delete = async (req, res) => {
    try {
        const record = await Model.findByPk(req.params.id);
        if (!record) return res.status(404).json({ message: 'Not found' });
        const patientCount = await db.PatientTagAssignment.count({ where: { patientTagId: req.params.id } });
        await record.update({ isActive: false });
        const msg = patientCount > 0
            ? `Patient tag disabled. ${patientCount} patient assignment(s) still reference it - history preserved.`
            : 'Patient tag disabled.';
        res.status(200).json({ message: msg });
    } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.restore = async (req, res) => {
    try {
        const record = await Model.findByPk(req.params.id);
        if (!record) return res.status(404).json({ message: 'Not found' });
        await record.update({ isActive: true });
        res.status(200).json({ message: 'Patient tag restored.' });
    } catch (err) { res.status(500).json({ error: err.message }); }
};
