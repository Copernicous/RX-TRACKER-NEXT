/* FortiGate compat: use var instead of literal '' */
var _EMPTY_JOIN = '';


const TOKEN = localStorage.getItem('token');
const USER  = JSON.parse(localStorage.getItem('user') || '{}');

let tableMeta    = [];
let tableCounts  = {};
let selected     = new Set();

// ── Viewer state ──────────────────────────────────────────────────────────
let viewerRows    = [];   // raw rows from API
let viewerCols    = [];   // all column keys
let viewerVis     = {};   // col key → visible boolean
let viewerFilter  = '';   // search string
let viewerFiltRows = [];  // filtered subset
let viewerPage    = 1;
let viewerPageSize= 50;
let viewerSortCol = null;
let viewerSortDir = 'asc';
let viewerMeta    = null; // current table meta

// ── Auth Guard ────────────────────────────────────────────────────────────
(function(){
    const roleId = USER.roleId || USER.role;
    const isAdmin = roleId === 1 || roleId === 'Administrator';
    if (!isAdmin) {
        document.getElementById('deniedWrap').style.display = 'block';
    } else {
        document.getElementById('mainWrap').style.display = 'block';
        document.getElementById('userBadge').textContent = (USER.firstName || '') + ' — Administrator';
        loadStats();
    }
})();

// ── Load Stats ────────────────────────────────────────────────────────────
async function loadStats() {
    document.getElementById('refreshBtn').innerHTML = '<span class="spinner-sm"></span>';
    try {
        const res  = await apiFetch('/api/admin/stats');
        const data = await res.json();
        tableMeta   = data.tables;
        tableCounts = data.counts;
        renderStatsRow();
        renderGrid();
        updateActionBar();
        document.getElementById('lastRefresh').textContent = 'Refreshed ' + new Date().toLocaleTimeString();
    } catch(e) { toast('Failed to load stats: ' + e.message, 'danger'); }
    document.getElementById('refreshBtn').innerHTML = '<i class="fas fa-sync-alt"></i>';
}

function renderStatsRow() {
    const total    = Object.values(tableCounts).reduce((a,b)=>a+b, 0);
    const nonEmpty = Object.values(tableCounts).filter(v=>v>0).length;
    document.getElementById('statsRow').innerHTML = `
        <div class="stat-pill"><div class="num" style="color:#6366f1">${tableMeta.length}</div><div class="lbl">Tables</div></div>
        <div class="stat-pill"><div class="num" style="color:#ef4444">${total.toLocaleString()}</div><div class="lbl">Total Records</div></div>
        <div class="stat-pill"><div class="num" style="color:#10b981">${nonEmpty}</div><div class="lbl">With Data</div></div>
        <div class="stat-pill"><div class="num" style="color:#f59e0b">${selected.size}</div><div class="lbl">Selected</div></div>`;
}

// ── Render Grid ───────────────────────────────────────────────────────────
function renderGrid() {
    document.getElementById('tablesGrid').innerHTML = tableMeta.map(t => {
        const count = tableCounts[t.key] ?? 0;
        const isSel = selected.has(t.key);
        const deps  = t.dependsOn && t.dependsOn.length > 0;
        return `
        <div class="table-card ${isSel ? 'selected' : ''}" id="card_${t.key}" style="--card-color:${t.color}">
            <div class="tc-top">
                <div class="tc-left">
                    <div class="table-icon" style="background:${t.color}22;color:${t.color}"><i class="${t.icon}"></i></div>
                    <div>
                        <div class="table-name">${t.label}</div>
                        ${deps ? `<span class="dep-badge"><i class="fas fa-link me-1"></i>child of ${t.dependsOn.join(', ')}</span>` : ''}
                    </div>
                </div>
                <div class="check-dot" onclick="toggleCard('${t.key}')"><i class="fas fa-check"></i></div>
            </div>
            <div class="table-desc">${t.description}</div>
            <div class="tc-count ${count===0?'count-zero':''}" style="color:${count>0?t.color:'var(--text-muted)'}">
                ${count.toLocaleString()} <span>records</span>
            </div>
            <div class="tc-actions">
                <button class="tc-btn tc-btn-view"   onclick="openViewer('${t.key}')"><i class="fas fa-eye"></i> View</button>
                <button class="tc-btn tc-btn-export"  onclick="exportTable('${t.key}')"><i class="fas fa-file-csv"></i> Export CSV</button>
                <button class="tc-btn tc-btn-select"  onclick="toggleCard('${t.key}')">${isSel ? '<i class="fas fa-minus"></i> Remove' : '<i class="fas fa-trash-alt"></i> Select'}</button>
            </div>
        </div>`;
    }).join(_EMPTY_JOIN);
}

function toggleCard(key) {
    if (selected.has(key)) selected.delete(key);
    else selected.add(key);
    const card = document.getElementById('card_' + key);
    if (card) {
        card.classList.toggle('selected', selected.has(key));
        const sel  = card.querySelector('.tc-btn-select');
        const dot  = card.querySelector('.check-dot');
        if (sel) sel.innerHTML = selected.has(key) ? '<i class="fas fa-minus"></i> Remove' : '<i class="fas fa-trash-alt"></i> Select';
        if (dot) dot.innerHTML = '<i class="fas fa-check"></i>';
    }
    updateActionBar();
    renderStatsRow();
}

function selectAll(val) {
    tableMeta.forEach(t => { if(val) selected.add(t.key); else selected.delete(t.key); });
    renderGrid();
    updateActionBar();
    renderStatsRow();
}

function updateActionBar() {
    const totalRecs = [...selected].reduce((s,k) => s + (tableCounts[k]||0), 0);
    document.getElementById('selCount').textContent       = selected.size;
    document.getElementById('selRecordCount').textContent = totalRecs.toLocaleString();
    document.getElementById('purgeBtn').disabled          = selected.size === 0;
}

// ══════════════════════════════════════════════════════════════════════════
// DATA VIEWER
// ══════════════════════════════════════════════════════════════════════════

async function openViewer(tableKey) {
    viewerMeta = tableMeta.find(t => t.key === tableKey);
    document.getElementById('viewerTitle').textContent = viewerMeta?.label || tableKey;
    document.getElementById('viewerDesc').textContent  = viewerMeta?.description || '';
    const icon = document.getElementById('viewerIcon');
    icon.style.background = (viewerMeta?.color || '#6366f1') + '22';
    icon.style.color      = viewerMeta?.color || '#6366f1';
    icon.innerHTML        = `<i class="${viewerMeta?.icon || 'fas fa-table'}"></i>`;

    document.getElementById('viewerBadge').textContent = 'Loading...';
    document.getElementById('viewerSearch').value = '';
    viewerFilter  = '';
    viewerPage    = 1;
    viewerSortCol = null;
    viewerSortDir = 'asc';
    document.getElementById('viewerTableWrap').innerHTML = '<p class="no-rows"><i class="fas fa-spinner fa-spin me-2"></i>Loading...</p>';
    document.getElementById('viewerOverlay').classList.add('show');

    try {
        const res  = await apiFetch('/api/admin/table-data/' + tableKey);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Load failed');

        viewerRows  = data.rows;
        viewerCols  = data.columns;
        // Init visibility — all visible by default
        viewerVis = {};
        viewerCols.forEach(c => { viewerVis[c] = true; });

        renderColDropdown();
        applyViewerFilter();
        document.getElementById('viewerBadge').textContent = data.total.toLocaleString() + ' records';
    } catch(e) {
        document.getElementById('viewerTableWrap').innerHTML = `<p class="no-rows" style="color:#fca5a5"><i class="fas fa-exclamation-circle me-2"></i>${e.message}</p>`;
    }
}

function closeViewer() {
    document.getElementById('viewerOverlay').classList.remove('show');
    document.getElementById('colDropdown').classList.remove('open');
}

// Column dropdown
function renderColDropdown() {
    document.getElementById('colDropdown').innerHTML = viewerCols.map(c => `
        <label class="col-item">
            <input type="checkbox" ${viewerVis[c] ? 'checked' : ''} onchange="toggleCol('${c}',this.checked)">
            <span>${c}</span>
        </label>`).join(_EMPTY_JOIN);
}


function toggleColDropdown() {
    document.getElementById('colDropdown').classList.toggle('open');
}
document.addEventListener('click', e => {
    if (!e.target.closest('.col-toggle-wrap')) document.getElementById('colDropdown')?.classList.remove('open');
});
function toggleCol(col, val) { viewerVis[col] = val; renderViewerTable(); }

function applyViewerFilter() {
    viewerFilter  = document.getElementById('viewerSearch').value.toLowerCase();
    viewerPage    = 1;
    viewerFiltRows = viewerFilter
        ? viewerRows.filter(row => Object.values(row).some(v => v !== null && String(v).toLowerCase().includes(viewerFilter)))
        : viewerRows;
    applySortToFiltRows();
    renderViewerTable();
}
function applySortToFiltRows() {
    if (!viewerSortCol) return;
    viewerFiltRows.sort((a, b) => {
        const va = a[viewerSortCol], vb = b[viewerSortCol];
        if (va === null && vb === null) return 0;
        if (va === null) return 1; if (vb === null) return -1;
        const cmp = String(va).localeCompare(String(vb), undefined, { numeric: true });
        return viewerSortDir === 'asc' ? cmp : -cmp;
    });
}
function sortViewer(col) {
    if (viewerSortCol === col) viewerSortDir = viewerSortDir === 'asc' ? 'desc' : 'asc';
    else { viewerSortCol = col; viewerSortDir = 'asc'; }
    applySortToFiltRows(); renderViewerTable();
}
function changePageSize() {
    viewerPageSize = parseInt(document.getElementById('pageSizeSelect').value) || 0;
    viewerPage = 1; renderViewerTable();
}
function clearRowSelection() {
    viewerSelectedIds.clear();
    renderViewerTable();
}

function renderViewerTable() {
    const visCols = viewerCols.filter(c => viewerVis[c]);
    const total   = viewerFiltRows.length;
    const ps      = viewerPageSize || total;
    const pages   = ps ? Math.max(1, Math.ceil(total / ps)) : 1;
    viewerPage    = Math.min(viewerPage, pages);

    const start    = (viewerPage - 1) * ps;
    const end      = ps ? Math.min(start + ps, total) : total;
    const pageRows = viewerFiltRows.slice(start, end);

    document.getElementById('viewerInfo').textContent = `Showing ${start+1}–${end} of ${total.toLocaleString()} ${viewerFilter ? '(filtered)' : ''}`;

    if (!pageRows.length) {
        document.getElementById('viewerTableWrap').innerHTML = `<p class="no-rows"><i class="fas fa-search me-2"></i>No records${viewerFilter ? ' match your search' : ''}.</p>`;
        renderPagination(0, 0, 0);
        updateViewerSelUI();
        return;
    }

    // Checkbox header: is every page row selected?
    const allPageSel = pageRows.every(r => viewerSelectedIds.has(String(r.id)));
    const someSel    = pageRows.some(r => viewerSelectedIds.has(String(r.id)));
    const checkTh    = `<th class="cb-col" title="Select / deselect page">
        <input type="checkbox" id="selAllCheck" ${allPageSel ? 'checked' : someSel ? 'indeterminate' : ''}
            onclick="toggleSelectPage(this.checked)" title="Select all on this page">
    </th>`;

    const ths = visCols.map(c => {
        const isSorted = viewerSortCol === c;
        const sortIcon = isSorted ? (viewerSortDir === 'asc' ? 'fa-sort-up' : 'fa-sort-down') : 'fa-sort';
        return `<th class="${isSorted ? 'sorted' : ''}" onclick="sortViewer('${c}')">${c} <i class="fas ${sortIcon} sort-icon"></i></th>`;
    }).join(_EMPTY_JOIN);

    const trs = pageRows.map(row => {
        const isSel = viewerSelectedIds.has(String(row.id));
        const checkTd = `<td class="cb-col" onclick="event.stopPropagation()">
            <input type="checkbox" class="row-check" value="${row.id}" ${isSel ? 'checked' : ''}
                onchange="toggleRowSel('${row.id}', this.checked)">
        </td>`;
        const tds = visCols.map(c => {
            const val = row[c];
            if (val === null || val === undefined) return `<td class="null-cell">—</td>`;
            if (val === true  || val === 'true')   return `<td class="bool-true">✓ true</td>`;
            if (val === false || val === 'false')   return `<td class="bool-false">✗ false</td>`;
            const str = String(val);
            const display = str.length > 80 ? str.slice(0, 80) + '…' : str;
            return `<td title="${str.replace(/"/g,'&quot;')}">${display}</td>`;
        }).join(_EMPTY_JOIN);
        return `<tr class="${isSel ? 'sel-row' : ''}">${checkTd}${tds}</tr>`;
    }).join(_EMPTY_JOIN);

    document.getElementById('viewerTableWrap').innerHTML = `
        <table class="data-table">
            <thead><tr>${checkTh}${ths}</tr></thead>
            <tbody>${trs}</tbody>
        </table>`;

    // Fix indeterminate state (can't set via HTML attribute)
    const allCb = document.getElementById('selAllCheck');
    if (allCb && someSel && !allPageSel) allCb.indeterminate = true;

    renderPagination(viewerPage, pages, total);
    updateViewerSelUI();
}

// ── Row selection ─────────────────────────────────────────────────────────
let viewerSelectedIds = new Set(); // string IDs, persists across pages

function toggleRowSel(id, checked) {
    if (checked) viewerSelectedIds.add(String(id));
    else         viewerSelectedIds.delete(String(id));
    updateViewerSelUI();
    // Update the select-all checkbox
    const pageRows = viewerFiltRows.slice(
        (viewerPage-1) * (viewerPageSize || viewerFiltRows.length),
        viewerPage     * (viewerPageSize || viewerFiltRows.length) || viewerFiltRows.length
    );
    const allSel = pageRows.every(r => viewerSelectedIds.has(String(r.id)));
    const someSel = pageRows.some(r => viewerSelectedIds.has(String(r.id)));
    const cb = document.getElementById('selAllCheck');
    if (cb) { cb.checked = allSel; cb.indeterminate = someSel && !allSel; }
}

function toggleSelectPage(checked) {
    const ps = viewerPageSize || viewerFiltRows.length;
    const start = (viewerPage - 1) * ps;
    const end   = ps ? Math.min(start + ps, viewerFiltRows.length) : viewerFiltRows.length;
    viewerFiltRows.slice(start, end).forEach(r => {
        if (checked) viewerSelectedIds.add(String(r.id));
        else         viewerSelectedIds.delete(String(r.id));
    });
    // re-render just the checkboxes
    document.querySelectorAll('.row-check').forEach(cb => {
        cb.checked = viewerSelectedIds.has(String(cb.value));
        cb.closest('tr').classList.toggle('sel-row', cb.checked);
    });
    updateViewerSelUI();
}

function updateViewerSelUI() {
    const n   = viewerSelectedIds.size;
    const btn = document.getElementById('viewerDeleteSelBtn');
    const cnt = document.getElementById('viewerDelCount');
    if (btn) btn.style.display = n > 0 ? '' : 'none';
    if (cnt) cnt.textContent = n;
}

// ── Row delete impact modal ───────────────────────────────────────────────
async function openImpactModal() {
    if (!viewerSelectedIds.size || !viewerMeta) return;
    document.getElementById('impactBackdrop').classList.add('show');
    document.getElementById('impactTableName').textContent = viewerMeta.label;
    document.getElementById('impactRowCount').textContent  = viewerSelectedIds.size;
    document.getElementById('impactPhrase').value = '';
    document.getElementById('impactDeleteBtn').disabled = true;
    document.getElementById('impactList').innerHTML = '<p style="color:var(--text-muted);font-size:0.8rem;text-align:center"><i class="fas fa-spinner fa-spin me-2"></i>Analyzing impact...</p>';

    try {
        const res  = await apiFetch('/api/admin/row-impact', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tableName: viewerMeta.key, ids: [...viewerSelectedIds] })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Impact check failed');

        if (!data.impact.length) {
            document.getElementById('impactList').innerHTML = '<p style="color:#6ee7b7;font-size:0.8rem;text-align:center"><i class="fas fa-check-circle me-1"></i>No related records found. Safe to delete.</p>';
            document.getElementById('impactWarning').innerHTML = 'Deleting <strong>' + viewerSelectedIds.size + '</strong> row(s). No cascade effects.';
        } else {
            const totalCascade = data.impact.filter(i => i.action === 'cascade').reduce((s, i) => s + i.count, 0);
            document.getElementById('impactList').innerHTML = data.impact.map(i => `
                <div class="impact-item">
                    <span class="${i.action === 'cascade' ? 'impact-cascade' : 'impact-null'}">
                        <i class="fas ${i.action === 'cascade' ? 'fa-trash-alt' : 'fa-unlink'} me-1"></i>
                        ${i.table} <span style="color:var(--text-muted);font-size:0.72rem">.${i.col}</span>
                    </span>
                    <span>
                        <strong style="font-size:0.9rem">${i.count.toLocaleString()}</strong>
                        <span class="impact-badge ${i.action === 'cascade' ? 'impact-badge-del' : 'impact-badge-null'}">
                            ${i.action === 'cascade' ? 'WILL DELETE' : 'SET NULL'}
                        </span>
                    </span>
                </div>`).join(_EMPTY_JOIN);
            const warnParts = [];
            if (totalCascade > 0) warnParts.push(`<strong>${totalCascade.toLocaleString()} related records will also be deleted</strong> (cascade).`);
            const nullTbls = data.impact.filter(i => i.action === 'null').map(i => i.table);
            if (nullTbls.length) warnParts.push(`FK references in <strong>${nullTbls.join(', ')}</strong> will be set to NULL.`);
            document.getElementById('impactWarning').innerHTML = warnParts.join(' ');
        }
        setTimeout(() => document.getElementById('impactPhrase').focus(), 80);
    } catch(e) {
        document.getElementById('impactList').innerHTML = `<p style="color:#fca5a5;font-size:0.8rem">${e.message}</p>`;
    }
}

function closeImpactModal() { document.getElementById('impactBackdrop').classList.remove('show'); }

function checkImpactPhrase() {
    const ok = document.getElementById('impactPhrase').value === 'CONFIRM';
    document.getElementById('impactPhrase').classList.toggle('valid', ok);
    document.getElementById('impactDeleteBtn').disabled = !ok;
}

document.getElementById('impactBackdrop').addEventListener('click', e => { if (e.target === e.currentTarget) closeImpactModal(); });

async function executeRowDelete() {
    if (document.getElementById('impactPhrase').value !== 'CONFIRM') return;
    const btn = document.getElementById('impactDeleteBtn');
    const sp  = document.getElementById('impactSpinner');
    const ic  = document.getElementById('impactIcon');
    btn.disabled = true; sp.style.display = 'inline-block'; ic.style.display = 'none';
    try {
        const res  = await apiFetch('/api/admin/rows', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tableName: viewerMeta.key, ids: [...viewerSelectedIds] })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Delete failed');
        const cascadeInfo = Object.entries(data.results.cascaded || {}).map(([t,n]) => `${n} ${t}`).join(', ');
        toast(`✓ Deleted ${data.results.deleted} row(s)${cascadeInfo ? ' + cascaded: ' + cascadeInfo : ''}`, 'success');
        closeImpactModal();
        viewerSelectedIds.clear();
        await openViewer(viewerMeta.key);
        loadStats();
    } catch(e) {
        toast('Delete failed: ' + e.message, 'danger');
    } finally {
        btn.disabled = false; sp.style.display = 'none'; ic.style.display = 'inline-block';
    }
}
function renderPagination(page, pages, total) {
    document.getElementById('pagInfo').textContent = `Page ${page} of ${pages} — ${total.toLocaleString()} rows`;
    const ctrl = document.getElementById('pagControls');
    if (pages <= 1) { ctrl.innerHTML = ''; return; }

    let html = `<button class="pag-btn" onclick="goPage(1)" ${page===1?'disabled':''}>«</button>`;
    html    += `<button class="pag-btn" onclick="goPage(${page-1})" ${page===1?'disabled':''}>‹</button>`;

    const range = 2;
    let lo = Math.max(1, page - range), hi = Math.min(pages, page + range);
    if (lo > 1) html += `<button class="pag-btn" onclick="goPage(1)">1</button>${lo > 2 ? '<span style="color:var(--text-muted);padding:0 4px">…</span>' : ''}`;
    for (let i = lo; i <= hi; i++) html += `<button class="pag-btn ${i===page?'active':''}" onclick="goPage(${i})">${i}</button>`;
    if (hi < pages) html += `${hi < pages-1 ? '<span style="color:var(--text-muted);padding:0 4px">…</span>' : ''}<button class="pag-btn" onclick="goPage(${pages})">${pages}</button>`;

    html += `<button class="pag-btn" onclick="goPage(${page+1})" ${page===pages?'disabled':''}>›</button>`;
    html += `<button class="pag-btn" onclick="goPage(${pages})" ${page===pages?'disabled':''}>»</button>`;
    ctrl.innerHTML = html;
}

function goPage(p) { viewerPage = p; renderViewerTable(); }

// ── CSV Export ────────────────────────────────────────────────────────────
function exportCurrentTable() {
    if (!viewerMeta) return;
    exportRowsAsCSV(viewerMeta.key, viewerMeta.label, viewerFiltRows, viewerCols.filter(c => viewerVis[c]));
}

async function exportTable(tableKey) {
    const meta = tableMeta.find(t => t.key === tableKey);
    toast(`Loading ${meta?.label || tableKey}...`, 'info');
    try {
        const res  = await apiFetch('/api/admin/table-data/' + tableKey);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Load failed');
        exportRowsAsCSV(tableKey, meta?.label || tableKey, data.rows, data.columns);
        toast(`✓ Exported ${data.total.toLocaleString()} records from ${meta?.label || tableKey}`, 'success');
    } catch(e) { toast('Export failed: ' + e.message, 'danger'); }
}

function exportRowsAsCSV(tableKey, label, rows, cols) {
    if (!rows.length && !cols.length) { toast('No data to export.', 'info'); return; }
    const header = cols.join(',');
    const body   = rows.map(row =>
        cols.map(c => {
            const v = row[c];
            if (v === null || v === undefined) return '';
            const s = String(v);
            return s.includes(',') || s.includes('"') || s.includes('\n') ? '"' + s.replace(/"/g,'""') + '"' : s;
        }).join(',')
    ).join('\n');
    const csv  = header + '\n' + body;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), {
        href: url,
        download: tableKey + '_' + new Date().toISOString().slice(0,10) + '.csv'
    });
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ══════════════════════════════════════════════════════════════════════════
// PURGE CONFIRM
// ══════════════════════════════════════════════════════════════════════════
function openConfirm() {
    if (selected.size === 0) return;
    document.getElementById('confirmSummary').innerHTML = [...selected].map(key => {
        const t   = tableMeta.find(x => x.key === key);
        const cnt = tableCounts[key] || 0;
        return `<div class="del-item">
            <span class="name"><i class="${t.icon}" style="color:${t.color};margin-right:.4rem"></i>${t.label}</span>
            <span class="cnt">${cnt.toLocaleString()}</span>
        </div>`;
    }).join(_EMPTY_JOIN);
    document.getElementById('confirmPhrase').value = '';
    document.getElementById('confirmPurgeBtn').disabled = true;
    document.getElementById('confirmBackdrop').classList.add('show');
    setTimeout(() => document.getElementById('confirmPhrase').focus(), 80);
}

function closeConfirm() { document.getElementById('confirmBackdrop').classList.remove('show'); }

function checkPhrase() {
    const ok = document.getElementById('confirmPhrase').value === 'DELETE FOREVER';
    document.getElementById('confirmPhrase').classList.toggle('valid', ok);
    document.getElementById('confirmPurgeBtn').disabled = !ok;
}

document.getElementById('confirmBackdrop').addEventListener('click', e => { if (e.target === e.currentTarget) closeConfirm(); });

async function executePurge() {
    if (document.getElementById('confirmPhrase').value !== 'DELETE FOREVER') return;
    const btn = document.getElementById('confirmPurgeBtn');
    const sp  = document.getElementById('purgeSpinner');
    const ic  = document.getElementById('purgeIcon');
    btn.disabled = true; sp.style.display = 'inline-block'; ic.style.display = 'none';
    try {
        const res  = await apiFetch('/api/admin/purge', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tables: [...selected] }) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Purge failed');
        closeConfirm();
        const totalDel = Object.values(data.results).reduce((a,b)=>a+b, 0);
        toast(`✓ Purged ${Object.keys(data.results).length} table(s) — ${totalDel.toLocaleString()} records deleted`, 'success');
        selected.clear();
        await loadStats();
    } catch(e) { toast('Error: ' + e.message, 'danger'); }
    finally { btn.disabled = false; sp.style.display = 'none'; ic.style.display = 'inline-block'; }
}

// ── Helpers ───────────────────────────────────────────────────────────────
async function apiFetch(url, opts = {}) {
    const res = await fetch(url, { ...opts, headers: { 'Authorization': 'Bearer ' + TOKEN, ...(opts.headers || {}) } });
    if (res.status === 401) { window.rxNav('/login'); return res; }
    if (res.status === 403) { document.getElementById('mainWrap').style.display = 'none'; document.getElementById('deniedWrap').style.display = 'block'; return res; }
    return res;
}

function toast(msg, type = 'info') {
    const wrap = document.getElementById('toastWrap');
    const el   = document.createElement('div');
    el.className = `bo-toast ${type}`;
    el.innerHTML = `<i class="fas ${type==='success'?'fa-check-circle':type==='danger'?'fa-exclamation-circle':'fa-info-circle'}"></i> ${msg}`;
    wrap.appendChild(el);
    setTimeout(() => el.remove(), 5000);
}

// ══════════════════════════════════════════════════════════════════════════
// TAB SWITCHER
// ══════════════════════════════════════════════════════════════════════════
function switchTab(tab) {
    const tabs  = ['tables','schema','orphans','dupes','audit','settings','backups','health','locks','users','errlog','analytics'];
    const ids   = { tables:'tablesContent', schema:'schemaContent', orphans:'orphanContent', dupes:'dupesContent', audit:'auditContent', settings:'settingsContent', backups:'backupsContent', health:'healthContent', locks:'locksContent', users:'usersContent', errlog:'errlogContent', analytics:'analyticsContent' };
    const btns  = { tables:'tabTables', schema:'tabSchema', orphans:'tabOrphans', dupes:'tabDupes', audit:'tabAudit', settings:'tabSettings', backups:'tabBackups', health:'tabHealth', locks:'tabLocks', users:'tabUsers', errlog:'tabErrlog', analytics:'tabAnalytics' };
    tabs.forEach(t => {
        document.getElementById(btns[t]).classList.toggle('active', t === tab);
        const el = document.getElementById(ids[t]);
        if (t === 'tables') el.style.display = t === tab ? '' : 'none';
        else el.classList.toggle('show', t === tab);
    });
    if (tab === 'schema'    && !schemaData)      loadSchema();
    if (tab === 'orphans'   && !orphanData)      loadOrphans();
    if (tab === 'dupes'     && !dupesData)       loadDupes();
    if (tab === 'audit'     && !auditLoaded)     loadAuditLogs(1);
    if (tab === 'settings'  && !settingsLoaded)  loadSettings();
    if (tab === 'backups'   && !backupsLoaded)   loadBackups();
    if (tab === 'health'    && !healthLoaded)    loadHealth();
    if (tab === 'locks'     && !locksLoaded)     loadLocks();
    if (tab === 'users'     && !usersLoaded)     loadUsers();
    if (tab === 'errlog'    && !errlogLoaded)    loadErrorLogs(1);
    if (tab === 'analytics' && !analyticsLoaded) loadAnalytics();
}

// ══════════════════════════════════════════════════════════════════════════
// SCHEMA & RELATIONSHIPS
// ══════════════════════════════════════════════════════════════════════════
let schemaData     = null;   // full API response
let schemaFiltered = [];     // filtered tables list
let activeSchemaTable = null;

async function loadSchema() {
    document.getElementById('schemaSideList').innerHTML = '<p style="padding:1rem;color:var(--text-muted);font-size:0.8rem"><i class="fas fa-spinner fa-spin me-2"></i>Loading...</p>';
    try {
        const res  = await apiFetch('/api/admin/schema');
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed');
        schemaData = data;
        schemaFiltered = data.tables;
        renderSchemaSidebar();
        renderAllFKList();
    } catch(e) {
        document.getElementById('schemaSideList').innerHTML = `<p style="padding:1rem;color:#fca5a5;font-size:0.8rem">${e.message}</p>`;
    }
}

function filterSchema() {
    const q = document.getElementById('schemaSearch').value.toLowerCase();
    if (!schemaData) return;
    schemaFiltered = schemaData.tables.filter(t =>
        !q || t.name.toLowerCase().includes(q) || t.columns.some(c => c.name.toLowerCase().includes(q))
    );
    renderSchemaSidebar();
    if (activeSchemaTable) {
        const still = schemaFiltered.find(t => t.name === activeSchemaTable);
        if (still) renderSchemaDetail(activeSchemaTable);
        else { activeSchemaTable = null; resetSchemaMain(); }
    }
}

function resetSchemaMain() {
    document.getElementById('schemaMain').innerHTML = '<div style="text-align:center;padding:4rem 2rem;color:var(--text-muted)"><i class="fas fa-mouse-pointer" style="font-size:2rem;opacity:0.3;display:block;margin-bottom:1rem"></i><p>Select a table from the list to view its columns and relationships.</p></div>';
}

const TABLE_COLORS = [
    '#6366f1','#10b981','#f59e0b','#ef4444','#06b6d4','#8b5cf6',
    '#f97316','#14b8a6','#3b82f6','#84cc16','#ec4899','#eab308',
    '#a855f7','#22c55e','#0ea5e9','#e11d48','#0891b2','#65a30d'
];
function tableColor(name) { let h=0; for(let c of name) h=(h*31+c.charCodeAt(0))&0xffffff; return TABLE_COLORS[h % TABLE_COLORS.length]; }

function renderSchemaSidebar() {
    const tables = schemaFiltered;
    document.getElementById('schemaTblCount').textContent = tables.length + ' tables';
    document.getElementById('schemaSideList').innerHTML = tables.map(t => {
        const fkCount = t.columns.filter(c => c.isFK).length;
        const col = tableColor(t.name);
        const isActive = t.name === activeSchemaTable;
        return `<div class="schema-tbl-item ${isActive ? 'active' : ''}" onclick="renderSchemaDetail('${t.name}')">
            <div class="tbl-dot" style="background:${col}"></div>
            <span>${t.name}</span>
            ${fkCount > 0 ? `<span class="fk-count">${fkCount} FK</span>` : ''}
        </div>`;
    }).join(_EMPTY_JOIN);
}

function renderSchemaDetail(tableName) {
    activeSchemaTable = tableName;
    // Update sidebar active state
    document.querySelectorAll('.schema-tbl-item').forEach(el => {
        el.classList.toggle('active', el.textContent.trim().startsWith(tableName));
    });

    const tbl = schemaData.tables.find(t => t.name === tableName);
    if (!tbl) return;
    const col = tableColor(tableName);

    // Find who references this table (incoming FKs)
    const incomingFKs = schemaData.relationships.filter(r => r.to_table === tableName);
    // Outgoing FKs
    const outgoingFKs = schemaData.relationships.filter(r => r.from_table === tableName);

    const colRows = tbl.columns.map(c => {
        const badges = [
            c.isPK ? '<span class="badge-pk">PK</span>' : '',
            c.isFK ? '<span class="badge-fk">FK</span>' : '',
            !c.nullable && !c.isPK ? '<span class="badge-nn">NOT NULL</span>' : ''
        ].join(_EMPTY_JOIN);
        const fkRef = c.references
            ? `<div class="fk-ref"><i class="fas fa-arrow-right"></i><span class="fk-target" onclick="renderSchemaDetail('${c.references.toTable}')">${c.references.toTable}.${c.references.toColumn}</span></div>`
            : '';
        return `<tr>
            <td><span class="col-name">${c.name}</span> ${badges}</td>
            <td><span class="col-type">${c.type}</span></td>
            <td>${c.nullable ? '<span style="color:var(--text-muted);font-size:0.7rem">NULL</span>' : '<span style="color:#6ee7b7;font-size:0.7rem">NOT NULL</span>'}</td>
            <td>${fkRef}</td>
        </tr>`;
    }).join(_EMPTY_JOIN);

    const refByChips = incomingFKs.length
        ? incomingFKs.map(r => `<span class="ref-chip" onclick="renderSchemaDetail('${r.from_table}')"><i class="fas fa-arrow-left"></i>${r.from_table}<span style="opacity:.6;font-size:0.65rem">.${r.from_column}</span></span>`).join(_EMPTY_JOIN)
        : '<span style="color:var(--text-muted);font-size:0.75rem">No other tables reference this table.</span>';

    document.getElementById('schemaMain').innerHTML = `
        <div class="schema-card">
            <div class="schema-card-header" style="border-left:3px solid ${col}">
                <div class="table-icon" style="background:${col}22;color:${col}"><i class="fas fa-table"></i></div>
                <div>
                    <h6>${tableName}</h6>
                    <div style="font-size:0.7rem;color:var(--text-muted)">${tbl.columns.length} columns &bull; ${outgoingFKs.length} outgoing FK &bull; ${incomingFKs.length} incoming FK</div>
                </div>
                <small>${tbl.columns.filter(c=>c.isPK).map(c=>c.name).join(', ') || 'no PK'}</small>
            </div>
            <table class="schema-col-table">
                <thead><tr><th>Column</th><th>Type</th><th>Nullable</th><th>References</th></tr></thead>
                <tbody>${colRows}</tbody>
            </table>
            <div class="ref-by-section">
                <div class="ref-by-title"><i class="fas fa-arrow-left me-1"></i>Referenced by (incoming FKs)</div>
                <div class="ref-by-chips">${refByChips}</div>
            </div>
        </div>`;
}

function renderAllFKList() {
    const rels = schemaData.relationships;
    document.getElementById('fkTotalCount').textContent = rels.length + ' relationships';
    if (!rels.length) {
        document.getElementById('allFKList').innerHTML = '<p style="text-align:center;padding:2rem;color:var(--text-muted)">No foreign key relationships found.</p>';
        return;
    }
    // Build rows using string concat (no nested template literals — FortiGate compat)
    var _relRows = '';
    rels.forEach(function(r) {
        _relRows += '<div class="fk-row">' +
            '<span class="fk-from"><span style="cursor:pointer;border-bottom:1px dashed rgba(255,255,255,0.15)" onclick="renderSchemaDetail(\'' + r.from_table + '\');switchTab(\'schema\')">' + r.from_table + '</span><span style="color:var(--text-muted)">.' + r.from_column + '</span></span>' +
            '<span class="fk-arrow"><i class="fas fa-long-arrow-alt-right"></i></span>' +
            '<span class="fk-to"><span style="cursor:pointer;border-bottom:1px dashed rgba(99,102,241,0.4)" onclick="renderSchemaDetail(\'' + r.to_table + '\');switchTab(\'schema\')">' + r.to_table + '</span><span style="color:var(--text-muted)">.' + r.to_column + '</span></span>' +
        '</div>';
    });
    document.getElementById('allFKList').innerHTML =
        '<div style="padding:0.5rem 1.125rem;border-bottom:1px solid var(--border);display:grid;grid-template-columns:1fr 40px 1fr;gap:0.5rem">' +
            '<span style="font-size:0.68rem;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;color:var(--text-muted)">From (Table.Column)</span>' +
            '<span></span>' +
            '<span style="font-size:0.68rem;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;color:var(--text-muted)">To (Table.Column)</span>' +
        '</div>' + _relRows;
}

// ══════════════════════════════════════════════════════════════════════════
// ORPHAN RECORD DETECTOR
// ══════════════════════════════════════════════════════════════════════════
let orphanData = null;

async function loadOrphans() {
    document.getElementById('orphanList').innerHTML = '<p style="text-align:center;padding:3rem;color:var(--text-muted)"><i class="fas fa-spinner fa-spin me-2"></i>Scanning all FK relationships...</p>';
    document.getElementById('orphanStatus').innerHTML = '';
    try {
        const res  = await apiFetch('/api/admin/orphans');
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Scan failed');
        orphanData = data;
        renderOrphans();
    } catch(e) {
        document.getElementById('orphanList').innerHTML = `<p style="color:#fca5a5;padding:2rem">${e.message}</p>`;
    }
}

function renderOrphans() {
    const d = orphanData;
    const statusColor = d.clean ? '#6ee7b7' : '#fbbf24';
    const statusIcon  = d.clean ? 'fa-check-circle' : 'fa-exclamation-triangle';
    document.getElementById('orphanStatus').innerHTML = `
        <div style="background:${d.clean ? 'rgba(16,185,129,0.08)' : 'rgba(251,191,36,0.08)'};border:1px solid ${d.clean ? 'rgba(16,185,129,0.2)' : 'rgba(251,191,36,0.2)'};border-radius:8px;padding:0.75rem 1rem;display:flex;align-items:center;gap:0.75rem">
            <i class="fas ${statusIcon}" style="color:${statusColor};font-size:1.2rem"></i>
            <div>
                <div style="font-weight:700;color:${statusColor}">${d.clean ? '✔ Database is clean' : '⚠ ' + d.totalOrphans.toLocaleString() + ' orphaned record(s) found'}</div>
                <div style="font-size:0.75rem;color:var(--text-muted)">${d.results.length} FK relationships checked</div>
            </div>
        </div>`;

    const rows = d.results.map(r => `
        <div class="schema-card" style="margin-bottom:0.5rem">
            <div style="padding:0.75rem 1rem;display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap">
                <div style="display:flex;align-items:center;gap:0.75rem">
                    <div style="width:10px;height:10px;border-radius:50%;background:${r.clean ? '#10b981' : '#f59e0b'};flex-shrink:0"></div>
                    <div>
                        <span style="font-family:monospace;font-size:0.82rem;color:${r.clean ? 'var(--text)' : '#fbbf24'}">
                            ${r.childTable}.<span style="color:#a5b4fc">${r.childCol}</span>
                        </span>
                        <span style="color:var(--text-muted);margin:0 0.4rem">→</span>
                        <span style="font-family:monospace;font-size:0.82rem;color:var(--text-muted)">${r.parentTable}.${r.parentCol}</span>
                    </div>
                </div>
                <div style="display:flex;align-items:center;gap:0.75rem">
                    <span style="font-size:0.85rem;font-weight:700;color:${r.clean ? '#6ee7b7' : '#f59e0b'}">
                        ${r.clean ? '✔ Clean' : r.orphanCount.toLocaleString() + ' orphans'}
                    </span>
                    ${!r.clean ? `<button class="btn-bo btn-bo-danger" onclick="cleanOrphans('${r.childTable}','${r.childCol}','${r.parentTable}','${r.parentCol}',this)" style="padding:0.3rem 0.7rem;font-size:0.72rem">
                        <i class="fas fa-broom me-1"></i>Clean Up
                    </button>` : ''}
                </div>
            </div>
        </div>`);
    document.getElementById('orphanList').innerHTML = rows.join(_EMPTY_JOIN);
}

async function cleanOrphans(childTable, childCol, parentTable, parentCol, btn) {
    if (!confirm(`Delete all orphaned rows in ${childTable} where ${childCol} has no matching ${parentTable}?`)) return;
    btn.disabled = true; btn.innerHTML = '<span class="spinner-sm"></span> Cleaning...';
    try {
        const res  = await apiFetch('/api/admin/orphans', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ childTable, childCol, parentTable, parentCol })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Clean failed');
        toast(`✓ Cleaned ${data.deleted} orphaned rows from ${childTable}`, 'success');
        await loadOrphans(); // re-scan
    } catch(e) { toast('Clean failed: ' + e.message, 'danger'); btn.disabled = false; btn.innerHTML = '<i class="fas fa-broom me-1"></i>Clean Up'; }
}

// ══════════════════════════════════════════════════════════════════════════
// DUPLICATE PATIENT FINDER
// ══════════════════════════════════════════════════════════════════════════
let dupesData = null;
let dupeTabMode = 'name'; // 'name' or 'phone'

async function loadDupes() {
    document.getElementById('dupesList').innerHTML = '<p style="text-align:center;padding:3rem;color:var(--text-muted)"><i class="fas fa-spinner fa-spin me-2"></i>Scanning patients...</p>';
    document.getElementById('dupesStatus').innerHTML = '';
    try {
        const res  = await apiFetch('/api/admin/duplicates');
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Scan failed');
        dupesData = data;
        renderDupes();
    } catch(e) {
        document.getElementById('dupesList').innerHTML = `<p style="color:#fca5a5;padding:2rem">${e.message}</p>`;
    }
}

function switchDupeTab(mode) {
    dupeTabMode = mode;
    document.getElementById('dupeTabName').classList.toggle('active', mode === 'name');
    document.getElementById('dupeTabPhone').classList.toggle('active', mode === 'phone');
    if (dupesData) renderDupes();
}

function renderDupes() {
    const groups = dupeTabMode === 'name' ? dupesData.byName : dupesData.byPhone;
    const total  = dupeTabMode === 'name' ? dupesData.totalNameGroups : dupesData.totalPhoneGroups;
    const label  = dupeTabMode === 'name' ? 'full name' : 'phone number';

    if (!total) {
        document.getElementById('dupesStatus').innerHTML = `<div style="background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.2);border-radius:8px;padding:0.75rem 1rem;color:#6ee7b7;font-weight:600">✔ No duplicate patients found by ${label}.</div>`;
        document.getElementById('dupesList').innerHTML = '';
        return;
    }
    document.getElementById('dupesStatus').innerHTML = `<div style="background:rgba(251,191,36,0.08);border:1px solid rgba(251,191,36,0.2);border-radius:8px;padding:0.75rem 1rem;color:#fbbf24;font-weight:600">⚠ ${total} duplicate group(s) found by ${label}</div>`;

    // Build using string concat — no nested template literals (FortiGate compat)
    var _dupeCards = '';
    groups.forEach(function(g) {
        var recs = typeof g.records === 'string' ? JSON.parse(g.records) : g.records;
        var _rows = '';
        recs.forEach(function(p, idx) {
            var _inactive = p.isActive === false ? '<span style="color:#fca5a5;margin-left:0.3rem">(inactive)</span>' : '';
            var _action = idx > 0
                ? '<button class="btn-bo btn-bo-danger" style="padding:0.28rem 0.6rem;font-size:0.7rem" onclick="deleteDupPatient(' + p.id + ', this)"><i class="fas fa-trash-alt me-1"></i>Delete</button>'
                : '<span style="font-size:0.68rem;color:#6ee7b7;font-weight:600">KEEP</span>';
            _rows +=
                '<div style="display:flex;align-items:center;justify-content:space-between;padding:0.5rem 1rem;border-bottom:1px solid var(--border);gap:0.5rem;flex-wrap:wrap">' +
                    '<div style="display:flex;align-items:center;gap:0.75rem">' +
                        '<span style="background:rgba(99,102,241,0.15);color:#a5b4fc;border-radius:50%;width:26px;height:26px;display:flex;align-items:center;justify-content:center;font-size:0.7rem;font-weight:700;flex-shrink:0">ID' + p.id + '</span>' +
                        '<div>' +
                            '<div style="font-weight:600;font-size:0.85rem">' + p.firstName + ' ' + p.lastName + '</div>' +
                            '<div style="font-size:0.72rem;color:var(--text-muted)">' +
                                'DOB: ' + (p.dob || '\u2014') + ' &bull; Phone: ' + (p.phone || '\u2014') + ' &bull; ' +
                                'Added: ' + (p.createdAt ? new Date(p.createdAt).toLocaleDateString() : '\u2014') +
                                _inactive +
                            '</div>' +
                        '</div>' +
                    '</div>' +
                    _action +
                '</div>';
        });
        _dupeCards +=
            '<div class="schema-card" style="margin-bottom:0.75rem">' +
                '<div style="padding:0.625rem 1rem;background:var(--surface-2);border-bottom:1px solid var(--border);display:flex;align-items:center;gap:0.5rem">' +
                    '<i class="fas fa-users" style="color:#f59e0b"></i>' +
                    '<span style="font-weight:700;font-size:0.82rem">' + g.match_key + '</span>' +
                    '<span style="margin-left:auto;font-size:0.72rem;background:rgba(251,191,36,0.15);border:1px solid rgba(251,191,36,0.3);color:#fbbf24;border-radius:4px;padding:0.1rem 0.4rem">' + g.cnt + ' records</span>' +
                '</div>' +
                _rows +
            '</div>';
    });
    document.getElementById('dupesList').innerHTML = _dupeCards;
}


async function deleteDupPatient(id, btn) {
    if (!confirm(`Permanently delete patient ID ${id} and all related RX records?`)) return;
    btn.disabled = true; btn.innerHTML = '<span class="spinner-sm"></span>';
    try {
        const res  = await apiFetch('/api/admin/rows', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tableName: 'Patients', ids: [String(id)] })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Delete failed');
        toast(`✓ Patient ${id} deleted`, 'success');
        await loadDupes();
        loadStats();
    } catch(e) { toast('Delete failed: ' + e.message, 'danger'); btn.disabled = false; btn.innerHTML = '<i class="fas fa-trash-alt me-1"></i>Delete'; }
}

// ══════════════════════════════════════════════════════════════════════════
// AUDIT LOG VIEWER
// ══════════════════════════════════════════════════════════════════════════
let auditLoaded = false;
let auditCurrentPage = 1;
let auditDebounceTimer = null;

function auditDebounce() {
    clearTimeout(auditDebounceTimer);
    auditDebounceTimer = setTimeout(() => loadAuditLogs(1), 450);
}

function clearAuditFilters() {
    ['auditSearch','auditEntity','auditDateFrom','auditDateTo'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('auditAction').value = '';
    loadAuditLogs(1);
}

async function loadAuditLogs(page) {
    auditCurrentPage = page || 1;
    const params = new URLSearchParams({
        page: auditCurrentPage,
        size: 50,
        search:   document.getElementById('auditSearch')?.value   || '',
        action:   document.getElementById('auditAction')?.value   || '',
        entity:   document.getElementById('auditEntity')?.value   || '',
        dateFrom: document.getElementById('auditDateFrom')?.value || '',
        dateTo:   document.getElementById('auditDateTo')?.value   || '',
    });
    document.getElementById('auditList').innerHTML = '<p style="text-align:center;padding:2rem;color:var(--text-muted)"><i class="fas fa-spinner fa-spin me-2"></i>Loading...</p>';
    try {
        const res  = await apiFetch('/api/admin/audit-logs?' + params);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed');
        auditLoaded = true;

        // Populate action dropdown on first load
        if (data.actions && data.actions.length) {
            const sel = document.getElementById('auditAction');
            const cur = sel.value;
            sel.innerHTML = '<option value="">All Actions</option>' + data.actions.map(a => `<option value="${a}" ${a===cur?'selected':''}>${a}</option>`).join(_EMPTY_JOIN);
        }

        document.getElementById('auditStatus').textContent = `Showing ${data.rows.length} of ${data.total.toLocaleString()} entries | Page ${data.page} of ${data.pages}`;

        if (!data.rows.length) {
            document.getElementById('auditList').innerHTML = '<p style="text-align:center;padding:3rem;color:var(--text-muted)">No audit log entries match your filters.</p>';
            document.getElementById('auditPagination').innerHTML = '';
            return;
        }

        const ACTION_COLORS = {
            CREATE: '#10b981', UPDATE: '#6366f1', DELETE: '#ef4444', LOGIN: '#06b6d4',
            LOGOUT: '#64748b', BACKOFFICE_ROW_DELETE: '#f97316', PURGE: '#dc2626',
        };
        function actionColor(a) {
            for (const [k, v] of Object.entries(ACTION_COLORS)) if (a && a.startsWith(k)) return v;
            return '#94a3b8';
        }

        // Build rows outside template literal (no nested templates — FortiGate compat)
        var _auditRows = '';
        data.rows.forEach(function(r) {
            var _ac = actionColor(r.action);
            var _user = r.firstName ? r.firstName + ' ' + r.lastName :
                        (r.userId ? 'User #' + r.userId : '<span style="color:var(--text-muted)">System</span>');
            var _entityId = r.entityId ? ' <span style="color:var(--text-muted);font-size:0.7rem">#' + r.entityId + '</span>' : '';
            var _details = String(r.details || '').replace(/"/g, '&quot;');
            _auditRows +=
                '<tr style="border-bottom:1px solid rgba(255,255,255,0.04)" onmouseover="this.style.background=\'rgba(255,255,255,0.02)\'" onmouseout="this.style.background=\'\'">' +
                    '<td style="padding:0.45rem 0.875rem;color:var(--text-muted);white-space:nowrap">' + new Date(r.createdAt).toLocaleString() + '</td>' +
                    '<td style="padding:0.45rem 0.875rem;white-space:nowrap">' + _user + '</td>' +
                    '<td style="padding:0.45rem 0.875rem;white-space:nowrap"><span style="font-size:0.65rem;font-weight:700;border-radius:4px;padding:0.15rem 0.45rem;background:' + _ac + '22;color:' + _ac + ';border:1px solid ' + _ac + '44">' + (r.action || '\u2014') + '</span></td>' +
                    '<td style="padding:0.45rem 0.875rem;color:#a5b4fc">' + (r.entity || '\u2014') + _entityId + '</td>' +
                    '<td style="padding:0.45rem 0.875rem;color:var(--text-muted);max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + _details + '">' + (r.details || '\u2014') + '</td>' +
                '</tr>';
        });

        document.getElementById('auditList').innerHTML =
            '<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden">' +
            '<table style="width:100%;border-collapse:collapse;font-size:0.78rem">' +
                '<thead><tr style="background:var(--surface-2);border-bottom:1px solid var(--border)">' +
                    '<th style="padding:0.5rem 0.875rem;text-align:left;color:var(--text-muted);font-size:0.68rem;text-transform:uppercase;letter-spacing:.07em">Time</th>' +
                    '<th style="padding:0.5rem 0.875rem;text-align:left;color:var(--text-muted);font-size:0.68rem;text-transform:uppercase;letter-spacing:.07em">User</th>' +
                    '<th style="padding:0.5rem 0.875rem;text-align:left;color:var(--text-muted);font-size:0.68rem;text-transform:uppercase;letter-spacing:.07em">Action</th>' +
                    '<th style="padding:0.5rem 0.875rem;text-align:left;color:var(--text-muted);font-size:0.68rem;text-transform:uppercase;letter-spacing:.07em">Module</th>' +
                    '<th style="padding:0.5rem 0.875rem;text-align:left;color:var(--text-muted);font-size:0.68rem;text-transform:uppercase;letter-spacing:.07em">Record</th>' +
                    '<th style="padding:0.5rem 0.875rem;text-align:left;color:var(--text-muted);font-size:0.68rem;text-transform:uppercase;letter-spacing:.07em">Changes</th>' +
                '</tr></thead>' +
                '<tbody>' + _auditRows + '</tbody>' +
            '</table></div>';


        // Pagination
        let pag = '';
        if (data.pages > 1) {
            if (page > 1) pag += `<button class="pag-btn" onclick="loadAuditLogs(${page-1})">&#8249;</button>`;
            const lo = Math.max(1, page-2), hi = Math.min(data.pages, page+2);
            if (lo > 1) pag += `<button class="pag-btn" onclick="loadAuditLogs(1)">1</button>${lo>2 ? '<span style="padding:0 4px;color:var(--text-muted)">…</span>' : ''}`;
            for (let i=lo; i<=hi; i++) pag += `<button class="pag-btn ${i===page?'active':''}" onclick="loadAuditLogs(${i})">${i}</button>`;
            if (hi < data.pages) pag += `${hi<data.pages-1 ? '<span style="padding:0 4px;color:var(--text-muted)">…</span>' : ''}<button class="pag-btn" onclick="loadAuditLogs(${data.pages})">${data.pages}</button>`;
            if (page < data.pages) pag += `<button class="pag-btn" onclick="loadAuditLogs(${page+1})">&#8250;</button>`;
        }
        document.getElementById('auditPagination').innerHTML = pag;
    } catch(e) {
        document.getElementById('auditList').innerHTML = `<p style="color:#fca5a5;padding:2rem">${e.message}</p>`;
    }
}