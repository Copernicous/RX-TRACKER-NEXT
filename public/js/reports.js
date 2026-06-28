    var allPatientReport = [];
    var allRxReport = [];
    var allWorkflowActions = [];
    var prSortCol = 'id', prSortDir = 'desc';
    var rrSortCol = 'id', rrSortDir = 'desc';
    var prPage = 1, prPageSize = 10;
    var rrPage = 1, rrPageSize = 10;
    var _panelStates = {};

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

        ['exportPatientCsv','exportPatientXls','exportPatientPdf','exportRxCsv','exportRxXls','exportRxPdf'].forEach(id => {
            const el = document.getElementById(id);
            if (el && typeof window.userPerms !== 'undefined' && !window.userPerms.canExport) el.style.display = 'none';
        });
    });

    // ─── Load Data ───────────────────────────────────────────────────────────────
    async function loadReportData() {
        try {
            const tok = localStorage.getItem('token');
            const hdr = { 'Authorization': 'Bearer ' + tok };
            const wfRes = await fetch(window.rxUrl('/api/lookup/workflow-actions'), { headers: hdr }).then(r => r.json());
            allWorkflowActions = Array.isArray(wfRes)  ? wfRes  : [];
            buildAutocompletes();
            await Promise.all([renderPatientReport(), renderRxActionReport()]);
        } catch(e) {
            console.error('Report load error:', e);
        }
    }

    function setReportParam(params, name, value) {
        if (value !== null && value !== undefined && String(value).trim() !== '') {
            params.set(name, String(value).trim());
        }
    }

    async function fetchReportJson(url) {
        const tok = localStorage.getItem('token');
        const res = await fetch(window.rxUrl(url), { headers: { 'Authorization': 'Bearer ' + tok } });
        if (!res.ok) throw new Error('Report API ' + res.status);
        return res.json();
    }

    function buildPatientReportParams(options) {
        options = options || {};
        var params = new URLSearchParams();
        params.set('paginated', 'true');
        if (options.exportAll) {
            params.set('exportAll', 'true');
            params.set('page', '1');
            params.set('pageSize', '500');
        } else {
            params.set('page', String(prPage));
            params.set('pageSize', String(prPageSize));
        }
        params.set('sort', prSortCol || 'id');
        params.set('dir', prSortDir || 'desc');
        setReportParam(params, 'status', document.getElementById('patientStatusFilter')?.value || '');
        setReportParam(params, 'dateFrom', document.getElementById('patientDateFrom')?.value || '');
        setReportParam(params, 'dateTo', document.getElementById('patientDateTo')?.value || '');
        setReportParam(params, 'patientCode', getVal('prfPatientCode'));
        setReportParam(params, 'firstName', getVal('prfFirstName'));
        setReportParam(params, 'lastName', getVal('prfLastName'));
        setReportParam(params, 'phone', getVal('prfPhone'));
        setReportParam(params, 'transport', getVal('prfTransport'));
        setReportParam(params, 'clinic', getVal('prfClinic'));
        return params;
    }

    function buildRxReportParams(options) {
        options = options || {};
        var params = new URLSearchParams();
        params.set('paginated', 'true');
        if (options.exportAll) {
            params.set('exportAll', 'true');
            params.set('page', '1');
            params.set('pageSize', '500');
        } else {
            params.set('page', String(rrPage));
            params.set('pageSize', String(rrPageSize));
        }
        params.set('sort', rrSortCol || 'id');
        params.set('dir', rrSortDir || 'desc');
        setReportParam(params, 'rxId', getVal('rrfRxId'));
        setReportParam(params, 'firstName', getVal('rrfFirstName'));
        setReportParam(params, 'lastName', getVal('rrfLastName'));
        setReportParam(params, 'patientCode', getVal('rrfPatientCode'));
        setReportParam(params, 'pharmacy', getVal('rrfPharmacy'));
        setReportParam(params, 'progress', document.getElementById('rrfProgress')?.value || '');
        setReportParam(params, 'dateFrom', document.getElementById('rxDateFrom')?.value || '');
        setReportParam(params, 'dateTo', document.getElementById('rxDateTo')?.value || '');
        return params;
    }

    async function fetchPatientReportRows(options) {
        const data = await fetchReportJson('/api/reports/patients?' + buildPatientReportParams(options || {}).toString());
        return data && Array.isArray(data.rows) ? data.rows : [];
    }

    async function fetchRxReportRows(options) {
        const data = await fetchReportJson('/api/reports/rx-actions?' + buildRxReportParams(options || {}).toString());
        return data && Array.isArray(data.rows) ? data.rows : [];
    }

    // ─── Autocomplete Engine ─────────────────────────────────────────────────────
    function buildAutocompletes() {
        const uniq = arr => [...new Set(arr
            .filter(v => v !== null && v !== undefined && String(v).trim() !== '')
            .map(v => String(v).trim())
        )].sort((a,b) => a.localeCompare(b));

        function includesValue(value, query) {
            return !query || String(value || '').toLowerCase().includes(query);
        }

        function patientTransportNames(p) {
            return [
                p.PatientTransportCompany && p.PatientTransportCompany.companyName,
                p.PharmacyTransportCompany && p.PharmacyTransportCompany.companyName
            ];
        }

        function patientMatchesAutocompleteContext(p, skipId) {
            const filter     = document.getElementById('patientStatusFilter').value;
            const dFrom      = document.getElementById('patientDateFrom').value;
            const dTo        = document.getElementById('patientDateTo').value;
            const qCode      = getVal('prfPatientCode');
            const qFirst     = getVal('prfFirstName');
            const qLast      = getVal('prfLastName');
            const qPhone     = getVal('prfPhone');
            const qTransport = getVal('prfTransport');
            const qClinic    = getVal('prfClinic');

            if (filter !== '' && String(p.isActive) !== filter) return false;
            if (qCode && !includesValue(p.patientCode, qCode)) return false;
            if (skipId !== 'prfFirstName' && qFirst && !includesValue(p.firstName, qFirst)) return false;
            if (skipId !== 'prfLastName' && qLast && !includesValue(p.lastName, qLast)) return false;
            if (qPhone && !includesValue(p.phone, qPhone)) return false;
            if (skipId !== 'prfClinic' && qClinic && !includesValue(p.Clinic && p.Clinic.name, qClinic)) return false;
            if (skipId !== 'prfTransport' && qTransport) {
                const names = patientTransportNames(p).map(v => String(v || '').toLowerCase());
                if (!names.some(name => name.includes(qTransport))) return false;
            }
            const svc = p.serviceDate || '';
            if (dFrom && svc && svc < dFrom) return false;
            if (dTo && svc && svc > dTo) return false;
            return true;
        }

        function rxMatchesProgress(r, progress) {
            if (!progress) return true;
            const steps = r.completedSteps || [];
            const total = allWorkflowActions.length;
            if (progress === 'complete') return steps.length >= total && total > 0;
            if (progress === 'pending') return steps.length < total;
            return true;
        }

        function rxMatchesAutocompleteContext(r, skipId) {
            const qRxId  = getVal('rrfRxId');
            const qFirst = getVal('rrfFirstName');
            const qLast  = getVal('rrfLastName');
            const qCode  = getVal('rrfPatientCode');
            const qPharm = getVal('rrfPharmacy');
            const qProg  = document.getElementById('rrfProgress').value;
            const dFrom  = document.getElementById('rxDateFrom').value;
            const dTo    = document.getElementById('rxDateTo').value;
        if (dateRangeIsReversed(dFrom, dTo)) {
            showToast('RX report date range cannot have From after To.', 'warning');
            document.getElementById('rxDateTo').value = dFrom;
        }
            const patient = r.Patient || {};

            if (qRxId && !String(r.id).includes(qRxId)) return false;
            if (skipId !== 'rrfFirstName' && qFirst && !includesValue(patient.firstName, qFirst)) return false;
            if (skipId !== 'rrfLastName' && qLast && !includesValue(patient.lastName, qLast)) return false;
            if (qCode && !includesValue(patient.patientCode, qCode)) return false;
            if (skipId !== 'rrfPharmacy' && qPharm && !includesValue(r.Pharmacy && r.Pharmacy.name, qPharm)) return false;
            const svc = r.serviceDate || '';
            if (dFrom && svc && svc < dFrom) return false;
            if (dTo && svc && svc > dTo) return false;
            return rxMatchesProgress(r, qProg);
        }

        const defs = [
            { id: 'prfFirstName', options: () => uniq(allPatientReport.filter(p => patientMatchesAutocompleteContext(p, 'prfFirstName')).map(p => p.firstName)), render: renderPatientReport },
            { id: 'prfLastName',  options: () => uniq(allPatientReport.filter(p => patientMatchesAutocompleteContext(p, 'prfLastName')).map(p => p.lastName)), render: renderPatientReport },
            { id: 'prfClinic',    options: () => uniq(allPatientReport.filter(p => patientMatchesAutocompleteContext(p, 'prfClinic')).map(p => p.Clinic && p.Clinic.name)), render: renderPatientReport },
            { id: 'prfTransport', options: () => uniq(allPatientReport.filter(p => patientMatchesAutocompleteContext(p, 'prfTransport')).flatMap(patientTransportNames)), render: renderPatientReport },
            { id: 'rrfFirstName', options: () => uniq(allRxReport.filter(r => rxMatchesAutocompleteContext(r, 'rrfFirstName')).map(r => r.Patient && r.Patient.firstName)), render: renderRxActionReport },
            { id: 'rrfLastName',  options: () => uniq(allRxReport.filter(r => rxMatchesAutocompleteContext(r, 'rrfLastName')).map(r => r.Patient && r.Patient.lastName)), render: renderRxActionReport },
            { id: 'rrfPharmacy',  options: () => uniq(allRxReport.filter(r => rxMatchesAutocompleteContext(r, 'rrfPharmacy')).map(r => r.Pharmacy && r.Pharmacy.name)), render: renderRxActionReport }
        ];

        defs.forEach(({ id, options, render }) => {
            const input  = document.getElementById(id);
            const listEl = document.getElementById('ac-' + id);
            if (!input || !listEl) return;

            function show(val) {
                const opts = options();
                const q = (val || '').toLowerCase().trim();
                const matches = q ? opts.filter(o => o.toLowerCase().includes(q)) : opts;
                if (!matches.length) { listEl.classList.remove('open'); return; }
                var listHtml = '';
                matches.slice(0, 40).forEach(function(o) {
                    listHtml += '<div class="ac-item">' + escHtml(o) + '</div>';
                });
                listEl.innerHTML = listHtml;
                listEl.querySelectorAll('.ac-item').forEach(item => {
                    item.addEventListener('mousedown', e => {
                        e.preventDefault();
                        input.value = item.textContent;
                        listEl.classList.remove('open');
                        if (render) render();
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

    function validateDateRange(fromId, toId, label) {
        var fromEl = document.getElementById(fromId);
        var toEl = document.getElementById(toId);
        if (!fromEl || !toEl) return true;
        var from = fromEl.value;
        var to = toEl.value;
        if (from && to && from > to) {
            showToast((label || 'Date range') + ' cannot have From after To.', 'warning');
            toEl.value = from;
            return false;
        }
        return true;
    }

    function dateRangeIsReversed(from, to) {
        if (!from || !to) return false;
        var f = new Date(from + 'T00:00:00');
        var t = new Date(to + 'T00:00:00');
        if (isNaN(f.getTime()) || isNaN(t.getTime())) return false;
        f.setHours(0,0,0,0);
        t.setHours(0,0,0,0);
        return f.getTime() > t.getTime();
    }

    // ─── Patient Report ───────────────────────────────────────────────────────────
    function getVal(id) { const el = document.getElementById(id); return el ? el.value.toLowerCase().trim() : ''; }

    function renderReportPager(navId, currentPage, totalPages, onPage) {
        var nav = document.getElementById(navId);
        if (!nav) return;
        totalPages = Math.max(1, totalPages || 1);
        currentPage = Math.min(Math.max(1, currentPage || 1), totalPages);

        function pageItem(label, page, disabled, active) {
            return '<li class="page-item ' + (disabled ? 'disabled ' : '') + (active ? 'active' : '') + '">' +
                '<button type="button" class="page-link" data-page="' + page + '"' + (disabled ? ' disabled' : '') + '>' + label + '</button>' +
                '</li>';
        }

        var html = pageItem('&laquo;', 1, currentPage <= 1, false);
        html += pageItem('&lsaquo;', Math.max(1, currentPage - 1), currentPage <= 1, false);

        if (totalPages <= 7) {
            for (var p = 1; p <= totalPages; p++) html += pageItem(String(p), p, false, p === currentPage);
        } else {
            html += pageItem('1', 1, false, currentPage === 1);
            if (currentPage > 4) html += '<li class="page-item disabled"><span class="page-link">...</span></li>';
            var from = Math.max(2, currentPage - 1);
            var to = Math.min(totalPages - 1, currentPage + 1);
            for (var mid = from; mid <= to; mid++) html += pageItem(String(mid), mid, false, mid === currentPage);
            if (currentPage < totalPages - 3) html += '<li class="page-item disabled"><span class="page-link">...</span></li>';
            html += pageItem(String(totalPages), totalPages, false, currentPage === totalPages);
        }

        html += pageItem('&rsaquo;', Math.min(totalPages, currentPage + 1), currentPage >= totalPages, false);
        html += pageItem('&raquo;', totalPages, currentPage >= totalPages, false);
        nav.innerHTML = html;

        nav.querySelectorAll('button[data-page]').forEach(function(btn) {
            btn.addEventListener('click', function() {
                var page = parseInt(btn.getAttribute('data-page'), 10);
                if (!Number.isFinite(page) || btn.disabled) return;
                onPage(page);
            });
        });
    }

    function prChangeSize(value) {
        prPageSize = parseInt(value, 10) || 10;
        prPage = 1;
        renderPatientReport();
    }
    function rrChangeSize(value) {
        rrPageSize = parseInt(value, 10) || 10;
        rrPage = 1;
        renderRxActionReport();
    }
    window.prChangeSize = prChangeSize;
    window.rrChangeSize = rrChangeSize;
    window.renderPatientReport = renderPatientReport;
    window.renderRxActionReport = renderRxActionReport;

    function renderPatientReport() {
        validateDateRange('patientDateFrom', 'patientDateTo', 'Patient report date range');
        const tbody   = document.getElementById('patientReportBody');
        const countEl = document.getElementById('patientReportCount');
        const navEl   = document.getElementById('prPagNav');
        if (!tbody) return;
        tbody.innerHTML = '<tr><td colspan="11" class="text-center text-muted py-4"><i class="fas fa-spinner fa-spin me-2"></i>Loading...</td></tr>';

        return fetchReportJson('/api/reports/patients?' + buildPatientReportParams().toString()).then(function(result) {
        var data = result && Array.isArray(result.rows) ? result.rows : [];
        allPatientReport = data;
        if (!data.length) {
            tbody.innerHTML = '<tr><td colspan="11" class="text-center text-muted py-4">No records found</td></tr>';
            if (countEl) countEl.textContent = '0 records';
            if (navEl) navEl.innerHTML = '';
            return;
        }
        var totalRecords = Number(result.total || data.length || 0);
        var totalPages = Number(result.totalPages || Math.max(1, Math.ceil(totalRecords / prPageSize)));
        prPage = Number(result.page || prPage || 1);
        prPageSize = Number(result.pageSize || prPageSize || 10);
        var startIndex = (prPage - 1) * prPageSize;
        var endIndex = Math.min(startIndex + data.length, totalRecords);
        var pageData = data;
        var patientRowsHtml = '';
        pageData.forEach(function(p) {
            const statusBadge = p.isActive
                ? '<span class="badge bg-success">Active</span>'
                : '<span class="badge bg-secondary">Inactive</span>';
            const dob = p.dob ? new Date(p.dob+'T12:00:00').toLocaleDateString() : '-';
            const svc = p.serviceDate ? new Date(p.serviceDate+'T12:00:00').toLocaleDateString() : '-';
            patientRowsHtml += '<tr>' +
                '<td><span class="badge bg-primary">' + (p.patientCode || '') + '</span></td>' +
                '<td>' + (p.firstName || '') + '</td>' +
                '<td>' + (p.lastName || '') + '</td>' +
                '<td>' + dob + '</td>' +
                '<td>' + (p.phone || '-') + '</td>' +
                '<td>' + (p.address || '-') + '</td>' +
                '<td>' + svc + '</td>' +
                '<td>' + statusBadge + '</td>' +
                '<td>' + ((p.Clinic && p.Clinic.name) || '-') + '</td>' +
                '<td>' + ((p.PatientTransportCompany && p.PatientTransportCompany.companyName) || '-') + '</td>' +
                '<td>' + ((p.PharmacyTransportCompany && p.PharmacyTransportCompany.companyName) || '-') + '</td>' +
            '</tr>';
        });
        tbody.innerHTML = patientRowsHtml;
        if (countEl) countEl.textContent = 'Showing ' + (startIndex + 1) + '-' + endIndex + ' of ' + totalRecords;
        renderReportPager('prPagNav', prPage, totalPages, function(page) {
            prPage = page;
            renderPatientReport();
        });
        }).catch(function(err) {
            tbody.innerHTML = '<tr><td colspan="11" class="text-center text-danger py-4">Could not load patient report.</td></tr>';
            if (countEl) countEl.textContent = '';
            if (navEl) navEl.innerHTML = '';
            console.error('Patient report load error:', err);
        });
    }

    function getNestedVal(obj, path) {
        return path.split('.').reduce((o,k) => o && o[k] !== undefined ? o[k] : null, obj);
    }

    function sortPatientReport(col) {
        if (prSortCol === col) prSortDir = prSortDir === 'asc' ? 'desc' : 'asc';
        else { prSortCol = col; prSortDir = 'asc'; }
        prPage = 1;
        document.querySelectorAll('[id^="prIcon_"]').forEach(el => { el.className = 'fas fa-sort text-muted'; el.style.opacity = '0.3'; });
        const icon = document.getElementById('prIcon_' + col);
        if (icon) { icon.className = 'fas fa-sort-' + (prSortDir === 'asc' ? 'up' : 'down') + ' text-primary'; icon.style.opacity = '1'; }
        renderPatientReport();
    }

    function clearPatientFilters() {
        ['prfPatientCode','prfFirstName','prfLastName','prfPhone','prfTransport','prfClinic','patientDateFrom','patientDateTo']
            .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
        document.getElementById('patientStatusFilter').value = '';
        prPage = 1;
        renderPatientReport();
    }

    // ─── RX Action Report ─────────────────────────────────────────────────────────
    function renderRxActionReport() {
        const dFrom  = document.getElementById('rxDateFrom').value;
        const dTo    = document.getElementById('rxDateTo').value;
        if (dateRangeIsReversed(dFrom, dTo)) {
            showToast('RX report date range cannot have From after To.', 'warning');
            document.getElementById('rxDateTo').value = dFrom;
        }

        const tbody = document.getElementById('rxActionBody');
        const countEl = document.getElementById('rxReportCount');
        const navEl = document.getElementById('rrPagNav');
        if (!tbody) return;
        tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted py-4"><i class="fas fa-spinner fa-spin me-2"></i>Loading...</td></tr>';

        return fetchReportJson('/api/reports/rx-actions?' + buildRxReportParams().toString()).then(function(result) {
        var data = result && Array.isArray(result.rows) ? result.rows : [];
        allRxReport = data;
        if (!data.length) {
            tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted py-4">No records found</td></tr>';
            if (countEl) countEl.textContent = '0 records';
            if (navEl) navEl.innerHTML = '';
            return;
        }
        var totalRecords = Number(result.total || data.length || 0);
        var totalPages = Number(result.totalPages || Math.max(1, Math.ceil(totalRecords / rrPageSize)));
        rrPage = Number(result.page || rrPage || 1);
        rrPageSize = Number(result.pageSize || rrPageSize || 10);
        var startIndex = (rrPage - 1) * rrPageSize;
        var endIndex = Math.min(startIndex + data.length, totalRecords);
        var pageData = data;
        var rxRowsHtml = '';
        pageData.forEach(function(r) {
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
            var doneStepsHtml = '';
            if (done > 0) {
                steps.forEach(function(id) {
                    const action = allWorkflowActions.find(w => w.id === id);
                    if (action) doneStepsHtml += '<span class="badge bg-success me-1">' + action.name + '</span>';
                });
            } else {
                doneStepsHtml = '-';
            }
            rxRowsHtml += '<tr>' +
                '<td><span class="badge bg-primary">RX-' + r.id + '</span></td>' +
                '<td>' + ptName + '</td>' +
                '<td><span class="badge bg-info text-dark">' + ptCode + '</span></td>' +
                '<td>' + phName + '</td>' +
                '<td>' + svc + '</td>' +
                '<td>' + doneStepsHtml + '</td>' +
                '<td>' + (nextStep ? '<span class="badge bg-warning text-dark">' + nextStep.name + '</span>' : '<span class="badge bg-success">All done</span>') + '</td>' +
                '<td>' + progBadge + '</td>' +
            '</tr>';
        });
        tbody.innerHTML = rxRowsHtml;
        if (countEl) countEl.textContent = 'Showing ' + (startIndex + 1) + '-' + endIndex + ' of ' + totalRecords;
        renderReportPager('rrPagNav', rrPage, totalPages, function(page) {
            rrPage = page;
            renderRxActionReport();
        });
        }).catch(function(err) {
            tbody.innerHTML = '<tr><td colspan="8" class="text-center text-danger py-4">Could not load RX action report.</td></tr>';
            if (countEl) countEl.textContent = '';
            if (navEl) navEl.innerHTML = '';
            console.error('RX action report load error:', err);
        });
    }

    function sortRxReport(col) {
        if (rrSortCol === col) rrSortDir = rrSortDir === 'asc' ? 'desc' : 'asc';
        else { rrSortCol = col; rrSortDir = 'asc'; }
        rrPage = 1;
        document.querySelectorAll('[id^="rrIcon_"]').forEach(el => { el.className = 'fas fa-sort text-muted'; el.style.opacity = '0.3'; });
        const icon = document.getElementById('rrIcon_' + col);
        if (icon) { icon.className = 'fas fa-sort-' + (rrSortDir === 'asc' ? 'up' : 'down') + ' text-primary'; icon.style.opacity = '1'; }
        renderRxActionReport();
    }

    function clearRxFilters() {
        ['rrfRxId','rrfFirstName','rrfLastName','rrfPatientCode','rrfPharmacy','rxDateFrom','rxDateTo']
            .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
        document.getElementById('rrfProgress').value = '';
        rrPage = 1;
        renderRxActionReport();
    }

    // ─── Export CSV ───────────────────────────────────────────────────────────────
    function setupReportExports() {
        document.getElementById('exportPatientCsv').addEventListener('click', async () => {
            const data = await fetchPatientReportRows({ exportAll: true });
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

        document.getElementById('exportRxCsv').addEventListener('click', async () => {
            const data = await fetchRxReportRows({ exportAll: true });
            if (!data.length) { showToast('No data to export', 'warning'); return; }
            const headers = ['RX #','Patient','Patient ID','Pharmacy','Service Date','Done Steps','Progress %'];
            const rows = data.map(r => {
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
        win.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Type" content="text/html; charset=UTF-8"><title>' + title + '</title><link href="/assets/bootstrap.min.css" rel="stylesheet"></head><body class="p-4"><h4>' + title + '</h4>' + tbl.outerHTML + '</body></html>');
        win.document.close();
        win.print();
    }

    // BUG-04: Excel export — HTML table as .xls (opens natively in Excel, no external lib needed)
    function downloadXls(filename, headers, rows) {
        var headerHtml = '';
        headers.forEach(function(h) {
            headerHtml += '<th>' + String(h || '').replace(/</g,'&lt;') + '</th>';
        });
        var bodyHtml = '';
        rows.forEach(function(r) {
            var rowHtml = '';
            r.forEach(function(v) {
                rowHtml += '<td>' + String(v || '').replace(/</g,'&lt;') + '</td>';
            });
            bodyHtml += '<tr>' + rowHtml + '</tr>';
        });
        var table = '<table><thead><tr>' + headerHtml + '</tr></thead><tbody>' + bodyHtml + '</tbody></table>';
        var html = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="UTF-8"><!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>Report</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]--></head><body>' + table + '</body></html>';
        var blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8' });
        var url  = URL.createObjectURL(blob);
        var a    = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // Helper: returns filtered patient data (mirrors CSV export filter logic, avoids duplication)
    function getFilteredPatientData() {
        validateDateRange('patientDateFrom', 'patientDateTo', 'Patient report date range');
        return fetchPatientReportRows({ exportAll: true });
    }

    // BUG-04/05: Wire Excel, PDF, Print buttons — FortiGate-safe (addEventListener only, no inline handlers)
    document.addEventListener('DOMContentLoaded', function() {
        // ── Patient tab ──
        var patXls = document.getElementById('exportPatientXls');
        if (patXls) patXls.addEventListener('click', async function() {
            var data = await getFilteredPatientData();
            if (!data.length) { showToast('No data to export', 'warning'); return; }
            var headers = ['Patient ID','First Name','Last Name','DOB','Phone','Address','Service Date','Status','Clinic','Patient Transport','Pharmacy Transport'];
            var rows = data.map(function(p) {
                return [p.patientCode||'', p.firstName||'', p.lastName||'', p.dob||'', p.phone||'', p.address||'', p.serviceDate||'',
                        p.isActive ? 'Active' : 'Inactive',
                        (p.Clinic && p.Clinic.name) || '',
                        (p.PatientTransportCompany && p.PatientTransportCompany.companyName) || '',
                        (p.PharmacyTransportCompany && p.PharmacyTransportCompany.companyName) || ''];
            });
            downloadXls('patient_report_' + new Date().toISOString().slice(0,10) + '.xls', headers, rows);
            showToast('Patient report exported as Excel!', 'success');
        });
        var patPdf   = document.getElementById('exportPatientPdf');
        if (patPdf)   patPdf.addEventListener('click',   function() { printReport('Patient Report', 'patientReportTable'); });
        var patPrint = document.getElementById('printPatientBtn');
        if (patPrint) patPrint.addEventListener('click', function() { printReport('Patient Report', 'patientReportTable'); });

        // ── RX tab ──
        var rxXls = document.getElementById('exportRxXls');
        if (rxXls) rxXls.addEventListener('click', async function() {
            var data = await fetchRxReportRows({ exportAll: true });
            if (!data.length) { showToast('No data to export', 'warning'); return; }
            var headers = ['RX #','Patient','Patient ID','Pharmacy','Service Date','Done Steps','Progress %'];
            var rows = data.map(function(r) {
                var steps = r.completedSteps || [];
                var pct   = allWorkflowActions.length ? Math.round(steps.length / allWorkflowActions.length * 100) : 0;
                return ['RX-' + r.id,
                        r.Patient ? r.Patient.firstName + ' ' + r.Patient.lastName : '',
                        r.Patient ? r.Patient.patientCode : '',
                        r.Pharmacy ? r.Pharmacy.name : '',
                        r.serviceDate || '', steps.length, pct + '%'];
            });
            downloadXls('rx_report_' + new Date().toISOString().slice(0,10) + '.xls', headers, rows);
            showToast('RX report exported as Excel!', 'success');
        });
        var rxPdf   = document.getElementById('exportRxPdf');
        if (rxPdf)   rxPdf.addEventListener('click',   function() { printReport('RX Records Report', 'rxReportTable'); });
        var rxPrint = document.getElementById('printRxBtn');
        if (rxPrint) rxPrint.addEventListener('click', function() { printReport('RX Records Report', 'rxReportTable'); });
    });

