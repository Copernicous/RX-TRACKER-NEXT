(function(root) {
    'use strict';
    const metadata = ['_reviewSourceRow', '_reviewError', '_reviewNotes', '_reviewStatus'];
    function encode(headers, rows) {
        const quote = value => '"' + String(value ?? '').replace(/"/g, '""') + '"';
        return '\uFEFF' + [headers.map(quote).join(','), ...rows.map(row => headers.map(key => quote(row[key])).join(','))].join('\r\n');
    }
    function correction(headers, rows, errors = [], deferred = []) {
        const issues = new Map();
        errors.forEach(e => {
            if (!issues.has(e.row)) issues.set(e.row, []);
            issues.get(e.row).push(e.error);
        });
        const held = new Set(deferred);
        const selected = rows.filter(row => issues.has(row._rowNum) || held.has(row._rowNum)).map(row => ({
            ...row,
            _reviewSourceRow: row._reviewSourceRow || row._rowNum,
            _reviewError: (issues.get(row._rowNum) || ['Identity comparison needs a decision']).join('; '),
            _reviewNotes: row._reviewNotes || '',
            _reviewStatus: issues.has(row._rowNum) ? 'Needs correction' : 'Needs decision'
        }));
        return { headers: [...headers.filter(h => !metadata.includes(h)), ...metadata], rows: selected };
    }
    function session(rows, warnings) {
        const byRow = new Map(warnings.map(w => [w.row, w]));
        return rows.map(row => {
            const warning = byRow.get(row._rowNum);
            return { row: row._rowNum, raw: row, warning, candidate: 0, different: new Set(),
                decision: { row: row._rowNum, action: warning?.previousImport ? 'skip' : !warning || warning.informational ? 'import' : '' } };
        });
    }
    function resolved(item) {
        const d = item.decision;
        if (d.action === 'defer' || d.action === 'skip') return true;
        if (d.action === 'merge') return !!item.target && item.target.id === d.targetId && !!d.targetId && (!(item.target?.isDeleted || item.target?.isActive === false) || d.confirmRestore === true);
        if (d.action !== 'import' || item.warning?.canCreate === false) return false;
        return !item.warning || item.warning.informational || item.different.size === item.warning.matches.length;
    }
    function counts(items) {
        const result = { import: 0, merge: 0, skip: 0, defer: 0, unresolved: 0 };
        items.forEach(item => { if (!resolved(item)) result.unresolved++; else result[item.decision.action]++; });
        return result;
    }
    function decisions(items) {
        if (items.some(item => !resolved(item))) throw Error('Resolve every row or choose Decide later.');
        return items.filter(item => item.warning || ['skip', 'defer'].includes(item.decision.action)).map(item => ({ ...item.decision,
            action: item.decision.action === 'defer' ? 'skip' : item.decision.action }));
    }
    const api = { metadata, encode, correction, session, resolved, counts, decisions };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.ImportReviewModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
