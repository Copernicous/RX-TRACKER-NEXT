'use strict';
// Central policy controls on Audit Log; all actions require server-side Admin RBAC.
document.addEventListener('DOMContentLoaded', () => {
    const source = document.getElementById('historySource');
    if (source) source.addEventListener('change', async () => {
        currentPage = 1; activityPage = 1;
        selectedIds.clear(); updateSelCount();
        document.getElementById('selAll').disabled = source.value !== 'active';
        await Promise.allSettled([loadUserFilter(), loadModuleFilter(), loadActionFilter(), loadActivityUserFilter(), loadActivityRoleFilter(), loadActivityPageFilter()]);
        loadPage(); loadActivityPage(); loadErrors();
    });
    const panel = document.getElementById('historyArchivePanel');
    if (!panel) return;
    let policy;
    const message = document.getElementById('archiveMessage');
    const show = value => { message.textContent = value; };
    async function request(url, options) {
        const response = await fetchWithAuth(url, options);
        const data = response && await response.json();
        if (!response || !response.ok) throw Error(data?.error || 'Archive request failed.');
        return data;
    }
    async function refresh() {
        try {
            const data = await request('/api/history-archive');
            policy = data.policy;
            panel.classList.remove('d-none');
            document.getElementById('archiveAutomatic').checked = policy.automatic;
            document.getElementById('archiveHour').value = policy.hourUTC;
            document.getElementById('archiveSchedulerState').textContent = !data.schedulerEnabled
                ? 'Automatic archiving is paused by the server configuration. Saved settings remain available; manual archiving still works.'
                : data.automaticEffective ? 'Automatic archiving is enabled.' : 'Automatic archiving is disabled in saved settings.';
            const rows = document.getElementById('archiveSections');
            rows.replaceChildren();
            for (const section of data.sections) {
                const tr = document.createElement('tr');
                const label = document.createElement('td'); label.textContent = section.label; tr.appendChild(label);
                const enable = document.createElement('input'); enable.type = 'checkbox'; enable.checked = policy.types[section.kind].enabled; enable.dataset.kind = section.kind;
                enable.setAttribute('aria-label', section.label + ' automatic archiving');
                const eCell = document.createElement('td'); eCell.appendChild(enable); tr.appendChild(eCell);
                const days = document.createElement('input'); days.type = 'number'; days.min = '1'; days.max = '3650'; days.value = policy.types[section.kind].days; days.className = 'form-control form-control-sm'; days.dataset.daysKind = section.kind;
                days.setAttribute('aria-label', section.label + ' retention days');
                const dCell = document.createElement('td'); dCell.appendChild(days); tr.appendChild(dCell);
                for (const n of [section.active, section.archived, section.eligible]) { const td = document.createElement('td'); td.textContent = n.toLocaleString(); tr.appendChild(td); }
                const actions = document.createElement('td');
                const run = document.createElement('button'); run.className = 'btn btn-sm btn-outline-primary mb-1'; run.type = 'button'; run.textContent = 'Preview / archive';
                run.onclick = async () => {
                    run.disabled = true;
                    try {
                        const preview = await request('/api/history-archive/preview', { method: 'POST', body: JSON.stringify({ kind: section.kind, days: policy.types[section.kind].days }) });
                        if (!confirm(`Archive up to 2,500 of ${preview.eligible} eligible ${section.label.toLowerCase()} older than ${preview.cutoff}? Newer and protected records stay active. Archived records remain available through Archived / All.`)) return;
                        const result = await request('/api/history-archive/run', { method: 'POST', body: JSON.stringify({ kind: section.kind, days: policy.types[section.kind].days }) });
                        await refresh(); show(result.message); loadPage(); loadActivityPage(); loadErrors();
                    } catch (e) { show(e.message); } finally { run.disabled = false; }
                };
                actions.appendChild(run);
                const download = document.createElement('button'); download.type = 'button'; download.className = 'btn btn-sm btn-outline-success ms-1 mb-1'; download.textContent = 'Browse downloads';
                download.onclick = () => window.ArchiveDownloadBrowser.open(section);
                actions.appendChild(download); tr.appendChild(actions); rows.appendChild(tr);
            }
            document.getElementById('archiveLastRun').textContent = data.lastRun
                ? `Last automatic run: ${data.lastRun.day} - ${data.lastRun.state}${data.lastRun.error ? '. ' + data.lastRun.error : ''}`
                : 'No automatic archive run yet.';
        } catch (e) { if (panel.classList.contains('d-none')) return; show(e.message); }
    }
    document.getElementById('archiveSave').onclick = async () => {
        if (!policy) return;
        const button = document.getElementById('archiveSave'); button.disabled = true;
        try {
            const value = { automatic: document.getElementById('archiveAutomatic').checked, hourUTC: Number(document.getElementById('archiveHour').value), types: {} };
            for (const kind of Object.keys(policy.types)) value.types[kind] = {
                enabled: panel.querySelector(`[data-kind="${kind}"]`).checked,
                days: Number(panel.querySelector(`[data-days-kind="${kind}"]`).value)
            };
            await request('/api/history-archive', { method: 'PUT', body: JSON.stringify(value) });
            await refresh(); show('Archive settings saved. Recent history and protected records stay active.');
        } catch (e) { show(e.message); } finally { button.disabled = false; }
    };
    document.getElementById('archiveRefresh').onclick = refresh;
    // Authentication is established by audit-log.js before its initial page load.
    const wait = setInterval(() => {
        const user = typeof getCurrentAuthUser === 'function' && getCurrentAuthUser();
        if (!user || !user.id) return;
        clearInterval(wait);
        if (user.role === 'Administrator') refresh();
    }, 200);
    setTimeout(() => clearInterval(wait), 10000);
});
