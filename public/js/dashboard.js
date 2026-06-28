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
        'eligible': 'Eligible Now — 90-Day Window Expired',
        'expiring': 'Window Expiring ≤ 7 Days',
        'window':   'In Active 90-Day Window',
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

function exportDashboardReport() {
    var btn = document.getElementById('exportDashboardBtn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Exporting...';
    var results = {};
    var keys    = ['active','inactive','totalRx','pending','noRx'];
    var apis    = [_api.ap, _api.ip, _api.tr, _api.pr, _api.nr];
    var done    = 0;
    var failed  = false;

    function finish() {
        if (failed) { showToast('Export failed', 'danger'); btn.disabled = false; btn.innerHTML = '<i class="fas fa-file-csv me-1"></i>Export Report'; return; }
        var headers = ['Section','Patient/RX ID','Name','Status','DOB / Arrival Date','Service Date','Clinic / Pharmacy'];
        var rows = [];
        var addPatient = function(section, list, status) {
            for (var i = 0; i < list.length; i++) {
                var p = list[i];
                rows.push([section, p.patientCode || p.id, (p.firstName || '') + ' ' + (p.lastName || ''), status, p.dob || '', p.serviceDate || '', p.Clinic ? p.Clinic.name : '']);
            }
        };
        var addRx = function(section, list, status) {
            for (var i = 0; i < list.length; i++) {
                var rx = list[i];
                rows.push([section, '#' + rx.id, rx.Patient ? rx.Patient.firstName + ' ' + rx.Patient.lastName : '', status, rx.arrivalDate || '', rx.serviceDate || '', rx.Pharmacy ? rx.Pharmacy.name : '']);
            }
        };
        addPatient('Active Patients',    results.active   || [], 'Active');
        addPatient('Inactive Patients',  results.inactive || [], 'Inactive');
        addPatient('No RX Records',      results.noRx     || [], 'Active');
        addRx('RX Records',         results.totalRx  || [], 'RX');
        addRx('Pending Deliveries', results.pending  || [], 'Pending');
        exportToCsv('dashboard_report_' + new Date().toISOString().slice(0,10) + '.csv', headers, rows);
        showToast('Dashboard report exported!', 'success');
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-file-csv me-1"></i>Export Report';
    }

    for (var ki = 0; ki < keys.length; ki++) {
        (function(key, url) {
            fetchWithAuth(url).then(function(r) { return r.json(); }).then(function(data) {
                results[key] = data;
                done++;
                if (done === keys.length) finish();
            }).catch(function() {
                failed = true;
                done++;
                if (done === keys.length) finish();
            });
        })(keys[ki], apis[ki]);
    }
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

function exportTrendCsv() {
    if (!window._lastChartData || !window._lastChartData.dailyTrends) {
        showToast('No trend data to export.', 'warning');
        return;
    }
    var d = window._lastChartData.dailyTrends;
    var rows = [];
    for (var i = 0; i < (d.labels || []).length; i++) {
        rows.push([
            d.labels[i] || '',
            d.activePatients ? d.activePatients[i] : '',
            d.inactivePatients ? d.inactivePatients[i] : '',
            d.newPatientsToday ? d.newPatientsToday[i] : '',
            d.rxRecords ? d.rxRecords[i] : '',
            d.newRXToday ? d.newRXToday[i] : '',
            d.pendingDeliveries ? d.pendingDeliveries[i] : '',
            d.completedRX ? d.completedRX[i] : '',
            d.patientsWithNoRx ? d.patientsWithNoRx[i] : '',
            d.eligibleNow ? d.eligibleNow[i] : '',
            d.expiringIn7 ? d.expiringIn7[i] : '',
            d.inWindow ? d.inWindow[i] : '',
            d.noServiceDate ? d.noServiceDate[i] : '',
            d.workflowCompletionRate ? d.workflowCompletionRate[i] : '',
            d.workflowStepsCompletedDaily ? d.workflowStepsCompletedDaily[i] : (d.workflowStepsToday ? d.workflowStepsToday[i] : ''),
            d.serviceDateEntries ? d.serviceDateEntries[i] : (d.serviceDateChanges ? d.serviceDateChanges[i] : '')
        ]);
    }
    exportToCsv('dashboard_trends_' + new Date().toISOString().slice(0,10) + '.csv', [
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
    ], rows);
    showToast('Trend data exported!', 'success');
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
                    localStorage.removeItem('user');
                    // Expire the JS-writable rxToken cookie
                    document.cookie = 'rxToken=; path=/; max-age=0; SameSite=Lax';
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
            var u = JSON.parse(localStorage.getItem('user'));
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
    var expDash = document.getElementById('exportDashboardBtn');
    if (expDash) expDash.addEventListener('click', exportDashboardReport);
    var expAct = document.getElementById('exportActivityBtn');
    if (expAct) expAct.addEventListener('click', exportRecentActivity);
    var trendExport = document.getElementById('trendExportBtn');
    if (trendExport) trendExport.addEventListener('click', exportTrendCsv);

    // Load data
    refreshDashboard();
    loadDashboardCharts();

    // Load eligibility widget independently
    loadEligibility();

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
            }, 60);
        });
    }
});
