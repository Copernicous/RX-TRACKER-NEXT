// reports.js — Extracted from reports.ejs inline script for FortiGate proxy compatibility.
// External JS files are not rewritten by FortiGate's content rewriter.

    var allPatientReport = [];
    var allRxReport = [];
    var allWorkflowActions = [];
    var prSortCol = 'id', prSortDir = 'desc';
    var rrSortCol = 'id', rrSortDir = 'desc';
    var _panelStates = {};

    // ── Pagination state ────────────────────────────────────────────────────────
    var prPage = 1, prPageSize = 10;
    var rrPage = 1, rrPageSize = 10;

    function prChangeSize(n) { prPageSize = parseInt(n); prPage = 1; renderPatientReport(); }
    function rrChangeSize(n) { rrPageSize = parseInt(n); rrPage = 1; renderRxActionReport(); }
    function prGoPage(p)     { prPage = p; renderPatientReport(); }
    function rrGoPage(p)     { rrPage = p; renderRxActionReport(); }

    // Smart ellipsis paginator — returns HTML string, FortiGate-safe (no template literals)
    function buildPagNav(currentPage, totalPages, goFn) {
        if (totalPages <= 1) return '';
        var isFirst = currentPage === 1;
        var isLast  = currentPage >= totalPages;
        var html = '<li class="page-item' + (isFirst ? ' disabled' : '') + '"><a class="page-link" onclick="' + goFn + '(' + (currentPage - 1) + ')">&laquo;</a></li>';
        var delta = 2;
        var lo = Math.max(2, currentPage - delta);
        var hi = Math.min(totalPages - 1, currentPage + delta);
        // always page 1
        html += '<li class="page-item' + (currentPage === 1 ? ' active' : '') + '"><a class="page-link" onclick="' + goFn + '(1)">1</a></li>';
        if (lo > 2) html += '<li class="page-item disabled"><span class="page-link">&hellip;</span></li>';
        for (var i = lo; i <= hi; i++) {
            html += '<li class="page-item' + (i === currentPage ? ' active' : '') + '"><a class="page-link" onclick="' + goFn + '(' + i + ')">' + i + '</a></li>';
        }
        if (hi < totalPages - 1) html += '<li class="page-item disabled"><span class="page-link">&hellip;</span></li>';
        // always last page
        html += '<li class="page-item' + (currentPage === totalPages ? ' active' : '') + '"><a class="page-link" onclick="' + goFn + '(' + totalPages + ')">' + totalPages + '</a></li>';
        html += '<li class="page-item' + (isLast ? ' disabled' : '') + '"><a class="page-link" onclick="' + goFn + '(' + (currentPage + 1) + ')">&raquo;</a></li>';
        return html;
    }

    function togglePanel(panelId, chevronId, stateKey) {
        _panelStates[stateKey] = !_panelStates[stateKey];
        const el = document.getElementById(panelId);
        const ch = document.getElementById(chevronId);
        if (el) el.style.display = _panelStates[stateKey] ? '' : 'none';
        if (ch) ch.className = _panelStates[stateKey] ? 'fas fa-chevron-up ms-1' : 'fas fa-chevron-down ms-1';
    }

    document.addEventListener('DOMContentLoaded', async () => {
        initApp();
        await loadReportData();
        setupReportExports();

        ['exportPatientCsv','exportRxCsv'].forEach(id => {
            const el = document.getElementById(id);
            if (el && typeof window.userPerms !== 'undefined' && !window.userPerms.canExport) el.style.display = 'none';
        });
    });

    // ─── Load Data ───────────────────────────────────────────────────────────────
    async function loadReportData() {
        try {
            const tok = localStorage.getItem('token');
            const hdr = { 'Authorization': 'Bearer ' + tok };
            var _uRptPat = '/api/reports/patients';
            var _uRptRx  = '/api/reports/rx-actions';
            var _uRptWa  = '/api/workflow-actions';
            const [patRes, rxRes, wfRes] = await Promise.all([
                fetch(_uRptPat, { headers: hdr }).then(r => r.json()),
                fetch(_uRptRx, { headers: hdr }).then(r => r.json()),
                fetch(_uRptWa, { headers: hdr }).then(r => r.json())
            ]);
            allPatientReport   = Array.isArray(patRes) ? patRes : [];
            allRxReport        = Array.isArray(rxRes)  ? rxRes  : [];
            allWorkflowActions = Array.isArray(wfRes)  ? wfRes  : [];
            renderPatientReport();
            renderRxActionReport();
            buildAutocompletes();
        } catch(e) {
            console.error('Report load error:', e);
        }
    }

    // ─── Autocomplete Engine ─────────────────────────────────────────────────────
    function buildAutocompletes() {
        const uniq = arr => [...new Set(arr.filter(Boolean))].sort((a,b) => a.toString().localeCompare(b.toString()));

        const defs = [
            { id: 'prfFirstName',  opts: uniq(allPatientReport.map(p => p.firstName)) },
            { id: 'prfLastName',   opts: uniq(allPatientReport.map(p => p.lastName)) },
            { id: 'prfClinic',     opts: uniq(allPatientReport.map(p => p.Clinic && p.Clinic.name)) },
            { id: 'prfTransport',  opts: uniq([
                ...allPatientReport.map(p => p.PatientTransportCompany  && p.PatientTransportCompany.companyName),
                ...allPatientReport.map(p => p.PharmacyTransportCompany && p.PharmacyTransportCompany.companyName)
            ])},
            { id: 'rrfFirstName',  opts: uniq(allRxReport.map(r => r.Patient && r.Patient.firstName)) },
            { id: 'rrfLastName',   opts: uniq(allRxReport.map(r => r.Patient && r.Patient.lastName)) },
            { id: 'rrfPharmacy',   opts: uniq(allRxReport.map(r => r.Pharmacy && r.Pharmacy.name)) }
        ];

        defs.forEach(({ id, opts }) => {
            const input  = document.getElementById(id);
            const listEl = document.getElementById('ac-' + id);
            if (!input || !listEl || !opts.length) return;

            function show(val) {
                const q = (val || '').toLowerCase().trim();
                const matches = q ? opts.filter(o => o.toLowerCase().includes(q)) : opts;
                if (!matches.length) { listEl.classList.remove('open'); return; }
                var _ach = ''; var _acm = matches.slice(0, 40); for (var _aci = 0; _aci < _acm.length; _aci++) { _ach += '<div class="ac-item">' + escHtml(_acm[_aci]) + '</div>'; } listEl.innerHTML = _ach;
                listEl.querySelectorAll('.ac-item').forEach(item => {
                    item.addEventListener('mousedown', e => {
                        e.preventDefault();
                        input.value = item.textContent;
                        listEl.classList.remove('open');
                        input.dispatchEvent(new Event('input', { bubbles: true }));
                    });
                });
                listEl.classList.add('open');
            }

            input.addEventListener('focus', () => show(input.value));
            input.addEventListener('input', () => show(input.value));
            input.addEventListener('blur',  () => setTimeout(() => listEl.classList.remove('open'), 160));
        });
    }

    function escHtml(s) {
        return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    // ─── Patient Report ───────────────────────────────────────────────────────────
    function getVal(id) { const el = document.getElementById(id); return el ? el.value.toLowerCase().trim() : ''; }

    function renderPatientReport() {
        const filter    = document.getElementById('patientStatusFilter').value;
        const dFrom     = document.getElementById('patientDateFrom').value;
        const dTo       = document.getElementById('patientDateTo').value;
        const qCode     = getVal('prfPatientCode');
        const qFirst    = getVal('prfFirstName');
        const qLast     = getVal('prfLastName');
        const qPhone    = getVal('prfPhone');
        const qTransport= getVal('prfTransport');
        const qClinic   = getVal('prfClinic');

        let data = allPatientReport.filter(p => {
            if (filter !== '' && String(p.isActive) !== filter) return false;
            if (qCode  && !(p.patientCode||'').toLowerCase().includes(qCode))   return false;
            if (qFirst && !(p.firstName||'').toLowerCase().includes(qFirst))     return false;
            if (qLast  && !(p.lastName||'').toLowerCase().includes(qLast))       return false;
            if (qPhone && !(p.phone||'').toLowerCase().includes(qPhone))         return false;
            if (qClinic && !((p.Clinic&&p.Clinic.name)||'').toLowerCase().includes(qClinic)) return false;
            if (qTransport) {
                const pt  = ((p.PatientTransportCompany&&p.PatientTransportCompany.companyName)||'').toLowerCase();
                const pxt = ((p.PharmacyTransportCompany&&p.PharmacyTransportCompany.companyName)||'').toLowerCase();
                if (!pt.includes(qTransport) && !pxt.includes(qTransport)) return false;
            }
            const svc = p.serviceDate || '';
            if (dFrom && svc && svc < dFrom) return false;
            if (dTo   && svc && svc > dTo)   return false;
            return true;
        });

        data.sort((a,b) => {
            let va = getNestedVal(a, prSortCol), vb = getNestedVal(b, prSortCol);
            if (va == null) va = ''; if (vb == null) vb = '';
            if (typeof va === 'string') va = va.toLowerCase();
            if (typeof vb === 'string') vb = vb.toLowerCase();
            return prSortDir === 'asc' ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1);
        });

        const tbody   = document.getElementById('patientReportBody');
        const countEl = document.getElementById('patientReportCount');
        if (!tbody) return;
        if (!data.length) {
            tbody.innerHTML = '<tr><td colspan="11" class="text-center text-muted py-4">No records found</td></tr>';
            if (countEl) countEl.textContent = '0 records';
            return;
        }
        var _ptHtml = ''; var _ptPage = data.slice((prPage-1)*prPageSize, prPage*prPageSize);
        for (var _pi = 0; _pi < _ptPage.length; _pi++) { var p = _ptPage[_pi]; _ptHtml += (function() {
            const statusBadge = p.isActive
                ? '<span class="badge bg-success">Active</span>'
                : '<span class="badge bg-secondary">Inactive</span>';
            const dob = p.dob ? new Date(p.dob+'T12:00:00').toLocaleDateString() : '-';
            const svc = p.serviceDate ? new Date(p.serviceDate+'T12:00:00').toLocaleDateString() : '-';
            return '<tr>' +
                '<td><span class="badge bg-primary">' + (p.patientCode||'') + '</span></td>' +
                '<td>' + (p.firstName||'') + '</td>' +
                '<td>' + (p.lastName||'') + '</td>' +
                '<td>' + dob + '</td>' +
                '<td>' + (p.phone||'-') + '</td>' +
                '<td>' + (p.address||'-') + '</td>' +
                '<td>' + svc + '</td>' +
                '<td>' + statusBadge + '</td>' +
                '<td>' + (p.Clinic&&p.Clinic.name||'-') + '</td>' +
                '<td>' + (p.PatientTransportCompany&&p.PatientTransportCompany.companyName||'-') + '</td>' +
                '<td>' + (p.PharmacyTransportCompany&&p.PharmacyTransportCompany.companyName||'-') + '</td>' +
            '</tr>';
        })();
        } tbody.innerHTML = _ptHtml;
        // Counter and pagination
        var total = data.length;
        var pages = Math.ceil(total / prPageSize) || 1;
        var start = total === 0 ? 0 : (prPage - 1) * prPageSize + 1;
        var end   = Math.min(prPage * prPageSize, total);
        if (countEl) countEl.textContent = 'Showing ' + start + '-' + end + ' of ' + total + ' records';
        var nav = document.getElementById('prPagNav');
        if (nav) nav.innerHTML = buildPagNav(prPage, pages, 'prGoPage');
    }

    function getNestedVal(obj, path) {
        return path.split('.').reduce((o,k) => o && o[k] !== undefined ? o[k] : null, obj);
    }

    function sortPatientReport(col) {
        if (prSortCol === col) prSortDir = prSortDir === 'asc' ? 'desc' : 'asc';
        else { prSortCol = col; prSortDir = 'asc'; }
        document.querySelectorAll('[id^="prIcon_"]').forEach(el => { el.className = 'fas fa-sort text-muted'; el.style.opacity = '0.3'; });
        const icon = document.getElementById('prIcon_' + col);
        if (icon) { icon.className = 'fas fa-sort-' + (prSortDir === 'asc' ? 'up' : 'down') + ' text-primary'; icon.style.opacity = '1'; }
        renderPatientReport();
    }

    function clearPatientFilters() {
        ['prfPatientCode','prfFirstName','prfLastName','prfPhone','prfTransport','prfClinic','patientDateFrom','patientDateTo']
            .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
        document.getElementById('patientStatusFilter').value = '';
        renderPatientReport();
    }

    // ─── RX Action Report ─────────────────────────────────────────────────────────
    function renderRxActionReport() {
        const qRxId  = getVal('rrfRxId');
        const qFirst = getVal('rrfFirstName');
        const qLast  = getVal('rrfLastName');
        const qCode  = getVal('rrfPatientCode');
        const qPharm = getVal('rrfPharmacy');
        const qProg  = document.getElementById('rrfProgress').value;
        const dFrom  = document.getElementById('rxDateFrom').value;
        const dTo    = document.getElementById('rxDateTo').value;

        let data = allRxReport.filter(r => {
            if (qRxId  && !String(r.id).includes(qRxId)) return false;
            if (qFirst && !(r.Patient&&r.Patient.firstName||'').toLowerCase().includes(qFirst)) return false;
            if (qLast  && !(r.Patient&&r.Patient.lastName||'').toLowerCase().includes(qLast))   return false;
            if (qCode  && !(r.Patient&&r.Patient.patientCode||'').toLowerCase().includes(qCode)) return false;
            if (qPharm && !(r.Pharmacy&&r.Pharmacy.name||'').toLowerCase().includes(qPharm))    return false;
            const svc = r.serviceDate || '';
            if (dFrom && svc && svc < dFrom) return false;
            if (dTo   && svc && svc > dTo)   return false;
            return true;
        });

        data.sort((a,b) => {
            let va = getNestedVal(a, rrSortCol), vb = getNestedVal(b, rrSortCol);
            if (va == null) va = ''; if (vb == null) vb = '';
            if (typeof va === 'string') va = va.toLowerCase();
            if (typeof vb === 'string') vb = vb.toLowerCase();
            return rrSortDir === 'asc' ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1);
        });

        if (qProg) {
            data = data.filter(r => {
                const steps = r.completedSteps || [];
                const total = allWorkflowActions.length;
                if (qProg === 'complete') return steps.length >= total && total > 0;
                if (qProg === 'pending')  return steps.length < total;
                return true;
            });
        }

        const tbody = document.getElementById('rxActionBody');
        const countEl = document.getElementById('rxReportCount');
        if (!tbody) return;
        if (!data.length) {
            tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted py-4">No records found</td></tr>';
            if (countEl) countEl.textContent = '0 records';
            return;
        }
        var _rxHtml = ''; var _rxPage = data.slice((rrPage-1)*rrPageSize, rrPage*rrPageSize);
        for (var _ri = 0; _ri < _rxPage.length; _ri++) { var r = _rxPage[_ri]; _rxHtml += (function() {
            const steps   = r.completedSteps || [];
            const wfTotal = allWorkflowActions.length;
            const done    = steps.length;
            const pct     = wfTotal ? Math.round((done / wfTotal) * 100) : 0;
            const nextStep= allWorkflowActions.find(w => !steps.includes(w.id));
            const svc     = r.serviceDate ? new Date(r.serviceDate+'T12:00:00').toLocaleDateString() : '-';
            const ptName  = r.Patient ? r.Patient.firstName + ' ' + r.Patient.lastName : '-';
            const ptCode  = r.Patient ? r.Patient.patientCode : '-';
            const phName  = r.Pharmacy ? r.Pharmacy.name : '-';
            const progBadge = pct >= 100
                ? '<span class="badge bg-success">Complete</span>'
                : '<span class="badge bg-warning text-dark">' + pct + '%</span>';
            var stepsHtml = '';
            if (done > 0) {
                steps.forEach(function(sid) { var a = allWorkflowActions.find(function(w){return w.id===sid;}); if(a) stepsHtml += '<span class="badge bg-success me-1">' + a.name + '</span>'; });
            } else { stepsHtml = '-'; }
            var nextHtml = nextStep ? '<span class="badge bg-warning text-dark">' + nextStep.name + '</span>' : '<span class="badge bg-success">All done</span>';
            return '<tr>' +
                '<td><span class="badge bg-primary">RX-' + r.id + '</span></td>' +
                '<td>' + ptName + '</td>' +
                '<td><span class="badge bg-info text-dark">' + ptCode + '</span></td>' +
                '<td>' + phName + '</td>' +
                '<td>' + svc + '</td>' +
                '<td>' + stepsHtml + '</td>' +
                '<td>' + nextHtml + '</td>' +
                '<td>' + progBadge + '</td>' +
            '</tr>';
        })();
        } tbody.innerHTML = _rxHtml;
        // Counter and pagination
        var rxTotal = data.length;
        var rxPages = Math.ceil(rxTotal / rrPageSize) || 1;
        var rxStart = rxTotal === 0 ? 0 : (rrPage - 1) * rrPageSize + 1;
        var rxEnd   = Math.min(rrPage * rrPageSize, rxTotal);
        if (countEl) countEl.textContent = 'Showing ' + rxStart + '-' + rxEnd + ' of ' + rxTotal + ' records';
        var rrNav = document.getElementById('rrPagNav');
        if (rrNav) rrNav.innerHTML = buildPagNav(rrPage, rxPages, 'rrGoPage');
    }

    function sortRxReport(col) {
        if (rrSortCol === col) rrSortDir = rrSortDir === 'asc' ? 'desc' : 'asc';
        else { rrSortCol = col; rrSortDir = 'asc'; }
        document.querySelectorAll('[id^="rrIcon_"]').forEach(el => { el.className = 'fas fa-sort text-muted'; el.style.opacity = '0.3'; });
        const icon = document.getElementById('rrIcon_' + col);
        if (icon) { icon.className = 'fas fa-sort-' + (rrSortDir === 'asc' ? 'up' : 'down') + ' text-primary'; icon.style.opacity = '1'; }
        renderRxActionReport();
    }

    function clearRxFilters() {
        ['rrfRxId','rrfFirstName','rrfLastName','rrfPatientCode','rrfPharmacy','rxDateFrom','rxDateTo']
            .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
        document.getElementById('rrfProgress').value = '';
        renderRxActionReport();
    }

    // ─── Export CSV ───────────────────────────────────────────────────────────────
    function setupReportExports() {
        document.getElementById('exportPatientCsv').addEventListener('click', () => {
            const filter     = document.getElementById('patientStatusFilter').value;
            const dFrom      = document.getElementById('patientDateFrom').value;
            const dTo        = document.getElementById('patientDateTo').value;
            const qCode      = getVal('prfPatientCode');
            const qFirst     = getVal('prfFirstName');
            const qLast      = getVal('prfLastName');
            const qPhone     = getVal('prfPhone');
            const qTransport = getVal('prfTransport');
            const qClinic    = getVal('prfClinic');

            let data = allPatientReport.filter(p => {
                if (filter !== '' && String(p.isActive) !== filter) return false;
                if (qCode  && !(p.patientCode||'').toLowerCase().includes(qCode))   return false;
                if (qFirst && !(p.firstName||'').toLowerCase().includes(qFirst))     return false;
                if (qLast  && !(p.lastName||'').toLowerCase().includes(qLast))       return false;
                if (qPhone && !(p.phone||'').toLowerCase().includes(qPhone))         return false;
                if (qClinic && !((p.Clinic&&p.Clinic.name)||'').toLowerCase().includes(qClinic)) return false;
                if (qTransport) {
                    const pt  = ((p.PatientTransportCompany&&p.PatientTransportCompany.companyName)||'').toLowerCase();
                    const pxt = ((p.PharmacyTransportCompany&&p.PharmacyTransportCompany.companyName)||'').toLowerCase();
                    if (!pt.includes(qTransport) && !pxt.includes(qTransport)) return false;
                }
                const svc = p.serviceDate || '';
                if (dFrom && svc && svc < dFrom) return false;
                if (dTo   && svc && svc > dTo)   return false;
                return true;
            });

            if (!data.length) { showToast('No data to export', 'warning'); return; }
            const headers = ['Patient ID','First Name','Last Name','DOB','Phone','Address','Service Date','Status','Clinic','Patient Transport','Pharmacy Transport'];
            const rows = data.map(p => [
                p.patientCode||'', p.firstName||'', p.lastName||'',
                p.dob||'', p.phone||'', p.address||'', p.serviceDate||'',
                p.isActive ? 'Active' : 'Inactive',
                (p.Clinic&&p.Clinic.name)||'',
                (p.PatientTransportCompany&&p.PatientTransportCompany.companyName)||'',
                (p.PharmacyTransportCompany&&p.PharmacyTransportCompany.companyName)||''
            ]);
            downloadCsv('patient_report.csv', headers, rows);
            showToast('Patient report exported!', 'success');
        });

        document.getElementById('exportRxCsv').addEventListener('click', () => {
            if (!allRxReport.length) { showToast('No data to export', 'warning'); return; }
            const headers = ['RX #','Patient','Patient ID','Pharmacy','Service Date','Done Steps','Progress %'];
            const rows = allRxReport.map(r => {
                const steps = r.completedSteps || [];
                const pct   = allWorkflowActions.length ? Math.round(steps.length / allWorkflowActions.length * 100) : 0;
                return [
                    'RX-' + r.id,
                    r.Patient ? r.Patient.firstName + ' ' + r.Patient.lastName : '',
                    r.Patient ? r.Patient.patientCode : '',
                    r.Pharmacy ? r.Pharmacy.name : '',
                    r.serviceDate||'',
                    steps.length,
                    pct + '%'
                ];
            });
            downloadCsv('rx_report.csv', headers, rows);
            showToast('RX report exported!', 'success');
        });
    }

    function downloadCsv(filename, headers, rows) {
        const csv = [headers, ...rows].map(r => r.map(v => '"' + String(v||'').replace(/"/g,'""') + '"').join(',')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url  = URL.createObjectURL(blob);
        const a    = Object.assign(document.createElement('a'), { href: url, download: filename });
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    function printReport(title, tableId) {
        const tbl = document.getElementById(tableId);
        if (!tbl) return;
        const win = window.open('', '_blank');
        win.document.write(`<!DOCTYPE html><html><head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8"><title>${title}</title>
            <link href="/assets/bootstrap.min.css" rel="stylesheet">
            </head><body class="p-4"><h4>${title}</h4>${tbl.outerHTML}</body></html>`);
        win.document.close();
        win.print();
    }