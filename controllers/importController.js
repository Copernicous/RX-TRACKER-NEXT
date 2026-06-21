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

        const rowErrors = [];
        const validRows = [];
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

                // M5 FIX: Pre-load existing patient codes and name+DOB combos to avoid N+1 queries
                const existingPatients = await db.Patient.findAll({ attributes: ['patientCode', 'firstName', 'lastName', 'dob'], raw: true });
                const dbPatientCodes = new Set(existingPatients.map(p => p.patientCode?.toLowerCase()));
                const dbPatientKeys  = new Set(existingPatients.map(p => `${p.firstName?.toLowerCase()}|${p.lastName?.toLowerCase()}|${p.dob}`));

                for (let i = 0; i < rows.length; i++) {
                    const row = rows[i];
                    const rowNum = i + 2;
                    let { patientCode, firstName, lastName, dob, phone, address, clinic, serviceDate, patientTransportCompany, pharmacyTransportCompany, notes, isActive } = row;

                    if (!firstName || !firstName.trim()) {
                        rowErrors.push({ row: rowNum, error: 'First Name is required' });
                        continue;
                    }
                    if (!lastName || !lastName.trim()) {
                        rowErrors.push({ row: rowNum, error: 'Last Name is required' });
                        continue;
                    }
                    const dobParsed = parseDateField(dob);
                    if (!dob || !dobParsed) {
                        rowErrors.push({ row: rowNum, error: 'DOB is required and must be in MM/DD/YYYY format (e.g. 05/15/1985)' });
                        continue;
                    }
                    dob = dobParsed;

                    // Check/Generate patientCode
                    if (!patientCode || !patientCode.trim()) {
                        const nextId = baseId + validRows.length + 1;
                        patientCode = 'PAT-' + String(nextId).padStart(5, '0');
                    } else {
                        patientCode = patientCode.trim();
                    }

                    // Check batch duplicate patientCode
                    if (seenPatientCodes.has(patientCode.toLowerCase())) {
                        rowErrors.push({ row: rowNum, error: `Patient ID "${patientCode}" is duplicated in this file (Skipped)` });
                        continue;
                    }
                    seenPatientCodes.add(patientCode.toLowerCase());

                    // M5 FIX: In-memory DB duplicate check (no per-row query)
                    if (dbPatientCodes.has(patientCode.toLowerCase())) {
                        rowErrors.push({ row: rowNum, error: `Patient ID "${patientCode}" already exists in database (Skipped)` });
                        continue;
                    }

                    // Check batch duplication by name & DOB
                    const uniqueKey = `${firstName.trim().toLowerCase()}|${lastName.trim().toLowerCase()}|${dob.trim()}`;
                    if (seenPatients.has(uniqueKey)) {
                        rowErrors.push({ row: rowNum, error: `Patient "${firstName.trim()} ${lastName.trim()}" born on ${dob.trim()} is duplicated in this file (Skipped)` });
                        continue;
                    }
                    seenPatients.add(uniqueKey);

                    // M5 FIX: In-memory name+DOB duplicate check (no per-row query)
                    if (dbPatientKeys.has(uniqueKey)) {
                        rowErrors.push({ row: rowNum, error: `Patient "${firstName.trim()} ${lastName.trim()}" born on ${dob.trim()} already exists in database (Skipped)` });
                        continue;
                    }

                    // Resolve Transport Companies
                    let patientTransportCompanyId = null;
                    if (patientTransportCompany && patientTransportCompany.trim()) {
                        const tcStr = patientTransportCompany.trim();
                        const match = ptCompanies.find(c =>
                            (c.companyName && c.companyName.toLowerCase() === tcStr.toLowerCase()) ||
                            (c.contactPerson && c.contactPerson.toLowerCase() === tcStr.toLowerCase()) ||
                            String(c.id) === tcStr
                        );
                        if (match) {
                            patientTransportCompanyId = match.id;
                        } else {
                            rowErrors.push({ row: rowNum, error: `Patient Transport Company "${tcStr}" not found or inactive` });
                            continue;
                        }
                    }

                    let pharmacyTransportCompanyId = null;
                    if (pharmacyTransportCompany && pharmacyTransportCompany.trim()) {
                        const tcStr = pharmacyTransportCompany.trim();
                        const match = phCompanies.find(c =>
                            (c.companyName && c.companyName.toLowerCase() === tcStr.toLowerCase()) ||
                            (c.contactPerson && c.contactPerson.toLowerCase() === tcStr.toLowerCase()) ||
                            String(c.id) === tcStr
                        );
                        if (match) {
                            pharmacyTransportCompanyId = match.id;
                        } else {
                            rowErrors.push({ row: rowNum, error: `Pharmacy Transport Company "${tcStr}" not found or inactive` });
                            continue;
                        }
                    }

                    // Resolve Clinic
                    let clinicId = null;
                    if (clinic && clinic.trim()) {
                        const clStr = clinic.trim();
                        const match = clinics.find(c => c.name.toLowerCase() === clStr.toLowerCase() || String(c.id) === clStr);
                        if (match) {
                            clinicId = match.id;
                        } else {
                            rowErrors.push({ row: rowNum, error: `Clinic "${clStr}" not found or inactive` });
                            continue;
                        }
                    }

                    // Validate Service Date if present
                    let svcDate = null;
                    if (serviceDate && serviceDate.trim()) {
                        svcDate = parseDateField(serviceDate);
                        if (!svcDate) {
                            rowErrors.push({ row: rowNum, error: 'Service Date must be in MM/DD/YYYY format (e.g. 01/01/2026)' });
                            continue;
                        }
                    }

                    validRows.push({
                        patientCode,
                        firstName: firstName.trim(),
                        lastName: lastName.trim(),
                        dob: dob.trim(),
                        phone: phone ? phone.trim() : null,
                        address: address ? address.trim() : null,
                        serviceDate: svcDate,
                        patientTransportCompanyId,
                        pharmacyTransportCompanyId,
                        clinicId,
                        notes: notes ? notes.trim() : null,
                        isActive: isActive ? isActive.trim().toLowerCase() === 'true' : true
                    });
                }

                if (validRows.length > 0) {
                    await db.Patient.bulkCreate(validRows);
                    successCount = validRows.length;
                }
                break;
            }

            case 'pharmacies': {
                const seenPharmacies = new Set();
                // M5 FIX: Pre-load existing pharmacy names to avoid N+1 queries
                const existingPharmacies = await db.Pharmacy.findAll({ attributes: ['name'], raw: true });
                const dbPharmacyNames = new Set(existingPharmacies.map(p => p.name?.toLowerCase()));

                for (let i = 0; i < rows.length; i++) {
                    const row = rows[i];
                    const rowNum = i + 2;
                    const { name, address, phone, contactPerson, notes, isActive } = row;

                    if (!name || !name.trim()) {
                        rowErrors.push({ row: rowNum, error: 'Pharmacy Name is required' });
                        continue;
                    }

                    // Check batch duplication
                    const uniqueKey = name.trim().toLowerCase();
                    if (seenPharmacies.has(uniqueKey)) {
                        rowErrors.push({ row: rowNum, error: `Pharmacy "${name.trim()}" is duplicated in this file (Skipped)` });
                        continue;
                    }
                    seenPharmacies.add(uniqueKey);

                    // M5 FIX: In-memory DB duplicate check
                    if (dbPharmacyNames.has(uniqueKey)) {
                        rowErrors.push({ row: rowNum, error: `Pharmacy "${name.trim()}" already exists in database (Skipped)` });
                        continue;
                    }

                    validRows.push({
                        name: name.trim(),
                        address: address ? address.trim() : null,
                        phone: phone ? phone.trim() : null,
                        contactPerson: contactPerson ? contactPerson.trim() : null,
                        notes: notes ? notes.trim() : null,
                        isActive: isActive ? isActive.trim().toLowerCase() === 'true' : true
                    });
                }

                if (validRows.length > 0) {
                    await db.Pharmacy.bulkCreate(validRows);
                    successCount = validRows.length;
                }
                break;
            }

            case 'clinics': {
                const seenClinics = new Set();
                // M5 FIX: Pre-load existing clinic names
                const existingClinics = await db.Clinic.findAll({ attributes: ['name'], raw: true });
                const dbClinicNames = new Set(existingClinics.map(c => c.name?.toLowerCase()));

                for (let i = 0; i < rows.length; i++) {
                    const row = rows[i];
                    const rowNum = i + 2;
                    const { name, address, phone, contactPerson, notes, isActive } = row;

                    if (!name || !name.trim()) {
                        rowErrors.push({ row: rowNum, error: 'Clinic Name is required' });
                        continue;
                    }

                    // Check batch duplication
                    const uniqueKey = name.trim().toLowerCase();
                    if (seenClinics.has(uniqueKey)) {
                        rowErrors.push({ row: rowNum, error: `Clinic "${name.trim()}" is duplicated in this file (Skipped)` });
                        continue;
                    }
                    seenClinics.add(uniqueKey);

                    // M5 FIX: In-memory DB duplicate check
                    if (dbClinicNames.has(uniqueKey)) {
                        rowErrors.push({ row: rowNum, error: `Clinic "${name.trim()}" already exists in database (Skipped)` });
                        continue;
                    }

                    validRows.push({
                        name: name.trim(),
                        address: address ? address.trim() : null,
                        phone: phone ? phone.trim() : null,
                        contactPerson: contactPerson ? contactPerson.trim() : null,
                        notes: notes ? notes.trim() : null,
                        isActive: isActive ? isActive.trim().toLowerCase() === 'true' : true
                    });
                }

                if (validRows.length > 0) {
                    await db.Clinic.bulkCreate(validRows);
                    successCount = validRows.length;
                }
                break;
            }

            case 'patient-transport': {
                const seenTransport = new Set();
                for (let i = 0; i < rows.length; i++) {
                    const row = rows[i];
                    const rowNum = i + 2;
                    const { companyName, phone, contactPerson, notes, isActive } = row;

                    if (!contactPerson || !contactPerson.trim()) {
                        rowErrors.push({ row: rowNum, error: 'Contact Person is required' });
                        continue;
                    }

                    // Check batch duplication
                    const uniqueKey = contactPerson.trim().toLowerCase();
                    if (seenTransport.has(uniqueKey)) {
                        rowErrors.push({ row: rowNum, error: `Patient Transport Company Contact "${contactPerson.trim()}" is duplicated in this file (Skipped)` });
                        continue;
                    }
                    seenTransport.add(uniqueKey);

                    // Check duplicate in DB
                    const existing = await db.PatientTransportCompany.findOne({
                        where: { contactPerson: contactPerson.trim() }
                    });
                    if (existing) {
                        rowErrors.push({ row: rowNum, error: `Patient Transport Company Contact "${contactPerson.trim()}" already exists in database (Skipped)` });
                        continue;
                    }

                    validRows.push({
                        companyName: companyName ? companyName.trim() : null,
                        phone: phone ? phone.trim() : null,
                        contactPerson: contactPerson.trim(),
                        notes: notes ? notes.trim() : null,
                        isActive: isActive ? isActive.trim().toLowerCase() === 'true' : true
                    });
                }

                if (validRows.length > 0) {
                    await db.PatientTransportCompany.bulkCreate(validRows);
                    successCount = validRows.length;
                }
                break;
            }

            case 'pharmacy-transport': {
                const seenTransport = new Set();
                for (let i = 0; i < rows.length; i++) {
                    const row = rows[i];
                    const rowNum = i + 2;
                    const { companyName, phone, contactPerson, notes, isActive } = row;

                    if (!companyName || !companyName.trim()) {
                        rowErrors.push({ row: rowNum, error: 'Company Name is required' });
                        continue;
                    }

                    // Check batch duplication by companyName
                    const uniqueKey = companyName.trim().toLowerCase();
                    if (seenTransport.has(uniqueKey)) {
                        rowErrors.push({ row: rowNum, error: `Pharmacy Transport Company "${companyName.trim()}" is duplicated in this file (Skipped)` });
                        continue;
                    }
                    seenTransport.add(uniqueKey);

                    // Check duplicate in DB
                    const existing = await db.PharmacyTransportCompany.findOne({
                        where: { companyName: companyName.trim() }
                    });
                    if (existing) {
                        rowErrors.push({ row: rowNum, error: `Pharmacy Transport Company "${companyName.trim()}" already exists in database (Skipped)` });
                        continue;
                    }

                    validRows.push({
                        companyName: companyName.trim(),
                        phone: phone ? phone.trim() : null,
                        contactPerson: contactPerson ? contactPerson.trim() : null,
                        notes: notes ? notes.trim() : null,
                        isActive: isActive ? isActive.trim().toLowerCase() === 'true' : true
                    });
                }

                if (validRows.length > 0) {
                    await db.PharmacyTransportCompany.bulkCreate(validRows);
                    successCount = validRows.length;
                }
                break;
            }

            case 'workflow-actions': {
                const seenNames = new Set();
                const seenSequences = new Set();

                for (let i = 0; i < rows.length; i++) {
                    const row = rows[i];
                    const rowNum = i + 2;
                    const { name, description, sequenceNumber, isActive } = row;

                    if (!name || !name.trim()) {
                        rowErrors.push({ row: rowNum, error: 'Action Name is required' });
                        continue;
                    }
                    if (!sequenceNumber || isNaN(sequenceNumber)) {
                        rowErrors.push({ row: rowNum, error: 'Sequence Number is required and must be an integer' });
                        continue;
                    }

                    // Check batch duplication
                    const nameKey = name.trim().toLowerCase();
                    const seqKey = parseInt(sequenceNumber);
                    if (seenNames.has(nameKey)) {
                        rowErrors.push({ row: rowNum, error: `Workflow Action with name "${name.trim()}" is duplicated in this file (Skipped)` });
                        continue;
                    }
                    if (seenSequences.has(seqKey)) {
                        rowErrors.push({ row: rowNum, error: `Workflow Action with sequence number "${sequenceNumber}" is duplicated in this file (Skipped)` });
                        continue;
                    }
                    seenNames.add(nameKey);
                    seenSequences.add(seqKey);

                    // Check duplicate name or sequence in DB
                    const existingName = await db.WorkflowAction.findOne({
                        where: { name: name.trim() }
                    });
                    if (existingName) {
                        rowErrors.push({ row: rowNum, error: `Workflow Action with name "${name.trim()}" already exists in database (Skipped)` });
                        continue;
                    }

                    const existingSeq = await db.WorkflowAction.findOne({
                        where: { sequenceNumber: parseInt(sequenceNumber) }
                    });
                    if (existingSeq) {
                        rowErrors.push({ row: rowNum, error: `Workflow Action with sequence number "${sequenceNumber}" already exists in database (Skipped)` });
                        continue;
                    }

                    validRows.push({
                        name: name.trim(),
                        description: description ? description.trim() : null,
                        sequenceNumber: parseInt(sequenceNumber),
                        isActive: isActive ? isActive.trim().toLowerCase() === 'true' : true
                    });
                }

                if (validRows.length > 0) {
                    await db.WorkflowAction.bulkCreate(validRows);
                    successCount = validRows.length;
                }
                break;
            }

            case 'users': {
                const roles = await db.Role.findAll();
                const seenUsernames = new Set();
                const seenEmails = new Set();
                // M5 FIX: Pre-load existing usernames and emails to avoid N+1 queries
                const existingUsers = await db.User.findAll({ attributes: ['username', 'email'], raw: true });
                const dbUsernames = new Set(existingUsers.map(u => u.username?.toLowerCase()));
                const dbEmails    = new Set(existingUsers.map(u => u.email?.toLowerCase()));

                for (let i = 0; i < rows.length; i++) {
                    const row = rows[i];
                    const rowNum = i + 2;
                    const { firstName, lastName, username, email, password, role, notes, isActive } = row;

                    if (!firstName || !firstName.trim() || !lastName || !lastName.trim()) {
                        rowErrors.push({ row: rowNum, error: 'First and Last Name are required' });
                        continue;
                    }
                    if (!username || !username.trim()) {
                        rowErrors.push({ row: rowNum, error: 'Username is required' });
                        continue;
                    }
                    if (!email || !email.trim()) {
                        rowErrors.push({ row: rowNum, error: 'Email is required' });
                        continue;
                    }
                    if (!password || !password.trim()) {
                        rowErrors.push({ row: rowNum, error: 'Password is required' });
                        continue;
                    }
                    if (!role || !role.trim()) {
                        rowErrors.push({ row: rowNum, error: 'Role is required. Use a numeric ID: 1=Administrator, 2=Supervisor, 3=Operator, 4=Read Only' });
                        continue;
                    }
                    // Role must be a number only
                    const roleNum = parseInt(role.trim(), 10);
                    if (isNaN(roleNum) || String(roleNum) !== role.trim()) {
                        rowErrors.push({ row: rowNum, error: `Role "${role.trim()}" is invalid. Must be a number: 1=Administrator, 2=Supervisor, 3=Operator, 4=Read Only` });
                        continue;
                    }

                    // Check batch duplication
                    const usernameKey = username.trim().toLowerCase();
                    const emailKey = email.trim().toLowerCase();
                    if (seenUsernames.has(usernameKey)) {
                        rowErrors.push({ row: rowNum, error: `User with username "${username.trim()}" is duplicated in this file (Skipped)` });
                        continue;
                    }
                    if (seenEmails.has(emailKey)) {
                        rowErrors.push({ row: rowNum, error: `User with email "${email.trim()}" is duplicated in this file (Skipped)` });
                        continue;
                    }
                    seenUsernames.add(usernameKey);
                    seenEmails.add(emailKey);

                    // M5 FIX: In-memory DB duplicate check
                    if (dbUsernames.has(usernameKey) || dbEmails.has(emailKey)) {
                        rowErrors.push({ row: rowNum, error: `User with username "${username.trim()}" or email "${email.trim()}" already exists in database (Skipped)` });
                        continue;
                    }

                    // Resolve Role by numeric ID only
                    const match = roles.find(r => String(r.id) === String(roleNum));
                    if (!match) {
                        rowErrors.push({ row: rowNum, error: `Role ID "${roleNum}" not found. Valid IDs: 1=Administrator, 2=Supervisor, 3=Operator, 4=Read Only` });
                        continue;
                    }

                    // Hash password
                    const passwordHash = await bcrypt.hash(password.trim(), 10);

                    validRows.push({
                        firstName: firstName.trim(),
                        lastName:  lastName.trim(),
                        username:  username.trim(),
                        email:     email.trim().toLowerCase(),
                        passwordHash,
                        roleId:    match.id,
                        notes:     notes ? notes.trim() : null,
                        isActive:  isActive ? isActive.trim().toLowerCase() === 'true' : true
                    });
                }

                if (validRows.length > 0) {
                    await db.User.bulkCreate(validRows);
                    successCount = validRows.length;
                }
                break;
            }

            default:
                return res.status(400).json({ error: 'Invalid dataset specified' });
        }

        // Fire-and-forget Audit Log for import operation
        if (successCount > 0) {
            db.AuditLog.create({
                userId: req.user ? req.user.id : null,
                date: new Date().toISOString().split('T')[0],
                time: new Date().toTimeString().split(' ')[0],
                module: 'Data Import',
                action: `Import ${dataset}`,
                recordId: null,
                newValue: { importedCount: successCount },
                ipAddress: req.ip || req.socket?.remoteAddress || 'unknown'  // M4 FIX
            }).catch(err => console.error('[AuditLog Import Error]', err.message));
        }

        return res.json({
            successCount,
            errorCount: rowErrors.length,
            errors: rowErrors
        });

    } catch (err) {
        console.error('[Import Error]', err);
        return res.status(500).json({ error: err.message });
    }
};
