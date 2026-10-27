'use strict';
const fs = require('fs');
const path = require('path');
const { createGzip, createGunzip } = require('zlib');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const { Writable } = require('stream');
const fsp = fs.promises;

function retentionDays(value) {
    const days = Number(value === undefined ? 30 : value);
    if (!Number.isSafeInteger(days) || days < 1 || days > 3650) throw Error('LOG_RETENTION_DAYS must be a whole number from 1 to 3650.');
    return days;
}
async function verifyFile(file, expected) {
    const hash = crypto.createHash('sha256');
    await pipeline(fs.createReadStream(file), createGunzip(), new Writable({ write(chunk, encoding, done) { hash.update(chunk); done(); } }));
    if (hash.digest('hex') !== expected) throw Error('Technical log archive is corrupt; source retained.');
}
// Only the application's dated access/error files, never NSSM output or a
// generic filesystem sweep. Stream one file at a time to bound memory use.
async function archiveClosedFiles(directory, days, openFiles = [], now = new Date()) {
    retentionDays(days);
    const archive = path.join(directory, 'archive');
    await fsp.mkdir(archive, { recursive: true });
    const cutoff = now.getTime() - days * 86400000;
    let count = 0;
    for (const file of await fsp.readdir(directory)) {
        if (!/^(access|error)-\d{4}-\d{2}-\d{2}\.log$/.test(file) || openFiles.includes(file)) continue;
        const source = path.join(directory, file), stat = await fsp.lstat(source);
        if (!stat.isFile() || stat.mtimeMs >= cutoff) continue;
        const temp = path.join(archive, crypto.randomUUID() + '.tmp');
        try {
            const hash = crypto.createHash('sha256');
            const input = fs.createReadStream(source); input.on('data', chunk => hash.update(chunk));
            await pipeline(input, createGzip(), fs.createWriteStream(temp, { flags: 'wx', mode: 0o600 }));
            const digest = hash.digest('hex');
            const fd = await fsp.open(temp, 'r+');
            try { await fd.sync(); } finally { await fd.close(); }
            await verifyFile(temp, digest);
            const destination = path.join(archive, file + '.' + digest + '.gz');
            if (fs.existsSync(destination)) await verifyFile(destination, digest);
            else await fsp.rename(temp, destination);
            const after = await fsp.stat(source);
            if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) continue;
            await fsp.unlink(source);
            count++;
        } finally { await fsp.unlink(temp).catch(e => { if (e.code !== 'ENOENT') throw e; }); }
    }
    return count;
}
function createLogger(directory, days) {
    days = retentionDays(days);
    fs.mkdirSync(directory, { recursive: true });
    let stamp, streams = {}, closed = false, archiving = false;
    function dateStamp() { return new Date().toISOString().slice(0, 10); }
    function roll() {
        if (closed || stamp === dateStamp()) return;
        for (const stream of Object.values(streams)) stream.end();
        stamp = dateStamp();
        streams = Object.fromEntries(['access', 'error'].map(kind => [kind, fs.createWriteStream(path.join(directory, kind + '-' + stamp + '.log'), { flags: 'a', mode: 0o600 })]));
        for (const stream of Object.values(streams)) stream.on('error', () => process.stderr.write('[Log] Could not append to technical log file.\n'));
        // A failed archive never prevents runtime logging or removes its source.
        if (!archiving) {
            archiving = true;
            archiveClosedFiles(directory, days, ['access-' + stamp + '.log', 'error-' + stamp + '.log'])
                .catch(() => process.stderr.write('[Log] Technical archive failed; unverified source retained.\n'))
                .finally(() => { archiving = false; });
        }
    }
    roll();
    const timer = setInterval(roll, 60000); timer.unref();
    return {
        access: { write(value) { roll(); if (!closed) streams.access.write(value); } },
        error: { write(value) { roll(); if (!closed) streams.error.write(value); } },
        close() { closed = true; clearInterval(timer); for (const stream of Object.values(streams)) stream.end(); }
    };
}
module.exports = { retentionDays, archiveClosedFiles, createLogger };
