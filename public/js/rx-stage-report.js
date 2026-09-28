(function () {
    'use strict';
    const el = id => document.getElementById(id);
    const endpoint = '/api/rx-records/stage-report';
    let applied = null, page = 1, total = 0, canExport = false, generation = 0;
    let controller = null;
    const status = message => { el('stageReportStatus').textContent = message; };
    function stop() {
        generation++;
        if (controller) controller.abort();
        controller = null;
    }
    function clear() {
        stop(); applied = null; total = 0;
        el('stageReportRows').replaceChildren();
        el('stageReportPage').textContent = '';
        el('stageReportExport').disabled = true;
        el('stageReportPrevious').disabled = true;
        el('stageReportNext').disabled = true;
    }
    async function request(url, signal) {
        const response = await fetch(url, { credentials: 'same-origin', signal });
        if (!response.ok || response.redirected) {
            const body = await response.json().catch(() => ({}));
            throw new Error(body.error || 'Unable to load report. Check your session and try again.');
        }
        return response;
    }
    el('rxStageReportBtn').addEventListener('click', async () => {
        clear();
        bootstrap.Modal.getOrCreateInstance(el('rxStageReportModal')).show();
        status('Loading stages...');
        const token = generation;
        controller = new AbortController();
        el('stageReportApply').disabled = true;
        try {
            const data = await (await request(endpoint + '?options=1', controller.signal)).json();
            if (token !== generation) return;
            canExport = data.canExport;
            const selected = new Set(Array.from(el('stageReportStages').querySelectorAll('input:checked'), input => input.value));
            el('stageReportStages').replaceChildren();
            data.stages.forEach(stage => {
                const label = document.createElement('label'); label.className = 'd-flex gap-2 py-1';
                const input = document.createElement('input'); input.type = 'checkbox'; input.value = stage.id; input.className = 'form-check-input'; input.checked = selected.has(String(stage.id));
                label.append(input, document.createTextNode(stage.name)); el('stageReportStages').append(label);
            });
            updateSelection();
            el('stageReportApply').disabled = !data.stages.length;
            status(data.stages.length ? 'Select stages and apply filters.' : 'No active stages are configured.');
        } catch (error) { if (token === generation) status(error.message); }
    });
    function updateSelection() {
        const count = el('stageReportStages').querySelectorAll('input:checked').length;
        const stageCount = el('stageReportStages').querySelectorAll('input').length;
        el('stageReportAllStages').checked = stageCount > 0 && count === stageCount;
        el('stageReportAllStages').indeterminate = count > 0 && count < stageCount;
        el('stageReportStagesBtn').textContent = stageCount > 0 && count === stageCount ? 'All stages' : count ? count + ' stage(s) selected' : 'Select stages';
        const current = el('stageReportScopeCurrent').checked, reached = el('stageReportScopeReached').checked;
        el('stageReportAllScopes').checked = current && reached;
        el('stageReportAllScopes').indeterminate = current !== reached;
        el('stageReportScopeBtn').textContent = current && reached ? 'All scopes' : current ? 'Currently at selected stage' : reached ? 'Reached selected stage' : 'Select scope';
        const allDates = el('stageReportAllDates').checked;
        el('stageReportFrom').disabled = allDates; el('stageReportTo').disabled = allDates;
        const dateSort = el('stageReportSortColumn').value === 'stageDate';
        el('stageReportSort').options[0].textContent = dateSort ? 'Oldest to newest' : 'Ascending (A-Z / smallest first)';
        el('stageReportSort').options[1].textContent = dateSort ? 'Newest to oldest' : 'Descending (Z-A / largest first)';
    }
    function updateSortHeaders() {
        document.querySelectorAll('[data-stage-report-sort]').forEach(button => {
            const active = applied && button.dataset.stageReportSort === applied.get('sort');
            const direction = applied && applied.get('direction');
            button.closest('th').setAttribute('aria-sort', active ? direction === 'asc' ? 'ascending' : 'descending' : 'none');
            button.querySelector('[data-sort-indicator]').textContent = active ? direction === 'asc' ? '\u2191' : '\u2193' : '\u2195';
        });
    }
    el('rxStageReportModal').addEventListener('hidden.bs.modal', clear);
    el('rxStageReportForm').addEventListener('change', event => {
        if (event.target.id === 'stageReportAllStages') {
            el('stageReportStages').querySelectorAll('input').forEach(input => { input.checked = event.target.checked; });
        }
        if (event.target.id === 'stageReportAllScopes') {
            el('stageReportScopeCurrent').checked = event.target.checked;
            el('stageReportScopeReached').checked = event.target.checked;
        }
        updateSelection(); clear(); updateSortHeaders(); status('Filters changed. Apply filters to refresh the report.');
    });
    el('rxStageReportForm').addEventListener('submit', event => {
        event.preventDefault();
        const stages = Array.from(el('stageReportStages').querySelectorAll('input:checked'), input => input.value);
        if (!stages.length) { status('Select at least one stage.'); return; }
        const current = el('stageReportScopeCurrent').checked, reached = el('stageReportScopeReached').checked;
        if (!current && !reached) { status('Select at least one stage scope.'); return; }
        const allDates = el('stageReportAllDates').checked;
        if (!allDates && el('stageReportFrom').value && el('stageReportTo').value && el('stageReportFrom').value > el('stageReportTo').value) { status('From date must be on or before To date.'); return; }
        applied = new URLSearchParams({ stages: stages.join(','), scope: current && reached ? 'both' : current ? 'current' : 'reached',
            from: allDates ? '' : el('stageReportFrom').value, to: allDates ? '' : el('stageReportTo').value,
            sort: el('stageReportSortColumn').value, direction: el('stageReportSort').value });
        load(1);
    });
    async function load(nextPage) {
        stop(); const token = generation; controller = new AbortController();
        el('stageReportRows').replaceChildren();
        el('stageReportExport').disabled = true;
        el('stageReportPrevious').disabled = true; el('stageReportNext').disabled = true;
        status('Loading report...');
        try {
            const data = await (await request(endpoint + '?' + applied + '&page=' + nextPage, controller.signal)).json();
            if (token !== generation) return;
            page = data.page; total = data.total; canExport = data.canExport;
            updateSortHeaders();
            el('stageReportDriverHeading').textContent = data.driverHeading;
            let group = null;
            data.rows.forEach(row => {
                if (group !== row.stageId) {
                    const tr = document.createElement('tr'); const th = document.createElement('th');
                    th.colSpan = 8; th.scope = 'rowgroup'; th.textContent = row.stage; tr.className = 'table-active'; tr.append(th); el('stageReportRows').append(tr); group = row.stageId;
                }
                const tr = document.createElement('tr');
                [row.rxId, row.patientCode, row.patient, row.clinic || 'Not set', data.driverRestricted ? 'Restricted' : row.driver || 'Not recorded', row.stage, row.stageDateDisplay, row.daysElapsed == null ? 'Unknown' : row.daysElapsed].forEach(value => {
                    const td = document.createElement('td'); td.textContent = value; tr.append(td);
                });
                el('stageReportRows').append(tr);
            });
            status(total + ' matching stage entries. Dates: ' + data.timezone + '.' + (data.driverRestricted ? ' Historical driver details are restricted for your role.' : ''));
            el('stageReportPage').textContent = 'Page ' + page + ' of ' + Math.max(1, Math.ceil(total / 50));
            el('stageReportPrevious').disabled = page <= 1;
            el('stageReportNext').disabled = page * 50 >= total;
            el('stageReportExport').disabled = !canExport || !total;
        } catch (error) { if (token === generation) status(error.message); }
    }
    el('stageReportPrevious').addEventListener('click', () => load(page - 1));
    document.querySelectorAll('[data-stage-report-sort]').forEach(button => {
        button.addEventListener('click', () => {
            if (!applied) { status('Apply filters before sorting results.'); return; }
            const sort = button.dataset.stageReportSort;
            const direction = applied.get('sort') === sort && applied.get('direction') === 'asc' ? 'desc' : 'asc';
            applied.set('sort', sort); applied.set('direction', direction);
            el('stageReportSortColumn').value = sort; el('stageReportSort').value = direction;
            updateSelection(); load(1);
        });
    });
    el('stageReportNext').addEventListener('click', () => load(page + 1));
    el('stageReportExport').addEventListener('click', async () => {
        if (!applied || !canExport) return;
        const token = generation; el('stageReportExport').disabled = true;
        try {
            const response = await request(endpoint + '/export?' + applied, controller && controller.signal);
            const blob = await response.blob();
            if (token !== generation) return;
            const url = URL.createObjectURL(blob), anchor = document.createElement('a');
            anchor.href = url; anchor.download = 'rx-stage-report.csv'; document.body.append(anchor); anchor.click(); anchor.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (error) { if (token === generation) status(error.message); }
        finally { if (token === generation) el('stageReportExport').disabled = !canExport || !total; }
    });
}());
