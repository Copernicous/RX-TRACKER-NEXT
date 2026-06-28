'use strict';

const crypto = require('crypto');
const { prepareStagingEnv, printSummary } = require('./lib/staging-env');
const { ensureDatabase } = require('../qa/lib/postgres');

const FIRST_NAMES = [
    'Ava', 'Mia', 'Noah', 'Liam', 'Emma', 'Olivia', 'Sophia', 'Isabella', 'Mason', 'Lucas',
    'Ethan', 'Amelia', 'Harper', 'Evelyn', 'Elijah', 'James', 'Charlotte', 'Benjamin', 'Henry', 'Leo',
    'Nora', 'Aria', 'Zoe', 'Layla', 'Jack', 'Luke', 'Owen', 'Mila', 'Ruby', 'Ivy'
];

const LAST_NAMES = [
    'Adams', 'Baker', 'Carter', 'Diaz', 'Evans', 'Foster', 'Green', 'Harris', 'Irwin', 'Jones',
    'King', 'Lewis', 'Miller', 'Nelson', 'Owens', 'Parker', 'Quinn', 'Reed', 'Scott', 'Turner',
    'Upton', 'Vega', 'Walker', 'Young', 'Zimmer', 'Brooks', 'Cole', 'Davis', 'Edwards', 'Flores'
];

function pick(list) {
    return list[Math.floor(Math.random() * list.length)];
}

function pad(num, len) {
    return String(num).padStart(len, '0');
}

function daysAgo(days) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - days);
    return d;
}

function isoDate(date) {
    return date.toISOString().slice(0, 10);
}

function randomPhone(seed) {
    const suffix = pad(seed % 10000, 4);
    return `555-${pad((seed * 37) % 1000, 3)}-${suffix}`;
}

function nextPatientCode(index) {
    return `STG-BULK-${pad(index, 4)}`;
}

function randomDateOfBirth() {
    const year = 1948 + Math.floor(Math.random() * 45);
    const month = Math.floor(Math.random() * 12);
    const day = 1 + Math.floor(Math.random() * 27);
    const d = new Date(Date.UTC(year, month, day));
    return d.toISOString().slice(0, 10);
}

function randomServiceDate(slot) {
    const pattern = slot % 6;
    if (pattern === 0) return null;
    if (pattern === 1) return isoDate(daysAgo(Math.floor(Math.random() * 10)));
    if (pattern === 2) return isoDate(daysAgo(11 + Math.floor(Math.random() * 19)));
    if (pattern === 3) return isoDate(daysAgo(31 + Math.floor(Math.random() * 19)));
    if (pattern === 4) return isoDate(daysAgo(51 + Math.floor(Math.random() * 19)));
    return isoDate(daysAgo(71 + Math.floor(Math.random() * 35)));
}

function randomWorkflowDates(serviceDate) {
    if (!serviceDate) return [];
    const start = new Date(serviceDate);
    const totalSteps = 2 + Math.floor(Math.random() * 4);
    const steps = [];
    let offset = 0;
    for (let i = 0; i < totalSteps; i++) {
        offset += Math.floor(Math.random() * 6);
        const d = new Date(start);
        d.setDate(d.getDate() + offset);
        steps.push(isoDate(d));
    }
    return steps;
}

async function ensureBaseData(db, batchLabel) {
    const postfix = ` ${batchLabel}`;
    const upsertOne = async (model, where, values) => {
        const existing = await model.findOne({ where });
        if (existing) return existing;
        return model.create({ ...where, ...values });
    };

    const pharmacy = await upsertOne(db.Pharmacy, { name: `Staging Bulk Pharmacy${postfix}` }, {
        address: '1 Staging Bulk Way',
        phone: '555-1000',
        contactPerson: 'Staging Bulk Pharmacist',
        notes: 'Bulk seed pharmacy',
        isActive: true
    });

    const clinic = await upsertOne(db.Clinic, { name: `Staging Bulk Clinic${postfix}` }, {
        address: '2 Staging Bulk Way',
        phone: '555-1001',
        contactPerson: 'Staging Bulk Clinic Lead',
        notes: 'Bulk seed clinic',
        isActive: true
    });

    const patientTransport = await upsertOne(db.PatientTransportCompany, { companyName: `Staging Bulk Transport${postfix}` }, {
        phone: '555-1002',
        contactPerson: 'Bulk Driver',
        notes: 'Bulk seed patient transport',
        isActive: true
    });

    const pharmacyTransport = await upsertOne(db.PharmacyTransportCompany, { companyName: `Staging Bulk Pharmacy Transport${postfix}` }, {
        phone: '555-1003',
        contactPerson: 'Bulk Pharmacy Driver',
        notes: 'Bulk seed pharmacy transport',
        isActive: true
    });

    const medicationCatalog = await upsertOne(db.MedicationCatalog, { name: `Staging Bulk Action${postfix}` }, {
        description: 'Bulk seed medication action',
        sortOrder: 20,
        isActive: true
    });

    const workflowActions = [];
    for (let i = 1; i <= 6; i++) {
        workflowActions.push(await upsertOne(db.WorkflowAction, { name: `Staging Bulk Step ${i}${postfix}` }, {
            description: `Bulk seed workflow step ${i}`,
            sequenceNumber: i,
            isActive: true
        }));
    }

    return { pharmacy, clinic, patientTransport, pharmacyTransport, medicationCatalog, workflowActions };
}

async function main() {
    const config = prepareStagingEnv();
    printSummary(config);
    process.env.DB_USER = process.env.DB_USER || 'postgres';
    process.env.DB_PASS = process.env.DB_PASS || 'password';
    config.dbUser = process.env.DB_USER;
    config.dbPass = process.env.DB_PASS;
    await ensureDatabase(config);

    const db = require('../models');
    await db.sequelize.authenticate();
    await db.sequelize.sync();

    const count = Math.max(1, parseInt(process.env.STAGING_BULK_COUNT || '1000', 10) || 1000);
    const appendMode = String(process.env.STAGING_BULK_APPEND || 'true').toLowerCase() !== 'false';
    const batchLabel = process.env.STAGING_BULK_BATCH || new Date().toISOString().replace(/[^0-9A-Za-z]+/g, '').slice(0, 14);
    const wipeExisting = String(process.env.STAGING_BULK_RESET || 'false').toLowerCase() === 'true';

    const base = await ensureBaseData(db, batchLabel);

    if (wipeExisting) {
        await db.RXWorkflowTracking.destroy({ where: {}, force: true, truncate: true, cascade: true });
        await db.RXRecord.destroy({ where: {}, force: true, truncate: true, cascade: true });
        await db.Medication.destroy({ where: {}, force: true, truncate: true, cascade: true });
        await db.PatientNote.destroy({ where: {}, force: true, truncate: true, cascade: true });
        await db.Patient.destroy({ where: { patientCode: { [db.Sequelize.Op.like]: 'STG-BULK-%' } }, force: true });
    }

    const created = [];
    for (let i = 1; i <= count; i++) {
        const firstName = pick(FIRST_NAMES);
        const lastName = `${pick(LAST_NAMES)}-${pad(i, 4)}`;
        const serviceDate = randomServiceDate(i);
        const patientCode = appendMode ? nextPatientCode(i) : `STG-BULK-${pad(i, 4)}`;
        const seed = crypto.createHash('sha1').update(`${batchLabel}:${i}:${firstName}:${lastName}`).digest('hex');
        const patient = await db.Patient.create({
            patientCode,
            firstName,
            lastName,
            dob: randomDateOfBirth(),
            phone: randomPhone(i),
            address: `${100 + (i % 900)} Bulk Test Ave`,
            serviceDate,
            clinicId: base.clinic.id,
            pharmacyId: base.pharmacy.id,
            patientTransportCompanyId: base.patientTransport.id,
            pharmacyTransportCompanyId: base.pharmacyTransport.id,
            notes: `Bulk staging patient ${i}`,
            isActive: i % 11 !== 0,
            isDeleted: false,
            isNonCompanyPatient: i % 7 === 0
        });

        const noteCount = i % 4 === 0 ? 2 : 1;
        for (let n = 0; n < noteCount; n++) {
            await db.PatientNote.create({
                patientId: patient.id,
                userId: null,
                note: `Bulk note ${n + 1} for ${patientCode} (${seed.slice(0, 8)})`
            });
        }

        if (serviceDate) {
            const rxCount = 1 + (i % 3);
            const workflowDates = randomWorkflowDates(serviceDate);
            for (let r = 0; r < rxCount; r++) {
                const arrival = daysAgo(Math.max(0, Math.floor((new Date() - new Date(serviceDate)) / 86400000) - r));
                const rx = await db.RXRecord.create({
                    patientId: patient.id,
                    pharmacyId: base.pharmacy.id,
                    patientTransportCompanyId: base.patientTransport.id,
                    pharmacyTransportCompanyId: base.pharmacyTransport.id,
                    arrivalDate: isoDate(arrival),
                    serviceDate,
                    isDeleted: false,
                    returnedToWarehouse: false
                });

                await db.Medication.create({
                    rxRecordId: rx.id,
                    name: `${base.medicationCatalog.name} ${r + 1}`,
                    quantity: 1 + (r % 2),
                    notes: `Bulk medication ${i}-${r + 1}`
                });

                for (let w = 0; w < workflowDates.length; w++) {
                    const date = workflowDates[Math.min(w, workflowDates.length - 1)];
                    await db.RXWorkflowTracking.create({
                        rxRecordId: rx.id,
                        workflowActionId: base.workflowActions[Math.min(w, base.workflowActions.length - 1)].id,
                        completionDate: date,
                        userId: null
                    });
                }
            }
        }

        created.push({ id: patient.id, code: patientCode, serviceDate });
        if (i % 100 === 0) {
            console.log(`Created ${i}/${count} patients...`);
        }
    }

    const summary = {
        mode: 'staging-bulk',
        appendMode,
        wipeExisting,
        batchLabel,
        count,
        database: config.dbName,
        seeded: {
            pharmacyId: base.pharmacy.id,
            clinicId: base.clinic.id,
            patientTransportId: base.patientTransport.id,
            pharmacyTransportId: base.pharmacyTransport.id,
            medicationCatalogId: base.medicationCatalog.id,
            workflowActionIds: base.workflowActions.map(a => a.id),
            samplePatients: created.slice(0, 5)
        }
    };

    console.log(JSON.stringify(summary, null, 2));
    await db.sequelize.close();
}

main().catch(err => {
    console.error('[staging:bulk-seed failed]', err.stack || err.message);
    process.exit(1);
});
