'use strict';

const db = require('../models');
const {
  inferRegionalTagName,
  normalizeCityName
} = require('../utils/patientAddress');

function normalizeKey(value) {
  const text = normalizeCityName(value) || String(value || '').trim();
  return text.replace(/\s+/g, ' ').toLowerCase();
}

function isRegionalGroup(value) {
  const group = String(value || '').trim().toLowerCase();
  return group === 'region' || group === 'city';
}

async function findRegionalTagByName(name, options) {
  const clean = String(name || '').trim();
  if (!clean) return null;
  const rows = await db.PatientTag.findAll({
    attributes: ['id', 'name', 'groupName'],
    where: {
      isActive: true,
      name: { [db.Sequelize.Op.iLike]: clean },
      [db.Sequelize.Op.or]: [
        { groupName: { [db.Sequelize.Op.iLike]: 'Region' } },
        { groupName: { [db.Sequelize.Op.iLike]: 'City' } }
      ]
    },
    order: [
      [db.sequelize.literal(`CASE WHEN LOWER(TRIM(COALESCE("groupName", ''))) = 'region' THEN 0 ELSE 1 END`), 'ASC'],
      ['id', 'ASC']
    ],
    transaction: options && options.transaction,
    raw: true
  });
  return rows[0] || null;
}

async function findRuleForCity(city, options) {
  const key = normalizeKey(city);
  if (!key || !db.CityRegionRule) return null;
  try {
    const rule = await db.CityRegionRule.findOne({
      where: {
        isActive: true,
        [db.Sequelize.Op.and]: [
          db.sequelize.where(db.sequelize.fn('LOWER', db.sequelize.fn('TRIM', db.sequelize.col('CityRegionRule.city'))), key)
        ]
      },
      include: [{
        model: db.PatientTag,
        as: 'RegionTag',
        attributes: ['id', 'name', 'groupName'],
        where: { isActive: true },
        required: true
      }],
      transaction: options && options.transaction
    });
    if (!rule || !rule.RegionTag) return null;
    return {
      id: rule.RegionTag.id,
      name: rule.RegionTag.name,
      groupName: rule.RegionTag.groupName
    };
  } catch (error) {
    if (error && error.parent && error.parent.code === '42P01') return null;
    throw error;
  }
}

async function resolveRegionalTag(address, city, options) {
  const cityRuleTag = await findRuleForCity(city, options);
  if (cityRuleTag) return cityRuleTag;
  const fallbackName = inferRegionalTagName(address, city);
  return findRegionalTagByName(fallbackName, options);
}

async function regionalTagIds(options) {
  const rows = await db.PatientTag.findAll({
    attributes: ['id', 'groupName'],
    where: {
      isActive: true,
      [db.Sequelize.Op.or]: [
        { groupName: { [db.Sequelize.Op.iLike]: 'Region' } },
        { groupName: { [db.Sequelize.Op.iLike]: 'City' } }
      ]
    },
    transaction: options && options.transaction,
    raw: true
  });
  return rows.filter(row => isRegionalGroup(row.groupName)).map(row => Number(row.id));
}

async function applyRegionalTagRuleToIds(ids, options) {
  options = options || {};
  if (options.autoRegion === false) return Array.from(new Set((ids || []).map(Number).filter(Boolean)));
  const currentIds = Array.from(new Set((ids || []).map(Number).filter(Boolean)));
  const regionTag = await resolveRegionalTag(options.address, options.city, options);
  if (!regionTag) return currentIds;
  const removeIds = new Set(await regionalTagIds(options));
  const nextIds = currentIds.filter(id => !removeIds.has(Number(id)));
  nextIds.push(Number(regionTag.id));
  return Array.from(new Set(nextIds));
}

module.exports = {
  applyRegionalTagRuleToIds,
  findRegionalTagByName,
  resolveRegionalTag
};
