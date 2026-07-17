// dashboard.js -- FortiGate-safe ES5 rewrite
// No arrow functions, no const/let, no template literals, no ??, no ?.
// All async done with Promise chains (.then/.catch). Uses var throughout.

// =====================================================================
// API URL anchors -- FortiGate rewrites href on <a> elements correctly
// =====================================================================
var _api = (function() {
    function _h(id) { var el = document.getElementById(id); return el ? el.href : ''; }
    return {
        stats:    _h('xa-stats'),
        charts:   _h('xa-charts'),
        rxp:      _h('xa-rxp'),
        elig:     _h('xa-elig'),
        ccReview: _h('xa-cc-review'),
        ccDrill:  _h('xa-cc-drilldown'),
        drill:    _h('xa-drill'),
        eligBase: _h('xa-elig-base'),
        ap:       _h('xa-ap'),
        ip:       _h('xa-ip'),
        tr:       _h('xa-tr'),
        pr:       _h('xa-pr'),
        nr:       _h('xa-nr'),
        s2fa:     _h('xa-s2fa'),
        u2fa:     _h('xa-u2fa'),
        e2fa:     _h('xa-e2fa'),
        d2fa:     _h('xa-d2fa'),
        r2fa:     _h('xa-r2fa'),
        cpw:      _h('xa-cpw')
    };
})();

var drilldownModal = null, drilldownCurrentData = [], drilldownType = '';
var _dashFrom = '', _dashTo = '';
var _trendPreset = '30d', _trendFrom = '', _trendTo = '';
var _trendChartType = 'line';
var _ccHistoryPreset = '30d', _ccHistoryFrom = '', _ccHistoryTo = '';
var _ccHistoryChartType = 'line', _ccHistoryUserId = '';
var _ccDrilldownSort = { key: '', dir: 'asc' };
var _ccReviewRequestSeq = 0;
var _accountModal = null;

// =====================================================================
// Date preset helpers
// =====================================================================
function _fmtDate(d) { return d.toISOString().slice(0,10); }

function getPresetRange(preset) {
    var now = new Date();
    var today = _fmtDate(now);
    if (preset === 'all')   return { from: '', to: '' };
    if (preset === 'today') return { from: today, to: today };
    if (preset === 'week')  {
        var s = new Date(now);
        s.setDate(now.getDate() - now.getDay());
        return { from: _fmtDate(s), to: today };
    }
    if (preset === 'month') return { from: _fmtDate(new Date(now.getFullYear(), now.getMonth(), 1)), to: today };
    if (preset === '30d')   {
        var s2 = new Date(now);
        s2.setDate(now.getDate() - 30);
        return { from: _fmtDate(s2), to: today };
    }
    if (preset === 'year')  return { from: _fmtDate(new Date(now.getFullYear(), 0, 1)), to: today };
    return { from: '', to: '' };
}

function setPreset(preset) {
    var range = getPresetRange(preset);
    _dashFrom = range.from;
    _dashTo   = range.to;
    var fromEl = document.getElementById('dashFrom');
    var toEl   = document.getElementById('dashTo');
    if (fromEl) fromEl.value = range.from;
    if (toEl)   toEl.value   = range.to;

    var presets = document.querySelectorAll('.dash-preset');
    for (var pi = 0; pi < presets.length; pi++) {
        var b = presets[pi];
        var isActive = b.getAttribute('data-preset') === preset;
        b.style.background  = isActive ? 'rgba(74,144,226,.18)' : '';
        b.style.borderColor = isActive ? '#4a90e2' : '';
        b.style.color       = isActive ? '#4a90e2' : '';
        b.style.fontWeight  = isActive ? '600' : '';
    }

    var labelMap = {
        all:   'Showing all time',
        today: 'Showing today',
        week:  'Showing this week',
        month: 'Showing this month',
        '30d': 'Showing last 30 days',
        year:  'Showing this year'
    };
    var lbl = document.getElementById('dashRangeLabel');
    if (lbl) lbl.textContent = labelMap[preset] || 'Custom range';
    refreshDashboard();
}

function buildDateQuery() {
    var parts = [];
    if (_dashFrom) parts.push('from=' + _dashFrom);
    if (_dashTo)   parts.push('to='   + _dashTo);
    return parts.length ? '?' + parts.join('&') : '';
}

function validateDashRange() {
    var fromEl = document.getElementById('dashFrom');
    var toEl   = document.getElementById('dashTo');
    if (!fromEl || !toEl) return true;
    var from = fromEl.value;
    var to   = toEl.value;
    if (from && to && from > to) {
        showToast('Dashboard custom date range cannot have From after To.', 'warning');
        toEl.value = from;
        return false;
    }
    return true;
}

function getTrendPresetRange(preset) {
    var now = new Date();
    var today = _fmtDate(now);
    if (preset === 'all') return { from: '', to: '' };
    if (preset === '7d')  {
        var s7 = new Date(now);
        s7.setDate(now.getDate() - 6);
        return { from: _fmtDate(s7), to: today };
    }
    if (preset === '30d') {
        var s30 = new Date(now);
        s30.setDate(now.getDate() - 29);
        return { from: _fmtDate(s30), to: today };
    }
    if (preset === '90d') {
        var s90 = new Date(now);
        s90.setDate(now.getDate() - 89);
        return { from: _fmtDate(s90), to: today };
    }
    return { from: '', to: '' };
}

function syncTrendUi() {
    var fromEl = document.getElementById('trendFrom');
    var toEl   = document.getElementById('trendTo');
    if (fromEl) fromEl.value = _trendFrom || '';
    if (toEl)   toEl.value   = _trendTo || '';
    var btns = document.querySelectorAll('.trend-range-btn');
    for (var i = 0; i < btns.length; i++) {
        var b = btns[i];
        var active = b.getAttribute('data-trend-range') === _trendPreset;
        b.classList.toggle('active', active);
    }
}

function setTrendPreset(preset) {
    _trendPreset = preset || '30d';
    var range = getTrendPresetRange(_trendPreset);
    _trendFrom = range.from;
    _trendTo = range.to;
    syncTrendUi();
    loadDashboardCharts();
}

function validateTrendRange() {
    var fromEl = document.getElementById('trendFrom');
    var toEl   = document.getElementById('trendTo');
    if (!fromEl || !toEl) return true;
    var from = fromEl.value;
    var to = toEl.value;
    if (from && to && from > to) {
        showToast('Trend range From date cannot be after To date.', 'warning');
        toEl.value = from;
        return false;
    }
    return true;
}

function buildTrendQuery() {
    var parts = [];
    if (_trendPreset === 'all') parts.push('chartRange=all');
    if (_trendFrom) parts.push('chartFrom=' + _trendFrom);
    if (_trendTo)   parts.push('chartTo=' + _trendTo);
    return parts.length ? '?' + parts.join('&') : '';
}

function loadDashboardCharts() {
    var q = buildTrendQuery();
    return fetchWithAuth(_api.charts + q).then(function(chartRes) {
        if (chartRes && chartRes.ok) {
            return chartRes.json().then(function(chartData) {
                window._lastChartData = chartData;
                renderCharts(chartData);
            });
        }
    }).catch(function(e) { console.warn('Charts failed:', e); });
}

// =====================================================================
// Dashboard stats refresh
// =====================================================================
function refreshDashboard() {
    var q = buildDateQuery();
    return fetchWithAuth(_api.stats + q).then(function(res) {
        if (!res) return;
        return res.json().then(function(data) {
            var safe = function(v) { return (v !== undefined && v !== null) ? v : 0; };
            var setTxt = function(id, val) { var el = document.getElementById(id); if (el) el.textContent = val; };
            setTxt('activePatientsCount',    safe(data.activePatients));
            setTxt('inactivePatientsCount',  safe(data.inactivePatients));
            setTxt('activeRxCount',          safe(data.activeRxCount));
            setTxt('patientsWithNoRxCount',  safe(data.patientsWithNoRx));
            setTxt('pendingDeliveriesCount', safe(data.pendingDeliveriesCount));
            var setNote = function(id, val) { var el = document.getElementById(id); if (el) el.textContent = val; };
            setNote('eligNowNote', 'Active patients only, inactive excluded');
            setNote('eligExpiringNote', 'Active patients only, inactive excluded');
            setNote('eligWindowNote', 'Active patients only, inactive excluded');
            setNote('eligNoDateNote', 'Active patients only, inactive excluded');

            if (window._auditLogAllowed) {
                var tbody = document.getElementById('recentActivityBody');
                if (tbody) {
                    var acts = (data.recentActivity && data.recentActivity.length > 0) ? data.recentActivity : [];
                    var html = '';
                    if (acts.length > 0) {
                        for (var i = 0; i < acts.length; i++) {
                            var a = acts[i];
                            html += '<tr><td>' + (a.User ? a.User.firstName + ' ' + a.User.lastName : 'System') + '</td>' +
                                   '<td>' + (a.module || '') + '</td>' +
                                   '<td><span class="badge bg-secondary">' + (a.action || '') + '</span></td>' +
                                   '<td>' + (a.date || '&mdash;') + '</td>' +
                                   '<td>' + (a.ipAddress || '&mdash;') + '</td></tr>';
                        }
                    } else {
                        html = '<tr><td colspan="5" class="text-center text-muted">No recent activity</td></tr>';
                    }
                    tbody.innerHTML = html;
                }
            }
        });
    }).catch(function(e) {
        console.warn('Stats refresh error:', e);
    }).then(function() {
        loadRxPipeline();
    });
}

function _ccEsc(value) {
    return String(value === undefined || value === null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function getCcHistoryPresetRange(preset) {
    var now = new Date();
    var today = _fmtDate(now);
    if (preset === 'all') return { from: '', to: '' };
    if (preset === '7d') {
        var s7 = new Date(now);
        s7.setDate(now.getDate() - 6);
        return { from: _fmtDate(s7), to: today };
    }
    if (preset === '90d') {
        var s90 = new Date(now);
        s90.setDate(now.getDate() - 89);
        return { from: _fmtDate(s90), to: today };
    }
    var s30 = new Date(now);
    s30.setDate(now.getDate() - 29);
    return { from: _fmtDate(s30), to: today };
}

function syncCcHistoryUi() {
    var fromEl = document.getElementById('ccHistoryFrom');
    var toEl = document.getElementById('ccHistoryTo');
    if (fromEl) fromEl.value = _ccHistoryFrom || '';
    if (toEl) toEl.value = _ccHistoryTo || '';
    var btns = document.querySelectorAll('.cc-history-range-btn');
    for (var i = 0; i < btns.length; i++) {
        var active = btns[i].getAttribute('data-cc-history-range') === _ccHistoryPreset;
        btns[i].classList.toggle('active', active);
    }
    var typeEl = document.getElementById('ccHistoryChartType');
    if (typeEl) typeEl.value = _ccHistoryChartType;
    var userEl = document.getElementById('ccHistoryUser');
    if (userEl) userEl.value = _ccHistoryUserId || '';
}

function setCcHistoryPreset(preset) {
    _ccHistoryPreset = preset || '30d';
    var range = getCcHistoryPresetRange(_ccHistoryPreset);
    _ccHistoryFrom = range.from;
    _ccHistoryTo = range.to;
    syncCcHistoryUi();
    loadCallCenterReviewMetrics();
}

function validateCcHistoryRange() {
    var fromEl = document.getElementById('ccHistoryFrom');
    var toEl = document.getElementById('ccHistoryTo');
    if (!fromEl || !toEl) return true;
    var from = fromEl.value;
    var to = toEl.value;
    if (from && to && from > to) {
        showToast('Call Center range From date cannot be after To date.', 'warning');
        toEl.value = from;
        return false;
    }
    return true;
}

function buildCallCenterReviewQuery() {
    var parts = [];
    var today = _fmtDate(new Date());
    if (_ccHistoryPreset === 'all') {
        parts.push('from=1900-01-01');
        parts.push('to=' + encodeURIComponent(today));
        parts.push('historyRange=all');
    } else {
        if (_ccHistoryFrom) parts.push('from=' + encodeURIComponent(_ccHistoryFrom));
        if (_ccHistoryTo) parts.push('to=' + encodeURIComponent(_ccHistoryTo));
        if (_ccHistoryFrom) parts.push('historyFrom=' + encodeURIComponent(_ccHistoryFrom));
        if (_ccHistoryTo) parts.push('historyTo=' + encodeURIComponent(_ccHistoryTo));
    }
    if (_ccHistoryUserId) parts.push('historyUserId=' + encodeURIComponent(_ccHistoryUserId));
    return parts.length ? '?' + parts.join('&') : '';
}

function buildCallCenterDrilldownQuery(metric) {
    var query = buildCallCenterReviewQuery();
    return query + (query ? '&' : '?') + 'metric=' + encodeURIComponent(metric || 'calls');
}

function formatCcDateTime(value) {
    if (!value) return '--';
    var d = new Date(value);
    if (isNaN(d.getTime())) return String(value);
    return d.toLocaleString([], { month: '2-digit', day: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function ccHasNumber(value) {
    return value !== null && value !== undefined && value !== '' && !isNaN(Number(value));
}

function ccRound1(value) {
    return Math.round(Number(value || 0) * 10) / 10;
}

function normalizeCcTotals(totals) {
    totals = totals || {};
    var calls = Number(totals.calls || 0);
    var patients = Number(totals.uniquePatientsCalled || 0);
    var dates = Number(totals.serviceDates || 0);
    var repeats = Number(totals.repeatCalls || 0);
    var notes = Number(totals.notes || 0);
    return {
        calls: calls,
        uniquePatientsCalled: patients,
        serviceDates: dates,
        repeatCalls: repeats,
        notes: notes,
        efficiency: ccHasNumber(totals.efficiency) ? Number(totals.efficiency) : (calls ? Math.round((dates / calls) * 100) : null),
        conversionRate: ccHasNumber(totals.conversionRate) ? Number(totals.conversionRate) : (patients ? Math.round((dates / patients) * 100) : null),
        repeatRate: ccHasNumber(totals.repeatRate) ? Number(totals.repeatRate) : (calls ? Math.round((repeats / calls) * 100) : null),
        callsPerServiceDate: ccHasNumber(totals.callsPerServiceDate) ? Number(totals.callsPerServiceDate) : (dates ? ccRound1(calls / dates) : null),
        notesPerCall: ccHasNumber(totals.notesPerCall) ? Number(totals.notesPerCall) : (calls ? ccRound1(notes / calls) : null),
        lastActionAt: totals.lastActionAt || null
    };
}

function ccMetricText(value, suffix) {
    if (!ccHasNumber(value)) return '--';
    return String(value) + (suffix || '');
}

function populateCcHistoryUsers(users) {
    var sel = document.getElementById('ccHistoryUser');
    if (!sel) return;
    var current = _ccHistoryUserId || sel.value || '';
    var seen = {};
    var html = '<option value="">All Users Combined</option>';
    users = users || [];
    for (var i = 0; i < users.length; i++) {
        var u = users[i] || {};
        if (!u.userId || seen[String(u.userId)]) continue;
        seen[String(u.userId)] = true;
        html += '<option value="' + _ccEsc(u.userId) + '">' + _ccEsc(u.user || ('User ' + u.userId)) + '</option>';
    }
    if (current && !seen[String(current)]) {
        html += '<option value="' + _ccEsc(current) + '">User ' + _ccEsc(current) + '</option>';
    }
    sel.innerHTML = html;
    sel.value = current;
}

function selectedCcHistoryUserLabel() {
    var sel = document.getElementById('ccHistoryUser');
    if (!sel) return 'All Users';
    var option = sel.options[sel.selectedIndex];
    return option && option.text ? option.text : 'All Users Combined';
}

function renderCallCenterReviewCharts(data) {
    if (typeof Chart === 'undefined') return;
    var history = data && data.history ? data.history : null;
    var series = history && history.series ? history.series : {};
    var labels = series.labels || [];
    var range = history && history.range ? history.range : null;
    var rangeEl = document.getElementById('ccReviewHistoryRange');
    if (rangeEl && range) rangeEl.textContent = range.from === range.to ? range.from : range.from + ' to ' + range.to;

    var activityCanvas = document.getElementById('ccReviewActivityChart');
    var efficiencyCanvas = document.getElementById('ccReviewEfficiencyChart');
    if (activityCanvas && Chart.getChart(activityCanvas)) Chart.getChart(activityCanvas).destroy();
    if (efficiencyCanvas && Chart.getChart(efficiencyCanvas)) Chart.getChart(efficiencyCanvas).destroy();
    if (!labels.length) return;

    var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    var tc = isDark ? '#c9d1d9' : '#444';
    var gc = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)';
    var chartType = _ccHistoryChartType === 'bar' ? 'bar' : 'line';
    var pointRadius = chartType === 'bar' ? 0 : 1.5;
    var lineTension = chartType === 'bar' ? 0 : 0.25;
    Chart.defaults.color = tc;

    var commonOptions = {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { position: 'bottom' } },
        scales: {
            x: { grid: { color: gc }, ticks: { color: tc, maxRotation: 0, autoSkip: true } },
            y: { grid: { color: gc }, ticks: { color: tc, precision: 0 }, beginAtZero: true }
        }
    };

    if (activityCanvas) {
        new Chart(activityCanvas.getContext('2d'), {
            type: chartType,
            data: {
                labels: labels,
                datasets: [
                    { label: 'Calls', data: series.calls || [], borderColor: 'rgba(56,189,248,0.9)', backgroundColor: 'rgba(56,189,248,0.55)', tension: lineTension, fill: false, pointRadius: pointRadius },
                    { label: 'Patients', data: series.uniquePatientsCalled || [], borderColor: 'rgba(74,144,226,0.9)', backgroundColor: 'rgba(74,144,226,0.55)', tension: lineTension, fill: false, pointRadius: pointRadius },
                    { label: 'Service Dates', data: series.serviceDates || [], borderColor: 'rgba(32,201,151,0.9)', backgroundColor: 'rgba(32,201,151,0.55)', tension: lineTension, fill: false, pointRadius: pointRadius },
                    { label: 'Repeat Calls', data: series.repeatCalls || [], borderColor: 'rgba(245,166,35,0.9)', backgroundColor: 'rgba(245,166,35,0.55)', tension: lineTension, fill: false, pointRadius: pointRadius }
                ]
            },
            options: commonOptions
        });
    }

    if (efficiencyCanvas) {
        new Chart(efficiencyCanvas.getContext('2d'), {
            type: chartType,
            data: {
                labels: labels,
                datasets: [
                    { label: 'Efficiency %', data: series.efficiency || [], borderColor: 'rgba(255,193,7,0.95)', backgroundColor: 'rgba(255,193,7,0.55)', tension: lineTension, fill: false, pointRadius: pointRadius },
                    { label: 'Conversion %', data: series.conversionRate || [], borderColor: 'rgba(32,201,151,0.95)', backgroundColor: 'rgba(32,201,151,0.5)', tension: lineTension, fill: false, pointRadius: pointRadius },
                    { label: 'Repeat %', data: series.repeatRate || [], borderColor: 'rgba(245,166,35,0.95)', backgroundColor: 'rgba(245,166,35,0.5)', tension: lineTension, fill: false, pointRadius: pointRadius },
                    { label: 'Notes', data: series.notes || [], borderColor: 'rgba(155,89,182,0.9)', backgroundColor: 'rgba(155,89,182,0.5)', tension: lineTension, fill: false, pointRadius: pointRadius, yAxisID: 'yActivity' }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: { legend: { position: 'bottom' } },
                scales: {
                    x: { grid: { color: gc }, ticks: { color: tc, maxRotation: 0, autoSkip: true } },
                    y: { grid: { color: gc }, ticks: { color: tc, precision: 0 }, beginAtZero: true, suggestedMax: 100 },
                    yActivity: { position: 'right', grid: { drawOnChartArea: false }, ticks: { color: tc, precision: 0 }, beginAtZero: true }
                }
            }
        });
    }
}

function loadCallCenterReviewMetrics() {
    if (!_api.ccReview) return;
    var requestSeq = ++_ccReviewRequestSeq;
    return fetchWithAuth(_api.ccReview + buildCallCenterReviewQuery(), { silent: true }).then(function(res) {
        if (!res || !res.ok) return;
        return res.json().then(function(data) {
            if (requestSeq !== _ccReviewRequestSeq) return;
            window._lastCallCenterReviewData = data;
            var row = document.getElementById('callCenterReviewRow');
            var card = document.getElementById('callCenterReviewCard');
            if (row) row.classList.remove('d-none');
            if (card) card.classList.remove('d-none');
            var totals = normalizeCcTotals(data.totals || {});
            var setTxt = function(id, val) { var el = document.getElementById(id); if (el) el.textContent = val; };
            setTxt('ccReviewEligible', data.eligibleTotal || 0);
            setTxt('ccReviewCalls', totals.calls);
            setTxt('ccReviewUnique', totals.uniquePatientsCalled);
            setTxt('ccReviewDates', totals.serviceDates);
            setTxt('ccReviewRepeats', totals.repeatCalls);
            setTxt('ccReviewEfficiency', ccMetricText(totals.efficiency, '%'));
            setTxt('ccReviewConversion', ccMetricText(totals.conversionRate, '%'));
            setTxt('ccReviewRepeatRate', ccMetricText(totals.repeatRate, '%'));
            setTxt('ccReviewCallsPerDate', ccMetricText(totals.callsPerServiceDate, ''));
            setTxt('ccReviewNotesPerCall', ccMetricText(totals.notesPerCall, ''));
            setTxt('ccReviewLastActivity', formatCcDateTime(totals.lastActionAt));
            if (data.range) setTxt('ccReviewRange', data.range.from === data.range.to ? data.range.from : data.range.from + ' to ' + data.range.to);
            populateCcHistoryUsers(data.history && data.history.users ? data.history.users : data.users);
            setTxt('ccReviewScope', _ccHistoryUserId ? ('Scope: ' + selectedCcHistoryUserLabel()) : 'Scope: All Users');
            renderCallCenterReviewCharts(data);

            var tbody = document.getElementById('ccReviewUsers');
            if (!tbody) return;
            var users = data.users || [];
            if (!users.length) {
                tbody.innerHTML = '<tr><td colspan="9" class="text-center text-muted">No call center activity for this range</td></tr>';
                return;
            }
            var html = '';
            for (var i = 0; i < users.length; i++) {
                var u = normalizeCcTotals(users[i] || {});
                u.user = users[i].user || 'User';
                u.lastActionAt = users[i].lastActionAt || null;
                html += '<tr>' +
                    '<td>' + _ccEsc(u.user || 'User') + '</td>' +
                    '<td class="text-end">' + (u.calls || 0) + '</td>' +
                    '<td class="text-end">' + (u.uniquePatientsCalled || 0) + '</td>' +
                    '<td class="text-end">' + (u.serviceDates || 0) + '</td>' +
                    '<td class="text-end">' + (u.notes || 0) + '</td>' +
                    '<td class="text-end">' + ccMetricText(u.efficiency, '%') + '</td>' +
                    '<td class="text-end">' + ccMetricText(u.conversionRate, '%') + '</td>' +
                    '<td class="text-end">' + ccMetricText(u.repeatRate, '%') + '</td>' +
                    '<td class="text-end">' + _ccEsc(formatCcDateTime(u.lastActionAt)) + '</td>' +
                    '</tr>';
            }
            tbody.innerHTML = html;
        });
    }).catch(function(e) {
        console.warn('Call Center metrics failed:', e);
    });
}

function ccDrilldownSummary(data) {
    var totals = data && data.totals ? data.totals : {};
    var parts = [];
    parts.push((totals.patients || 0) + ' patients');
    parts.push((totals.calls || 0) + ' calls');
    parts.push((totals.serviceDates || 0) + ' service dates');
    parts.push((totals.notes || 0) + ' notes');
    if (totals.repeatCalls) parts.push(totals.repeatCalls + ' repeat calls');
    return parts.join(' / ');
}

function ccDrilldownName(row) {
    row = row || {};
    return ((row.firstName || '') + ' ' + (row.lastName || '')).trim();
}

function ccDrilldownSortValue(row, key) {
    row = row || {};
    if (key === 'patientCode') return row.patientCode || ('PAT-' + row.id);
    if (key === 'name') return ccDrilldownName(row);
    if (key === 'phone') return row.phone || '';
    if (key === 'clinicName') return row.clinicName || '';
    if (key === 'serviceDate') return row.serviceDate || '';
    if (key === 'calls') return Number(row.calls || 0);
    if (key === 'repeatCalls') return Number(row.repeatCalls || 0);
    if (key === 'serviceDates') return Number(row.serviceDates || 0);
    if (key === 'notes') return Number(row.notes || 0);
    if (key === 'lastActionAt') return row.lastActionAt ? new Date(row.lastActionAt).getTime() : 0;
    return '';
}

function ccDrilldownDefaultSortDir(key) {
    return ['calls', 'repeatCalls', 'serviceDates', 'notes', 'lastActionAt', 'serviceDate'].indexOf(key) !== -1 ? 'desc' : 'asc';
}

function getSortedCallCenterDrilldownRows(data) {
    var rows = data && data.rows ? data.rows.slice() : [];
    if (!_ccDrilldownSort || !_ccDrilldownSort.key) return rows;
    var key = _ccDrilldownSort.key;
    var dir = _ccDrilldownSort.dir === 'desc' ? -1 : 1;
    rows.sort(function(a, b) {
        var av = ccDrilldownSortValue(a, key);
        var bv = ccDrilldownSortValue(b, key);
        if (typeof av === 'number' || typeof bv === 'number') {
            av = Number(av || 0);
            bv = Number(bv || 0);
            return (av - bv) * dir;
        }
        av = String(av || '').toLowerCase();
        bv = String(bv || '').toLowerCase();
        if (av < bv) return -1 * dir;
        if (av > bv) return 1 * dir;
        return 0;
    });
    return rows;
}

function ccDrilldownSortIcon(key) {
    if (!_ccDrilldownSort || _ccDrilldownSort.key !== key) return '<i class="fas fa-sort"></i>';
    return _ccDrilldownSort.dir === 'desc' ? '<i class="fas fa-sort-down"></i>' : '<i class="fas fa-sort-up"></i>';
}

function ccDrilldownHeader(label, key, className) {
    var active = _ccDrilldownSort && _ccDrilldownSort.key === key ? ' active' : '';
    return '<th class="' + (className || '') + '"><button class="cc-drill-sort' + active + '" type="button" data-cc-drill-sort="' + _ccEsc(key) + '">' + _ccEsc(label) + ccDrilldownSortIcon(key) + '</button></th>';
}

function ccHistoryLine(kind, item) {
    item = item || {};
    var when = formatCcDateTime(item.at);
    var user = item.user || '';
    if (kind === 'note') {
        return when + (user ? ' - ' + user : '') + ': ' + (item.note || '');
    }
    if (kind === 'serviceDate') {
        return when + (user ? ' - ' + user : '') + (item.serviceDate ? ' -> ' + item.serviceDate : '');
    }
    return when + (user ? ' - ' + user : '');
}

function ccHistoryCsv(items, kind) {
    items = items || [];
    var parts = [];
    for (var i = 0; i < items.length; i++) parts.push(ccHistoryLine(kind, items[i]));
    return parts.join(' | ');
}

function ccHistoryHtml(items, kind) {
    items = items || [];
    if (!items.length) return '<div class="text-muted">--</div>';
    var html = '';
    for (var i = 0; i < items.length; i++) {
        html += '<div class="mb-1">' + _ccEsc(ccHistoryLine(kind, items[i])) + '</div>';
    }
    return html;
}

function renderCcPatientHistory(row) {
    row = row || {};
    return '<tr class="cc-drill-history-row"><td colspan="10">' +
        '<div class="cc-drill-history-grid">' +
            '<div class="cc-drill-history-box">' +
                '<div class="cc-drill-history-title"><i class="fas fa-phone-alt me-1 text-info"></i>Call History</div>' +
                '<div class="cc-drill-history-list">' + ccHistoryHtml(row.callHistory || [], 'call') + '</div>' +
            '</div>' +
            '<div class="cc-drill-history-box">' +
                '<div class="cc-drill-history-title"><i class="fas fa-calendar-plus me-1 text-success"></i>Service Date History</div>' +
                '<div class="cc-drill-history-list">' + ccHistoryHtml(row.serviceDateHistory || [], 'serviceDate') + '</div>' +
            '</div>' +
            '<div class="cc-drill-history-box">' +
                '<div class="cc-drill-history-title"><i class="fas fa-sticky-note me-1 text-warning"></i>Call Center Notes</div>' +
                '<div class="cc-drill-history-list">' + ccHistoryHtml(row.noteHistory || [], 'note') + '</div>' +
            '</div>' +
        '</div>' +
        '</td></tr>';
}

function bindCallCenterDrilldownSort() {
    var buttons = document.querySelectorAll('.cc-drill-sort[data-cc-drill-sort]');
    for (var i = 0; i < buttons.length; i++) {
        (function(btn) {
            btn.addEventListener('click', function() {
                var key = btn.getAttribute('data-cc-drill-sort') || '';
                if (!key) return;
                if (_ccDrilldownSort.key === key) {
                    _ccDrilldownSort.dir = _ccDrilldownSort.dir === 'desc' ? 'asc' : 'desc';
                } else {
                    _ccDrilldownSort.key = key;
                    _ccDrilldownSort.dir = ccDrilldownDefaultSortDir(key);
                }
                if (window._lastCallCenterDrilldownData) renderCallCenterDrilldown(window._lastCallCenterDrilldownData);
            });
        })(buttons[i]);
    }
}

function renderCallCenterDrilldown(data) {
    var rows = getSortedCallCenterDrilldownRows(data);
    var titleEl = document.getElementById('drilldownTitle');
    var bodyEl = document.getElementById('drilldownBody');
    var fullBtn = document.getElementById('drilldownFullPageBtn');
    var exportBtn = document.getElementById('ccDrilldownExportBtn');
    if (titleEl) titleEl.textContent = data && data.title ? data.title : 'Call Center Patients';
    if (fullBtn) fullBtn.classList.add('d-none');
    if (exportBtn) exportBtn.classList.remove('d-none');
    if (!bodyEl) return;

    var rangeText = data && data.range ? (data.range.from === data.range.to ? data.range.from : data.range.from + ' to ' + data.range.to) : '';
    var userText = selectedCcHistoryUserLabel();
    var html = '<div class="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">' +
        '<div><div class="small text-muted">' + _ccEsc(data.description || '') + '</div>' +
        '<div class="small text-muted">Scope: ' + _ccEsc(userText) + (rangeText ? ' / ' + _ccEsc(rangeText) : '') + '</div></div>' +
        '<span class="badge bg-secondary">' + _ccEsc(ccDrilldownSummary(data)) + '</span>' +
        '</div>';

    if (!rows.length) {
        bodyEl.innerHTML = html + '<div class="text-center text-muted py-4">No patients found for this card and range.</div>';
        return;
    }

    html += '<div class="table-responsive"><table class="table table-sm table-hover align-middle mb-0">' +
        '<thead><tr>' +
        ccDrilldownHeader('Patient ID', 'patientCode') +
        ccDrilldownHeader('Name', 'name') +
        ccDrilldownHeader('Phone', 'phone') +
        ccDrilldownHeader('Clinic', 'clinicName') +
        ccDrilldownHeader('Service Date', 'serviceDate') +
        ccDrilldownHeader('Calls', 'calls', 'text-end') +
        ccDrilldownHeader('Repeat', 'repeatCalls', 'text-end') +
        ccDrilldownHeader('Dates', 'serviceDates', 'text-end') +
        ccDrilldownHeader('Notes', 'notes', 'text-end') +
        ccDrilldownHeader('Last Activity', 'lastActionAt') +
        '</tr></thead><tbody>';
    for (var i = 0; i < rows.length; i++) {
        var r = rows[i] || {};
        var name = ccDrilldownName(r);
        html += '<tr>' +
            '<td class="fw-semibold">' + _ccEsc(r.patientCode || ('PAT-' + r.id)) + '</td>' +
            '<td>' + _ccEsc(name || '--') + '</td>' +
            '<td>' + _ccEsc(r.phone || '--') + '</td>' +
            '<td>' + _ccEsc(r.clinicName || '--') + '</td>' +
            '<td>' + _ccEsc(r.serviceDate || '--') + '</td>' +
            '<td class="text-end">' + _ccEsc(r.calls || 0) + '</td>' +
            '<td class="text-end">' + _ccEsc(r.repeatCalls || 0) + '</td>' +
            '<td class="text-end">' + _ccEsc(r.serviceDates || 0) + '</td>' +
            '<td class="text-end">' + _ccEsc(r.notes || 0) + '</td>' +
            '<td><div>' + _ccEsc(formatCcDateTime(r.lastActionAt)) + '</div>' +
                '<small class="text-muted">' + _ccEsc(r.lastActionBy || '') + '</small></td>' +
            '</tr>';
        html += renderCcPatientHistory(r);
    }
    html += '</tbody></table></div>';
    bodyEl.innerHTML = html;
    bindCallCenterDrilldownSort();
}

function ccDrilldownFilename(data) {
    var title = data && data.title ? data.title : 'call_center_patients';
    var metric = data && data.metric ? data.metric : 'drilldown';
    var cleanTitle = String(title).replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').toLowerCase() || 'call_center';
    return cleanTitle + '_' + metric + '_' + new Date().toISOString().slice(0,10) + '.csv';
}

function exportCallCenterDrilldownCsv() {
    var data = window._lastCallCenterDrilldownData || {};
    var rows = getSortedCallCenterDrilldownRows(data);
    if (!rows.length) {
        showToast('No Call Center patients to export.', 'warning');
        return;
    }
    var rangeText = data.range ? (data.range.from === data.range.to ? data.range.from : data.range.from + ' to ' + data.range.to) : '';
    var scopeText = selectedCcHistoryUserLabel();
    var csvRows = [];
    for (var i = 0; i < rows.length; i++) {
        var r = rows[i] || {};
        var name = ((r.firstName || '') + ' ' + (r.lastName || '')).trim();
        csvRows.push([
            data.title || '',
            rangeText,
            scopeText,
            r.patientCode || ('PAT-' + r.id),
            name,
            r.phone || '',
            r.clinicName || '',
            r.serviceDate || '',
            r.calls || 0,
            r.repeatCalls || 0,
            r.serviceDates || 0,
            r.notes || 0,
            formatCcDateTime(r.lastActionAt),
            r.lastActionBy || '',
            ccHistoryCsv(r.callHistory || [], 'call'),
            ccHistoryCsv(r.serviceDateHistory || [], 'serviceDate'),
            ccHistoryCsv(r.noteHistory || [], 'note')
        ]);
    }
    exportToCsv(
        ccDrilldownFilename(data),
        ['Drilldown', 'Range', 'Scope', 'Patient ID', 'Name', 'Phone', 'Clinic', 'Service Date', 'Calls', 'Repeat Calls', 'Service Dates', 'Notes', 'Last Activity', 'Last Activity By', 'Call History', 'Service Date History', 'Call Center Notes'],
        csvRows
    );
}

function openCallCenterReviewDrilldown(metric) {
    if (!_api.ccDrill) return;
    var bodyEl = document.getElementById('drilldownBody');
    var titleEl = document.getElementById('drilldownTitle');
    var fullBtn = document.getElementById('drilldownFullPageBtn');
    var exportBtn = document.getElementById('ccDrilldownExportBtn');
    window._lastCallCenterDrilldownData = null;
    _ccDrilldownSort = { key: '', dir: 'asc' };
    if (titleEl) titleEl.textContent = 'Call Center Patients';
    if (fullBtn) fullBtn.classList.add('d-none');
    if (exportBtn) exportBtn.classList.add('d-none');
    if (bodyEl) bodyEl.innerHTML = '<p class="text-center text-muted py-4"><i class="fas fa-spinner fa-spin me-2"></i>Loading patients...</p>';
    if (!drilldownModal) drilldownModal = new bootstrap.Modal(document.getElementById('drilldownModal'));
    drilldownModal.show();

    fetchWithAuth(_api.ccDrill + buildCallCenterDrilldownQuery(metric), { silent: true }).then(function(res) {
        if (!res || !res.ok) throw new Error('Failed');
        return res.json();
    }).then(function(data) {
        window._lastCallCenterDrilldownData = data;
        drilldownCurrentData = data.rows || [];
        renderCallCenterDrilldown(data);
    }).catch(function() {
        if (bodyEl) bodyEl.innerHTML = '<div class="text-center text-danger py-4">Could not load Call Center patients.</div>';
    });
}

function initCallCenterDrilldownCards() {
    var cards = document.querySelectorAll('.cc-kpi-clickable[data-cc-drilldown]');
    var exportBtn = document.getElementById('ccDrilldownExportBtn');
    if (exportBtn) exportBtn.addEventListener('click', exportCallCenterDrilldownCsv);
    for (var i = 0; i < cards.length; i++) {
        (function(card) {
            card.addEventListener('click', function() {
                openCallCenterReviewDrilldown(card.getAttribute('data-cc-drilldown') || 'calls');
            });
            card.addEventListener('keydown', function(e) {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    openCallCenterReviewDrilldown(card.getAttribute('data-cc-drilldown') || 'calls');
                }
            });
        })(cards[i]);
    }
}

function ccSeriesValue(series, key, index) {
    if (!series || !series[key] || typeof series[key].length !== 'number') return 0;
    var value = series[key][index];
    if (value === '' || value === null || value === undefined) return 0;
    var num = Number(value);
    return isNaN(num) ? 0 : num;
}

function exportCallCenterReviewCsv() {
    var data = window._lastCallCenterReviewData;
    var history = data && data.history ? data.history : null;
    var series = history && history.series ? history.series : null;
    var labels = series && series.labels ? series.labels : [];
    if (!labels.length) {
        showToast('No Call Center history to export.', 'warning');
        return;
    }
    var userSelect = document.getElementById('ccHistoryUser');
    var userLabel = userSelect && userSelect.value ? userSelect.options[userSelect.selectedIndex].text : 'All Users Combined';
    var rows = [];
    for (var i = 0; i < labels.length; i++) {
        rows.push([
            labels[i] || '',
            userLabel,
            ccSeriesValue(series, 'calls', i),
            ccSeriesValue(series, 'uniquePatientsCalled', i),
            ccSeriesValue(series, 'serviceDates', i),
            ccSeriesValue(series, 'repeatCalls', i),
            ccSeriesValue(series, 'notes', i),
            ccSeriesValue(series, 'efficiency', i),
            ccSeriesValue(series, 'conversionRate', i),
            ccSeriesValue(series, 'repeatRate', i),
            ccSeriesValue(series, 'callsPerServiceDate', i),
            ccSeriesValue(series, 'notesPerCall', i)
        ]);
    }
    var cleanUser = userLabel.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'combined';
    exportToCsv(
        'call_center_metrics_' + cleanUser + '_' + new Date().toISOString().slice(0,10) + '.csv',
        ['Date', 'User Filter', 'Calls', 'Patients Called', 'Service Dates', 'Repeat Calls', 'Notes', 'Efficiency %', 'Conversion %', 'Repeat Rate %', 'Calls / Service Date', 'Notes / Call'],
        rows
    );
}

function initCallCenterReviewControls() {
    var savedType = localStorage.getItem('rxCcHistoryChartType');
    if (savedType === 'bar' || savedType === 'line') _ccHistoryChartType = savedType;

    var rangeBtns = document.querySelectorAll('.cc-history-range-btn');
    for (var i = 0; i < rangeBtns.length; i++) {
        (function(btn) {
            btn.addEventListener('click', function() {
                setCcHistoryPreset(btn.getAttribute('data-cc-history-range') || '30d');
            });
        })(rangeBtns[i]);
    }

    var typeEl = document.getElementById('ccHistoryChartType');
    if (typeEl) {
        typeEl.value = _ccHistoryChartType;
        typeEl.addEventListener('change', function() {
            _ccHistoryChartType = this.value === 'bar' ? 'bar' : 'line';
            localStorage.setItem('rxCcHistoryChartType', _ccHistoryChartType);
            if (window._lastCallCenterReviewData) renderCallCenterReviewCharts(window._lastCallCenterReviewData);
        });
    }

    var userEl = document.getElementById('ccHistoryUser');
    if (userEl) {
        userEl.addEventListener('change', function() {
            _ccHistoryUserId = this.value || '';
            loadCallCenterReviewMetrics();
        });
    }

    var fromEl = document.getElementById('ccHistoryFrom');
    var toEl = document.getElementById('ccHistoryTo');
    if (fromEl) {
        fromEl.addEventListener('change', function() {
            if (!validateCcHistoryRange()) return;
            _ccHistoryFrom = this.value;
            _ccHistoryTo = toEl ? toEl.value : '';
            _ccHistoryPreset = 'custom';
            syncCcHistoryUi();
        });
    }
    if (toEl) {
        toEl.addEventListener('change', function() {
            if (!validateCcHistoryRange()) return;
            _ccHistoryFrom = fromEl ? fromEl.value : '';
            _ccHistoryTo = this.value;
            _ccHistoryPreset = 'custom';
            syncCcHistoryUi();
        });
    }

    var applyBtn = document.getElementById('ccHistoryApplyBtn');
    if (applyBtn) {
        applyBtn.addEventListener('click', function() {
            if (!validateCcHistoryRange()) return;
            _ccHistoryFrom = fromEl ? fromEl.value : '';
            _ccHistoryTo = toEl ? toEl.value : '';
            if (_ccHistoryFrom || _ccHistoryTo) {
                _ccHistoryPreset = 'custom';
            } else if (_ccHistoryPreset === 'custom') {
                _ccHistoryPreset = '30d';
            }
            syncCcHistoryUi();
            loadCallCenterReviewMetrics();
        });
    }

    var exportBtn = document.getElementById('ccHistoryExportBtn');
    if (exportBtn) exportBtn.addEventListener('click', exportCallCenterReviewCsv);

    setCcHistoryPreset('30d');
}

// =====================================================================
// 90-Day Eligibility Widget
// =====================================================================
var _eligData = null;

// Count-up animation — FortiGate-safe (no arrow funcs, no const/let)
function countUp(elId, target, duration) {
    var el = document.getElementById(elId);
    if (!el) return;
    if (target === 0) { el.textContent = '0'; return; }
    var start   = 0;
    var steps   = Math.max(1, Math.ceil(duration / 30));
    var stepVal = Math.ceil(target / steps);
    var timer   = setInterval(function() {
        start += stepVal;
        if (start >= target) { start = target; clearInterval(timer); }
        el.textContent = start;
    }, 30);
}

// Navigate to patients page with a specific eligibility filter pre-applied
// (still kept as fallback from the drilldown modal's "Open Full Page" button)
function goEligFilter(filter) {
    var base = window._patientsUrl || '/patients';
    window.location.href = base + '?eligFilter=' + filter;
}

// =====================================================================
// Eligibility Drilldown — popup same as top stat cards, then full-page link
// =====================================================================
function openEligDrilldown(filter) {
    var titles = {
        'eligible': 'Eligible Now — ' + (Number(window.SERVICE_WINDOW_DAYS) || 90) + '-Day Window Expired',
        'expiring': 'Call Pre-Eligibility — Final ' + (Number(window.CALL_CENTER_LEAD_DAYS) || 0) + ' Days',
        'window':   'In Active ' + (Number(window.SERVICE_WINDOW_DAYS) || 90) + '-Day Window',
        'none':     'No Service Date Set'
    };
    var pageLinks = {
        'eligible': document.getElementById('xl-elig-eligible'),
        'expiring': document.getElementById('xl-elig-expiring'),
        'window':   document.getElementById('xl-elig-window'),
        'none':     document.getElementById('xl-elig-none')
    };
    var icons = {
        'eligible': 'fa-check-circle',
        'expiring': 'fa-hourglass-half',
        'window':   'fa-lock',
        'none':     'fa-calendar-times'
    };
    var colors = {
        'eligible': '#198754',
        'expiring': '#dc3545',
        'window':   '#4a90e2',
        'none':     '#6c757d'
    };

    var plEl = pageLinks[filter];
    window.location.href = plEl ? plEl.href : '/patients';
}

function loadEligibility() {
    var luEl = document.getElementById('eligLastUpdated');
    if (luEl) luEl.textContent = 'Loading\u2026';
    if (!_api.elig) return;
    fetchWithAuth(_api.elig).then(function(res) {
        if (!res || !res.ok) throw new Error('Failed');
        return res.json();
    }).then(function(d) {
        _eligData = d;
        // Animate each counter in with count-up effect
        countUp('eligNowCount',      d.eligibleNow   || 0, 600);
        countUp('eligExpiringCount', d.expiringIn7   || 0, 600);
        countUp('eligInWindowCount', d.inWindow      || 0, 600);
        countUp('eligNoDateCount',   d.noServiceDate || 0, 600);
        if (luEl) luEl.textContent = 'Updated ' + new Date().toLocaleTimeString();
    }).catch(function() {
        if (luEl) luEl.textContent = 'Load failed';
    });
}

// =====================================================================
// RX Pipeline
// =====================================================================
function loadRxPipeline() {
    var stepsEl = document.getElementById('rxPipelineSteps');
    var luEl    = document.getElementById('rxPipelineLastUpdated');
    if (!stepsEl) return;
    stepsEl.innerHTML = '<div class="text-muted text-center py-3"><i class="fas fa-spinner fa-spin me-2"></i>Loading...</div>';

    fetchWithAuth(_api.rxp).then(function(res) {
        if (!res || !res.ok) throw new Error('Failed');
        return res.json();
    }).then(function(d) {
        var safe = function(v) { return (v !== undefined && v !== null) ? v : 0; };
        var setTxt = function(id, val) { var el = document.getElementById(id); if (el) el.textContent = val; };
        setTxt('rxPipelineNotStarted', safe(d.notStarted));
        setTxt('rxPipelineInProgress', safe(d.inProgress));
        setTxt('rxPipelineCompleted',  safe(d.completed));

        var pct = d.total > 0 ? Math.round((d.completed / d.total) * 100) : 0;
        setTxt('rxPipelinePercent', pct + '% complete');
        var bar = document.getElementById('rxPipelineProgressBar');
        if (bar) bar.style.width = pct + '%';
        if (luEl) luEl.textContent = 'Updated ' + new Date().toLocaleTimeString();

        var COLORS = ['#4a90e2','#7b61ff','#fd7e14','#20c997','#e24a9a','#50e3c2','#f5a623'];
        if (!d.stepBreakdown || !d.stepBreakdown.length) {
            stepsEl.innerHTML = '<p class="text-muted text-center small py-2">No workflow steps configured yet.</p>';
            return;
        }

        var stepsHtml = '<div style="font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#888;margin-bottom:10px">Workflow Step Breakdown &mdash; RX records waiting at each step</div>' +
            '<div style="display:flex;flex-direction:column;gap:8px">';
        for (var si = 0; si < d.stepBreakdown.length; si++) {
            var step  = d.stepBreakdown[si];
            var color = COLORS[si % COLORS.length];
            var barPct = d.inProgress > 0 ? Math.round((step.count / d.inProgress) * 100) : 0;
            stepsHtml += '<div style="display:flex;align-items:center;gap:12px">' +
                '<div style="flex-shrink:0;width:22px;height:22px;border-radius:50%;background:' + color + '22;display:flex;align-items:center;justify-content:center;font-size:.65rem;font-weight:700;color:' + color + '">' + (si + 1) + '</div>' +
                '<div style="flex-shrink:0;width:160px;font-size:.82rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="' + (step.name || '') + '">' + (step.name || '') + '</div>' +
                '<div style="flex:1;height:8px;border-radius:4px;background:rgba(0,0,0,.07);overflow:hidden">' +
                    '<div style="height:100%;border-radius:4px;background:' + color + ';width:' + barPct + '%;transition:width .5s ease"></div>' +
                '</div>' +
                '<div style="flex-shrink:0;width:32px;text-align:right;font-size:.82rem;font-weight:600;color:' + color + '">' + step.count + '</div>' +
                '</div>';
        }
        stepsHtml += '</div>';

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
    }).catch(function() {
        stepsEl.innerHTML = '<p class="text-danger text-center small py-2"><i class="fas fa-exclamation-triangle me-1"></i>Could not load pipeline data.</p>';
    });
}

// =====================================================================
// Charts
// =====================================================================
function renderCharts(data) {
    var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    var tc = isDark ? '#c9d1d9' : '#444';
    var gc = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)';
    Chart.defaults.color = tc;

    var patientsBarCanvas = document.getElementById('patientsBarChart');
    var rxDonutCanvas = document.getElementById('rxDonutChart');
    var pTrend = document.getElementById('patientsTrendChart');
    var wTrend = document.getElementById('workflowTrendChart');
    var eTrend = document.getElementById('eligibilityTrendChart');
    var wcTrend = document.getElementById('workflowCompletionTrendChart');
    var svcTrend = document.getElementById('serviceDateTrendChart');
    if (patientsBarCanvas && Chart.getChart(patientsBarCanvas)) Chart.getChart(patientsBarCanvas).destroy();
    if (rxDonutCanvas && Chart.getChart(rxDonutCanvas)) Chart.getChart(rxDonutCanvas).destroy();
    if (pTrend && Chart.getChart(pTrend)) Chart.getChart(pTrend).destroy();
    if (wTrend && Chart.getChart(wTrend)) Chart.getChart(wTrend).destroy();
    if (eTrend && Chart.getChart(eTrend)) Chart.getChart(eTrend).destroy();
    if (wcTrend && Chart.getChart(wcTrend)) Chart.getChart(wcTrend).destroy();
    if (svcTrend && Chart.getChart(svcTrend)) Chart.getChart(svcTrend).destroy();

    var cardTotals = data.cardTotals || { labels: [], data: [] };
    new Chart(patientsBarCanvas.getContext('2d'), {
        type: 'bar',
        data: {
            labels: cardTotals.labels,
            datasets: [{ label: 'Current Total', data: cardTotals.data,
                backgroundColor: [
                    'rgba(25,135,84,0.75)',
                    'rgba(220,53,69,0.75)',
                    'rgba(74,144,226,0.75)',
                    'rgba(245,166,35,0.78)',
                    'rgba(155,89,182,0.75)'
                ],
                borderColor: [
                    'rgba(25,135,84,1)',
                    'rgba(220,53,69,1)',
                    'rgba(74,144,226,1)',
                    'rgba(245,166,35,1)',
                    'rgba(155,89,182,1)'
                ],
                borderWidth: 1, borderRadius: 6 }]
        },
        options: { responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { grid: { color: gc }, ticks: { color: tc } },
                y: { grid: { color: gc }, ticks: { color: tc, stepSize: 1, precision: 0 }, beginAtZero: true }
            }
        }
    });

    var rxData = data.rxStatus;
    var total  = 0;
    for (var ri = 0; ri < rxData.data.length; ri++) { total += rxData.data[ri]; }
    new Chart(rxDonutCanvas.getContext('2d'), {
        type: 'doughnut',
        data: {
            labels: rxData.labels,
            datasets: [{
                data:            total > 0 ? rxData.data : [1],
                backgroundColor: total > 0 ? ['rgba(80,227,194,0.85)','rgba(245,166,35,0.85)'] : ['rgba(150,150,150,0.3)'],
                borderWidth: 2,
                borderColor: isDark ? '#1a1f2e' : '#fff'
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false, cutout: '68%',
            plugins: {
                legend: { position: 'bottom', labels: { color: tc, padding: 14, font: { size: 13 } } },
                tooltip: { callbacks: { label: function(ctx) {
                    return total > 0 ? ' ' + ctx.label + ': ' + ctx.raw + ' (' + Math.round(ctx.raw / total * 100) + '%)' : ' No RX records yet';
                }}}
            }
        }
    });

    var hasTrendData = false;
    if (data.dailyTrends && data.dailyTrends.labels && data.dailyTrends.labels.length) {
        var trendKeys = ['activePatients','inactivePatients','newPatientsToday','rxRecords','newRXToday','pendingDeliveries','completedRX','patientsWithNoRx','eligibleNow','expiringIn7','inWindow','noServiceDate','workflowStepsCompletedDaily','workflowStepsToday','workflowCompletionRate','serviceDateEntries'];
        for (var hk = 0; hk < trendKeys.length; hk++) {
            var series = data.dailyTrends[trendKeys[hk]];
            if (series && series.length) {
                hasTrendData = true;
                break;
            }
        }
    }

    if (data.dailyTrends && hasTrendData) {
        var trendLabels = data.dailyTrends.labels || [];
        var trendColors = {
            active: 'rgba(25,135,84,0.85)',
            inactive: 'rgba(220,53,69,0.85)',
            rx: 'rgba(74,144,226,0.85)',
            pending: 'rgba(245,166,35,0.85)',
            completed: 'rgba(80,227,194,0.85)',
            norx: 'rgba(155,89,182,0.85)',
            eligible: 'rgba(255,193,7,0.9)',
            expiring: 'rgba(253,126,20,0.9)',
            window: 'rgba(32,201,151,0.85)',
            nodate: 'rgba(108,117,125,0.85)',
            rate: 'rgba(13,110,253,0.9)',
            newEntry: 'rgba(111,66,193,0.9)',
            changes: 'rgba(32,201,151,0.85)'
        };
        var trendType = _trendChartType === 'bar' ? 'bar' : 'line';
        var pointRadius = trendType === 'bar' ? 0 : 1.5;
        var lineTension = trendType === 'bar' ? 0 : 0.25;
        var baseTrendOptions = function(percentAxis, activityAxis) {
            var scales = {
                x: { grid: { color: gc }, ticks: { color: tc, maxRotation: 0, autoSkip: true } },
                y: { grid: { color: gc }, ticks: { color: tc, precision: 0 }, beginAtZero: true, suggestedMax: percentAxis ? 100 : undefined }
            };
            if (activityAxis) {
                scales.yActivity = {
                    position: 'right',
                    grid: { drawOnChartArea: false },
                    ticks: { color: tc, precision: 0 },
                    beginAtZero: true
                };
            }
            return {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: { legend: { position: 'bottom' } },
                scales: scales
            };
        };

        if (pTrend) {
            new Chart(pTrend.getContext('2d'), {
                type: trendType,
                data: {
                    labels: trendLabels,
                    datasets: [
                        { label: 'Active Patients', data: data.dailyTrends.activePatients || [], borderColor: trendColors.active, backgroundColor: trendColors.active, tension: lineTension, fill: false, pointRadius: pointRadius },
                        { label: 'Inactive Patients', data: data.dailyTrends.inactivePatients || [], borderColor: trendColors.inactive, backgroundColor: trendColors.inactive, tension: lineTension, fill: false, pointRadius: pointRadius },
                        { label: 'New Patients', data: data.dailyTrends.newPatientsToday || [], borderColor: trendColors.newEntry, backgroundColor: trendColors.newEntry, tension: lineTension, fill: false, pointRadius: pointRadius, yAxisID: 'yActivity' },
                        { label: 'Service Date Entries', data: data.dailyTrends.serviceDateEntries || [], borderColor: trendColors.changes, backgroundColor: trendColors.changes, tension: lineTension, fill: false, pointRadius: pointRadius, yAxisID: 'yActivity' },
                        { label: 'Patients With No RX', data: data.dailyTrends.patientsWithNoRx || [], borderColor: trendColors.norx, backgroundColor: trendColors.norx, tension: lineTension, fill: false, pointRadius: pointRadius }
                    ]
                },
                options: baseTrendOptions(false, true)
            });
        }

        if (wTrend) {
            new Chart(wTrend.getContext('2d'), {
                type: trendType,
                data: {
                    labels: trendLabels,
                    datasets: [
                        { label: 'Total RX Records', data: data.dailyTrends.rxRecords || [], borderColor: trendColors.rx, backgroundColor: trendColors.rx, tension: lineTension, fill: false, pointRadius: pointRadius },
                        { label: 'New RX Records', data: data.dailyTrends.newRXToday || [], borderColor: trendColors.newEntry, backgroundColor: trendColors.newEntry, tension: lineTension, fill: false, pointRadius: pointRadius, yAxisID: 'yActivity' },
                        { label: 'Pending Deliveries', data: data.dailyTrends.pendingDeliveries || [], borderColor: trendColors.pending, backgroundColor: trendColors.pending, tension: lineTension, fill: false, pointRadius: pointRadius },
                        { label: 'Completed RX', data: data.dailyTrends.completedRX || [], borderColor: trendColors.completed, backgroundColor: trendColors.completed, tension: lineTension, fill: false, pointRadius: pointRadius }
                    ]
                },
                options: baseTrendOptions(false, true)
            });
        }

        if (eTrend) {
            new Chart(eTrend.getContext('2d'), {
                type: trendType,
                data: {
                    labels: trendLabels,
                    datasets: [
                        { label: 'Eligible Now', data: data.dailyTrends.eligibleNow || [], borderColor: trendColors.eligible, backgroundColor: trendColors.eligible, tension: lineTension, fill: false, pointRadius: pointRadius },
                        { label: '7 Days Left', data: data.dailyTrends.expiringIn7 || [], borderColor: trendColors.expiring, backgroundColor: trendColors.expiring, tension: lineTension, fill: false, pointRadius: pointRadius },
                        { label: 'Active Window', data: data.dailyTrends.inWindow || [], borderColor: trendColors.window, backgroundColor: trendColors.window, tension: lineTension, fill: false, pointRadius: pointRadius },
                        { label: 'No Service Date', data: data.dailyTrends.noServiceDate || [], borderColor: trendColors.nodate, backgroundColor: trendColors.nodate, tension: lineTension, fill: false, pointRadius: pointRadius }
                    ]
                },
                options: baseTrendOptions(false)
            });
        }

        if (wcTrend) {
            new Chart(wcTrend.getContext('2d'), {
                type: trendType,
                data: {
                    labels: trendLabels,
                    datasets: [
                        { label: 'Completion Rate %', data: data.dailyTrends.workflowCompletionRate || [], borderColor: trendColors.rate, backgroundColor: trendColors.rate, tension: lineTension, fill: false, pointRadius: pointRadius },
                        { label: 'Workflow Steps Completed', data: data.dailyTrends.workflowStepsCompletedDaily || data.dailyTrends.workflowStepsToday || [], borderColor: trendColors.completed, backgroundColor: trendColors.completed, tension: lineTension, fill: false, pointRadius: pointRadius, yAxisID: 'yActivity' }
                    ]
                },
                options: baseTrendOptions(true, true)
            });
        }

        var svcTrend = document.getElementById('serviceDateTrendChart');
        if (svcTrend) {
            new Chart(svcTrend.getContext('2d'), {
                type: trendType,
                data: {
                    labels: trendLabels,
                    datasets: [
                        { label: 'Service Date Entries', data: data.dailyTrends.serviceDateEntries || data.dailyTrends.serviceDateChanges || [], borderColor: trendColors.changes, backgroundColor: trendColors.changes, tension: lineTension, fill: false, pointRadius: pointRadius }
                    ]
                },
                options: baseTrendOptions(false)
            });
        }

    } else {
        var trendCards = [
            document.getElementById('patientsTrendChart'),
            document.getElementById('workflowTrendChart'),
            document.getElementById('eligibilityTrendChart'),
            document.getElementById('workflowCompletionTrendChart'),
            document.getElementById('serviceDateTrendChart')
        ];
        var msg = data.trendWarning || 'Trend charts are unavailable until the snapshot migration is applied.';
        if (data.dailyTrends && !hasTrendData) {
            msg = 'Trend data is empty for the selected range.';
        }
        for (var ti = 0; ti < trendCards.length; ti++) {
            var canvas = trendCards[ti];
            if (!canvas) continue;
            var wrap = canvas.parentNode;
            if (!wrap) continue;
            if (Chart.getChart(canvas)) Chart.getChart(canvas).destroy();
            wrap.innerHTML = '<div class="d-flex align-items-center justify-content-center text-center h-100" style="min-height:220px;color:#8b949e">' +
                '<div><i class="fas fa-database me-2 text-warning"></i><div class="small fw-semibold">' + msg + '</div></div></div>';
        }
    }
}

// =====================================================================
// Drilldown modal
// =====================================================================
function openDrilldown(type) {
    drilldownType = type;
    drilldownCurrentData = [];

    var titles = {
        'active-patients':   'Active Patients',
        'inactive-patients': 'Inactive Patients',
        'total-rx':          'All RX Records',
        'pending-rx':        'Pending RX Records (Incomplete Workflow)',
        'patients-no-rx':    'Active Patients with No RX Records'
    };
    var idMap = {
        'active-patients':   'xl-patients-active',
        'inactive-patients': 'xl-patients-inactive',
        'total-rx':          'xl-rx-records',
        'pending-rx':        'xl-rx-records-pending',
        'patients-no-rx':    'xl-patients-norx'
    };
    function getPageLink(t) {
        var lid = idMap[t];
        if (!lid) return '#';
        var el = document.getElementById(lid);
        return el ? el.href : '#';
    }

    var dest = getPageLink(type);
    if (dest && dest !== '#') window.location.href = dest;
}

function exportRecentActivity() {
    var rows = [];
    var trs  = document.querySelectorAll('#recentActivityBody tr');
    for (var i = 0; i < trs.length; i++) {
        var c = trs[i].querySelectorAll('td');
        if (c.length >= 4) rows.push([c[0].textContent.trim(), c[1].textContent.trim(), c[2].textContent.trim(), c[3].textContent.trim(), c[4] ? c[4].textContent.trim() : '']);
    }
    if (!rows.length) { showToast('No activity to export', 'warning'); return; }
    exportToCsv('recent_activity_' + new Date().toISOString().slice(0,10) + '.csv', ['User','Module','Action','Date','IP Address'], rows);
    showToast('Recent activity exported!', 'success');
}

function trendSeriesValue(series, index) {
    if (!series || typeof series.length !== 'number' || index < 0 || index >= series.length) return 0;
    var value = series[index];
    if (value === '' || value === null || value === undefined) return 0;
    var num = Number(value);
    return isNaN(num) ? 0 : num;
}

function buildTrendExportRows(dailyTrends) {
    var labels = dailyTrends && dailyTrends.labels ? dailyTrends.labels : [];
    var rows = [];
    for (var i = 0; i < labels.length; i++) {
        rows.push([
            labels[i] || '',
            trendSeriesValue(dailyTrends.activePatients, i),
            trendSeriesValue(dailyTrends.inactivePatients, i),
            trendSeriesValue(dailyTrends.newPatientsToday, i),
            trendSeriesValue(dailyTrends.rxRecords, i),
            trendSeriesValue(dailyTrends.newRXToday, i),
            trendSeriesValue(dailyTrends.pendingDeliveries, i),
            trendSeriesValue(dailyTrends.completedRX, i),
            trendSeriesValue(dailyTrends.patientsWithNoRx, i),
            trendSeriesValue(dailyTrends.eligibleNow, i),
            trendSeriesValue(dailyTrends.expiringIn7, i),
            trendSeriesValue(dailyTrends.inWindow, i),
            trendSeriesValue(dailyTrends.noServiceDate, i),
            trendSeriesValue(dailyTrends.workflowCompletionRate, i),
            trendSeriesValue(dailyTrends.workflowStepsCompletedDaily || dailyTrends.workflowStepsToday, i),
            trendSeriesValue(dailyTrends.serviceDateEntries || dailyTrends.serviceDateChanges, i)
        ]);
    }
    return rows;
}

function exportTrendCsv() {
    var headers = [
        'Date',
        'Active Patients',
        'Inactive Patients',
        'New Patients',
        'Total RX Records',
        'New RX Records',
        'Pending Deliveries',
        'Completed RX',
        'Patients With No RX',
        'Eligible Now',
        '7 Days Left',
        'Active Window',
        'No Service Date',
        'Workflow Completion Rate',
        'Workflow Steps Completed',
        'Service Date Entries'
    ];
    var exportName = 'dashboard_trends_' + new Date().toISOString().slice(0,10) + '.csv';
    var query = buildTrendQuery();

    fetchWithAuth(_api.charts + query).then(function(res) {
        if (!res || !res.ok) throw new Error('Trend export fetch failed');
        return res.json();
    }).then(function(data) {
        if (!data || !data.dailyTrends || !(data.dailyTrends.labels || []).length) {
            throw new Error('No trend data');
        }
        window._lastChartData = data;
        var rows = buildTrendExportRows(data.dailyTrends);
        exportToCsv(exportName, headers, rows);
        showToast('Trend data exported!', 'success');
    }).catch(function() {
        if (!window._lastChartData || !window._lastChartData.dailyTrends || !(window._lastChartData.dailyTrends.labels || []).length) {
            showToast('No trend data to export.', 'warning');
            return;
        }
        var fallbackRows = buildTrendExportRows(window._lastChartData.dailyTrends);
        exportToCsv(exportName, headers, fallbackRows);
        showToast('Trend data exported from the current dashboard view.', 'warning');
    });
}

// =====================================================================
// Account / 2FA modal
// =====================================================================
function openAccountModal() {
    if (!_accountModal) _accountModal = new bootstrap.Modal(document.getElementById('accountModal'));
    load2FAStatus();
    _accountModal.show();
}

function load2FAStatus() {
    fetchWithAuth(_api.s2fa).then(function(res) {
        if (!res) return;
        return res.json().then(function(data) {
            var enabled = !!data.twoFactorEnabled;
            var icon   = document.getElementById('twoFAStatusIcon');
            var text   = document.getElementById('twoFAStatusText');
            var sub    = document.getElementById('twoFAStatusSub');
            var banner = document.getElementById('twoFAStatusBanner');
            var remain = document.getElementById('twoFABackupRemaining');

            if (enabled) {
                icon.innerHTML      = '<i class="fas fa-shield-alt text-success"></i>';
                text.innerHTML      = '<span class="text-success">2FA is ENABLED</span>';
                sub.textContent     = 'Your account is protected with two-factor authentication.';
                banner.style.background = 'rgba(25,135,84,.15)';
                if (remain) {
                    var cnt = data.backupCodesRemaining;
                    remain.className = 'mt-1 small ' + (cnt > 2 ? 'text-success' : 'text-warning');
                    remain.textContent = cnt + ' backup code' + (cnt !== 1 ? 's' : '') + ' remaining';
                    remain.classList.remove('d-none');
                }
                document.getElementById('twoFASetupSection').classList.add('d-none');
                document.getElementById('twoFADisableSection').classList.remove('d-none');
                document.getElementById('twoFADisableCode').value = '';
                document.getElementById('twoFADisableError').classList.add('d-none');
            } else {
                icon.innerHTML  = '<i class="fas fa-shield-alt text-muted"></i>';
                text.innerHTML  = '<span class="text-muted">2FA is DISABLED</span>';
                sub.textContent = 'Enable 2FA to protect your account.';
                banner.style.background = 'rgba(255,255,255,.05)';
                if (remain) remain.classList.add('d-none');
                document.getElementById('twoFASetupSection').classList.remove('d-none');
                document.getElementById('twoFADisableSection').classList.add('d-none');
                document.getElementById('twoFAQRSection').classList.add('d-none');
                document.getElementById('twoFABackupCodesSection').classList.add('d-none');
            }
        });
    }).catch(function(e) { console.error('2FA status load failed', e); });
}

function start2FASetup() {
    var btn = document.getElementById('startSetupBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Generating QR code\u2026';
    fetchWithAuth(_api.u2fa).then(function(res) {
        if (!res || !res.ok) { showToast('Failed to generate 2FA setup.', 'danger'); return; }
        return res.json().then(function(data) {
            document.getElementById('twoFAQRImg').src           = data.qrCode;
            document.getElementById('twoFASecretDisplay').value = data.secret;
            document.getElementById('twoFAEnableCode').value    = '';
            document.getElementById('twoFAEnableError').classList.add('d-none');
            document.getElementById('twoFAQRSection').classList.remove('d-none');
        });
    }).catch(function() { showToast('Network error.', 'danger'); })
    .then(function() {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-qrcode me-1"></i>Set Up Two-Factor Authentication';
    });
}

function enable2FA() {
    var rawCode = document.getElementById('twoFAEnableCode').value.replace(/\s/g,'');
    var errEl   = document.getElementById('twoFAEnableError');
    var btn     = document.getElementById('enableTwoFABtn');
    var spinner = document.getElementById('enableSpinner');
    errEl.classList.add('d-none');
    if (rawCode.length !== 6) { errEl.textContent = 'Enter the full 6-digit code.'; errEl.classList.remove('d-none'); return; }
    btn.disabled = true; spinner.classList.remove('d-none');
    fetchWithAuth(_api.e2fa, { method: 'POST', body: JSON.stringify({ code: rawCode }) })
    .then(function(res) {
        return res.json().then(function(data) {
            if (res.ok) {
                showToast('2FA enabled! Save your backup codes.', 'success');
                if (data.backupCodes && data.backupCodes.length) {
                    var grid    = document.getElementById('twoFABackupCodesGrid');
                    var section = document.getElementById('twoFABackupCodesSection');
                    if (grid && section) {
                        var backupCodesHtml = '';
                        data.backupCodes.forEach(function(c) {
                            backupCodesHtml += '<div style="font-family:monospace;font-size:.85rem;background:rgba(255,255,255,.07);border-radius:6px;padding:6px 8px;text-align:center;letter-spacing:.08em">' + c + '</div>';
                        });
                        grid.innerHTML = backupCodesHtml;
                        section.classList.remove('d-none');
                        window._backupCodesArr = data.backupCodes;
                    }
                }
                load2FAStatus();
            } else { errEl.textContent = data.message || 'Invalid code.'; errEl.classList.remove('d-none'); }
        });
    }).catch(function() { errEl.textContent = 'Network error.'; errEl.classList.remove('d-none'); })
    .then(function() { btn.disabled = false; spinner.classList.add('d-none'); });
}

function disable2FA() {
    var rawCode = document.getElementById('twoFADisableCode').value.replace(/\s/g,'');
    var errEl   = document.getElementById('twoFADisableError');
    var btn     = document.getElementById('disableTwoFABtn');
    var spinner = document.getElementById('disableSpinner');
    errEl.classList.add('d-none');
    if (rawCode.length !== 6) { errEl.textContent = 'Enter the full 6-digit code.'; errEl.classList.remove('d-none'); return; }
    btn.disabled = true; spinner.classList.remove('d-none');
    fetchWithAuth(_api.d2fa, { method: 'POST', body: JSON.stringify({ code: rawCode }) })
    .then(function(res) {
        return res.json().then(function(data) {
            if (res.ok) { showToast('2FA has been disabled.', 'warning'); load2FAStatus(); }
            else        { errEl.textContent = data.message || 'Invalid code.'; errEl.classList.remove('d-none'); }
        });
    }).catch(function() { errEl.textContent = 'Network error.'; errEl.classList.remove('d-none'); })
    .then(function() { btn.disabled = false; spinner.classList.add('d-none'); });
}

function regenerateBackupCodes() {
    var code  = document.getElementById('regenCode').value.replace(/\s/g,'');
    var errEl = document.getElementById('regenError');
    errEl.classList.add('d-none');
    if (code.length !== 6) { errEl.textContent = 'Enter the 6-digit authenticator code.'; errEl.classList.remove('d-none'); return; }
    fetchWithAuth(_api.r2fa, { method: 'POST', body: JSON.stringify({ code: code }) })
    .then(function(res) {
        return res.json().then(function(data) {
            if (res.ok && data.backupCodes) {
                var grid    = document.getElementById('twoFABackupCodesGrid');
                var section = document.getElementById('twoFABackupCodesSection');
                if (grid && section) {
                    var backupCodesHtml = '';
                    data.backupCodes.forEach(function(c) {
                        backupCodesHtml += '<div style="font-family:monospace;font-size:.85rem;background:rgba(255,255,255,.07);border-radius:6px;padding:6px 8px;text-align:center;letter-spacing:.08em">' + c + '</div>';
                    });
                    grid.innerHTML = backupCodesHtml;
                    section.classList.remove('d-none');
                    window._backupCodesArr = data.backupCodes;
                }
                document.getElementById('regenCode').value = '';
                showToast('New backup codes generated. Old codes are now invalid.', 'success');
                load2FAStatus();
            } else { errEl.textContent = data.message || 'Failed.'; errEl.classList.remove('d-none'); }
        });
    }).catch(function() { errEl.textContent = 'Network error.'; errEl.classList.remove('d-none'); });
}

function copyBackupCodes() {
    var codes = window._backupCodesArr;
    if (!codes || !codes.length) { showToast('No codes to copy.', 'warning'); return; }
    navigator.clipboard.writeText(codes.join('\n')).then(function() { showToast('Backup codes copied!', 'info'); });
}

function shakeFeedback(el) {
    if (!el) return;
    if (el._shakeTimer) clearTimeout(el._shakeTimer);
    el.classList.remove('shake-feedback');
    void el.offsetWidth;
    el.classList.add('shake-feedback');
    el._shakeTimer = setTimeout(function() {
        el.classList.remove('shake-feedback');
        el._shakeTimer = null;
    }, 600);
}

function showChangePasswordError(message) {
    var errEl = document.getElementById('cpError');
    var section = document.getElementById('changePwSection');
    if (!errEl) return;
    errEl.textContent = message || 'Failed.';
    errEl.classList.remove('d-none');
    shakeFeedback(section || errEl);
}

function changePassword() {
    var current = document.getElementById('cpCurrentPw').value;
    var newPw   = document.getElementById('cpNewPw').value;
    var errEl   = document.getElementById('cpError');
    var okEl    = document.getElementById('cpSuccess');
    errEl.classList.add('d-none'); okEl.classList.add('d-none');
    if (!current || !newPw) { showChangePasswordError('Both fields are required.'); return; }
    if (newPw.length < 8)   { showChangePasswordError('New password must be at least 8 characters.'); return; }
    fetchWithAuth(_api.cpw, { method: 'POST', body: JSON.stringify({ currentPassword: current, newPassword: newPw }) })
    .then(function(res) {
        if (!res) return;
        return res.json().then(function(data) {
            if (res.ok) {
                // BUG-22 FIX: Immediately log out the current session too.
                // The server already incremented tokenVersion so the old token
                // is now invalid. Clear it from the browser and redirect to login.
                showToast('Password changed! Signing you out now…', 'success');
                setTimeout(function() {
                    localStorage.removeItem('token');
                    localStorage.removeItem('rxToken');
                    localStorage.removeItem('user');
                    window.rxNav('/login?reason=password-changed');
                }, 1200); // brief delay so the toast is visible
            } else { showChangePasswordError(data.message || 'Failed.'); }
        });
    }).catch(function() { showChangePasswordError('Network error.'); });

}

function copySecret() {
    var s = document.getElementById('twoFASecretDisplay').value;
    navigator.clipboard.writeText(s).then(function() { showToast('Secret key copied!', 'info'); });
}

// Auto-format 2FA code inputs (insert space after 3 digits)
(function() {
    var ids = ['twoFAEnableCode','twoFADisableCode','regenCode'];
    for (var ii = 0; ii < ids.length; ii++) {
        (function(id) {
            var el = document.getElementById(id);
            if (!el) return;
            el.addEventListener('input', function() {
                var v = this.value.replace(/\D/g,'').substring(0,6);
                this.value = v.length > 3 ? v.slice(0,3) + ' ' + v.slice(3) : v;
            });
        })(ids[ii]);
    }
})();

// =====================================================================
// Auto-refresh engine
// =====================================================================
(function initAutoRefresh() {
    var _arTimer       = null;
    var _arCountTimer  = null;
    var _arSecondsLeft = 0;
    var _arInterval    = 0;

    var elSelect    = document.getElementById('arIntervalSelect');
    var elCountdown = document.getElementById('arCountdown');
    var elDot       = document.getElementById('arPulseDot');
    var elManual    = document.getElementById('arManualBtn');

    if (!elSelect) return;

    var _saved = parseInt(localStorage.getItem('rxDashRefresh') || '0', 10);
    if (_saved > 0) { elSelect.value = String(_saved); }

    function formatCountdown(s) {
        if (s <= 0) return '0s';
        if (s < 60)  return s + 's';
        var m = Math.floor(s / 60);
        var r = s % 60;
        return r > 0 ? m + 'm ' + r + 's' : m + 'm';
    }

    function setDotActive(active) {
        elDot.style.background = active ? '#22c55e' : '#6c757d';
        elDot.style.boxShadow  = active ? '0 0 6px rgba(34,197,94,0.6)' : 'none';
    }

    function stopTimers() {
        if (_arTimer)      { clearInterval(_arTimer);      _arTimer      = null; }
        if (_arCountTimer) { clearInterval(_arCountTimer); _arCountTimer = null; }
    }

    function startAutoRefresh(seconds) {
        stopTimers();
        _arInterval    = seconds;
        _arSecondsLeft = seconds;
        if (seconds <= 0) {
            elCountdown.textContent = 'Off';
            setDotActive(false);
            return;
        }
        elCountdown.textContent = formatCountdown(_arSecondsLeft);
        setDotActive(true);
        _arCountTimer = setInterval(function() {
            _arSecondsLeft--;
            elCountdown.textContent = formatCountdown(Math.max(0, _arSecondsLeft));
        }, 1000);
        _arTimer = setInterval(function() {
            _arSecondsLeft = _arInterval;
            var icon = elManual ? elManual.querySelector('i') : null;
            if (icon) {
                icon.style.transition = 'transform 0.6s ease';
                icon.style.transform  = 'rotate(360deg)';
                setTimeout(function() { icon.style.transition = ''; icon.style.transform = ''; }, 700);
            }
            refreshDashboard();
        }, seconds * 1000);
    }

    startAutoRefresh(_saved);

    elSelect.addEventListener('change', function() {
        var val = parseInt(this.value, 10);
        localStorage.setItem('rxDashRefresh', String(val));
        startAutoRefresh(val);
    });

    if (elManual) {
        elManual.addEventListener('click', function() {
            var icon = this.querySelector('i');
            if (icon) {
                icon.style.transition = 'transform 0.5s ease';
                icon.style.transform  = 'rotate(360deg)';
                setTimeout(function() { icon.style.transition = ''; icon.style.transform = ''; }, 600);
            }
            _arSecondsLeft = _arInterval;
            refreshDashboard();
        });
    }

    document.addEventListener('visibilitychange', function() {
        if (document.hidden) {
            stopTimers();
        } else if (_arInterval > 0) {
            _arSecondsLeft = _arInterval;
            startAutoRefresh(_arInterval);
        }
    });
})();

// =====================================================================
// Main entry point -- DOMContentLoaded
// =====================================================================
document.addEventListener('DOMContentLoaded', function() {
    initApp();
    drilldownModal = new bootstrap.Modal(document.getElementById('drilldownModal'));

    // Preset buttons
    var presetBtns = document.querySelectorAll('.dash-preset');
    for (var pi = 0; pi < presetBtns.length; pi++) {
        (function(btn) {
            btn.addEventListener('click', function() { setPreset(btn.getAttribute('data-preset')); });
        })(presetBtns[pi]);
    }

    // Trend range controls
    var trendBtns = document.querySelectorAll('.trend-range-btn');
    for (var ti = 0; ti < trendBtns.length; ti++) {
        (function(btn) {
            btn.addEventListener('click', function() {
                setTrendPreset(btn.getAttribute('data-trend-range') || '30d');
            });
        })(trendBtns[ti]);
    }
    var trendTypeEl = document.getElementById('trendChartType');
    var savedTrendType = localStorage.getItem('rxDashTrendChartType');
    if (savedTrendType === 'bar' || savedTrendType === 'line') {
        _trendChartType = savedTrendType;
    }
    if (trendTypeEl) {
        trendTypeEl.value = _trendChartType;
        trendTypeEl.addEventListener('change', function() {
            _trendChartType = this.value === 'bar' ? 'bar' : 'line';
            localStorage.setItem('rxDashTrendChartType', _trendChartType);
            if (window._lastChartData) renderCharts(window._lastChartData);
        });
    }

    var trendFromEl = document.getElementById('trendFrom');
    var trendToEl = document.getElementById('trendTo');
    if (trendFromEl) {
        trendFromEl.addEventListener('change', function() {
            if (!validateTrendRange()) return;
            _trendFrom = this.value;
            _trendTo = trendToEl ? trendToEl.value : '';
            _trendPreset = 'custom';
            syncTrendUi();
        });
    }
    if (trendToEl) {
        trendToEl.addEventListener('change', function() {
            if (!validateTrendRange()) return;
            _trendFrom = trendFromEl ? trendFromEl.value : '';
            _trendTo = this.value;
            _trendPreset = 'custom';
            syncTrendUi();
        });
    }
    var trendApply = document.getElementById('trendApplyBtn');
    if (trendApply) {
        trendApply.addEventListener('click', function() {
            if (!validateTrendRange()) return;
            _trendFrom = trendFromEl ? trendFromEl.value : '';
            _trendTo = trendToEl ? trendToEl.value : '';
            _trendPreset = 'custom';
            syncTrendUi();
            loadDashboardCharts();
        });
    }
    setTrendPreset('30d');

    // Date pickers
    var dateIds = ['dashFrom', 'dashTo'];
    for (var di = 0; di < dateIds.length; di++) {
        var el = document.getElementById(dateIds[di]);
        if (el) {
            el.addEventListener('change', function() {
                _dashFrom = document.getElementById('dashFrom').value;
                _dashTo   = document.getElementById('dashTo').value;
                validateDashRange();
                _dashFrom = document.getElementById('dashFrom').value;
                _dashTo   = document.getElementById('dashTo').value;
                var presets = document.querySelectorAll('.dash-preset');
                for (var pi2 = 0; pi2 < presets.length; pi2++) {
                    var b = presets[pi2];
                    b.style.background = b.style.borderColor = b.style.color = b.style.fontWeight = '';
                }
                var lbl = document.getElementById('dashRangeLabel');
                if (lbl) lbl.textContent = (_dashFrom || _dashTo) ? 'Custom range' : 'Showing all time';
                refreshDashboard();
            });
        }
    }

    // Highlight "all" preset by default
    var allBtn = document.querySelector('.dash-preset[data-preset="all"]');
    if (allBtn) {
        allBtn.style.background  = 'rgba(74,144,226,.18)';
        allBtn.style.borderColor = '#4a90e2';
        allBtn.style.color       = '#4a90e2';
        allBtn.style.fontWeight  = '600';
    }

    // Audit log permission check
    window._auditLogAllowed = (function() {
        try {
            var u = typeof getCurrentAuthUser === 'function' ? getCurrentAuthUser() : (window.__RX_AUTH_USER || null);
            if (!u) return false;
            var perms = u.permissions || getRoleDefaultPermissions(u.role);
            var p = perms['audit_log'];
            return !!(p && p.visible === true);
        } catch(e) { return false; }
    })();
    if (!window._auditLogAllowed) {
        var card = document.getElementById('recentActivityCard');
        if (card) card.classList.add('d-none');
    }

    // Export buttons
    var expAct = document.getElementById('exportActivityBtn');
    if (expAct) expAct.addEventListener('click', exportRecentActivity);
    var trendExport = document.getElementById('trendExportBtn');
    if (trendExport) trendExport.addEventListener('click', exportTrendCsv);

    // Load data
    refreshDashboard();
    loadDashboardCharts();

    // Load eligibility widget independently
    loadEligibility();
    initCallCenterReviewControls();
    initCallCenterDrilldownCards();

    // ISSUE-03 FIX: Re-render charts on theme toggle so dark/light colors update
    var _themeBtn = document.getElementById('themeToggle');
    if (_themeBtn) {
        _themeBtn.addEventListener('click', function() {
            setTimeout(function() {
                if (window._lastChartData) {
                    var barCanvas   = document.getElementById('patientsBarChart');
                    var donutCanvas = document.getElementById('rxDonutChart');
                    if (barCanvas   && Chart.getChart(barCanvas))   Chart.getChart(barCanvas).destroy();
                    if (donutCanvas && Chart.getChart(donutCanvas)) Chart.getChart(donutCanvas).destroy();
                    renderCharts(window._lastChartData);
                }
                if (window._lastCallCenterReviewData) {
                    renderCallCenterReviewCharts(window._lastCallCenterReviewData);
                }
            }, 60);
        });
    }
});
