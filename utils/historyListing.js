'use strict';

function invalid(message) {
    return Object.assign(new Error(message), { status: 400 });
}

function parseHistoryQuery(query = {}) {
    function integer(name, fallback, max) {
        if (query[name] === undefined) return fallback;
        if (typeof query[name] !== 'string' || !/^[1-9]\d*$/.test(query[name])) throw invalid('Invalid ' + name + '.');
        const value = Number(query[name]);
        if (!Number.isSafeInteger(value) || value > max) throw invalid('Invalid ' + name + '.');
        return value;
    }
    function timestamp(name) {
        if (!query[name]) return null;
        if (typeof query[name] !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(query[name])) {
            throw invalid('Invalid date range.');
        }
        const date = new Date(query[name]);
        if (!Number.isFinite(date.getTime()) || date.toISOString() !== query[name]) throw invalid('Invalid date range.');
        return date;
    }
    const start = timestamp('start'), end = timestamp('end');
    if (start && end && start >= end) throw invalid('From date must be on or before To date.');
    if (query.search !== undefined && (typeof query.search !== 'string' || query.search.length > 200)) throw invalid('Search must be at most 200 characters.');
    const pageSize = integer('pageSize', 20, 100);
    if (![20, 50, 100].includes(pageSize)) throw invalid('Page size must be 20, 50, or 100.');
    return { page: integer('page', 1, 1000000), pageSize, start, end, search: (query.search || '').trim() };
}

function csvLine(values) {
    return values.map(value => {
        let text = String(value ?? '');
        if (/^[\s]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
        return '"' + text.replace(/"/g, '""') + '"';
    }).join(',') + '\r\n';
}

function csvHeaders(res, filename) {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
    res.setHeader('Cache-Control', 'no-store');
}

// Respect backpressure and stop work when the download is cancelled.
async function writeCsv(res, text) {
    if (res.destroyed) return false;
    if (res.write(text)) return true;
    return new Promise((resolve, reject) => {
        const clean = () => { res.off('drain', drain); res.off('close', close); res.off('error', error); };
        const drain = () => { clean(); resolve(true); };
        const close = () => { clean(); resolve(false); };
        const error = err => { clean(); reject(err); };
        res.once('drain', drain); res.once('close', close); res.once('error', error);
    });
}

module.exports = { parseHistoryQuery, csvLine, csvHeaders, writeCsv };
