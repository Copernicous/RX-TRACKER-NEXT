'use strict';

function archiveProgressKey(scope) { return 'rxArchiveDownloadProgress.v1.' + scope; }
function readArchiveProgress(storage, meta) {
    const empty = { version: 1, revision: meta.revision, totalPages: meta.totalPages, page: 1, started: [] };
    try {
        const saved = JSON.parse(storage?.getItem(archiveProgressKey(meta.scope)) || 'null');
        if (!saved || saved.version !== 1 || saved.revision !== meta.revision || saved.totalPages !== meta.totalPages) return empty;
        return { ...empty, page: Number.isSafeInteger(saved.page) && saved.page >= 1 && saved.page <= Math.max(1, meta.totalPages) ? saved.page : 1,
            started: [...new Set((Array.isArray(saved.started) ? saved.started : []).filter(n => Number.isSafeInteger(n) && n >= 1 && n <= meta.totalPages))].sort((a,b) => a-b) };
    } catch { return empty; }
}
function saveArchiveProgress(storage, meta, progress) {
    try { if (!storage) return false; storage.setItem(archiveProgressKey(meta.scope), JSON.stringify(progress)); return true; } catch { return false; }
}
function nextPendingArchivePage(progress) {
    let page = 1;
    for (const n of [...progress.started].sort((a,b) => a-b)) { if (n === page) page++; else if (n > page) break; }
    return page <= progress.totalPages ? page : null;
}
function archivePeriodText(range, timeZone) {
    if (!range?.dateFrom || !range?.dateTo) return 'Date unavailable';
    const format = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'short', day: 'numeric' });
    const from = format.format(new Date(range.dateFrom)), to = format.format(new Date(range.dateTo));
    return from === to ? from : `${from} – ${to}`;
}
if (typeof module !== 'undefined' && module.exports) module.exports = { readArchiveProgress, saveArchiveProgress, nextPendingArchivePage, archivePeriodText };

if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', () => {
    const panel = document.getElementById('archiveDownloadBrowser');
    if (!panel) return;
    let selected, meta, progress, generation = 0, busy = false, storage;
    try { storage = window.localStorage; } catch {}
    const byId = id => document.getElementById(id);
    const summary = byId('archiveDownloadSummary'), body = byId('archiveDownloadPages');
    async function request(url) {
        const response = await fetchWithAuth(url);
        if (!response || !response.ok) {
            const value = response && await response.json().catch(() => ({}));
            const e = Error(value?.error || 'Unable to load archive pages.'); e.status = response?.status; throw e;
        }
        return response;
    }
    function persist() {
        if (!saveArchiveProgress(storage, meta, progress)) byId('archiveDownloadNotice').textContent = 'Browser storage is unavailable. Progress is kept only while this page stays open. A marked page means download started; check browser Downloads to confirm the file was saved. Archived records remain stored.';
    }
    function controls() {
        panel.querySelectorAll('button,input').forEach(el => { el.disabled = busy || !meta; });
        byId('archivePagesRefresh').disabled = busy;
        if (!meta || busy) return;
        byId('archivePagePrevious').disabled = meta.page <= 1 || !meta.totalPages;
        byId('archivePageNext').disabled = meta.page >= meta.totalPages;
        byId('archiveNextPending').disabled = nextPendingArchivePage(progress) === null;
        byId('archivePageGo').disabled = !meta.totalPages;
        byId('archivePageNumber').disabled = !meta.totalPages;
    }
    function render() {
        const started = progress.started.length, pending = meta.totalPages - started;
        summary.textContent = `${meta.totalRecords.toLocaleString()} archived records · ${meta.totalPages.toLocaleString()} pages · ${started} ${started === 1 ? 'download' : 'downloads'} started · ${pending} ${pending === 1 ? 'page' : 'pages'} pending${pending === 0 && meta.totalPages ? ' · All page downloads started' : ''}`;
        byId('archiveDownloadPeriod').textContent = meta.totalRecords ? `Archive covers ${archivePeriodText(meta, meta.timeZone)} (${meta.timeZone}). Dates refer to ${meta.dateField === 'visitedAt' ? 'page visits' : 'when events were recorded'}, not when downloaded. Page date ranges can overlap.` : '';
        byId('archivePageNumber').value = meta.totalPages ? meta.page : '';
        byId('archivePageNumber').max = Math.max(1, meta.totalPages);
        byId('archivePageTotal').textContent = meta.totalPages ? `of ${meta.totalPages}` : 'No pages';
        body.replaceChildren();
        if (!meta.totalPages) {
            const tr = document.createElement('tr'), td = document.createElement('td'); td.colSpan = 5; td.textContent = 'No archived records in this section.'; tr.appendChild(td); body.appendChild(tr);
        }
        for (let page = Math.max(1, meta.page-2); page <= Math.min(meta.totalPages, meta.page+2); page++) {
            const tr = document.createElement('tr'); if (page === meta.page) tr.className = 'table-active';
            const period = meta.pages?.find(value => value.page === page);
            const values = [`${page} of ${meta.totalPages}${page === meta.page ? ' (current)' : ''}`, `${((page-1)*meta.pageSize+1).toLocaleString()}–${Math.min(page*meta.pageSize,meta.totalRecords).toLocaleString()}`, archivePeriodText(period, meta.timeZone), progress.started.includes(page) ? 'Download started' : 'Pending'];
            for (const value of values) { const td = document.createElement('td'); td.textContent = value; tr.appendChild(td); }
            const td = document.createElement('td'), button = document.createElement('button'); button.type = 'button'; button.className = 'btn btn-sm btn-outline-success';
            button.textContent = progress.started.includes(page) ? `Download page ${page} again` : `Download page ${page}`;
            button.onclick = () => download(page); td.appendChild(button); tr.appendChild(td); body.appendChild(tr);
        }
        controls();
    }
    async function load(page, restore = false) {
        if (!selected) return;
        const version = ++generation, section = selected;
        busy = true; controls(); summary.textContent = 'Loading archive pages…';
        try {
            const pinned = !restore && meta ? '&revision=' + encodeURIComponent(meta.revision) : '';
            let response = await request(`/api/history-archive/${section.kind}/pages?page=${page}${pinned}`);
            let value = await response.json();
            if (version !== generation) return;
            if (restore || !progress) progress = readArchiveProgress(storage, value);
            if (restore && progress.page !== value.page) {
                response = await request(`/api/history-archive/${section.kind}/pages?page=${progress.page}&revision=${encodeURIComponent(value.revision)}`);
                value = await response.json();
            }
            if (version !== generation) return;
            meta = value; progress.page = value.page; persist(); busy = false; render();
        } catch (e) {
            if (version !== generation) return;
            meta = null; body.replaceChildren(); summary.textContent = e.message; busy = false; controls();
        }
    }
    async function download(page) {
        if (busy || !meta) return;
        const version = generation, section = selected, snapshot = meta;
        busy = true; controls();
        try {
            const response = await request(`/api/history-archive/${section.kind}/download?page=${page}&revision=${encodeURIComponent(snapshot.revision)}`);
            const blob = await response.blob();
            if (version !== generation) return;
            const filename = response.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] || `rx-history-${section.kind}-page-${page}.json.gz`;
            const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = filename;
            document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
            if (!progress.started.includes(page)) progress.started.push(page);
            progress.started.sort((a,b) => a-b); persist(); busy = false; render();
        } catch (e) {
            if (version !== generation) return;
            busy = false;
            if (e.status === 409) { meta = null; body.replaceChildren(); }
            summary.textContent = e.message; controls();
        }
    }
    byId('archivePagePrevious').onclick = () => load(meta.page-1);
    byId('archivePageNext').onclick = () => load(meta.page+1);
    function jump() {
        const page = Number(byId('archivePageNumber').value);
        if (!meta || !Number.isSafeInteger(page) || page < 1 || page > meta.totalPages) { summary.textContent = `Choose a page from 1 to ${meta?.totalPages || 0}.`; return; }
        load(page);
    }
    byId('archivePageGo').onclick = jump;
    byId('archivePageNumber').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); jump(); } });
    byId('archiveNextPending').onclick = () => { const page = nextPendingArchivePage(progress); if (page) load(page); };
    byId('archivePagesRefresh').onclick = () => load(1, true);
    window.ArchiveDownloadBrowser = { open(section) {
        if (busy) return;
        selected = section; meta = null; progress = null; panel.classList.remove('d-none'); body.replaceChildren();
        byId('archiveDownloadTitle').textContent = 'Archive downloads — ' + section.label;
        load(1, true); panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } };
});
