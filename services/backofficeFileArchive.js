'use strict';
// Files stay alongside their originals as verified .gz copies. Readers recall
// bytes without reinserting database rows or writing an uncompressed cache.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createGzip, createGunzip } = require('zlib');
const { pipeline } = require('stream/promises');
const { Writable } = require('stream');
const { resolveWritablePath } = require('../utils/runtimePaths');
const fsp = fs.promises;
const locks = new Set();
const TYPES = {
    deliveryFiles: { label: 'Delivery log files', file: true, location: 'administration/delivery-log-archives' },
    csvSnapshots: { label: 'CSV review snapshot files', file: true, location: 'Configured CSV snapshot folder' }
};
function root(kind) {
    if (kind === 'deliveryFiles') return resolveWritablePath('administration', 'delivery-log-archives');
    if (kind === 'csvSnapshots') return require('../utils/globalSettings').readSettings().backupPath;
    throw Error('Unknown file archive section.');
}
async function regular(file) {
    const stat = await fsp.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw Error('Archive source must be a regular file.');
    return stat;
}
async function digest(file, compressed = false, maxBytes = Infinity) {
    await regular(file);
    const hash = crypto.createHash('sha256'); let bytes = 0;
    const sink = new Writable({ write(chunk, _encoding, done) {
        bytes += chunk.length;
        if (bytes > maxBytes) return done(Error('Archive exceeds supported size.'));
        hash.update(chunk); done();
    } });
    const streams = [fs.createReadStream(file)];
    if (compressed) streams.push(createGunzip());
    await pipeline(...streams, sink);
    return { sha256: hash.digest('hex'), bytes };
}
async function verified(file, maxBytes = Infinity) {
    const receiptPath = file + '.gz.sha256';
    await regular(receiptPath);
    const receipt = JSON.parse(await fsp.readFile(receiptPath, 'utf8'));
    const actual = await digest(file + '.gz', true, maxBytes);
    if (receipt.sha256 !== actual.sha256 || receipt.bytes !== actual.bytes) throw Error('Compressed archive checksum mismatch.');
    return receipt;
}
async function read(file, maxBytes) {
    try { const stat = await regular(file); if (stat.size > maxBytes) throw Error('Archive exceeds supported size.'); return await fsp.readFile(file).then(bytes => {
        if (bytes.length > maxBytes) throw Error('Archive exceeds supported size.'); return bytes;
    }); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    await verified(file, maxBytes);
    const chunks = []; let size = 0;
    await pipeline(fs.createReadStream(file + '.gz'), createGunzip(), new Writable({ write(chunk, _enc, done) {
        size += chunk.length; if (size > maxBytes) return done(Error('Archive exceeds supported size.'));
        chunks.push(chunk); done();
    } }));
    return Buffer.concat(chunks);
}
async function existing(file) {
    try { await regular(file); return file; } catch (e) { if (e.code !== 'ENOENT') throw e; }
    await regular(file + '.gz'); return file + '.gz';
}
async function compress(file, cutoff) {
    if (locks.has(file)) return false;
    locks.add(file);
    const temporary = file + '.compress-' + crypto.randomUUID();
    try {
        const before = await regular(file);
        if (before.mtimeMs >= cutoff) return false;
        const original = await digest(file);
        await pipeline(fs.createReadStream(file), createGzip(), fs.createWriteStream(temporary, { flags: 'wx', mode: 0o600 }));
        const fd = await fsp.open(temporary, 'r+'); try { await fd.sync(); } finally { await fd.close(); }
        const check = await digest(temporary, true);
        if (check.sha256 !== original.sha256 || check.bytes !== original.bytes) throw Error('Compression verification failed; original retained.');
        // Exclusive publication never overwrites a previous archive or receipt.
        try { await fsp.link(temporary, file + '.gz'); }
        catch (e) { if (e.code !== 'EEXIST') throw e; }
        const receipt = JSON.stringify({ ...original, format: 1, compressedAt: new Date().toISOString() });
        try {
            const handle = await fsp.open(file + '.gz.sha256', 'wx', 0o600);
            try { await handle.writeFile(receipt); await handle.sync(); } finally { await handle.close(); }
        } catch (e) { if (e.code !== 'EEXIST') throw e; }
        const published = await verified(file);
        if (published.sha256 !== original.sha256 || published.bytes !== original.bytes) throw Error('A different compressed version exists; original retained.');
        const after = await regular(file), again = await digest(file);
        if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || again.sha256 !== original.sha256) return false;
        await fsp.unlink(file);
        return true;
    } finally { locks.delete(file); await fsp.unlink(temporary).catch(e => { if (e.code !== 'ENOENT') throw e; }); }
}
async function inventory(kind, retention, now = new Date()) {
    const directory = root(kind), cutoff = now.getTime() - retention * 86400000;
    const result = { kind, days: retention, cutoff: new Date(cutoff).toISOString(), active: 0, archived: 0, eligible: 0, skipped: 0, candidates: [], oldest: null, newest: null };
    let entries; try { entries = await fsp.readdir(directory, { withFileTypes: true }); } catch (e) { if (e.code === 'ENOENT') return result; throw e; }
    const groups = [];
    if (kind === 'deliveryFiles') groups.push({ directory, entries, date: null });
    else for (const entry of entries) {
        if (!entry.isDirectory() || !/^backup_[A-Za-z0-9_-]+$/.test(entry.name)) continue;
        const folder = path.join(directory, entry.name);
        try {
            const manifestPath = path.join(folder, 'manifest.json'); await regular(manifestPath);
            const manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
            if (manifest.artifactType !== 'database-csv-review-snapshot' || manifest.restorable !== false) continue;
            groups.push({ directory: folder, entries: await fsp.readdir(folder, { withFileTypes: true }), date: new Date(manifest.createdAt).getTime() });
        } catch (_e) { result.skipped++; }
    }
    for (const group of groups) for (const entry of group.entries) {
        if (!entry.isFile()) continue;
        const extension = kind === 'deliveryFiles' ? '.json' : '.csv';
        if (!entry.name.endsWith(extension) && !entry.name.endsWith(extension + '.gz')) continue;
        const file = path.join(group.directory, entry.name);
        if (entry.name.endsWith('.gz')) { result.archived++; continue; }
        result.active++;
        try {
        const stat = await regular(file); let date = group.date;
        if (kind === 'deliveryFiles') {
            const record = JSON.parse((await read(file, 2 * 1024 * 1024)).toString('utf8'));
            if (record.formatVersion === 2) require('../controllers/deliveryLogArchiveController')._test.assertRecordIntegrity(record);
            date = new Date(record.createdAt).getTime();
        }
        if (!Number.isFinite(date) || date >= cutoff || stat.mtimeMs >= cutoff) continue;
        result.eligible++; if (result.candidates.length < 10) result.candidates.push(file);
        const stamp = new Date(date).toISOString();
        if (!result.oldest || stamp < result.oldest) result.oldest = stamp;
        if (!result.newest || stamp > result.newest) result.newest = stamp;
        } catch (_e) { result.skipped++; }
    }
    return result;
}
async function preview(kind, retention, now) { const { candidates, ...value } = await inventory(kind, retention, now); return value; }
async function run(kind, retention, now) {
    const value = await inventory(kind, retention, now); let count = 0;
    for (const file of value.candidates) if (await compress(file, new Date(value.cutoff).getTime())) count++;
    return { kind, count, cutoff: value.cutoff, message: `${count} older files compressed and verified. Recent files retained; downloads recall the original content.` };
}
module.exports = { TYPES, root, read, existing, verified, compress, inventory, preview, run };
