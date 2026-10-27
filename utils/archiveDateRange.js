'use strict';
function dateRange(records, field) {
    let first = Infinity, last = -Infinity;
    for (const row of records) {
        const value = row[field];
        if (value === null || value === undefined) continue;
        const time = new Date(value).getTime();
        if (!Number.isFinite(time)) continue;
        first = Math.min(first, time); last = Math.max(last, time);
    }
    return { dateFrom: first === Infinity ? null : new Date(first).toISOString(), dateTo: last === -Infinity ? null : new Date(last).toISOString() };
}
function filenameDateRange(range, timeZone) {
    const formatter = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    const day = value => {
        if (!value) return 'undated';
        const p = Object.fromEntries(formatter.formatToParts(new Date(value)).map(part => [part.type, part.value]));
        return `${p.year}-${p.month}-${p.day}`;
    };
    return `${day(range.dateFrom)}_to_${day(range.dateTo)}`;
}
module.exports = { dateRange, filenameDateRange };
