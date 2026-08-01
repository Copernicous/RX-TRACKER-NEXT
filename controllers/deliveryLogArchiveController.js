const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const db = require('../models');
const { resolveWritablePath } = require('../utils/runtimePaths');

const ARCHIVE_DIR = resolveWritablePath('administration', 'delivery-log-archives');
const ARCHIVE_EXT = '.json';
const FORMAT_VERSION = 2;
const RENDERER_VERSION = 'delivery-log-archive-v2';
const ARCHIVE_STYLESHEET_PATH = path.join(__dirname, '..', 'public', 'css', 'rx-delivery-log-archive-v2.css');
const MAX_REQUEST_BYTES = 32 * 1024;
const MAX_ARCHIVE_BYTES = 2 * 1024 * 1024;
const MAX_ROWS = 250;
const MAX_GROUPS = 100;
const MAX_FILTER_LENGTH = 1000;
const MAX_PERIOD_LENGTH = 300;
const MAX_DRIVER_LENGTH = 160;
const MAX_TIMEZONE_NAME_LENGTH = 100;
const MAX_CLOCK_SKEW_MS = 10 * 60 * 1000;
const PRINT_AUTHORIZATION_TTL_MS = 2 * 60 * 1000;
const MAX_PRINT_AUTHORIZATIONS = 1000;
const ALLOWED_STATUSES = new Set(['RECEIVED', 'RETURNED', 'PENDING']);

function configuredPositiveInteger(name, fallback, minimum, maximum) {
    const value = Number(process.env[name]);
    return Number.isSafeInteger(value) && value >= minimum && value <= maximum ? value : fallback;
}

const MAX_ARCHIVE_FILES = configuredPositiveInteger('DELIVERY_LOG_ARCHIVE_MAX_FILES', 5000, 100, 100000);
const MAX_ARCHIVE_TOTAL_BYTES = configuredPositiveInteger(
    'DELIVERY_LOG_ARCHIVE_MAX_BYTES',
    1024 * 1024 * 1024,
    10 * 1024 * 1024,
    Number.MAX_SAFE_INTEGER
);
const printAuthorizations = new Map();
const activeStagedPaths = new Set();

function ensureArchiveDirectory() {
    fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
}

function sha256(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function stylesheetBytes() {
    return fs.readFileSync(ARCHIVE_STYLESHEET_PATH);
}

function stylesheetHash() {
    return sha256(stylesheetBytes());
}

function sanitizeArchiveId(id) {
    if (typeof id !== 'string') return '';
    return id.replace(/[^a-zA-Z0-9-_]/g, '');
}

function archivePath(id) {
    const safeId = sanitizeArchiveId(String(id || ''));
    if (!safeId || safeId !== String(id || '')) throw requestError('Invalid archive id.', 400, 'INVALID_ARCHIVE_ID');
    return path.join(ARCHIVE_DIR, safeId + ARCHIVE_EXT);
}

function requestError(message, status, code) {
    const error = new Error(message);
    error.status = status || 400;
    error.code = code || 'INVALID_REQUEST';
    return error;
}

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertAllowedKeys(value, allowed, label) {
    if (!isPlainObject(value)) throw requestError(label + ' must be an object.');
    const unexpected = Object.keys(value).filter(key => !allowed.includes(key));
    if (unexpected.length) throw requestError(label + ' contains unsupported fields: ' + unexpected.join(', ') + '.');
}

function boundedText(value, maxLength, label, options) {
    const settings = options || {};
    if (value === undefined || value === null) return settings.fallback || '';
    if (typeof value !== 'string') throw requestError(label + ' must be text.');
    const text = value.trim();
    if (text.length > maxLength) throw requestError(label + ' must not exceed ' + maxLength + ' characters.');
    if (/\u0000/.test(text) || (!settings.allowLineBreaks && /[\u0001-\u001f\u007f]/.test(text))) {
        throw requestError(label + ' contains unsupported control characters.');
    }
    return text || settings.fallback || '';
}

function truncateStoredText(value, maxLength, fallback) {
    return String(value === undefined || value === null ? (fallback || '') : value)
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .trim()
        .slice(0, maxLength);
}

function toPositiveInteger(value) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function archiveCreatedAtEpoch(record) {
    if (!record || typeof record !== 'object') return 0;
    const epoch = Number(record.createdAtEpoch);
    if (Number.isFinite(epoch) && epoch > 0) return epoch;
    const parsed = Date.parse(String(record.createdAt || ''));
    return Number.isFinite(parsed) ? parsed : 0;
}

function localParts(epoch, timezoneOffsetMinutes) {
    const shifted = new Date(epoch - (timezoneOffsetMinutes * 60 * 1000));
    return {
        year: shifted.getUTCFullYear(),
        month: shifted.getUTCMonth() + 1,
        day: shifted.getUTCDate(),
        hour: shifted.getUTCHours(),
        minute: shifted.getUTCMinutes(),
        second: shifted.getUTCSeconds()
    };
}

function pad2(value) {
    return String(value).padStart(2, '0');
}

function localDateToken(epoch, timezoneOffsetMinutes) {
    const parts = localParts(epoch, timezoneOffsetMinutes);
    return String(parts.year) + pad2(parts.month) + pad2(parts.day);
}

function formatLocalTimestamp(epoch, timezoneOffsetMinutes) {
    const parts = localParts(epoch, timezoneOffsetMinutes);
    let hour = parts.hour;
    const suffix = hour >= 12 ? 'PM' : 'AM';
    hour = hour % 12 || 12;
    return pad2(parts.month) + '/' + pad2(parts.day) + '/' + parts.year + ', ' +
        pad2(hour) + ':' + pad2(parts.minute) + ':' + pad2(parts.second) + ' ' + suffix;
}

function validateTimezoneName(value) {
    const timezoneName = boundedText(value, MAX_TIMEZONE_NAME_LENGTH, 'timezoneName');
    if (!timezoneName) return '';
    try {
        return new Intl.DateTimeFormat('en-US', { timeZone: timezoneName }).resolvedOptions().timeZone;
    } catch (_error) {
        throw requestError('timezoneName must be a valid IANA time zone.');
    }
}

function namedTimezoneParts(epoch, timezoneName) {
    if (!timezoneName) return null;
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezoneName,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23'
    });
    const values = {};
    formatter.formatToParts(new Date(epoch)).forEach(part => {
        if (part.type !== 'literal') values[part.type] = Number(part.value);
    });
    if (![values.year, values.month, values.day, values.hour, values.minute, values.second].every(Number.isFinite)) return null;
    return values;
}

function formatDatabaseDate(value, includeTime, timezoneName, timezoneOffsetMinutes) {
    if (!value) return '';
    if (!includeTime && /^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
        const parts = String(value).split('-');
        return parts[1] + '/' + parts[2] + '/' + parts[0];
    }
    const epoch = new Date(value).getTime();
    if (!Number.isFinite(epoch)) return '';
    const parts = namedTimezoneParts(epoch, timezoneName) || localParts(epoch, timezoneOffsetMinutes);
    const date = pad2(parts.month) + '/' + pad2(parts.day) + '/' + parts.year;
    if (!includeTime) return date;
    let hour = parts.hour;
    const suffix = hour >= 12 ? 'PM' : 'AM';
    hour = hour % 12 || 12;
    return date + ', ' + pad2(hour) + ':' + pad2(parts.minute) + ' ' + suffix;
}

function parseBrowserClock(body, prefix, now) {
    const epochKey = prefix + 'AtEpoch';
    const rawEpoch = Number(body[epochKey]);
    const offset = Number(body.timezoneOffsetMinutes);
    if (!Number.isSafeInteger(rawEpoch) || rawEpoch <= 0) {
        throw requestError(epochKey + ' must be a valid browser timestamp.');
    }
    if (Math.abs(rawEpoch - now) > MAX_CLOCK_SKEW_MS) {
        throw requestError('Browser timestamp differs from the server by more than 10 minutes.', 409, 'CLOCK_SKEW');
    }
    if (!Number.isInteger(offset) || offset < -840 || offset > 840) {
        throw requestError('timezoneOffsetMinutes must be an integer between -840 and 840.');
    }
    return { epoch: rawEpoch, offset, timezoneName: validateTimezoneName(body.timezoneName) };
}

function validateCreateRequest(body, now) {
    const serialized = JSON.stringify(body || {});
    if (Buffer.byteLength(serialized, 'utf8') > MAX_REQUEST_BYTES) {
        throw requestError('Delivery-log archive request is too large.', 413, 'REQUEST_TOO_LARGE');
    }
    assertAllowedKeys(body, [
        'rxRecordIds', 'drivers', 'generatedAtEpoch', 'timezoneOffsetMinutes', 'timezoneName',
        'requestId', 'period', 'filters', '_csrf'
    ], 'Delivery-log archive request');

    if (!Array.isArray(body.rxRecordIds) || !body.rxRecordIds.length) {
        throw requestError('rxRecordIds must contain at least one RX record.');
    }
    if (body.rxRecordIds.length > MAX_ROWS) {
        throw requestError('A delivery log cannot contain more than ' + MAX_ROWS + ' RX records.', 413, 'ROW_LIMIT');
    }
    const ids = body.rxRecordIds.map(toPositiveInteger);
    if (ids.some(id => !id)) throw requestError('rxRecordIds must contain only positive integer IDs.');
    if (new Set(ids).size !== ids.length) throw requestError('rxRecordIds must not contain duplicates.');

    const clock = parseBrowserClock(body, 'generated', now);
    const driverRows = body.drivers === undefined ? [] : body.drivers;
    if (!Array.isArray(driverRows) || driverRows.length > MAX_GROUPS) {
        throw requestError('drivers must be an array with no more than ' + MAX_GROUPS + ' entries.');
    }
    const drivers = new Map();
    driverRows.forEach((driverRow, index) => {
        assertAllowedKeys(driverRow, ['pharmacyId', 'driver'], 'drivers[' + index + ']');
        const pharmacyId = driverRow.pharmacyId === null ? 0 : toPositiveInteger(driverRow.pharmacyId);
        if (pharmacyId === null) throw requestError('drivers[' + index + '].pharmacyId must be a positive integer or null.');
        if (drivers.has(pharmacyId)) throw requestError('drivers contains a duplicate pharmacy entry.');
        drivers.set(pharmacyId, boundedText(driverRow.driver, MAX_DRIVER_LENGTH, 'drivers[' + index + '].driver'));
    });

    const requestId = boundedText(body.requestId, 80, 'requestId');
    if (requestId && !/^(?:[a-f0-9]{32,64}|[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$/i.test(requestId)) {
        throw requestError('requestId must be a UUID or a 32-64 character hexadecimal identifier.');
    }

    return {
        rxRecordIds: ids,
        drivers,
        generatedAtEpoch: clock.epoch,
        timezoneOffsetMinutes: clock.offset,
        timezoneName: clock.timezoneName,
        requestId,
        period: boundedText(body.period, MAX_PERIOD_LENGTH, 'period', { fallback: 'All dates' }),
        filters: boundedText(body.filters, MAX_FILTER_LENGTH, 'filters', { fallback: 'All visible RX records' })
    };
}

function validateReprintRequest(body, now) {
    const serialized = JSON.stringify(body || {});
    if (Buffer.byteLength(serialized, 'utf8') > 1024) throw requestError('Reprint request is too large.', 413, 'REQUEST_TOO_LARGE');
    assertAllowedKeys(body, ['reprintedAtEpoch', 'timezoneOffsetMinutes', 'timezoneName', '_csrf'], 'Reprint request');
    const clock = parseBrowserClock(body, 'reprinted', now);
    return {
        reprintedAtEpoch: clock.epoch,
        timezoneOffsetMinutes: clock.offset,
        timezoneName: clock.timezoneName,
        reprinted: formatLocalTimestamp(clock.epoch, clock.offset)
    };
}

function validatePurgeRequest(body) {
    assertAllowedKeys(body, ['olderThanDays', 'confirm', '_csrf'], 'Purge request');
    const olderThanDays = toPositiveInteger(body.olderThanDays);
    const confirm = boundedText(body.confirm, 40, 'confirm');
    if (confirm !== 'PURGE DELIVERY LOGS') throw requestError('Type "PURGE DELIVERY LOGS" to confirm this cleanup.');
    if (!olderThanDays || olderThanDays > 3650) throw requestError('olderThanDays is required and must be between 1 and 3650.');
    return { olderThanDays };
}

function findReceiptAction(actions) {
    const accepted = ['mark as received to print log', 'driver receipt obtained', 'rx delivered'];
    for (const name of accepted) {
        const match = actions.find(action => String(action.name || '').trim().toLowerCase() === name);
        if (match) return match;
    }
    return actions.find(action => {
        const name = String(action.name || '').toLowerCase();
        return name.includes('print log') && name.includes('received');
    }) || null;
}

function databaseRowToSnapshot(rx, receiptAction, timezoneName, timezoneOffsetMinutes) {
    const patient = rx.Patient || {};
    const trackings = Array.isArray(rx.RXWorkflowTrackings) ? rx.RXWorkflowTrackings : [];
    const receiptTracking = receiptAction ? trackings.find(tracking =>
        Number(tracking.workflowActionId) === Number(receiptAction.id)
    ) : null;
    const returnedToPharmacy = rx.deliveryOutcome === 'returned_to_pharmacy';
    const completionDate = returnedToPharmacy ? rx.deliveryOutcomeDate : (receiptTracking && receiptTracking.completionDate);
    const status = returnedToPharmacy ? 'RETURNED' : (completionDate ? 'RECEIVED' : 'PENDING');
    return {
        rxId: Number(rx.id),
        receivedDate: truncateStoredText(formatDatabaseDate(completionDate, false, timezoneName, timezoneOffsetMinutes), 40),
        receivedAt: truncateStoredText(formatDatabaseDate(completionDate, true, timezoneName, timezoneOffsetMinutes), 80),
        reference: 'RX-' + String(rx.id || '').padStart(6, '0'),
        patient: truncateStoredText([patient.firstName, patient.lastName].filter(Boolean).join(' '), 200),
        dob: truncateStoredText(formatDatabaseDate(patient.dob, false, timezoneName, timezoneOffsetMinutes), 40),
        status,
        notes: truncateStoredText(status === 'RETURNED'
            ? ('Package returned to pharmacy' + (rx.deliveryOutcomeNote ? ': ' + rx.deliveryOutcomeNote : ''))
            : (status === 'PENDING' ? 'Pending delivery receipt' : ''), 500)
    };
}

async function loadCanonicalGroups(input) {
    const actions = await db.WorkflowAction.findAll({
        attributes: ['id', 'name'],
        where: { isActive: true },
        raw: true
    });
    const activeActionIds = new Set(actions.map(action => Number(action.id)).filter(Number.isInteger));
    const receiptAction = findReceiptAction(actions);
    const records = await db.RXRecord.findAll({
        where: { id: { [db.Sequelize.Op.in]: input.rxRecordIds } },
        include: [
            { model: db.Patient, attributes: ['id', 'firstName', 'lastName', 'dob'] },
            { model: db.Pharmacy, attributes: ['id', 'name'] },
            { model: db.RXWorkflowTracking, attributes: ['workflowActionId', 'completionDate'] }
        ]
    });
    const byId = new Map(records.map(record => {
        const plain = record && typeof record.toJSON === 'function' ? record.toJSON() : record;
        return [Number(plain.id), plain];
    }));
    const ordered = input.rxRecordIds.map(id => byId.get(id));
    if (ordered.some(record => !record)) {
        throw requestError('One or more RX records no longer exist.', 409, 'RX_SET_CHANGED');
    }

    const grouped = new Map();
    ordered.forEach(rx => {
        if (rx.isDeleted === true) throw requestError('A selected RX record was deleted before printing.', 409, 'RX_SET_CHANGED');
        const completedActiveIds = new Set((rx.RXWorkflowTrackings || [])
            .map(tracking => Number(tracking.workflowActionId))
            .filter(actionId => activeActionIds.has(actionId)));
        if (activeActionIds.size > 0 && completedActiveIds.size >= activeActionIds.size) {
            throw requestError('A selected RX workflow closed before printing. Refresh the report and try again.', 409, 'RX_SET_CHANGED');
        }
        const pharmacyId = rx.Pharmacy && toPositiveInteger(rx.Pharmacy.id) || 0;
        if (!grouped.has(pharmacyId)) {
            grouped.set(pharmacyId, {
                pharmacyId: pharmacyId || null,
                pharmacy: truncateStoredText(rx.Pharmacy && rx.Pharmacy.name, 200, 'Unassigned Pharmacy') || 'Unassigned Pharmacy',
                driver: input.drivers.get(pharmacyId) || '',
                rows: []
            });
        }
        grouped.get(pharmacyId).rows.push(databaseRowToSnapshot(
            rx,
            receiptAction,
            input.timezoneName,
            input.timezoneOffsetMinutes
        ));
    });

    const groups = Array.from(grouped.values()).sort((a, b) => a.pharmacy.localeCompare(b.pharmacy));
    if (groups.length > MAX_GROUPS) throw requestError('The selected RX records span too many pharmacies.', 413, 'GROUP_LIMIT');
    const actualPharmacyIds = new Set(groups.map(group => Number(group.pharmacyId || 0)));
    for (const pharmacyId of input.drivers.keys()) {
        if (!actualPharmacyIds.has(pharmacyId)) throw requestError('A driver entry does not match the selected RX records.');
    }
    return groups;
}

function reportCounts(rows) {
    return {
        received: rows.filter(row => row.status === 'RECEIVED').length,
        returned: rows.filter(row => row.status === 'RETURNED').length,
        pending: rows.filter(row => row.status === 'PENDING').length
    };
}

function canonicalReportContext(groups) {
    const rows = groups.flatMap(group => group.rows);
    const dates = rows.map(row => {
        const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(row.receivedDate || ''));
        if (!match) return null;
        return {
            label: match[1] + '/' + match[2] + '/' + match[3],
            key: Number(match[3] + match[1] + match[2])
        };
    }).filter(Boolean).sort((a, b) => a.key - b.key);
    const counts = reportCounts(rows);
    const period = dates.length === 0
        ? 'No completed delivery dates'
        : (dates[0].key === dates[dates.length - 1].key
            ? dates[0].label
            : dates[0].label + ' - ' + dates[dates.length - 1].label);
    const filters = rows.length + ' server-verified open RX record' + (rows.length === 1 ? '' : 's') +
        ' across ' + groups.length + ' pharmac' + (groups.length === 1 ? 'y' : 'ies') +
        ' (received ' + counts.received + ', returned ' + counts.returned + ', pending ' + counts.pending + ')';
    return { period, filters };
}

function cleanUser(user) {
    return {
        id: user && toPositiveInteger(user.id),
        username: truncateStoredText(user && user.username, 100),
        firstName: truncateStoredText(user && user.firstName, 100),
        lastName: truncateStoredText(user && user.lastName, 100)
    };
}

function requestArchiveId(input, user) {
    if (!input.requestId) return '';
    const userId = user && toPositiveInteger(user.id) || 0;
    return sha256(Buffer.from(String(userId) + ':' + input.requestId, 'utf8')).slice(0, 40);
}

function requestFingerprint(input, user) {
    if (!input.requestId) return null;
    return sha256(Buffer.from(JSON.stringify({
        requestId: input.requestId,
        userId: user && toPositiveInteger(user.id) || 0,
        rxRecordIds: input.rxRecordIds,
        generatedAtEpoch: input.generatedAtEpoch
    }), 'utf8'));
}

function integrityMaterial(record) {
    return {
        formatVersion: record.formatVersion,
        rendererVersion: record.rendererVersion,
        stylesheetHash: record.stylesheetHash,
        id: record.id,
        reference: record.reference,
        generated: record.generated,
        generatedAtEpoch: record.generatedAtEpoch,
        timezoneOffsetMinutes: record.timezoneOffsetMinutes,
        timezoneName: record.timezoneName,
        requestFingerprint: record.requestFingerprint,
        period: record.period,
        filters: record.filters,
        counts: record.counts,
        total: record.total,
        createdBy: record.createdBy,
        createdAt: record.createdAt,
        createdAtEpoch: record.createdAtEpoch,
        pharmacyGroups: record.pharmacyGroups
    };
}

function hashRecord(record) {
    return sha256(Buffer.from(JSON.stringify(integrityMaterial(record)), 'utf8'));
}

function hashArtifact(documentHtml, cssBytes) {
    return sha256(Buffer.concat([
        Buffer.from(String(documentHtml || ''), 'utf8'),
        Buffer.from('\n--RX-ARCHIVE-STYLESHEET--\n', 'utf8'),
        cssBytes
    ]));
}

function buildArchiveRecord(input, groups, user, options) {
    const settings = options || {};
    const idSource = settings.id || (input.requestId
        ? requestArchiveId(input, user)
        : (crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex')));
    const id = sanitizeArchiveId(String(idSource));
    if (!id) throw new Error('Could not generate a delivery-log archive id.');
    const now = Number(settings.now || Date.now());
    const allRows = groups.flatMap(group => group.rows);
    const context = canonicalReportContext(groups);
    const uniqueToken = id.toUpperCase();
    const cssBytes = stylesheetBytes();
    const record = {
        formatVersion: FORMAT_VERSION,
        rendererVersion: RENDERER_VERSION,
        stylesheetHash: sha256(cssBytes),
        id,
        reference: 'LOG-' + localDateToken(input.generatedAtEpoch, input.timezoneOffsetMinutes) + '-' + uniqueToken,
        generated: formatLocalTimestamp(input.generatedAtEpoch, input.timezoneOffsetMinutes),
        generatedAtEpoch: input.generatedAtEpoch,
        timezoneOffsetMinutes: input.timezoneOffsetMinutes,
        timezoneName: input.timezoneName || '',
        requestFingerprint: requestFingerprint(input, user),
        period: context.period,
        filters: context.filters,
        counts: reportCounts(allRows),
        total: allRows.length,
        createdBy: cleanUser(user),
        createdAt: new Date(now).toISOString(),
        createdAtEpoch: now,
        pharmacyGroups: groups
    };
    record.contentHash = hashRecord(record);
    record.verification = 'SHA256-' + record.contentHash;
    record.documentHtml = renderArchiveHtml(record);
    record.artifactHash = hashArtifact(record.documentHtml, cssBytes);
    return record;
}

function assertRecordIntegrity(record) {
    if (!record || record.formatVersion !== FORMAT_VERSION || !/^[a-f0-9]{64}$/.test(String(record.contentHash || ''))) {
        throw requestError('Archive format is not supported.', 409, 'ARCHIVE_FORMAT_UNSUPPORTED');
    }
    if (record.rendererVersion !== RENDERER_VERSION || !/^[a-f0-9]{64}$/.test(String(record.stylesheetHash || '')) ||
        !/^[a-f0-9]{64}$/.test(String(record.artifactHash || '')) || typeof record.documentHtml !== 'string') {
        throw requestError('Archive renderer evidence is incomplete.', 409, 'ARCHIVE_FORMAT_UNSUPPORTED');
    }
    const actual = hashRecord(record);
    const expectedBuffer = Buffer.from(record.contentHash, 'utf8');
    const actualBuffer = Buffer.from(actual, 'utf8');
    if (expectedBuffer.length !== actualBuffer.length || !crypto.timingSafeEqual(expectedBuffer, actualBuffer)) {
        throw requestError('Archive integrity verification failed.', 409, 'ARCHIVE_INTEGRITY_FAILED');
    }
    if (record.verification !== 'SHA256-' + record.contentHash) {
        throw requestError('Archive verification label does not match its content hash.', 409, 'ARCHIVE_INTEGRITY_FAILED');
    }
    const currentStylesheet = stylesheetBytes();
    if (sha256(currentStylesheet) !== record.stylesheetHash) {
        throw requestError('The frozen archive stylesheet no longer matches this controlled copy.', 409, 'ARCHIVE_RENDERER_CHANGED');
    }
    if (hashArtifact(record.documentHtml, currentStylesheet) !== record.artifactHash ||
        renderArchiveHtml(record) !== record.documentHtml) {
        throw requestError('The archived printable artifact no longer matches its canonical record.', 409, 'ARCHIVE_INTEGRITY_FAILED');
    }
    if (!Array.isArray(record.pharmacyGroups) || record.pharmacyGroups.length > MAX_GROUPS ||
        record.pharmacyGroups.reduce((sum, group) => sum + (Array.isArray(group.rows) ? group.rows.length : MAX_ROWS + 1), 0) > MAX_ROWS) {
        throw requestError('Archive structure exceeds supported limits.', 409, 'ARCHIVE_FORMAT_UNSUPPORTED');
    }
    return record;
}

function normalizeLegacyRecord(record) {
    const rawGroups = Array.isArray(record && record.pharmacyGroups) ? record.pharmacyGroups.slice(0, MAX_GROUPS) : [];
    const groups = [];
    let rowCount = 0;
    for (const rawGroup of rawGroups) {
        if (!isPlainObject(rawGroup) || !Array.isArray(rawGroup.rows)) continue;
        const rows = [];
        for (const rawRow of rawGroup.rows) {
            if (rowCount >= MAX_ROWS || !isPlainObject(rawRow)) break;
            const status = ALLOWED_STATUSES.has(String(rawRow.status || '').toUpperCase())
                ? String(rawRow.status).toUpperCase()
                : 'PENDING';
            rows.push({
                rxId: toPositiveInteger(rawRow.rxId || String(rawRow.reference || '').replace(/\D/g, '')),
                receivedDate: truncateStoredText(rawRow.receivedDate, 40),
                receivedAt: truncateStoredText(rawRow.receivedAt, 80),
                reference: truncateStoredText(rawRow.reference, 40),
                patient: truncateStoredText(rawRow.patient, 200),
                dob: truncateStoredText(rawRow.dob, 40),
                status,
                notes: truncateStoredText(rawRow.notes, 500)
            });
            rowCount += 1;
        }
        if (rows.length) {
            groups.push({
                pharmacyId: toPositiveInteger(rawGroup.pharmacyId),
                pharmacy: truncateStoredText(rawGroup.pharmacy, 200, 'Unassigned Pharmacy') || 'Unassigned Pharmacy',
                driver: truncateStoredText(rawGroup.driver, MAX_DRIVER_LENGTH),
                rows
            });
        }
    }
    if (!groups.length) throw requestError('Legacy archive has no validated printable rows.', 409, 'LEGACY_ARCHIVE_NOT_PRINTABLE');
    const safe = {
        formatVersion: 1,
        id: sanitizeArchiveId(String(record.id || 'legacy')) || 'legacy',
        reference: truncateStoredText(record.reference, 100, 'Legacy Delivery Log'),
        generated: truncateStoredText(record.generated, 100),
        period: truncateStoredText(record.period, MAX_PERIOD_LENGTH, 'All dates'),
        filters: truncateStoredText(record.filters, MAX_FILTER_LENGTH, 'All visible RX records'),
        total: rowCount,
        counts: reportCounts(groups.flatMap(group => group.rows)),
        createdAt: truncateStoredText(record.createdAt, 100),
        createdAtEpoch: archiveCreatedAtEpoch(record),
        pharmacyGroups: groups
    };
    safe.contentHash = crypto.createHash('sha256').update(JSON.stringify(safe), 'utf8').digest('hex');
    safe.verification = 'LEGACY-SHA256-' + safe.contentHash;
    return safe;
}

async function readArchive(id) {
    const filePath = archivePath(id);
    const stat = await fs.promises.stat(filePath);
    if (stat.size > MAX_ARCHIVE_BYTES) throw requestError('Archive file exceeds the supported size.', 409, 'ARCHIVE_FORMAT_UNSUPPORTED');
    const content = await fs.promises.readFile(filePath, 'utf8');
    const data = JSON.parse(content);
    if (data && data.formatVersion === FORMAT_VERSION) {
        const record = assertRecordIntegrity(data);
        if (record.id !== id) throw requestError('Archive filename does not match its signed record id.', 409, 'ARCHIVE_INTEGRITY_FAILED');
        return record;
    }
    const legacy = normalizeLegacyRecord(data);
    legacy.id = id;
    return legacy;
}

function escapeHtml(value) {
    return String(value === undefined || value === null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function paginateRows(rows) {
    const dataPageSize = 24;
    const signaturePageSize = 8;
    const remaining = rows.slice();
    const pages = [];
    if (remaining.length <= signaturePageSize) return [remaining];
    while (remaining.length > dataPageSize) pages.push(remaining.splice(0, dataPageSize));
    if (remaining.length > signaturePageSize) {
        pages.push(remaining);
        pages.push([]);
    } else {
        pages.push(remaining);
    }
    return pages;
}

function metricCards(rows) {
    const counts = reportCounts(rows);
    return '<section class="metrics">' +
        '<div class="metric metric-total"><i>T</i><span>Total Records</span><strong>' + rows.length + '</strong></div>' +
        '<div class="metric metric-received"><i>R</i><span>Received</span><strong>' + counts.received + '</strong></div>' +
        '<div class="metric metric-returned"><i>X</i><span>Returned</span><strong>' + counts.returned + '</strong></div>' +
        '<div class="metric metric-pending"><i>P</i><span>Pending</span><strong>' + counts.pending + '</strong></div>' +
        '</section>';
}

function tableRows(rows) {
    return rows.map(row => '<tr>' +
        '<td>' + escapeHtml(row.receivedDate || '-') + '</td>' +
        '<td class="patient">' + escapeHtml(row.patient) + '</td>' +
        '<td>' + escapeHtml(row.dob) + '</td>' +
        '<td>' + escapeHtml(row.notes) + '</td>' +
        '</tr>').join('');
}

function logTable(rows, heading, returnedSection) {
    if (!rows.length) return '';
    return (heading ? '<h2 class="log-section-title ' + (returnedSection ? 'returned-section-title' : '') + '">' + escapeHtml(heading) + '</h2>' : '') +
        '<table class="log-table ' + (returnedSection ? 'returned-log-table' : '') + '">' +
        '<thead><tr><th>Date</th><th>Patient Full Name</th><th>DOB</th><th>Notes</th></tr></thead>' +
        '<tbody>' + tableRows(rows) + '</tbody></table>';
}

function signatures() {
    return '<div class="signature-stack"><section class="signature signature-prepared">' +
        '<h2>Chain of Custody &amp; Acknowledgment</h2><div class="signature-grid three">' +
        '<label>Prepared By (Print Name)<b></b></label><label>Prepared By Signature<b></b></label>' +
        '<label>Released Date / Time<b></b></label></div></section>' +
        '<section class="signature signature-received"><h2>Receipt Acknowledgment</h2>' +
        '<div class="signature-grid three"><label>Received By (Print Name)<b></b></label>' +
        '<label>Recipient Signature<b></b></label><label>Date / Time Received<b></b></label></div>' +
        '<div class="signature-grid two"><label>Pharmacy Representative Signature<b></b></label>' +
        '<label>Exception Reference / Notes<b></b></label></div>' +
        '<div class="checks">&#9744; Complete &nbsp;&nbsp;&nbsp; &#9744; Partial &nbsp;&nbsp;&nbsp; &#9744; Returned Items Attached</div>' +
        '</section></div>';
}

function reportPage(pageRows, pageIndex, pageCount, group, metadata) {
    const isFirst = pageIndex === 0;
    const isLast = pageIndex === pageCount - 1;
    const pendingRows = pageRows.filter(row => row.status !== 'RETURNED');
    const returnedRows = pageRows.filter(row => row.status === 'RETURNED');
    return '<article class="report-page">' +
        '<div class="company-masthead">RB &amp; DC SOLUTIONS LLC - ORIGINAL RECEIPTS DELIVERY LOG</div>' +
        '<header class="report-header"><div class="title-block"><h1>Print &amp; Delivery Log</h1>' +
        '<div class="driver-header">Driver: <span class="driver-header-value">' + escapeHtml(group.driver || '') + '</span></div></div>' +
        '<dl><dt>Report Reference:</dt><dd>' + escapeHtml(metadata.reference) + '</dd>' +
        '<dt>Reporting Period:</dt><dd>' + escapeHtml(metadata.period) + '</dd>' +
        '<dt>Generated:</dt><dd>' + escapeHtml(metadata.generated) + '</dd>' +
        '<dt>Pharmacy:</dt><dd class="pharmacy-name">' + escapeHtml(group.pharmacy) + '</dd></dl></header>' +
        (isFirst ? metricCards(group.rows) : (pageRows.length ? '<div class="continuation"><span>CONTINUATION</span></div>' : '')) +
        logTable(pendingRows, returnedRows.length ? 'Delivery / Receipt Packages' : '', false) +
        logTable(returnedRows, 'Returned Packages to Pharmacy - Patient Not Accepted', true) +
        (isLast ? signatures() : '') +
        '<div class="audit-strip"><span>Export Format: PDF</span><span>Verification: ' + escapeHtml(metadata.verification) + '</span></div>' +
        '<footer class="report-footer"><span>' + escapeHtml(metadata.reference) + ' &bull; Controlled Copy</span>' +
        '<span>Confidential - Handle per pharmacy policy</span><span>Page ' + (pageIndex + 1) + ' of ' + pageCount + '</span></footer>' +
        '</article>';
}

function renderArchiveHtml(record) {
    let pages = '';
    record.pharmacyGroups.forEach((group, groupIndex) => {
        const rows = group.rows.filter(row => row.status !== 'RETURNED')
            .concat(group.rows.filter(row => row.status === 'RETURNED'));
        const paginated = paginateRows(rows);
        const metadata = {
            reference: record.reference + '-P' + String(groupIndex + 1).padStart(2, '0'),
            verification: record.verification,
            generated: record.generated,
            period: record.period
        };
        const pageGroup = { ...group, rows };
        paginated.forEach((pageRows, pageIndex) => {
            pages += reportPage(pageRows, pageIndex, paginated.length, pageGroup, metadata);
        });
    });
    return '<!doctype html><html><head><meta charset="UTF-8"><title>' + escapeHtml(record.reference) +
        '</title><link rel="stylesheet" href="/css/rx-delivery-log-archive-v2.css"></head><body class="delivery-log-archive">' + pages +
        '<div class="report-actions"><button id="printReportBtn" type="button">Print / Save PDF</button>' +
        '<button id="closeReportBtn" class="report-close-btn" type="button">Close</button></div></body></html>';
}

function summary(record) {
    return {
        id: record.id,
        reference: record.reference,
        verification: record.verification,
        artifactHash: record.artifactHash || null,
        total: record.total || 0,
        counts: record.counts || {},
        createdAt: record.createdAt || null,
        createdAtEpoch: archiveCreatedAtEpoch(record),
        generated: record.generated || '',
        filters: record.filters || '',
        period: record.period || '',
        formatVersion: record.formatVersion || 1
    };
}

function prunePrintAuthorizations(now) {
    for (const [token, authorization] of printAuthorizations) {
        if (!authorization || authorization.expiresAt <= now) printAuthorizations.delete(token);
    }
    while (printAuthorizations.size >= MAX_PRINT_AUTHORIZATIONS) {
        const oldest = printAuthorizations.keys().next().value;
        if (!oldest) break;
        printAuthorizations.delete(oldest);
    }
}

function issuePrintAuthorization(req, record) {
    const now = Date.now();
    prunePrintAuthorizations(now);
    const token = crypto.randomBytes(32).toString('hex');
    printAuthorizations.set(token, {
        archiveId: record.id,
        userId: req.user && toPositiveInteger(req.user.id) || 0,
        expiresAt: now + PRINT_AUTHORIZATION_TTL_MS
    });
    return '/api/reports/delivery-log-archives/' + encodeURIComponent(record.id) + '/print?printToken=' + token;
}

function consumePrintAuthorization(req, archiveId) {
    const token = String(req && req.query && req.query.printToken || '');
    if (!/^[a-f0-9]{64}$/.test(token)) {
        throw requestError('A fresh audited print authorization is required.', 403, 'PRINT_AUTHORIZATION_REQUIRED');
    }
    const now = Date.now();
    prunePrintAuthorizations(now);
    const authorization = printAuthorizations.get(token);
    printAuthorizations.delete(token);
    const userId = req.user && toPositiveInteger(req.user.id) || 0;
    if (!authorization || authorization.expiresAt <= now || authorization.archiveId !== archiveId || authorization.userId !== userId) {
        throw requestError('Print authorization is invalid or expired.', 403, 'PRINT_AUTHORIZATION_INVALID');
    }
}

function serverLocalAuditParts(date) {
    return {
        date: date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate()),
        time: pad2(date.getHours()) + ':' + pad2(date.getMinutes()) + ':' + pad2(date.getSeconds())
    };
}

async function writeAudit(req, action, record, extra) {
    const now = new Date();
    const local = serverLocalAuditParts(now);
    const details = {
        _label: record && record.reference ? 'Delivery Log ' + record.reference : 'Delivery Log Archives',
        operation: action,
        archiveId: record && record.id || null,
        reference: record && record.reference || null,
        verification: record && record.verification || null,
        total: record && Number(record.total || 0) || 0,
        groupCount: record && Array.isArray(record.pharmacyGroups) ? record.pharmacyGroups.length : 0,
        ...(extra || {})
    };
    await db.AuditLog.create({
        userId: req.user && req.user.id || null,
        date: local.date,
        time: local.time,
        module: 'Delivery Log Archive',
        action,
        recordId: null,
        previousValue: null,
        newValue: details,
        ipAddress: req.ip || (req.socket && req.socket.remoteAddress) || 'unknown'
    });
}

function sendControllerError(res, error, fallback) {
    const notFound = Boolean(error && error.code === 'ENOENT');
    const status = Number(error && error.status) || (notFound ? 404 : 500);
    if (status >= 500) console.error('[Delivery Log Archive]', error && error.message || error);
    return res.status(status).json({
        error: notFound ? 'Archive not found.' : (status >= 500 ? fallback : error.message),
        code: notFound ? 'ARCHIVE_NOT_FOUND' : (error && error.code || 'ARCHIVE_ERROR')
    });
}

async function recoverStagedArchives() {
    ensureArchiveDirectory();
    const files = await fs.promises.readdir(ARCHIVE_DIR);
    const now = Date.now();
    for (const file of files) {
        const stagedPath = path.join(ARCHIVE_DIR, file);
        if (activeStagedPaths.has(stagedPath)) continue;
        if (file.includes(ARCHIVE_EXT + '.tmp-')) {
            try {
                const stat = await fs.promises.stat(stagedPath);
                if (now - stat.mtimeMs >= 10 * 60 * 1000) await fs.promises.unlink(stagedPath);
            } catch (error) {
                if (error.code !== 'ENOENT') console.warn('[Delivery Log Archive] Could not remove stale create staging file:', error.message);
            }
            continue;
        }
        const deletingMarker = ARCHIVE_EXT + '.deleting-';
        const markerIndex = file.indexOf(deletingMarker);
        if (markerIndex <= 0) continue;
        const originalName = file.slice(0, markerIndex + ARCHIVE_EXT.length);
        const originalPath = path.join(ARCHIVE_DIR, originalName);
        try {
            if (!fs.existsSync(originalPath)) {
                await fs.promises.rename(stagedPath, originalPath);
            } else {
                const recoveredName = 'recovered-' + crypto.randomBytes(12).toString('hex') + ARCHIVE_EXT;
                await fs.promises.rename(stagedPath, path.join(ARCHIVE_DIR, recoveredName));
            }
            console.warn('[Delivery Log Archive] Recovered an interrupted archive cleanup operation.');
        } catch (error) {
            if (error.code !== 'ENOENT') throw requestError(
                'An interrupted archive cleanup could not be recovered. Resolve the archive folder before continuing.',
                503,
                'ARCHIVE_RECOVERY_REQUIRED'
            );
        }
    }
}

async function archiveStorageUsage() {
    const files = await fs.promises.readdir(ARCHIVE_DIR);
    let archiveCount = 0;
    let totalBytes = 0;
    for (const file of files) {
        try {
            const stat = await fs.promises.stat(path.join(ARCHIVE_DIR, file));
            if (!stat.isFile()) continue;
            totalBytes += stat.size;
            if (file.endsWith(ARCHIVE_EXT)) archiveCount += 1;
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
    }
    return { archiveCount, totalBytes };
}

async function assertArchiveCapacity(recordBytes, existingRecord) {
    const usage = await archiveStorageUsage();
    const nextCount = usage.archiveCount + (existingRecord ? 0 : 1);
    const nextBytes = usage.totalBytes + Number(recordBytes || 0);
    if (nextCount > MAX_ARCHIVE_FILES || nextBytes > MAX_ARCHIVE_TOTAL_BYTES) {
        throw requestError(
            'Delivery-log archive capacity is reached. Use Backoffice archive cleanup before printing another log.',
            507,
            'ARCHIVE_CAPACITY_REACHED'
        );
    }
}

exports.create = async (req, res) => {
    let filePath;
    let stagedPath;
    try {
        const input = validateCreateRequest(req && req.body, Date.now());
        await recoverStagedArchives();
        if (input.requestId) {
            const existingId = requestArchiveId(input, req.user);
            try {
                const existing = await readArchive(existingId);
                if (existing.requestFingerprint !== requestFingerprint(input, req.user)) {
                    throw requestError('requestId was already used for a different delivery log.', 409, 'REQUEST_ID_CONFLICT');
                }
                await writeAudit(req, 'Create Print Reauthorized', existing, {
                    artifactHash: existing.artifactHash,
                    rendererVersion: existing.rendererVersion,
                    reason: 'idempotent_create_retry'
                });
                return res.status(200).json({
                    ...summary(existing),
                    idempotentReplay: true,
                    printUrl: issuePrintAuthorization(req, existing)
                });
            } catch (error) {
                if (error.code !== 'ENOENT') throw error;
            }
        }
        const groups = await loadCanonicalGroups(input);
        const record = buildArchiveRecord(input, groups, req.user);
        const serializedRecord = JSON.stringify(record, null, 2);
        const recordBytes = Buffer.byteLength(serializedRecord, 'utf8');
        if (recordBytes > MAX_ARCHIVE_BYTES) {
            throw requestError('Delivery-log archive exceeds the supported size.', 413, 'ARCHIVE_TOO_LARGE');
        }
        await assertArchiveCapacity(recordBytes, false);
        filePath = archivePath(record.id);
        stagedPath = filePath + '.tmp-' + sanitizeArchiveId(crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));
        activeStagedPaths.add(stagedPath);
        await fs.promises.writeFile(stagedPath, serializedRecord, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
        await writeAudit(req, 'Create Prepared', record, {
            generated: record.generated,
            artifactHash: record.artifactHash,
            rendererVersion: record.rendererVersion
        });
        await fs.promises.rename(stagedPath, filePath);
        activeStagedPaths.delete(stagedPath);
        stagedPath = null;
        try {
            await writeAudit(req, 'Create for Print', record, {
                generated: record.generated,
                artifactHash: record.artifactHash,
                rendererVersion: record.rendererVersion
            });
        } catch (auditError) {
            await fs.promises.unlink(filePath).catch(() => {});
            throw auditError;
        }
        return res.status(201).json({ ...summary(record), printUrl: issuePrintAuthorization(req, record) });
    } catch (error) {
        if (stagedPath) {
            activeStagedPaths.delete(stagedPath);
            await fs.promises.unlink(stagedPath).catch(() => {});
        }
        return sendControllerError(res, error, 'Failed to save delivery-log archive.');
    }
};

exports.list = async (_req, res) => {
    try {
        await recoverStagedArchives();
        const files = await fs.promises.readdir(ARCHIVE_DIR);
        const records = [];
        for (const file of files) {
            if (!file.endsWith(ARCHIVE_EXT)) continue;
            const id = sanitizeArchiveId(file.slice(0, -ARCHIVE_EXT.length));
            try {
                records.push(summary(await readArchive(id)));
            } catch (_error) {
                records.push({ id, reference: '(corrupt or unsupported record)', verification: 'unavailable', total: 0, createdAt: null });
            }
        }
        records.sort((a, b) => Number(b.createdAtEpoch || 0) - Number(a.createdAtEpoch || 0));
        return res.json(records);
    } catch (error) {
        return sendControllerError(res, error, 'Failed to list delivery-log archives.');
    }
};

exports.get = async (req, res) => {
    try {
        await recoverStagedArchives();
        return res.json(summary(await readArchive(req.params.id)));
    } catch (error) {
        return sendControllerError(res, error, error && error.code === 'ENOENT' ? 'Archive not found.' : 'Failed to load delivery-log archive.');
    }
};

exports.print = async (req, res) => {
    try {
        await recoverStagedArchives();
        consumePrintAuthorization(req, req.params.id);
        const record = await readArchive(req.params.id);
        res.set({
            'Content-Type': 'text/html; charset=utf-8',
            'Content-Disposition': 'inline; filename="delivery-log-' + sanitizeArchiveId(req.params.id) + '.html"',
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy': "default-src 'none'; style-src 'self'; img-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'"
        });
        return res.send(record.formatVersion === FORMAT_VERSION ? record.documentHtml : renderArchiveHtml(record));
    } catch (error) {
        return sendControllerError(res, error, error && error.code === 'ENOENT' ? 'Archive not found.' : 'Failed to open delivery-log archive.');
    }
};

exports.reprint = async (req, res) => {
    try {
        const input = validateReprintRequest(req && req.body, Date.now());
        await recoverStagedArchives();
        const record = await readArchive(req.params.id);
        await writeAudit(req, 'Reprint', record, {
            reprinted: input.reprinted,
            reprintedAtEpoch: input.reprintedAtEpoch,
            timezoneOffsetMinutes: input.timezoneOffsetMinutes,
            timezoneName: input.timezoneName,
            artifactHash: record.artifactHash || null
        });
        return res.json({
            ...summary(record),
            reprinted: input.reprinted,
            printUrl: issuePrintAuthorization(req, record)
        });
    } catch (error) {
        return sendControllerError(res, error, error && error.code === 'ENOENT' ? 'Archive not found.' : 'Failed to audit delivery-log reprint.');
    }
};

exports.delete = async (req, res) => {
    let originalPath;
    let stagedPath;
    let record;
    try {
        await recoverStagedArchives();
        originalPath = archivePath(req.params.id);
        try {
            record = await readArchive(req.params.id);
        } catch (readError) {
            if (readError.code === 'ENOENT') throw readError;
            record = { id: sanitizeArchiveId(String(req.params.id || '')), reference: '(corrupt archive)', verification: null, total: 0, pharmacyGroups: [] };
        }
        await writeAudit(req, 'Delete Requested', record);
        stagedPath = originalPath + '.deleting-' + sanitizeArchiveId(crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));
        await fs.promises.rename(originalPath, stagedPath);
        activeStagedPaths.add(stagedPath);
        try {
            await fs.promises.unlink(stagedPath);
        } catch (unlinkError) {
            await fs.promises.rename(stagedPath, originalPath).catch(() => {});
            await writeAudit(req, 'Delete Failed', record, { reason: 'archive_file_unlink_failed' }).catch(() => {});
            throw unlinkError;
        } finally {
            activeStagedPaths.delete(stagedPath);
        }
        await writeAudit(req, 'Delete Completed', record);
        return res.json({ success: true, id: record.id, message: 'Delivery-log archive deleted.' });
    } catch (error) {
        return sendControllerError(res, error, error && error.code === 'ENOENT' ? 'Archive not found.' : 'Failed to delete delivery-log archive.');
    }
};

exports.purge = async (req, res) => {
    try {
        const { olderThanDays } = validatePurgeRequest(req && req.body);

        const cutoff = Date.now() - (olderThanDays * 24 * 60 * 60 * 1000);
        await recoverStagedArchives();
        const files = await fs.promises.readdir(ARCHIVE_DIR);
        let inspected = 0;
        let skipped = 0;
        const candidates = [];
        for (const file of files) {
            if (!file.endsWith(ARCHIVE_EXT)) continue;
            inspected += 1;
            const id = sanitizeArchiveId(file.slice(0, -ARCHIVE_EXT.length));
            try {
                const record = await readArchive(id);
                if (!archiveCreatedAtEpoch(record) || archiveCreatedAtEpoch(record) > cutoff) continue;
                candidates.push({ originalPath: archivePath(id), record });
            } catch (_error) {
                skipped += 1;
            }
        }
        await writeAudit(req, 'Purge Requested', null, {
            candidateCount: candidates.length,
            inspected,
            skipped,
            olderThanDays
        });
        let deleted = 0;
        let failed = 0;
        for (const candidate of candidates) {
            const stagedPath = candidate.originalPath + '.deleting-' + sanitizeArchiveId(
                crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + '-' + deleted
            );
            try {
                await fs.promises.rename(candidate.originalPath, stagedPath);
                activeStagedPaths.add(stagedPath);
                await fs.promises.unlink(stagedPath);
                deleted += 1;
            } catch (_error) {
                failed += 1;
                await fs.promises.rename(stagedPath, candidate.originalPath).catch(() => {});
            } finally {
                activeStagedPaths.delete(stagedPath);
            }
        }
        await writeAudit(req, 'Purge Completed', null, {
            deleted,
            failed,
            inspected,
            skipped,
            olderThanDays
        });
        if (failed > 0) {
            throw requestError('Some delivery-log archives could not be removed and were restored for retry.', 503, 'ARCHIVE_PURGE_PARTIAL');
        }
        return res.json({ success: true, deleted, inspected, skipped, olderThanDays });
    } catch (error) {
        return sendControllerError(res, error, 'Failed to purge delivery-log archives.');
    }
};

exports._test = {
    MAX_ROWS,
    validateCreateRequest,
    validateReprintRequest,
    validatePurgeRequest,
    buildArchiveRecord,
    assertRecordIntegrity,
    normalizeLegacyRecord,
    renderArchiveHtml,
    hashRecord,
    formatDatabaseDate,
    formatLocalTimestamp,
    localDateToken,
    requestArchiveId
};
