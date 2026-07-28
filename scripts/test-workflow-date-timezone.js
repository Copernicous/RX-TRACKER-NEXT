'use strict';

process.env.TZ = 'America/New_York';

const assert = require('assert');
const { parseLocalDateOnly, localDayBoundaryIso } = require('../utils/dateUtils');

const selected = '2026-07-16';
const parsed = parseLocalDateOnly(selected);

assert.strictEqual(new Date(selected).toLocaleDateString('en-US'), '7/15/2026', 'The regression setup must reproduce the UTC rollback.');
assert(parsed, 'A valid workflow calendar date should parse.');
assert.strictEqual(parsed.getFullYear(), 2026);
assert.strictEqual(parsed.getMonth(), 6);
assert.strictEqual(parsed.getDate(), 16, 'The selected workflow date must not roll back one day.');
assert.strictEqual(parsed.toLocaleDateString('en-US'), '7/16/2026');
assert.strictEqual(parseLocalDateOnly('2026-02-31'), null, 'Invalid calendar dates must be rejected.');
assert.strictEqual(parseLocalDateOnly('07/16/2026'), null, 'The API must require YYYY-MM-DD.');

const springStart = localDayBoundaryIso('2026-03-08', 0);
const springEnd = localDayBoundaryIso('2026-03-08', 1);
assert.strictEqual(springStart, '2026-03-08T05:00:00.000Z');
assert.strictEqual(springEnd, '2026-03-09T04:00:00.000Z');
assert.strictEqual(new Date(springEnd) - new Date(springStart), 23 * 60 * 60 * 1000, 'DST-start day must be 23 hours.');

const fallStart = localDayBoundaryIso('2026-11-01', 0);
const fallEnd = localDayBoundaryIso('2026-11-01', 1);
assert.strictEqual(fallStart, '2026-11-01T04:00:00.000Z');
assert.strictEqual(fallEnd, '2026-11-02T05:00:00.000Z');
assert.strictEqual(new Date(fallEnd) - new Date(fallStart), 25 * 60 * 60 * 1000, 'DST-end day must be 25 hours.');
assert.strictEqual(localDayBoundaryIso('2026-02-31', 0), '', 'Invalid boundaries must be ignored safely.');

console.log('PASS: RX workflow calendar dates retain the selected local day.');
console.log('PASS: configured-timezone boundaries preserve 23-hour and 25-hour DST days.');
