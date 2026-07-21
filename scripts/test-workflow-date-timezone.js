'use strict';

process.env.TZ = 'America/New_York';

const assert = require('assert');
const { parseLocalDateOnly } = require('../utils/dateUtils');

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

console.log('PASS: RX workflow calendar dates retain the selected local day.');
