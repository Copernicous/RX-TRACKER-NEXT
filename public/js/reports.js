    var allPatientReport = [];
    var allRxReport = [];
    var allCcReport = [];
    var allCcAttempts = [];
    var allCcSupervisor = null;
    var allWorkflowActions = [];
    var reportLookups = {
        pharmacies: [],
        clinics: [],
        patientTransport: [],
        pharmacyTransport: []
    };
    var prSortCol = 'id', prSortDir = 'desc';
    var rrSortCol = 'id', rrSortDir = 'desc';
    var ccrSortCol = 'lastActionAt', ccrSortDir = 'desc';
    var ccaSortCol = 'dialedAt', ccaSortDir = 'desc';
    var allDeliveryLogArchives = [];
    var prPage = 1, prPageSize = 10;
    var rrPage = 1, rrPageSize = 10;
    var ccrPage = 1, ccrPageSize = 10;
    var ccaPage = 1, ccaPageSize = 20;
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

        const reportPerms = typeof getPagePerms === 'function' ? getPagePerms() : { canExport: true, canPrint: true };
        ['exportPatientCsv','exportPatientXls','exportPatientRxDetailCsv','exportPatientRxDetailXls','exportRxCsv','exportRxXls','exportCcCsv','exportCcXls','exportCcAttemptsCsv','exportCcAttemptsXls','exportCcSupervisorCsv'].forEach(id => {
            const el = document.getElementById(id);
            if (el && typeof setRoleActionDisabled === 'function') setRoleActionDisabled(el, !reportPerms.canExport, 'Export disabled for this role.');
        });
        ['exportPatientPdf','exportRxPdf','printPatientBtn','printRxBtn','printCcBtn','printCcAttemptsBtn','printCcSupervisorBtn'].forEach(id => {
            const el = document.getElementById(id);
            if (el && typeof setRoleActionDisabled === 'function') setRoleActionDisabled(el, !reportPerms.canPrint, 'Print disabled for this role.');
        });
        ['refreshDeliveryLogArchiveBtn'].forEach(id => {
            const el = document.getElementById(id);
            if (el && typeof setRoleActionDisabled === 'function') setRoleActionDisabled(el, !reportPerms.canPrint, 'Print disabled for this role.');
        });
    });

    // ─── Load Data ───────────────────────────────────────────────────────────────
    async function loadReportData() {
        try {
            await loadReportLookups();
            setDefaultCallCenterDates();
            buildAutocompletes();
            await Promise.all([renderPatientReport(), renderRxActionReport(), renderCallCenterReports(), renderDeliveryLogArchiveRecords()]);
        } catch(e) {
            console.error('Report load error:', e);
        }
    }

    async function loadLookup(module) {
        const response = await fetchWithAuth('/api/lookup/' + module);
        if (!response || !response.ok) return [];
        const data = await response.json();
        return Array.isArray(data) ? data : [];
    }

    function populateLookupSelect(id, rows, labelField, placeholder, valueField, labelFormatter) {
        const select = document.getElementById(id);
        if (!select) return;
        const current = select.value || '';
        valueField = valueField || 'id';
        let html = '<option value="">' + escHtml(placeholder) + '</option>';
        (rows || []).forEach(function(row) {
            const label = typeof labelFormatter === 'function'
                ? labelFormatter(row)
                : (row[labelField] || ('#' + row.id));
            html += '<option value="' + escHtml(row[valueField]) + '">' + escHtml(label) + '</option>';
        });
        select.innerHTML = html;
        select.value = current;
    }

    async function loadReportLookups() {
        const results = await Promise.all([
            loadLookup('workflow-actions'),
            loadLookup('pharmacies'),
            loadLookup('clinics'),
            loadLookup('patient-transport'),
            loadLookup('pharmacy-transport')
        ]);
        allWorkflowActions = results[0];
        reportLookups.pharmacies = results[1];
        reportLookups.clinics = results[2];
        reportLookups.patientTransport = results[3];
        reportLookups.pharmacyTransport = results[4];

        ['prfPharmacyId', 'rrfPharmacyId'].forEach(id =>
            populateLookupSelect(id, reportLookups.pharmacies, 'name', 'All Pharmacies'));
        ['prfClinicId', 'rrfClinicId'].forEach(id =>
            populateLookupSelect(id, reportLookups.clinics, 'name', 'All Clinics'));
        ['prfPatientTransportId', 'rrfPatientTransportId'].forEach(id =>
            populateLookupSelect(id, reportLookups.patientTransport, 'companyName', 'All Patient Transports'));
        ['prfPharmacyTransportId', 'rrfPharmacyTransportId'].forEach(id =>
            populateLookupSelect(id, reportLookups.pharmacyTransport, 'companyName', 'All Pharmacy Transports'));
        populateLookupSelect('rrfCurrentWorkflowStage', allWorkflowActions, 'name', 'All Current Stages', 'sequenceNumber');
        populateLookupSelect(
            'rrfWorkflowStage',
            allWorkflowActions,
            'name',
            'All Next Actions',
            'sequenceNumber',
            action => 'Needs: ' + (action.name || ('Workflow action ' + action.sequenceNumber))
        );
        populateLookupSelect('rrfCompletedStage', allWorkflowActions, 'name', 'Any Action in History', 'id');
    }

    function setReportParam(params, name, value) {
        if (value !== null && value !== undefined && String(value).trim() !== '') {
            params.set(name, String(value).trim());
        }
    }

    async function fetchReportJson(url) {
        const res = await fetchWithAuth(url);
        if (!res) throw new Error('Report API authentication failed');
        if (!res.ok) throw new Error('Report API ' + res.status);
        return res.json();
    }

    function localDateToken(date) {
        const d = date ? new Date(date) : new Date();
        if (isNaN(d.getTime())) return 'invalid-date';
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return String(d.getFullYear()) + mm + dd;
    }

    function formatLocalDateTime(value) {
        if (!value) return '';
        const parsed = new Date(value);
        if (isNaN(parsed.getTime())) return '';
        return parsed.toLocaleString([], {
            month: '2-digit',
            day: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    }

    function formatArchiveDate(value) {
        if (!value) return '';
        const parsed = new Date(value);
        if (isNaN(parsed.getTime())) return '';
        return parsed.toLocaleString([], {
            month: '2-digit',
            day: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    function fetchDeliveryLogArchives() {
        return fetchReportJson('/api/reports/delivery-log-archives');
    }

    async function renderDeliveryLogArchiveRecords() {
        const tbody = document.getElementById('deliveryLogArchiveBody');
        if (!tbody) return Promise.resolve();
        tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted py-4"><i class="fas fa-spinner fa-spin me-2"></i>Loading...</td></tr>';

        try {
            const records = await fetchDeliveryLogArchives();
            allDeliveryLogArchives = Array.isArray(records) ? records : [];
            if (!allDeliveryLogArchives.length) {
                tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted py-4">No archived delivery logs yet</td></tr>';
                return;
            }

            tbody.innerHTML = allDeliveryLogArchives.map(function(record) {
                const encodedId = encodeURIComponent(record.id || '');
                const createdAt = record.createdAt ? formatArchiveDate(record.createdAt) : '';
                return '<tr>' +
                    '<td>' + escHtml(record.reference || '') + '</td>' +
                    '<td>' + escHtml(record.verification || '') + '</td>' +
                    '<td>' + escHtml(createdAt || '') + '</td>' +
                    '<td>' + escHtml(String(record.total || 0)) + '</td>' +
                    '<td>' + escHtml(record.generated || '') + '</td>' +
                    '<td>' + escHtml(record.period || 'All dates') + '</td>' +
                    '<td>' + escHtml(record.filters || 'All visible RX records') + '</td>' +
                    '<td>' +
                        '<button class="btn btn-sm btn-outline-primary delivery-log-reprint-btn" type="button" data-record-id="' + escHtml(encodedId) + '">' +
                            '<i class="fas fa-print me-1"></i>Reprint' +
                        '</button>' +
                    '</td>' +
                '</tr>';
            }).join('');

            tbody.querySelectorAll('.delivery-log-reprint-btn').forEach(function(button) {
                button.addEventListener('click', function() {
                    var recordId = button.getAttribute('data-record-id') || '';
                    if (!recordId) return;
                    openDeliveryLogArchivePrint(recordId);
                });
            });
        } catch (_err) {
            allDeliveryLogArchives = [];
            tbody.innerHTML = '<tr><td colspan="8" class="text-center text-danger py-4">Could not load archive history.</td></tr>';
        }
    }

    function openDeliveryLogArchivePrint(recordId) {
        var win = window.open('', '_blank');
        if (!win) {
            showToast('Popup blocked. Allow popups to open the archived delivery log.', 'warning');
            return;
        }
        var reprintTimestamp = new Date();
        var reprintLabel = reprintTimestamp.toLocaleString([], {
            month: '2-digit',
            day: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
        win.document.write('<!doctype html><html><head><meta charset="UTF-8"><title>Delivery Log Archive</title></head><body>Loading...</body></html>');
        win.document.close();

        fetchWithAuth(window.rxUrl('/api/reports/delivery-log-archives/' + encodeURIComponent(recordId) + '/print'))
            .then(function(res) {
                if (!res) throw new Error('Archive API authentication failed');
                if (!res.ok) throw new Error('Archive print request failed (' + res.status + ')');
                return res.text();
            })
            .then(function(html) {
                if (!html) throw new Error('Archived log is empty');
                win.document.open();
                win.document.write(html);
                win.document.close();
                win.document.title = 'Delivery Log Archive';
                var auditStrip = win.document.querySelector('.audit-strip');
                var reprintLine;
                if (auditStrip) {
                    reprintLine = win.document.createElement('span');
                    reprintLine.textContent = 'Reprinted: ' + reprintLabel;
                    auditStrip.appendChild(reprintLine);
                } else {
                    reprintLine = win.document.createElement('div');
                    reprintLine.textContent = 'Reprinted: ' + reprintLabel;
                    win.document.body && win.document.body.appendChild(reprintLine);
                }
            })
            .catch(function(error) {
                win.close();
                showToast(error.message || 'Could not open archived delivery log.', 'danger');
            });
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
        setReportParam(params, 'dob', document.getElementById('prfDob')?.value || '');
        setReportParam(params, 'patientType', document.getElementById('prfPatientType')?.value || '');
        setReportParam(params, 'eligibility', document.getElementById('prfEligibility')?.value || '');
        setReportParam(params, 'missingInfo', document.getElementById('prfMissingInfo')?.value || '');
        setReportParam(params, 'rxStatus', document.getElementById('prfRxStatus')?.value || '');
        setReportParam(params, 'clinicId', document.getElementById('prfClinicId')?.value || '');
        setReportParam(params, 'pharmacyId', document.getElementById('prfPharmacyId')?.value || '');
        setReportParam(params, 'patientTransportId', document.getElementById('prfPatientTransportId')?.value || '');
        setReportParam(params, 'pharmacyTransportId', document.getElementById('prfPharmacyTransportId')?.value || '');
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
        setReportParam(params, 'pharmacyId', document.getElementById('rrfPharmacyId')?.value || '');
        setReportParam(params, 'clinicId', document.getElementById('rrfClinicId')?.value || '');
        setReportParam(params, 'patientType', document.getElementById('rrfPatientType')?.value || '');
        setReportParam(params, 'workflowStatus', document.getElementById('rrfProgress')?.value || '');
        setReportParam(params, 'currentWorkflowStage', document.getElementById('rrfCurrentWorkflowStage')?.value || '');
        setReportParam(params, 'workflowStage', document.getElementById('rrfWorkflowStage')?.value || '');
        setReportParam(params, 'completedStageId', document.getElementById('rrfCompletedStage')?.value || '');
        setReportParam(params, 'stageFrom', document.getElementById('rrfStageFrom')?.value || '');
        setReportParam(params, 'stageTo', document.getElementById('rrfStageTo')?.value || '');
        setReportParam(params, 'dateFrom', document.getElementById('rxDateFrom')?.value || '');
        setReportParam(params, 'dateTo', document.getElementById('rxDateTo')?.value || '');
        setReportParam(params, 'arrivalFrom', document.getElementById('rrfArrivalFrom')?.value || '');
        setReportParam(params, 'arrivalTo', document.getElementById('rrfArrivalTo')?.value || '');
        setReportParam(params, 'patientTransportId', document.getElementById('rrfPatientTransportId')?.value || '');
        setReportParam(params, 'pharmacyTransportId', document.getElementById('rrfPharmacyTransportId')?.value || '');
        setReportParam(params, 'warehouseStatus', document.getElementById('rrfWarehouseStatus')?.value || '');
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

    async function fetchPatientRxDetailRows() {
        const params = buildPatientReportParams({ exportAll: true });
        params.delete('paginated');
        params.delete('exportAll');
        params.delete('page');
        params.delete('pageSize');
        params.delete('sort');
        params.delete('dir');
        const data = await fetchReportJson('/api/reports/patient-rx-detail?' + params.toString());
        return data && Array.isArray(data.rows) ? data.rows : [];
    }

    function patientRxCompleteExportUrl() {
        const params = buildPatientReportParams({ exportAll: true });
        params.delete('paginated');
        params.delete('exportAll');
        params.delete('page');
        params.delete('pageSize');
        params.delete('sort');
        params.delete('dir');
        params.set('completeHistory', 'true');
        params.set('format', 'csv');
        const path = '/api/reports/patient-rx-detail?' + params.toString();
        return typeof window.rxUrl === 'function' ? window.rxUrl(path) : path;
    }

    function setDefaultCallCenterDates() {
        const fromEl = document.getElementById('ccrDateFrom');
        const toEl = document.getElementById('ccrDateTo');
        if (!fromEl || !toEl || fromEl.value || toEl.value) return;
        const now = new Date();
        const to = now.toISOString().slice(0, 10);
        const fromDate = new Date(now);
        fromDate.setDate(now.getDate() - 29);
        fromEl.value = fromDate.toISOString().slice(0, 10);
        toEl.value = to;
    }

    function buildCallCenterReportParams(options) {
        options = options || {};
        var params = new URLSearchParams();
        params.set('paginated', 'true');
        if (options.exportAll) {
            params.set('exportAll', 'true');
            params.set('page', '1');
            params.set('pageSize', '500');
        } else {
            params.set('page', String(ccrPage));
            params.set('pageSize', String(ccrPageSize));
        }
        params.set('sort', ccrSortCol || 'lastActionAt');
        params.set('dir', ccrSortDir || 'desc');
        setReportParam(params, 'dateFrom', document.getElementById('ccrDateFrom')?.value || '');
        setReportParam(params, 'dateTo', document.getElementById('ccrDateTo')?.value || '');
        setReportParam(params, 'userId', document.getElementById('ccrUser')?.value || '');
        setReportParam(params, 'actionType', document.getElementById('ccrActionType')?.value || '');
        setReportParam(params, 'patientCode', getVal('ccrPatientCode'));
        setReportParam(params, 'firstName', getVal('ccrFirstName'));
        setReportParam(params, 'lastName', getVal('ccrLastName'));
        setReportParam(params, 'phone', getVal('ccrPhone'));
        setReportParam(params, 'clinic', getVal('ccrClinic'));
        setReportParam(params, 'serviceDateFrom', document.getElementById('ccrServiceFrom')?.value || '');
        setReportParam(params, 'serviceDateTo', document.getElementById('ccrServiceTo')?.value || '');
        setReportParam(params, 'status', document.getElementById('ccrStatus')?.value || '');
        return params;
    }

    async function fetchCallCenterReportRows(options) {
        const data = await fetchReportJson('/api/reports/call-center?' + buildCallCenterReportParams(options || {}).toString());
        return data && Array.isArray(data.rows) ? data.rows : [];
    }

    function buildCallAttemptReportParams(options) {
        options = options || {};
        var params = new URLSearchParams();
        params.set('paginated', 'true');
        if (options.exportAll) {
            params.set('exportAll', 'true');
            params.set('page', '1');
            params.set('pageSize', '500');
        } else {
            params.set('page', String(ccaPage));
            params.set('pageSize', String(ccaPageSize));
        }
        params.set('sort', ccaSortCol || 'dialedAt');
        params.set('dir', ccaSortDir || 'desc');
        setReportParam(params, 'dateFrom', document.getElementById('ccrDateFrom')?.value || '');
        setReportParam(params, 'dateTo', document.getElementById('ccrDateTo')?.value || '');
        setReportParam(params, 'userId', document.getElementById('ccrUser')?.value || '');
        setReportParam(params, 'patientCode', getVal('ccrPatientCode'));
        setReportParam(params, 'firstName', getVal('ccrFirstName'));
        setReportParam(params, 'lastName', getVal('ccrLastName'));
        setReportParam(params, 'phone', getVal('ccrPhone'));
        setReportParam(params, 'clinic', getVal('ccrClinic'));
        setReportParam(params, 'outcome', document.getElementById('ccrAttemptOutcome')?.value || '');
        setReportParam(params, 'extension', getVal('ccrExtension'));
        return params;
    }

    async function fetchCallAttemptReportRows(options) {
        const data = await fetchReportJson('/api/reports/call-center-attempts?' + buildCallAttemptReportParams(options || {}).toString());
        return data && Array.isArray(data.rows) ? data.rows : [];
    }

    async function fetchCallCenterSupervisorSummary() {
        return fetchReportJson('/api/reports/call-center-supervisor?' + buildCallAttemptReportParams().toString());
    }

    // ─── Autocomplete Engine ─────────────────────────────────────────────────────
    function buildAutocompletes() {
        const uniq = arr => [...new Set(arr
            .filter(v => v !== null && v !== undefined && String(v).trim() !== '')
            .map(v => String(v).trim())
        )].sort((a,b) => a.localeCompare(b));

        const defs = [
            { id: 'prfFirstName', options: () => uniq(allPatientReport.map(p => p.firstName)), render: renderPatientReport },
            { id: 'prfLastName',  options: () => uniq(allPatientReport.map(p => p.lastName)), render: renderPatientReport },
            { id: 'rrfFirstName', options: () => uniq(allRxReport.map(r => r.Patient && r.Patient.firstName)), render: renderRxActionReport },
            { id: 'rrfLastName',  options: () => uniq(allRxReport.map(r => r.Patient && r.Patient.lastName)), render: renderRxActionReport }
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
                    listHtml += '<div class="ac-item" data-i18n-skip>' + escHtml(o) + '</div>';
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
    function ccrChangeSize(value) {
        ccrPageSize = parseInt(value, 10) || 10;
        ccrPage = 1;
        renderCallCenterReport();
    }
    function ccaChangeSize(value) {
        ccaPageSize = parseInt(value, 10) || 20;
        ccaPage = 1;
        renderCallAttemptReport();
    }
    window.prChangeSize = prChangeSize;
    window.rrChangeSize = rrChangeSize;
    window.ccrChangeSize = ccrChangeSize;
    window.ccaChangeSize = ccaChangeSize;
    window.renderPatientReport = renderPatientReport;
    window.renderRxActionReport = renderRxActionReport;
    window.renderCallCenterReport = renderCallCenterReport;
    window.renderCallCenterReports = renderCallCenterReports;

    function renderPatientReport() {
        validateDateRange('patientDateFrom', 'patientDateTo', 'Patient report date range');
        const tbody   = document.getElementById('patientReportBody');
        const countEl = document.getElementById('patientReportCount');
        const navEl   = document.getElementById('prPagNav');
        if (!tbody) return;
        tbody.innerHTML = '<tr><td colspan="13" class="text-center text-muted py-4"><i class="fas fa-spinner fa-spin me-2"></i>Loading...</td></tr>';

        return fetchReportJson('/api/reports/patients?' + buildPatientReportParams().toString()).then(function(result) {
        var data = result && Array.isArray(result.rows) ? result.rows : [];
        allPatientReport = data;
        if (!data.length) {
            tbody.innerHTML = '<tr><td colspan="13" class="text-center text-muted py-4">No records found</td></tr>';
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
            const patientTypeBadge = p.isNonCompanyPatient
                ? '<span class="badge bg-warning text-dark">Non-Company</span>'
                : '<span class="badge bg-info text-dark">Company</span>';
            const dob = p.dob ? new Date(p.dob+'T12:00:00').toLocaleDateString() : '-';
            const svc = p.serviceDate ? new Date(p.serviceDate+'T12:00:00').toLocaleDateString() : '-';
            patientRowsHtml += '<tr>' +
                '<td><span class="badge bg-primary">' + escHtml(p.patientCode || '') + '</span></td>' +
                '<td>' + escHtml(p.firstName || '') + '</td>' +
                '<td>' + escHtml(p.lastName || '') + '</td>' +
                '<td>' + dob + '</td>' +
                '<td>' + escHtml(p.phone || '-') + '</td>' +
                '<td>' + escHtml(p.address || '-') + '</td>' +
                '<td>' + svc + '</td>' +
                '<td>' + statusBadge + '</td>' +
                '<td>' + patientTypeBadge + '</td>' +
                '<td>' + escHtml((p.Clinic && p.Clinic.name) || '-') + '</td>' +
                '<td>' + escHtml((p.Pharmacy && p.Pharmacy.name) || '-') + '</td>' +
                '<td>' + escHtml((p.PatientTransportCompany && p.PatientTransportCompany.companyName) || '-') + '</td>' +
                '<td>' + escHtml((p.PharmacyTransportCompany && p.PharmacyTransportCompany.companyName) || '-') + '</td>' +
            '</tr>';
        });
        tbody.innerHTML = patientRowsHtml;
        if (countEl) countEl.textContent = 'Showing ' + (startIndex + 1) + '-' + endIndex + ' of ' + totalRecords;
        renderReportPager('prPagNav', prPage, totalPages, function(page) {
            prPage = page;
            renderPatientReport();
        });
        }).catch(function(err) {
            tbody.innerHTML = '<tr><td colspan="13" class="text-center text-danger py-4">Could not load patient report.</td></tr>';
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
        ['prfPatientCode','prfFirstName','prfLastName','prfPhone','prfDob','patientDateFrom','patientDateTo',
         'prfPatientType','prfEligibility','prfMissingInfo','prfRxStatus','prfClinicId','prfPharmacyId',
         'prfPatientTransportId','prfPharmacyTransportId']
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
        tbody.innerHTML = '<tr><td colspan="15" class="text-center text-muted py-4"><i class="fas fa-spinner fa-spin me-2"></i>Loading...</td></tr>';

        return fetchReportJson('/api/reports/rx-actions?' + buildRxReportParams().toString()).then(function(result) {
        var data = result && Array.isArray(result.rows) ? result.rows : [];
        allRxReport = data;
        if (!data.length) {
            tbody.innerHTML = '<tr><td colspan="15" class="text-center text-muted py-4">No records found</td></tr>';
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
            const arrival = r.arrivalDate ? new Date(r.arrivalDate+'T12:00:00').toLocaleDateString() : '-';
            const ptName  = r.Patient ? r.Patient.firstName + ' ' + r.Patient.lastName : '-';
            const ptCode  = r.Patient ? r.Patient.patientCode : '-';
            const phName  = r.Pharmacy ? r.Pharmacy.name : '-';
            const stageHistory = Array.isArray(r.stageHistory) ? r.stageHistory : [];
            const currentStage = r.currentStage || null;
            const stageHistoryHtml = stageHistory.length
                ? '<details><summary class="text-primary" style="cursor:pointer">' + stageHistory.length + ' stage' + (stageHistory.length === 1 ? '' : 's') + '</summary>' +
                    '<div class="small mt-1 text-nowrap">' +
                    stageHistory.map(function(stage) {
                        return '<div class="mb-1"><span class="fw-bold">' +
                            escHtml((stage.sequenceNumber || '?') + '. ' + (stage.stage || 'Stage')) +
                            '</span><br><span class="text-muted">' +
                            escHtml(formatCcDateTime(stage.completionDate)) + ' · ' + escHtml(stage.completedBy || 'System') +
                            '</span></div>';
                    }).join('') +
                    '</div></details>'
                : '<span class="text-muted">-</span>';
            var workflowBadge = '';
            if (pct >= 100 && wfTotal > 0) {
                workflowBadge = '<span class="badge bg-success">Completed</span>';
            } else {
                var expired = false;
                if (r.serviceDate) {
                    var expiry = new Date(r.serviceDate + 'T12:00:00');
                    expiry.setDate(expiry.getDate() + (Number(window.SERVICE_WINDOW_DAYS) || 90));
                    var today = new Date();
                    today.setHours(0, 0, 0, 0);
                    expired = expiry < today;
                }
                if (expired) workflowBadge = '<span class="badge bg-danger">Expired · ' + pct + '%</span>';
                else if (done > 0) workflowBadge = '<span class="badge bg-warning text-dark">In Progress · ' + pct + '%</span>';
                else workflowBadge = '<span class="badge bg-secondary">Not Started</span>';
            }
            rxRowsHtml += '<tr>' +
                '<td><span class="badge bg-primary">RX-' + r.id + '</span></td>' +
                '<td>' + escHtml(ptName) + '</td>' +
                '<td><span class="badge bg-info text-dark">' + escHtml(ptCode) + '</span></td>' +
                '<td>' + escHtml(phName) + '</td>' +
                '<td>' + escHtml((r.Patient && r.Patient.Clinic && r.Patient.Clinic.name) || '-') + '</td>' +
                '<td>' + arrival + '</td>' +
                '<td>' + svc + '</td>' +
                '<td>' + escHtml((r.PatientTransportCompany && r.PatientTransportCompany.companyName) || '-') + '</td>' +
                '<td>' + escHtml((r.PharmacyTransportCompany && r.PharmacyTransportCompany.companyName) || '-') + '</td>' +
                '<td>' + (r.returnedToWarehouse ? '<span class="badge bg-dark">Returned</span>' : '<span class="badge bg-light text-dark">Not Returned</span>') + '</td>' +
                '<td>' + (currentStage ? '<span class="badge bg-info text-dark">' + escHtml(currentStage.stage || '-') + '</span>' : '<span class="text-muted">Not started</span>') + '</td>' +
                '<td class="text-nowrap">' + (currentStage ? escHtml(formatCcDateTime(currentStage.completionDate)) : '-') + '</td>' +
                '<td>' + stageHistoryHtml + '</td>' +
                '<td>' + (nextStep ? '<span class="badge bg-warning text-dark">' + escHtml(nextStep.name) + '</span>' : '<span class="badge bg-success">All done</span>') + '</td>' +
                '<td>' + workflowBadge + '</td>' +
            '</tr>';
        });
        tbody.innerHTML = rxRowsHtml;
        if (countEl) countEl.textContent = 'Showing ' + (startIndex + 1) + '-' + endIndex + ' of ' + totalRecords;
        renderReportPager('rrPagNav', rrPage, totalPages, function(page) {
            rrPage = page;
            renderRxActionReport();
        });
        }).catch(function(err) {
            tbody.innerHTML = '<tr><td colspan="15" class="text-center text-danger py-4">Could not load RX action report.</td></tr>';
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
        ['rrfRxId','rrfFirstName','rrfLastName','rrfPatientCode','rxDateFrom','rxDateTo','rrfArrivalFrom','rrfArrivalTo',
         'rrfPharmacyId','rrfClinicId','rrfPatientType','rrfCurrentWorkflowStage','rrfWorkflowStage','rrfCompletedStage','rrfStageFrom','rrfStageTo',
         'rrfPatientTransportId','rrfPharmacyTransportId','rrfWarehouseStatus']
            .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
        document.getElementById('rrfProgress').value = '';
        rrPage = 1;
        renderRxActionReport();
    }

    // ─── Export CSV ───────────────────────────────────────────────────────────────
    // Call Center Report
    function formatCcDateTime(value) {
        if (!value) return '-';
        const d = new Date(value);
        if (isNaN(d.getTime())) return String(value);
        return d.toLocaleString([], { month: '2-digit', day: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit' });
    }

    function populateCallCenterUsers(users) {
        const sel = document.getElementById('ccrUser');
        if (!sel) return;
        const current = sel.value || '';
        let html = '<option value="">All Users</option>';
        (users || []).forEach(u => {
            html += '<option value="' + escHtml(u.userId) + '">' + escHtml(u.name || ('User ' + u.userId)) + '</option>';
        });
        sel.innerHTML = html;
        sel.value = current;
    }

    function ccMiniHistory(row) {
        function section(title, text, iconClass) {
            return '<div class="mb-1"><span class="fw-bold text-muted"><i class="' + iconClass + ' me-1"></i>' + title + ':</span> ' +
                '<span>' + escHtml(text || '--') + '</span></div>';
        }
        return '<div class="cc-history-mini">' +
            section('Calls', row.callHistoryText, 'fas fa-phone-alt text-info') +
            section('Dates', row.serviceDateHistoryText, 'fas fa-calendar-plus text-success') +
            section('Notes', row.noteHistoryText, 'fas fa-sticky-note text-warning') +
            '</div>';
    }

    function setCcTotals(totals) {
        totals = totals || {};
        const set = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
        set('ccrMPatients', totals.patients || 0);
        set('ccActivityTabCount', totals.patients || 0);
        set('ccrMCalls', totals.calls || 0);
        set('ccrMRepeats', totals.repeatCalls || 0);
        set('ccrMDates', totals.serviceDates || 0);
        set('ccrMNotes', totals.notes || 0);
    }

    function renderCallCenterReport() {
        validateDateRange('ccrDateFrom', 'ccrDateTo', 'Call Center activity range');
        validateDateRange('ccrServiceFrom', 'ccrServiceTo', 'Call Center service date range');
        const tbody = document.getElementById('ccReportBody');
        const countEl = document.getElementById('ccrReportCount');
        const navEl = document.getElementById('ccrPagNav');
        if (!tbody) return;
        tbody.innerHTML = '<tr><td colspan="12" class="text-center text-muted py-4"><i class="fas fa-spinner fa-spin me-2"></i>Loading...</td></tr>';

        return fetchReportJson('/api/reports/call-center?' + buildCallCenterReportParams().toString()).then(function(result) {
            const data = result && Array.isArray(result.rows) ? result.rows : [];
            allCcReport = data;
            populateCallCenterUsers(result.users || []);
            setCcTotals(result.totals || {});
            if (!data.length) {
                tbody.innerHTML = '<tr><td colspan="12" class="text-center text-muted py-4">No call center activity found</td></tr>';
                if (countEl) countEl.textContent = '0 records';
                if (navEl) navEl.innerHTML = '';
                return;
            }
            const totalRecords = Number(result.total || data.length || 0);
            const totalPages = Number(result.totalPages || Math.max(1, Math.ceil(totalRecords / ccrPageSize)));
            ccrPage = Number(result.page || ccrPage || 1);
            ccrPageSize = Number(result.pageSize || ccrPageSize || 10);
            const startIndex = (ccrPage - 1) * ccrPageSize;
            const endIndex = Math.min(startIndex + data.length, totalRecords);
            let html = '';
            data.forEach(function(row) {
                const name = ((row.firstName || '') + ' ' + (row.lastName || '')).trim() || '-';
                const attemptsButton = row.patientCode
                    ? '<button type="button" class="btn btn-outline-primary btn-sm mt-2 cc-open-attempts" data-patient-code="' + escHtml(row.patientCode) + '"><i class="fas fa-phone-volume me-1"></i>View attempts</button>'
                    : '';
                html += '<tr>' +
                    '<td><span class="badge bg-primary">' + escHtml(row.patientCode || '') + '</span></td>' +
                    '<td><div class="fw-semibold">' + escHtml(name) + '</div><small class="text-muted">' + escHtml(row.status || '') + '</small></td>' +
                    '<td>' + escHtml(row.phone || '-') + '</td>' +
                    '<td>' + escHtml(row.clinicName || '-') + '</td>' +
                    '<td>' + escHtml(row.serviceDate || '-') + '</td>' +
                    '<td>' + escHtml(row.usersText || '-') + '</td>' +
                    '<td class="text-end fw-semibold">' + (row.calls || 0) + '</td>' +
                    '<td class="text-end">' + (row.repeatCalls || 0) + '</td>' +
                    '<td class="text-end">' + (row.serviceDates || 0) + '</td>' +
                    '<td class="text-end">' + (row.notes || 0) + '</td>' +
                    '<td><div>' + escHtml(formatCcDateTime(row.lastActionAt)) + '</div><small class="text-muted">' + escHtml(row.lastActionBy || '') + '</small></td>' +
                    '<td class="cc-history-cell">' + ccMiniHistory(row) + attemptsButton + '</td>' +
                '</tr>';
            });
            tbody.innerHTML = html;
            tbody.querySelectorAll('.cc-open-attempts').forEach(function(button) {
                button.addEventListener('click', function() {
                    openPatientCallAttempts(button.getAttribute('data-patient-code') || '');
                });
            });
            if (countEl) countEl.textContent = 'Showing ' + (startIndex + 1) + '-' + endIndex + ' of ' + totalRecords;
            renderReportPager('ccrPagNav', ccrPage, totalPages, function(page) {
                ccrPage = page;
                renderCallCenterReport();
            });
        }).catch(function(err) {
            tbody.innerHTML = '<tr><td colspan="12" class="text-center text-danger py-4">Could not load Call Center report.</td></tr>';
            if (countEl) countEl.textContent = '';
            if (navEl) navEl.innerHTML = '';
            console.error('Call Center report load error:', err);
        });
    }

    function formatCcDuration(value) {
        if (value === null || value === undefined || value === '') return '-';
        var seconds = Math.max(0, Number(value) || 0);
        var hours = Math.floor(seconds / 3600);
        var minutes = Math.floor((seconds % 3600) / 60);
        var remainder = Math.floor(seconds % 60);
        if (hours) return hours + ':' + String(minutes).padStart(2, '0') + ':' + String(remainder).padStart(2, '0');
        return minutes + ':' + String(remainder).padStart(2, '0');
    }

    function callAttemptOutcome(row) {
        return row && row.outcome ? String(row.outcome) : 'in_progress';
    }

    function callAttemptOutcomeBadge(row) {
        var outcome = callAttemptOutcome(row);
        var labels = {
            answered: 'Answered', no_answer: 'No Answer', busy: 'Busy', rejected: 'Rejected',
            unavailable: 'Unavailable', cancelled: 'Cancelled', failed: 'Failed', in_progress: 'In Progress'
        };
        var classes = {
            answered: 'bg-success', no_answer: 'bg-secondary', busy: 'bg-warning text-dark',
            rejected: 'bg-danger', unavailable: 'bg-dark', cancelled: 'bg-secondary',
            failed: 'bg-danger', in_progress: 'bg-info text-dark'
        };
        return '<span class="badge ' + (classes[outcome] || 'bg-secondary') + '">' + escHtml(labels[outcome] || outcome) + '</span>';
    }

    function setCallAttemptTotals(totals) {
        totals = totals || {};
        var set = function(id, value) { var el = document.getElementById(id); if (el) el.textContent = value; };
        set('ccaMAttempts', totals.attempts || 0);
        set('ccAttemptsTabCount', totals.attempts || 0);
        set('ccaMAnswered', totals.answered || 0);
        set('ccaMUnanswered', totals.unanswered || 0);
        set('ccaMAnswerRate', (totals.answerRate || 0) + '%');
        set('ccaMAvgRing', formatCcDuration(Number(totals.averageRingSeconds) || 0));
        set('ccaMAvgTalk', formatCcDuration(Number(totals.averageConversationSeconds) || 0));
    }

    function renderCallAttemptReport() {
        validateDateRange('ccrDateFrom', 'ccrDateTo', 'Call attempt date range');
        var tbody = document.getElementById('ccAttemptReportBody');
        var countEl = document.getElementById('ccaReportCount');
        var navEl = document.getElementById('ccaPagNav');
        if (!tbody) return Promise.resolve();
        tbody.innerHTML = '<tr><td colspan="11" class="text-center text-muted py-4"><i class="fas fa-spinner fa-spin me-2"></i>Loading...</td></tr>';

        return fetchReportJson('/api/reports/call-center-attempts?' + buildCallAttemptReportParams().toString()).then(function(result) {
            var data = result && Array.isArray(result.rows) ? result.rows : [];
            allCcAttempts = data;
            setCallAttemptTotals(result.totals || {});
            if (!data.length) {
                tbody.innerHTML = '<tr><td colspan="11" class="text-center text-muted py-4">No automatic call attempts found</td></tr>';
                if (countEl) countEl.textContent = '0 records';
                if (navEl) navEl.innerHTML = '';
                return;
            }
            var totalRecords = Number(result.total || data.length || 0);
            var totalPages = Number(result.totalPages || Math.max(1, Math.ceil(totalRecords / ccaPageSize)));
            ccaPage = Number(result.page || ccaPage || 1);
            ccaPageSize = Number(result.pageSize || ccaPageSize || 20);
            var startIndex = (ccaPage - 1) * ccaPageSize;
            var endIndex = Math.min(startIndex + data.length, totalRecords);
            var html = '';
            data.forEach(function(row) {
                var patientLabel = row.patientName || 'Deleted patient';
                var patientCode = row.patientCode || '';
                var patientReference = patientCode
                    ? '<button type="button" class="btn btn-link btn-sm p-0 text-decoration-none cc-open-activity" data-patient-code="' + escHtml(patientCode) + '">' + escHtml(patientCode) + '</button>'
                    : '<span class="text-muted">Historical record</span>';
                var sip = row.sipResponseCode ? String(row.sipResponseCode) : '';
                if (row.sipReason) sip += (sip ? ' — ' : '') + row.sipReason;
                html += '<tr>' +
                    '<td><div class="fw-semibold">' + escHtml(patientLabel) + '</div><small>' + patientReference + (row.clinicName ? '<span class="text-muted"> · ' + escHtml(row.clinicName) + '</span>' : '') + '</small></td>' +
                    '<td><div>' + escHtml(row.agentName || '-') + '</div><small class="text-muted">Ext. ' + escHtml(row.extension || '-') + '</small></td>' +
                    '<td><div class="fw-semibold">' + escHtml(row.dialedNumber || '-') + '</div><small class="text-muted">' + escHtml(row.phoneClient || '') + '</small></td>' +
                    '<td>' + callAttemptOutcomeBadge(row) + '</td>' +
                    '<td>' + escHtml(sip || '-') + '</td>' +
                    '<td>' + escHtml(formatCcDateTime(row.dialedAt)) + '</td>' +
                    '<td>' + escHtml(formatCcDateTime(row.ringingAt)) + '</td>' +
                    '<td>' + escHtml(formatCcDateTime(row.answeredAt)) + '</td>' +
                    '<td>' + escHtml(formatCcDateTime(row.endedAt)) + '</td>' +
                    '<td>' + escHtml(formatCcDuration(row.ringDurationSeconds)) + '</td>' +
                    '<td>' + escHtml(formatCcDuration(row.conversationDurationSeconds)) + '</td>' +
                '</tr>';
            });
            tbody.innerHTML = html;
            tbody.querySelectorAll('.cc-open-activity').forEach(function(button) {
                button.addEventListener('click', function() {
                    openPatientActivity(button.getAttribute('data-patient-code') || '');
                });
            });
            if (countEl) countEl.textContent = 'Showing ' + (startIndex + 1) + '-' + endIndex + ' of ' + totalRecords;
            renderReportPager('ccaPagNav', ccaPage, totalPages, function(page) {
                ccaPage = page;
                renderCallAttemptReport();
            });
        }).catch(function(err) {
            tbody.innerHTML = '<tr><td colspan="11" class="text-center text-danger py-4">Could not load automatic call attempts.</td></tr>';
            if (countEl) countEl.textContent = '';
            if (navEl) navEl.innerHTML = '';
            console.error('Call attempt report load error:', err);
        });
    }

    function setCallCenterSupervisorTotals(totals) {
        totals = totals || {};
        var set = function(id, value) {
            var el = document.getElementById(id);
            if (el) el.textContent = value;
        };
        set('ccsMCalls', totals.attempts || 0);
        set('ccsMAnswered', totals.answered || 0);
        set('ccsMNoAnswer', totals.noAnswer || 0);
        set('ccsMAnswerRate', (totals.answerRate || 0) + '%');
        set('ccsMNoAnswerRate', (totals.noAnswerRate || 0) + '%');
        set('ccsMTotalTalk', formatCcDuration(totals.totalTalkSeconds || 0));
        set('ccsMAvgTalk', formatCcDuration(totals.averageTalkSeconds || 0));
    }

    function supervisorSummaryRowsHtml(rows, firstColumn, detailed) {
        if (!rows || !rows.length) {
            return '<tr><td colspan="' + (detailed ? '9' : '6') + '" class="text-center text-muted py-3">No completed call data found</td></tr>';
        }
        var html = '';
        rows.forEach(function(row) {
            var label = row.label || row.key || '-';
            if (firstColumn === 'Date' && /^\d{4}-\d{2}-\d{2}$/.test(label)) {
                label = new Date(label + 'T12:00:00').toLocaleDateString();
            }
            if (detailed) {
                html += '<tr>' +
                    '<td class="fw-semibold">' + escHtml(label) + '</td>' +
                    '<td class="text-end">' + Number(row.attempts || 0) + '</td>' +
                    '<td class="text-end text-success">' + Number(row.answered || 0) + '</td>' +
                    '<td class="text-end">' + Number(row.noAnswer || 0) + '</td>' +
                    '<td class="text-end">' + Number(row.otherOutcomes || 0) + '</td>' +
                    '<td class="text-end">' + Number(row.answerRate || 0) + '%</td>' +
                    '<td class="text-end">' + Number(row.noAnswerRate || 0) + '%</td>' +
                    '<td class="text-end">' + escHtml(formatCcDuration(row.totalTalkSeconds || 0)) + '</td>' +
                    '<td class="text-end">' + escHtml(formatCcDuration(row.averageTalkSeconds || 0)) + '</td>' +
                '</tr>';
            } else {
                html += '<tr>' +
                    '<td class="fw-semibold">' + escHtml(label) + '</td>' +
                    '<td class="text-end">' + Number(row.attempts || 0) + '</td>' +
                    '<td class="text-end text-success">' + Number(row.answered || 0) + '</td>' +
                    '<td class="text-end">' + Number(row.noAnswer || 0) + '</td>' +
                    '<td class="text-end">' + Number(row.answerRate || 0) + '%</td>' +
                    '<td class="text-end">' + escHtml(formatCcDuration(row.totalTalkSeconds || 0)) + '</td>' +
                '</tr>';
            }
        });
        return html;
    }

    function renderCallCenterSupervisorSummary() {
        validateDateRange('ccrDateFrom', 'ccrDateTo', 'Call Center supervisor date range');
        var agentBody = document.getElementById('ccSupervisorAgentBody');
        var clinicBody = document.getElementById('ccSupervisorClinicBody');
        var dateBody = document.getElementById('ccSupervisorDateBody');
        if (!agentBody || !clinicBody || !dateBody) return Promise.resolve();
        agentBody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-3"><i class="fas fa-spinner fa-spin me-2"></i>Loading...</td></tr>';
        clinicBody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-3"><i class="fas fa-spinner fa-spin me-2"></i>Loading...</td></tr>';
        dateBody.innerHTML = '<tr><td colspan="9" class="text-center text-muted py-3"><i class="fas fa-spinner fa-spin me-2"></i>Loading...</td></tr>';

        return fetchCallCenterSupervisorSummary().then(function(result) {
            allCcSupervisor = result || null;
            setCallCenterSupervisorTotals(result && result.totals);
            agentBody.innerHTML = supervisorSummaryRowsHtml(result && result.byAgent, 'Agent', false);
            clinicBody.innerHTML = supervisorSummaryRowsHtml(result && result.byClinic, 'Clinic', false);
            dateBody.innerHTML = supervisorSummaryRowsHtml(result && result.byDate, 'Date', true);
        }).catch(function(err) {
            allCcSupervisor = null;
            agentBody.innerHTML = '<tr><td colspan="6" class="text-center text-danger py-3">Could not load agent summary.</td></tr>';
            clinicBody.innerHTML = '<tr><td colspan="6" class="text-center text-danger py-3">Could not load clinic summary.</td></tr>';
            dateBody.innerHTML = '<tr><td colspan="9" class="text-center text-danger py-3">Could not load daily summary.</td></tr>';
            console.error('Call Center supervisor summary load error:', err);
        });
    }

    function renderCallCenterReports() {
        return Promise.all([renderCallCenterReport(), renderCallAttemptReport(), renderCallCenterSupervisorSummary()]);
    }

    function showCallCenterReportView(triggerId) {
        var trigger = document.getElementById(triggerId);
        if (!trigger) return;
        if (window.bootstrap && bootstrap.Tab) {
            bootstrap.Tab.getOrCreateInstance(trigger).show();
            return;
        }
        trigger.click();
    }

    function openPatientCallAttempts(patientCode) {
        var input = document.getElementById('ccrPatientCode');
        if (input) input.value = patientCode;
        ccaPage = 1;
        showCallCenterReportView('ccAttemptsViewTab');
        renderCallAttemptReport();
    }

    function openPatientActivity(patientCode) {
        var input = document.getElementById('ccrPatientCode');
        if (input) input.value = patientCode;
        ccrPage = 1;
        showCallCenterReportView('ccActivityViewTab');
        renderCallCenterReport();
    }

    function sortCallCenterReport(col) {
        if (ccrSortCol === col) ccrSortDir = ccrSortDir === 'asc' ? 'desc' : 'asc';
        else {
            ccrSortCol = col;
            ccrSortDir = ['calls','repeatCalls','serviceDates','notes','lastActionAt','serviceDate'].includes(col) ? 'desc' : 'asc';
        }
        ccrPage = 1;
        document.querySelectorAll('[id^="ccrIcon_"]').forEach(el => { el.className = 'fas fa-sort text-muted'; el.style.opacity = '0.3'; });
        const icon = document.getElementById('ccrIcon_' + col);
        if (icon) { icon.className = 'fas fa-sort-' + (ccrSortDir === 'asc' ? 'up' : 'down') + ' text-primary'; icon.style.opacity = '1'; }
        renderCallCenterReport();
    }

    function clearCallCenterFilters() {
        ['ccrDateFrom','ccrDateTo','ccrPatientCode','ccrFirstName','ccrLastName','ccrPhone','ccrClinic','ccrServiceFrom','ccrServiceTo','ccrExtension']
            .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
        ['ccrUser','ccrActionType','ccrStatus','ccrAttemptOutcome'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
        setDefaultCallCenterDates();
        ccrPage = 1;
        ccaPage = 1;
        renderCallCenterReports();
    }

    window.sortCallCenterReport = sortCallCenterReport;
    window.clearCallCenterFilters = clearCallCenterFilters;
    window.openPatientCallAttempts = openPatientCallAttempts;
    window.openPatientActivity = openPatientActivity;

    function callCenterHeaders() {
        return [
            'Patient ID', 'First Name', 'Last Name', 'Phone', 'Clinic', 'Current Service Date', 'Status',
            'Call Center Users', 'Calls', 'Repeat Calls', 'Service Dates Entered', 'Notes',
            'First Activity', 'Last Activity', 'Last Activity By',
            'Call History', 'Service Date History', 'Call Center Notes'
        ];
    }

    function callCenterExportRows(data) {
        return (data || []).map(row => [
            row.patientCode || '',
            row.firstName || '',
            row.lastName || '',
            row.phone || '',
            row.clinicName || '',
            row.serviceDate || '',
            row.status || '',
            row.usersText || '',
            row.calls || 0,
            row.repeatCalls || 0,
            row.serviceDates || 0,
            row.notes || 0,
            formatCcDateTime(row.firstActionAt),
            formatCcDateTime(row.lastActionAt),
            row.lastActionBy || '',
            row.callHistoryText || '',
            row.serviceDateHistoryText || '',
            row.noteHistoryText || ''
        ]);
    }

    function callAttemptHeaders() {
        return [
            'Patient ID', 'Patient', 'Clinic / Location', 'Agent', 'Extension', 'Dialed Number', 'Phone Client',
            'Outcome', 'SIP Response Code', 'SIP Reason', 'Dialed At', 'Ringing At', 'Answered At', 'Ended At',
            'Ring Duration', 'Ring Duration Seconds', 'Conversation Duration', 'Conversation Duration Seconds'
        ];
    }

    function callAttemptExportRows(data) {
        return (data || []).map(function(row) {
            return [
                row.patientCode || '', row.patientName || 'Deleted patient', row.clinicName || '',
                row.agentName || '', row.extension || '', row.dialedNumber || '', row.phoneClient || '',
                callAttemptOutcome(row), row.sipResponseCode || '', row.sipReason || '',
                formatCcDateTime(row.dialedAt), formatCcDateTime(row.ringingAt), formatCcDateTime(row.answeredAt), formatCcDateTime(row.endedAt),
                formatCcDuration(row.ringDurationSeconds), row.ringDurationSeconds == null ? '' : row.ringDurationSeconds,
                formatCcDuration(row.conversationDurationSeconds), row.conversationDurationSeconds == null ? '' : row.conversationDurationSeconds
            ];
        });
    }

    function patientReportHeaders() {
        return [
            'Patient ID','First Name','Last Name','DOB','Phone','Address','Service Date','Status','Patient Type',
            'Clinic','Default Pharmacy','Patient Transport','Pharmacy Transport'
        ];
    }

    function patientReportExportRows(data) {
        return (data || []).map(function(p) {
            return [
                p.patientCode || '', p.firstName || '', p.lastName || '', p.dob || '', p.phone || '', p.address || '',
                p.serviceDate || '', p.isActive ? 'Active' : 'Inactive',
                p.isNonCompanyPatient ? 'Non-Company' : 'Company',
                (p.Clinic && p.Clinic.name) || '',
                (p.Pharmacy && p.Pharmacy.name) || '',
                (p.PatientTransportCompany && p.PatientTransportCompany.companyName) || '',
                (p.PharmacyTransportCompany && p.PharmacyTransportCompany.companyName) || ''
            ];
        });
    }

    function exportDateTime(value) {
        if (!value) return '';
        const parsed = new Date(value);
        return isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
    }

    function orderedWorkflowActions() {
        return (allWorkflowActions || []).slice().sort(function(a, b) {
            return Number(a.sequenceNumber || 0) - Number(b.sequenceNumber || 0)
                || Number(a.id || 0) - Number(b.id || 0);
        });
    }

    function workflowStepHeaders() {
        return orderedWorkflowActions().flatMap(function(action) {
            const prefix = 'Workflow ' + (action.sequenceNumber || action.id) + ' - ' + (action.name || ('Stage ' + action.id));
            return [prefix + ' Status', prefix + ' Date', prefix + ' Completed By'];
        });
    }

    function workflowStepValues(hasRx, completedRows) {
        const completedByAction = new Map();
        (Array.isArray(completedRows) ? completedRows : []).forEach(function(stage) {
            const actionId = Number(stage.workflowActionId || stage.actionId || stage.id);
            if (!Number.isFinite(actionId) || completedByAction.has(actionId)) return;
            completedByAction.set(actionId, stage);
        });
        return orderedWorkflowActions().flatMap(function(action) {
            if (!hasRx) return ['', '', ''];
            const completed = completedByAction.get(Number(action.id));
            return completed
                ? ['Completed', exportDateTime(completed.completionDate), completed.completedBy || 'System']
                : ['Pending', '', ''];
        });
    }

    function patientRxDetailHeaders() {
        return [
            'Patient Database ID','Patient ID','First Name','Last Name','DOB','Phone','Address','Patient Service Date',
            'Patient Status','Patient Type','Patient Profile Notes','Patient Created At','Patient Updated At',
            'Clinic Database ID','Clinic','Clinic Address','Clinic Phone',
            'Default Pharmacy Database ID','Default Pharmacy','Default Pharmacy Address','Default Pharmacy Phone',
            'Default Patient Transport Database ID','Default Patient Transport','Default Patient Transport Phone',
            'Default Pharmacy Transport Database ID','Default Pharmacy Transport','Default Pharmacy Transport Phone',
            'Patient RX Row','Patient RX Count','RX Database ID','RX #','Patient Service Date Cycle ID','RX Arrival Date','RX Service Date',
            'RX Pharmacy Database ID','RX Pharmacy','RX Pharmacy Address','RX Pharmacy Phone',
            'RX Patient Transport Database ID','RX Patient Transport','RX Patient Transport Phone',
            'RX Pharmacy Transport Database ID','RX Pharmacy Transport','RX Pharmacy Transport Phone',
            'Returned to Warehouse','Warehouse Return Date','Warehouse Return Note','RX Created At','RX Updated At','Medications',
            'Completed Workflow Steps','Total Workflow Steps','Current Stage','Current Stage Date','Current Stage Completed By',
            'Next Action Required','Workflow Status',
            ...workflowStepHeaders(),
            'Patient Note History','Patient Service Date History'
        ];
    }

    function patientRxDetailExportRows(data) {
        return (data || []).map(function(row) {
            const hasRx = row.rxId !== null && row.rxId !== undefined;
            const completed = Number(row.completedSteps || 0);
            const total = Number(row.totalWorkflowSteps || 0);
            const workflowStatus = !hasRx ? '' : (total > 0 && completed >= total
                ? 'Completed'
                : (completed > 0 ? 'In Progress' : 'Not Started'));
            return [
                row.patientDatabaseId || '', row.patientCode || '', row.firstName || '', row.lastName || '', row.dob || '',
                row.phone || '', row.address || '', row.patientServiceDate || '',
                row.patientIsActive ? 'Active' : 'Inactive',
                row.isNonCompanyPatient ? 'Non-Company' : 'Company',
                row.patientNotes || '', exportDateTime(row.patientCreatedAt), exportDateTime(row.patientUpdatedAt),
                row.clinicId || '', row.clinicName || '', row.clinicAddress || '', row.clinicPhone || '',
                row.defaultPharmacyId || '', row.defaultPharmacyName || '', row.defaultPharmacyAddress || '', row.defaultPharmacyPhone || '',
                row.defaultPatientTransportId || '', row.defaultPatientTransport || '', row.defaultPatientTransportPhone || '',
                row.defaultPharmacyTransportId || '', row.defaultPharmacyTransport || '', row.defaultPharmacyTransportPhone || '',
                hasRx ? row.patientRxRow || '' : '', row.patientRxCount || 0, hasRx ? row.rxId : '',
                hasRx ? 'RX-' + row.rxId : '', hasRx ? row.patientServiceDateCycleId || '' : '',
                row.rxArrivalDate || '', row.rxServiceDate || '', row.rxPharmacyId || '', row.rxPharmacyName || '',
                row.rxPharmacyAddress || '', row.rxPharmacyPhone || '',
                row.rxPatientTransportId || '', row.rxPatientTransport || '', row.rxPatientTransportPhone || '',
                row.rxPharmacyTransportId || '', row.rxPharmacyTransport || '', row.rxPharmacyTransportPhone || '',
                hasRx ? (row.returnedToWarehouse ? 'Yes' : 'No') : '',
                exportDateTime(row.warehouseReturnDate), row.warehouseReturnNote || '',
                exportDateTime(row.rxCreatedAt), exportDateTime(row.rxUpdatedAt), row.medications || '',
                hasRx ? completed : '', hasRx ? total : '', row.currentStage || '',
                exportDateTime(row.currentStageDate), row.currentStageCompletedBy || '',
                row.nextPendingStage || '', workflowStatus,
                ...workflowStepValues(hasRx, row.workflowStageDetails),
                row.patientNoteHistory || '', row.serviceDateHistory || ''
            ];
        });
    }

    function rxWorkflowLabelForExport(r) {
        const steps = r.completedSteps || [];
        const total = allWorkflowActions.length;
        if (total > 0 && steps.length >= total) return 'Completed';
        if (r.serviceDate) {
            const expiry = new Date(r.serviceDate + 'T12:00:00');
            expiry.setDate(expiry.getDate() + (Number(window.SERVICE_WINDOW_DAYS) || 90));
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            if (expiry < today) return 'Expired';
        }
        return steps.length ? 'In Progress' : 'Not Started';
    }

    function rxReportHeaders() {
        return [
            'RX #','Patient','Patient ID','Patient Type','Clinic','Pharmacy','Arrival Date','Service Date',
            'Patient Transport','Pharmacy Transport','Warehouse Status','Warehouse Return Date','Warehouse Return Note',
            'Completed Steps','Current Stage','Current Stage Date','Current Stage Completed By',
            ...workflowStepHeaders(),
            'Next Action Required','Workflow Status','Progress %'
        ];
    }

    function rxReportExportRows(data) {
        return (data || []).map(function(r) {
            const steps = r.completedSteps || [];
            const pct = allWorkflowActions.length ? Math.round(steps.length / allWorkflowActions.length * 100) : 0;
            const nextStep = allWorkflowActions.find(w => !steps.includes(w.id));
            const currentStage = r.currentStage || {};
            return [
                'RX-' + r.id,
                r.Patient ? `${r.Patient.firstName || ''} ${r.Patient.lastName || ''}`.trim() : '',
                r.Patient ? r.Patient.patientCode || '' : '',
                r.Patient && r.Patient.isNonCompanyPatient ? 'Non-Company' : 'Company',
                r.Patient && r.Patient.Clinic ? r.Patient.Clinic.name || '' : '',
                r.Pharmacy ? r.Pharmacy.name || '' : '',
                r.arrivalDate || '',
                r.serviceDate || '',
                r.PatientTransportCompany ? r.PatientTransportCompany.companyName || '' : '',
                r.PharmacyTransportCompany ? r.PharmacyTransportCompany.companyName || '' : '',
                r.returnedToWarehouse ? 'Returned to Warehouse' : 'Not Returned',
                r.warehouseReturnDate || '',
                r.warehouseReturnNote || '',
                steps.length,
                currentStage.stage || '',
                exportDateTime(currentStage.completionDate),
                currentStage.completedBy || '',
                ...workflowStepValues(true, r.stageHistory),
                nextStep ? nextStep.name : '',
                rxWorkflowLabelForExport(r),
                pct + '%'
            ];
        });
    }

    function setupReportExports() {
        document.getElementById('exportPatientCsv').addEventListener('click', async () => {
            const data = await fetchPatientReportRows({ exportAll: true });
            if (!data.length) { showToast('No data to export', 'warning'); return; }
            downloadCsv('patient_report.csv', patientReportHeaders(), patientReportExportRows(data));
            showToast('Patient report exported!', 'success');
        });

        const patientRxCsv = document.getElementById('exportPatientRxDetailCsv');
        if (patientRxCsv) patientRxCsv.addEventListener('click', () => {
            const link = document.createElement('a');
            link.href = patientRxCompleteExportUrl();
            link.download = 'patient_rx_complete_history_' + new Date().toISOString().slice(0,10) + '.csv';
            link.style.display = 'none';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            showToast('Complete Patient + RX history CSV download started.', 'success');
        });

        document.getElementById('exportRxCsv').addEventListener('click', async () => {
            const data = await fetchRxReportRows({ exportAll: true });
            if (!data.length) { showToast('No data to export', 'warning'); return; }
            downloadCsv('rx_report.csv', rxReportHeaders(), rxReportExportRows(data));
            showToast('RX report exported!', 'success');
        });

        const ccCsv = document.getElementById('exportCcCsv');
        if (ccCsv) ccCsv.addEventListener('click', async () => {
            const data = await fetchCallCenterReportRows({ exportAll: true });
            if (!data.length) { showToast('No Call Center data to export', 'warning'); return; }
            downloadCsv('call_center_report_' + new Date().toISOString().slice(0,10) + '.csv', callCenterHeaders(), callCenterExportRows(data));
            showToast('Call Center report exported!', 'success');
        });

        const attemptsCsv = document.getElementById('exportCcAttemptsCsv');
        if (attemptsCsv) attemptsCsv.addEventListener('click', async () => {
            const data = await fetchCallAttemptReportRows({ exportAll: true });
            if (!data.length) { showToast('No call attempts to export', 'warning'); return; }
            downloadCsv('call_attempts_' + new Date().toISOString().slice(0,10) + '.csv', callAttemptHeaders(), callAttemptExportRows(data));
            showToast('Call attempts exported!', 'success');
        });

        const supervisorCsv = document.getElementById('exportCcSupervisorCsv');
        if (supervisorCsv) supervisorCsv.addEventListener('click', async () => {
            const summary = allCcSupervisor || await fetchCallCenterSupervisorSummary();
            const rows = callCenterSupervisorExportRows(summary);
            if (!rows.length) { showToast('No supervisor call summary to export', 'warning'); return; }
            downloadCsv(
                'call_center_supervisor_' + new Date().toISOString().slice(0,10) + '.csv',
                ['Group Type','Group','Calls','Completed','Answered','No Answer','Other Outcomes','In Progress','Answer Rate','No-Answer Rate','Total Talk','Total Talk Seconds','Average Talk','Average Talk Seconds'],
                rows
            );
            showToast('Supervisor call summary exported!', 'success');
        });
    }

    function downloadCsv(filename, headers, rows) {
        const invalidRow = (rows || []).findIndex(row => !Array.isArray(row) || row.length !== headers.length);
        if (invalidRow >= 0) {
            throw new Error(`CSV row ${invalidRow + 1} has an invalid column count.`);
        }
        const csv = [headers, ...rows].map(r => r.map(v => {
            let cell = String(v === undefined || v === null ? '' : v);
            if (/^[=+\-@]/.test(cell)) cell = "'" + cell;
            return '"' + cell.replace(/"/g,'""') + '"';
        }).join(',')).join('\n');
        const blob = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' });
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
            downloadXls(
                'patient_report_' + new Date().toISOString().slice(0,10) + '.xls',
                patientReportHeaders(),
                patientReportExportRows(data)
            );
            showToast('Patient report exported as Excel!', 'success');
        });
        var patientRxXls = document.getElementById('exportPatientRxDetailXls');
        if (patientRxXls) patientRxXls.addEventListener('click', async function() {
            var data = await fetchPatientRxDetailRows();
            if (!data.length) { showToast('No Patient + RX data to export', 'warning'); return; }
            downloadXls(
                'patient_rx_full_export_' + new Date().toISOString().slice(0,10) + '.xls',
                patientRxDetailHeaders(),
                patientRxDetailExportRows(data)
            );
            showToast('Full Patient + RX transfer export created as Excel.', 'success');
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
            downloadXls(
                'rx_report_' + new Date().toISOString().slice(0,10) + '.xls',
                rxReportHeaders(),
                rxReportExportRows(data)
            );
            showToast('RX report exported as Excel!', 'success');
        });
        var rxPdf   = document.getElementById('exportRxPdf');
        if (rxPdf)   rxPdf.addEventListener('click',   function() { printReport('RX Records Report', 'rxReportTable'); });
        var rxPrint = document.getElementById('printRxBtn');
        if (rxPrint) rxPrint.addEventListener('click', function() { printReport('RX Records Report', 'rxReportTable'); });

        // Call Center tab
        var ccXls = document.getElementById('exportCcXls');
        if (ccXls) ccXls.addEventListener('click', async function() {
            var data = await fetchCallCenterReportRows({ exportAll: true });
            if (!data.length) { showToast('No Call Center data to export', 'warning'); return; }
            downloadXls('call_center_report_' + new Date().toISOString().slice(0,10) + '.xls', callCenterHeaders(), callCenterExportRows(data));
            showToast('Call Center report exported as Excel!', 'success');
        });
        var ccPrint = document.getElementById('printCcBtn');
        if (ccPrint) ccPrint.addEventListener('click', function() { printReport('Call Center Report', 'ccReportTable'); });
        var attemptsXls = document.getElementById('exportCcAttemptsXls');
        if (attemptsXls) attemptsXls.addEventListener('click', async function() {
            var data = await fetchCallAttemptReportRows({ exportAll: true });
            if (!data.length) { showToast('No call attempts to export', 'warning'); return; }
            downloadXls('call_attempts_' + new Date().toISOString().slice(0,10) + '.xls', callAttemptHeaders(), callAttemptExportRows(data));
            showToast('Call attempts exported as Excel!', 'success');
        });
        var attemptsPrint = document.getElementById('printCcAttemptsBtn');
        if (attemptsPrint) attemptsPrint.addEventListener('click', function() { printReport('Automatic Call Attempts', 'ccAttemptReportTable'); });
        var supervisorPrint = document.getElementById('printCcSupervisorBtn');
        if (supervisorPrint) supervisorPrint.addEventListener('click', function() { printReport('Call Center Supervisor Summary', 'ccSupervisorPrintable'); });

        var refreshArchive = document.getElementById('refreshDeliveryLogArchiveBtn');
        if (refreshArchive) {
            refreshArchive.addEventListener('click', function() {
                renderDeliveryLogArchiveRecords();
            });
        }
    });

    function callCenterSupervisorExportRows(summary) {
        summary = summary || {};
        var rows = [];
        [
            ['Agent', summary.byAgent || []],
            ['Clinic', summary.byClinic || []],
            ['Date', summary.byDate || []]
        ].forEach(function(group) {
            group[1].forEach(function(row) {
                rows.push([
                    group[0],
                    row.label || row.key || '',
                    row.attempts || 0,
                    row.completed || 0,
                    row.answered || 0,
                    row.noAnswer || 0,
                    row.otherOutcomes || 0,
                    row.inProgress || 0,
                    (row.answerRate || 0) + '%',
                    (row.noAnswerRate || 0) + '%',
                    formatCcDuration(row.totalTalkSeconds || 0),
                    row.totalTalkSeconds || 0,
                    formatCcDuration(row.averageTalkSeconds || 0),
                    row.averageTalkSeconds || 0
                ]);
            });
        });
        return rows;
    }

