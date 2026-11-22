'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prunableCompleted, cleanupHelperPartials } = require('../services/backupArtifacts');
const files = [{ name: 'backup_old.dump', mtime: 1 }, { name: 'backup_verified.dump', mtime: 2 }, { name: 'backup_in_progress.dump', mtime: 3 }, { name: 'patient_rx_before_update.dump', mtime: 0 }];
const entries = [{ filename: 'backup_old.dump', status: 'success', timestamp: '2026-11-20T00:00:00Z' }, { filename: 'backup_verified.dump', status: 'success', timestamp: '2026-11-21T00:00:00Z' }];
assert.deepStrictEqual(prunableCompleted(files, entries, 1, 'database').map(f => f.name), ['backup_old.dump']);
assert.deepStrictEqual(prunableCompleted(files, [{ filename: 'backup_old.dump', status: 'failed' }], 1, 'database'), []);
assert.deepStrictEqual(prunableCompleted(files, entries, 2, 'database'), []);
assert.throws(() => prunableCompleted(files, entries, 0, 'database'));
assert.deepStrictEqual(prunableCompleted([{ name: 'RX_SiteBackup_old.zip', mtime: 1 }, { name: 'RX_SiteBackup_new.zip', mtime: 2 }, { name: 'RX_SiteBackup_inflight.zip', mtime: 3 }], [{ filename: 'RX_SiteBackup_old.zip', status: 'success' }, { filename: 'RX_SiteBackup_new.zip', status: 'success' }], 1, 'site').map(f => f.name), ['RX_SiteBackup_old.zip']);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rx-backup-artifacts-'));
try {
 const filename = 'backup_fixture.delivery-recovery.zip';
 const owned = filename + '.' + 'a'.repeat(32) + '.partial';
 for (const f of [owned, owned + '.receipt', filename, filename + '.sha256.json', filename + '.other.partial']) fs.writeFileSync(path.join(root, f), 'synthetic');
 assert.strictEqual(cleanupHelperPartials(root, filename).length, 2);
 for (const f of [filename, filename + '.sha256.json', filename + '.other.partial']) assert.ok(fs.existsSync(path.join(root, f)), 'Cleanup removed a non-owned artifact');
 assert.throws(() => cleanupHelperPartials(root, '../outside.zip'));
} finally { fs.rmSync(root, { recursive: true, force: true }); }
console.log('PASS completed-receipt retention excludes in-flight backups; exact owned partial cleanup preserves published artifacts.');
