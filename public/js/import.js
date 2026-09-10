// import.js — Extracted from inline script.
// FortiGate .map().join() corruption fix applied.

    let currentDataset = 'patients';
    let parsedRows  = [];
    let validRows   = [];
    let invalidRows = [];
    let duplicateReviewToken = '';
    let duplicateSkipRows = [];
    let duplicateDecisions = [];
    let pendingDuplicateReview = null;
    let importBusy = false;
    let selectedRevision = 0;
    let importHistoryPage = 1;
    let importHistoryBusy = false;
    const importEscape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

    const DATASET_SPECS = {
        'patients': {
            title: 'Patients Import',
            desc: 'Import patients with validation and review possible matches. For each flagged row, discard it, create a separate patient when allowed, or merge selected fields into an existing patient. Matching name and DOB or Patient ID prevents creating another patient. A detailed CSV report is available after saving.',
            fields: [
                { name: 'patientCode', req: false, format: 'e.g. PAT-00001 (Auto-generated if blank)' },
                { name: 'firstName',   req: true,  format: 'Plain Text' },
                { name: 'lastName',    req: true,  format: 'Plain Text' },
                { name: 'dob',         req: true,  format: 'MM/DD/YYYY (e.g. 05/15/1985)' },
                { name: 'phone',       req: false, format: '123-456-7890' },
                { name: 'address',     req: false, format: 'Full address; older CSVs still supported' },
                { name: 'addressLine1', req: false, format: 'Street / apt / building' },
                { name: 'city',        req: false, format: 'City' },
                { name: 'state',       req: false, format: 'State' },
                { name: 'zipCode',     req: false, format: 'ZIP code' },
                { name: 'region',      req: false, format: 'Existing Region/City Patient Tag, e.g. Miami or Region: Tampa' },
                { name: 'patientTags', req: false, format: 'Existing tags separated by ; or |' },
                { name: 'patientTagIds', req: false, format: 'Existing tag IDs separated by ; or |' },
                { name: 'clinic',      req: false, format: 'Clinic Name or ID' },
                { name: 'serviceDate', req: false, format: 'MM/DD/YYYY (e.g. 01/01/2026)' },
                { name: 'patientTransportCompany',  req: false, format: 'Contact, Company Name, or ID' },
                { name: 'pharmacyTransportCompany', req: false, format: 'Contact, Company Name, or ID' },
                { name: 'notes',    req: false, format: 'Plain Text' },
                { name: 'isActive', req: false, format: 'true/false (Default: true)' },
                { name: 'RX Received Warehouse', req: false, format: 'MM/DD/YYYY (e.g. 06/24/2026)' },
                { name: 'On Route with Driver', req: false, format: 'MM/DD/YYYY (e.g. 06/24/2026)' },
                { name: 'Delivered', req: false, format: 'MM/DD/YYYY (e.g. 06/24/2026)' },
                { name: 'Mark as Received to print log', req: false, format: 'MM/DD/YYYY (e.g. 06/24/2026)' },
                { name: 'Signed by Pharmacy', req: false, format: 'MM/DD/YYYY (e.g. 06/24/2026)' },
                { name: 'Archived on local and case close', req: false, format: 'MM/DD/YYYY (e.g. 06/24/2026)' }
            ],
            dateFields: [
                'dob',
                'serviceDate',
                'RX Received Warehouse',
                'On Route with Driver',
                'Delivered',
                'Mark as Received to print log',
                'Signed by Pharmacy',
                'Archived on local and case close'
            ],
            requiredFields: ['firstName','lastName','dob']
        },
        'pharmacies': {
            title: 'Pharmacies Import',
            desc: 'Import pharmacy details. Duplicate pharmacy names will be skipped.',
            fields: [
                { name: 'name',          req: true,  format: 'Plain Text' },
                { name: 'address',       req: false, format: 'Street, City' },
                { name: 'phone',         req: false, format: 'Phone Number' },
                { name: 'contactPerson', req: false, format: 'Contact Name' },
                { name: 'notes',         req: false, format: 'Plain Text' },
                { name: 'isActive',      req: false, format: 'true/false (Default: true)' }
            ],
            dateFields: [],
            requiredFields: ['name']
        },
        'clinics': {
            title: 'Clinics Import',
            desc: 'Import clinic details. Duplicate clinic names will be skipped.',
            fields: [
                { name: 'name',          req: true,  format: 'Plain Text' },
                { name: 'address',       req: false, format: 'Street, City' },
                { name: 'phone',         req: false, format: 'Phone Number' },
                { name: 'contactPerson', req: false, format: 'Contact Name' },
                { name: 'notes',         req: false, format: 'Plain Text' },
                { name: 'isActive',      req: false, format: 'true/false (Default: true)' }
            ],
            dateFields: [],
            requiredFields: ['name']
        },
        'patient-transport': {
            title: 'Patient Transport Companies Import',
            desc: 'Import companies that deliver patients. Duplicate contact persons will be skipped if company name is missing.',
            fields: [
                { name: 'companyName',   req: false, format: 'Plain Text' },
                { name: 'phone',         req: false, format: 'Phone Number' },
                { name: 'contactPerson', req: true,  format: 'Contact Name' },
                { name: 'notes',         req: false, format: 'Plain Text' },
                { name: 'isActive',      req: false, format: 'true/false (Default: true)' }
            ],
            dateFields: [],
            requiredFields: ['contactPerson']
        },
        'pharmacy-transport': {
            title: 'Pharmacy Transport Companies Import',
            desc: 'Import companies that deliver from pharmacies. Duplicate company names will be skipped.',
            fields: [
                { name: 'companyName',   req: true,  format: 'Plain Text' },
                { name: 'phone',         req: false, format: 'Phone Number' },
                { name: 'contactPerson', req: false, format: 'Contact Name (optional)' },
                { name: 'notes',         req: false, format: 'Plain Text' },
                { name: 'isActive',      req: false, format: 'true/false (Default: true)' }
            ],
            dateFields: [],
            requiredFields: ['companyName']
        },
        'workflow-actions': {
            title: 'Workflow Actions Import',
            desc: 'Import state stages for rx tracking. Both action names and sequence numbers must be globally unique.',
            fields: [
                { name: 'name',           req: true,  format: 'Plain Text' },
                { name: 'description',    req: false, format: 'Plain Text' },
                { name: 'sequenceNumber', req: true,  format: 'Integer (Unique)' },
                { name: 'isActive',       req: false, format: 'true/false (Default: true)' }
            ],
            dateFields: [],
            requiredFields: ['name','sequenceNumber']
        },
        'users': {
            title: 'Users Import',
            desc: 'Import system operator profiles. Username and email must be unique. Passwords will be automatically encrypted.',
            fields: [
                { name: 'firstName', req: true,  format: 'Plain Text' },
                { name: 'lastName',  req: true,  format: 'Plain Text' },
                { name: 'username',  req: true,  format: 'Unique string' },
                { name: 'email',     req: true,  format: 'name@domain.com' },
                { name: 'password',  req: true,  format: 'Secure password text' },
                { name: 'role',      req: true,  format: 'Administrator | Supervisor | Operator | Read Only  (or ID: 1 / 2 / 3 / 4)' },
                { name: 'notes',     req: false, format: 'Optional description or note about this user' },
                { name: 'isActive',  req: false, format: 'true/false (Default: true)' }
            ],
            dateFields: [],
            requiredFields: ['firstName','lastName','username','email','password','role']
        }
    };

    document.addEventListener('DOMContentLoaded', () => {
        initApp();

        const user = typeof getCurrentAuthUser === 'function' ? getCurrentAuthUser() : (window.__RX_AUTH_USER || {});
        if (!userCanImport(user)) {
            document.getElementById('accessDeniedPanel').classList.remove('d-none');
        } else {
            document.getElementById('importPanel').classList.remove('d-none');
            selectDataset('patients');
        }

        const dropZone = document.getElementById('dropZone');
        dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.style.borderColor = 'var(--primary)'; });
        dropZone.addEventListener('dragleave', () => { dropZone.style.borderColor = 'var(--border)'; });
        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            if (importBusy) return;
            dropZone.style.borderColor = 'var(--border)';
            if (e.dataTransfer.files.length) {
                const input = document.getElementById('csvFile');
                input.files = e.dataTransfer.files;
                fileSelected(input);
            }
        });

        document.getElementById('importForm').addEventListener('submit', executeImport);
        document.getElementById('downloadTemplateBtn').addEventListener('click', downloadTemplate);
        document.getElementById('confirmImportBtn').addEventListener('click', confirmImport);
        document.getElementById('patientImportHistory').addEventListener('toggle', event => {
            if (event.target.open) loadImportHistory(1);
        });
        document.getElementById('refreshImportHistoryBtn').addEventListener('click', () => loadImportHistory(1));
        document.getElementById('previousImportHistoryBtn').addEventListener('click', () => loadImportHistory(importHistoryPage - 1));
        document.getElementById('nextImportHistoryBtn').addEventListener('click', () => loadImportHistory(importHistoryPage + 1));
        document.getElementById('cancelPreviewBtn').addEventListener('click', () => {
            document.getElementById('previewSection').classList.add('d-none');
            document.getElementById('uploadBtn').disabled = false;
        });
    });

    function userCanImport(user) {
        if (!user) return false;

        try {
            if (typeof getPagePerms === 'function') {
                const pagePerms = getPagePerms();
                return !!(pagePerms && pagePerms.visible && (pagePerms.canAdd || pagePerms.canEdit));
            }
        } catch (e) {}

        const permissions = user.permissions || window.__RX_AUTH_PERMS || {};
        const importPerm = permissions.import || {};
        return !!(importPerm.visible && (importPerm.canAdd || importPerm.canEdit));
    }

    function selectDataset(dataset) {
        if (importBusy) return;
        resetDuplicateReview();
        currentDataset = dataset;
        const spec = DATASET_SPECS[dataset];
        document.getElementById('datasetNameTitle').textContent = spec.title;
        document.getElementById('datasetDescription').textContent = spec.desc;
        const tbody = document.getElementById('csvFieldsBody');
        var _sf=''; spec.fields.forEach(function(f){
            _sf += '<tr><td><code>' + f.name + '</code></td>' +
            '<td><span class="badge ' + (f.req ? 'bg-danger' : 'bg-secondary') + '">' + (f.req ? 'Yes' : 'No') + '</span></td>' +
            '<td class="text-muted">' + f.format + '</td></tr>'

        });
        tbody.innerHTML = _sf;
        document.getElementById('csvFile').value = '';
        document.getElementById('fileNameDisplay').classList.add('d-none');
        document.getElementById('uploadBtn').disabled = true;
        document.getElementById('resultsBox').style.display = 'none';
        document.getElementById('previewSection').classList.add('d-none');
        parsedRows = []; validRows = []; invalidRows = [];
    }

    function fileSelected(input) {
        resetDuplicateReview();
        const file = input.files[0];
        const display = document.getElementById('fileNameDisplay');
        const uploadBtn = document.getElementById('uploadBtn');
        if (file) {
            display.textContent = 'Selected: ' + file.name + ' (' + (file.size / 1024).toFixed(1) + ' KB)';
            display.classList.remove('d-none');
            uploadBtn.disabled = false;
        } else {
            display.classList.add('d-none');
            uploadBtn.disabled = true;
        }
        document.getElementById('previewSection').classList.add('d-none');
        document.getElementById('resultsBox').style.display = 'none';
    }

    // ---- CSV Parser ----
    function parseCSVLine(line) {
        const values = [];
        let current = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            const next = line[i + 1];
            if (ch === '"' && inQuotes && next === '"') {
                current += '"';
                i++;
            } else if (ch === '"') {
                inQuotes = !inQuotes;
            } else if (ch === ',' && !inQuotes) {
                values.push(current);
                current = '';
            } else {
                current += ch;
            }
        }
        values.push(current);
        return values.map(value => value.trim());
    }

    function parseCSV(text) {
        const records = [];
        let values = [], value = '', quoted = false;
        const source = text.replace(/^\uFEFF/, '');
        for (let i = 0; i < source.length; i++) {
            const ch = source[i];
            if (ch === '"' && quoted && source[i + 1] === '"') { value += '"'; i++; }
            else if (ch === '"') quoted = !quoted;
            else if (ch === ',' && !quoted) { values.push(value.trim()); value = ''; }
            else if ((ch === '\n' || ch === '\r') && !quoted) {
                values.push(value.trim()); records.push(values); values = []; value = '';
                if (ch === '\r' && source[i + 1] === '\n') i++;
            } else value += ch;
        }
        if (quoted) throw new Error('CSV contains an unclosed quoted field.');
        if (value || values.length) { values.push(value.trim()); records.push(values); }
        const headers = records.shift() || [];
        const rows = records.map((cells, i) => {
            const row = { _rowNum: i + 2 };
            headers.forEach((header, j) => { row[header] = cells[j] || ''; });
            return row;
        });
        return { headers, rows };
    }

    // ---- Client-side Validator ----
    function validateRows(rows) {
        const spec     = DATASET_SPECS[currentDataset];
        const required = spec.requiredFields || [];
        const dateFlds = spec.dateFields || [];
        // Accept MM/DD/YYYY or YYYY-MM-DD
        const dateRe   = /^(\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2})$/;
        const emailRe  = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

        return rows.map(row => {
            const errors = [];
            required.forEach(f => { if (!row[f] || !row[f].trim()) errors.push('"' + f + '" is required'); });
            dateFlds.forEach(f => { if (row[f] && !dateRe.test(row[f].trim())) errors.push('"' + f + '" must be MM/DD/YYYY'); });
            if (currentDataset === 'users' && row.email && !emailRe.test(row.email)) errors.push('"email" format invalid');
            if (currentDataset === 'workflow-actions' && row.sequenceNumber && isNaN(parseInt(row.sequenceNumber))) errors.push('"sequenceNumber" must be an integer');
            return { ...row, _errors: errors };
        });
    }

    // ---- Execute Import: preview first ----
    async function executeImport(e) {
        e.preventDefault();
        if (importBusy) return;
        resetDuplicateReview();
        const revision = selectedRevision;
        const fileInput = document.getElementById('csvFile');
        const file = fileInput.files[0];
        if (!file) return;

        const uploadBtn = document.getElementById('uploadBtn');
        uploadBtn.disabled = true;

        let text;
        try { text = await file.text(); }
        catch (err) { showToast('Unable to read CSV file.', 'danger'); uploadBtn.disabled = false; return; }
        if (revision !== selectedRevision) return;
        let parsed;
        try { parsed = parseCSV(text); }
        catch (err) { showToast(err.message, 'danger'); uploadBtn.disabled = false; return; }
        const { headers, rows } = parsed;

        if (!rows.length) {
            showToast('CSV file appears empty or has no data rows.', 'warning');
            uploadBtn.disabled = false;
            return;
        }

        const validated = validateRows(rows);
        validRows   = validated.filter(r => !r._errors.length);
        invalidRows = validated.filter(r =>  r._errors.length);
        parsedRows  = validated;

        renderPreview(headers, validated);
        if (currentDataset === 'patients' && invalidRows.length === 0) {
            importBusy = true;
            document.getElementById('confirmImportBtn').disabled = true;
            try {
                const form = new FormData();
                form.append('file', file);
                form.append('mode', 'preview');
                form.append('reviewMode', 'merge');
                const res = await fetchWithAuth('/api/import/patients', { method: 'POST', body: form });
                if (!res) return;
                const data = await res.json();
                if (revision !== selectedRevision) return;
                if (!res.ok) throw new Error(data.error || 'Validation failed');
                if (data.reviewRequired) showDuplicateReview(data);
                else if (data.aborted) {
                    document.getElementById('previewSection').classList.add('d-none');
                    displayResults(data);
                } else {
                    document.getElementById('previewBadge').textContent = 'Server validation passed';
                }
            } catch (err) {
                showToast(err.message || 'Unable to validate patients', 'danger');
                document.getElementById('previewSection').classList.add('d-none');
            } finally {
                importBusy = false;
                document.getElementById('confirmImportBtn').disabled = false;
                uploadBtn.disabled = false;
            }
        }
    }

    function resetDuplicateReview() {
        selectedRevision++;
        duplicateReviewToken = '';
        duplicateSkipRows = [];
        duplicateDecisions = [];
        pendingDuplicateReview = null;
        const modal = document.getElementById('duplicateReviewModal');
        if (modal) bootstrap.Modal.getInstance(modal)?.hide();
    }

    function showDuplicateReview(data) {
        pendingDuplicateReview = data;
        duplicateReviewToken = '';
        duplicateDecisions = [];
        const body = document.getElementById('duplicateReviewBody');
        const button = document.getElementById('acceptDuplicateImportBtn');
        const describe = p => importEscape([p.patientCode || 'New patient', [p.firstName, p.lastName].filter(Boolean).join(' '),
            'DOB: ' + (p.dob || 'Not set'), 'Phone: ' + (p.phone || 'Not set'),
            p.isDeleted ? 'Deleted' : p.isActive === false ? 'Inactive' : ''].filter(Boolean).join(' | '));
        const value = (p, key) => key === 'address'
            ? (p.address || [p.addressLine1, p.city, p.state, p.zipCode].filter(Boolean).join(', ')) : p[key];
        const text = (p, key) => {
            const v = value(p, key);
            return data.lookupLabels?.[key]?.[v] || (v === null || v === undefined || v === '' ? '(empty)' : String(v));
        };
        const empty = v => v === null || v === undefined || String(v).trim() === '';
        function target(card) {
            return card.review.matches.find(m => m.source === 'database' && String(m.patient.id) === card.querySelector('.merge-target')?.value)?.patient;
        }
        function updateSummary() {
            const cards = Array.from(body.querySelectorAll('.duplicate-card'));
            const choices = cards.map(card => card.querySelector('.duplicate-decision').value);
            const skipped = choices.filter(choice => choice === 'skip').length;
            const merged = choices.filter(choice => choice === 'merge').length;
            button.disabled = choices.some(choice => !choice) || cards.some(card => card.querySelector('.duplicate-decision').value === 'merge' && (!target(card) || ((target(card).isDeleted || target(card).isActive === false) && !card.querySelector('.confirm-restore')?.checked)));
            button.textContent = 'Save: ' + (validRows.length - skipped - merged) + ' new, ' + merged + ' merged, ' + skipped + ' discarded';
        }
        function updateResults(card) {
            const existing = target(card);
            if (!existing) return;
            card.querySelectorAll('.merge-field').forEach(select => {
                const key = select.dataset.field;
                const old = value(existing, key), incoming = value(card.review.patient, key);
                const useIncoming = !empty(incoming) && (select.value === 'incoming' || (select.value === 'fill' && empty(old)));
                let result = useIncoming ? text(card.review.patient, key) : text(existing, key);
                if (select.value === 'append' && !empty(incoming)) result = [old, incoming].filter(v => !empty(v)).join('\n');
                select.closest('tr').querySelector('.merge-result').textContent = result;
            });
        }
        function renderFields(card) {
            const container = card.querySelector('.merge-fields');
            const existing = target(card);
            container.innerHTML = '';
            if (!existing) return;
            let html = '<div class="table-responsive"><table class="table table-sm table-bordered align-middle"><thead><tr><th>Field</th><th>Existing</th><th>Incoming</th><th>Choice</th><th>After merge</th></tr></thead><tbody>';
            data.mergeFields.forEach(([key, label]) => {
                html += '<tr><th>' + importEscape(label) + '</th><td style="white-space:pre-wrap;overflow-wrap:anywhere">' + importEscape(text(existing, key)) + '</td><td style="white-space:pre-wrap;overflow-wrap:anywhere">' + importEscape(text(card.review.patient, key)) + '</td>' +
                    '<td><select class="form-select form-select-sm merge-field" aria-label="' + importEscape(label) + ' merge choice" data-field="' + key + '">' +
                    '<option value="fill">Fill if empty</option><option value="keep">Keep existing</option><option value="incoming">Use incoming</option>' +
                    (key === 'notes' ? '<option value="append">Append incoming notes</option>' : '') + '</select></td><td class="merge-result" style="white-space:pre-wrap;overflow-wrap:anywhere"></td></tr>';
            });
            container.innerHTML = html + '</tbody></table></div>';
            if (existing.isDeleted || existing.isActive === false) {
                container.insertAdjacentHTML('afterbegin', '<div class="alert alert-warning"><strong>This patient is ' + (existing.isDeleted ? 'deleted' : 'inactive') + '.</strong><label class="d-block mt-2"><input type="checkbox" class="form-check-input confirm-restore"> Restore/reactivate this patient and merge the selected fields. This makes the existing patient active and restores their linked hidden RX records.</label></div>');
            }
            updateResults(card);
        }
        body.innerHTML = '';
        data.warnings.forEach(w => {
            const card = document.createElement('section');
            card.className = 'duplicate-card border rounded p-3 mb-3';
            card.review = w;
            let html = '<h6>CSV row ' + w.row + '</h6><p>' + describe(w.patient) + '</p>';
            w.matches.forEach(m => {
                html += '<div class="border-top py-2"><strong>' + (m.source === 'file' ? 'CSV row ' + m.row : 'Existing patient') + '</strong><p class="mb-1">' + describe(m.patient) +
                    '</p><span class="text-warning-emphasis">' + importEscape(m.reasons.join('; ')) + '</span></div>';
            });
            const targets = w.matches.filter(m => m.source === 'database');
            html += '<label class="mt-2">Action for row ' + w.row + '<select class="form-select duplicate-decision" data-row="' + w.row + '"><option value="">Choose an action</option><option value="skip">Discard this row (skip)</option>' +
                (w.canCreate !== false ? '<option value="import">Import as a separate patient</option>' : '') +
                (data.canMerge && targets.length ? '<option value="merge">Merge into an existing patient</option>' : '') + '</select></label>';
            if (data.mergeReview && !data.canMerge) html += '<p class="text-muted small">Patient Edit permission is required to merge.</p>';
            html += '<div class="merge-panel d-none mt-3"><label>Existing patient to update<select class="form-select merge-target"><option value="">Select the patient to keep</option>';
            targets.forEach(m => { html += '<option value="' + m.patient.id + '">' + describe(m.patient) + '</option>'; });
            html += '</select></label><p class="small mt-2">The existing Patient ID and history are retained. Blank incoming values never erase data. Address is selected as one complete group. Service-date changes follow the normal eligibility rules. Non-region tags and RX workflow dates are retained. Patient status is retained unless you explicitly confirm restoration below; incoming CSV status is not applied. City changes apply the normal Region rule.</p><div class="merge-fields"></div></div>';
            card.innerHTML = html;
            card.addEventListener('change', event => {
                if (event.target.classList.contains('duplicate-decision')) {
                    const panel = card.querySelector('.merge-panel');
                    panel.classList.toggle('d-none', event.target.value !== 'merge');
                    if (event.target.value === 'merge') panel.scrollIntoView({ block: 'start', behavior: 'smooth' });
                }
                if (event.target.classList.contains('merge-target')) {
                    renderFields(card);
                    if (target(card)) card.querySelector('.merge-fields').scrollIntoView({ block: 'start', behavior: 'smooth' });
                }
                if (event.target.classList.contains('merge-field')) updateResults(card);
                updateSummary();
            });
            body.appendChild(card);
        });
        button.disabled = true;
        button.textContent = 'Choose an action for each flagged row';
        button.onclick = () => {
            if (button.disabled || importBusy || pendingDuplicateReview !== data) return;
            duplicateReviewToken = data.reviewToken;
            duplicateDecisions = Array.from(body.querySelectorAll('.duplicate-card')).map(card => {
                const choice = card.querySelector('.duplicate-decision');
                const decision = { row: Number(choice.dataset.row), action: choice.value };
                if (choice.value === 'merge') {
                    decision.targetId = Number(card.querySelector('.merge-target').value);
                    decision.confirmRestore = card.querySelector('.confirm-restore')?.checked === true;
                    decision.fields = Object.fromEntries(Array.from(card.querySelectorAll('.merge-field')).map(select => [select.dataset.field, select.value]));
                }
                return decision;
            });
            duplicateSkipRows = duplicateDecisions.filter(d => d.action === 'skip').map(d => d.row);
            pendingDuplicateReview = null;
            bootstrap.Modal.getInstance(document.getElementById('duplicateReviewModal')).hide();
            confirmImport();
        };
        bootstrap.Modal.getOrCreateInstance(document.getElementById('duplicateReviewModal')).show();
    }

    function renderPreview(headers, rows) {
        const section    = document.getElementById('previewSection');
        const badge      = document.getElementById('previewBadge');
        const countEl    = document.getElementById('previewCount');
        const tHead      = document.getElementById('previewHead');
        const tBody      = document.getElementById('previewBody');
        const errSect    = document.getElementById('previewErrors');
        const errList    = document.getElementById('previewErrorList');
        const confirmBtn = document.getElementById('confirmImportBtn');

        const total   = rows.length;
        const errCnt  = invalidRows.length;
        const goodCnt = validRows.length;

        badge.textContent   = errCnt > 0 ? errCnt + ' row(s) with errors' : 'Format checks passed';
        badge.className     = 'badge ' + (errCnt > 0 ? 'bg-warning text-dark' : 'bg-success');
        countEl.textContent = total + ' rows found — ' + goodCnt + ' valid, ' + errCnt + ' with errors';

        tHead.innerHTML = '<tr>' + (function(){var _hh=''; for(var _i=0;_i<headers.length;_i++){_hh+='<th class="text-nowrap">' + importEscape(headers[_i]) + '</th>';} return _hh;})() + '<th>Status</th></tr>';

        var _rows200=rows.slice(0,200); var _impHtml=''; for(var _ii=0;_ii<_rows200.length;_ii++){var row=_rows200[_ii]; _impHtml+=(function(){
            const hasErr   = row._errors.length > 0;
            const rowClass = hasErr ? 'table-danger' : 'table-success';
            var _cells=''; for(var _ci=0;_ci<headers.length;_ci++){var h=headers[_ci]; _cells+='<td>' + (row[h] ? importEscape(row[h]) : '<span class="text-muted">—</span>') + '</td>';} var cells=_cells;
            const status   = hasErr
                ? '<td><span class="badge bg-danger" title="' + importEscape(row._errors.join('; ')) + '">⚠ ' + row._errors.length + ' error(s)</span></td>'
                : '<td><span class="badge bg-success">✓ Valid</span></td>';
            return '<tr class="' + rowClass + '">' + cells + status + '</tr>';
        })(); } tBody.innerHTML=_impHtml;

        if (rows.length > 200) {
            tBody.innerHTML += '<tr><td colspan="' + (headers.length + 1) + '" class="text-center text-muted py-2">...and ' + (rows.length - 200) + ' more rows (not shown)</td></tr>';
        }

        if (errCnt > 0) {
            errSect.classList.remove('d-none');
            var _er=''; invalidRows.forEach(function(row){ _er +=
                '<div class="py-1 border-bottom"><strong class="text-danger">Row ' + row._rowNum + ':</strong> ' + importEscape(row._errors.join(', ')) + '</div>'
;
            }); errList.innerHTML = _er;
        } else {
            errSect.classList.add('d-none');
        }

        confirmBtn.disabled    = invalidRows.length > 0 || goodCnt === 0;
        if (invalidRows.length > 0) {
            confirmBtn.textContent = 'Fix ' + invalidRows.length + ' error(s) to continue';
            confirmBtn.className   = 'btn btn-danger btn-sm';
        } else if (goodCnt === 0) {
            confirmBtn.textContent = 'No valid rows to import';
            confirmBtn.className   = 'btn btn-secondary btn-sm';
        } else {
            confirmBtn.textContent = 'Import All ' + goodCnt + ' Rows';
            confirmBtn.className   = 'btn btn-success btn-sm';
        }

        section.classList.remove('d-none');
        section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // ---- Confirm: send to server ----
    async function confirmImport() {
        if (importBusy || invalidRows.length > 0 || validRows.length === 0) return;
        if (pendingDuplicateReview) { showDuplicateReview(pendingDuplicateReview); return; }
        importBusy = true;
        document.getElementById('csvFile').disabled = true;
        const revision = selectedRevision;
        const confirmBtn = document.getElementById('confirmImportBtn');
        const cancelBtn  = document.getElementById('cancelPreviewBtn');
        confirmBtn.disabled = true;
        cancelBtn.disabled  = true;
        confirmBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Importing...';

        try {
            const fileInput = document.getElementById('csvFile');
            const formData  = new FormData();
            formData.append('file', fileInput.files[0]);
            if (duplicateReviewToken) formData.append('duplicateReviewToken', duplicateReviewToken);
            if (currentDataset === 'patients') {
                formData.append('reviewMode', 'merge');
                formData.append('reviewDecisions', JSON.stringify(duplicateDecisions));
            }

            const res = await fetchWithAuth('/api/import/' + currentDataset, {
                method: 'POST',
                body: formData
            });

            if (!res) return;
            if (res.status === 401 || res.status === 403) { window.rxNav('/login'); return; }
            const data = await res.json();
            if (revision !== selectedRevision) return;
            if (res.ok) {
                if (data.reviewRequired) { showDuplicateReview(data); return; }
                document.getElementById('previewSection').classList.add('d-none');
                displayResults(data);
            } else {
                showToast(data.error || 'Import failed', 'danger');
            }
        } catch (err) {
            showToast('Network error during upload', 'danger');
        } finally {
            importBusy = false;
            document.getElementById('csvFile').disabled = false;
            confirmBtn.disabled = false;
            cancelBtn.disabled  = false;
            if (invalidRows.length > 0) {
                confirmBtn.innerHTML = 'Fix ' + invalidRows.length + ' error(s) to continue';
                confirmBtn.className = 'btn btn-danger btn-sm';
            } else {
                confirmBtn.innerHTML = 'Import All ' + validRows.length + ' Rows';
                confirmBtn.className = 'btn btn-success btn-sm';
            }

        }
    }

    function downloadTemplate() {
        const url   = '/api/import/template/' + currentDataset;
        fetchWithAuth(url, { headers: {} })
        .then(r => { if (!r) return null; if (r.status === 401 || r.status === 403) { window.rxNav('/login'); return; } return r.blob(); })
        .then(blob => {
            if (!blob) return;
            const url2 = window.URL.createObjectURL(blob);
            const a = Object.assign(document.createElement('a'), { href: url2, download: 'template_' + currentDataset + '.csv' });
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            window.URL.revokeObjectURL(url2);
        })
        .catch(() => showToast('Error downloading template', 'danger'));
    }

    function displayResults(data) {
        const box = document.getElementById('resultsBox');
        box.style.display = 'block';

        if (data.aborted) {
            // All-or-nothing: nothing was saved, show download button
            box.className = 'results-box alert alert-danger';
            document.getElementById('resultsHeading').textContent = '\u26a0 Import Aborted — Nothing Saved';
            document.getElementById('resultsSummary').textContent =
                data.errorCount + ' error(s) found. NO records were imported. Fix the errors and re-upload.';

            const errSection = document.getElementById('errorsSection');
            const errList    = document.getElementById('errorsList');
            errSection.classList.remove('d-none');
            var _de = ''; data.errors.forEach(function(e) {
                _de += '<div class="text-danger py-1 border-bottom border-light-subtle"><strong>Line ' + e.row + ':</strong> ' + importEscape(e.error) + '</div>';
            }); errList.innerHTML = _de;

            // Download Failed Rows button
            var dlBtn = document.getElementById('downloadFailedBtn');
            if (!dlBtn) {
                dlBtn = document.createElement('button');
                dlBtn.id = 'downloadFailedBtn';
                dlBtn.className = 'btn btn-outline-danger btn-sm mt-2';
                dlBtn.innerHTML = '<i class="fas fa-download me-1"></i>Download Failed Rows CSV';
                errSection.appendChild(dlBtn);
            }
            dlBtn.onclick = function() { downloadFailedRows(data.failedRows); };
            dlBtn.style.display = '';

        } else {
            box.className = 'results-box alert alert-success';
            document.getElementById('resultsHeading').textContent = '\u2705 Import Successful!';
        document.getElementById('resultsSummary').textContent = 'Successfully imported ' + data.successCount + ' rows.' +
            (data.mergedCount ? ' Merged ' + data.mergedCount + ' rows into existing patients.' : '') +
            (data.skippedCount ? ' Skipped ' + data.skippedCount + ' flagged rows (CSV rows: ' + data.skippedRows.join(', ') + ').' : '');
        const errSection = document.getElementById('errorsSection');
        errSection.classList.add('d-none');
        var dlBtn2 = document.getElementById('downloadFailedBtn');
        if (dlBtn2) dlBtn2.style.display = 'none';
        }

        let reportBtn = document.getElementById('downloadImportReportBtn');
        if (!reportBtn) {
            reportBtn = document.createElement('button');
            reportBtn.id = 'downloadImportReportBtn';
            reportBtn.className = 'btn btn-outline-primary btn-sm mt-2';
            reportBtn.textContent = 'Download detailed import report (CSV)';
            box.appendChild(reportBtn);
        }
        reportBtn.hidden = data.aborted || !data.reportRows?.length;
        reportBtn.onclick = () => data.reportId ? downloadStoredImportReport(data.reportId) : downloadImportReport(data.reportRows);
        if (!data.aborted && document.getElementById('patientImportHistory').open) loadImportHistory(1);

        showToast(
            data.aborted
                ? 'Import aborted: ' + data.errorCount + ' error(s). Nothing was saved.'
                : 'Import complete! ' + data.successCount + ' records added.',
            data.aborted ? 'danger' : 'success'
        );
    }

    async function loadImportHistory(page) {
        if (importHistoryBusy) return;
        importHistoryBusy = true;
        const body = document.getElementById('patientImportHistoryBody');
        body.textContent = 'Loading import history...';
        try {
            const res = await fetchWithAuth('/api/import/patient-reports?page=' + Math.max(1, page));
            if (!res || !res.ok) throw new Error('Unable to load import history.');
            const data = await res.json();
            importHistoryPage = data.page;
            let html = '<table class="table table-sm table-bordered"><thead><tr><th>Report</th><th>File</th><th>Recorded</th><th>Operator ID</th><th>New</th><th>Merged</th><th>Discarded</th><th>Report</th></tr></thead><tbody>';
            data.reports.forEach(report => {
                html += '<tr><td>' + report.id + '</td><td>' + importEscape(report.fileName) + '</td><td>' + importEscape(new Date(report.createdAt).toLocaleString()) + '</td><td>' + importEscape(report.userId) + '</td><td>' + Number(report.createdCount) + '</td><td>' + Number(report.mergedCount) + '</td><td>' + Number(report.discardedCount) + '</td><td><button type="button" class="btn btn-sm btn-outline-primary historical-report" data-id="' + report.id + '">Download CSV</button></td></tr>';
            });
            body.innerHTML = data.reports.length ? html + '</tbody></table>' : '<p>No completed patient import reports yet.</p>';
            body.querySelectorAll('.historical-report').forEach(button => button.addEventListener('click', () => downloadStoredImportReport(Number(button.dataset.id))));
            document.getElementById('importHistoryPage').textContent = 'Page ' + data.page + ' of ' + Math.max(1, Math.ceil(data.total / data.pageSize));
            document.getElementById('previousImportHistoryBtn').disabled = data.page <= 1;
            document.getElementById('nextImportHistoryBtn').disabled = data.page * data.pageSize >= data.total;
        } catch (error) { body.textContent = error.message; }
        finally { importHistoryBusy = false; }
    }

    async function downloadStoredImportReport(id) {
        try {
            const res = await fetchWithAuth('/api/import/patient-reports/' + id);
            if (!res || !res.ok) throw new Error('Unable to download the stored report. Refresh history and try again.');
            const report = await res.json();
            downloadImportReport(report.reportRows, id);
        } catch (error) { showToast(error.message, 'danger'); }
    }

    function downloadImportReport(rows, reportId) {
        if (!rows?.length) return;
        const headers = ['csvRow', 'action', 'patientId', 'patientCode', 'recordedAt', 'operatorId', 'field', 'choice', 'existingValue', 'incomingValue', 'finalValue'];
        const escape = value => {
            let text = String(value ?? '');
            if (/^[\s]*[=+@-]/.test(text)) text = "'" + text;
            return '"' + text.replace(/"/g, '""') + '"';
        };
        const csv = [headers.join(','), ...rows.map(row => headers.map(key => escape(row[key])).join(','))].join('\r\n');
        const url = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }));
        const link = Object.assign(document.createElement('a'), { href: url, download: 'patient-import-report-' + (reportId || new Date().toISOString().replace(/[:.]/g, '-')) + '.csv' });
        document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
    }

    function downloadFailedRows(failedRows) {
        if (!failedRows || !failedRows.length) return;
        // Build CSV — all columns of first row, _import_error last
        var keys = Object.keys(failedRows[0]).filter(function(k) { return k !== '_import_error'; });
        keys.push('_import_error');
        var lines = [keys.map(function(k) { return '"' + k + '"'; }).join(',')];
        failedRows.forEach(function(row) {
            var vals = keys.map(function(k) {
                var v = (row[k] !== undefined && row[k] !== null) ? String(row[k]) : '';
                return '"' + v.replace(/"/g, '""') + '"';
            });
            lines.push(vals.join(','));
        });
        var csv = lines.join('\r\n');
        var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        var url  = URL.createObjectURL(blob);
        var a = Object.assign(document.createElement('a'), {
            href: url,
            download: 'failed_rows_' + currentDataset + '_' + new Date().toISOString().slice(0,10) + '.csv'
        });
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
