'use strict';

document.addEventListener('DOMContentLoaded', function () {
    const el = id => document.getElementById(id);
    const form = el('sdrForm');
    if (!form) return;
    let page = 1, applied = new URLSearchParams({ status: 'pending' }), loaded = false, busy = false;
    let canExport = false, total = 0;
    let optionsLoaded = false;
    const pickers = [];
    const endpoint = '/api/patients/service-date-validation';
    function displayDate(value) {
        if (!value) return 'No dated RX';
        const parts = value.split('-');
        return parts[1] + '/' + parts[2] + '/' + parts[0];
    }
    async function loadOptions() {
        if (optionsLoaded) return;
        const response = await fetchWithAuth(endpoint + '?options=1');
        if (!response || !response.ok) throw new Error('Unable to load clinic and pharmacy filters.');
        const data = await response.json();
        [['sdrClinic', data.clinics], ['sdrPharmacy', data.pharmacies]].forEach(([id, rows]) => {
            const hidden = el(id), picker = el(id + 'Picker');
            const options = picker.querySelector('.patient-filter-multiselect-options');
            const search = picker.querySelector('input[type="search"]');
            const allLabel = id === 'sdrClinic' ? 'All clinics' : 'All pharmacies';
            const choices = [{ id: 'none', name: 'Not assigned' }, ...rows];
            const selected = new Set(hidden.value.split(',').filter(Boolean));
            const refresh = () => {
                hidden.value = Array.from(selected).join(',');
                const names = choices.filter(row => selected.has(String(row.id))).map(row => row.name || ('#' + row.id));
                picker.querySelector('button span').textContent = !names.length ? allLabel : names.length === 1 ? names[0] : names.length + ' selected';
            };
            options.replaceChildren();
            choices.forEach(row => {
                const label = document.createElement('label');
                label.className = 'patient-filter-multiselect-option';
                label.dataset.search = String(row.name || '').toLowerCase();
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.value = String(row.id);
                checkbox.checked = selected.has(checkbox.value);
                checkbox.addEventListener('change', () => {
                    if (checkbox.checked) selected.add(checkbox.value);
                    else selected.delete(checkbox.value);
                    refresh();
                });
                label.appendChild(checkbox);
                label.appendChild(document.createTextNode(row.name || ('#' + row.id)));
                options.appendChild(label);
            });
            search.addEventListener('input', () => {
                const term = search.value.trim().toLowerCase();
                options.querySelectorAll('label').forEach(label => { label.style.display = label.dataset.search.includes(term) ? '' : 'none'; });
            });
            const clear = () => {
                selected.clear();
                search.value = '';
                options.querySelectorAll('input').forEach(input => { input.checked = false; });
                options.querySelectorAll('label').forEach(label => { label.style.display = ''; });
                refresh();
            };
            picker.querySelector('[data-sdr-clear]').addEventListener('click', clear);
            pickers.push({ clear });
            refresh();
        });
        optionsLoaded = true;
    }
    function controls() {
        el('sdrPrev').disabled = busy || page <= 1;
        el('sdrNext').disabled = busy || page * 50 >= total;
        el('sdrExport').disabled = busy || !loaded || !canExport;
    }
    async function load() {
        if (busy) return;
        busy = true;
        controls();
        el('sdrSummary').textContent = 'Loading service dates…';
        el('sdrBody').replaceChildren();
        try {
            await loadOptions();
            const params = new URLSearchParams(applied);
            params.set('page', page);
            const response = await fetchWithAuth(endpoint + '?' + params);
            if (!response) throw new Error('Sign in to view this report.');
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Unable to load report.');
            total = data.total;
            canExport = data.canExport;
            loaded = true;
            const body = el('sdrBody');
            data.rows.forEach(row => {
                const tr = document.createElement('tr');
                [row.patientCode, row.patient, row.clinic, row.pharmacy, displayDate(row.lastRxServiceDate), row.patientActive ? 'Active' : 'Inactive', displayDate(row.serviceDate),
                    row.rxCount, row.rxCount ? 'RX exists' : 'Pending RX', row.serviceDateCount, row.pendingDateCount].forEach((value, index) => {
                    const td = document.createElement('td');
                    td.textContent = value;
                    if (index === 8 && !row.rxCount) td.className = 'fw-bold text-danger';
                    tr.appendChild(td);
                });
                body.appendChild(tr);
            });
            if (!data.rows.length) {
                const td = document.createElement('td');
                td.colSpan = 11;
                td.textContent = 'No service dates match these filters.';
                const tr = document.createElement('tr');
                tr.appendChild(td);
                body.appendChild(tr);
            }
            el('sdrSummary').textContent = data.patients + ' patients · ' + data.total + ' service dates · ' + data.pending + ' pending RX dates';
            el('sdrPage').textContent = 'Page ' + page + ' of ' + Math.max(1, Math.ceil(total / 50));
        } catch (error) {
            loaded = false;
            total = 0;
            el('sdrSummary').textContent = error.message;
            el('sdrPage').textContent = '';
        } finally {
            busy = false;
            controls();
        }
    }
    form.addEventListener('submit', event => {
        event.preventDefault();
        if (busy) return;
        if (el('sdrFrom').value && el('sdrTo').value && el('sdrFrom').value > el('sdrTo').value) {
            el('sdrSummary').textContent = 'From date must be on or before To date.';
            return;
        }
        if (el('sdrLastRxFrom').value && el('sdrLastRxTo').value && el('sdrLastRxFrom').value > el('sdrLastRxTo').value) {
            el('sdrSummary').textContent = 'Last RX From date must be on or before To date.';
            return;
        }
        applied = new URLSearchParams({ search: el('sdrSearch').value.trim(), from: el('sdrFrom').value,
            to: el('sdrTo').value, status: el('sdrStatus').value, clinicId: el('sdrClinic').value,
            pharmacyId: el('sdrPharmacy').value, lastRxFrom: el('sdrLastRxFrom').value,
            lastRxTo: el('sdrLastRxTo').value, lastRxStatus: el('sdrLastRxStatus').value });
        page = 1;
        load();
    });
    form.addEventListener('reset', event => {
        if (busy) { event.preventDefault(); return; }
        pickers.forEach(picker => picker.clear());
        applied = new URLSearchParams({ status: 'pending' });
        page = 1;
        load();
    });
    el('sdrPrev').addEventListener('click', () => { if (!busy && page > 1) { page--; load(); } });
    el('sdrNext').addEventListener('click', () => { if (!busy && page * 50 < total) { page++; load(); } });
    el('sdrExport').addEventListener('click', () => {
        if (!busy && loaded && canExport) window.location.assign(endpoint + '/export?' + applied);
    });
    el('serviceDateValidationModal').addEventListener('shown.bs.modal', () => { load(); });
});
