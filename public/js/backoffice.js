/* FortiGate compat: no template literals, no arrows, no spread, no ??, no ?. */
var _EMPTY_JOIN = '';

var TOKEN = localStorage.getItem('token');
var USER  = JSON.parse(localStorage.getItem('user') || '{}');

var tableMeta    = [];
var tableCounts  = {};
var selected     = new Set();

// ── Viewer state ──────────────────────────────────────────────────────────
var viewerRows    = [];
var viewerCols    = [];
var viewerVis     = {};
var viewerFilter  = '';
var viewerFiltRows = [];
var viewerPage    = 1;
var viewerPageSize= 20; // BO-08: default preview size
var viewerSortCol = null;
var viewerSortDir = 'asc';
var viewerMeta    = null;

// ── Auth Guard ────────────────────────────────────────────────────────────
(function(){
    var roleId = USER.roleId || USER.role;
    var isAdmin = roleId === 1 || roleId === 'Administrator';
    if (!isAdmin) {
        document.getElementById('deniedWrap').style.display = 'block';
    } else {
        document.getElementById('mainWrap').style.display = 'block';
        document.getElementById('userBadge').textContent = (USER.firstName || '') + ' \u2014 Administrator';
        loadStats();
    }
})();

// ── apiFetch helper ────────────────────────────────────────────────────────
async function apiFetch(url, opts) {
    if (!opts) opts = {};
    var headers = Object.assign({ 'Authorization': 'Bearer ' + TOKEN }, opts.headers || {});
    var res = await fetch(window.rxUrl ? window.rxUrl(url) : url, Object.assign({}, opts, { headers: headers, credentials: 'include' }));
    if (res.status === 401) { if (window.rxNav) window.rxNav('/login'); else window.location.href = '/login'; return res; }
    if (res.status === 403) {
        var mw = document.getElementById('mainWrap'); var dw = document.getElementById('deniedWrap');
        if (mw) mw.style.display = 'none'; if (dw) dw.style.display = 'block';
        return res;
    }
    return res;
}

// ── toast helper ──────────────────────────────────────────────────────────
function toast(msg, type) {
    if (!type) type = 'info';
    var wrap = document.getElementById('toastWrap');
    if (!wrap) return;
    var el = document.createElement('div');
    el.className = 'bo-toast ' + type;
    var icon = type === 'success' ? 'fa-check-circle' : type === 'danger' ? 'fa-exclamation-circle' : 'fa-info-circle';
    el.innerHTML = '<i class="fas ' + icon + '"></i> ' + msg;
    wrap.appendChild(el);
    setTimeout(function() { if (el.parentNode) el.parentNode.removeChild(el); }, 5000);
}

// ── Load Stats ────────────────────────────────────────────────────────────
async function loadStats() {
    document.getElementById('refreshBtn').innerHTML = '<span class="spinner-sm"></span>';
    try {
        var res  = await apiFetch('/api/admin/stats');
        var data = await res.json();
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
    var total = 0;
    var nonEmpty = 0;
    Object.keys(tableCounts).forEach(function(k) { total += tableCounts[k]; if (tableCounts[k] > 0) nonEmpty++; });
    document.getElementById('statsRow').innerHTML =
        '<div class="stat-pill"><div class="num" style="color:#6366f1">' + tableMeta.length + '</div><div class="lbl">Tables</div></div>' +
        '<div class="stat-pill"><div class="num" style="color:#ef4444">' + total.toLocaleString() + '</div><div class="lbl">Total Records</div></div>' +
        '<div class="stat-pill"><div class="num" style="color:#10b981">' + nonEmpty + '</div><div class="lbl">With Data</div></div>' +
        '<div class="stat-pill"><div class="num" style="color:#f59e0b">' + selected.size + '</div><div class="lbl">Selected</div></div>';
}

// ── Render Grid ───────────────────────────────────────────────────────────
function renderGrid() {
    var _grid = '';
    tableMeta.forEach(function(t) {
        var count = tableCounts[t.key] || 0;
        var isSel = selected.has(t.key);
        var deps  = t.dependsOn && t.dependsOn.length > 0;
        var depBadge = deps ? '<span class="dep-badge"><i class="fas fa-link me-1"></i>child of ' + t.dependsOn.join(', ') + '</span>' : '';
        var selBtn = isSel ? '<i class="fas fa-minus"></i> Remove' : '<i class="fas fa-trash-alt"></i> Select';
        _grid +=
            '<div class="table-card ' + (isSel ? 'selected' : '') + '" id="card_' + t.key + '" style="--card-color:' + t.color + '">' +
                '<div class="tc-top">' +
                    '<div class="tc-left">' +
                        '<div class="table-icon" style="background:' + t.color + '22;color:' + t.color + '"><i class="' + t.icon + '"></i></div>' +
                        '<div><div class="table-name">' + t.label + '</div>' + depBadge + '</div>' +
                    '</div>' +
                    '<div class="check-dot" onclick="toggleCard(\'' + t.key + '\')"><i class="fas fa-check"></i></div>' +
                '</div>' +
                '<div class="table-desc">' + (t.description||'') + '</div>' +
                '<div class="tc-count ' + (count===0?'count-zero':'') + '" style="color:' + (count>0?t.color:'var(--text-muted)') + '">' +
                    count.toLocaleString() + ' <span>records</span>' +
                '</div>' +
                '<div class="tc-actions">' +
                    '<button class="tc-btn tc-btn-view"   onclick="openViewer(\'' + t.key + '\')"><i class="fas fa-eye"></i> View</button>' +
                    '<button class="tc-btn tc-btn-export" onclick="exportTable(\'' + t.key + '\')"><i class="fas fa-file-csv"></i> Export CSV</button>' +
                    '<button class="tc-btn tc-btn-select" onclick="toggleCard(\'' + t.key + '\')">' + selBtn + '</button>' +
                '</div>' +
            '</div>';
    });
    document.getElementById('tablesGrid').innerHTML = _grid;
}

function toggleCard(key) {
    if (selected.has(key)) selected.delete(key);
    else selected.add(key);
    var card = document.getElementById('card_' + key);
    if (card) {
        card.classList.toggle('selected', selected.has(key));
        var sel  = card.querySelector('.tc-btn-select');
        var dot  = card.querySelector('.check-dot');
        if (sel) sel.innerHTML = selected.has(key) ? '<i class="fas fa-minus"></i> Remove' : '<i class="fas fa-trash-alt"></i> Select';
        if (dot) dot.innerHTML = '<i class="fas fa-check"></i>';
    }
    updateActionBar();
    renderStatsRow();
}

function selectAll(val) {
    tableMeta.forEach(function(t) { if(val) selected.add(t.key); else selected.delete(t.key); });
    renderGrid();
    updateActionBar();
    renderStatsRow();
}

function updateActionBar() {
    var _selArr = [];
    selected.forEach(function(k) { _selArr.push(k); });
    var totalRecs = _selArr.reduce(function(s,k) { return s + (tableCounts[k]||0); }, 0);
    document.getElementById('selCount').textContent       = selected.size;
    document.getElementById('selRecordCount').textContent = totalRecs.toLocaleString();
    document.getElementById('purgeBtn').disabled          = selected.size === 0;
}

// ══════════════════════════════════════════════════════════════════════════
// DATA VIEWER
// ══════════════════════════════════════════════════════════════════════════

async function openViewer(tableKey) {
    var _found = null;
    tableMeta.forEach(function(t) { if (t.key === tableKey) _found = t; });
    viewerMeta = _found;
    document.getElementById('viewerTitle').textContent = (viewerMeta && viewerMeta.label) || tableKey;
    document.getElementById('viewerDesc').textContent  = (viewerMeta && viewerMeta.description) || '';
    var icon = document.getElementById('viewerIcon');
    icon.style.background = ((viewerMeta && viewerMeta.color) || '#6366f1') + '22';
    icon.style.color      = (viewerMeta && viewerMeta.color) || '#6366f1';
    icon.innerHTML        = '<i class="' + ((viewerMeta && viewerMeta.icon) || 'fas fa-table') + '"></i>';

    document.getElementById('viewerBadge').textContent = 'Loading...';
    document.getElementById('viewerSearch').value = '';
    viewerFilter  = '';
    viewerPage    = 1;
    viewerSortCol = null;
    viewerSortDir = 'asc';
    document.getElementById('viewerTableWrap').innerHTML = '<p class="no-rows"><i class="fas fa-spinner fa-spin me-2"></i>Loading...</p>';
    document.getElementById('viewerOverlay').classList.add('show');

    try {
        var res  = await apiFetch('/api/admin/table-data/' + tableKey);
        var data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Load failed');

        viewerRows  = data.rows;
        viewerCols  = data.columns;
        viewerVis = {};
        viewerCols.forEach(function(c) { viewerVis[c] = true; });

        renderColDropdown();
        applyViewerFilter();
        document.getElementById('viewerBadge').textContent = data.total.toLocaleString() + ' records';
    } catch(e) {
        document.getElementById('viewerTableWrap').innerHTML = '<p class="no-rows" style="color:#fca5a5"><i class="fas fa-exclamation-circle me-2"></i>' + e.message + '</p>';
    }
}

function closeViewer() {
    document.getElementById('viewerOverlay').classList.remove('show');
    document.getElementById('colDropdown').classList.remove('open');
}

// Column dropdown
function renderColDropdown() {
    var _cdHtml = '';
    viewerCols.forEach(function(c) {
        _cdHtml +=
            '<label class="col-item">' +
                '<input type="checkbox"' + (viewerVis[c] ? ' checked' : '') + ' onchange="toggleCol(\'' + c + '\',this.checked)">' +
                '<span>' + c + '</span>' +
            '</label>';
    });
    document.getElementById('colDropdown').innerHTML = _cdHtml;
}

function toggleColDropdown() {
    document.getElementById('colDropdown').classList.toggle('open');
}
document.addEventListener('click', function(e) {
    if (!e.target.closest('.col-toggle-wrap')) {
        var cd = document.getElementById('colDropdown');
        if (cd) cd.classList.remove('open');
    }
});
function toggleCol(col, val) { viewerVis[col] = val; renderViewerTable(); }

function applyViewerFilter() {
    viewerFilter  = document.getElementById('viewerSearch').value.toLowerCase();
    viewerPage    = 1;
    if (viewerFilter) {
        viewerFiltRows = viewerRows.filter(function(row) {
            return Object.values(row).some(function(v) {
                return v !== null && String(v).toLowerCase().indexOf(viewerFilter) >= 0;
            });
        });
    } else {
        viewerFiltRows = viewerRows;
    }
    applySortToFiltRows();
    renderViewerTable();
}

function applySortToFiltRows() {
    if (!viewerSortCol) return;
    var col = viewerSortCol;
    var dir = viewerSortDir;
    viewerFiltRows.sort(function(a, b) {
        var va = a[col], vb = b[col];
        if (va === null && vb === null) return 0;
        if (va === null) return 1; if (vb === null) return -1;
        var cmp = String(va).localeCompare(String(vb), undefined, { numeric: true });
        return dir === 'asc' ? cmp : -cmp;
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
    var visCols = viewerCols.filter(function(c) { return viewerVis[c]; });
    var total   = viewerFiltRows.length;
    var ps      = viewerPageSize || total;
    var pages   = ps ? Math.max(1, Math.ceil(total / ps)) : 1;
    viewerPage    = Math.min(viewerPage, pages);

    var start    = (viewerPage - 1) * ps;
    var end      = ps ? Math.min(start + ps, total) : total;
    var pageRows = viewerFiltRows.slice(start, end);

    document.getElementById('viewerInfo').textContent = 'Showing ' + (start+1) + '\u2013' + end + ' of ' + total.toLocaleString() + (viewerFilter ? ' (filtered)' : '');

    if (!pageRows.length) {
        document.getElementById('viewerTableWrap').innerHTML = '<p class="no-rows"><i class="fas fa-search me-2"></i>No records' + (viewerFilter ? ' match your search' : '') + '.</p>';
        renderPagination(0, 0, 0);
        updateViewerSelUI();
        return;
    }

    var allPageSel = pageRows.every(function(r) { return viewerSelectedIds.has(String(r.id)); });
    var someSel    = pageRows.some(function(r)  { return viewerSelectedIds.has(String(r.id)); });
    var checkTh =
        '<th class="cb-col" title="Select / deselect page">' +
            '<input type="checkbox" id="selAllCheck"' + (allPageSel ? ' checked' : '') +
            ' onclick="toggleSelectPage(this.checked)" title="Select all on this page">' +
        '</th>';

    var ths = '';
    visCols.forEach(function(c) {
        var isSorted = viewerSortCol === c;
        var sortIcon = isSorted ? (viewerSortDir === 'asc' ? 'fa-sort-up' : 'fa-sort-down') : 'fa-sort';
        ths += '<th class="' + (isSorted ? 'sorted' : '') + '" onclick="sortViewer(\'' + c + '\')">' + c + ' <i class="fas ' + sortIcon + ' sort-icon"></i></th>';
    });

    var trs = '';
    pageRows.forEach(function(row) {
        var isSel = viewerSelectedIds.has(String(row.id));
        var checkTd =
            '<td class="cb-col" onclick="event.stopPropagation()">' +
                '<input type="checkbox" class="row-check" value="' + row.id + '"' + (isSel ? ' checked' : '') +
                ' onchange="toggleRowSel(\'' + row.id + '\', this.checked)">' +
            '</td>';
        var tds = '';
        visCols.forEach(function(c) {
            var val = row[c];
            if (val === null || val === undefined) { tds += '<td class="null-cell">\u2014</td>'; return; }
            if (val === true  || val === 'true')   { tds += '<td class="bool-true">\u2713 true</td>'; return; }
            if (val === false || val === 'false')  { tds += '<td class="bool-false">\u2717 false</td>'; return; }
            var str = String(val);
            var display = str.length > 80 ? str.slice(0, 80) + '\u2026' : str;
            tds += '<td title="' + str.replace(/"/g,'&quot;') + '">' + display + '</td>';
        });
        trs += '<tr class="' + (isSel ? 'sel-row' : '') + '">' + checkTd + tds + '</tr>';
    });

    document.getElementById('viewerTableWrap').innerHTML =
        '<table class="data-table">' +
            '<thead><tr>' + checkTh + ths + '</tr></thead>' +
            '<tbody>' + trs + '</tbody>' +
        '</table>';

    var allCb = document.getElementById('selAllCheck');
    if (allCb && someSel && !allPageSel) allCb.indeterminate = true;

    renderPagination(viewerPage, pages, total);
    updateViewerSelUI();
}

// ── Row selection ─────────────────────────────────────────────────────────
var viewerSelectedIds = new Set();

function toggleRowSel(id, checked) {
    if (checked) viewerSelectedIds.add(String(id));
    else         viewerSelectedIds.delete(String(id));
    updateViewerSelUI();
    var ps = viewerPageSize || viewerFiltRows.length;
    var pageRows = viewerFiltRows.slice(
        (viewerPage-1) * ps,
        viewerPage * ps || viewerFiltRows.length
    );
    var allSel  = pageRows.every(function(r) { return viewerSelectedIds.has(String(r.id)); });
    var someSel = pageRows.some(function(r)  { return viewerSelectedIds.has(String(r.id)); });
    var cb = document.getElementById('selAllCheck');
    if (cb) { cb.checked = allSel; cb.indeterminate = someSel && !allSel; }
}

function toggleSelectPage(checked) {
    var ps    = viewerPageSize || viewerFiltRows.length;
    var start = (viewerPage - 1) * ps;
    var end   = ps ? Math.min(start + ps, viewerFiltRows.length) : viewerFiltRows.length;
    viewerFiltRows.slice(start, end).forEach(function(r) {
        if (checked) viewerSelectedIds.add(String(r.id));
        else         viewerSelectedIds.delete(String(r.id));
    });
    document.querySelectorAll('.row-check').forEach(function(cb) {
        cb.checked = viewerSelectedIds.has(String(cb.value));
        cb.closest('tr').classList.toggle('sel-row', cb.checked);
    });
    updateViewerSelUI();
}

function updateViewerSelUI() {
    var n   = viewerSelectedIds.size;
    var btn = document.getElementById('viewerDeleteSelBtn');
    var cnt = document.getElementById('viewerDelCount');
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
        var _ids = Array.from(viewerSelectedIds);
        var res  = await apiFetch('/api/admin/row-impact', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tableName: viewerMeta.key, ids: _ids })
        });
        var data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Impact check failed');

        if (!data.impact.length) {
            document.getElementById('impactList').innerHTML = '<p style="color:#6ee7b7;font-size:0.8rem;text-align:center"><i class="fas fa-check-circle me-1"></i>No related records found. Safe to delete.</p>';
            document.getElementById('impactWarning').innerHTML = 'Deleting <strong>' + viewerSelectedIds.size + '</strong> row(s). No cascade effects.';
        } else {
            var totalCascade = 0;
            var cascadeItems = [];
            var nullItems    = [];
            data.impact.forEach(function(i) {
                if (i.action === 'cascade') { totalCascade += i.count; cascadeItems.push(i); }
                else nullItems.push(i);
            });
            var _impHtml = '';
            data.impact.forEach(function(i) {
                _impHtml +=
                    '<div class="impact-item">' +
                        '<span class="' + (i.action === 'cascade' ? 'impact-cascade' : 'impact-null') + '">' +
                            '<i class="fas ' + (i.action === 'cascade' ? 'fa-trash-alt' : 'fa-unlink') + ' me-1"></i>' +
                            i.table + ' <span style="color:var(--text-muted);font-size:0.72rem">.' + i.col + '</span>' +
                        '</span>' +
                        '<span>' +
                            '<strong style="font-size:0.9rem">' + i.count.toLocaleString() + '</strong>' +
                            '<span class="impact-badge ' + (i.action === 'cascade' ? 'impact-badge-del' : 'impact-badge-null') + '">' +
                                (i.action === 'cascade' ? 'WILL DELETE' : 'SET NULL') +
                            '</span>' +
                        '</span>' +
                    '</div>';
            });
            document.getElementById('impactList').innerHTML = _impHtml;
            var warnParts = [];
            if (totalCascade > 0) warnParts.push('<strong>' + totalCascade.toLocaleString() + ' related records will also be deleted</strong> (cascade).');
            if (nullItems.length) {
                var nullTbls = nullItems.map(function(i) { return i.table; });
                warnParts.push('FK references in <strong>' + nullTbls.join(', ') + '</strong> will be set to NULL.');
            }
            document.getElementById('impactWarning').innerHTML = warnParts.join(' ');
        }
        setTimeout(function() { document.getElementById('impactPhrase').focus(); }, 80);
    } catch(e) {
        document.getElementById('impactList').innerHTML = '<p style="color:#fca5a5;font-size:0.8rem">' + e.message + '</p>';
    }
}

function closeImpactModal() { document.getElementById('impactBackdrop').classList.remove('show'); }

function checkImpactPhrase() {
    var ok = document.getElementById('impactPhrase').value === 'CONFIRM';
    document.getElementById('impactPhrase').classList.toggle('valid', ok);
    document.getElementById('impactDeleteBtn').disabled = !ok;
}

document.getElementById('impactBackdrop').addEventListener('click', function(e) { if (e.target === e.currentTarget) closeImpactModal(); });

async function executeRowDelete() {
    if (document.getElementById('impactPhrase').value !== 'CONFIRM') return;
    var btn = document.getElementById('impactDeleteBtn');
    var sp  = document.getElementById('impactSpinner');
    var ic  = document.getElementById('impactIcon');
    btn.disabled = true; sp.style.display = 'inline-block'; ic.style.display = 'none';
    try {
        var _ids = Array.from(viewerSelectedIds);
        var res  = await apiFetch('/api/admin/rows', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tableName: viewerMeta.key, ids: _ids })
        });
        var data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Delete failed');
        var cascadeInfo = '';
        if (data.results && data.results.cascaded) {
            var _cp = [];
            Object.keys(data.results.cascaded).forEach(function(t) { _cp.push(data.results.cascaded[t] + ' ' + t); });
            cascadeInfo = _cp.join(', ');
        }
        toast('\u2713 Deleted ' + data.results.deleted + ' row(s)' + (cascadeInfo ? ' + cascaded: ' + cascadeInfo : ''), 'success');
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
    document.getElementById('pagInfo').textContent = 'Page ' + page + ' of ' + pages + ' \u2014 ' + total.toLocaleString() + ' rows';
    var ctrl = document.getElementById('pagControls');
    if (pages <= 1) { ctrl.innerHTML = ''; return; }

    var html = '<button class="pag-btn" onclick="goPage(1)"' + (page===1?' disabled':'') + '>&laquo;</button>';
    html    += '<button class="pag-btn" onclick="goPage(' + (page-1) + ')"' + (page===1?' disabled':'') + '>&lsaquo;</button>';

    var range = 2;
    var lo = Math.max(1, page - range), hi = Math.min(pages, page + range);
    if (lo > 1) html += '<button class="pag-btn" onclick="goPage(1)">1</button>' + (lo > 2 ? '<span style="color:var(--text-muted);padding:0 4px">\u2026</span>' : '');
    for (var i = lo; i <= hi; i++) html += '<button class="pag-btn ' + (i===page?'active':'') + '" onclick="goPage(' + i + ')">' + i + '</button>';
    if (hi < pages) html += (hi < pages-1 ? '<span style="color:var(--text-muted);padding:0 4px">\u2026</span>' : '') + '<button class="pag-btn" onclick="goPage(' + pages + ')">' + pages + '</button>';

    html += '<button class="pag-btn" onclick="goPage(' + (page+1) + ')"' + (page===pages?' disabled':'') + '>&rsaquo;</button>';
    html += '<button class="pag-btn" onclick="goPage(' + pages + ')"' + (page===pages?' disabled':'') + '>&raquo;</button>';
    ctrl.innerHTML = html;
}

function goPage(p) { viewerPage = p; renderViewerTable(); }

// ── CSV Export ────────────────────────────────────────────────────────────
function exportCurrentTable() {
    if (!viewerMeta) return;
    exportRowsAsCSV(viewerMeta.key, viewerMeta.label, viewerFiltRows, viewerCols.filter(function(c) { return viewerVis[c]; }));
}

async function exportTable(tableKey) {
    var meta = null;
    tableMeta.forEach(function(t) { if (t.key === tableKey) meta = t; });
    toast('Loading ' + ((meta && meta.label) || tableKey) + '...', 'info');
    try {
        var res  = await apiFetch('/api/admin/table-data/' + tableKey);
        var data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Load failed');
        exportRowsAsCSV(tableKey, (meta && meta.label) || tableKey, data.rows, data.columns);
        toast('\u2713 Exported ' + data.total.toLocaleString() + ' records from ' + ((meta && meta.label) || tableKey), 'success');
    } catch(e) { toast('Export failed: ' + e.message, 'danger'); }
}

function exportRowsAsCSV(tableKey, label, rows, cols) {
    if (!rows.length && !cols.length) { toast('No data to export.', 'info'); return; }
    var header = cols.join(',');
    var body = rows.map(function(row) {
        return cols.map(function(c) {
            var v = row[c];
            if (v === null || v === undefined) return '';
            var s = String(v);
            return (s.indexOf(',') >= 0 || s.indexOf('"') >= 0 || s.indexOf('\n') >= 0) ? '"' + s.replace(/"/g,'""') + '"' : s;
        }).join(',');
    }).join('\n');
    var csv  = header + '\n' + body;
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var url  = URL.createObjectURL(blob);
    var a    = document.createElement('a');
    a.href     = url;
    a.download = tableKey + '_' + new Date().toISOString().slice(0,10) + '.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ══════════════════════════════════════════════════════════════════════════
// PURGE CONFIRM
// ══════════════════════════════════════════════════════════════════════════
function openConfirm() {
    if (selected.size === 0) return;
    var _sumHtml = '';
    selected.forEach(function(key) {
        var t = null; tableMeta.forEach(function(x) { if (x.key === key) t = x; });
        var cnt = tableCounts[key] || 0;
        if (!t) return;
        _sumHtml +=
            '<div class="del-item">' +
                '<span class="name"><i class="' + t.icon + '" style="color:' + t.color + ';margin-right:.4rem"></i>' + t.label + '</span>' +
                '<span class="cnt">' + cnt.toLocaleString() + '</span>' +
            '</div>';
    });
    document.getElementById('confirmSummary').innerHTML = _sumHtml;
    document.getElementById('confirmPhrase').value = '';
    document.getElementById('confirmPhrase').classList.remove('valid');
    /* BO-05: clear username input and show the hint */
    var _unInput = document.getElementById('confirmUsername');
    if (_unInput) { _unInput.value = ''; _unInput.classList.remove('valid'); }
    var _hint = document.getElementById('usernameHint');
    if (_hint) _hint.textContent = (USER && USER.username) ? USER.username : 'username';
    document.getElementById('confirmPurgeBtn').disabled = true;
    document.getElementById('confirmBackdrop').classList.add('show');
    setTimeout(function() { document.getElementById('confirmPhrase').focus(); }, 80);
}

function closeConfirm() { document.getElementById('confirmBackdrop').classList.remove('show'); }

/* BO-05: Require both DELETE FOREVER and the admin's own username */
function checkPhrase() {
    var phraseOk = document.getElementById('confirmPhrase').value === 'DELETE FOREVER';
    document.getElementById('confirmPhrase').classList.toggle('valid', phraseOk);
    var usernameOk = false;
    var _unInput = document.getElementById('confirmUsername');
    if (_unInput) {
        var expected = (USER && USER.username) ? USER.username.toLowerCase() : '';
        usernameOk = expected && _unInput.value.trim().toLowerCase() === expected;
        _unInput.classList.toggle('valid', usernameOk);
    }
    document.getElementById('confirmPurgeBtn').disabled = !(phraseOk && usernameOk);
}

document.getElementById('confirmBackdrop').addEventListener('click', function(e) { if (e.target === e.currentTarget) closeConfirm(); });

async function executePurge() {
    if (document.getElementById('confirmPhrase').value !== 'DELETE FOREVER') return;
    /* BO-05: also check username */
    var _unInput = document.getElementById('confirmUsername');
    if (_unInput) {
        var expected = (USER && USER.username) ? USER.username.toLowerCase() : '';
        if (!expected || _unInput.value.trim().toLowerCase() !== expected) return;
    }
    var btn = document.getElementById('confirmPurgeBtn');
    var sp  = document.getElementById('purgeSpinner');
    var ic  = document.getElementById('purgeIcon');
    btn.disabled = true; sp.style.display = 'inline-block'; ic.style.display = 'none';
    try {
        var _tables = Array.from(selected);
        var res  = await apiFetch('/api/admin/purge', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tables: _tables }) });
        var data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Purge failed');
        closeConfirm();
        var totalDel = 0;
        Object.keys(data.results).forEach(function(k) { totalDel += data.results[k]; });
        toast('\u2713 Purged ' + Object.keys(data.results).length + ' table(s) \u2014 ' + totalDel.toLocaleString() + ' records deleted', 'success');
        selected.clear();
        await loadStats();
    } catch(e) { toast('Error: ' + e.message, 'danger'); }
    finally { btn.disabled = false; sp.style.display = 'none'; ic.style.display = 'inline-block'; }
}

// ══════════════════════════════════════════════════════════════════════════
// TAB SWITCHER
// ══════════════════════════════════════════════════════════════════════════
function switchTab(tab) {
    var tabs  = ['tables','schema','orphans','dupes','audit','settings','backups','health','locks','users','rxactions','errlog','analytics'];
    var ids   = { tables:'tablesContent', schema:'schemaContent', orphans:'orphanContent', dupes:'dupesContent', audit:'auditContent', settings:'settingsContent', backups:'backupsContent', health:'healthContent', locks:'locksContent', users:'usersContent', rxactions:'rxActionsContent', errlog:'errlogContent', analytics:'analyticsContent' };
    var btns  = { tables:'tabTables', schema:'tabSchema', orphans:'tabOrphans', dupes:'tabDupes', audit:'tabAudit', settings:'tabSettings', backups:'tabBackups', health:'tabHealth', locks:'tabLocks', users:'tabUsers', rxactions:'tabRxActions', errlog:'tabErrlog', analytics:'tabAnalytics' };
    tabs.forEach(function(t) {
        document.getElementById(btns[t]).classList.toggle('active', t === tab);
        var el = document.getElementById(ids[t]);
        if (t === 'tables') el.style.display = t === tab ? '' : 'none';
        else el.classList.toggle('show', t === tab);
    });
    if (tab === 'schema'    && !schemaData)       loadSchema();
    if (tab === 'orphans'   && !orphanData)       loadOrphans();
    if (tab === 'dupes'     && !dupesData)        loadDupes();
    if (tab === 'audit'     && !auditLoaded)      loadAuditLogs(1);
    if (tab === 'settings'  && !settingsLoaded)   loadSettings();
    if (tab === 'backups'   && !backupsLoaded)    loadBackups();
    if (tab === 'health'    && !healthLoaded)     loadHealth();
    if (tab === 'locks'     && !locksLoaded)      loadLocks();
    if (tab === 'users'     && !usersLoaded)      loadUsers();
    if (tab === 'rxactions' && !rxActLoaded)      loadRxActions();
    if (tab === 'errlog'    && !errlogLoaded)     loadErrorLogs(1);
    if (tab === 'analytics' && !analyticsLoaded)  loadAnalytics();
    /* BO-04: Stop health countdown when leaving health tab */
    if (tab !== 'health' && typeof stopHealthCountdown === 'function') stopHealthCountdown();
}

// ══════════════════════════════════════════════════════════════════════════
// SCHEMA & RELATIONSHIPS
// ══════════════════════════════════════════════════════════════════════════
var schemaData     = null;
var schemaFiltered = [];
var activeSchemaTable = null;

async function loadSchema() {
    document.getElementById('schemaSideList').innerHTML = '<p style="padding:1rem;color:var(--text-muted);font-size:0.8rem"><i class="fas fa-spinner fa-spin me-2"></i>Loading...</p>';
    try {
        var res  = await apiFetch('/api/admin/schema');
        var data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed');
        schemaData = data;
        schemaFiltered = data.tables;
        renderSchemaSidebar();
        renderAllFKList();
    } catch(e) {
        document.getElementById('schemaSideList').innerHTML = '<p style="padding:1rem;color:#fca5a5;font-size:0.8rem">' + e.message + '</p>';
    }
}

function filterSchema() {
    var q = document.getElementById('schemaSearch').value.toLowerCase();
    if (!schemaData) return;
    schemaFiltered = schemaData.tables.filter(function(t) {
        return !q || t.name.toLowerCase().indexOf(q) >= 0 || t.columns.some(function(c) { return c.name.toLowerCase().indexOf(q) >= 0; });
    });
    renderSchemaSidebar();
    if (activeSchemaTable) {
        var still = null;
        schemaFiltered.forEach(function(t) { if (t.name === activeSchemaTable) still = t; });
        if (still) renderSchemaDetail(activeSchemaTable);
        else { activeSchemaTable = null; resetSchemaMain(); }
    }
}

function resetSchemaMain() {
    document.getElementById('schemaMain').innerHTML = '<div style="text-align:center;padding:4rem 2rem;color:var(--text-muted)"><i class="fas fa-mouse-pointer" style="font-size:2rem;opacity:0.3;display:block;margin-bottom:1rem"></i><p>Select a table from the list to view its columns and relationships.</p></div>';
}

var TABLE_COLORS = [
    '#6366f1','#10b981','#f59e0b','#ef4444','#06b6d4','#8b5cf6',
    '#f97316','#14b8a6','#3b82f6','#84cc16','#ec4899','#eab308',
    '#a855f7','#22c55e','#0ea5e9','#e11d48','#0891b2','#65a30d'
];
function tableColor(name) {
    var h=0;
    for (var i=0; i<name.length; i++) h=(h*31+name.charCodeAt(i))&0xffffff;
    return TABLE_COLORS[h % TABLE_COLORS.length];
}

function renderSchemaSidebar() {
    var tables = schemaFiltered;
    document.getElementById('schemaTblCount').textContent = tables.length + ' tables';
    var _sHtml = '';
    tables.forEach(function(t) {
        var fkCount = t.columns.filter(function(c) { return c.isFK; }).length;
        var col = tableColor(t.name);
        var isActive = t.name === activeSchemaTable;
        _sHtml +=
            '<div class="schema-tbl-item ' + (isActive ? 'active' : '') + '" onclick="renderSchemaDetail(\'' + t.name + '\')">' +
                '<div class="tbl-dot" style="background:' + col + '"></div>' +
                '<span>' + t.name + '</span>' +
                (fkCount > 0 ? '<span class="fk-count">' + fkCount + ' FK</span>' : '') +
            '</div>';
    });
    document.getElementById('schemaSideList').innerHTML = _sHtml;
}

function renderSchemaDetail(tableName) {
    activeSchemaTable = tableName;
    document.querySelectorAll('.schema-tbl-item').forEach(function(el) {
        el.classList.toggle('active', el.textContent.trim().startsWith(tableName));
    });

    var tbl = null;
    schemaData.tables.forEach(function(t) { if (t.name === tableName) tbl = t; });
    if (!tbl) return;
    var col = tableColor(tableName);

    var incomingFKs = schemaData.relationships.filter(function(r) { return r.to_table === tableName; });
    var outgoingFKs = schemaData.relationships.filter(function(r) { return r.from_table === tableName; });

    var colRows = '';
    tbl.columns.forEach(function(c) {
        var badges =
            (c.isPK ? '<span class="badge-pk">PK</span>' : '') +
            (c.isFK ? '<span class="badge-fk">FK</span>' : '') +
            (!c.nullable && !c.isPK ? '<span class="badge-nn">NOT NULL</span>' : '');
        var fkRef = c.references ?
            '<div class="fk-ref"><i class="fas fa-arrow-right"></i><span class="fk-target" onclick="renderSchemaDetail(\'' + c.references.toTable + '\')">' + c.references.toTable + '.' + c.references.toColumn + '</span></div>' :
            '';
        colRows +=
            '<tr>' +
                '<td><span class="col-name">' + c.name + '</span> ' + badges + '</td>' +
                '<td><span class="col-type">' + c.type + '</span></td>' +
                '<td>' + (c.nullable ? '<span style="color:var(--text-muted);font-size:0.7rem">NULL</span>' : '<span style="color:#6ee7b7;font-size:0.7rem">NOT NULL</span>') + '</td>' +
                '<td>' + fkRef + '</td>' +
            '</tr>';
    });

    var refByChips = '';
    if (incomingFKs.length) {
        incomingFKs.forEach(function(r) {
            refByChips += '<span class="ref-chip" onclick="renderSchemaDetail(\'' + r.from_table + '\')"><i class="fas fa-arrow-left"></i>' + r.from_table + '<span style="opacity:.6;font-size:0.65rem">.' + r.from_column + '</span></span>';
        });
    } else {
        refByChips = '<span style="color:var(--text-muted);font-size:0.75rem">No other tables reference this table.</span>';
    }

    var pkCols = tbl.columns.filter(function(c) { return c.isPK; }).map(function(c) { return c.name; }).join(', ') || 'no PK';

    document.getElementById('schemaMain').innerHTML =
        '<div class="schema-card">' +
            '<div class="schema-card-header" style="border-left:3px solid ' + col + '">' +
                '<div class="table-icon" style="background:' + col + '22;color:' + col + '"><i class="fas fa-table"></i></div>' +
                '<div>' +
                    '<h6>' + tableName + '</h6>' +
                    '<div style="font-size:0.7rem;color:var(--text-muted)">' + tbl.columns.length + ' columns &bull; ' + outgoingFKs.length + ' outgoing FK &bull; ' + incomingFKs.length + ' incoming FK</div>' +
                '</div>' +
                '<small>' + pkCols + '</small>' +
            '</div>' +
            '<table class="schema-col-table">' +
                '<thead><tr><th>Column</th><th>Type</th><th>Nullable</th><th>References</th></tr></thead>' +
                '<tbody>' + colRows + '</tbody>' +
            '</table>' +
            '<div class="ref-by-section">' +
                '<div class="ref-by-title"><i class="fas fa-arrow-left me-1"></i>Referenced by (incoming FKs)</div>' +
                '<div class="ref-by-chips">' + refByChips + '</div>' +
            '</div>' +
        '</div>';
}

function renderAllFKList() {
    var rels = schemaData.relationships;
    document.getElementById('fkTotalCount').textContent = rels.length + ' relationships';
    if (!rels.length) {
        document.getElementById('allFKList').innerHTML = '<p style="text-align:center;padding:2rem;color:var(--text-muted)">No foreign key relationships found.</p>';
        return;
    }
    var _relRows = '';
    rels.forEach(function(r) {
        _relRows +=
            '<div class="fk-row">' +
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
var orphanData = null;

async function loadOrphans() {
    document.getElementById('orphanList').innerHTML = '<p style="text-align:center;padding:3rem;color:var(--text-muted)"><i class="fas fa-spinner fa-spin me-2"></i>Scanning all FK relationships...</p>';
    document.getElementById('orphanStatus').innerHTML = '';
    try {
        var res  = await apiFetch('/api/admin/orphans');
        var data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Scan failed');
        orphanData = data;
        renderOrphans();
    } catch(e) {
        document.getElementById('orphanList').innerHTML = '<p style="color:#fca5a5;padding:2rem">' + e.message + '</p>';
    }
}

function renderOrphans() {
    var d = orphanData;
    var statusColor = d.clean ? '#6ee7b7' : '#fbbf24';
    var statusIcon  = d.clean ? 'fa-check-circle' : 'fa-exclamation-triangle';
    var statusMsg   = d.clean ? '\u2714 Database is clean' : '\u26a0 ' + d.totalOrphans.toLocaleString() + ' orphaned record(s) found';
    document.getElementById('orphanStatus').innerHTML =
        '<div style="background:' + (d.clean ? 'rgba(16,185,129,0.08)' : 'rgba(251,191,36,0.08)') + ';border:1px solid ' + (d.clean ? 'rgba(16,185,129,0.2)' : 'rgba(251,191,36,0.2)') + ';border-radius:8px;padding:0.75rem 1rem;display:flex;align-items:center;gap:0.75rem">' +
            '<i class="fas ' + statusIcon + '" style="color:' + statusColor + ';font-size:1.2rem"></i>' +
            '<div>' +
                '<div style="font-weight:700;color:' + statusColor + '">' + statusMsg + '</div>' +
                '<div style="font-size:0.75rem;color:var(--text-muted)">' + d.results.length + ' FK relationships checked</div>' +
            '</div>' +
        '</div>';

    var _oRows = '';
    d.results.forEach(function(r) {
        var cleanBtn = !r.clean ?
            '<button class="btn-bo btn-bo-danger" onclick="cleanOrphans(\'' + r.childTable + '\',\'' + r.childCol + '\',\'' + r.parentTable + '\',\'' + r.parentCol + '\',this)" style="padding:0.3rem 0.7rem;font-size:0.72rem"><i class="fas fa-broom me-1"></i>Clean Up</button>' : '';
        _oRows +=
            '<div class="schema-card" style="margin-bottom:0.5rem">' +
                '<div style="padding:0.75rem 1rem;display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap">' +
                    '<div style="display:flex;align-items:center;gap:0.75rem">' +
                        '<div style="width:10px;height:10px;border-radius:50%;background:' + (r.clean ? '#10b981' : '#f59e0b') + ';flex-shrink:0"></div>' +
                        '<div>' +
                            '<span style="font-family:monospace;font-size:0.82rem;color:' + (r.clean ? 'var(--text)' : '#fbbf24') + '">' +
                                r.childTable + '.<span style="color:#a5b4fc">' + r.childCol + '</span>' +
                            '</span>' +
                            '<span style="color:var(--text-muted);margin:0 0.4rem">\u2192</span>' +
                            '<span style="font-family:monospace;font-size:0.82rem;color:var(--text-muted)">' + r.parentTable + '.' + r.parentCol + '</span>' +
                        '</div>' +
                    '</div>' +
                    '<div style="display:flex;align-items:center;gap:0.75rem">' +
                        '<span style="font-size:0.85rem;font-weight:700;color:' + (r.clean ? '#6ee7b7' : '#f59e0b') + '">' +
                            (r.clean ? '\u2714 Clean' : r.orphanCount.toLocaleString() + ' orphans') +
                        '</span>' +
                        cleanBtn +
                    '</div>' +
                '</div>' +
            '</div>';
    });
    document.getElementById('orphanList').innerHTML = _oRows;
}

async function cleanOrphans(childTable, childCol, parentTable, parentCol, btn) {
    if (!confirm('Delete all orphaned rows in ' + childTable + ' where ' + childCol + ' has no matching ' + parentTable + '?')) return;
    btn.disabled = true; btn.innerHTML = '<span class="spinner-sm"></span> Cleaning...';
    try {
        var res  = await apiFetch('/api/admin/orphans', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ childTable: childTable, childCol: childCol, parentTable: parentTable, parentCol: parentCol })
        });
        var data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Clean failed');
        toast('\u2713 Cleaned ' + data.deleted + ' orphaned rows from ' + childTable, 'success');
        await loadOrphans();
    } catch(e) { toast('Clean failed: ' + e.message, 'danger'); btn.disabled = false; btn.innerHTML = '<i class="fas fa-broom me-1"></i>Clean Up'; }
}

// ══════════════════════════════════════════════════════════════════════════
// DUPLICATE PATIENT FINDER
// ══════════════════════════════════════════════════════════════════════════
var dupesData = null;
var dupeTabMode = 'name';

async function loadDupes() {
    document.getElementById('dupesList').innerHTML = '<p style="text-align:center;padding:3rem;color:var(--text-muted)"><i class="fas fa-spinner fa-spin me-2"></i>Scanning patients...</p>';
    document.getElementById('dupesStatus').innerHTML = '';
    try {
        var res  = await apiFetch('/api/admin/duplicates');
        var data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Scan failed');
        dupesData = data;
        renderDupes();
    } catch(e) {
        document.getElementById('dupesList').innerHTML = '<p style="color:#fca5a5;padding:2rem">' + e.message + '</p>';
    }
}

function switchDupeTab(mode) {
    dupeTabMode = mode;
    document.getElementById('dupeTabName').classList.toggle('active', mode === 'name');
    document.getElementById('dupeTabPhone').classList.toggle('active', mode === 'phone');
    if (dupesData) renderDupes();
}

function renderDupes() {
    var groups = dupeTabMode === 'name' ? dupesData.byName : dupesData.byPhone;
    var total  = dupeTabMode === 'name' ? dupesData.totalNameGroups : dupesData.totalPhoneGroups;
    var label  = dupeTabMode === 'name' ? 'full name' : 'phone number';

    if (!total) {
        document.getElementById('dupesStatus').innerHTML = '<div style="background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.2);border-radius:8px;padding:0.75rem 1rem;color:#6ee7b7;font-weight:600">\u2714 No duplicate patients found by ' + label + '.</div>';
        document.getElementById('dupesList').innerHTML = '';
        return;
    }
    document.getElementById('dupesStatus').innerHTML = '<div style="background:rgba(251,191,36,0.08);border:1px solid rgba(251,191,36,0.2);border-radius:8px;padding:0.75rem 1rem;color:#fbbf24;font-weight:600">\u26a0 ' + total + ' duplicate group(s) found by ' + label + '</div>';

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
    var _dupExpBtn = document.getElementById('dupesExportBtn');
    if (_dupExpBtn) _dupExpBtn.style.display = '';
}

// ── Export Duplicates CSV ────────────────────────────────────────────────
function exportDupesCSV() {
    if (!dupesData) { toast('Run a scan first.', 'info'); return; }
    var groups = dupeTabMode === 'name' ? dupesData.byName : dupesData.byPhone;
    if (!groups || !groups.length) { toast('No duplicate data to export.', 'info'); return; }
    var cols = ['group_key','id','firstName','lastName','dob','phone','isActive','createdAt'];
    var rows = [];
    groups.forEach(function(g) {
        var recs = typeof g.records === 'string' ? JSON.parse(g.records) : g.records;
        recs.forEach(function(p) {
            rows.push({
                group_key:  g.match_key,
                id:         p.id,
                firstName:  p.firstName || '',
                lastName:   p.lastName  || '',
                dob:        p.dob       || '',
                phone:      p.phone     || '',
                isActive:   p.isActive  ? 'Yes' : 'No',
                createdAt:  p.createdAt ? new Date(p.createdAt).toLocaleString() : '',
            });
        });
    });
    var header = cols.join(',');
    var body = rows.map(function(row) {
        return cols.map(function(c) {
            var v = row[c];
            if (v === null || v === undefined) return '';
            var s = String(v);
            return (s.indexOf(',') >= 0 || s.indexOf('"') >= 0 || s.indexOf('\n') >= 0) ? '"' + s.replace(/"/g,'""') + '"' : s;
        }).join(',');
    }).join('\n');
    var csv  = header + '\n' + body;
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var url  = URL.createObjectURL(blob);
    var a    = document.createElement('a');
    a.href = url; a.download = 'duplicates-' + dupeTabMode + '-' + new Date().toISOString().slice(0,10) + '.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast('\u2713 Exported ' + rows.length + ' duplicate patient rows', 'success');
}

async function deleteDupPatient(id, btn) {
    if (!confirm('Permanently delete patient ID ' + id + ' and all related RX records?')) return;
    btn.disabled = true; btn.innerHTML = '<span class="spinner-sm"></span>';
    try {
        var res  = await apiFetch('/api/admin/rows', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tableName: 'Patients', ids: [String(id)] })
        });
        var data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Delete failed');
        toast('\u2713 Patient ' + id + ' deleted', 'success');
        await loadDupes();
        loadStats();
    } catch(e) { toast('Delete failed: ' + e.message, 'danger'); btn.disabled = false; btn.innerHTML = '<i class="fas fa-trash-alt me-1"></i>Delete'; }
}

// ══════════════════════════════════════════════════════════════════════════
// AUDIT LOG VIEWER
// ══════════════════════════════════════════════════════════════════════════
var auditLoaded = false;
var auditCurrentPage = 1;
var auditDebounceTimer = null;
var auditPageSz = 50; /* BO-02: controlled by top selector */

function auditDebounce() {
    clearTimeout(auditDebounceTimer);
    auditDebounceTimer = setTimeout(function() { loadAuditLogs(1); }, 450);
}

function clearAuditFilters() {
    ['auditSearch','auditEntity','auditDateFrom','auditDateTo'].forEach(function(id) { document.getElementById(id).value = ''; });
    document.getElementById('auditAction').value = '';
    loadAuditLogs(1);
}

/* BO-02: Called when user changes the top page-size selector */
function onAuditPageSizeChange() {
    var sel = document.getElementById('auditPageSizeTop');
    if (sel) auditPageSz = parseInt(sel.value, 10) || 50;
    loadAuditLogs(1);
}

async function loadAuditLogs(page) {
    auditCurrentPage = page || 1;
    var _auditSearch   = document.getElementById('auditSearch')   ? document.getElementById('auditSearch').value   : '';
    var _auditAction   = document.getElementById('auditAction')   ? document.getElementById('auditAction').value   : '';
    var _auditEntity   = document.getElementById('auditEntity')   ? document.getElementById('auditEntity').value   : '';
    var _auditDateFrom = document.getElementById('auditDateFrom') ? document.getElementById('auditDateFrom').value : '';
    var _auditDateTo   = document.getElementById('auditDateTo')   ? document.getElementById('auditDateTo').value   : '';
    var params = new URLSearchParams({
        page:     auditCurrentPage,
        /* BO-02: read page size from top selector each call */
        size:     (function() { var s = document.getElementById('auditPageSizeTop'); if (s) auditPageSz = parseInt(s.value, 10) || 50; return auditPageSz; })(),
        search:   _auditSearch,
        action:   _auditAction,
        entity:   _auditEntity,
        dateFrom: _auditDateFrom,
        dateTo:   _auditDateTo,
    });
    document.getElementById('auditList').innerHTML = '<p style="text-align:center;padding:2rem;color:var(--text-muted)"><i class="fas fa-spinner fa-spin me-2"></i>Loading...</p>';
    try {
        var res  = await apiFetch('/api/admin/audit-logs?' + params);
        var data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed');
        auditLoaded = true;

        // Populate action dropdown on first load
        if (data.actions && data.actions.length) {
            var sel = document.getElementById('auditAction');
            var cur = sel.value;
            var _opts = '<option value="">All Actions</option>';
            data.actions.forEach(function(a) {
                _opts += '<option value="' + a + '"' + (a===cur?' selected':'') + '>' + a + '</option>';
            });
            sel.innerHTML = _opts;
        }

        /* BO-02: update total count badge */
        var _badge = document.getElementById('auditCountBadge');
        if (_badge) _badge.textContent = (data.total || 0).toLocaleString() + ' total records';

        document.getElementById('auditStatus').textContent = 'Showing ' + data.rows.length + ' of ' + data.total.toLocaleString() + ' entries | Page ' + data.page + ' of ' + data.pages;

        if (!data.rows.length) {
            document.getElementById('auditList').innerHTML = '<p style="text-align:center;padding:3rem;color:var(--text-muted)">No audit log entries match your filters.</p>';
            document.getElementById('auditPagination').innerHTML = '';
            return;
        }

        var ACTION_COLORS = {
            CREATE: '#10b981', UPDATE: '#6366f1', DELETE: '#ef4444', LOGIN: '#06b6d4',
            LOGOUT: '#64748b', BACKOFFICE_ROW_DELETE: '#f97316', PURGE: '#dc2626',
        };
        function actionColor(a) {
            var _keys = Object.keys(ACTION_COLORS);
            for (var _i = 0; _i < _keys.length; _i++) {
                if (a && a.startsWith(_keys[_i])) return ACTION_COLORS[_keys[_i]];
            }
            return '#94a3b8';
        }

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
                    '<th style="padding:0.5rem 0.875rem;text-align:left;color:var(--text-muted);font-size:0.68rem;text-transform:uppercase;letter-spacing:.07em">Changes</th>' +
                '</tr></thead>' +
                '<tbody>' + _auditRows + '</tbody>' +
            '</table></div>';

        var _ebtn = document.getElementById('auditExportBtn');
        if (_ebtn) _ebtn.style.display = '';

        // Pagination
        var pag = '';
        if (data.pages > 1) {
            if (page > 1) pag += '<button class="pag-btn" onclick="loadAuditLogs(' + (page-1) + ')">&#8249;</button>';
            var lo = Math.max(1, page-2), hi = Math.min(data.pages, page+2);
            if (lo > 1) pag += '<button class="pag-btn" onclick="loadAuditLogs(1)">1</button>' + (lo>2 ? '<span style="padding:0 4px;color:var(--text-muted)">\u2026</span>' : '');
            for (var i=lo; i<=hi; i++) pag += '<button class="pag-btn ' + (i===page?'active':'') + '" onclick="loadAuditLogs(' + i + ')">' + i + '</button>';
            if (hi < data.pages) pag += (hi<data.pages-1 ? '<span style="padding:0 4px;color:var(--text-muted)">\u2026</span>' : '') + '<button class="pag-btn" onclick="loadAuditLogs(' + data.pages + ')">' + data.pages + '</button>';
            if (page < data.pages) pag += '<button class="pag-btn" onclick="loadAuditLogs(' + (page+1) + ')">&#8250;</button>';
        }
        document.getElementById('auditPagination').innerHTML = pag;
        if (_ebtn) _ebtn.style.display = '';
    } catch(e) {
        document.getElementById('auditList').innerHTML = '<p style="color:#fca5a5;padding:2rem">' + e.message + '</p>';
    }
}

// ── Export Audit Logs CSV (fetches all matching rows) ─────────────────────
async function exportAuditLogsCSV() {
    var _ebtn = document.getElementById('auditExportBtn');
    if (_ebtn) { _ebtn.disabled = true; _ebtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; }
    try {
        var _auditSearch   = document.getElementById('auditSearch')   ? document.getElementById('auditSearch').value   : '';
        var _auditAction   = document.getElementById('auditAction')   ? document.getElementById('auditAction').value   : '';
        var _auditEntity   = document.getElementById('auditEntity')   ? document.getElementById('auditEntity').value   : '';
        var _auditDateFrom = document.getElementById('auditDateFrom') ? document.getElementById('auditDateFrom').value : '';
        var _auditDateTo   = document.getElementById('auditDateTo')   ? document.getElementById('auditDateTo').value   : '';
        var params = new URLSearchParams({
            page: 1, size: 9999,
            search:   _auditSearch,
            action:   _auditAction,
            entity:   _auditEntity,
            dateFrom: _auditDateFrom,
            dateTo:   _auditDateTo,
        });
        var res  = await apiFetch('/api/admin/audit-logs?' + params);
        var data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed');
        var cols = ['id','createdAt','userId','username','action','entity','entityId','details'];
        var rows = (data.rows || []).map(function(r) {
            return {
                id:        r.id,
                createdAt: r.createdAt ? new Date(r.createdAt).toLocaleString() : '',
                userId:    r.userId || '',
                username:  r.firstName ? r.firstName + ' ' + r.lastName : (r.userId ? 'User #' + r.userId : 'System'),
                action:    r.action   || '',
                entity:    r.entity   || '',
                entityId:  r.entityId || '',
                details:   r.details  || '',
            };
        });
        var header = cols.join(',');
        var body = rows.map(function(row) {
            return cols.map(function(c) {
                var v = row[c];
                if (v === null || v === undefined) return '';
                var s = String(v);
                return (s.indexOf(',') >= 0 || s.indexOf('"') >= 0 || s.indexOf('\n') >= 0) ? '"' + s.replace(/"/g,'""') + '"' : s;
            }).join(',');
        }).join('\n');
        var csv  = header + '\n' + body;
        var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        var url  = URL.createObjectURL(blob);
        var a    = document.createElement('a');
        a.href = url; a.download = 'audit-logs-' + new Date().toISOString().slice(0,10) + '.csv';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast('\u2713 Exported ' + rows.length + ' audit log(s)', 'success');
    } catch(e) { toast('Export failed: ' + e.message, 'danger'); }
    finally { if (_ebtn) { _ebtn.disabled = false; _ebtn.innerHTML = '<i class="fas fa-file-csv"></i>'; } }
}

// \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
// RX ACTIONS (MEDICATION CATALOG)
// \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
var rxActData     = [];
var rxActFiltered = [];
var rxActLoaded   = false;
var rxActEditId   = null;

// ── Permission helpers ───────────────────────────────────────────────────
function rxActPerms() {
    var p = (USER && USER.perms && USER.perms.medication_catalog) ? USER.perms.medication_catalog : {};
    return {
        canAdd:    p.add    !== false,
        canEdit:   p.edit   !== false,
        canDelete: p.delete !== false
    };
}

// ── Load ─────────────────────────────────────────────────────────────────
async function loadRxActions() {
    document.getElementById('rxActBody').innerHTML =
        '<tr><td colspan="6" style="text-align:center;padding:3rem;color:var(--text-muted)"><i class="fas fa-spinner fa-spin me-2"></i>Loading...</td></tr>';
    document.getElementById('rxActStatus').textContent = '';
    try {
        var res  = await apiFetch('/api/medication-catalog');
        var data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Load failed');
        rxActData   = data;
        rxActLoaded = true;
        // Apply permission guards to UI buttons
        var perms = rxActPerms();
        var addBtn = document.getElementById('rxActAddBtn');
        if (addBtn) addBtn.style.display = perms.canAdd ? '' : 'none';
        filterRxActions();
    } catch(e) {
        document.getElementById('rxActBody').innerHTML =
            '<tr><td colspan="6" style="text-align:center;padding:3rem;color:#fca5a5"><i class="fas fa-exclamation-triangle me-2"></i>' + e.message + '</td></tr>';
    }
}

// ── Filter ───────────────────────────────────────────────────────────────
function filterRxActions() {
    var q            = (document.getElementById('rxActSearch')       ? document.getElementById('rxActSearch').value.toLowerCase()          : '');
    var showInactive = (document.getElementById('rxActShowInactive') ? document.getElementById('rxActShowInactive').checked : false);
    rxActFiltered = rxActData.filter(function(r) {
        if (!showInactive && r.isActive === false) return false;
        if (!q) return true;
        return (r.name        || '').toLowerCase().indexOf(q) >= 0 ||
               (r.description || '').toLowerCase().indexOf(q) >= 0;
    });
    var status = document.getElementById('rxActStatus');
    if (status) {
        status.textContent = rxActFiltered.length + ' of ' + rxActData.length + ' entries' +
            (showInactive ? '' : ' (active only)');
    }
    renderRxActTable();
}

// ── Render Table ──────────────────────────────────────────────────────────
function renderRxActTable() {
    var perms = rxActPerms();
    var tbody = document.getElementById('rxActBody');
    if (!rxActFiltered.length) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:3rem;color:var(--text-muted)"><i class="fas fa-clipboard-list" style="font-size:2rem;opacity:.3;display:block;margin-bottom:1rem"></i>No RX actions found.</td></tr>';
        return;
    }
    var html = '';
    rxActFiltered.forEach(function(r) {
        var isInactive = r.isActive === false;
        var rowStyle   = isInactive ? 'opacity:0.55;' : '';
        var statusBadge = isInactive
            ? '<span style="background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.25);color:#fca5a5;border-radius:6px;padding:0.15rem 0.55rem;font-size:0.7rem;font-weight:600">Disabled</span>'
            : '<span style="background:rgba(16,185,129,0.12);border:1px solid rgba(16,185,129,0.25);color:#6ee7b7;border-radius:6px;padding:0.15rem 0.55rem;font-size:0.7rem;font-weight:600">\u2713 Active</span>';

        var editBtn = perms.canEdit && !isInactive
            ? '<button onclick="openRxActModal(' + r.id + ')" style="background:rgba(99,102,241,0.12);border:1px solid rgba(99,102,241,0.25);color:#a5b4fc;border-radius:6px;padding:0.28rem 0.65rem;font-size:0.72rem;font-weight:600;cursor:pointer;transition:all .15s" onmouseover="this.style.background=\'rgba(99,102,241,0.22)\'" onmouseout="this.style.background=\'rgba(99,102,241,0.12)\'"><i class="fas fa-edit me-1"></i>Edit</button>'
            : '';
        var disableBtn = perms.canDelete && !isInactive
            ? '<button onclick="rxActDisable(' + r.id + ', this)" style="background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.22);color:#fca5a5;border-radius:6px;padding:0.28rem 0.65rem;font-size:0.72rem;font-weight:600;cursor:pointer;transition:all .15s" onmouseover="this.style.background=\'rgba(239,68,68,0.2)\'" onmouseout="this.style.background=\'rgba(239,68,68,0.1)\'"><i class="fas fa-ban me-1"></i>Disable</button>'
            : '';
        var restoreBtn = perms.canEdit && isInactive
            ? '<button onclick="rxActRestore(' + r.id + ', this)" style="background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.22);color:#6ee7b7;border-radius:6px;padding:0.28rem 0.65rem;font-size:0.72rem;font-weight:600;cursor:pointer;transition:all .15s" onmouseover="this.style.background=\'rgba(16,185,129,0.2)\'" onmouseout="this.style.background=\'rgba(16,185,129,0.1)\'"><i class="fas fa-redo me-1"></i>Restore</button>'
            : '';

        html +=
            '<tr style="border-bottom:1px solid var(--border);transition:background .1s;' + rowStyle + '" ' +
            'onmouseover="this.style.background=\'rgba(255,255,255,0.025)\'" onmouseout="this.style.background=\'\'">' +
                '<td style="padding:0.5rem 1rem;color:var(--text-muted);font-size:0.75rem">' + r.id + '</td>' +
                '<td style="padding:0.5rem 1rem;font-weight:600">' + (r.name || '\u2014') + '</td>' +
                '<td style="padding:0.5rem 1rem;color:var(--text-muted);font-size:0.8rem;max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + (r.description || '\u2014') + '</td>' +
                '<td style="padding:0.5rem 1rem;text-align:center;color:var(--text-muted);font-size:0.8rem">' + (r.sortOrder !== undefined && r.sortOrder !== null ? r.sortOrder : '\u2014') + '</td>' +
                '<td style="padding:0.5rem 1rem;text-align:center">' + statusBadge + '</td>' +
                '<td style="padding:0.5rem 1rem;text-align:right"><div style="display:flex;gap:0.4rem;justify-content:flex-end">' +
                    editBtn + disableBtn + restoreBtn +
                '</div></td>' +
            '</tr>';
    });
    tbody.innerHTML = html;
}

// ── Modal Open/Close ──────────────────────────────────────────────────────
function openRxActModal(id) {
    rxActEditId = id || null;
    var backdrop = document.getElementById('rxActModalBackdrop');
    var title    = document.getElementById('rxActModalTitle');
    var errDiv   = document.getElementById('rxActModalErr');
    errDiv.style.display = 'none';
    errDiv.textContent   = '';

    if (id) {
        // Edit mode — find record
        var rec = null;
        rxActData.forEach(function(r) { if (r.id === id) rec = r; });
        title.textContent = 'Edit RX Action';
        document.getElementById('rxActName').value   = rec ? (rec.name        || '') : '';
        document.getElementById('rxActDesc').value   = rec ? (rec.description || '') : '';
        document.getElementById('rxActSort').value   = rec ? (rec.sortOrder !== undefined && rec.sortOrder !== null ? rec.sortOrder : 999) : 999;
        document.getElementById('rxActActive').checked = rec ? (rec.isActive !== false) : true;
    } else {
        // Add mode
        title.textContent = 'Add RX Action';
        document.getElementById('rxActName').value   = '';
        document.getElementById('rxActDesc').value   = '';
        document.getElementById('rxActSort').value   = '999';
        document.getElementById('rxActActive').checked = true;
    }

    backdrop.style.display = 'flex';
    setTimeout(function() { document.getElementById('rxActName').focus(); }, 80);
}

function closeRxActModal() {
    document.getElementById('rxActModalBackdrop').style.display = 'none';
    rxActEditId = null;
}

// Close modal on backdrop click
document.getElementById('rxActModalBackdrop').addEventListener('click', function(e) {
    if (e.target === e.currentTarget) closeRxActModal();
});

// ── Save (Add / Edit) ─────────────────────────────────────────────────────
async function saveRxAct() {
    var name     = (document.getElementById('rxActName').value || '').trim();
    var desc     = (document.getElementById('rxActDesc').value || '').trim();
    var sortVal  = document.getElementById('rxActSort').value;
    var isActive = document.getElementById('rxActActive').checked;
    var errDiv   = document.getElementById('rxActModalErr');
    var saveBtn  = document.getElementById('rxActSaveBtn');

    errDiv.style.display = 'none';
    if (!name) {
        errDiv.textContent   = 'Name is required.';
        errDiv.style.display = '';
        document.getElementById('rxActName').focus();
        return;
    }

    var payload = {
        name:        name,
        description: desc || null,
        sortOrder:   sortVal !== '' ? parseInt(sortVal, 10) : 999,
        isActive:    isActive
    };

    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Saving...';
    try {
        var url    = rxActEditId ? '/api/medication-catalog/' + rxActEditId : '/api/medication-catalog';
        var method = rxActEditId ? 'PUT' : 'POST';
        var res    = await apiFetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        var data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Save failed');

        closeRxActModal();
        toast('\u2713 RX Action "' + name + '" ' + (rxActEditId ? 'updated' : 'added'), 'success');
        rxActLoaded = false;   // force reload to get fresh sort order
        await loadRxActions();
    } catch(e) {
        errDiv.textContent   = e.message;
        errDiv.style.display = '';
    } finally {
        saveBtn.disabled = false;
        saveBtn.innerHTML = '<i class="fas fa-save me-1"></i>Save';
    }
}

// ── Disable (soft-delete) ─────────────────────────────────────────────────
async function rxActDisable(id, btn) {
    var rec = null;
    rxActData.forEach(function(r) { if (r.id === id) rec = r; });
    var name = rec ? rec.name : 'this entry';
    if (!confirm('Disable "' + name + '"? It will no longer appear in the RX form dropdown.')) return;
    var orig = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    try {
        var res  = await apiFetch('/api/medication-catalog/' + id, { method: 'DELETE' });
        if (!res.ok && res.status !== 204) {
            var data = await res.json();
            throw new Error(data.error || 'Disable failed');
        }
        toast('\u2713 "' + name + '" disabled', 'success');
        rxActLoaded = false;
        await loadRxActions();
    } catch(e) {
        toast('Error: ' + e.message, 'danger');
        btn.disabled = false;
        btn.innerHTML = orig;
    }
}

// ── Restore ───────────────────────────────────────────────────────────────
async function rxActRestore(id, btn) {
    var rec = null;
    rxActData.forEach(function(r) { if (r.id === id) rec = r; });
    var name = rec ? rec.name : 'this entry';
    var orig = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    try {
        var res  = await apiFetch('/api/medication-catalog/' + id + '/restore', { method: 'PUT' });
        var data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Restore failed');
        toast('\u2713 "' + name + '" restored', 'success');
        rxActLoaded = false;
        await loadRxActions();
    } catch(e) {
        toast('Error: ' + e.message, 'danger');
        btn.disabled = false;
        btn.innerHTML = orig;
    }
}