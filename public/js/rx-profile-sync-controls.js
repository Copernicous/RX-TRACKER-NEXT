'use strict';
window.rxProfileSyncControl = { enabled: false, startDate: null };
window.rxSyncManualReview = false;
document.addEventListener('DOMContentLoaded', () => {
    const status = document.getElementById('rxSyncControlStatus');
    if (!status || !window.BACKOFFICE_USER?.isMaster) return;
    async function request(options) {
        const response = await apiFetch('/api/admin/rx-profile-sync/control', options);
        const data = await response.json(); if (!response.ok) throw Error(data.error || 'Unable to load sync controls.');
        return data;
    }
    function display(value) {
        window.rxProfileSyncControl = value;
        document.getElementById('rxSyncEnabled').checked = value.enabled;
        document.getElementById('rxSyncStartDate').value = value.startDate || '';
        status.textContent = value.enabled ? `Enabled for RX records created on/after ${value.startDate} at 00:00 UTC. Copying values always requires a Sync action.`
            : 'Paused. Routine scans and copying are off. You can explicitly review candidates and mark them reviewed / ignored without changing the patient or RX.';
        updateRxSyncBulkSelection();
    }
    async function save(pause) {
        try {
            const value = await request({ method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
                enabled: pause ? false : document.getElementById('rxSyncEnabled').checked,
                startDate: document.getElementById('rxSyncStartDate').value || null
            }) });
            window.rxSyncManualReview = false; display(value); await loadRxProfileSync();
        } catch (e) { status.textContent = e.message; }
    }
    document.getElementById('rxSyncControlSave').onclick = () => save(false);
    document.getElementById('rxSyncPause').onclick = () => save(true);
    document.getElementById('rxSyncManualReview').onclick = () => { window.rxSyncManualReview = true; loadRxProfileSync(); };
    document.getElementById('rxSyncIgnoreSelected').onclick = async () => {
        const selected = [...document.querySelectorAll('#rxSyncList [data-rx-sync-select]:checked')];
        if (!selected.length || selected.length > 100) return toast('Select between 1 and 100 RX records to review / ignore.', 'info');
        const button = document.getElementById('rxSyncIgnoreSelected'); button.disabled = true;
        let changed = 0, failed = 0;
        try {
            for (const input of selected) {
                const row = input.closest('tr');
                const fields = [...row.querySelectorAll('[data-rx-sync-field][data-review-state="pending"]:checked')].map(field => field.dataset.rxSyncField);
                if (!fields.length) continue;
                try {
                    const response = await apiFetch('/api/admin/rx-profile-sync/' + encodeURIComponent(row.dataset.rxSyncId) + '/review', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields, reason: 'Reviewed manually; intentionally ignored. No patient or RX values changed.' })
                    });
                    const data = await response.json(); if (!response.ok) throw Error(data.error);
                    if (data.changed) changed++;
                } catch (_e) { failed++; }
            }
            toast(`${changed} RX records reviewed / ignored; ${failed} failed. No patient or RX values changed.`, failed ? 'warning' : 'success');
            await loadRxProfileSync();
        } finally { button.disabled = false; }
    };
    request().then(display).catch(e => { status.textContent = e.message; });
});
