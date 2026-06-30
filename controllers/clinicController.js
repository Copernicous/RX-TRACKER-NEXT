const { Clinic } = require('../models');
const { Op } = require('sequelize');
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

function clinicPayload(body, requireName) {
  const payload = {};
  if (hasOwn(body, 'name')) {
    const name = cleanText(body.name);
    if (!name) throw new Error('Clinic name is required.');
    payload.name = name;
  } else if (requireName) {
    throw new Error('Clinic name is required.');
  }

  TEXT_FIELDS.forEach(field => {
    if (hasOwn(body, field)) payload[field] = cleanText(body[field]);
  });
  if (hasOwn(body, 'isActive')) payload.isActive = body.isActive !== false;
  return payload;
}

// GET /api/clinics
exports.getAll = async (req, res) => {
  try {
    const includeInactive = req.query.includeInactive === 'true';
    const where = includeInactive ? {} : { isActive: true };
    const clinics = await Clinic.findAll({ where, order: [['name', 'ASC']] });
    res.json(clinics);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET /api/clinics/:id
exports.getOne = async (req, res) => {
  try {
    const clinic = await Clinic.findByPk(req.params.id);
    if (!clinic) return res.status(404).json({ error: 'Clinic not found' });
    res.json(clinic);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST /api/clinics
exports.create = async (req, res) => {
  try {
    const payload = clinicPayload(req.body, true);
    const existing = await Clinic.findOne({ where: { name: { [Op.iLike]: payload.name } } });
    if (existing) return res.status(409).json({ error: `A clinic named "${payload.name}" already exists.` });
    const clinic = await Clinic.create({ ...payload, isActive: payload.isActive !== false });
    res.status(201).json(clinic);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

// PUT /api/clinics/:id
exports.update = async (req, res) => {
  try {
    const clinic = await Clinic.findByPk(req.params.id);
    if (!clinic) return res.status(404).json({ error: 'Clinic not found' });
    const payload = clinicPayload(req.body, false);
    if (hasOwn(payload, 'name') && payload.name !== clinic.name) {
      const existing = await Clinic.findOne({ where: { name: { [Op.iLike]: payload.name }, id: { [Op.ne]: clinic.id } } });
      if (existing) return res.status(409).json({ error: `A clinic named "${payload.name}" already exists.` });
    }
    await clinic.update(payload);
    res.json(clinic);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

// DELETE /api/clinics/:id — soft disable (history preserved)
exports.delete = async (req, res) => {
  try {
    const clinic = await Clinic.findByPk(req.params.id);
    if (!clinic) return res.status(404).json({ error: 'Clinic not found' });
    // Check if any patients are assigned to this clinic
    const { Patient } = require('../models');
    const patientCount = await Patient.count({ where: { clinicId: clinic.id } });
    await clinic.update({ isActive: false });
    const msg = patientCount > 0
      ? `Clinic disabled. ${patientCount} patient(s) still reference it — history preserved.`
      : 'Clinic disabled.';
    res.status(200).json({ message: msg });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// PUT /api/clinics/:id/restore — re-enable
exports.restore = async (req, res) => {
  try {
    const clinic = await Clinic.findByPk(req.params.id);
    if (!clinic) return res.status(404).json({ error: 'Clinic not found' });
    await clinic.update({ isActive: true });
    res.status(200).json({ message: 'Clinic restored.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
