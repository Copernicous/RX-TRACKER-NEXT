'use strict';
const fs = require('fs');
const path = require('path');
const patterns = { database: /^backup_[\w-]+\.dump$/, site: /^RX_SiteBackup_[\w-]+\.zip$/ };
function prunableCompleted(files, entries, keep, kind) {
    if (!Number.isSafeInteger(keep) || keep < 1 || !patterns[kind]) throw new Error('Invalid backup retention policy.');
    const pattern = patterns[kind];
    const present = new Map(files.filter(f => pattern.test(f.name)).map(f => [f.name, f]));
    const completed = entries.filter(e => e && e.kind !== 'database-restore' && pattern.test(String(e.filename || '')) && ['success', 'failed'].includes(e.status) && present.has(e.filename));
    const successful = completed.filter(e => e.status === 'success' && !e.verificationError)
        .sort((a, b) => (Date.parse(b.timestamp) || present.get(b.filename).mtime) - (Date.parse(a.timestamp) || present.get(a.filename).mtime));
    if (!successful.length) return [];
    const retained = new Set([...new Set(successful.map(e => e.filename))].slice(0, keep));
    const recorded = new Set(completed.map(e => e.filename));
    // A newer filename without a completed receipt may belong to a running job.
    return files.filter(f => pattern.test(f.name) && recorded.has(f.name) && !retained.has(f.name));
}
function cleanupHelperPartials(directory, filename) {
    if (path.basename(filename) !== filename || !/^(backup_|RX_SiteBackup_)[\w-]+\.delivery-recovery\.zip$/.test(filename)) throw new Error('Invalid owned recovery filename.');
    const removed = [];
    for (const name of fs.readdirSync(directory)) {
        if (!name.startsWith(filename + '.') || !/^[a-f0-9]{32}\.partial(?:\.receipt)?$/.test(name.slice(filename.length + 1))) continue;
        const file = path.join(directory, name);
        try { const stat = fs.lstatSync(file); if (stat.isFile() && !stat.isSymbolicLink()) { fs.unlinkSync(file); removed.push(name); } }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    return removed;
}
module.exports = { prunableCompleted, cleanupHelperPartials };
