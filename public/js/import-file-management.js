'use strict';
let correctionFilesPage = 1;
let correctionFilesBusy = false;

document.addEventListener('DOMContentLoaded', () => {
    if (window.RX_IMPORT_REVIEW_V2 !== true) return;
    document.getElementById('patientImportHistory').open = true;
    document.getElementById('filesToCorrectTab').addEventListener('shown.bs.tab', () => loadCorrectionFiles());
    document.getElementById('correctedFilesTab').addEventListener('shown.bs.tab', () => loadCorrectionFiles());
    document.getElementById('refreshCorrectionFilesBtn').onclick = () => loadCorrectionFiles();
    document.getElementById('previousCorrectionFilesBtn').onclick = () => loadCorrectionFiles(correctionFilesPage - 1);
    document.getElementById('nextCorrectionFilesBtn').onclick = () => loadCorrectionFiles(correctionFilesPage + 1);
    document.getElementById('reviewCorrectedFileBtn').onclick = reviewCorrectedFile;
    document.getElementById('importHistoryTab').addEventListener('shown.bs.tab', () => { document.getElementById('correctionFilesPager').classList.add('d-none'); });
    document.getElementById('correctionFilesPager').classList.add('d-none');
});

async function storeCorrectionFile(file, data, revision) {
    const form = new FormData(); form.append('file', file);
    try {
        const res = await fetchWithAuth('/api/import/patient-corrections', { method: 'POST', body: form });
        if (!res) return;
        const result = await res.json();
        if (!res.ok) throw Error(result.error || 'Unable to retain correction file.');
        if (revision !== selectedRevision) return;
        if (result.ids.length === 1) originalCorrectionSourceId = result.ids[0];
        const panel = document.getElementById('importV2Corrections');
        const download = panel?.querySelector('button');
        if (download && result.ids.length === 1) {
            download.textContent = result.pendingCount ? 'View Files to Correct' : 'View Corrected Files'; download.onclick = () => bootstrap.Tab.getOrCreateInstance(document.getElementById(result.pendingCount ? 'filesToCorrectTab' : 'correctedFilesTab')).show();
            const allUnsaved = [...(panel?.querySelectorAll('button') || [])].find(button => button.textContent === 'Download all unsaved rows'); allUnsaved?.remove();
        }
        const message = document.createElement('p'); message.className = 'small mt-2 mb-0';
        message.textContent = result.pendingCount ? 'Error rows saved in Files to Correct.' : 'These error rows were already corrected. See Corrected Files.'; panel?.appendChild(message);
        await loadCorrectionFiles();
    } catch (e) {
        // Keep the local CSV download available if retaining the file fails.
        showToast(e.message + ' You can still download the errors from this page.', 'warning');
    }
}

async function downloadStoredCorrectionFile(id) {
    try {
        const res = await fetchWithAuth('/api/import/patient-corrections/' + id);
        if (!res) return;
        const packet = await res.json();
        if (!res.ok) throw Error(packet.error || 'Unable to download correction file.');
        if (!packet.rows.length) { showToast('All rows in this correction file are already completed.', 'info'); return; }
        downloadCorrectionV2(packet, 'corrections-' + id);
    } catch (e) { showToast(e.message, 'danger'); }
}

async function loadCorrectionFiles(page = correctionFilesPage) {
    if (window.RX_IMPORT_REVIEW_V2 !== true || correctionFilesBusy) return;
    correctionFilesBusy = true;
    const pending = document.getElementById('correctionFilesList'), completed = document.getElementById('correctedFilesList');
    try {
        const res = await fetchWithAuth('/api/import/patient-corrections?page=' + Math.max(1, page));
        if (!res) return;
        const data = await res.json();
        if (!res.ok) throw Error(data.error || 'Unable to load correction files.');
        correctionFilesPage = data.page;
        pending.replaceChildren(); completed.replaceChildren();
        function table(container, titles) {
            const table = document.createElement('table'); table.className = 'table table-sm table-bordered align-middle';
            const header = document.createElement('tr'); titles.forEach(title => { const th = document.createElement('th'); th.textContent = title; header.appendChild(th); });
            const head = document.createElement('thead'); head.appendChild(header); table.appendChild(head);
            const body = document.createElement('tbody'); table.appendChild(body); container.appendChild(table); return body;
        }
        function cells(body, values) {
            const row = document.createElement('tr'); values.forEach(v => { const cell = document.createElement('td'); cell.textContent = String(v ?? ''); row.appendChild(cell); }); body.appendChild(row); return row;
        }
        const remaining = data.files.filter(file => file.pendingCount > 0);
        if (!remaining.length) pending.textContent = 'No files need correction on this page.';
        else {
            const body = table(pending, ['Original upload', 'Recorded', 'Rows to correct', 'Error file']);
            remaining.forEach(file => {
                const row = cells(body, [file.fileName, new Date(file.recordedAt).toLocaleString(), file.pendingCount]);
                const cell = document.createElement('td'), button = document.createElement('button'); button.type = 'button'; button.className = 'btn btn-sm btn-outline-primary';
                button.textContent = 'Download errors'; button.onclick = () => downloadStoredCorrectionFile(file.id); cell.appendChild(button);
                const original = document.createElement('button'); original.type = 'button'; original.className = 'btn btn-sm btn-outline-secondary ms-1'; original.textContent = 'Original upload'; original.onclick = () => downloadOriginalImportedFile('/api/import/patient-corrections/' + file.id + '/original-file'); cell.appendChild(original); row.appendChild(cell);
            });
        }
        const uploaded = data.files.flatMap(file => file.correctedUploads.map(upload => ({ ...upload, originalFile: file.fileName, pendingCount: file.pendingCount }))).sort((a,b) => new Date(b.recordedAt) - new Date(a.recordedAt));
        if (!uploaded.length) completed.textContent = 'No corrected files have been saved on this page.';
        else {
            const body = table(completed, ['Corrected upload', 'Original upload', 'Saved rows', 'Still to correct', 'Import report']);
            uploaded.forEach(upload => {
                const row = cells(body, [upload.fileName, upload.originalFile, upload.correctedCount, upload.pendingCount]);
                const cell = document.createElement('td'), button = document.createElement('button'); button.type = 'button'; button.className = 'btn btn-sm btn-outline-primary';
                button.textContent = 'Download report'; button.onclick = () => downloadStoredImportReport(upload.reportId); cell.appendChild(button);
                const corrected = document.createElement('button'); corrected.type = 'button'; corrected.className = 'btn btn-sm btn-outline-secondary ms-1'; corrected.textContent = 'Download corrected file'; corrected.onclick = () => downloadOriginalImportedFile('/api/import/patient-reports/' + upload.reportId + '/uploaded-file'); cell.appendChild(corrected); row.appendChild(cell);
            });
        }
        document.getElementById('correctionFilesPage').textContent = 'Page ' + data.page + ' of ' + Math.max(1, Math.ceil(data.total/data.pageSize));
        document.getElementById('previousCorrectionFilesBtn').disabled = data.page <= 1;
        document.getElementById('nextCorrectionFilesBtn').disabled = data.page*data.pageSize >= data.total;
        document.getElementById('correctionFilesPager').classList.toggle('d-none', document.getElementById('importHistoryTab').classList.contains('active'));
    } catch (e) { pending.textContent = e.message; completed.textContent = e.message; }
    finally { correctionFilesBusy = false; }
}

async function reviewCorrectedFile() {
    if (importBusy) return;
    const file = document.getElementById('correctedCsvFile').files[0];
    if (!file) { showToast('Select the corrected CSV first.', 'warning'); return; }
    try {
        const parsed = parseCSV(await file.text());
        if (!parsed.rows.length || parsed.rows.some(row => !/^\d+$/.test(row._reviewCorrectionId || '') || !/^[a-f0-9]{32}$/.test(row._reviewItemId || ''))) {
            throw Error('Use a CSV downloaded from Files to Correct, keeping its correction reference columns.');
        }
        selectDataset('patients');
        const transfer = new DataTransfer(); transfer.items.add(file);
        const input = document.getElementById('csvFile'); input.files = transfer.files; fileSelected(input);
        await executeImport({ preventDefault() {} });
        document.getElementById('previewSection').scrollIntoView({ block: 'start', behavior: 'smooth' });
    } catch (e) { showToast(e.message, 'danger'); }
}

async function downloadOriginalImportedFile(url) {
    try {
        const res = await fetchWithAuth(url);
        if (!res) return;
        if (!res.ok) { const data = await res.json(); throw Error(data.error || 'Unable to download original file.'); }
        const disposition = res.headers.get('Content-Disposition') || '';
        const match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
        const filename = match ? decodeURIComponent(match[1]) : 'uploaded.csv';
        const blob = await res.blob(), objectUrl = URL.createObjectURL(blob);
        const link = Object.assign(document.createElement('a'), { href: objectUrl, download: filename });
        document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(objectUrl);
    } catch (e) { showToast(e.message, 'danger'); }
}
