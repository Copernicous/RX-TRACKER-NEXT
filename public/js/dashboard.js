// dashboard.js — Dashboard logic extracted from inline script to avoid FortiGate
// proxy corruption. FortiGate wraps URL strings in inline <script> blocks with
// REWRITE() function calls that break JS syntax. External files use simpler
// string substitution. All API URLs come from hidden <a href> anchors in the HTML.

// Read API URLs via href anchors — FortiGate always rewrites href on <a> elements
var _api = (function() {
    function _h(id) { var el = document.getElementById(id); return el ? el.href : ''; }
    return {
        stats:  _h('xa-stats'),
        charts: _h('xa-charts'),
        rxp:    _h('xa-rxp'),
        drill:  _h('xa-drill'),
        ap:     _h('xa-ap'),
        ip:     _h('xa-ip'),
        tr:     _h('xa-tr'),
        pr:     _h('xa-pr'),
        nr:     _h('xa-nr'),
        s2fa:   _h('xa-s2fa'),
        u2fa:   _h('xa-u2fa'),
        e2fa:   _h('xa-e2fa'),
        d2fa:   _h('xa-d2fa')
    };
})();

var drilldownModal = null, drilldownCurrentData = [], drilldownType = '';
var _dashFrom = '', _dashTo = '';

function getPresetRange(preset) {
    const now = new Date(), fmt = d => d.toISOString().slice(0,10), today = fmt(now);
    if (preset === 'all')   return { from: '', to: '' };
    if (preset === 'today') return { from: today, to: today };
    if (preset === 'week')  { const s = new Date(now); s.setDate(now.getDate() - now.getDay()); return { from: fmt(s), to: today }; }
    if (preset === 'month') return { from: fmt(new Date(now.getFullYear(), now.getMonth(), 1)), to: today };
    if (preset === '30d')   { const s = new Date(now); s.setDate(now.getDate() - 30); return { from: fmt(s), to: today }; }
    if (preset === 'year')  return { from: fmt(new Date(now.getFullYear(), 0, 1)), to: today };
    return { from: '', to: '' };
}

function setPreset(preset) {
    const { from, to } = getPresetRange(preset);
    _dashFrom = from; _dashTo = to;
    document.getElementById('dashFrom').value = from;
    document.getElementById('dashTo').value   = to;
    document.querySelectorAll('.dash-preset').forEach(b => {
        const a = b.dataset.preset === preset;
        b.style.background  = a ? 'rgba(74,144,226,.18)' : '';
        b.style.borderColor = a ? '#4a90e2' : '';
        b.style.color       = a ? '#4a90e2' : '';
        b.style.fontWeight  = a ? '600' : '';
    });
    const labels = { all:'Showing all time', today:'Showing today', week:'Showing this week', month:'Showing this month', '30d':'Showing last 30 days', year:'Showing this year' };
    const lbl = document.getElementById('dashRangeLabel');
    if (lbl) lbl.textContent = labels[preset] || 'Custom range';
    refreshDashboard();
}

function buildDateQuery() {
    const parts = [];
    if (_dashFrom) parts.push('from=' + _dashFrom);
    if (_dashTo)   parts.push('to='   + _dashTo);
    return parts.length ? '?' + parts.join('&') : '';
}

async function refreshDashboard() {
    const q = buildDateQuery();
    try {
        const res = await fetchWithAuth(_api.stats + q);
        if (!res) return;
        const data = await res.json();
        document.getElementById('activePatientsCount').textContent    = data.activePatients         ?? 0;
        document.getElementById('inactivePatientsCount').textContent  = data.inactivePatients       ?? 0;
        document.getElementById('activeRxCount').textContent          = data.activeRxCount          ?? 0;
        document.getElementById('patientsWithNoRxCount').textContent  = data.patientsWithNoRx       ?? 0;
        document.getElementById('pendingDeliveriesCount').textContent = data.pendingDeliveriesCount ?? 0;
        if (window._auditLogAllowed) {
            const tbody = document.getElementById('recentActivityBody');
            if (tbody) {
                var _acts = (data.recentActivity && data.recentActivity.length > 0) ? data.recentActivity : [];
                var _actHtml = '';
                if (_acts.length > 0) {
                    for (var _acti = 0; _acti < _acts.length; _acti++) {
                        var a = _acts[_acti];
                        _actHtml += '<tr><td>' + (a.User ? a.User.firstName+' '+a.User.lastName : 'System') + '</td>' +
                               '<td>' + (a.module||'') + '</td>' +
                               '<td><span class="badge bg-secondary">' + (a.action||'') + '</span></td>' +
                               '<td>' + (a.date||'&mdash;') + '</td>' +
                               '<td>' + (a.ipAddress||'&mdash;') + '</td></tr>';
                    }
                } else {
                    _actHtml = '<tr><td colspan="5" class="text-center text-muted">No recent activity</td></tr>';
                }
                tbody.innerHTML = _actHtml;
            }
        }
    } catch(e) { console.warn('Stats refresh error:', e); }
    loadRxPipeline();
}

document.addEventListener('DOMContentLoaded', async () => {
    initApp();
    drilldownModal = new bootstrap.Modal(document.getElementById('drilldownModal'));
    document.querySelectorAll('.dash-preset').forEach(btn => btn.addEventListener('click', () => setPreset(btn.dataset.preset)));
    ['dashFrom','dashTo'].forEach(id => {
        document.getElementById(id).addEventListener('change', () => {
            _dashFrom = document.getElementById('dashFrom').value;
            _dashTo   = document.getElementById('dashTo').value;
            document.querySelectorAll('.dash-preset').forEach(b => { b.style.background=b.style.borderColor=b.style.color=b.style.fontWeight=''; });
            const lbl = document.getElementById('dashRangeLabel');
            if (lbl) lbl.textContent = (_dashFrom || _dashTo) ? 'Custom range' : 'Showing all time';
            refreshDashboard();
        });
    });
    const all = document.querySelector('.dash-preset[data-preset="all"]');
    if (all) { all.style.background='rgba(74,144,226,.18)'; all.style.borderColor='#4a90e2'; all.style.color='#4a90e2'; all.style.fontWeight='600'; }

    window._auditLogAllowed = (function() {
        try {
            const u = JSON.parse(localStorage.getItem('user'));
            if (!u) return false;
            const perms = u.permissions || getRoleDefaultPermissions(u.role);
            const p = perms['audit_log'];
            return p && p.visible === true;
        } catch(e) { return false; }
    })();
    if (!window._auditLogAllowed) {
        const card = document.getElementById('recentActivityCard');
        if (card) card.classList.add('d-none');
    }

    document.getElementById('drilldownCsvBtn').addEventListener('click', exportDrilldownCsv);
    document.getElementById('exportDashboardBtn').addEventListener('click', exportDashboardReport);
    document.getElementById('exportActivityBtn').addEventListener('click', exportRecentActivity);

    await refreshDashboard();

    try {
        const chartRes = await fetchWithAuth(_api.charts);
        if (chartRes && chartRes.ok) renderCharts(await chartRes.json());
    } catch(e) { console.warn('Charts failed:', e); }
});

async function loadRxPipeline() {
    const stepsEl = document.getElementById('rxPipelineSteps'), luEl = document.getElementById('rxPipelineLastUpdated');
    if (!stepsEl) return;
    stepsEl.innerHTML = '<div class="text-muted text-center py-3"><i class="fas fa-spinner fa-spin me-2"></i>Loading...</div>';
    try {
        const res = await fetchWithAuth(_api.rxp);
        if (!res || !res.ok) throw new Error('Failed');
        const d = await res.json();
        document.getElementById('rxPipelineNotStarted').textContent = d.notStarted ?? 0;
        document.getElementById('rxPipelineInProgress').textContent = d.inProgress ?? 0;
        document.getElementById('rxPipelineCompleted').textContent  = d.completed  ?? 0;
        const pct = d.total > 0 ? Math.round((d.completed / d.total) * 100) : 0;
        document.getElementById('rxPipelinePercent').textContent = pct + '% complete';
        document.getElementById('rxPipelineProgressBar').style.width = pct + '%';
        if (luEl) luEl.textContent = 'Updated ' + new Date().toLocaleTimeString();
        const COLORS = ['#4a90e2','#7b61ff','#fd7e14','#20c997','#e24a9a','#50e3c2','#f5a623'];
        if (!d.stepBreakdown || !d.stepBreakdown.length) {
            stepsEl.innerHTML = '<p class="text-muted text-center small py-2">No workflow steps configured yet.</p>';
            return;
        }
        var stepsHtml = '<div style="font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#888;margin-bottom:10px">Workflow Step Breakdown &mdash; RX records waiting at each step</div>' +
            '<div style="display:flex;flex-direction:column;gap:8px">' +
            (function(){ var _sd=''; d.stepBreakdown.forEach(function(step, i) {
                var color = COLORS[i % COLORS.length];
                var barPct = d.inProgress > 0 ? Math.round((step.count / d.inProgress) * 100) : 0;
                _sd += '<div style="display:flex;align-items:center;gap:12px">' +
                    '<div style="flex-shrink:0;width:22px;height:22px;border-radius:50%;background:' + color + '22;display:flex;align-items:center;justify-content:center;font-size:.65rem;font-weight:700;color:' + color + '">' + (i+1) + '</div>' +
                    '<div style="flex-shrink:0;width:160px;font-size:.82rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="' + (step.name||'') + '">' + (step.name||'') + '</div>' +
                    '<div style="flex:1;height:8px;border-radius:4px;background:rgba(0,0,0,.07);overflow:hidden">' +
                        '<div style="height:100%;border-radius:4px;background:' + color + ';width:' + barPct + '%;transition:width .5s ease"></div>' +
                    '</div>' +
                    '<div style="flex-shrink:0;width:32px;text-align:right;font-size:.82rem;font-weight:600;color:' + color + '">' + step.count + '</div>' +
                '</div>';
            }); return _sd; })() +
            '</div>';
        if (d.completed > 0) {
            var completedPct = d.total > 0 ? Math.round(d.completed / d.total * 100) : 0;
            stepsHtml += '<div style="display:flex;align-items:center;gap:12px;margin-top:8px;padding-top:8px;border-top:1px solid rgba(0,0,0,.07)">' +
                '<div style="flex-shrink:0;width:22px;height:22px;border-radius:50%;background:#19875422;display:flex;align-items:center;justify-content:center"><i class="fas fa-check" style="font-size:.6rem;color:#198754"></i></div>' +
                '<div style="flex-shrink:0;width:160px;font-size:.82rem;font-weight:600;color:#198754">Completed</div>' +
                '<div style="flex:1;height:8px;border-radius:4px;background:rgba(0,0,0,.07);overflow:hidden">' +
                    '<div style="height:100%;border-radius:4px;background:#198754;width:' + completedPct + '%;transition:width .5s ease"></div>' +
                '</div>' +
                '<div style="flex-shrink:0;width:32px;text-align:right;font-size:.82rem;font-weight:600;color:#198754">' + d.completed + '</div>' +
            '</div>';
        }
        stepsEl.innerHTML = stepsHtml;
    } catch(e) {
        stepsEl.innerHTML = '<p class="text-danger text-center small py-2"><i class="fas fa-exclamation-triangle me-1"></i>Could not load pipeline data.</p>';
    }
}

function renderCharts(data) {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const tc = isDark ? '#c9d1d9' : '#444', gc = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)';
    Chart.defaults.color = tc;
    new Chart(document.getElementById('patientsBarChart').getContext('2d'), {
        type: 'bar',
        data: { labels: data.patientsPerMonth.labels, datasets: [{ label: 'New Patients', data: data.patientsPerMonth.data, backgroundColor: 'rgba(74,144,226,0.75)', borderColor: 'rgba(74,144,226,1)', borderWidth: 1, borderRadius: 6 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { color: gc }, ticks: { color: tc } }, y: { grid: { color: gc }, ticks: { color: tc, stepSize: 1, precision: 0 }, beginAtZero: true } } }
    });
    const total = data.rxStatus.data.reduce((a,b) => a+b, 0);
    new Chart(document.getElementById('rxDonutChart').getContext('2d'), {
        type: 'doughnut',
        data: { labels: data.rxStatus.labels, datasets: [{ data: total > 0 ? data.rxStatus.data : [1], backgroundColor: total > 0 ? ['rgba(80,227,194,0.85)','rgba(245,166,35,0.85)'] : ['rgba(150,150,150,0.3)'], borderWidth: 2, borderColor: isDark ? '#1a1f2e' : '#fff' }] },
        options: { responsive: true, maintainAspectRatio: false, cutout: '68%', plugins: { legend: { position: 'bottom', labels: { color: tc, padding: 14, font: { size: 13 } } }, tooltip: { callbacks: { label: ctx => total > 0 ? ' ' + ctx.label + ': ' + ctx.raw + ' (' + Math.round(ctx.raw/total*100) + '%)' : ' No RX records yet' } } } }
    });
}

async function openDrilldown(type) {
    drilldownType = type; drilldownCurrentData = [];
    const titles = {
        'active-patients':   'Active Patients',
        'inactive-patients': 'Inactive Patients',
        'total-rx':          'All RX Records',
        'pending-rx':        'Pending RX Records (Incomplete Workflow)',
        'patients-no-rx':    'Active Patients with No RX Records'
    };
    // Read page links from hidden anchors — eliminates '/' string FortiGate would corrupt
    function _getPageLink(t) {
        var idMap = {
            'active-patients':   'xl-patients-active',
            'inactive-patients': 'xl-patients-inactive',
            'total-rx':          'xl-rx-records',
            'pending-rx':        'xl-rx-records-pending',
            'patients-no-rx':    'xl-patients-norx'
        };
        var lid = idMap[t];
        if (!lid) return '#';
        var el = document.getElementById(lid);
        return el ? el.href : '#';
    }
    document.getElementById('drilldownTitle').textContent = titles[type] || 'Report';
    document.getElementById('drilldownBody').innerHTML = '<p class="text-center text-muted py-4"><i class="fas fa-spinner fa-spin me-2"></i>Loading...</p>';
    const fp = document.getElementById('drilldownFullPageBtn');
    if (fp) fp.href = _getPageLink(type);
    drilldownModal.show();
    try {
        const res = await fetchWithAuth(_api.drill + type);
        if (!res) return;
        const data = await res.json();
        drilldownCurrentData = data;
        document.getElementById('drilldownTitle').textContent = (titles[type] || 'Report') + ' (' + data.length + ')';
        renderDrilldownTable(type, data);
    } catch(e) {
        document.getElementById('drilldownBody').innerHTML = '<p class="text-danger text-center py-4">Error loading data.</p>';
    }
}

function renderDrilldownTable(type, data) {
    const body = document.getElementById('drilldownBody');
    if (!data || !data.length) { body.innerHTML = '<p class="text-center text-muted py-4">No records found.</p>'; return; }
    const isPatient = ['active-patients','inactive-patients','patients-no-rx'].includes(type);
    if (isPatient) {
        body.innerHTML = '<div class="table-responsive">' +
            '<table class="table table-hover table-sm align-middle">' +
                '<thead><tr>' +
                    '<th>Patient ID</th><th>Name</th><th>DOB</th><th>Phone</th>' +
                    '<th>Service Date</th><th>Clinic</th><th>Patient Transport</th><th>Pharmacy Transport</th>' +
                '</tr></thead>' +
                '<tbody>' + (function(){ var _dp=''; data.forEach(function(p) {
                    return '<tr>' +
                        '<td><code>' + (p.patientCode || p.id) + '</code></td>' +
                        '<td><strong>' + (p.firstName||'') + ' ' + (p.lastName||'') + '</strong></td>' +
                        '<td>' + (p.dob||'&mdash;') + '</td>' +
                        '<td>' + (p.phone||'&mdash;') + '</td>' +
                        '<td>' + (p.serviceDate||'&mdash;') + '</td>' +
                        '<td>' + (p.Clinic ? p.Clinic.name : '&mdash;') + '</td>' +
                        '<td>' + (p.PatientTransportCompany ? (p.PatientTransportCompany.contactPerson||p.PatientTransportCompany.companyName||'&mdash;') : '&mdash;') + '</td>' +
                        '<td>' + (p.PharmacyTransportCompany ? (p.PharmacyTransportCompany.contactPerson||p.PharmacyTransportCompany.companyName||'&mdash;') : '&mdash;') + '</td>' +
                    '</tr>';
                }); return _dp; })() + '</tbody>' +
            '</table>' +
            '</div>' +
            '<small class="text-muted">' + data.length + ' records</small>';
    } else {
        body.innerHTML = '<div class="table-responsive">' +
            '<table class="table table-hover table-sm align-middle">' +
                '<thead><tr>' +
                    '<th>RX #</th><th>Patient</th><th>Patient ID</th>' +
                    '<th>Pharmacy</th><th>Arrival Date</th><th>Service Date</th><th>Workflow Progress</th>' +
                '</tr></thead>' +
                '<tbody>' + (function(){ var _drx=''; data.forEach(function(rx) {
                    var steps = (rx.RXWorkflowTrackings || []).length;
                    var pct = steps > 0 ? Math.round(steps / Math.max(steps, 1) * 100) : 0;
                    _drx += '<tr>' +
                        '<td><strong>#' + rx.id + '</strong></td>' +
                        '<td>' + (rx.Patient ? rx.Patient.firstName+' '+rx.Patient.lastName : '&mdash;') + '</td>' +
                        '<td><code>' + (rx.Patient ? (rx.Patient.patientCode||rx.patientId) : rx.patientId) + '</code></td>' +
                        '<td>' + (rx.Pharmacy ? rx.Pharmacy.name : '&mdash;') + '</td>' +
                        '<td>' + (rx.arrivalDate||'&mdash;') + '</td>' +
                        '<td>' + (rx.serviceDate||'&mdash;') + '</td>' +
                        '<td><div class="progress" style="height:8px;min-width:60px"><div class="progress-bar bg-primary" style="width:' + pct + '%"></div></div><small>' + steps + ' step(s) completed</small></td>' +
                    '</tr>';
                }); return _drx; })() + '</tbody>' +
            '</table>' +
            '</div>' +
            '<small class="text-muted">' + data.length + ' records</small>';
    }
}

function exportDrilldownCsv() {
    if (!drilldownCurrentData || !drilldownCurrentData.length) { showToast('No data to export.', 'warning'); return; }
    const isPatient = ['active-patients','inactive-patients','patients-no-rx'].includes(drilldownType);
    const headers = isPatient
        ? ['Patient ID','First Name','Last Name','DOB','Phone','Service Date','Clinic','Patient Transport','Pharmacy Transport','Status']
        : ['RX #','Patient ID','Patient Name','Pharmacy','Arrival Date','Service Date','Steps Completed'];
    const rows = isPatient
        ? drilldownCurrentData.map(p => [p.patientCode||p.id, p.firstName, p.lastName, p.dob||'', p.phone||'', p.serviceDate||'', p.Clinic?p.Clinic.name:'', p.PatientTransportCompany?(p.PatientTransportCompany.contactPerson||p.PatientTransportCompany.companyName||''):'', p.PharmacyTransportCompany?(p.PharmacyTransportCompany.contactPerson||p.PharmacyTransportCompany.companyName||''):'', p.isActive?'Active':'Inactive'])
        : drilldownCurrentData.map(rx => [rx.id, rx.Patient?(rx.Patient.patientCode||rx.patientId):rx.patientId, rx.Patient?rx.Patient.firstName+' '+rx.Patient.lastName:'', rx.Pharmacy?rx.Pharmacy.name:'', rx.arrivalDate||'', rx.serviceDate||'', (rx.RXWorkflowTrackings||[]).length]);
    const t = { 'active-patients':'active_patients','inactive-patients':'inactive_patients','total-rx':'all_rx_records','pending-rx':'pending_rx','patients-no-rx':'patients_no_rx' };
    exportToCsv((t[drilldownType]||'report')+'_'+new Date().toISOString().slice(0,10)+'.csv', headers, rows);
}

async function exportDashboardReport() {
    const btn = document.getElementById('exportDashboardBtn');
    btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Exporting...';
    try {
        const [active, inactive, totalRx, pending, noRx] = await Promise.all([
            fetchWithAuth(_api.ap).then(r=>r.json()),
            fetchWithAuth(_api.ip).then(r=>r.json()),
            fetchWithAuth(_api.tr).then(r=>r.json()),
            fetchWithAuth(_api.pr).then(r=>r.json()),
            fetchWithAuth(_api.nr).then(r=>r.json())
        ]);
        const headers = ['Section','Patient/RX ID','Name','Status','DOB / Arrival Date','Service Date','Clinic / Pharmacy'];
        const rows = [];
        active.forEach(p   => rows.push(['Active Patients',    p.patientCode||p.id, p.firstName+' '+p.lastName, 'Active',   p.dob||'', p.serviceDate||'', p.Clinic?p.Clinic.name:'']));
        inactive.forEach(p => rows.push(['Inactive Patients',  p.patientCode||p.id, p.firstName+' '+p.lastName, 'Inactive', p.dob||'', p.serviceDate||'', p.Clinic?p.Clinic.name:'']));
        noRx.forEach(p     => rows.push(['No RX Records',      p.patientCode||p.id, p.firstName+' '+p.lastName, 'Active',   p.dob||'', p.serviceDate||'', p.Clinic?p.Clinic.name:'']));
        totalRx.forEach(rx => rows.push(['RX Records',         '#'+rx.id, rx.Patient?rx.Patient.firstName+' '+rx.Patient.lastName:'', 'RX', rx.arrivalDate||'', rx.serviceDate||'', rx.Pharmacy?rx.Pharmacy.name:'']));
        pending.forEach(rx => rows.push(['Pending Deliveries', '#'+rx.id, rx.Patient?rx.Patient.firstName+' '+rx.Patient.lastName:'', 'Pending', rx.arrivalDate||'', rx.serviceDate||'', rx.Pharmacy?rx.Pharmacy.name:'']));
        exportToCsv('dashboard_report_'+new Date().toISOString().slice(0,10)+'.csv', headers, rows);
        showToast('Dashboard report exported!', 'success');
    } catch(e) { showToast('Export failed', 'danger'); }
    finally { btn.disabled = false; btn.innerHTML = '<i class="fas fa-file-csv me-1"></i>Export Report'; }
}

function exportRecentActivity() {
    const rows = [];
    document.querySelectorAll('#recentActivityBody tr').forEach(tr => {
        const c = tr.querySelectorAll('td');
        if (c.length >= 4) rows.push([c[0].textContent.trim(), c[1].textContent.trim(), c[2].textContent.trim(), c[3].textContent.trim(), c[4]?c[4].textContent.trim():'']);
    });
    if (!rows.length) { showToast('No activity to export', 'warning'); return; }
    exportToCsv('recent_activity_'+new Date().toISOString().slice(0,10)+'.csv', ['User','Module','Action','Date','IP Address'], rows);
    showToast('Recent activity exported!', 'success');
}

// ── My Account / 2FA Management ──────────────────────────────────────────
let _accountModal = null;
function openAccountModal() {
    if (!_accountModal) _accountModal = new bootstrap.Modal(document.getElementById('accountModal'));
    load2FAStatus();
    _accountModal.show();
}

async function load2FAStatus() {
    try {
        const res  = await fetchWithAuth(_api.s2fa);
        if (!res) return;
        const data = await res.json();
        const enabled = !!data.twoFactorEnabled;

        const icon = document.getElementById('twoFAStatusIcon');
        const text = document.getElementById('twoFAStatusText');
        const sub  = document.getElementById('twoFAStatusSub');
        const banner = document.getElementById('twoFAStatusBanner');

        if (enabled) {
            icon.innerHTML = '<i class="fas fa-shield-alt text-success"></i>';
            text.innerHTML = '<span class="text-success">2FA is ENABLED</span>';
            sub.textContent  = 'Your account is protected with two-factor authentication.';
            banner.style.background = 'rgba(25,135,84,.15)';
            document.getElementById('twoFASetupSection').classList.add('d-none');
            document.getElementById('twoFADisableSection').classList.remove('d-none');
            document.getElementById('twoFADisableCode').value = '';
            document.getElementById('twoFADisableError').classList.add('d-none');
        } else {
            icon.innerHTML = '<i class="fas fa-shield-alt text-muted"></i>';
            text.innerHTML = '<span class="text-muted">2FA is DISABLED</span>';
            sub.textContent  = 'Enable 2FA to protect your account.';
            banner.style.background = 'rgba(255,255,255,.05)';
            document.getElementById('twoFASetupSection').classList.remove('d-none');
            document.getElementById('twoFADisableSection').classList.add('d-none');
            document.getElementById('twoFAQRSection').classList.add('d-none');
        }
    } catch(e) {
        console.error('2FA status load failed', e);
    }
}

async function start2FASetup() {
    const btn = document.getElementById('startSetupBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Generating QR code\u2026';
    try {
        const res  = await fetchWithAuth(_api.u2fa);
        if (!res || !res.ok) { showToast('Failed to generate 2FA setup.', 'danger'); return; }
        const data = await res.json();
        document.getElementById('twoFAQRImg').src            = data.qrCode;
        document.getElementById('twoFASecretDisplay').value  = data.secret;
        document.getElementById('twoFAEnableCode').value     = '';
        document.getElementById('twoFAEnableError').classList.add('d-none');
        document.getElementById('twoFAQRSection').classList.remove('d-none');
    } catch(e) { showToast('Network error.', 'danger'); }
    finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-qrcode me-1"></i>Set Up Two-Factor Authentication';
    }
}

async function enable2FA() {
    const rawCode = document.getElementById('twoFAEnableCode').value.replace(/\s/g,'');
    const errEl   = document.getElementById('twoFAEnableError');
    const btn     = document.getElementById('enableTwoFABtn');
    const spinner = document.getElementById('enableSpinner');
    errEl.classList.add('d-none');
    if (rawCode.length !== 6) { errEl.textContent='Enter the full 6-digit code.'; errEl.classList.remove('d-none'); return; }
    btn.disabled = true; spinner.classList.remove('d-none');
    try {
        var _u2fa = _api.e2fa;
        const res  = await fetchWithAuth(_u2fa, { method:'POST', body: JSON.stringify({ code: rawCode }) });
        const data = await res.json();
        if (res.ok) { showToast('2FA enabled! You will need your authenticator app on next login.', 'success'); load2FAStatus(); }
        else        { errEl.textContent = data.message || 'Invalid code.'; errEl.classList.remove('d-none'); }
    } catch(e) { errEl.textContent='Network error.'; errEl.classList.remove('d-none'); }
    finally { btn.disabled=false; spinner.classList.add('d-none'); }
}

async function disable2FA() {
    const rawCode = document.getElementById('twoFADisableCode').value.replace(/\s/g,'');
    const errEl   = document.getElementById('twoFADisableError');
    const btn     = document.getElementById('disableTwoFABtn');
    const spinner = document.getElementById('disableSpinner');
    errEl.classList.add('d-none');
    if (rawCode.length !== 6) { errEl.textContent='Enter the full 6-digit code.'; errEl.classList.remove('d-none'); return; }
    btn.disabled = true; spinner.classList.remove('d-none');
    try {
        var _ud2fa = _api.d2fa;
        const res  = await fetchWithAuth(_ud2fa, { method:'POST', body: JSON.stringify({ code: rawCode }) });
        const data = await res.json();
        if (res.ok) { showToast('2FA has been disabled.', 'warning'); load2FAStatus(); }
        else        { errEl.textContent = data.message || 'Invalid code.'; errEl.classList.remove('d-none'); }
    } catch(e) { errEl.textContent='Network error.'; errEl.classList.remove('d-none'); }
    finally { btn.disabled=false; spinner.classList.add('d-none'); }
}

function copySecret() {
    const s = document.getElementById('twoFASecretDisplay').value;
    navigator.clipboard.writeText(s).then(() => showToast('Secret key copied!', 'info'));
}

// Auto-format 2FA code inputs (insert space after 3 digits)
['twoFAEnableCode','twoFADisableCode'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', function() {
        let v = this.value.replace(/\D/g,'').substring(0,6);
        this.value = v.length > 3 ? v.slice(0,3)+' '+v.slice(3) : v;
    });
});
