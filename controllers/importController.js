const db = require('../models');
const bcrypt = require('bcryptjs');
const csv = require('csv-parser');
const { Readable } = require('stream');
const { parseDate } = require('../utils/dateUtils');
const { getServiceWindowDays } = require('../utils/globalSettings');
const {
    bulkRecordPatientServiceDateChanges
} = require('../services/patientServiceDateHistoryService');
const {
    syncPatientServiceDateCycles
} = require('../services/patientServiceDateCycleService');
const {
    cleanCompanyName,
    normalizeCompanyName,
    findCompanyNameConflict,
    duplicateCompanyMessage
} = require('../utils/pharmacyTransportIdentity');
const {
    inferRegionalTagName,
    normalizeAddressPayload
} = require('../utils/patientAddress');

const WORKFLOW_HEADERS = [
    'rx received warehouse',
    'on route with driver',
    'delivered',
    'mark as received to print log',
    'signed by pharmacy',
    'archived on local and case close'
];

function normalizeImportHeader(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');
}

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
    if (!raw || !String(raw).trim()) return null;
    return parseDate(raw);
}

function toDateOnly(raw) {
    if (!raw) return null;
    if (typeof raw === 'string') {
        const iso = parseDateField(raw);
        if (!iso) return null;
        const [year, month, day] = iso.split('-').map(Number);
        return new Date(year, month - 1, day);
    }
    if (raw instanceof Date && !isNaN(raw.getTime())) {
        return new Date(raw.getFullYear(), raw.getMonth(), raw.getDate());
    }
    const parsed = parseDateField(raw);
    if (!parsed) return null;
    const [year, month, day] = parsed.split('-').map(Number);
    return new Date(year, month - 1, day);
}

function normalizeTransportToken(value) {
    return String(value || '')
        .normalize('NFKD')
        .replace(/\uFEFF/g, '')
        .replace(/[\u00A0\t\r\n]/g, ' ')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function formatDateLabel(dateLike) {
    if (!dateLike) return '(none)';
    const date = toDateOnly(dateLike);
    if (!date) return '(invalid)';
    return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
}

function validateWorkflowAgainstServiceDate(serviceDate, workflowTracking, addErr) {
    if (!serviceDate || !workflowTracking.length) return;
    const svcDate = toDateOnly(serviceDate);
    if (!svcDate) return;

    const firstStep = workflowTracking.reduce((best, step) => {
        if (!best) return step;
        return step.completionDate < best.completionDate ? step : best;
    }, null);
    if (!firstStep) return;

    const firstDate = toDateOnly(firstStep.completionDate);
    if (!firstDate) return;

    if (firstDate < svcDate) {
        addErr(`First workflow step "${firstStep.name}" (${formatDateLabel(firstDate)}) cannot be before service date (${formatDateLabel(svcDate)}).`);
    }

    const expiryDate = new Date(svcDate);
    expiryDate.setDate(expiryDate.getDate() + getServiceWindowDays());

    const outsideWindow = workflowTracking.find((step) => {
        const stepDate = toDateOnly(step.completionDate);
        return stepDate && stepDate > expiryDate;
    });
    if (outsideWindow) {
        const stepDate = toDateOnly(outsideWindow.completionDate);
        addErr(`Workflow step "${outsideWindow.name}" (${formatDateLabel(stepDate)}) exceeds service date + ${getServiceWindowDays()} days (${formatDateLabel(expiryDate)}).`);
    }
}

function normalizeLookupText(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeLookupKey(value) {
    return normalizeLookupText(value).replace(/\s+/g, '');
}

function isActiveLike(record) {
    const active = record?.isActive;
    return active !== false && active !== 0 && active !== '0';
}

function transportHasTokenMatch(source, queryTokens) {
    if (!queryTokens.length) return false;
    const sourceTokens = normalizeTransportToken(source).split(' ').filter(Boolean);
    return queryTokens.every((token) => sourceTokens.includes(token));
}

function resolveTransportMatch(rawValue, records) {
    const query = String(rawValue || '').trim();
    if (!query) return { found: false };

    const exactById = records.find((record) => String(record.id) === query);
    if (exactById) {
        return { found: true, company: exactById, active: isActiveLike(exactById) };
    }

    const direct = query.toLowerCase();
    const normalized = normalizeTransportToken(query);
    const compact = normalizeLookupKey(normalized);
    const queryTokens = normalized.split(' ').filter(Boolean);

    const matchesRecord = (record) => {
        const cName = String(record?.companyName || '');
        const cContact = String(record?.contactPerson || '');
        return (
            (cName && (
                cName.trim().toLowerCase() === direct ||
                normalizeTransportToken(cName) === normalized ||
                normalizeLookupKey(cName) === compact ||
                transportHasTokenMatch(cName, queryTokens)
            )) ||
            (cContact && (
                cContact.trim().toLowerCase() === direct ||
                normalizeTransportToken(cContact) === normalized ||
                normalizeLookupKey(cContact) === compact ||
                transportHasTokenMatch(cContact, queryTokens)
            ))
        );
    };

    const activeMatch = records.find((record) => isActiveLike(record) && matchesRecord(record));
    if (activeMatch) return { found: true, company: activeMatch, active: true };

    const inactiveMatch = records.find((record) => !isActiveLike(record) && matchesRecord(record));
    if (inactiveMatch) return { found: true, company: inactiveMatch, active: false };

    return { found: false };
}

function toUpperName(value) {
    return String(value || '').trim().toUpperCase();
}

function cleanTagText(value) {
    return String(value || '').trim();
}

function tagDisplayName(tag) {
    if (!tag) return '';
    const groupName = cleanTagText(tag.groupName);
    const name = cleanTagText(tag.name);
    return groupName ? `${groupName}: ${name}` : name;
}

function splitImportList(value) {
    return String(value || '')
        .split(/[;,|]/)
        .map(item => item.trim())
        .filter(Boolean);
}

function tagKey(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ');
}

function buildPatientTagLookup(tags) {
    const byId = new Map();
    const byLabel = new Map();
    const byName = new Map();
    const add = (map, key, tag) => {
        const clean = tagKey(key);
        if (!clean) return;
        const list = map.get(clean) || [];
        list.push(tag);
        map.set(clean, list);
    };
    tags.forEach(tag => {
        byId.set(String(tag.id), tag);
        add(byLabel, tagDisplayName(tag), tag);
        const group = tagKey(tag.groupName);
        if (group === 'region' || group === 'city') {
            add(byLabel, `Region: ${tag.name}`, tag);
            add(byLabel, `City: ${tag.name}`, tag);
        }
        add(byName, tag.name, tag);
    });
    return { byId, byLabel, byName };
}

function selectTagMatch(matches, options) {
    const activeMatches = (matches || []).filter(tag => tag && tag.isActive !== false);
    if (!activeMatches.length) return null;
    const preferredGroups = (options.preferredGroups || []).map(tagKey);
    if (preferredGroups.length) {
        const preferred = activeMatches.filter(tag => preferredGroups.includes(tagKey(tag.groupName)));
        if (preferred.length === 1) return preferred[0];
        if (preferred.length > 1) return { ambiguous: true, matches: preferred };
    }
    if (activeMatches.length === 1) return activeMatches[0];
    return { ambiguous: true, matches: activeMatches };
}

function resolveTagToken(token, lookup, options) {
    const clean = cleanTagText(token);
    if (!clean) return null;
    if (/^\d+$/.test(clean) && lookup.byId.has(clean)) return lookup.byId.get(clean);
    const labelMatch = selectTagMatch(lookup.byLabel.get(tagKey(clean)), options);
    if (labelMatch) return labelMatch;
    return selectTagMatch(lookup.byName.get(tagKey(clean)), options);
}

function hasImportValue(value) {
    return value !== undefined && value !== null && String(value).trim() !== '';
}

function inferDefaultPatientTagIds(tags, address, city) {
    const defaultTags = tags.filter(tag => tag.isActive !== false && tag.isDefault === true);
    const regionalTags = tags.filter(tag => {
        const group = tagKey(tag.groupName);
        return tag.isActive !== false && (group === 'region' || group === 'city');
    });
    const inferred = inferRegionalTagName(address, city).toLowerCase();
    const inferredTag = regionalTags.find(tag => tagKey(tag.name) === inferred);
    const ids = defaultTags
        .filter(tag => !['region', 'city'].includes(tagKey(tag.groupName)))
        .map(tag => Number(tag.id));
    if (inferredTag) ids.push(Number(inferredTag.id));
    return Array.from(new Set(ids));
}

function resolveImportedPatientTagIds(row, tags, lookup, addErr) {
    const rawIdList = hasImportValue(row.patientTagIds) ? splitImportList(row.patientTagIds) : [];
    const rawTagList = hasImportValue(row.patientTags) ? splitImportList(row.patientTags) : [];
    const rawRegionList = hasImportValue(row.region) ? splitImportList(row.region) : [];
    const explicit = rawIdList.length || rawTagList.length || rawRegionList.length;
    if (!explicit) return inferDefaultPatientTagIds(tags, row.address, row.city);

    const ids = [];
    const resolveOne = (token, options, label) => {
        const match = resolveTagToken(token, lookup, options);
        if (!match) {
            addErr(`${label} "${token}" does not match an active Patient Tag.`);
            return;
        }
        if (match.ambiguous) {
            addErr(`${label} "${token}" matches multiple Patient Tags. Use "Group: Name" or the tag ID.`);
            return;
        }
        ids.push(Number(match.id));
    };
    rawIdList.forEach(token => resolveOne(token, {}, 'Patient Tag ID'));
    rawTagList.forEach(token => resolveOne(token, {}, 'Patient Tag'));
    rawRegionList.forEach(token => resolveOne(token, { preferredGroups: ['Region', 'City'] }, 'Region'));
    return Array.from(new Set(ids));
}

function extractWorkflowTracking(row, actionByNormalizedName, actionBySequence, addErr) {
    const entries = [];
    const seenActionIds = new Set();

    Object.keys(row).forEach((rawHeader) => {
        const normalizedHeader = normalizeImportHeader(rawHeader);
        if (!WORKFLOW_HEADERS.includes(normalizedHeader)) return;

        const trimmed = (row[rawHeader] || '').toString().trim();
        if (!trimmed) return;

        const headerIndex = WORKFLOW_HEADERS.indexOf(normalizedHeader);
        const action = actionByNormalizedName.get(normalizedHeader) || actionBySequence.get(headerIndex + 1);
        if (!action) {
            addErr(`Unknown workflow step header "${rawHeader}" - no matching workflow action found.`);
            return;
        }

        const parsedDate = parseDateField(trimmed);
        if (!parsedDate) {
            addErr(`Workflow date for "${rawHeader}" must be in MM/DD/YYYY or YYYY-MM-DD format.`);
            return;
        }

        if (seenActionIds.has(action.id)) {
            addErr(`Duplicate workflow step header mapped to "${action.name}".`);
            return;
        }
        seenActionIds.add(action.id);

        entries.push({
            workflowActionId: action.id,
            name: action.name,
            sequenceNumber: action.sequenceNumber || 0,
            completionDate: new Date(`${parsedDate}T00:00:00`)
        });
    });

    entries.sort((a, b) => {
        if (a.sequenceNumber !== b.sequenceNumber) return a.sequenceNumber - b.sequenceNumber;
        return a.completionDate - b.completionDate;
    });

    for (let i = 1; i < entries.length; i++) {
        if (entries[i].completionDate < entries[i - 1].completionDate) {
            addErr('Workflow step dates must be in chronological order (earlier to later sequence).');
            break;
        }
    }

    return entries;
}

// GET /api/import/template/:dataset
exports.getTemplate = (req, res) => {
    const { dataset } = req.params;
    let csvContent = '';
    let filename = `template_${dataset}.csv`;

        switch (dataset) {
            case 'patients':
            csvContent =
                'patientCode,firstName,lastName,dob,phone,address,addressLine1,city,state,zipCode,region,patientTags,clinic,serviceDate,patientTransportCompany,pharmacyTransportCompany,notes,isActive,' +
                'RX Received Warehouse,On Route with Driver,Delivered,Mark as Received to print log,Signed by Pharmacy,Archived on local and case close\n' +
                'PAT-00001,JOHN,DOE,05/15/1985,123-456-7890,"123 Main St, Miami FL 33101",123 Main St,Miami,FL,33101,Miami,,"Main Clinic",06/01/2026,Health Transit,Pharmacy Express,Allergic to penicillin,true,06/01/2026,06/02/2026,06/03/2026,,,,';
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
                const ptCompanies = await db.PatientTransportCompany.findAll();
                const phCompanies = await db.PharmacyTransportCompany.findAll();
                const clinics = await db.Clinic.findAll({ where: { isActive: true } });
                const workflowActions = await db.WorkflowAction.findAll({
                    where: { isActive: true },
                    order: [['sequenceNumber', 'ASC']]
                });
                const patientTags = await db.PatientTag.findAll({
                    where: { isActive: true },
                    order: [['groupName', 'ASC'], ['name', 'ASC'], ['id', 'ASC']],
                    raw: true
                });
                const patientTagLookup = buildPatientTagLookup(patientTags);
                const actionByNormalizedName = new Map();
                const actionBySequence = new Map();
                workflowActions.forEach((action) => {
                    actionByNormalizedName.set(normalizeImportHeader(action.name), action);
                    actionBySequence.set(action.sequenceNumber, action);
                });

                const seenPatients = new Set();
                const seenPatientCodes = new Set();
                const patientCodeFirstRow = new Map();
                const rowsWithErrors = new Set();
                const lastPatient = await db.Patient.findOne({ order: [['id', 'DESC']] });
                let baseId = lastPatient ? lastPatient.id : 0;

                const existingPatients = await db.Patient.findAll({ attributes: ['patientCode', 'firstName', 'lastName', 'dob'], raw: true });
                const dbPatientCodes = new Set(existingPatients.map(p => p.patientCode?.toLowerCase()));
                const dbPatientKeys  = new Set(existingPatients.map(p => `${p.firstName?.toLowerCase()}|${p.lastName?.toLowerCase()}|${p.dob}`));

                for (let i = 0; i < rows.length; i++) {
                    const row = rows[i];
                    const rowNum = i + 2;
                    let { patientCode, firstName, lastName, dob, phone, address, addressLine1, city, state, zipCode, clinic, serviceDate, patientTransportCompany, pharmacyTransportCompany, notes, isActive } = row;
                    const firstNameCaps = toUpperName(firstName);
                    const lastNameCaps = toUpperName(lastName);

                    const markError = () => rowsWithErrors.add(rowNum);
                    const addErr = (msg) => {
                        rowErrors.push({ row: rowNum, error: msg, _rawRow: row });
                        markError();
                    };

                    if (!firstNameCaps) { addErr('First Name is required'); continue; }
                    if (!lastNameCaps)   { addErr('Last Name is required'); continue; }
                    const dobParsed = parseDateField(dob);
                    if (!dob || !dobParsed) { addErr('DOB is required and must be in MM/DD/YYYY or YYYY-MM-DD format (e.g. 05/15/1985)'); continue; }
                    dob = dobParsed;

                    if (!patientCode || !patientCode.trim()) {
                        const nextId = baseId + validRows.length + 1;
                        patientCode = 'PAT-' + String(nextId).padStart(5, '0');
                    } else {
                        patientCode = patientCode.trim();
                    }

                    const patientCodeKey = patientCode.toLowerCase();
                    const seenRow = patientCodeFirstRow.get(patientCodeKey);
                    if (seenRow && !rowsWithErrors.has(seenRow)) {
                        addErr(`Patient ID "${patientCode}" is duplicated in this file (also used on line ${seenRow}).`);
                        continue;
                    }
                    patientCodeFirstRow.set(patientCodeKey, rowNum);
                    seenPatientCodes.add(patientCode.toLowerCase());
                    if (dbPatientCodes.has(patientCode.toLowerCase()))   { addErr(`Patient ID "${patientCode}" already exists in database`); continue; }

                    const uniqueKey = `${firstNameCaps.toLowerCase()}|${lastNameCaps.toLowerCase()}|${dob.trim()}`;
                    if (seenPatients.has(uniqueKey))  { addErr(`Patient "${firstNameCaps} ${lastNameCaps}" born on ${dob.trim()} is duplicated in this file`); continue; }
                    seenPatients.add(uniqueKey);
                    if (dbPatientKeys.has(uniqueKey)) { addErr(`Patient "${firstNameCaps} ${lastNameCaps}" born on ${dob.trim()} already exists in database`); continue; }

                    let patientTransportCompanyId = null;
                    if (patientTransportCompany && patientTransportCompany.trim()) {
                        const tcStr = patientTransportCompany.trim();
                        const resolved = resolveTransportMatch(tcStr, ptCompanies);
                        if (resolved.found && resolved.active) {
                            patientTransportCompanyId = resolved.company.id;
                        } else if (resolved.found && !resolved.active) {
                            addErr(`Patient Transport Company "${tcStr}" exists but is marked inactive. Please activate it before importing patients.`);
                            continue;
                        } else {
                            addErr(`Patient Transport Company "${tcStr}" not found or inactive.`);
                            continue;
                        }
                    }

                    let pharmacyTransportCompanyId = null;
                    if (pharmacyTransportCompany && pharmacyTransportCompany.trim()) {
                        const tcStr = pharmacyTransportCompany.trim();
                        const resolved = resolveTransportMatch(tcStr, phCompanies);
                        if (resolved.found && resolved.active) {
                            pharmacyTransportCompanyId = resolved.company.id;
                        } else if (resolved.found && !resolved.active) {
                            addErr(`Pharmacy Transport Company "${tcStr}" exists but is marked inactive. Please activate it before importing patients.`);
                            continue;
                        } else {
                            addErr(`Pharmacy Transport Company "${tcStr}" not found or inactive.`);
                            continue;
                        }
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
                        if (!svcDate) { addErr('Service Date must be in MM/DD/YYYY or YYYY-MM-DD format (e.g. 01/01/2026).'); continue; }
                    }

                    const workflowTracking = extractWorkflowTracking(row, actionByNormalizedName, actionBySequence, addErr);
                    const hasWorkflowDates = workflowTracking.length > 0;

                    if (hasWorkflowDates && !svcDate) {
                        const earliest = workflowTracking.reduce((acc, step) => {
                            const stepDate = new Date(step.completionDate);
                            if (!acc || stepDate < acc) return stepDate;
                            return acc;
                        }, null);
                        if (earliest) {
                            const iso = `${earliest.getFullYear()}-${String(earliest.getMonth() + 1).padStart(2, '0')}-${String(earliest.getDate()).padStart(2, '0')}`;
                            svcDate = parseDateField(iso);
                        }
                    }
                    if (hasWorkflowDates && svcDate) {
                        validateWorkflowAgainstServiceDate(svcDate, workflowTracking, addErr);
                    }

                    const normalizedAddress = normalizeAddressPayload({ address, addressLine1, city, state, zipCode });
                    const patientTagIds = resolveImportedPatientTagIds({
                        patientTagIds: row.patientTagIds,
                        patientTags: row.patientTags,
                        region: row.region,
                        address: normalizedAddress.address,
                        city: normalizedAddress.city
                    }, patientTags, patientTagLookup, addErr);
                    validRows.push({
                        patientCode,
                        firstName: firstNameCaps,
                        lastName: lastNameCaps,
                        dob: dob.trim(),
                        phone: phone ? phone.trim() : null,
                        address: normalizedAddress.address,
                        addressLine1: normalizedAddress.addressLine1,
                        city: normalizedAddress.city,
                        state: normalizedAddress.state,
                        zipCode: normalizedAddress.zipCode,
                        serviceDate: svcDate,
                        patientTransportCompanyId,
                        pharmacyTransportCompanyId,
                        clinicId,
                        notes: notes ? notes.trim() : null,
                        isActive: isActive ? isActive.trim().toLowerCase() === 'true' : true,
                        patientTagIds,
                        workflowTracking
                    });
                }

                // ── Phase 2: All-or-nothing — only write if zero errors ──
                if (rowErrors.length > 0) break;
                if (validRows.length > 0) {
                    const tx = await db.sequelize.transaction();
                    try {
                        const createdPatients = await db.Patient.bulkCreate(validRows.map((rowPayload) => {
                            const { workflowTracking, patientTagIds, ...patientPayload } = rowPayload;
                            return patientPayload;
                        }), { transaction: tx });

                        for (let i = 0; i < createdPatients.length; i++) {
                            const rowPayload = validRows[i];
                            const patient = createdPatients[i];
                            if (typeof patient.setPatientTags === 'function') {
                                await patient.setPatientTags(rowPayload.patientTagIds || [], { transaction: tx });
                            }
                            const steps = rowPayload.workflowTracking || [];
                            if (steps.length) {
                                const rx = await db.RXRecord.create({
                                    patientId: patient.id,
                                    serviceDate: rowPayload.serviceDate,
                                    arrivalDate: rowPayload.serviceDate,
                                    patientTransportCompanyId: rowPayload.patientTransportCompanyId,
                                    pharmacyTransportCompanyId: rowPayload.pharmacyTransportCompanyId
                                }, { transaction: tx });

                                for (const step of steps) {
                                    const tracking = await db.RXWorkflowTracking.create({
                                        rxRecordId: rx.id,
                                        workflowActionId: step.workflowActionId,
                                        completionDate: step.completionDate,
                                        userId: req.user?.id || null,
                                        driverId: null,
                                        driverNameSnapshot: null
                                    }, { transaction: tx });
                                    await db.RXDriverAssignmentHistory.create({
                                        rxRecordId: rx.id,
                                        workflowTrackingId: tracking.id,
                                        workflowActionId: step.workflowActionId,
                                        workflowActionName: step.name || null,
                                        previousDriverId: null,
                                        previousDriverName: null,
                                        driverId: null,
                                        driverName: null,
                                        changeType: 'stage_snapshot',
                                        reason: `Imported workflow stage "${step.name || step.workflowActionId}" without a driver assignment.`,
                                        userId: req.user?.id || null
                                    }, { transaction: tx });
                                }
                            }

                            await syncPatientServiceDateCycles(patient, {
                                transaction: tx,
                                userId: req.user?.id || null,
                                source: 'Patient Import'
                            });
                        }

                        await tx.commit();
                        successCount = validRows.length;
                        await bulkRecordPatientServiceDateChanges(createdPatients.map((patient, i) => ({
                            patientId: patient.id,
                            previousServiceDate: null,
                            newServiceDate: validRows[i].serviceDate
                        })), {
                            userId: req.user?.id || null,
                            changeSource: 'Patient Import',
                            reason: 'Imported patient service date.'
                        });
                    } catch (err) {
                        await tx.rollback();
                        throw err;
                    }
                }
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
                const transaction = await db.sequelize.transaction();
                try {
                    await db.sequelize.query(
                        "SELECT pg_advisory_xact_lock(hashtext('rx-pharmacy-transport-company-identity'))",
                        { transaction }
                    );
                    const existingRecords = await db.PharmacyTransportCompany.findAll({
                        attributes: ['id', 'companyName', 'isActive'],
                        transaction
                    });
                    const seenTransport = new Set();
                    for (let i = 0; i < rows.length; i++) {
                        const row = rows[i]; const rowNum = i + 2;
                        const { companyName, phone, contactPerson, notes, isActive } = row;
                        const addErr = (msg) => rowErrors.push({ row: rowNum, error: msg, _rawRow: row });
                        const cleanedName = cleanCompanyName(companyName);
                        if (!cleanedName) { addErr('Company Name is required'); continue; }
                        const uniqueKey = normalizeCompanyName(cleanedName);
                        if (seenTransport.has(uniqueKey)) { addErr(`Pharmacy Transport Company "${cleanedName}" is duplicated in this file`); continue; }
                        seenTransport.add(uniqueKey);
                        const existing = findCompanyNameConflict(existingRecords, cleanedName);
                        if (existing) { addErr(duplicateCompanyMessage(existing)); continue; }
                        validRows.push({ companyName: cleanedName, phone: phone ? phone.trim() : null, contactPerson: contactPerson ? contactPerson.trim() : null, notes: notes ? notes.trim() : null, isActive: isActive ? isActive.trim().toLowerCase() === 'true' : true });
                    }
                    if (rowErrors.length === 0 && validRows.length > 0) {
                        await db.PharmacyTransportCompany.bulkCreate(validRows, { transaction });
                        successCount = validRows.length;
                    }
                    if (rowErrors.length > 0) await transaction.rollback();
                    else await transaction.commit();
                } catch (error) {
                    if (!transaction.finished) await transaction.rollback();
                    throw error;
                }
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
