'use strict';

const { QueryTypes } = require('sequelize');
const { prepareStagingEnv, printSummary } = require('./lib/staging-env');

const FIRST_NAMES = [
    'Ava', 'Mia', 'Noah', 'Liam', 'Emma', 'Olivia', 'Sophia', 'Isabella', 'Mason', 'Lucas',
    'Ethan', 'Amelia', 'Harper', 'Evelyn', 'Elijah', 'James', 'Charlotte', 'Benjamin', 'Henry', 'Leo',
    'Nora', 'Aria', 'Zoe', 'Layla', 'Jack', 'Luke', 'Owen', 'Mila', 'Ruby', 'Ivy',
    'Daniel', 'Grace', 'Sofia', 'Mateo', 'Camila', 'Elena', 'Adrian', 'Valeria'
];

const LAST_NAMES = [
    'Adams', 'Baker', 'Carter', 'Diaz', 'Evans', 'Foster', 'Green', 'Harris', 'Irwin', 'Jones',
    'King', 'Lewis', 'Miller', 'Nelson', 'Owens', 'Parker', 'Quinn', 'Reed', 'Scott', 'Turner',
    'Upton', 'Vega', 'Walker', 'Young', 'Zimmer', 'Brooks', 'Cole', 'Davis', 'Edwards', 'Flores',
    'Rivera', 'Santos', 'Morgan', 'Howard', 'Ramos', 'Torres'
];

function pad(num, len) {
    return String(num).padStart(len, '0');
}

function parseDate(value) {
    const parts = String(value).slice(0, 10).split('-').map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2]);
}

function isoDate(date) {
    return date.getFullYear() + '-' + pad(date.getMonth() + 1, 2) + '-' + pad(date.getDate(), 2);
}

function addDays(value, days) {
    const d = value instanceof Date ? new Date(value) : parseDate(value);
    d.setDate(d.getDate() + days);
    return d;
}

function diffDays(a, b) {
    return Math.round((parseDate(b) - parseDate(a)) / 86400000);
}

function randomFactory(seed) {
    let state = seed >>> 0;
    return function rand() {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

function makeDateTime(date, minuteOffset) {
    const d = parseDate(date);
    d.setHours(8 + Math.floor((minuteOffset % 540) / 60), minuteOffset % 60, 0, 0);
    return d;
}

function pick(list, rand) {
    return list[Math.floor(rand() * list.length)];
}

async function upsertOne(model, where, values) {
    const existing = await model.findOne({ where });
    if (existing) return existing;
    return model.create(Object.assign({}, where, values));
}

async function resetPatientRxData(db) {
    const deletes = [
        ['RXWorkflowTrackings', 'DELETE FROM "RXWorkflowTrackings" WHERE "rxRecordId" IN (SELECT id FROM "RXRecords") RETURNING id'],
        ['Medications', 'DELETE FROM "Medications" WHERE "rxRecordId" IN (SELECT id FROM "RXRecords") RETURNING id'],
        ['RXHistories', 'DELETE FROM "RXHistories" WHERE "rxRecordId" IN (SELECT id FROM "RXRecords") RETURNING id'],
        ['DocumentAttachments', 'DELETE FROM "DocumentAttachments" WHERE "rxRecordId" IN (SELECT id FROM "RXRecords") OR "patientId" IN (SELECT id FROM "Patients") RETURNING id'],
        ['PatientNotes', 'DELETE FROM "PatientNotes" WHERE "patientId" IN (SELECT id FROM "Patients") RETURNING id'],
        ['PatientLocks', 'DELETE FROM "PatientLocks" WHERE "patientId" IN (SELECT id FROM "Patients") RETURNING id'],
        ['PatientServiceDateHistories', 'DELETE FROM "PatientServiceDateHistories" WHERE "patientId" IN (SELECT id FROM "Patients") RETURNING id'],
        ['RXRecords', 'DELETE FROM "RXRecords" RETURNING id'],
        ['PatientServiceDateCycles', 'DELETE FROM "PatientServiceDateCycles" RETURNING id'],
        ['Patients', 'DELETE FROM "Patients" RETURNING id'],
        ['DailySnapshots', 'DELETE FROM "DailySnapshots" RETURNING id']
    ];

    const results = {};
    await db.sequelize.transaction(async transaction => {
        for (const item of deletes) {
            const rows = await db.sequelize.query(item[1], { type: QueryTypes.SELECT, transaction });
            results[item[0]] = Array.isArray(rows) ? rows.length : 0;
        }
    });
    return results;
}

async function ensureBaseData(db) {
    const pharmacy = await upsertOne(db.Pharmacy, { name: 'Staging Graph Pharmacy' }, {
        address: '10 Timeline Way',
        phone: '555-2200',
        contactPerson: 'Graph Pharmacist',
        notes: 'Staging graph seed pharmacy',
        isActive: true
    });
    const clinic = await upsertOne(db.Clinic, { name: 'Staging Graph Clinic' }, {
        address: '20 Timeline Way',
        phone: '555-2201',
        contactPerson: 'Graph Clinic Lead',
        notes: 'Staging graph seed clinic',
        isActive: true
    });
    const patientTransport = await upsertOne(db.PatientTransportCompany, { companyName: 'Staging Graph Patient Transport' }, {
        phone: '555-2202',
        contactPerson: 'Graph Driver',
        notes: 'Staging graph seed patient transport',
        isActive: true
    });
    const pharmacyTransport = await upsertOne(db.PharmacyTransportCompany, { companyName: 'Staging Graph Pharmacy Transport' }, {
        phone: '555-2203',
        contactPerson: 'Graph Pharmacy Driver',
        notes: 'Staging graph seed pharmacy transport',
        isActive: true
    });

    let workflowActions = await db.WorkflowAction.findAll({
        where: { isActive: true },
        order: [['sequenceNumber', 'ASC'], ['id', 'ASC']]
    });
    for (let i = workflowActions.length + 1; i <= 6; i++) {
        await db.WorkflowAction.create({
            name: 'Staging Graph Step ' + i,
            description: 'Staging graph seed workflow step ' + i,
            sequenceNumber: i,
            isActive: true
        });
    }
    workflowActions = await db.WorkflowAction.findAll({
        where: { isActive: true },
        order: [['sequenceNumber', 'ASC'], ['id', 'ASC']]
    });

    return { pharmacy, clinic, patientTransport, pharmacyTransport, workflowActions };
}

async function seedPatientsAndRx(db, base, options) {
    const rand = randomFactory(options.seed);
    const start = options.startDate;
    const end = options.endDate;
    const span = diffDays(start, end);
    const patientRecords = [];
    const cycleRecords = [];

    for (let i = 0; i < options.patientCount; i++) {
        const hasServiceDate = i % 13 !== 0;
        const firstName = pick(FIRST_NAMES, rand);
        const lastName = pick(LAST_NAMES, rand) + '-' + pad(i + 1, 4);
        let firstService = null;
        let createdDate = isoDate(addDays(start, Math.floor(rand() * Math.max(1, span - 30))));
        const cycles = [];

        if (hasServiceDate) {
            firstService = isoDate(addDays(start, Math.floor(rand() * Math.max(1, span - 120))));
            createdDate = isoDate(addDays(firstService, -Math.floor(rand() * 21)));
            if (createdDate < start) createdDate = start;
            let cursor = firstService;
            while (cursor <= end && cycles.length < 8) {
                cycles.push(cursor);
                cursor = isoDate(addDays(cursor, 72 + Math.floor(rand() * 48)));
            }
        }

        const currentServiceDate = cycles.length ? cycles[cycles.length - 1] : null;
        const createdAt = makeDateTime(createdDate, i);
        patientRecords.push({
            patientCode: 'STG-GRAPH-' + pad(i + 1, 4),
            firstName,
            lastName,
            dob: isoDate(addDays('1945-01-01', Math.floor(rand() * 19000))),
            phone: '555-' + pad((200 + i) % 1000, 3) + '-' + pad(i % 10000, 4),
            address: (100 + (i % 900)) + ' Timeline Test Ave',
            serviceDate: currentServiceDate,
            clinicId: base.clinic.id,
            pharmacyId: base.pharmacy.id,
            patientTransportCompanyId: base.patientTransport.id,
            pharmacyTransportCompanyId: base.pharmacyTransport.id,
            notes: 'Staging graph seed patient',
            isActive: i % 10 !== 0,
            isDeleted: false,
            isNonCompanyPatient: i % 8 === 0,
            createdAt,
            updatedAt: createdAt
        });
        cycleRecords.push(cycles);
    }

    const patients = await db.Patient.bulkCreate(patientRecords, { returning: true });
    const patientByIndex = patients.map(patient => patient.get({ plain: true }));

    const cycleRows = [];
    const historyRows = [];
    for (let i = 0; i < patientByIndex.length; i++) {
        const cycles = cycleRecords[i];
        for (let c = 0; c < cycles.length; c++) {
            const serviceDate = cycles[c];
            const nextServiceDate = cycles[c + 1] || null;
            const createdAt = makeDateTime(serviceDate, i + c);
            cycleRows.push({
                patientId: patientByIndex[i].id,
                serviceDate,
                status: c === cycles.length - 1 ? 'active' : 'historical',
                source: 'Staging Graph Seed',
                startedAt: parseDate(serviceDate),
                endedAt: nextServiceDate ? parseDate(nextServiceDate) : null,
                createdByUserId: null,
                metadata: { seed: 'graph-history' },
                createdAt,
                updatedAt: createdAt
            });
            historyRows.push({
                patientId: patientByIndex[i].id,
                previousServiceDate: c > 0 ? cycles[c - 1] : null,
                newServiceDate: serviceDate,
                changedByUserId: null,
                changeSource: 'Staging Graph Seed',
                reason: 'Synthetic graph history test',
                metadata: { seed: 'graph-history' },
                createdAt,
                updatedAt: createdAt
            });
        }
    }

    const cycles = await db.PatientServiceDateCycle.bulkCreate(cycleRows, { returning: true });
    await db.PatientServiceDateHistory.bulkCreate(historyRows);

    const cyclePlain = cycles.map(cycle => cycle.get({ plain: true }));
    const cyclesByPatient = {};
    for (const cycle of cyclePlain) {
        if (!cyclesByPatient[cycle.patientId]) cyclesByPatient[cycle.patientId] = [];
        cyclesByPatient[cycle.patientId].push(cycle);
    }
    const cyclePool = cyclePlain.slice().sort((a, b) => String(a.serviceDate).localeCompare(String(b.serviceDate)));

    const rxRows = [];
    for (let i = 0; i < options.rxCount; i++) {
        const cycle = cyclePool[i % cyclePool.length];
        const maxOffset = Math.max(0, diffDays(cycle.serviceDate, end));
        const offset = Math.min(maxOffset, Math.floor(rand() * 82));
        const createdDate = isoDate(addDays(cycle.serviceDate, offset));
        const createdAt = makeDateTime(createdDate, i);
        rxRows.push({
            patientId: cycle.patientId,
            patientServiceDateCycleId: cycle.id,
            pharmacyId: base.pharmacy.id,
            patientTransportCompanyId: base.patientTransport.id,
            pharmacyTransportCompanyId: base.pharmacyTransport.id,
            arrivalDate: createdDate,
            serviceDate: cycle.serviceDate,
            isDeleted: false,
            returnedToWarehouse: i % 37 === 0,
            warehouseReturnDate: i % 37 === 0 ? addDays(createdDate, 12) : null,
            warehouseReturnNote: i % 37 === 0 ? 'Synthetic return for graph testing' : null,
            createdAt,
            updatedAt: createdAt
        });
    }

    const rxRecords = await db.RXRecord.bulkCreate(rxRows, { returning: true });
    const rxPlain = rxRecords.map(rx => rx.get({ plain: true }));
    const medicationRows = [];
    const trackingRows = [];
    const historyRxRows = [];
    const workflowActions = base.workflowActions;
    const totalSteps = workflowActions.length;

    for (let i = 0; i < rxPlain.length; i++) {
        const rx = rxPlain[i];
        const createdDate = isoDate(new Date(rx.createdAt));
        medicationRows.push({
            rxRecordId: rx.id,
            name: 'Graph Test Medication ' + ((i % 12) + 1),
            quantity: 1 + (i % 3),
            notes: 'Synthetic graph medication',
            createdAt: rx.createdAt,
            updatedAt: rx.createdAt
        });
        historyRxRows.push({
            rxRecordId: rx.id,
            userId: null,
            changeType: 'Create',
            snapshot: JSON.stringify({ patientId: rx.patientId, serviceDate: rx.serviceDate }),
            changedFields: JSON.stringify([]),
            note: 'Synthetic graph RX creation',
            createdAt: rx.createdAt
        });

        let stepsToComplete;
        if (i % 11 === 0) stepsToComplete = 0;
        else if (i % 5 === 0) stepsToComplete = 1 + (i % Math.max(1, totalSteps - 1));
        else stepsToComplete = totalSteps;

        for (let s = 0; s < stepsToComplete; s++) {
            const completionDate = isoDate(addDays(createdDate, 1 + s * 3 + (i % 3)));
            if (completionDate > end) break;
            const completionAt = makeDateTime(completionDate, i + s);
            trackingRows.push({
                rxRecordId: rx.id,
                workflowActionId: workflowActions[s].id,
                completionDate: completionAt,
                userId: null,
                createdAt: completionAt,
                updatedAt: completionAt
            });
        }
    }

    await db.Medication.bulkCreate(medicationRows);
    await db.RXHistory.bulkCreate(historyRxRows);
    await db.RXWorkflowTracking.bulkCreate(trackingRows);

    return {
        patients: patientByIndex,
        cycles: cyclePlain,
        rxRecords: rxPlain,
        trackings: trackingRows
    };
}

function dateKeys(startDate, endDate) {
    const keys = [];
    for (let d = parseDate(startDate); isoDate(d) <= endDate; d.setDate(d.getDate() + 1)) {
        keys.push(isoDate(d));
    }
    return keys;
}

function dayOf(value) {
    return isoDate(value instanceof Date ? value : new Date(value));
}

async function rebuildSnapshots(db, base, seeded, options) {
    const totalPharmacies = await db.Pharmacy.count();
    const totalClinics = await db.Clinic.count();
    const totalTransportCompanies = await db.PatientTransportCompany.count() + await db.PharmacyTransportCompany.count();
    const totalSteps = base.workflowActions.length;
    const keys = dateKeys(options.startDate, options.endDate);
    const patients = seeded.patients.map(p => ({
        id: p.id,
        createdDate: dayOf(p.createdAt),
        isActive: p.isActive === true
    }));
    const cycles = seeded.cycles.map(c => ({
        patientId: c.patientId,
        serviceDate: String(c.serviceDate).slice(0, 10)
    })).sort((a, b) => a.serviceDate.localeCompare(b.serviceDate));
    const rxRecords = seeded.rxRecords.map(r => ({
        id: r.id,
        patientId: r.patientId,
        createdDate: dayOf(r.createdAt)
    }));
    const trackings = seeded.trackings.map(t => ({
        rxRecordId: t.rxRecordId,
        completionDate: dayOf(t.completionDate)
    }));

    const snapshotRows = [];
    for (const date of keys) {
        const activePatients = patients.filter(p => p.createdDate <= date && p.isActive).length;
        const inactivePatients = patients.filter(p => p.createdDate <= date && !p.isActive).length;
        const totalPatients = activePatients + inactivePatients;
        const newPatientsToday = patients.filter(p => p.createdDate === date).length;
        const activeRx = rxRecords.filter(r => r.createdDate <= date);
        const newRXToday = rxRecords.filter(r => r.createdDate === date).length;
        const trackingToDate = trackings.filter(t => t.completionDate <= date);
        const workflowStepsToday = trackings.filter(t => t.completionDate === date).length;
        const doneByRx = {};
        for (const t of trackingToDate) doneByRx[t.rxRecordId] = (doneByRx[t.rxRecordId] || 0) + 1;
        const completedRX = activeRx.filter(r => totalSteps > 0 && (doneByRx[r.id] || 0) >= totalSteps).length;
        const pendingRX = activeRx.length - completedRX;
        const totalWorkflowSteps = activeRx.length * totalSteps;
        const completedWorkflowSteps = trackingToDate.length;
        const workflowCompletionRate = totalWorkflowSteps > 0
            ? Number(((completedWorkflowSteps / totalWorkflowSteps) * 100).toFixed(2))
            : 0;

        let eligibleNow = 0;
        let expiringIn7 = 0;
        let inWindow = 0;
        let noServiceDate = 0;
        let patientsWithNoRx = 0;
        for (const patient of patients) {
            if (patient.createdDate > date || !patient.isActive) continue;
            const patientCycles = cycles.filter(c => c.patientId === patient.id && c.serviceDate <= date);
            const latestCycle = patientCycles[patientCycles.length - 1] || null;
            if (!latestCycle) {
                noServiceDate++;
            } else {
                const expiry = isoDate(addDays(latestCycle.serviceDate, 90));
                const window7 = isoDate(addDays(date, 7));
                if (expiry < date) eligibleNow++;
                else if (expiry <= window7) expiringIn7++;
                else inWindow++;
            }
            const hasRx = activeRx.some(r => r.patientId === patient.id);
            if (!hasRx) patientsWithNoRx++;
        }

        snapshotRows.push({
            snapshotDate: date,
            totalPatients,
            activePatients,
            inactivePatients,
            newPatientsToday,
            nonCompanyPatients: 0,
            totalRX: activeRx.length,
            newRXToday,
            pendingRX,
            completedRX,
            deletedRX: 0,
            returnedToWarehouseRX: 0,
            totalWorkflowSteps,
            completedWorkflowSteps,
            workflowStepsToday,
            workflowCompletionRate,
            totalUsers: await db.User.count(),
            activeUsers: await db.User.count({ where: { isActive: true } }),
            loginEventsToday: 0,
            uniqueLoginUsersToday: 0,
            userActivityEventsToday: 0,
            uniqueActivityUsersToday: 0,
            auditEventsToday: 0,
            errorLogsToday: 0,
            unresolvedErrors: 0,
            eligibleNow,
            expiringIn7,
            inWindow,
            noServiceDate,
            patientsWithNoRx,
            totalPharmacies,
            totalClinics,
            totalTransportCompanies
        });
    }

    for (let i = 0; i < snapshotRows.length; i += 250) {
        await db.DailySnapshot.bulkCreate(snapshotRows.slice(i, i + 250));
    }
    return snapshotRows.length;
}

async function main() {
    const config = prepareStagingEnv();
    printSummary(config);

    const db = require('../models');
    await db.sequelize.authenticate();
    await db.sequelize.sync();

    const options = {
        startDate: process.env.STAGING_GRAPH_START || '2024-01-01',
        endDate: process.env.STAGING_GRAPH_END || isoDate(new Date()),
        patientCount: Math.max(1, parseInt(process.env.STAGING_GRAPH_PATIENTS || '700', 10) || 700),
        rxCount: Math.max(1, parseInt(process.env.STAGING_GRAPH_RX || '2000', 10) || 2000),
        seed: parseInt(process.env.STAGING_GRAPH_SEED || '20240628', 10) || 20240628
    };

    if (options.startDate > options.endDate) {
        throw new Error('STAGING_GRAPH_START must be on or before STAGING_GRAPH_END.');
    }

    console.log('Resetting staging patient/RX graph data...');
    const reset = await resetPatientRxData(db);
    console.log(JSON.stringify({ reset }, null, 2));

    const base = await ensureBaseData(db);
    console.log('Seeding ' + options.patientCount + ' patients and ' + options.rxCount + ' RX records from ' + options.startDate + ' to ' + options.endDate + '...');
    const seeded = await seedPatientsAndRx(db, base, options);
    let snapshotCount = await db.DailySnapshot.count();
    if (String(process.env.STAGING_GRAPH_REBUILD_SNAPSHOTS || 'false').toLowerCase() === 'true') {
        console.log('Rebuilding daily snapshots for backoffice testing...');
        snapshotCount = await rebuildSnapshots(db, base, seeded, options);
    }

    const summary = {
        database: config.dbName,
        range: { start: options.startDate, end: options.endDate },
        created: {
            patients: await db.Patient.count(),
            rxRecords: await db.RXRecord.count(),
            serviceDateCycles: await db.PatientServiceDateCycle.count(),
            serviceDateHistories: await db.PatientServiceDateHistory.count(),
            workflowTrackings: await db.RXWorkflowTracking.count(),
            dailySnapshots: snapshotCount
        },
        samplePatients: await db.Patient.findAll({
            attributes: ['patientCode', 'firstName', 'lastName', 'serviceDate'],
            order: [['patientCode', 'ASC']],
            limit: 5,
            raw: true
        })
    };
    console.log(JSON.stringify(summary, null, 2));
    await db.sequelize.close();
}

main().catch(err => {
    console.error('[staging:graph-seed failed]', err.stack || err.message);
    process.exit(1);
});
