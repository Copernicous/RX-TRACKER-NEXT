/* Experimental staging-only patient review. The legacy importer remains the default. */
'use strict';

function showImportFormatErrorV2(file, message) {
    document.getElementById('importV2Corrections')?.remove();
    const panel = document.createElement('div'); panel.id = 'importV2Corrections'; panel.className = 'alert alert-danger mt-3';
    const note = document.createElement('p'); note.textContent = 'Nothing saved. Validation needs attention: ' + message; panel.appendChild(note);
    function download(blob, name) {
        const url = URL.createObjectURL(blob), link = Object.assign(document.createElement('a'), { href: url, download: name });
        document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
    }
    const original = document.createElement('button'); original.type = 'button'; original.className = 'btn btn-outline-primary me-2';
    original.textContent = 'Download original unsaved file'; original.onclick = () => download(file, 'unsaved-' + file.name); panel.appendChild(original);
    const notes = document.createElement('button'); notes.type = 'button'; notes.className = 'btn btn-outline-secondary';
    notes.textContent = 'Download file error notes (TXT)'; notes.onclick = () => download(new Blob(['Nothing saved.\r\n' + message], { type: 'text/plain;charset=utf-8' }), 'patient-import-file-errors.txt'); panel.appendChild(notes);
    document.getElementById('resultsBox').after(panel);
}

function downloadCorrectionV2(packet, suffix = 'corrections') {
    if (!packet.rows.length) return;
    const url = URL.createObjectURL(new Blob([ImportReviewModel.encode(packet.headers, packet.rows)], { type: 'text/csv;charset=utf-8' }));
    const link = Object.assign(document.createElement('a'), { href: url, download: 'patient-import-' + suffix + '.csv' });
    document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
}

async function previewImportV2(file, revision) {
    importBusy = true;
    const confirm = document.getElementById('confirmImportBtn');
    confirm.disabled = true;
    try {
        const form = new FormData();
        form.append('file', file); form.append('mode', 'preview');
        form.append('reviewMode', 'merge'); form.append('reviewVersion', '2');
        const response = await fetchWithAuth('/api/import/patients', { method: 'POST', body: form });
        if (!response) return;
        const data = await response.json();
        if (revision !== selectedRevision) return;
        if (!response.ok) throw Error(data.error || 'Validation failed');
        if (data.aborted && !data.reviewRequired) {
            invalidRows = data.errors.map(e => ({ _rowNum: e.row, _errors: [e.error] }));
            displayResults(data);
            await storeCorrectionFile(file, data, revision); return;
        }
        invalidRows = []; validRows = parsedRows;
        if (data.reviewRequired) showDuplicateReview(data);
        else { pendingDuplicateReview = null; document.getElementById('previewBadge').textContent = 'Server validation passed'; }
    } catch (error) {
        showToast(error.message, 'danger');
        showImportFormatErrorV2(file, error.message);
    } finally {
        importBusy = false;
        // Reopening the same review keeps decisions and merge-field selections in memory.
        confirm.disabled = invalidRows.length > 0 || !validRows.length;
        confirm.textContent = pendingDuplicateReview ? 'Resume patient review' : 'Confirm Import';
    }
}

function showImportV2Corrections(data) {
    document.getElementById('importV2Corrections')?.remove();
    const deferred = !data.aborted && reviewV2Session ? reviewV2Session.items.filter(i => i.decision.action === 'defer').map(i => i.row) : [];
    const packet = ImportReviewModel.correction(reviewHeaders, parsedRows, data.errors || [], deferred);
    if (!packet.rows.length) return;
    const panel = document.createElement('div');
    panel.id = 'importV2Corrections'; panel.className = 'alert alert-warning mt-3';
    const description = document.createElement('p');
    description.textContent = data.aborted
        ? 'Nothing saved. Download the correction rows. You can validate and save the other rows separately; each selected batch still saves together.'
        : packet.rows.length + ' rows were deferred and NOT saved. Download these rows for a later correction upload.';
    panel.appendChild(description);
    const download = document.createElement('button'); download.type = 'button'; download.className = 'btn btn-outline-primary me-2';
    download.textContent = 'Download ' + packet.rows.length + ' correction rows (CSV)';
    download.onclick = () => downloadCorrectionV2(packet); panel.appendChild(download);
    if (data.aborted) {
        const failed = new Set((data.errors || []).map(e => e.row));
        const remaining = parsedRows.filter(r => !failed.has(r._rowNum));
        if (remaining.length) {
            const continueButton = document.createElement('button'); continueButton.type = 'button'; continueButton.className = 'btn btn-primary';
            continueButton.textContent = 'Validate the other ' + remaining.length + ' rows';
            continueButton.onclick = async () => {
                if (importBusy) return;
                // Source locators are notes, never patient keys or validation bypasses.
                const headers = [...reviewHeaders.filter(h => h !== '_reviewSourceRow'), '_reviewSourceRow'];
                const values = remaining.map(r => ({ ...r, _reviewSourceRow: r._reviewSourceRow || r._rowNum }));
                reviewUploadFile = new File([ImportReviewModel.encode(headers, values)], reviewUploadFile.name.replace(/\.csv$/i, '') + '-valid-rows.csv', { type: 'text/csv' });
                reviewHeaders = headers;
                parsedRows = parseCSV(await reviewUploadFile.text()).rows;
                validRows = parsedRows; invalidRows = []; duplicateReviewToken = ''; duplicateDecisions = []; reviewV2Session = null;
                panel.remove();
                await previewImportV2(reviewUploadFile, selectedRevision);
            };
            panel.appendChild(continueButton);
        }
        const pending = document.createElement('button'); pending.type = 'button'; pending.className = 'btn btn-outline-secondary ms-2';
        pending.textContent = 'Download all unsaved rows';
        // An aborted transaction saved neither the errors nor the valid rows.
        pending.onclick = () => {
            const url = URL.createObjectURL(reviewUploadFile);
            const link = Object.assign(document.createElement('a'), { href: url, download: 'patient-import-all-unsaved.csv' });
            document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
        };
        panel.appendChild(pending);
    }
    document.getElementById('resultsBox').after(panel);
}
