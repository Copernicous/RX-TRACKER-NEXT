'use strict';

// Experimental behavior is unavailable outside staging/development and defaults off.
function enabled(env = process.env) {
    return ['staging', 'development'].includes(env.APP_ENV) && env.IMPORT_REVIEW_V2 === 'true';
}
function sourceHash(row) {
    const fields = Object.keys(row).filter(key => !key.startsWith('_review') && key !== '_import_error').sort();
    return require('crypto').createHash('sha256').update(JSON.stringify(fields.map(key => [key, String(row[key] ?? '').trim()]))).digest('hex');
}
function repeatedRows(rows, patients, reports) {
    const current = new Map(patients.filter(p => p.updatedAt && !Number.isNaN(new Date(p.updatedAt).getTime())).map(p => [Number(p.id), new Date(p.updatedAt).toISOString()]));
    const previous = new Map();
    for (const report of reports) {
        const sourceRows = report.sourceRows || report.newValue?.sourceRows || [];
        if (!Array.isArray(sourceRows)) continue;
        for (const row of sourceRows) {
            if (row.updatedAt && current.has(Number(row.patientId)) && current.get(Number(row.patientId)) === row.updatedAt && !previous.has(row.hash)) previous.set(row.hash, { ...row, reportId: report.id });
        }
    }
    return rows.flatMap((row, i) => {
        // Related tags/workflow have independent timestamps. Keep their repeat uploads in normal review.
        const profileHeaders = new Set(['patientCode', 'firstName', 'lastName', 'dob', 'phone', 'address', 'addressLine1', 'city', 'state', 'zipCode', 'clinic', 'patientTransportCompany', 'pharmacyTransportCompany', 'notes', 'isActive', 'serviceDate']);
        if (Object.keys(row).some(key => !profileHeaders.has(key) && !key.startsWith('_review') && String(row[key] ?? '').trim())) return [];
        const match = previous.get(sourceHash(row));
        return match ? [{ row: i + 2, patientId: Number(match.patientId), reportId: match.reportId }] : [];
    });
}
module.exports = { enabled, sourceHash, repeatedRows };
