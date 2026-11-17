'use strict';

document.addEventListener('DOMContentLoaded', function () {
    const el = id => document.getElementById(id), form = el('sdrForm');
    if (!form) return;
    const root = el('serviceDateReport'), endpoint = '/api/patients/service-date-validation';
    const fields = { search:'sdrSearch', from:'sdrFrom', to:'sdrTo', status:'sdrStatus', clinicId:'sdrClinic',
        pharmacyId:'sdrPharmacy', lastRxFrom:'sdrLastRxFrom', lastRxTo:'sdrLastRxTo', lastRxStatus:'sdrLastRxStatus',
        patientStatus:'sdrPatientStatus', rxHistory:'sdrRxHistory', coverage:'sdrCoverage', patientId:'sdrPatientId' };
    let page = 1, pages = 1, sort = 'patientCode', direction = 'asc', loaded = false, busy = false;
    let canExport = false, request = 0, controller, optionsPromise, applied = new URLSearchParams(), timer;
    const pickers = {};
    const displayDate = value => value ? value.slice(5,7) + '/' + value.slice(8,10) + '/' + value.slice(0,4) : 'No dated RX';
    const number = value => Number(value || 0).toLocaleString();
    function button(text, action, className = 'sdr-cell-filter') {
        const node = document.createElement('button');
        node.type = 'button'; node.className = className; node.textContent = text;
        node.addEventListener('click', action); return node;
    }
    function set(values) {
        Object.entries(values).forEach(([key,value]) => {
            if (pickers[key]) pickers[key].set(value ? String(value).split(',') : []);
            else el(fields[key]).value = value;
        });
    }
    function quick(key,value) {
        if (key === 'reset') set({ status:'all', rxHistory:'all', coverage:'all' });
        else {
            set({ [key]:value });
            if (key === 'rxHistory' && value === 'none') set({ status:'pending', coverage:'all' });
            if (key === 'status' && value === 'exists') {
                if (el(fields.rxHistory).value === 'none') set({ rxHistory:'all' });
                if (el(fields.coverage).value === 'pending_only') set({ coverage:'all' });
            }
            if (key === 'status' && value === 'pending' && el(fields.coverage).value === 'covered_only') set({ coverage:'all' });
            if (key === 'coverage') {
                if (value === 'pending_only') set({ status:'pending' });
                if (value === 'covered_only') set({ status:'exists' });
                if (value !== 'pending_only' && value !== 'all' && el(fields.rxHistory).value === 'none') set({ rxHistory:'all' });
            }
        }
        apply();
    }
    function loadOptions() {
        if (optionsPromise) return optionsPromise;
        optionsPromise = (async () => {
            const response = await fetchWithAuth(endpoint + '?options=1');
            if (!response || !response.ok) throw Error('Unable to load clinic and pharmacy filters.');
            const data = await response.json();
            [['clinicId',data.clinics],['pharmacyId',data.pharmacies]].forEach(([key,rows]) => {
                const hidden = el(fields[key]), picker = el(fields[key] + 'Picker');
                const options = picker.querySelector('.patient-filter-multiselect-options'), search = picker.querySelector('input[type="search"]');
                const allLabel = key === 'clinicId' ? 'All clinics' : 'All pharmacies';
                const choices = [{ id:'none', name:'Not assigned' }, ...rows];
                const selected = new Set(hidden.value.split(',').filter(Boolean));
                function refresh() {
                    hidden.value = [...selected].join(',');
                    const names = choices.filter(row => selected.has(String(row.id))).map(row => row.name || '#' + row.id);
                    picker.querySelector('button span').textContent = !names.length ? allLabel : names.length === 1 ? names[0] : names.length + ' selected';
                    options.querySelectorAll('input').forEach(input => { input.checked = selected.has(input.value); });
                }
                options.replaceChildren();
                choices.forEach(row => {
                    const label = document.createElement('label'), checkbox = document.createElement('input');
                    label.className = 'patient-filter-multiselect-option'; label.dataset.search = String(row.name || '').toLowerCase();
                    checkbox.type = 'checkbox'; checkbox.value = String(row.id);
                    checkbox.addEventListener('change', () => {
                        if (checkbox.checked) selected.add(checkbox.value); else selected.delete(checkbox.value);
                        refresh(); apply();
                    });
                    label.append(checkbox, document.createTextNode(row.name || '#' + row.id)); options.append(label);
                });
                search.addEventListener('input', () => {
                    const term = search.value.trim().toLowerCase();
                    options.querySelectorAll('label').forEach(label => { label.hidden = !label.dataset.search.includes(term); });
                });
                pickers[key] = { set(values) { selected.clear(); values.forEach(value => selected.add(value)); refresh(); } };
                picker.querySelector('[data-sdr-clear]').addEventListener('click', () => {
                    pickers[key].set([]); search.value = ''; options.querySelectorAll('label').forEach(label => { label.hidden = false; }); apply();
                });
                refresh();
            });
        })().catch(error => { optionsPromise = null; throw error; });
        return optionsPromise;
    }
    function controls() {
        ['sdrFirst','sdrPrev'].forEach(id => { el(id).disabled = busy || !loaded || page <= 1; });
        ['sdrNext','sdrLast'].forEach(id => { el(id).disabled = busy || !loaded || page >= pages; });
        el('sdrPageGo').disabled = busy || !loaded;
        el('sdrExport').disabled = busy || !loaded || !canExport;
        root.querySelectorAll('#sdrPageButtons button').forEach(node => { node.disabled = busy; });
    }
    function chips() {
        const container = el('sdrFilterChips'); container.replaceChildren();
        Object.entries(fields).forEach(([key,id]) => {
            const input = el(id), value = input.value;
            if (!value || value === 'all') return;
            const label = form.querySelector('label[for="' + id + '"]');
            let text = input.tagName === 'SELECT' ? input.selectedOptions[0].textContent : value;
            if (pickers[key]) text = el(id + 'Picker').querySelector('button span').textContent;
            const name = key === 'patientId' ? 'Focused patient' : label ? label.textContent : key === 'clinicId' ? 'Clinic' : key === 'pharmacyId' ? 'Pharmacy' : key;
            container.append(button(name + ': ' + text + ' ×', () => { set({ [key]:input.tagName === 'SELECT' ? 'all' : '' }); apply(); }, 'btn btn-sm btn-outline-secondary'));
        });
    }
    function render(data) {
        page = data.page; pages = data.totalPages; canExport = data.canExport; loaded = true;
        root.querySelectorAll('[data-sdr-count]').forEach(node => {
            const [scope,key] = node.dataset.sdrCount.split('.'); node.textContent = number((scope === 'available' ? data.available : data)[key]);
        });
        root.querySelectorAll('tr[data-sdr-key]').forEach(row => {
            const key = row.dataset.sdrKey;
            const selected = key === 'reset' ? ['status','rxHistory','coverage'].every(k => el(fields[k]).value === 'all') : el(fields[key]).value === row.dataset.sdrValue;
            row.classList.toggle('sdr-selected', selected); row.querySelector('button').setAttribute('aria-pressed', String(selected));
        });
        root.querySelectorAll('[data-sdr-sort]').forEach(node => {
            const active = node.dataset.sdrSort === sort;
            node.closest('th').setAttribute('aria-sort', active ? direction === 'asc' ? 'ascending' : 'descending' : 'none');
            node.querySelector('span').textContent = active ? direction === 'asc' ? ' ↑' : ' ↓' : ' ↕';
        });
        const body = el('sdrBody'); body.replaceChildren();
        data.rows.forEach(row => {
            const focus = () => { set({ patientId:row.patientId }); apply(); };
            const values = [
                [row.patientCode,focus], [row.patient,focus],
                [row.clinic,() => { set({ clinicId:row.clinicId || 'none' }); apply(); }],
                [row.pharmacy,() => { set({ pharmacyId:row.pharmacyId || 'none' }); apply(); }],
                [displayDate(row.lastRxServiceDate),() => { set({ lastRxFrom:row.lastRxServiceDate || '', lastRxTo:row.lastRxServiceDate || '', lastRxStatus:row.lastRxServiceDate ? 'dated' : 'undated' }); apply(); }],
                [row.patientActive ? 'Active' : 'Inactive',() => { set({ patientStatus:row.patientActive ? 'active' : 'inactive' }); apply(); }],
                [displayDate(row.serviceDate),() => { set({ from:row.serviceDate, to:row.serviceDate }); apply(); }],
                [row.rxCount,() => quick('status',row.rxCount ? 'exists' : 'pending')],
                [row.rxCount ? 'RX exists' : 'Pending RX',() => quick('status',row.rxCount ? 'exists' : 'pending')],
                [row.serviceDateCount,() => { set({ patientId:row.patientId, status:'all', rxHistory:'all', coverage:'all' }); apply(); }],
                [row.pendingDateCount,() => { set({ patientId:row.patientId, status:'pending', rxHistory:'all', coverage:'all' }); apply(); }]
            ];
            const tr = document.createElement('tr');
            values.forEach(([value,action],index) => {
                const td = document.createElement('td'); td.append(button(value,action));
                if (index === 8 && !row.rxCount) td.className = 'fw-bold text-danger'; tr.append(td);
            }); body.append(tr);
        });
        if (!data.rows.length) {
            const tr = document.createElement('tr'), td = document.createElement('td'); td.colSpan = 11;
            td.textContent = 'No service dates match these filters.'; tr.append(td); body.append(tr);
        }
        const size = data.pageSize;
        el('sdrRange').textContent = data.total ? number((page - 1) * size + 1) + '–' + number(Math.min(page * size,data.total)) + ' of ' + number(data.total) + ' service dates' : '0 service dates';
        el('sdrPage').textContent = 'Page ' + number(page) + ' of ' + number(pages);
        el('sdrPageJump').value = page; el('sdrPageJump').max = pages;
        const links = el('sdrPageButtons'); links.replaceChildren();
        for (let n = Math.max(1,Math.min(page - 2,pages - 4)); n <= Math.min(pages,Math.max(5,page + 2)); n++) {
            const node = button(n,() => go(n),'btn btn-sm ' + (n === page ? 'btn-primary' : 'btn-outline-primary'));
            node.setAttribute('aria-label','Page ' + n); if (n === page) node.setAttribute('aria-current','page'); links.append(node);
        }
        el('sdrSummary').textContent = 'Click a table value to narrow the list. Remove a filter below the form to broaden it.';
    }
    async function load() {
        const seq = ++request; if (controller) controller.abort(); controller = new AbortController();
        const signal = controller.signal; busy = true; controls(); chips();
        el('sdrSummary').textContent = 'Loading service dates…';
        root.setAttribute('aria-busy','true'); el('sdrBody').replaceChildren();
        root.querySelectorAll('[data-sdr-count]').forEach(node => { node.textContent = '…'; });
        try {
            await loadOptions(); if (seq !== request) return;
            const params = new URLSearchParams(applied); params.set('page',page);
            const response = await fetchWithAuth(endpoint + '?' + params,{ signal });
            if (!response) throw Error('Sign in to view this report.');
            const data = await response.json(); if (seq !== request) return;
            if (!response.ok) throw Error(data.error || 'Unable to load report.'); render(data);
        } catch (error) {
            if (seq !== request || error.name === 'AbortError') return;
            loaded = false; el('sdrSummary').textContent = error.message; el('sdrPage').textContent = ''; el('sdrRange').textContent = '';
            root.querySelectorAll('[data-sdr-count]').forEach(node => { node.textContent = '—'; });
        } finally {
            if (seq === request) { busy = false; root.setAttribute('aria-busy','false'); controls(); }
        }
    }
    function apply() {
        clearTimeout(timer);
        if (!form.reportValidity()) return;
        applied = new URLSearchParams(); Object.entries(fields).forEach(([key,id]) => { if (el(id).value) applied.set(key,el(id).value.trim()); });
        applied.set('sort',sort); applied.set('direction',direction); applied.set('pageSize',el('sdrPageSize').value);
        page = 1; load();
    }
    function go(value) { if (!busy && loaded && Number.isInteger(value) && value >= 1 && value <= pages) { page = value; load(); } }
    form.addEventListener('submit',event => { event.preventDefault(); apply(); });
    form.addEventListener('reset',event => {
        event.preventDefault(); clearTimeout(timer);
        Object.keys(fields).forEach(key => set({ [key]:el(fields[key]).tagName === 'SELECT' ? 'all' : '' }));
        set({ status:'pending' }); sort = 'patientCode'; direction = 'asc'; apply();
    });
    Object.entries(fields).forEach(([key,id]) => {
        if (['search','clinicId','pharmacyId','patientId'].includes(key)) return;
        el(id).addEventListener('change',() => ['status','rxHistory','coverage'].includes(key) ? quick(key,el(id).value) : apply());
    });
    el('sdrSearch').addEventListener('input',() => { clearTimeout(timer); timer = setTimeout(apply,350); });
    el('sdrPageSize').addEventListener('change',apply);
    root.querySelectorAll('tr[data-sdr-key]').forEach(row => { row.addEventListener('click',() => quick(row.dataset.sdrKey,row.dataset.sdrValue)); });
    root.querySelectorAll('[data-sdr-sort]').forEach(node => { node.addEventListener('click',() => {
        const key = node.dataset.sdrSort; direction = key === sort && direction === 'asc' ? 'desc' : 'asc'; sort = key; apply();
    }); });
    el('sdrFirst').addEventListener('click',() => go(1)); el('sdrLast').addEventListener('click',() => go(pages));
    el('sdrPrev').addEventListener('click',() => go(page - 1)); el('sdrNext').addEventListener('click',() => go(page + 1));
    const jump = () => { if (el('sdrPageJump').reportValidity()) go(Number(el('sdrPageJump').value)); };
    el('sdrPageGo').addEventListener('click',jump);
    el('sdrPageJump').addEventListener('keydown',event => { if (event.key === 'Enter') { event.preventDefault(); jump(); } });
    el('sdrExport').addEventListener('click',() => { if (!busy && loaded && canExport) window.location.assign(endpoint + '/export?' + applied); });
    el('serviceDateValidationModal').addEventListener('shown.bs.modal',apply);
    el('serviceDateValidationModal').addEventListener('hidden.bs.modal',() => {
        clearTimeout(timer); request++; if (controller) controller.abort(); busy = false; root.setAttribute('aria-busy','false');
    });
    if (new URLSearchParams(window.location.search).get('validation') === 'pending') {
        bootstrap.Modal.getOrCreateInstance(el('serviceDateValidationModal')).show();
    }
});
