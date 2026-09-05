'use strict';

const assert = require('assert');
const importController = require('../controllers/importController');
const db = require('../models');

const { Op } = db.Sequelize;
const runId = String(Date.now());
const prefix = 'IMP-TAG-' + runId + '-';

function csvEscape(value) {
    const text = value === null || value === undefined ? '' : String(value);
    if (!/[",\r\n]/.test(text)) return text;
    return '"' + text.replace(/"/g, '""') + '"';
}

function buildCsv(rows) {
    const headers = [
        'patientCode',
        'firstName',
        'lastName',
        'dob',
        'phone',
        'address',
        'addressLine1',
        'city',
        'state',
        'zipCode',
        'region',
        'patientTags',
        'clinic',
        'serviceDate',
        'patientTransportCompany',
        'pharmacyTransportCompany',
        'notes',
        'isActive'
    ];
    return [
        headers.map(csvEscape).join(','),
        ...rows.map(row => headers.map(header => csvEscape(row[header] || '')).join(','))
    ].join('\n') + '\n';
}

function callImport(csvText) {
    return new Promise((resolve, reject) => {
        const req = {
            params: { dataset: 'patients' },
            file: { buffer: Buffer.from(csvText, 'utf8') },
            user: { id: null },
            ip: '127.0.0.1',
            socket: { remoteAddress: '127.0.0.1' }
        };
        const res = {
            statusCode: 200,
            status(code) {
                this.statusCode = code;
                return this;
            },
            json(payload) {
                resolve({ statusCode: this.statusCode, payload });
            }
        };
        Promise.resolve(importController.importDataset(req, res)).catch(reject);
    });
}

async function cleanup() {
    const tx = await db.sequelize.transaction();
    try {
        const patients = await db.Patient.findAll({
            where: { patientCode: { [Op.like]: prefix + '%' } },
            attributes: ['id'],
            transaction: tx
        });
        const patientIds = patients.map(patient => patient.id);
        if (patientIds.length) {
            const rxRows = await db.RXRecord.findAll({
                where: { patientId: { [Op.in]: patientIds } },
                attributes: ['id'],
                transaction: tx
            });
            const rxIds = rxRows.map(rx => rx.id);
            if (rxIds.length) {
                await db.RXWorkflowTracking.destroy({ where: { rxRecordId: { [Op.in]: rxIds } }, transaction: tx });
                await db.RXDriverAssignmentHistory.destroy({ where: { rxRecordId: { [Op.in]: rxIds } }, transaction: tx });
                await db.RXRecord.destroy({ where: { id: { [Op.in]: rxIds } }, transaction: tx });
            }
            await db.PatientTagAssignment.destroy({ where: { patientId: { [Op.in]: patientIds } }, transaction: tx });
            await db.PatientServiceDateHistory.destroy({ where: { patientId: { [Op.in]: patientIds } }, transaction: tx });
            await db.PatientServiceDateCycle.destroy({ where: { patientId: { [Op.in]: patientIds } }, transaction: tx });
            await db.Patient.destroy({ where: { id: { [Op.in]: patientIds } }, transaction: tx });
        }
        await tx.commit();
    } catch (err) {
        await tx.rollback();
        throw err;
    }
}

async function main() {
    await db.sequelize.authenticate();
    await cleanup();

    const tags = await db.PatientTag.findAll({ where: { isActive: true }, raw: true });
    assert(tags.some(tag => String(tag.name).toLowerCase() === 'tampa'), 'Test DB needs an active Tampa patient tag.');
    assert(tags.some(tag => String(tag.name).toLowerCase() === 'none'), 'Test DB needs an active None patient tag.');

    const result = await callImport(buildCsv([
        {
            patientCode: prefix + 'REGION',
            firstName: 'Import',
            lastName: 'Region',
            dob: '01/01/1980',
            address: '7401 Kingston Dr, Tampa FL 33619',
            addressLine1: '7401 Kingston Dr',
            city: 'Tampa',
            state: 'FL',
            zipCode: '33619',
            region: 'Tampa',
            serviceDate: '06/01/2026',
            isActive: 'true'
        },
        {
            patientCode: prefix + 'TAGS',
            firstName: 'Import',
            lastName: 'Tags',
            dob: '01/02/1980',
            patientTags: 'City: None',
            serviceDate: '06/02/2026',
            isActive: 'true'
        }
    ]));

    assert.strictEqual(result.statusCode, 200, 'Import HTTP-like status should be 200.');
    assert.strictEqual(result.payload.aborted, false, 'Import should not abort: ' + JSON.stringify(result.payload));
    assert.strictEqual(result.payload.successCount, 2, 'Import should create both patients.');

    const imported = await db.Patient.findAll({
        where: { patientCode: { [Op.like]: prefix + '%' } },
        include: [{ model: db.PatientTag, through: { attributes: [] }, required: false }],
        order: [['patientCode', 'ASC']]
    });
    assert.strictEqual(imported.length, 2, 'Expected two imported patients.');

    const regionPatient = imported.find(patient => patient.patientCode.endsWith('REGION'));
    assert(regionPatient, 'Region import patient was not found.');
    assert.strictEqual(regionPatient.addressLine1, '7401 Kingston Dr');
    assert.strictEqual(regionPatient.city, 'Tampa');
    assert.strictEqual(regionPatient.state, 'FL');
    assert.strictEqual(regionPatient.zipCode, '33619');
    assert(regionPatient.PatientTags.some(tag => String(tag.name).toLowerCase() === 'tampa'), 'Region column did not assign Tampa tag.');

    const tagPatient = imported.find(patient => patient.patientCode.endsWith('TAGS'));
    assert(tagPatient, 'Patient Tags import patient was not found.');
    assert(tagPatient.PatientTags.some(tag => String(tag.name).toLowerCase() === 'none'), 'patientTags column did not assign None tag.');

    console.log('PASS patient import accepts structured address, Region, and Patient Tags columns.');
}

main()
    .catch((err) => {
        console.error(err.stack || err.message);
        process.exitCode = 1;
    })
    .finally(async () => {
        await cleanup().catch(() => {});
        await db.sequelize.close().catch(() => {});
    });
