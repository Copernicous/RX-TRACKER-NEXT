if (!process.env.DB_NAME) {
    require('dotenv').config({ override: true });
}

const assert = require('assert');
const { Op } = require('sequelize');
const db = require('../models');
const patientController = require('../controllers/patientController');

const RUN_ID = `patient-double-update-${Date.now()}`;

function dateFromToday(days) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
}

function makeRes() {
    return {
        statusCode: 200,
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(payload) {
            this.body = payload;
            return this;
        }
    };
}

function updateReq(patient, newServiceDate) {
    return {
        params: { id: String(patient.id) },
        user: { role: 'Administrator' },
        body: {
            patientCode: patient.patientCode,
            firstName: patient.firstName,
            lastName: patient.lastName,
            dob: patient.dob,
            phone: patient.phone,
            serviceDate: newServiceDate,
            address: patient.address,
            notes: patient.notes || '',
            isActive: true,
            isNonCompanyPatient: false,
            patientTransportCompanyId: null,
            pharmacyTransportCompanyId: null,
            clinicId: null,
            pharmacyId: null
        }
    };
}

async function cleanup(patient) {
    if (!patient || !patient.id) return;
    await db.PatientServiceDateHistory.destroy({ where: { patientId: patient.id } }).catch(() => {});
    await db.PatientServiceDateCycle.destroy({ where: { patientId: patient.id } }).catch(() => {});
    await db.Patient.destroy({ where: { id: patient.id } }).catch(() => {});
}

async function main() {
    let patient = null;
    try {
        await db.sequelize.authenticate();
        await db.sequelize.sync();

        const oldServiceDate = dateFromToday(-130);
        const newServiceDate = dateFromToday(0);
        patient = await db.Patient.create({
            firstName: 'DOUBLE',
            lastName: `UPDATE-${RUN_ID}`,
            dob: '1980-01-01',
            address: '100 Regression Way',
            phone: '555-0199',
            serviceDate: oldServiceDate,
            notes: 'Concurrent normal Patient update regression',
            isActive: true,
            isDeleted: false,
            patientCode: `DU-${RUN_ID}`.slice(0, 60),
            isNonCompanyPatient: false
        });

        const resA = makeRes();
        const resB = makeRes();
        await Promise.all([
            patientController.update(updateReq(patient, newServiceDate), resA),
            patientController.update(updateReq(patient, newServiceDate), resB)
        ]);

        assert.strictEqual(resA.statusCode, 200, 'First update failed: ' + JSON.stringify(resA.body));
        assert.strictEqual(resB.statusCode, 200, 'Second update failed: ' + JSON.stringify(resB.body));

        const reloaded = await db.Patient.findByPk(patient.id);
        assert.strictEqual(reloaded.serviceDate, newServiceDate, 'Patient service date was not updated.');

        const historyRows = await db.PatientServiceDateHistory.findAll({
            where: {
                patientId: patient.id,
                previousServiceDate: oldServiceDate,
                newServiceDate,
                changeSource: { [Op.in]: ['Patient Update', 'Patient Override'] }
            }
        });
        assert.strictEqual(historyRows.length, 1, 'Concurrent normal Patient updates should create exactly one service-date history row.');

        const activeCycles = await db.PatientServiceDateCycle.count({
            where: { patientId: patient.id, status: 'active' }
        });
        assert.strictEqual(activeCycles, 1, 'Patient should have exactly one active service-date cycle.');

        console.log('PASS normal Patient service-date double update creates one history row');
        console.log(JSON.stringify({ patientId: patient.id, historyRows: historyRows.length, activeCycles }));
    } finally {
        await cleanup(patient);
        await db.sequelize.close().catch(() => {});
    }
}

main().catch((err) => {
    console.error('FAIL normal Patient service-date double update regression');
    console.error(err);
    process.exit(1);
});
