'use strict';

const assert = require('assert');
const {
  inferRegionalTagName,
  normalizeAddressPayload,
  normalizeStructuredAddressForReference,
  parseAddress
} = require('../utils/patientAddress');

function assertAddress(actual, expected, label) {
  for (const [key, value] of Object.entries(expected)) {
    assert.strictEqual(actual[key], value, `${label}: ${key}`);
  }
}

assertAddress(
  parseAddress('102 GOLDENWOOD AVE BRANDON FL 335111'),
  {
    addressLine1: '102 GOLDENWOOD AVE',
    city: 'Brandon',
    state: 'FL',
    zipCode: '33511'
  },
  'extra trailing ZIP digit'
);

assertAddress(
  parseAddress('5689 W 28TH AVE HIALEAH FL 333016'),
  {
    addressLine1: '5689 W 28TH AVE',
    city: 'Hialeah',
    state: 'FL',
    zipCode: '33016'
  },
  'extra inserted ZIP digit with city hint'
);

assertAddress(
  parseAddress('1004 NW 33 RD ST APT 2 MIAMI FL'),
  {
    addressLine1: '1004 NW 33 RD ST APT 2',
    city: 'Miami',
    state: 'FL',
    zipCode: null
  },
  'city and state without ZIP'
);

assertAddress(
  parseAddress('2111DAVIE BLVD APT 253 FOURDELLADE'),
  {
    addressLine1: '2111DAVIE BLVD APT 253',
    city: 'Fort Lauderdale',
    state: 'FL',
    zipCode: null
  },
  'misspelled Fort Lauderdale without ZIP'
);

assertAddress(
  parseAddress('14303 MEMORIAL HWY MIAMI FL APT2J'),
  {
    addressLine1: '14303 MEMORIAL HWY APT2J',
    city: 'Miami',
    state: 'FL',
    zipCode: null
  },
  'city and state before apartment text without ZIP'
);

assertAddress(
  normalizeAddressPayload({
    address: '1021 Martex Dr Apopka 32703',
    addressLine1: '1021 Martex Dr Apopka 32703',
    city: '',
    state: '',
    zipCode: ''
  }),
  {
    address: '1021 Martex Dr Apopka 32703',
    addressLine1: '1021 Martex Dr',
    city: 'Apopka',
    state: 'FL',
    zipCode: '32703'
  },
  'blank structured import columns fall back to parsing full address'
);

assertAddress(
  normalizeStructuredAddressForReference({
    address: '1021 Martex Dr Apopka 32703',
    addressLine1: '1021 Martex Dr Apopka 32703',
    city: null,
    state: null,
    zipCode: null
  }),
  {
    addressLine1: '1021 Martex Dr',
    city: 'Apopka',
    state: 'FL',
    zipCode: '32703'
  },
  'cleanup parser handles ZIP-only city reference'
);

assert.strictEqual(inferRegionalTagName('102 GOLDENWOOD AVE BRANDON FL 335111', 'Brandon'), 'Tampa');
assert.strictEqual(inferRegionalTagName('1400 NW 12 Ave Miami FL 33136', 'Miami'), 'Miami');
assert.strictEqual(inferRegionalTagName('', ''), 'None');

console.log('PASS patient address parser repairs structured import fallback, city/state-only, and malformed ZIP cases.');
