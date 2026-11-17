'use strict';

document.addEventListener('DOMContentLoaded', function () {
    const el = id => document.getElementById(id), root = el('serviceDateReport'), dialog = el('sdrDetails');
    if (!root || !dialog) return;
    const endpoint = '/api/patients/service-date-validation';
    let context, mode, selectedDate, page = 1, pages = 1, busy = false, request = 0, controller;
    let returnFocus, reportScroll = 0;
    const scroller = root.closest('.modal-body');
    const date = value => value ? String(value).slice(5,7) + '/' + String(value).slice(8,10) + '/' + String(value).slice(0,4) : 'Not dated';
    const count = value => Number(value || 0).toLocaleString();
    function node(tag, text, className) {
        const result = document.createElement(tag); if (text !== undefined) result.textContent = text;
        if (className) result.className = className; return result;
    }
    function action(text, callback) {
        const result = node('button',text,'btn btn-sm btn-link p-0 text-start'); result.type = 'button'; result.addEventListener('click',callback); return result;
    }
    function controls() {
        el('sdrDetailsPrev').disabled = busy || page <= 1;
        el('sdrDetailsNext').disabled = busy || page >= pages;
        el('sdrDetailsDate').disabled = !selectedDate;
        el('sdrDetailsFilterDate').disabled = !selectedDate;
        for (const [id,active] of [['sdrDetailsPatient',mode === 'patient'],['sdrDetailsDate',mode === 'date'],['sdrDetailsDates',mode === 'dates' || mode === 'pending']]) {
            el(id).classList.toggle('btn-primary',active); el(id).classList.toggle('btn-outline-primary',!active); el(id).setAttribute('aria-pressed',String(active));
        }
    }
    function facts(patient) {
        const details = node('details'), summary = node('summary','Patient information','fw-bold'); details.open = mode === 'patient';
        const dl = node('dl',undefined,'sdr-patient-facts');
        for (const [label,value,key] of [['Patient ID',patient.patientCode,'patient'],['Patient',patient.name,'patient'],['Status',patient.active ? 'Active' : 'Inactive','status'],
            ['DOB',date(patient.dob),'dob'],['Phone',patient.phone || 'Not provided','phone'],['Address',patient.address || 'Not provided','address'],
            ['Current clinic',patient.clinic,'clinic'],['Default pharmacy',patient.pharmacy,'pharmacy'],['Current service date',date(patient.currentServiceDate),'date']]) {
            const group = node('div'); if (context.kind === key) group.className = 'sdr-fact-selected';
            group.append(node('dt',label),node('dd',value)); dl.append(group);
        }
        details.append(summary,dl); return details;
    }
    function table(headers) {
        const wrapper = node('div',undefined,'table-responsive mt-3'), table = node('table',undefined,'table table-sm align-middle');
        const head = node('thead'), tr = node('tr'); headers.forEach(label => { const th = node('th',label); th.scope = 'col'; tr.append(th); }); head.append(tr);
        const body = node('tbody'); table.append(head,body); wrapper.append(table); return { wrapper,body };
    }
    function dateView(value) { selectedDate = value; mode = 'date'; page = 1; load(); }
    function renderRx(data) {
        const content = el('sdrDetailsContent'); content.append(facts(data.patient));
        if (!data.rxAccess) {
            el('sdrDetailsStatus').textContent = 'Patient information is available. RX details require RX Records viewing permission.';
            pages = 1; page = 1; el('sdrDetailsPage').textContent = ''; return;
        }
        page = data.page; pages = data.totalPages;
        el('sdrDetailsStatus').textContent = mode === 'date' ? count(data.total) + ' RX records for ' + date(selectedDate) + '.' : count(data.total) + ' RX records across all dates, including undated records.';
        if (!data.rows.length) {
            content.append(node('p',mode === 'date' ? 'No non-deleted RX record exists for this patient and service date. Earlier RX records do not cover this date. Review why the RX was not created; this does not establish the reason or whether it is overdue.' : 'This patient has no non-deleted RX records.', 'alert alert-info mt-3'));
        } else {
            const grid = table(['RX ID','Service date','Arrival date','RX pharmacy','Workflow','Medications']);
            data.rows.forEach(rx => {
                const tr = node('tr'); tr.append(node('td','#' + rx.id));
                const service = node('td'); service.append(rx.serviceDate ? action(date(rx.serviceDate),() => dateView(rx.serviceDate)) : node('span','Not dated')); tr.append(service);
                tr.append(node('td',date(rx.arrivalDate)),node('td',rx.pharmacy));
                const workflow = node('td');
                workflow.append(node('div',rx.totalSteps ? (rx.completedSteps >= rx.totalSteps ? 'Complete' : 'Incomplete') + ' · ' + rx.completedSteps + '/' + rx.totalSteps + ' active steps' : 'No active workflow configured'));
                if (rx.returnedToWarehouse) workflow.append(node('span','Returned to warehouse','badge bg-warning text-dark'));
                tr.append(workflow);
                const medications = node('td');
                if (!rx.medications.length) medications.textContent = 'None listed';
                else {
                    const details = node('details'); details.append(node('summary',count(rx.medications.length) + (rx.medications.length === 1 ? ' medication' : ' medications')));
                    const list = node('ul',undefined,'mb-0'); rx.medications.forEach(medication => list.append(node('li',(medication.name || 'Unnamed medication') + ' · Qty ' + (medication.quantity === null ? 'not provided' : medication.quantity))));
                    details.append(list); medications.append(details);
                }
                tr.append(medications); grid.body.append(tr);
            }); content.append(grid.wrapper);
        }
        el('sdrDetailsPage').textContent = 'Page ' + page + ' of ' + pages + ' · ' + count(data.total) + ' RX records';
        content.append(node('p','Workflow progress is separate from whether an RX exists for a service date. RX pharmacy can differ from the patient’s current default pharmacy. Deleted RX records are excluded.','small text-muted mt-3'));
    }
    function renderDates(data) {
        page = data.page; pages = data.totalPages;
        el('sdrDetailsStatus').textContent = count(data.total) + (mode === 'pending' ? ' pending service dates' : ' service dates') + ' in the report’s selected range and base filters.';
        const content = el('sdrDetailsContent');
        if (!data.rows.length) content.append(node('p','No service dates match this scope.','alert alert-info'));
        else {
            const grid = table(['Service date','RX records','Validation']);
            data.rows.forEach(row => {
                const tr = node('tr'), service = node('td'), records = node('td');
                service.append(action(date(row.serviceDate),() => dateView(row.serviceDate)));
                records.append(action(row.rxCount,() => dateView(row.serviceDate)));
                tr.append(service,records,node('td',row.rxCount ? 'RX exists' : 'Pending RX')); grid.body.append(tr);
            }); content.append(grid.wrapper);
        }
        el('sdrDetailsPage').textContent = 'Page ' + page + ' of ' + pages;
    }
    async function load() {
        const seq = ++request; if (controller) controller.abort(); controller = new AbortController();
        busy = true; pages = Math.max(1,pages); controls(); el('sdrDetailsRetry').hidden = true;
        el('sdrDetailsStatus').textContent = 'Loading details…'; el('sdrDetailsContent').replaceChildren(); el('sdrDetailsPage').textContent = '';
        dialog.setAttribute('aria-busy','true');
        el('sdrDetailsSubtitle').textContent = mode === 'date' ? 'RX for service date ' + date(selectedDate) : mode === 'pending' ? 'Pending service dates in the report range' : mode === 'dates' ? 'Service dates in the report range' : 'Patient overview and RX history';
        try {
            let url;
            if (mode === 'dates' || mode === 'pending') {
                const params = new URLSearchParams(context.filters);
                params.set('patientId',context.row.patientId); params.set('status',mode === 'pending' ? 'pending' : 'all'); params.set('rxHistory','all'); params.set('coverage','all');
                params.set('page',page); params.set('pageSize','20'); params.set('sort','serviceDate'); params.set('direction','desc'); url = endpoint + '?' + params;
            } else {
                const params = new URLSearchParams({ page }); if (mode === 'date') params.set('serviceDate',selectedDate);
                url = endpoint + '/details/' + encodeURIComponent(context.row.patientId) + '?' + params;
            }
            const response = await fetchWithAuth(url,{ signal:controller.signal });
            if (!response) throw Error('Sign in to view details.');
            const data = await response.json(); if (seq !== request || !dialog.open) return;
            if (!response.ok) throw Error(data.error || 'Unable to load details.');
            if (mode === 'dates' || mode === 'pending') renderDates(data); else renderRx(data);
        } catch (error) {
            if (seq !== request || error.name === 'AbortError') return;
            pages = 1; page = 1; el('sdrDetailsStatus').textContent = error.message; el('sdrDetailsRetry').hidden = false;
        } finally {
            if (seq === request) { busy = false; dialog.setAttribute('aria-busy','false'); controls(); }
        }
    }
    root.addEventListener('sdr:inspect',event => {
        context = event.detail; returnFocus = context.trigger; reportScroll = scroller ? scroller.scrollTop : 0;
        selectedDate = context.kind === 'lastRx' ? context.row.lastRxServiceDate : context.row.serviceDate;
        mode = ['date','lastRx'].includes(context.kind) && selectedDate ? 'date' : ['dates','pending'].includes(context.kind) ? context.kind : 'patient';
        page = 1; pages = 1; el('sdrDetailsTitle').textContent = context.row.patientCode + ' · ' + context.row.patient;
        if (!dialog.open) dialog.showModal(); dialog.scrollTop = 0; load();
    });
    el('sdrDetailsPatient').addEventListener('click',() => { mode = 'patient'; page = 1; load(); });
    el('sdrDetailsDate').addEventListener('click',() => { if (selectedDate) dateView(selectedDate); });
    el('sdrDetailsDates').addEventListener('click',() => { mode = 'dates'; page = 1; load(); });
    el('sdrDetailsPrev').addEventListener('click',() => { if (!busy && page > 1) { page--; load(); } });
    el('sdrDetailsNext').addEventListener('click',() => { if (!busy && page < pages) { page++; load(); } });
    el('sdrDetailsRetry').addEventListener('click',load);
    el('sdrDetailsClose').addEventListener('click',() => dialog.close()); el('sdrDetailsDone').addEventListener('click',() => dialog.close());
    dialog.addEventListener('keydown',event => { if (event.key === 'Escape') event.stopPropagation(); });
    el('serviceDateValidationModal').addEventListener('hidden.bs.modal',() => { if (dialog.open) dialog.close(); });
    dialog.addEventListener('close',() => {
        request++; if (controller) controller.abort(); busy = false;
        el('sdrDetailsContent').replaceChildren(); el('sdrDetailsStatus').textContent = ''; dialog.setAttribute('aria-busy','false');
        if (returnFocus && returnFocus.isConnected) returnFocus.focus({ preventScroll:true });
        if (scroller) scroller.scrollTop = reportScroll;
    });
    function filter(values) { dialog.close(); root.dispatchEvent(new CustomEvent('sdr:filter',{ detail:values })); }
    el('sdrDetailsFilterPatient').addEventListener('click',() => filter({ patientId:context.row.patientId }));
    el('sdrDetailsFilterDate').addEventListener('click',() => { if (selectedDate) filter({ patientId:context.row.patientId, from:selectedDate, to:selectedDate, status:'all', rxHistory:'all', coverage:'all' }); });
});
