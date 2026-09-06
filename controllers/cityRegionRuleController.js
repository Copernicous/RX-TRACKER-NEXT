const db = require('../models');

const Model = db.CityRegionRule;
const REGIONAL_GROUPS = ['region', 'city'];

function hasOwn(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj || {}, key);
}

function cleanText(value) {
    if (value === undefined) return undefined;
    if (value === null) return null;
    const text = String(value).trim().replace(/\s+/g, ' ');
    return text === '' ? null : text;
}

function formatRule(row) {
    const plain = row && typeof row.get === 'function' ? row.get({ plain: true }) : row;
    const tag = plain && plain.RegionTag;
    return {
        ...plain,
        regionLabel: tag ? ((tag.groupName ? tag.groupName + ': ' : '') + tag.name) : ''
    };
}

async function validateRegionTag(patientTagId) {
    const tag = await db.PatientTag.findByPk(patientTagId, { raw: true });
    if (!tag || tag.isActive === false) throw new Error('Selected Region tag is not active.');
    const group = String(tag.groupName || '').trim().toLowerCase();
    if (!REGIONAL_GROUPS.includes(group)) throw new Error('Selected tag must belong to the Region or legacy City group.');
    return tag;
}

async function payloadFromBody(body, requireAll) {
    const payload = {};
    if (hasOwn(body, 'city')) {
        const city = cleanText(body.city);
        if (!city) throw new Error('City is required.');
        payload.city = city;
    } else if (requireAll) {
        throw new Error('City is required.');
    }

    if (hasOwn(body, 'patientTagId')) {
        const patientTagId = Number(body.patientTagId);
        if (!Number.isInteger(patientTagId) || patientTagId <= 0) throw new Error('Region tag is required.');
        await validateRegionTag(patientTagId);
        payload.patientTagId = patientTagId;
    } else if (requireAll) {
        throw new Error('Region tag is required.');
    }

    if (hasOwn(body, 'notes')) payload.notes = cleanText(body.notes);
    if (hasOwn(body, 'isActive')) payload.isActive = body.isActive !== false && body.isActive !== 'false';
    return payload;
}

function includeConfig() {
    return [{
        model: db.PatientTag,
        as: 'RegionTag',
        attributes: ['id', 'name', 'groupName', 'color'],
        required: false
    }];
}

exports.getAll = async (req, res) => {
    try {
        const includeInactive = req.query.includeInactive === 'true';
        const where = includeInactive ? {} : { isActive: true };
        const data = await Model.findAll({
            where,
            include: includeConfig(),
            order: [['city', 'ASC'], ['id', 'ASC']]
        });
        res.json(data.map(formatRule));
    } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.getOne = async (req, res) => {
    try {
        const data = await Model.findByPk(req.params.id, { include: includeConfig() });
        if (!data) return res.status(404).json({ message: 'Not found' });
        res.json(formatRule(data));
    } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.lookup = async (req, res) => {
    try {
        const data = await Model.findAll({
            where: { isActive: true },
            include: includeConfig(),
            order: [['city', 'ASC'], ['id', 'ASC']]
        });
        res.json(data.map(formatRule));
    } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.create = async (req, res) => {
    try {
        const data = await Model.create({ ...(await payloadFromBody(req.body, true)), isActive: true });
        const reloaded = await Model.findByPk(data.id, { include: includeConfig() });
        res.status(201).json(formatRule(reloaded));
    } catch (err) { res.status(400).json({ error: err.message }); }
};

exports.update = async (req, res) => {
    try {
        const [updated] = await Model.update(await payloadFromBody(req.body, false), { where: { id: req.params.id } });
        if (!updated) return res.status(404).json({ message: 'Not found' });
        const data = await Model.findByPk(req.params.id, { include: includeConfig() });
        res.json(formatRule(data));
    } catch (err) { res.status(400).json({ error: err.message }); }
};

exports.delete = async (req, res) => {
    try {
        const record = await Model.findByPk(req.params.id);
        if (!record) return res.status(404).json({ message: 'Not found' });
        await record.update({ isActive: false });
        res.status(200).json({ message: 'City region rule disabled.' });
    } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.restore = async (req, res) => {
    try {
        const record = await Model.findByPk(req.params.id);
        if (!record) return res.status(404).json({ message: 'Not found' });
        await validateRegionTag(record.patientTagId);
        await record.update({ isActive: true });
        res.status(200).json({ message: 'City region rule restored.' });
    } catch (err) { res.status(500).json({ error: err.message }); }
};
