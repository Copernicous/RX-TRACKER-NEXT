'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Writable } = require('stream');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'rx-file-retention-'));
process.env.APP_WRITABLE_ROOT = temporary;
process.env.BACKUP_SCHEDULER_ENABLED = 'false';
process.env.SITE_BACKUP_SCHEDULER_ENABLED = 'false';
const files = require('../services/backofficeFileArchive');
const settings = require('../utils/globalSettings');
const originalSettings = settings.readSettings;
settings.readSettings = () => ({ backupPath: path.join(temporary, 'snapshots') });
const admin = require('../controllers/adminController');
const db = require('../models');
const now = new Date(), cutoff = now.getTime() - 30 * 86400000, old = new Date(cutoff - 86400000);
function put(file, content, modified = old) {
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); fs.utimesSync(file, modified, modified);
}
async function main() {
    const delivery = files.root('deliveryFiles');
    const original = Buffer.from(JSON.stringify({ createdAt: old.toISOString(), rows: [{ sample: 'retained content' }] }));
    const eligible = path.join(delivery, 'older.json'); put(eligible, original);
    put(path.join(delivery, 'recent.json'), JSON.stringify({ createdAt: now.toISOString() }), now);
    put(path.join(delivery, 'boundary.json'), JSON.stringify({ createdAt: new Date(cutoff).toISOString() }), old);
    put(path.join(delivery, 'modified.json'), original, now);
    put(path.join(delivery, '.pharmacy-sequences.ledger'), 'immutable sequence evidence');
    put(path.join(delivery, 'corrupt.json'), 'unreadable original');
    const before = await files.preview('deliveryFiles', 30, now);
    assert.equal(before.eligible, 1); assert.equal(before.skipped, 1);
    assert.equal((await files.run('deliveryFiles', 30, now)).count, 1);
    assert(!fs.existsSync(eligible)); assert(fs.existsSync(eligible + '.gz'));
    assert.deepEqual(await files.read(eligible, 10000), original);
    assert.equal((await files.preview('deliveryFiles', 30, now)).archived, 1);
    assert.equal((await files.run('deliveryFiles', 30, now)).count, 0);
    for (const name of ['recent.json', 'boundary.json', 'modified.json', '.pharmacy-sequences.ledger']) assert(fs.existsSync(path.join(delivery, name)));
    await assert.rejects(files.read(eligible, 3), /size/);
    const gzip = fs.readFileSync(eligible + '.gz'); fs.writeFileSync(eligible + '.gz', Buffer.from('corrupt'));
    await assert.rejects(files.read(eligible, 10000)); fs.writeFileSync(eligible + '.gz', gzip);
    // A replacement source must never be removed in favor of an older compressed copy.
    put(eligible, 'a changed version'); await assert.rejects(files.compress(eligible, cutoff), /different compressed version/);
    assert.equal(fs.readFileSync(eligible, 'utf8'), 'a changed version'); fs.unlinkSync(eligible);
    const snapshot = path.join(files.root('csvSnapshots'), 'backup_synthetic');
    put(path.join(snapshot, 'manifest.json'), JSON.stringify({ artifactType: 'database-csv-review-snapshot', restorable: false, createdAt: old.toISOString(), tables: [{ file: '001-Sample.csv' }] }));
    const csv = Buffer.from('id,value\r\n1,"original, text"\r\n'); put(path.join(snapshot, '001-Sample.csv'), csv);
    const backupDump = path.join(files.root('csvSnapshots'), 'backup_unrelated.dump'); put(backupDump, 'never touch database backups');
    assert.equal((await files.run('csvSnapshots', 30, now)).count, 1);
    assert.deepEqual(await files.read(path.join(snapshot, '001-Sample.csv'), 10000), csv);
    const list = { json(value) { this.body = value; }, status() { return this; } }; admin.listBackups({}, list);
    assert.equal(list.body.backups[0].compressedFiles, 1); assert.equal(list.body.backups[0].fileCount, 1);
    const chunks = []; const response = new Writable({ write(chunk, _enc, done) { chunks.push(chunk); done(); } });
    response.setHeader = () => {}; response.status = code => { throw Error('Download failed: ' + code); };
    await admin.downloadBackupFile({ params: { name: 'backup_synthetic', file: '001-Sample.csv' } }, response);
    assert.deepEqual(Buffer.concat(chunks), csv);
    assert.equal(fs.readFileSync(backupDump, 'utf8'), 'never touch database backups');
    let status; await admin.downloadBackupFile({ params: { name: '../outside', file: '001-Sample.csv' } }, { status(code) { status = code; return this; }, json() {} }); assert.equal(status, 400);
    const outside = path.join(temporary, 'outside'); fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, '001-Sample.csv'), 'outside file');
    const linked = path.join(files.root('csvSnapshots'), 'backup_link');
    fs.symlinkSync(outside, linked, process.platform === 'win32' ? 'junction' : 'dir');
    const rejected = { code: 200, status(code) { this.code = code; return this; }, json(value) { this.body = value; } };
    await admin.downloadBackupFile({ params: { name: 'backup_link', file: '001-Sample.csv' } }, rejected);
    assert.equal(rejected.code, 404);
    console.log('PASS file retention boundaries, verified compression/recall, corruption/size rejection, changed-source preservation, sequence/backup isolation and original CSV download.');
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(async () => {
    settings.readSettings = originalSettings; await db.sequelize.close();
    fs.rmSync(temporary, { recursive: true, force: true });
});
