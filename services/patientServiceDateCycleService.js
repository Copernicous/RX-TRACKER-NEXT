'use strict';

const { Op } = require('sequelize');
const db = require('../models');

function dateOnly(value) {
    if (!value) return null;
    if (typeof value === 'string') return value.slice(0, 10);
    if (value instanceof Date && !isNaN(value.getTime())) return value.toISOString().slice(0, 10);
    return String(value).slice(0, 10);
}

function serviceDateMatches(left, right) {
    const l = dateOnly(left);
    const r = dateOnly(right);
    return !!l && !!r && l === r;
}

function addDays(value, days) {
    const d = new Date(value);
    if (isNaN(d.getTime())) return null;
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + days);
    return d;
}

function cycleDefaults(patient, serviceDate, options) {
    const cleanDate = dateOnly(serviceDate);
    const active = serviceDateMatches(patient && patient.serviceDate, cleanDate);
    return {
        patientId:       patient.id,
        serviceDate:     cleanDate,
        status:          active ? 'active' : 'historical',
        source:          (options && options.source) || 'Patient Service Date',
        startedAt:       cleanDate ? new Date(cleanDate) : null,
        endedAt:         active ? null : addDays(cleanDate, 90),
        createdByUserId: (options && options.userId) || null,
        metadata:        (options && options.metadata) || null
    };
}

async function findOrCreateCycle(patient, serviceDate, options) {
    options = options || {};
    const cleanDate = dateOnly(serviceDate);
    if (!patient || !patient.id || !cleanDate) return null;

    const tx = options.transaction;
    const defaults = cycleDefaults(patient, cleanDate, options);
    const queryOptions = {
        where: { patientId: patient.id, serviceDate: cleanDate },
        defaults
    };
    if (tx) queryOptions.transaction = tx;

    let cycle;
    try {
        [cycle] = await db.PatientServiceDateCycle.findOrCreate(queryOptions);
    } catch (err) {
        if (err.name !== 'SequelizeUniqueConstraintError') throw err;
        cycle = await db.PatientServiceDateCycle.findOne({
            where: { patientId: patient.id, serviceDate: cleanDate },
            transaction: tx
        });
    }

    if (!cycle) return null;
    const nextStatus = serviceDateMatches(patient.serviceDate, cleanDate) ? 'active' : 'historical';
    const nextEndedAt = nextStatus === 'active' ? null : addDays(cleanDate, 90);
    if (cycle.status !== nextStatus || String(cycle.endedAt || '') !== String(nextEndedAt || '')) {
        await cycle.update({ status: nextStatus, endedAt: nextEndedAt }, tx ? { transaction: tx } : {});
    }
    return cycle;
}

async function syncPatientServiceDateCycles(patientOrId, options) {
    options = options || {};
    const tx = options.transaction;
    const patient = typeof patientOrId === 'object' && patientOrId !== null
        ? patientOrId
        : await db.Patient.findByPk(patientOrId, { transaction: tx });
    if (!patient || !patient.id) return [];

    const patientId = patient.id;
    const dates = new Set();
    const activeDate = dateOnly(patient.serviceDate);
    if (activeDate) dates.add(activeDate);

    const rxRows = await db.RXRecord.findAll({
        where: {
            patientId,
            serviceDate: { [Op.ne]: null }
        },
        attributes: ['id', 'patientId', 'serviceDate', 'patientServiceDateCycleId'],
        transaction: tx
    });

    rxRows.forEach((rx) => {
        const d = dateOnly(rx.serviceDate);
        if (d) dates.add(d);
    });

    const cyclesByDate = new Map();
    for (const d of dates) {
        const cycle = await findOrCreateCycle(patient, d, {
            transaction: tx,
            userId: options.userId,
            source: options.source || 'Cycle Sync',
            metadata: options.metadata
        });
        if (cycle) cyclesByDate.set(d, cycle);
    }

    const updateOptions = tx ? { transaction: tx } : {};
    await db.PatientServiceDateCycle.update(
        { status: 'historical' },
        {
            where: activeDate
                ? { patientId, serviceDate: { [Op.ne]: activeDate } }
                : { patientId },
            ...updateOptions
        }
    );
    if (activeDate && cyclesByDate.has(activeDate)) {
        await cyclesByDate.get(activeDate).update({ status: 'active', endedAt: null }, updateOptions);
    }

    for (const rx of rxRows) {
        const cycle = cyclesByDate.get(dateOnly(rx.serviceDate));
        if (cycle && Number(rx.patientServiceDateCycleId || 0) !== Number(cycle.id)) {
            await rx.update({ patientServiceDateCycleId: cycle.id }, updateOptions);
        }
    }

    return db.PatientServiceDateCycle.findAll({
        where: { patientId },
        order: [['serviceDate', 'DESC'], ['id', 'DESC']],
        transaction: tx
    });
}

async function ensureCycleForRx(patient, serviceDate, options) {
    options = options || {};
    const cycle = await findOrCreateCycle(patient, serviceDate, {
        ...options,
        source: options.source || 'RX Create'
    });
    if (cycle) {
        await syncPatientServiceDateCycles(patient, {
            transaction: options.transaction,
            userId: options.userId,
            source: 'RX Cycle Link'
        });
    }
    return cycle;
}

module.exports = {
    dateOnly,
    serviceDateMatches,
    findOrCreateCycle,
    ensureCycleForRx,
    syncPatientServiceDateCycles
};
