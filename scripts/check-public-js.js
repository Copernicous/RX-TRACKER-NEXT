'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { TextDecoder } = require('util');

const root = path.join(__dirname, '..');
const publicJsRoot = path.join(root, 'public', 'js');
const failures = [];

function collectJavaScriptFiles(directory) {
    const files = [];
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            files.push(...collectJavaScriptFiles(fullPath));
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.js')) {
            files.push(fullPath);
        }
    }
    return files;
}

function relative(file) {
    return path.relative(root, file).replace(/\\/g, '/');
}

function checkEncoding(file) {
    const bytes = fs.readFileSync(file);
    const name = relative(file);
    const isUtf16Le = bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe;
    const isUtf16Be = bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff;

    if (isUtf16Le || isUtf16Be) {
        failures.push(name + ': UTF-16 is not supported for browser JavaScript; save as UTF-8.');
        return;
    }
    if (bytes.includes(0)) {
        failures.push(name + ': contains NUL bytes and is likely saved with the wrong encoding.');
        return;
    }

    try {
        new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (err) {
        failures.push(name + ': is not valid UTF-8 (' + err.message + ').');
    }
}

function checkSyntax(file) {
    const result = spawnSync(process.execPath, ['--check', file], {
        cwd: root,
        encoding: 'utf8',
        windowsHide: true
    });
    if (result.status !== 0) {
        const detail = String(result.stderr || result.stdout || 'syntax check failed').trim();
        failures.push(relative(file) + ': ' + detail);
    }
}

const files = collectJavaScriptFiles(publicJsRoot).sort();
for (const file of files) {
    checkEncoding(file);
    checkSyntax(file);
}

if (failures.length) {
    console.error('Public JavaScript validation failed:');
    for (const failure of failures) console.error('- ' + failure);
    process.exit(1);
}

console.log('Public JavaScript validation passed: ' + files.length + ' UTF-8 files with valid syntax.');
