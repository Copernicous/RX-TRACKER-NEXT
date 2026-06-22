const db = require('../models');
const { Op } = require('sequelize');
const bcrypt = require('bcrypt');
const csv = require('csv-parser');
const { Readable } = require('stream');

// Helper to parse CSV buffer to array of objects
const parseCsv = (buffer) => {
    return new Promise((resolve, reject) => {
        const results = [];
        const stream = Readable.from(buffer.toString('utf-8'));
        stream.pipe(csv())
            .on('data', (data) => results.push(data))
            .on('end', () => resolve(results))
            .on('error', (err) => reject(err));
    });
};

// Helper: parse a date string in MM/DD/YYYY or YYYY-MM-DD → returns 'YYYY-MM-DD' or null on failure
function parseDateField(raw) {
    if (!raw || !raw.trim()) return null;
    const v = raw.trim();
    // MM/DD/YYYY
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(v)) {
        const [m, d, y] = v.split('/').map(Number);
        if (m < 1 || m > 12 || d < 1 || d > 31) return null;
        return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    }
    // YYYY-MM-DD (backwards compat)
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
    return null;
}

// GET /api/import/template/:dataset
exports.getTemplate = (req, res) => {
    const { dataset } = req.params;
    let csvContent = '';
    let filename = `template_${dataset}.csv`;

    switch (dataset) {
        case 'patients':
            csvContent = 'patientCode,firstName,lastName,dob,phone,address,clinic,serviceDate,patientTransportCompany,pharmacyTransportCompany,notes,isActive\n' +
                         'PAT-00001,John,Doe,05/15/1985,123-456-7890,"123 Main St, Springfield",Main Clinic,01/01/2026,Health Transit,Pharmacy Express,Allergic to penicillin,true\n';
            break;
        case 'clinics':
            csvContent = 'name,address,phone,contactPerson,notes,isActive\n' +
                         'Main Clinic,"123 Health Way",555-0100,Dr. Smith,Primary care clinic,true\n';
            break;
        case 'pharmacies':
            csvContent = 'name,address,phone,contactPerson,notes,isActive\n' +
                         'Central Pharmacy,"789 Elm St, Metropia",555-0199,Jane Smith,Open 24 hours,true\n';
            break;
        case 'patient-transport':
            csvContent = 'companyName,phone,contactPerson,notes,isActive\n' +
                         'Health Transit,555-0101,John Rogers,Non-emergency medical transit,true\n';
            break;
        case 'pharmacy-transport':
            csvContent = 'companyName,phone,contactPerson,notes,isActive\n' +
                         'Pharmacy Express,555-0202,Lucy Miller,Temperature controlled delivery,true\n';
            break;
        case 'workflow-actions':
            csvContent = 'name,description,sequenceNumber,isActive\n' +
                         'Prescription Received,Prescription received from pharmacy,1,true\n';
            break;
        case 'users':
            csvContent = 'firstName,lastName,username,email,password,role,notes,isActive\n' +
                         'Alice,Johnson,alicej,alice.j@example.com,securePassword123,3,Dispatch operator for Zone A,true\n';
            break;
        default:
            return res.status(404).json({ error: 'Dataset template not found' });
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(csvContent);
};

// POST /api/import/:dataset
exports.importDataset = async (req, res) => {
    const { dataset } = req.params;
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    try {
        const rows = await parseCsv(req.file.buffer);
        if (rows.length === 0) {
            return res.status(400).json({ error: 'The uploaded file is empty or missing headers' });
        }

        // ── Phase 1: Validate ALL rows — collect every error before touching the DB ──
        const rowErrors  = [];   // { row, error, _rawRow }
        const validRows  = [];
        let successCount = 0;

        switch (dataset) {
            case 'patients': {
                const ptCompanies = await db.PatientTransportCompany.findAll({ where: { isActive: true } });
                const phCompanies = await db.PharmacyTransportCompany.findAll({ where: { isActive: true } });
                const clinics = await db.Clinic.findAll({ where: { isActive: true } });
                const seenPatients = new Set();
                const seenPatientCodes = new Set();
                const lastPatient = await db.Patient.findOne({ order: [['id', 'DESC']] });
                let baseId = lastPatient ? lastPatient.id : 0;

                const existingPatients = await db.Patient.findAll({ attributes: ['patientCode', 'firstName', 'lastName', 'dob'], raw: true });
                const dbPatientCodes = new Set(existingPatients.map(p => p.patientCode?.toLowerCase()));
                const dbPatientKeys  = new Set(existingPatients.map(p => `${p.firstName?.toLowerCase()}|${p.lastName?.toLowerCase()}|${p.dob}`));

                for (let i = 0; i < rows.length; i++) {
                    const row = rows[i];
                    const rowNum = i + 2;
                    let { patientCode, firstName, lastName, dob, phone, address, clinic, serviceDate, patientTransportCompany, pharmacyTransportCompany, notes, isActive } = row;

                    const addErr = (msg) => rowErrors.push({ row: rowNum, error: msg, _rawRow: row });

                    if (!firstName || !firstName.trim()) { addErr('First Name is required'); continue; }
                    if (!lastName || !lastName.trim())   { addErr('Last Name is required'); continue; }
                    const dobParsed = parseDateField(dob);
                    if (!dob || !dobParsed) { addErr('DOB is required and must be in MM/DD/YYYY format (e.g. 05/15/1985)'); continue; }
                    dob = dobParsed;

                    if (!patientCode || !patientCode.trim()) {
                        const nextId = baseId + validRows.length + 1;
                        patientCode = 'PAT-' + String(nextId).padStart(5, '0');
                    } else {
                        patientCode = patientCode.trim();
                    }

                    if (seenPatientCodes.has(patientCode.toLowerCase())) { addErr(`Patient ID "${patientCode}" is duplicated in this file`); continue; }
                    seenPatientCodes.add(patientCode.toLowerCase());
                    if (dbPatientCodes.has(patientCode.toLowerCase()))   { addErr(`Patient ID "${patientCode}" already exists in database`); continue; }

                    const uniqueKey = `${firstName.trim().toLowerCase()}|${lastName.trim().toLowerCase()}|${dob.trim()}`;
                    if (seenPatients.has(uniqueKey))  { addErr(`Patient "${firstName.trim()} ${lastName.trim()}" born on ${dob.trim()} is duplicated in this file`); continue; }
                    seenPatients.add(uniqueKey);
                    if (dbPatientKeys.has(uniqueKey)) { addErr(`Patient "${firstName.trim()} ${lastName.trim()}" born on ${dob.trim()} already exists in database`); continue; }

                    let patientTransportCompanyId = null;
                    if (patientTransportCompany && patientTransportCompany.trim()) {
                        const tcStr = patientTransportCompany.trim();
                        const match = ptCompanies.find(c =>
                            (c.companyName && c.companyName.toLowerCase() === tcStr.toLowerCase()) ||
                            (c.contactPerson && c.contactPerson.toLowerCase() === tcStr.toLowerCase()) ||
                            String(c.id) === tcStr
                        );
                        if (match) { patientTransportCompanyId = match.id; }
                        else { addErr(`Patient Transport Company "${tcStr}" not found or inactive`); continue; }
                    }

                    let pharmacyTransportCompanyId = null;
                    if (pharmacyTransportCompany && pharmacyTransportCompany.trim()) {
                        const tcStr = pharmacyTransportCompany.trim();
                        const match = phCompanies.find(c =>
                            (c.companyName && c.companyName.toLowerCase() === tcStr.toLowerCase()) ||
                            (c.contactPerson && c.contactPerson.toLowerCase() === tcStr.toLowerCase()) ||
                            String(c.id) === tcStr
                        );
                        if (match) { pharmacyTransportCompanyId = match.id; }
                        else { addErr(`Pharmacy Transport Company "${tcStr}" not found or inactive`); continue; }
                    }

                    let clinicId = null;
                    if (clinic && clinic.trim()) {
                        const clStr = clinic.trim();
                        const match = clinics.find(c => c.name.toLowerCase() === clStr.toLowerCase() || String(c.id) === clStr);
                        if (match) { clinicId = match.id; }
                        else { addErr(`Clinic "${clStr}" not found or inactive`); continue; }
                    }

                    let svcDate = null;
                    if (serviceDate && serviceDate.trim()) {
                        svcDate = parseDateField(serviceDate);
                        if (!svcDate) { addErr('Service Date must be in MM/DD/YYYY format (e.g. 01/01/2026)'); continue; }
                    }

                    validRows.push({ patientCode, firstName: firstName.trim(), lastName: lastName.trim(), dob: dob.trim(), phone: phone ? phone.trim() : null, address: address ? address.trim() : null, serviceDate: svcDate, patientTransportCompanyId, pharmacyTransportCompanyId, clinicId, notes: notes ? notes.trim() : null, isActive: isActive ? isActive.trim().toLowerCase() === 'true' : true });
                }

                // ── Phase 2: All-or-nothing — only write if zero errors ──
                if (rowErrors.length > 0) break;
                if (validRows.length > 0) { await db.Patient.bulkCreate(validRows); successCount = validRows.length; }
                break;
            }

            case 'pharmacies': {
                const seenPharmacies = new Set();
                const existingPharmacies = await db.Pharmacy.findAll({ attributes: ['name'], raw: true });
                const dbPharmacyNames = new Set(existingPharmacies.map(p => p.name?.toLowerCase()));

                for (let i = 0; i < rows.length; i++) {
                    const row = rows[i]; const rowNum = i + 2;
                    const { name, address, phone, contactPerson, notes, isActive } = row;
                    const addErr = (msg) => rowErrors.push({ row: rowNum, error: msg, _rawRow: row });
                    if (!name || !name.trim()) { addErr('Pharmacy Name is required'); continue; }
                    const uniqueKey = name.trim().toLowerCase();
                    if (seenPharmacies.has(uniqueKey)) { addErr(`Pharmacy "${name.trim()}" is duplicated in this file`); continue; }
                    seenPharmacies.add(uniqueKey);
                    if (dbPharmacyNames.has(uniqueKey)) { addErr(`Pharmacy "${name.trim()}" already exists in database`); continue; }
                    validRows.push({ name: name.trim(), address: address ? address.trim() : null, phone: phone ? phone.trim() : null, contactPerson: contactPerson ? contactPerson.trim() : null, notes: notes ? notes.trim() : null, isActive: isActive ? isActive.trim().toLowerCase() === 'true' : true });
                }
                if (rowErrors.length > 0) break;
                if (validRows.length > 0) { await db.Pharmacy.bulkCreate(validRows); successCount = validRows.length; }
                break;
            }

            case 'clinics': {
                const seenClinics = new Set();
                const existingClinics = await db.Clinic.findAll({ attributes: ['name'], raw: true });
                const dbClinicNames = new Set(existingClinics.map(c => c.name?.toLowerCase()));

                for (let i = 0; i < rows.length; i++) {
                    const row = rows[i]; const rowNum = i + 2;
                    const { name, address, phone, contactPerson, notes, isActive } = row;
                    const addErr = (msg) => rowErrors.push({ row: rowNum, error: msg, _rawRow: row });
                    if (!name || !name.trim()) { addErr('Clinic Name is required'); continue; }
                    const uniqueKey = name.trim().toLowerCase();
                    if (seenClinics.has(uniqueKey)) { addErr(`Clinic "${name.trim()}" is duplicated in this file`); continue; }
                    seenClinics.add(uniqueKey);
                    if (dbClinicNames.has(uniqueKey)) { addErr(`Clinic "${name.trim()}" already exists in database`); continue; }
                    validRows.push({ name: name.trim(), address: address ? address.trim() : null, phone: phone ? phone.trim() : null, contactPerson: contactPerson ? contactPerson.trim() : null, notes: notes ? notes.trim() : null, isActive: isActive ? isActive.trim().toLowerCase() === 'true' : true });
                }
                if (rowErrors.length > 0) break;
                if (validRows.length > 0) { await db.Clinic.bulkCreate(validRows); successCount = validRows.length; }
                break;
            }

            case 'patient-transport': {
                const seenTransport = new Set();
                for (let i = 0; i < rows.length; i++) {
                    const row = rows[i]; const rowNum = i + 2;
                    const { companyName, phone, contactPerson, notes, isActive } = row;
                    const addErr = (msg) => rowErrors.push({ row: rowNum, error: msg, _rawRow: row });
                    if (!contactPerson || !contactPerson.trim()) { addErr('Contact Person is required'); continue; }
                    const uniqueKey = contactPerson.trim().toLowerCase();
                    if (seenTransport.has(uniqueKey)) { addErr(`Patient Transport Contact "${contactPerson.trim()}" is duplicated in this file`); continue; }
                    seenTransport.add(uniqueKey);
                    const existing = await db.PatientTransportCompany.findOne({ where: { contactPerson: contactPerson.trim() } });
                    if (existing) { addErr(`Patient Transport Contact "${contactPerson.trim()}" already exists in database`); continue; }
                    validRows.push({ companyName: companyName ? companyName.trim() : null, phone: phone ? phone.trim() : null, contactPerson: contactPerson.trim(), notes: notes ? notes.trim() : null, isActive: isActive ? isActive.trim().toLowerCase() === 'true' : true });
                }
                if (rowErrors.length > 0) break;
                if (validRows.length > 0) { await db.PatientTransportCompany.bulkCreate(validRows); successCount = validRows.length; }
                break;
            }

            case 'pharmacy-transport': {
                const seenTransport = new Set();
                for (let i = 0; i < rows.length; i++) {
                    const row = rows[i]; const rowNum = i + 2;
                    const { companyName, phone, contactPerson, notes, isActive } = row;
                    const addErr = (msg) => rowErrors.push({ row: rowNum, error: msg, _rawRow: row });
                    if (!companyName || !companyName.trim()) { addErr('Company Name is required'); continue; }
                    const uniqueKey = companyName.trim().toLowerCase();
                    if (seenTransport.has(uniqueKey)) { addErr(`Pharmacy Transport Company "${companyName.trim()}" is duplicated in this file`); continue; }
                    seenTransport.add(uniqueKey);
                    const existing = await db.PharmacyTransportCompany.findOne({ where: { companyName: companyName.trim() } });
                    if (existing) { addErr(`Pharmacy Transport Company "${companyName.trim()}" already exists in database`); continue; }
                    validRows.push({ companyName: companyName.trim(), phone: phone ? phone.trim() : null, contactPerson: contactPerson ? contactPerson.trim() : null, notes: notes ? notes.trim() : null, isActive: isActive ? isActive.trim().toLowerCase() === 'true' : true });
                }
                if (rowErrors.length > 0) break;
                if (validRows.length > 0) { await db.PharmacyTransportCompany.bulkCreate(validRows); successCount = validRows.length; }
                break;
            }

            case 'workflow-actions': {
                const seenNames = new Set();
                const seenSequences = new Set();
                for (let i = 0; i < rows.length; i++) {
                    const row = rows[i]; const rowNum = i + 2;
                    const { name, description, sequenceNumber, isActive } = row;
                    const addErr = (msg) => rowErrors.push({ row: rowNum, error: msg, _rawRow: row });
                    if (!name || !name.trim()) { addErr('Action Name is required'); continue; }
                    if (!sequenceNumber || isNaN(sequenceNumber)) { addErr('Sequence Number is required and must be an integer'); continue; }
                    const nameKey = name.trim().toLowerCase();
                    const seqKey  = parseInt(sequenceNumber);
                    if (seenNames.has(nameKey))     { addErr(`Workflow Action name "${name.trim()}" is duplicated in this file`); continue; }
                    if (seenSequences.has(seqKey))  { addErr(`Sequence number "${sequenceNumber}" is duplicated in this file`); continue; }
                    seenNames.add(nameKey); seenSequences.add(seqKey);
                    const existingName = await db.WorkflowAction.findOne({ where: { name: name.trim() } });
                    if (existingName) { addErr(`Workflow Action "${name.trim()}" already exists in database`); continue; }
                    const existingSeq  = await db.WorkflowAction.findOne({ where: { sequenceNumber: seqKey } });
                    if (existingSeq)  { addErr(`Sequence number "${sequenceNumber}" already exists in database`); continue; }
                    validRows.push({ name: name.trim(), description: description ? description.trim() : null, sequenceNumber: seqKey, isActive: isActive ? isActive.trim().toLowerCase() === 'true' : true });
                }
                if (rowErrors.length > 0) break;
                if (validRows.length > 0) { await db.WorkflowAction.bulkCreate(validRows); successCount = validRows.length; }
                break;
            }

            case 'users': {
                const roles = await db.Role.findAll();
                const seenUsernames = new Set();
                const seenEmails    = new Set();
                const existingUsers = await db.User.findAll({ attributes: ['username', 'email'], raw: true });
                const dbUsernames   = new Set(existingUsers.map(u => u.username?.toLowerCase()));
                const dbEmails      = new Set(existingUsers.map(u => u.email?.toLowerCase()));

                for (let i = 0; i < rows.length; i++) {
                    const row = rows[i]; const rowNum = i + 2;
                    const { firstName, lastName, username, email, password, role, notes, isActive } = row;
                    const addErr = (msg) => rowErrors.push({ row: rowNum, error: msg, _rawRow: row });
                    if (!firstName || !firstName.trim() || !lastName || !lastName.trim()) { addErr('First and Last Name are required'); continue; }
                    if (!username || !username.trim()) { addErr('Username is required'); continue; }
                    if (!email    || !email.trim())    { addErr('Email is required'); continue; }
                    if (!password || !password.trim()) { addErr('Password is required'); continue; }
                    if (!role     || !role.trim())     { addErr('Role is required. Use a numeric ID: 1=Administrator, 2=Supervisor, 3=Operator, 4=Read Only'); continue; }
                    const roleNum = parseInt(role.trim(), 10);
                    if (isNaN(roleNum) || String(roleNum) !== role.trim()) { addErr(`Role "${role.trim()}" is invalid. Must be a number: 1=Administrator, 2=Supervisor, 3=Operator, 4=Read Only`); continue; }
                    const usernameKey = username.trim().toLowerCase();
                    const emailKey    = email.trim().toLowerCase();
                    if (seenUsernames.has(usernameKey)) { addErr(`Username "${username.trim()}" is duplicated in this file`); continue; }
                    if (seenEmails.has(emailKey))       { addErr(`Email "${email.trim()}" is duplicated in this file`); continue; }
                    seenUsernames.add(usernameKey); seenEmails.add(emailKey);
                    if (dbUsernames.has(usernameKey) || dbEmails.has(emailKey)) { addErr(`Username "${username.trim()}" or email "${email.trim()}" already exists in database`); continue; }
                    const match = roles.find(r => String(r.id) === String(roleNum));
                    if (!match) { addErr(`Role ID "${roleNum}" not found. Valid IDs: 1=Administrator, 2=Supervisor, 3=Operator, 4=Read Only`); continue; }
                    const passwordHash = await bcrypt.hash(password.trim(), 10);
                    validRows.push({ firstName: firstName.trim(), lastName: lastName.trim(), username: username.trim(), email: email.trim().toLowerCase(), passwordHash, roleId: match.id, notes: notes ? notes.trim() : null, isActive: isActive ? isActive.trim().toLowerCase() === 'true' : true });
                }
                if (rowErrors.length > 0) break;
                if (validRows.length > 0) { await db.User.bulkCreate(validRows); successCount = validRows.length; }
                break;
            }

            default:
                return res.status(400).json({ error: 'Invalid dataset specified' });
        }

        // ── If ANY errors found: abort entirely, return failed rows for download ──
        if (rowErrors.length > 0) {
            // Build failedRows: original CSV columns + _import_error column
            const failedRows = rowErrors.map(e => ({ ...e._rawRow, _import_error: e.error }));
            return res.json({
                aborted:    true,
                successCount: 0,
                errorCount: rowErrors.length,
                errors:     rowErrors.map(e => ({ row: e.row, error: e.error })),
                failedRows
            });
        }

        // ── Success: log and return ──
        if (successCount > 0) {
            db.AuditLog.create({
                userId: req.user ? req.user.id : null,
                date: new Date().toISOString().split('T')[0],
                time: new Date().toTimeString().split(' ')[0],
                module: 'Data Import',
                action: `Import ${dataset}`,
                recordId: null,
                newValue: { importedCount: successCount },
                ipAddress: req.ip || req.socket?.remoteAddress || 'unknown'
            }).catch(err => console.error('[AuditLog Import Error]', err.message));
        }

        return res.json({ aborted: false, successCount, errorCount: 0, errors: [] });

    } catch (err) {
        console.error('[Import Error]', err);
        return res.status(500).json({ error: err.message });
    }
};
