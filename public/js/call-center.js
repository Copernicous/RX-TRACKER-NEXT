// call-center.js -- dedicated restricted Call Center workspace
(function() {
    'use strict';

    var api = (function() {
        function h(id) {
            var el = document.getElementById(id);
            return el ? el.href : '';
        }
        return {
            patients: h('xa-cc-patients') || '/api/call-center/patients',
            metrics: h('xa-cc-metrics') || '/api/call-center/metrics/me',
            lockRefresh: h('xa-cc-lock-refresh') || '/api/call-center/locks/refresh',
            lockRelease: h('xa-cc-lock-release') || '/api/call-center/locks/release'
        };
    })();

    var lockedPatientIds = [];
    var lockHeartbeatTimer = null;

    var state = {
        page: 1,
        pageSize: 10,
        total: 0,
        totalPages: 1,
        activityTotal: null,
        activityLabel: '',
        q: '',
        view: 'queue',
        activeCard: 'queue',
        sort: '',
        dir: 'asc'
    };

    var cardTitles = {
        queue: 'New Call Queue',
        calls: 'Calls This Login',
        patients: 'Patients Called This Login',
        dates: 'Service Dates This Login',
        efficiency: 'Service Dates Behind Efficiency'
    };

    var cardSubtitles = {
        queue: 'Patients ready for the next call.',
        calls: 'Call records from this login, grouped by patient. Repeat calls appear in Call Dates.',
        patients: 'Unique patients called during this login.',
        dates: 'Patients where a new service date was entered during this login.',
        efficiency: 'Patients with service dates entered during this login. Efficiency is service dates divided by calls.'
    };

    function esc(value) {
        return String(value === undefined || value === null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function setText(id, value) {
        var el = document.getElementById(id);
        if (el) el.textContent = value;
    }

    function toast(message, type) {
        if (typeof showToast === 'function') showToast(message, type || 'info');
    }

    function fmtDateTime(value) {
        if (!value) return '';
        var d = new Date(value);
        if (isNaN(d.getTime())) return String(value);
        return d.toLocaleString([], {
            month: '2-digit',
            day: '2-digit',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit'
        });
    }

    function queryUrl() {
        var parts = [
            'page=' + encodeURIComponent(state.page),
            'pageSize=' + encodeURIComponent(state.pageSize),
            'view=' + encodeURIComponent(state.view)
        ];
        if (state.sort) {
            parts.push('sort=' + encodeURIComponent(state.sort));
            parts.push('dir=' + encodeURIComponent(state.dir));
        }
        if (state.q) parts.push('q=' + encodeURIComponent(state.q));
        return api.patients + '?' + parts.join('&');
    }

    async function releaseCurrentLocks() {
        if (!lockedPatientIds.length) return;
        var ids = lockedPatientIds.slice();
        lockedPatientIds = [];
        try {
            await fetchWithAuth(api.lockRelease, {
                method: 'POST',
                body: JSON.stringify({ patientIds: ids }),
                silent: true
            });
        } catch (err) {}
    }

    async function refreshCurrentLocks() {
        if (!lockedPatientIds.length) return;
        try {
            var res = await fetchWithAuth(api.lockRefresh, {
                method: 'POST',
                body: JSON.stringify({ patientIds: lockedPatientIds }),
                silent: true
            });
            if (!res || !res.ok) return;
            var data = await res.json();
            if (data.conflicts && data.conflicts.length) {
                toast('One or more patients were claimed by another user. Refreshing queue.', 'warning');
                loadPatients();
            }
        } catch (err) {}
    }

    async function claimRow(id) {
        id = parseInt(id, 10);
        if (!Number.isFinite(id)) return false;
        if (lockedPatientIds.indexOf(id) !== -1) return true;
        try {
            var res = await fetchWithAuth(api.patients + '/' + encodeURIComponent(id) + '/claim', {
                method: 'POST',
                body: JSON.stringify({}),
                silent: true
            });
            var data = res ? await res.json().catch(function() { return {}; }) : {};
            if (res && res.ok) {
                lockedPatientIds.push(id);
                return true;
            }
            var lock = data && data.lock ? (' by ' + (data.lock.user || 'another user')) : '';
            toast((data && data.error ? data.error : 'This patient is already claimed') + lock + '.', 'warning');
            return false;
        } catch (err) {
            toast('Could not claim patient. Try refreshing.', 'warning');
            return false;
        }
    }

    async function loadMetrics() {
        var res = await fetchWithAuth(api.metrics, { silent: true });
        if (!res || !res.ok) return;
        var data = await res.json();
        var totals = data.totals || {};
        setText('ccMetricEligible', data.availableEligibleTotal !== undefined ? data.availableEligibleTotal : (data.eligibleTotal || 0));
        setText('ccMetricCalls', totals.calls || 0);
        setText('ccMetricUnique', totals.uniquePatientsCalled || 0);
        setText('ccMetricDates', totals.serviceDates || 0);
        setText('ccMetricEfficiency', (totals.efficiency || 0) + '%');
    }

    async function loadPatients() {
        var tbody = document.getElementById('ccPatientRows');
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="9" class="text-center text-muted py-4"><i class="fas fa-spinner fa-spin me-2"></i>Loading</td></tr>';
        }
        var res = await fetchWithAuth(queryUrl());
        if (!res || !res.ok) {
            if (tbody) tbody.innerHTML = '<tr><td colspan="9" class="text-center text-muted py-4">No access</td></tr>';
            return;
        }
        var data = await res.json();
        state.page = data.page || 1;
        state.pageSize = data.pageSize || state.pageSize;
        state.total = data.total || 0;
        state.totalPages = data.totalPages || 1;
        state.activityTotal = data.activityTotal === undefined ? null : data.activityTotal;
        state.activityLabel = data.activityLabel || '';
        state.view = data.view || state.view;
        renderRows(data.rows || []);
        lockedPatientIds = state.view === 'queue' ? (data.rows || []).map(function(row) { return row.id; }) : lockedPatientIds.filter(function() { return false; });
        renderPaging();
        renderActiveView();
    }

    function renderRows(rows) {
        var tbody = document.getElementById('ccPatientRows');
        if (!tbody) return;
        if (!rows.length) {
            tbody.innerHTML = '<tr><td colspan="9" class="text-center text-muted py-4">No eligible patients found.</td></tr>';
            return;
        }
        var html = '';
        for (var i = 0; i < rows.length; i++) {
            var row = rows[i];
            var canUpdate = row.isCurrentlyEligible === true;
            var disabled = canUpdate ? '' : ' disabled';
            var saveButton = canUpdate
                ? '<button class="btn btn-success btn-sm cc-save" data-action="save" title="Save"><i class="fas fa-save"></i></button>'
                : '<span class="badge bg-success">Done</span>';
            html += '<tr data-id="' + esc(row.id) + '">' +
                '<td><div class="cc-name-cell">' + esc(row.firstName) + '</div></td>' +
                '<td><div class="cc-name-cell">' + esc(row.lastName) + '</div></td>' +
                '<td><span class="cc-phone">' + esc(row.phone) + '</span></td>' +
                '<td><div class="cc-note-preview">' + renderNotes(row) + '</div></td>' +
                '<td><input type="date" class="form-control form-control-sm cc-new-date" data-field="newServiceDate"' + disabled + '></td>' +
                '<td><textarea class="form-control form-control-sm cc-row-note" data-field="note" maxlength="4000"' + disabled + '></textarea></td>' +
                '<td class="text-center"><label class="cc-called-wrap" title="' + (state.view === 'queue' ? 'Called' : 'Call again') + '"><input type="checkbox" class="form-check-input cc-called" data-field="called"' + disabled + '></label></td>' +
                '<td>' + renderCallHistory(row) + '</td>' +
                '<td class="text-end">' + saveButton + '</td>' +
            '</tr>';
        }
        tbody.innerHTML = html;
    }

    function renderNotes(row) {
        var entries = row.noteEntries || [];
        if (!entries.length && !row.notes) return '<span class="text-muted">--</span>';
        if (!entries.length) return esc(row.notes || '');
        var html = '';
        for (var i = 0; i < entries.length; i++) {
            var n = entries[i] || {};
            var source = n.source || 'Patient';
            var badgeClass = source === 'Call Center' ? 'bg-info' : 'bg-secondary';
            var meta = [];
            if (n.author) meta.push(n.author);
            if (n.createdAt) meta.push(fmtDateTime(n.createdAt));
            html += '<div class="mb-2">' +
                '<span class="badge ' + badgeClass + ' me-1">' + esc(source) + '</span>' +
                (meta.length ? '<small class="text-muted">' + esc(meta.join(' - ')) + '</small>' : '') +
                '<div>' + esc(n.note || '') + '</div>' +
            '</div>';
        }
        return html;
    }

    function renderCallHistory(row) {
        var count = row.callCount || 0;
        var calls = row.recentCalls || [];
        var statusClass = row.isCurrentlyEligible ? (row.calledToday ? 'bg-warning text-dark' : 'bg-success') : 'bg-success';
        var html = '<div class="d-flex flex-wrap gap-1 align-items-center">' +
            '<span class="badge bg-info">' + count + '</span>' +
            '<span class="badge ' + statusClass + '">' + esc(row.statusText || '') + '</span>' +
        '</div>';
        if (!calls.length) return html + '<div class="cc-history-list text-muted">--</div>';
        html += '<div class="cc-history-list mt-1">';
        for (var i = 0; i < calls.length; i++) {
            html += '<div><i class="fas fa-phone-alt me-1"></i>' + esc(fmtDateTime(calls[i].at)) +
                (calls[i].user ? '<br><span class="ms-3">' + esc(calls[i].user) + '</span>' : '') +
                '</div>';
        }
        var extra = count - calls.length;
        if (extra > 0) html += '<div>+' + extra + ' more</div>';
        html += '</div>';
        return html;
    }

    function renderPaging() {
        var start = state.total ? ((state.page - 1) * state.pageSize) + 1 : 0;
        var end = Math.min(state.page * state.pageSize, state.total);
        var label = state.total ? (start + '-' + end + ' of ' + state.total) : '0';
        if (state.activityTotal !== null && state.activityTotal !== undefined && state.activityLabel) {
            label += ' / ' + state.activityTotal + ' ' + state.activityLabel;
        }
        setText('ccRangeLabel', label);
        setText('ccPageLabel', 'Page ' + state.page + ' of ' + state.totalPages);
        var prev = document.getElementById('ccPrevBtn');
        var next = document.getElementById('ccNextBtn');
        if (prev) prev.disabled = state.page <= 1;
        if (next) next.disabled = state.page >= state.totalPages;
    }

    function renderActiveView() {
        var cards = document.querySelectorAll('.cc-metric[data-view]');
        for (var i = 0; i < cards.length; i++) {
            var cardKey = cards[i].getAttribute('data-card') || cards[i].getAttribute('data-view');
            cards[i].classList.toggle('active', cardKey === state.activeCard);
        }
        setText('ccListTitle', cardTitles[state.activeCard] || 'New Call Queue');
        setText('ccListSubtitle', cardSubtitles[state.activeCard] || '');
        renderSortHeaders();
    }

    function renderSortHeaders() {
        var buttons = document.querySelectorAll('.cc-sort[data-sort]');
        for (var i = 0; i < buttons.length; i++) {
            var btn = buttons[i];
            var icon = btn.querySelector('i');
            var active = btn.getAttribute('data-sort') === state.sort;
            btn.classList.toggle('active', active);
            if (icon) {
                icon.className = active
                    ? (state.dir === 'desc' ? 'fas fa-sort-down' : 'fas fa-sort-up')
                    : 'fas fa-sort';
            }
        }
    }

    async function saveRow(button) {
        var tr = button.closest('tr[data-id]');
        if (!tr) return;
        var id = tr.getAttribute('data-id');
        var called = tr.querySelector('.cc-called');
        var note = tr.querySelector('.cc-row-note');
        var date = tr.querySelector('.cc-new-date');
        var payload = {
            called: !!(called && called.checked),
            note: note ? note.value.trim() : '',
            newServiceDate: date ? date.value : ''
        };

        if (!payload.called && !payload.note && !payload.newServiceDate) {
            toast('Select Called, add a note, or enter a new service date.', 'warning');
            return;
        }
        var claimed = await claimRow(id);
        if (!claimed) {
            button.disabled = false;
            return;
        }

        button.disabled = true;
        var oldHtml = button.innerHTML;
        button.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        try {
            var res = await fetchWithAuth(api.patients + '/' + encodeURIComponent(id) + '/actions', {
                method: 'POST',
                body: JSON.stringify(payload)
            });
            var data = res ? await res.json().catch(function() { return {}; }) : {};
            if (res && res.ok) {
                toast((data && data.message) || 'Saved.', 'success');
                await loadMetrics();
                await loadPatients();
            } else {
                toast((data && (data.error || data.message)) || 'Save failed.', 'danger');
            }
        } catch (err) {
            toast('Network error.', 'danger');
        } finally {
            button.disabled = false;
            button.innerHTML = oldHtml;
        }
    }

    function bindEvents() {
        var pageSize = document.getElementById('ccPageSize');
        var search = document.getElementById('ccSearch');
        var searchBtn = document.getElementById('ccSearchBtn');
        var refreshBtn = document.getElementById('ccRefreshBtn');
        var prev = document.getElementById('ccPrevBtn');
        var next = document.getElementById('ccNextBtn');
        var rows = document.getElementById('ccPatientRows');
        var cards = document.querySelectorAll('.cc-metric[data-view]');
        var sortButtons = document.querySelectorAll('.cc-sort[data-sort]');

        if (pageSize) {
            pageSize.addEventListener('change', function() {
                state.pageSize = this.value === '5' ? 5 : 10;
                state.page = 1;
                releaseCurrentLocks().then(loadPatients);
            });
        }
        if (searchBtn) {
            searchBtn.addEventListener('click', function() {
                state.q = search ? search.value.trim() : '';
                state.page = 1;
                releaseCurrentLocks().then(loadPatients);
            });
        }
        if (search) {
            search.addEventListener('keydown', function(e) {
                if (e.key === 'Enter') {
                    state.q = search.value.trim();
                    state.page = 1;
                    releaseCurrentLocks().then(loadPatients);
                }
            });
        }
        if (refreshBtn) {
            refreshBtn.addEventListener('click', function() {
                loadMetrics();
                releaseCurrentLocks().then(loadPatients);
            });
        }
        if (prev) {
            prev.addEventListener('click', function() {
                if (state.page > 1) {
                    state.page -= 1;
                    releaseCurrentLocks().then(loadPatients);
                }
            });
        }
        if (next) {
            next.addEventListener('click', function() {
                if (state.page < state.totalPages) {
                    state.page += 1;
                    releaseCurrentLocks().then(loadPatients);
                }
            });
        }
        if (rows) {
            rows.addEventListener('click', function(e) {
                var btn = e.target.closest('[data-action="save"]');
                if (btn) saveRow(btn);
            });
            rows.addEventListener('focusin', function(e) {
                if (!e.target.matches('.cc-row-note,.cc-new-date,.cc-called')) return;
                var tr = e.target.closest('tr[data-id]');
                if (tr) claimRow(tr.getAttribute('data-id'));
            });
            rows.addEventListener('change', function(e) {
                if (!e.target.matches('.cc-row-note,.cc-new-date,.cc-called')) return;
                var tr = e.target.closest('tr[data-id]');
                if (tr) claimRow(tr.getAttribute('data-id'));
            });
        }
        for (var i = 0; i < cards.length; i++) {
            cards[i].addEventListener('click', function() {
                state.view = this.getAttribute('data-view') || 'queue';
                state.activeCard = this.getAttribute('data-card') || state.view;
                state.page = 1;
                releaseCurrentLocks().then(loadPatients);
            });
        }
        for (var si = 0; si < sortButtons.length; si++) {
            sortButtons[si].addEventListener('click', function() {
                var nextSort = this.getAttribute('data-sort') || '';
                if (state.sort === nextSort) {
                    state.dir = state.dir === 'asc' ? 'desc' : 'asc';
                } else {
                    state.sort = nextSort;
                    state.dir = 'asc';
                }
                state.page = 1;
                releaseCurrentLocks().then(loadPatients);
            });
        }
    }

    document.addEventListener('DOMContentLoaded', function() {
        if (typeof setupSidebar === 'function') setupSidebar();
        if (typeof setupTheme === 'function') setupTheme();
        if (typeof setupLogout === 'function') setupLogout();
        if (typeof setupSessionTimeout === 'function') setupSessionTimeout();
        if (typeof setupNavDate === 'function') setupNavDate();
        if (typeof setScreenCopyProtection === 'function') setScreenCopyProtection(true, 'Screen copy disabled for this role.');

        var user = typeof getCurrentAuthUser === 'function' ? getCurrentAuthUser() : (window.__RX_AUTH_USER || null);
        var greeting = document.getElementById('userGreeting');
        if (greeting && user) {
            var name = ((user.firstName || '') + ' ' + (user.lastName || '')).trim() || user.username || 'Call Center';
            greeting.textContent = 'Hello, ' + name;
        }

        bindEvents();
        loadMetrics();
        loadPatients();
        lockHeartbeatTimer = setInterval(refreshCurrentLocks, 30000);
        window.addEventListener('beforeunload', function() {
            if (!lockedPatientIds.length) return;
            try {
                fetch(api.lockRelease, {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ patientIds: lockedPatientIds }),
                    keepalive: true
                });
            } catch (err) {}
        });
    });
})();
