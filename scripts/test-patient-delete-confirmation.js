'use strict';

// Synthetic UI fixtures only; no database, server, or delete requests.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const elements = new Map();
const context = {
    window: {},
    document: {
        addEventListener() {},
        getElementById(id) {
            if (!elements.has(id)) elements.set(id, {
                value: '', disabled: false, textContent: '', attributes: {},
                addEventListener() {},
                setAttribute(key, value) { this.attributes[key] = value; },
                getAttribute(key) { return this.attributes[key] ?? null; }
            });
            return elements.get(id);
        }
    },
    bootstrap: { Modal: class { show() {} } }
};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/patients.js'), 'utf8'), context);
const input = context.document.getElementById('deleteConfirmInput');
const button = context.document.getElementById('confirmDeleteBtn');
const label = context.document.getElementById('deleteConfirmNameText');
function open(firstName, lastName) {
    context.allPatients = [{ id: 1, firstName, lastName }];
    context.promptDeletePatient(1);
    assert.equal(input.value, '');
    assert.equal(button.disabled, true, 'Opening the dialog must require fresh confirmation');
}
function check(value, enabled) {
    input.value = value;
    context.checkDeleteConfirmation();
    assert.equal(button.disabled, !enabled, 'Unexpected confirmation state for ' + JSON.stringify(value));
}

open('SAMPLE', 'PERSON');
check('SAMPLE PERSON', true);
check('OTHER PERSON', false);
open(' SAMPLE ', ' TEST  PERSON ');
check('SAMPLE TEST PERSON', true);
assert.equal(label.textContent, 'SAMPLE TEST PERSON', 'Display the same normalized name used for confirmation');
check('  SAMPLE\tTEST\u00a0PERSON\n', true);
check('SAMPLE TEST', false);
check('SAMPLETESTPERSON', false);
check('sample test person', false);
check('', false);
open('SAMPLE', 'TEST\u00a0PERSON');
check('SAMPLE TEST PERSON', true);
open('SAMPLE', 'SECOND');
check('SAMPLE TEST PERSON', false);
check('SAMPLE SECOND', true);
open('', '');
check('   ', false);
console.log('PASS: patient delete confirmation whitespace, exact-name safeguards, and dialog reset');
