// =============================================
// Patient RX - Frontend Application Logic
// =============================================

// ----- Frontend Error Boundary -----
(function() {
    function sendError(message, source, stack, severity) {
        try {
            var token = localStorage.getItem('token');
            var payload = JSON.stringify({
                message:  message  || 'Unknown error',
                stack:    stack    || null,
                url:      source   || window.location.href,
                severity: severity || 'error'
            });
            var xhr = new XMLHttpRequest();
            xhr.open('POST', '/api/errors', true);
            xhr.setRequestHeader('Content-Type', 'application/json');
            if (token) xhr.setRequestHeader('Authorization', 'Bearer ' + token);
            xhr.send(payload);
        } catch(e) { /* never throw from error logger */ }
    }

    window.onerror = function(message, source, lineno, colno, error) {
        sendError(
            message + ' (line ' + lineno + ':' + colno + ')',
            source,
            error ? error.stack : null,
            'error'
        );
        return false; // let default browser handling continue
    };

    window.addEventListener('unhandledrejection', function(event) {
        var reason = event.reason || {};
        sendError(
            'Unhandled Promise Rejection: ' + (reason.message || String(reason)),
            window.location.href,
            reason.stack || null,
            'error'
        );
    });
})();

// ----- App Initialization -----
function initApp() {
    setupSidebar();
    setupTheme();
    checkAuth();
    setupLogout();
    setupSessionTimeout();
    setupGlobalSearch();
    setupNotifications();
    observeAndApplyRestrictions();
}

// ----- Sidebar Toggle -----
function setupSidebar() {
    const btn = document.getElementById('sidebarCollapse');
    if (!btn) return;
    btn.addEventListener('click', () => {
        const sidebar = document.getElementById('sidebar');
        const content = document.getElementById('content');
        sidebar.classList.toggle('active');
        content.classList.toggle('sidebar-hidden');
    });
}

// ----- Dark/Light Theme -----
function setupTheme() {
    const btn = document.getElementById('themeToggle');
    if (!btn) return;
    const saved = localStorage.getItem('rxTheme') || 'light';
    applyTheme(saved, btn);
    btn.addEventListener('click', () => {
        const current = document.documentElement.getAttribute('data-theme') || 'light';
        const next = current === 'dark' ? 'light' : 'dark';
        localStorage.setItem('rxTheme', next);
        applyTheme(next, btn);
    });
}

function applyTheme(theme, btn) {
    document.documentElement.setAttribute('data-theme', theme);
    btn.innerHTML = theme === 'dark' ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
}

// ----- Global Search -----
function setupGlobalSearch() {
    const themeBtn = document.getElementById('themeToggle');
    if (!themeBtn) return;

    const wrapper = document.createElement('div');
    wrapper.id = 'globalSearchWrapper';
    wrapper.style.cssText = 'position:relative;display:inline-block;';
    wrapper.innerHTML =
        '<div class="input-group input-group-sm" style="width:240px">' +
            '<span class="input-group-text" style="border-radius:20px 0 0 20px;background:transparent;border-color:var(--border-color,#dee2e6)">' +
                '<i class="fas fa-search text-muted"></i>' +
            '</span>' +
            '<input type="search" id="globalSearchInput" class="form-control form-control-sm"' +
                ' placeholder="Search… (Ctrl+K)"' +
                ' autocomplete="off"' +
                ' style="border-radius:0 20px 20px 0;border-left:0;border-color:var(--border-color,#dee2e6);transition:box-shadow .2s">' +
        '</div>' +
        '<div id="globalSearchDropdown"' +
            ' style="display:none;position:absolute;top:110%;left:0;right:0;min-width:360px;' +
                   'background:var(--card-bg,#fff);border:1px solid var(--border-color,#dee2e6);' +
                   'border-radius:12px;box-shadow:0 12px 32px rgba(0,0,0,.18);z-index:9999;max-height:440px;overflow-y:auto">' +
        '</div>';

    themeBtn.parentNode.insertBefore(wrapper, themeBtn);

    const input    = document.getElementById('globalSearchInput');
    const dropdown = document.getElementById('globalSearchDropdown');
    let debounceTimer = null;
    let activeIdx = -1;  // keyboard nav index

    // ---- Ctrl+K shortcut ----
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
            e.preventDefault();
            input.focus();
            input.select();
        }
        if (e.key === 'Escape' && dropdown.style.display !== 'none') {
            dropdown.style.display = 'none';
            activeIdx = -1;
        }
    });

    // ---- Keyboard navigation inside dropdown ----
    input.addEventListener('keydown', (e) => {
        const items = dropdown.querySelectorAll('.search-result-item');
        if (!items.length) return;
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            activeIdx = Math.min(activeIdx + 1, items.length - 1);
            applyActive(items);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            activeIdx = Math.max(activeIdx - 1, 0);
            applyActive(items);
        } else if (e.key === 'Enter') {
            if (activeIdx >= 0 && items[activeIdx]) {
                e.preventDefault();
                items[activeIdx].click();
            }
        }
    });

    function applyActive(items) {
        items.forEach((el, i) => {
            el.style.background = i === activeIdx ? 'rgba(74,144,226,.12)' : '';
            if (i === activeIdx) el.scrollIntoView({ block: 'nearest' });
        });
    }

    // ---- Debounced search on input ----
    input.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        activeIdx = -1;
        const q = input.value.trim();
        if (q.length < 2) { dropdown.style.display = 'none'; return; }
        debounceTimer = setTimeout(() => doSearch(q), 280);
    });

    // ---- Focus ring ----
    input.addEventListener('focus', () => input.style.boxShadow = '0 0 0 3px rgba(74,144,226,.25)');
    input.addEventListener('blur',  () => input.style.boxShadow = '');

    // ---- Close on outside click ----
    document.addEventListener('click', (e) => {
        if (!wrapper.contains(e.target)) { dropdown.style.display = 'none'; activeIdx = -1; }
    });

    // ---- Highlight matched term in a string ----
    function highlight(text, q) {
        if (!text) return '';
        const esc = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return String(text).replace(new RegExp('(' + esc + ')', 'gi'),
            '<mark style="background:rgba(74,144,226,.25);color:inherit;border-radius:2px;padding:0 1px">$1</mark>');
    }

    async function doSearch(q) {
        dropdown.innerHTML = '<p class="text-center text-muted small py-3 mb-0"><i class="fas fa-spinner fa-spin me-1"></i>Searching\u2026</p>';
        dropdown.style.display = 'block';
        try {
            const res = await fetchWithAuth('/api/search?q=' + encodeURIComponent(q));
            if (!res || !res.ok) { dropdown.innerHTML = '<p class="text-danger small text-center py-2 mb-0">Search error</p>'; return; }
            const data = await res.json();
            renderResults(data, q);
        } catch(e) { dropdown.innerHTML = '<p class="text-danger small text-center py-2 mb-0">Search failed</p>'; }
    }

    function renderResults(data, q) {
        const { patients = [], rxRecords = [], pharmacies = [] } = data;
        const total = patients.length + rxRecords.length + pharmacies.length;
        if (total === 0) {
            dropdown.innerHTML = '<p class="text-center text-muted small py-3 mb-0">No results for \u201c<strong>' + q + '</strong>\u201d</p>';
            return;
        }

        let html = '';

        // ---- Patients ----
        if (patients.length) {
            html += '<div class="px-3 pt-2 pb-1 d-flex justify-content-between align-items-center">' +
                      '<small class="text-muted fw-bold text-uppercase" style="font-size:.7rem"><i class="fas fa-user me-1"></i>Patients</small>' +
                      '<small class="text-muted">' + patients.length + '</small>' +
                    '</div>';
            patients.forEach(p => {
                const badge = p.isActive
                    ? '<span class="badge bg-success ms-1" style="font-size:.6rem">Active</span>'
                    : '<span class="badge bg-secondary ms-1" style="font-size:.6rem">Inactive</span>';
                const name = highlight(p.firstName + ' ' + p.lastName, q);
                const code = highlight(p.patientCode || '', q);
                html += '<a href="/patients?highlight=' + p.id + '"' +
                    ' class="d-flex align-items-center px-3 py-2 text-decoration-none search-result-item" style="transition:background .15s">' +
                    '<div class="me-2 flex-shrink-0" style="width:32px;height:32px;border-radius:50%;background:rgba(74,144,226,.15);display:flex;align-items:center;justify-content:center">' +
                        '<i class="fas fa-user text-primary" style="font-size:.75rem"></i>' +
                    '</div>' +
                    '<div class="flex-grow-1 overflow-hidden">' +
                        '<div class="fw-semibold text-truncate" style="font-size:.85rem">' + name + badge + '</div>' +
                        '<div class="text-muted" style="font-size:.75rem"><code>' + code + '</code>' + (p.phone ? ' \u00b7 ' + p.phone : '') + '</div>' +
                    '</div></a>';
            });
        }

        // ---- RX Records ----
        if (rxRecords.length) {
            html += '<div class="px-3 pt-2 pb-1 d-flex justify-content-between align-items-center' + (patients.length ? ' border-top' : '') + '">' +
                      '<small class="text-muted fw-bold text-uppercase" style="font-size:.7rem"><i class="fas fa-prescription-bottle-alt me-1"></i>RX Records</small>' +
                      '<small class="text-muted">' + rxRecords.length + '</small>' +
                    '</div>';
            rxRecords.forEach(rx => {
                const pat = rx.Patient ? rx.Patient.firstName + ' ' + rx.Patient.lastName : '\u2014';
                const patHL = highlight(pat, q);
                const rxHL  = highlight('RX #' + rx.id, q);
                const url   = rx.Patient ? '/rx-records?patient=' + rx.Patient.id + '&name=' + encodeURIComponent(pat) : '/rx-records';
                html += '<a href="' + url + '"' +
                    ' class="d-flex align-items-center px-3 py-2 text-decoration-none search-result-item" style="transition:background .15s">' +
                    '<div class="me-2 flex-shrink-0" style="width:32px;height:32px;border-radius:50%;background:rgba(80,227,194,.15);display:flex;align-items:center;justify-content:center">' +
                        '<i class="fas fa-prescription-bottle-alt text-success" style="font-size:.75rem"></i>' +
                    '</div>' +
                    '<div>' +
                        '<div class="fw-semibold" style="font-size:.85rem">' + rxHL + '</div>' +
                        '<div class="text-muted" style="font-size:.75rem">' + patHL + (rx.serviceDate ? ' \u00b7 ' + rx.serviceDate : '') + '</div>' +
                    '</div></a>';
            });
        }

        // ---- Pharmacies ----
        if (pharmacies.length) {
            html += '<div class="px-3 pt-2 pb-1 d-flex justify-content-between align-items-center' + ((patients.length || rxRecords.length) ? ' border-top' : '') + '">' +
                      '<small class="text-muted fw-bold text-uppercase" style="font-size:.7rem"><i class="fas fa-clinic-medical me-1"></i>Pharmacies</small>' +
                      '<small class="text-muted">' + pharmacies.length + '</small>' +
                    '</div>';
            pharmacies.forEach(ph => {
                const nameHL = highlight(ph.name, q);
                html += '<a href="/pharmacies"' +
                    ' class="d-flex align-items-center px-3 py-2 text-decoration-none search-result-item" style="transition:background .15s">' +
                    '<div class="me-2 flex-shrink-0" style="width:32px;height:32px;border-radius:50%;background:rgba(245,166,35,.15);display:flex;align-items:center;justify-content:center">' +
                        '<i class="fas fa-clinic-medical text-warning" style="font-size:.75rem"></i>' +
                    '</div>' +
                    '<div>' +
                        '<div class="fw-semibold" style="font-size:.85rem">' + nameHL + '</div>' +
                        '<div class="text-muted" style="font-size:.75rem">' + (ph.address || '\u2014') + '</div>' +
                    '</div></a>';
            });
        }

        // ---- Footer ----
        html += '<div class="px-3 py-2 border-top d-flex justify-content-between align-items-center">' +
                  '<small class="text-muted">' + total + ' result' + (total !== 1 ? 's' : '') + '</small>' +
                  '<small class="text-muted"><kbd style="font-size:.7rem">\u2191\u2193</kbd> navigate &nbsp; <kbd style="font-size:.7rem">Enter</kbd> open &nbsp; <kbd style="font-size:.7rem">Esc</kbd> close</small>' +
                '</div>';

        dropdown.innerHTML = html;
        activeIdx = -1;

        // Hover effects
        dropdown.querySelectorAll('.search-result-item').forEach((el, i) => {
            el.addEventListener('mouseenter', () => { activeIdx = i; applyActive(dropdown.querySelectorAll('.search-result-item')); });
            el.addEventListener('mouseleave', () => { activeIdx = -1; el.style.background = ''; });
            el.addEventListener('click', () => { dropdown.style.display = 'none'; input.value = ''; activeIdx = -1; });
        });
    }
}


// ----- Auth Guard -----
function checkAuth() {
    const token = localStorage.getItem('token');
    if (!token) {
        window.location.href = '/login';
        return;
    }
    try {
        const user = JSON.parse(localStorage.getItem('user'));
        const el = document.getElementById('userGreeting');
        if (el && user) {
            el.textContent = 'Hello, ' + user.firstName + ' ' + user.lastName;
        }

        // Hide sidebar menus if restricted
        const sidebarMapping = {
            '/dashboard':          'dashboard',
            '/patients':           'patients',
            '/rx-records':         'rx_records',
            '/reports':            'reports',
            '/audit-log':          'audit_log',
            '/import':             'import',
            '/pharmacies':         'pharmacies',
            '/patient-transport':  'patient_transport',
            '/pharmacy-transport': 'pharmacy_transport',
            '/clinics':            'clinics',
            '/workflow-actions':   'workflow_actions',
            '/medication-catalog': 'medication_catalog',
            '/roles':              'users',         // roles page = admin, tied to users perm
            '/users':              'users',
            '/backups':            'backups',
            '/system-settings':    'system_settings'
        };

        const role = user.role;
        const permissions = user.permissions || getRoleDefaultPermissions(role);
        // Dashboard is always forced visible — cannot be hidden
        if (permissions.dashboard) permissions.dashboard.visible = true;
        else permissions.dashboard = { visible: true, readOnly: false };
        // For Administrators: force-show admin-only pages regardless of stored permissions
        if (role === 'Administrator') {
            ['backups','system_settings','audit_log','users','medication_catalog'].forEach(k => {
                if (!permissions[k]) permissions[k] = { visible: true };
                else permissions[k].visible = true;
            });
        }
        
        Object.keys(sidebarMapping).forEach(href => {
            const permKey = sidebarMapping[href];
            const perm = permissions[permKey] || { visible: true, readOnly: false };
            const a = document.querySelector(`#sidebar a[href="${href}"]`);
            if (a) {
                const li = a.closest('li');
                if (li) {
                    if (!perm.visible) {
                        li.classList.add('d-none');
                    } else {
                        li.classList.remove('d-none');
                    }
                }
            }
        });

        // For each submenu group: hide the group header if ALL its child items are hidden.
        // Works with the new sidebar structure: refDataSubmenu, reportsSubmenu, adminSubmenu.
        ['refDataSubmenu', 'reportsSubmenu', 'adminSubmenu'].forEach(function(menuId) {
            const submenu = document.getElementById(menuId);
            if (!submenu) return;
            const allItems   = submenu.querySelectorAll('li');
            const visibleItems = submenu.querySelectorAll('li:not(.d-none)');
            const toggleA  = document.querySelector('#sidebar a[href="#' + menuId + '"]');
            if (toggleA) {
                const toggleLi = toggleA.closest('li');
                if (toggleLi) {
                    if (visibleItems.length === 0) {
                        toggleLi.classList.add('d-none');
                    } else {
                        toggleLi.classList.remove('d-none');
                    }
                }
            }
        });

        // Redirect on direct URL load if visible=false
        const currentPath = window.location.pathname;
        const currentPermKey = sidebarMapping[currentPath];
        if (currentPermKey) {
            const perm = permissions[currentPermKey] || { visible: true, readOnly: false };
            if (!perm.visible) {
                window.location.href = '/dashboard';
                return;
            }
        }
    } catch (e) {
        console.warn('Auth guard error:', e);
    }
}

// ----- Logout -----
function setupLogout() {
    const btn = document.getElementById('logoutBtn');
    if (!btn) return;
    btn.addEventListener('click', async () => {
        // Track logout in audit log (fire-and-forget)
        try {
            const token = localStorage.getItem('token');
            if (token) {
                await fetch('/api/auth/logout', {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }
                });
            }
        } catch(e) { /* non-fatal */ }
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        // Clear the server-side session cookie
        document.cookie = 'rxToken=; path=/; max-age=0; SameSite=Strict';
        window.location.href = '/login';
    });
}

// ----- Session Timeout (30 min idle, 2 min warning) -----
function setupSessionTimeout() {
    const IDLE_MS    = 30 * 60 * 1000; // 30 minutes
    const WARN_MS    = 28 * 60 * 1000; // warn at 28 minutes (2 min before)
    let idleTimer, warnTimer;

    // Inject warning modal once
    if (!document.getElementById('sessionWarnModal')) {
        const modal = document.createElement('div');
        modal.innerHTML = `
        <div class="modal fade" id="sessionWarnModal" tabindex="-1" data-bs-backdrop="static">
          <div class="modal-dialog modal-dialog-centered">
            <div class="modal-content border-warning">
              <div class="modal-header bg-warning bg-opacity-10">
                <h5 class="modal-title text-warning"><i class="fas fa-clock me-2"></i>Session Expiring Soon</h5>
              </div>
              <div class="modal-body text-center py-4">
                <p class="mb-2">You have been idle for <strong>28 minutes</strong>.</p>
                <p class="text-muted">You will be automatically logged out in <strong id="sessionCountdown">2:00</strong>.</p>
              </div>
              <div class="modal-footer justify-content-center">
                <button class="btn btn-primary" id="sessionStayBtn"><i class="fas fa-check me-1"></i>Stay Logged In</button>
                <button class="btn btn-outline-secondary" id="sessionLogoutNowBtn">Logout Now</button>
              </div>
            </div>
          </div>
        </div>`;
        document.body.appendChild(modal.firstElementChild);

        document.getElementById('sessionStayBtn').addEventListener('click', () => {
            bootstrap.Modal.getInstance(document.getElementById('sessionWarnModal'))?.hide();
            resetTimers();
        });
        document.getElementById('sessionLogoutNowBtn').addEventListener('click', performLogout);
    }

    async function performLogout() {
        try {
            const token = localStorage.getItem('token');
            if (token) await fetch('/api/auth/logout', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }
            });
        } catch(e) {}
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = '/login?reason=timeout';
    }

    function showWarning() {
        const modalEl = document.getElementById('sessionWarnModal');
        if (!modalEl) return;
        let secsLeft = 120;
        const cd = document.getElementById('sessionCountdown');
        const tick = setInterval(() => {
            secsLeft--;
            const m = Math.floor(secsLeft / 60);
            const s = secsLeft % 60;
            if (cd) cd.textContent = m + ':' + String(s).padStart(2, '0');
            if (secsLeft <= 0) { clearInterval(tick); performLogout(); }
        }, 1000);
        // Store tick so we can clear it on 'Stay'
        modalEl.dataset.tick = tick;
        const modal = new bootstrap.Modal(modalEl);
        modal.show();
        // When hidden (Stay clicked), clear the countdown
        modalEl.addEventListener('hidden.bs.modal', () => clearInterval(parseInt(modalEl.dataset.tick)), { once: true });
    }

    function resetTimers() {
        clearTimeout(idleTimer);
        clearTimeout(warnTimer);
        // Don't reset if on login page
        if (!localStorage.getItem('token')) return;
        warnTimer = setTimeout(showWarning,  WARN_MS);
        idleTimer = setTimeout(performLogout, IDLE_MS);
    }

    // Reset on any user activity
    ['mousemove','mousedown','keydown','scroll','touchstart','click'].forEach(evt => {
        document.addEventListener(evt, resetTimers, { passive: true });
    });

    resetTimers(); // start
}

// ----- Authenticated Fetch -----
// Pass options.silent = true to suppress the 403 toast for background/init calls
async function fetchWithAuth(url, options = {}) {
    const token = localStorage.getItem('token');
    const silent = !!options.silent;
    const fetchOptions = Object.assign({}, options);
    delete fetchOptions.silent; // don't forward to fetch()
    const headers = Object.assign({
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
    }, fetchOptions.headers || {});

    const res = await fetch(url, Object.assign({}, fetchOptions, { headers }));

    // 401 = token expired / invalid → logout
    if (res.status === 401) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = '/login';
        return null;
    }
    // 403 = authenticated but forbidden
    // silent=true → return quietly (background init/dropdown calls for restricted modules)
    // silent=false → show toast so the user knows the action was blocked
    if (res.status === 403) {
        if (!silent) {
            const body = await res.clone().json().catch(function() { return {}; });
            showToast(body.message || 'Access denied.', 'warning');
        }
        return res;
    }
    return res;
}

// ----- Toast Notification -----
function showToast(message, type) {
    type = type || 'success';
    const container = document.querySelector('.toast-container');
    if (!container) return;
    const id = 'toast-' + Date.now();
    const icons = { success: 'fa-check-circle', danger: 'fa-times-circle', warning: 'fa-exclamation-circle', info: 'fa-info-circle' };
    const icon = icons[type] || 'fa-info-circle';
    const html = '<div id="' + id + '" class="toast align-items-center border-0 show mb-2" role="alert">' +
        '<div class="d-flex alert alert-' + type + ' mb-0 w-100">' +
        '<i class="fas ' + icon + ' me-2 mt-1"></i>' +
        '<div class="toast-body p-0 flex-grow-1">' + message + '</div>' +
        '<button type="button" class="btn-close ms-2" onclick="document.getElementById(\'' + id + '\').remove()"></button>' +
        '</div></div>';
    container.insertAdjacentHTML('beforeend', html);
    setTimeout(function() {
        const el = document.getElementById(id);
        if (el) el.remove();
    }, 4000);
}

// ----- CRUD Module Configuration -----
var MODULE_CONFIGS = {
    'pharmacies': {
        label: 'Pharmacy',
        softDelete: true,
        columns: ['id', 'name', 'phone', 'contactPerson', 'isActive'],
        headers: ['ID', 'Name', 'Phone', 'Contact Person', 'Active'],
        fields: [
            { key: 'name', label: 'Name', type: 'text', required: true },
            { key: 'address', label: 'Address', type: 'text' },
            { key: 'phone', label: 'Phone', type: 'text' },
            { key: 'contactPerson', label: 'Contact Person', type: 'text' },
            { key: 'notes', label: 'Notes', type: 'textarea' },
            { key: 'isActive', label: 'Active', type: 'checkbox', default: true }
        ]
    },
    'patient-transport': {
        label: 'Patient Transport Company',
        softDelete: true,
        columns: ['id', 'companyName', 'phone', 'contactPerson', 'isActive'],
        headers: ['ID', 'Company / Contact Name', 'Phone', 'Contact Person', 'Active'],
        fields: [
            { key: 'companyName', label: 'Company Name (or leave blank if individual)', type: 'text' },
            { key: 'phone', label: 'Phone', type: 'text' },
            { key: 'contactPerson', label: 'Contact Person', type: 'text', required: true },
            { key: 'notes', label: 'Notes', type: 'textarea' },
            { key: 'isActive', label: 'Active', type: 'checkbox', default: true }
        ]
    },
    'pharmacy-transport': {
        label: 'Pharmacy Transport Company',
        softDelete: true,
        columns: ['id', 'companyName', 'phone', 'contactPerson', 'isActive'],
        headers: ['ID', 'Company Name', 'Phone', 'Contact Person', 'Active'],
        fields: [
            { key: 'companyName', label: 'Company Name', type: 'text', required: true },
            { key: 'phone', label: 'Phone', type: 'text' },
            { key: 'contactPerson', label: 'Contact Person (optional)', type: 'text' },
            { key: 'notes', label: 'Notes', type: 'textarea' },
            { key: 'isActive', label: 'Active', type: 'checkbox', default: true }
        ]
    },
    'users': {
        label: 'User',
        softDelete: true,
        columns: ['id', 'firstName', 'lastName', 'username', 'email', 'roleId', 'isActive'],
        headers: ['ID', 'First Name', 'Last Name', 'Username', 'Email', 'Role', 'Active'],
        fields: [
            { key: 'firstName', label: 'First Name', type: 'text',     required: true },
            { key: 'lastName',  label: 'Last Name',  type: 'text',     required: true },
            { key: 'username',  label: 'Username',   type: 'text',     required: true },
            { key: 'email',     label: 'Email',      type: 'email',    required: true },
            { key: 'password',  label: 'Password',   type: 'password' },
            { key: 'roleId',    label: 'Role',       type: 'select',   required: true,
              hint: 'Select a role — manage roles at Settings → Roles',
              options: []   // populated dynamically by loadRolesForUserForm()
            },
            { key: 'notes',    label: 'Notes',      type: 'textarea' },
            { key: 'isActive', label: 'Active',     type: 'checkbox', default: true }
        ]
    },
    'workflow-actions': {
        label: 'Workflow Action',
        softDelete: true,
        columns: ['id', 'name', 'sequenceNumber', 'isActive'],
        headers: ['ID', 'Name', 'Sequence #', 'Active'],
        fields: [
            { key: 'name', label: 'Name', type: 'text', required: true },
            { key: 'description', label: 'Description', type: 'textarea' },
            { key: 'sequenceNumber', label: 'Sequence Number', type: 'number', required: true },
            { key: 'isActive', label: 'Active', type: 'checkbox', default: true }
        ]
    },
    'patients': {
        label: 'Patient',
        columns: ['id', 'firstName', 'lastName', 'dob', 'phone', 'serviceDate', 'isActive'],
        headers: ['ID', 'First Name', 'Last Name', 'DOB', 'Phone', 'Service Date', 'Active'],
        fields: [
            { key: 'firstName', label: 'First Name', type: 'text', required: true },
            { key: 'lastName', label: 'Last Name', type: 'text', required: true },
            { key: 'dob', label: 'Date of Birth', type: 'date', required: true },
            { key: 'address', label: 'Address', type: 'text' },
            { key: 'phone', label: 'Phone', type: 'text' },
            { key: 'serviceDate', label: 'Service Date', type: 'date' },
            { key: 'notes', label: 'Notes', type: 'textarea' },
            { key: 'isActive', label: 'Active', type: 'checkbox', default: true }
        ]
    },
    'rx-records': {
        label: 'RX Record',
        columns: ['id', 'patientId', 'arrivalDate', 'serviceDate', 'pharmacyId'],
        headers: ['ID', 'Patient ID', 'Arrival Date', 'Service Date', 'Pharmacy ID'],
        fields: [
            { key: 'patientId', label: 'Patient ID', type: 'number', required: true },
            { key: 'arrivalDate', label: 'Arrival Date', type: 'date', required: true },
            { key: 'serviceDate', label: 'Service Date', type: 'date', required: true },
            { key: 'pharmacyId', label: 'Pharmacy ID', type: 'number', required: true },
            { key: 'patientTransportCompanyId', label: 'Patient Transport Co. ID', type: 'number' },
            { key: 'pharmacyTransportCompanyId', label: 'Pharmacy Transport Co. ID', type: 'number' }
        ]
    },
    'clinics': {
        label: 'Clinic / Location',
        softDelete: true,
        columns: ['id', 'name', 'address', 'phone', 'contactPerson', 'isActive'],
        headers: ['ID', 'Clinic / Location Name', 'Address', 'Phone', 'Contact Person', 'Active'],
        fields: [
            { key: 'name', label: 'Clinic / Location Name', type: 'text', required: true,
              hint: 'This is the same type of location as a Pharmacy. Use this for the patient\'s clinic or pickup location.' },
            { key: 'address', label: 'Address', type: 'text' },
            { key: 'phone', label: 'Phone', type: 'text' },
            { key: 'contactPerson', label: 'Contact Person', type: 'text' },
            { key: 'notes', label: 'Notes', type: 'textarea' },
            { key: 'isActive', label: 'Active', type: 'checkbox', default: true }
        ]
    },
    'medication-catalog': {
        label: 'RX Action',
        softDelete: true,
        columns: ['id', 'sortOrder', 'name', 'description', 'isActive'],
        headers: ['ID', 'Position #', 'Action Name', 'Description / Notes', 'Active'],
        fields: [
            { key: 'sortOrder', label: 'Position # (order in selector)', type: 'number',
              hint: 'Lower number = appears first in the dropdown (e.g. 1 = first, 2 = second). Leave at 999 to place at the end.' },
            { key: 'name', label: 'Action Name', type: 'text', required: true,
              hint: 'This action will appear in the dropdown when adding actions to an RX record (e.g. Received, Not Received, Missing, Pending).' },
            { key: 'description', label: 'Description / Notes', type: 'textarea' },
            { key: 'isActive', label: 'Active (appears in RX form)', type: 'checkbox', default: true }
        ]
    }
};

// ----- CRUD State -----
var crudState = {
    module: null,
    endpoint: null,
    config: null,
    data: [],
    filtered: [],
    currentPage: 1,
    pageSize: 15,
    editingId: null,
    deletingId: null,
    sortCol: 'id',
    sortDir: 'desc'
};

// ----- Load CRUD Module -----
async function loadCrudModule(moduleName, apiEndpoint) {
    crudState.module = moduleName;
    crudState.endpoint = apiEndpoint;
    crudState.config = MODULE_CONFIGS[moduleName] || null;

    setupSearch();
    setupAddButton();

    // For Users module: load roles from API to populate the roleId dropdown
    if (moduleName === 'users') {
        await loadRolesForUserForm();
    }

    await refreshTable();
}

// Fetches /api/roles and populates the roleId field options in the users module config
async function loadRolesForUserForm() {
    try {
        const res = await fetchWithAuth('/api/roles', { silent: true });
        if (res && res.ok) {
            const roles = await res.json();
            const cfg = MODULE_CONFIGS['users'];
            const roleField = cfg.fields.find(f => f.key === 'roleId');
            if (roleField) {
                roleField.options = roles.map(r => ({ value: r.id, label: r.name + (r.description ? ' — ' + r.description : '') }));
            }
        }
    } catch(e) { /* non-fatal — form will show empty dropdown */ }
}

async function refreshTable() {
    try {
        var config = crudState.config;
        var isSoftDelete = config && config.softDelete;
        var showInactive = isSoftDelete && document.getElementById('showInactiveToggle') && document.getElementById('showInactiveToggle').checked;
        var url = crudState.endpoint + (showInactive ? '?includeInactive=true' : '');
        const res = await fetchWithAuth(url);
        if (!res) return;
        const data = await res.json();
        if (Array.isArray(data)) {
            crudState.data = data;
        } else {
            crudState.data = [];
            showToast((data.error || data.message || 'Failed to load data'), 'danger');
        }
        crudState.filtered = crudState.data.slice();
        crudState.currentPage = 1;
        renderTable();
    } catch (err) {
        showToast('Network error loading data.', 'danger');
    }
}

// =============================================
// Permissions helper — returns current-page perms
// =============================================
function getPagePerms() {
    // Full access: returned only when NO stored permission object exists for the module
    var fullAccess = { visible: true, canEdit: true, canDelete: true, canExport: true, canUndo: true };
    try {
        var user = JSON.parse(localStorage.getItem('user'));
        if (!user) return fullAccess;
        var sidebarMapping = {
            '/dashboard':         'dashboard',
            '/patients':          'patients',
            '/rx-records':        'rx_records',
            '/reports':           'reports',
            '/import':            'import',
            '/pharmacies':        'pharmacies',
            '/patient-transport': 'patient_transport',
            '/pharmacy-transport':'pharmacy_transport',
            '/workflow-actions':  'workflow_actions',
            '/clinics':           'clinics',
            '/users':             'users'
        };
        var key = sidebarMapping[window.location.pathname];
        if (!key) return fullAccess;
        var perms = user.permissions || getRoleDefaultPermissions(user.role);
        // Dashboard always visible
        if (perms.dashboard) perms.dashboard.visible = true;
        var p = perms[key];
        // No permission entry at all → grant full access (unmanaged user/role)
        if (!p) return fullAccess;
        // Permission entry EXISTS → any unset action defaults to FALSE (least privilege)
        return {
            visible:   p.visible   !== undefined ? !!p.visible   : true,  // visibility still defaults true
            canEdit:   p.canEdit   !== undefined ? !!p.canEdit   : false,
            canDelete: p.canDelete !== undefined ? !!p.canDelete : false,
            canExport: p.canExport !== undefined ? !!p.canExport : false,
            canUndo:   p.canUndo   !== undefined ? !!p.canUndo   : false
        };
    } catch (e) { return fullAccess; }
}

function renderTable() {
    var config = crudState.config;
    var data = crudState.filtered;
    var page = crudState.currentPage;
    var size = crudState.pageSize;
    var start = (page - 1) * size;
    var pageData = data.slice(start, start + size);
    var p = getPagePerms();

    // Headers
    var cols = config ? config.columns : (data.length > 0 ? Object.keys(data[0]).filter(function(k) { return k !== 'passwordHash'; }) : []);
    var hdrs = config ? config.headers : cols;
    var thead = document.getElementById('tableHeaders');
    if (thead) {
        var actionHeader = (p.canEdit || p.canDelete) ? '<th>Actions</th>' : '';
        thead.innerHTML = '<tr>' + hdrs.map(function(h, i) {
            var colKey = cols[i];
            var icon = '';
            if (crudState.sortCol === colKey) {
                icon = crudState.sortDir === 'asc' ? ' <i class="fas fa-sort-up"></i>' : ' <i class="fas fa-sort-down"></i>';
            } else {
                icon = ' <i class="fas fa-sort text-muted" style="opacity:0.3"></i>';
            }
            return '<th style="cursor:pointer" onclick="crudSortTable(\'' + colKey + '\')">' + h + icon + '</th>';
        }).join('') + actionHeader + '</tr>';
    }

    // Body
    var tbody = document.getElementById('tableBody');
    if (!tbody) return;
    var isSoftDelete = config && config.softDelete;
    if (pageData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="' + (cols.length + (p.canEdit || p.canDelete ? 1 : 0)) + '" class="text-center text-muted py-4">No records found.</td></tr>';
    } else {
        tbody.innerHTML = pageData.map(function(row) {
            var isInactive = isSoftDelete && row.isActive === false;
            var rowClass = isInactive ? ' class="table-secondary text-muted"' : '';
            var cells = cols.map(function(col) {
                var val = row[col];
                if (col === 'isActive' && isSoftDelete && isInactive) {
                    return '<td><span class="badge bg-secondary">Disabled</span></td>';
                }
                if (val === true) return '<td><span class="badge bg-success">Yes</span></td>';
                if (val === false) return '<td><span class="badge bg-secondary">No</span></td>';
                if (val === null || val === undefined) return '<td class="text-muted">\u2014</td>';
                // BUG-07 FIX: Show ellipsis + tooltip when value is truncated
                const strVal = String(val);
                if (strVal.length > 60) {
                    return '<td title="' + strVal.replace(/"/g, '&quot;') + '">' + strVal.substring(0, 60) + '\u2026</td>';
                }
                return '<td>' + strVal + '</td>';
            }).join('');
            var actionCell = '';
            if (p.canEdit || p.canDelete) {
                if (isSoftDelete && isInactive) {
                    // Disabled row: show Restore button only
                    actionCell = '<td>' +
                        (p.canDelete ? '<button class="btn btn-sm btn-outline-success" onclick="restoreRecord(' + row.id + ')" title="Restore"><i class="fas fa-undo me-1"></i>Restore</button>' : '<span class="text-muted small">Disabled</span>') +
                        '</td>';
                } else {
                    actionCell = '<td>' +
                        (p.canEdit  ? '<button class="btn btn-sm btn-outline-primary me-1" onclick="editRecord(' + row.id + ')"><i class="fas fa-edit"></i></button>' : '') +
                        (p.canDelete ? '<button class="btn btn-sm btn-outline-danger" onclick="promptDelete(' + row.id + ')" title="' + (isSoftDelete ? 'Disable' : 'Delete') + '"><i class="fas fa-' + (isSoftDelete ? 'ban' : 'trash') + '"></i></button>' : '') +
                        '</td>';
                }
            }
            return '<tr' + rowClass + '>' + cells + actionCell + '</tr>';
        }).join('');
    }

    // Hide / show export & add buttons based on permissions
    var expBtn = document.getElementById('exportCsvBtn');
    if (expBtn) { if (!p.canExport) expBtn.classList.add('d-none'); else expBtn.classList.remove('d-none'); }
    var addBtn = document.getElementById('addNewBtn');
    if (addBtn) { if (!p.canEdit) addBtn.classList.add('d-none'); else addBtn.classList.remove('d-none'); }

    // Pagination
    var pi = document.getElementById('pageInfo');
    if (pi) pi.textContent = 'Showing ' + (Math.min(start + 1, data.length)) + '\u2013' + Math.min(start + size, data.length) + ' of ' + data.length;

    var ul = document.getElementById('pagination');
    if (ul) {
        var pages = Math.ceil(data.length / size);
        var pagHtml = '<li class="page-item' + (page === 1 ? ' disabled' : '') + '"><a class="page-link" href="#" onclick="goPage(' + (page - 1) + ');return false;">&laquo;</a></li>';
        for (var i = 1; i <= pages; i++) {
            pagHtml += '<li class="page-item' + (i === page ? ' active' : '') + '"><a class="page-link" href="#" onclick="goPage(' + i + ');return false;">' + i + '</a></li>';
        }
        pagHtml += '<li class="page-item' + (page === pages || pages === 0 ? ' disabled' : '') + '"><a class="page-link" href="#" onclick="goPage(' + (page + 1) + ');return false;">&raquo;</a></li>';
        ul.innerHTML = pagHtml;
    }
}

function crudSortTable(colKey) {
    if (crudState.sortCol === colKey) {
        crudState.sortDir = crudState.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
        crudState.sortCol = colKey;
        crudState.sortDir = 'asc';
    }
    
    crudState.filtered.sort(function(a, b) {
        var valA = a[colKey];
        var valB = b[colKey];
        
        if (typeof valA === 'string' && typeof valB === 'string') {
            return crudState.sortDir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        } else {
            if (valA < valB) return crudState.sortDir === 'asc' ? -1 : 1;
            if (valA > valB) return crudState.sortDir === 'asc' ? 1 : -1;
            return 0;
        }
    });
    
    crudState.currentPage = 1;
    renderTable();
}

function goPage(p) {
    var pages = Math.ceil(crudState.filtered.length / crudState.pageSize);
    if (p < 1 || p > pages) return;
    crudState.currentPage = p;
    renderTable();
}

// ----- Search -----
function setupSearch() {
    var input = document.getElementById('tableSearch');
    if (!input) return;
    input.addEventListener('input', function() {
        var q = this.value.toLowerCase();
        if (!q) {
            crudState.filtered = crudState.data.slice();
        } else {
            crudState.filtered = crudState.data.filter(function(row) {
                return JSON.stringify(row).toLowerCase().includes(q);
            });
        }
        crudState.currentPage = 1;
        renderTable();
    });
}

// ----- Add Button -----
function setupAddButton() {
    var btn = document.getElementById('addNewBtn');
    if (!btn) return;
    btn.addEventListener('click', function() {
        openModal(null);
    });
}

// ----- Modal -----
function openModal(id) {
    crudState.editingId = id;
    var config = crudState.config;
    var title = id ? ('Edit ' + (config ? config.label : 'Record')) : ('Add ' + (config ? config.label : 'Record'));
    document.getElementById('crudModalLabel').textContent = title;

    // Widen to xl for Users (permissions table has 6 columns)
    var dlg = document.querySelector('#crudModal .modal-dialog');
    if (dlg) {
        dlg.classList.remove('modal-sm', 'modal-lg', 'modal-xl');
        dlg.classList.add(crudState.module === 'users' ? 'modal-xl' : 'modal-lg');
    }

    var form = document.getElementById('crudForm');
    var existingData = id ? crudState.data.find(function(r) { return r.id === id; }) : null;

    if (!config) {
        form.innerHTML = '<p class="text-muted">No form configuration available for this module.</p>';
    } else {
        var fieldsHtml = config.fields.map(function(f) {
            var val = existingData ? (existingData[f.key] !== undefined ? existingData[f.key] : '') : (f.default !== undefined ? f.default : '');
            if (f.type === 'checkbox') {
                return '<div class="mb-3 form-check">' +
                    '<input type="checkbox" class="form-check-input" id="field_' + f.key + '" name="' + f.key + '"' + (val ? ' checked' : '') + '>' +
                    '<label class="form-check-label" for="field_' + f.key + '">' + f.label + '</label>' +
                    '</div>';
            }
            if (f.type === 'textarea') {
                return '<div class="mb-3">' +
                    '<label for="field_' + f.key + '" class="form-label">' + f.label + (f.required ? ' <span class="text-danger">*</span>' : '') + '</label>' +
                    '<textarea class="form-control" id="field_' + f.key + '" name="' + f.key + '" rows="3">' + (val || '') + '</textarea>' +
                    '</div>';
            }
            if (f.type === 'select') {
                var optionsHtml = (f.options || []).map(function(opt) {
                    var selected = String(val) === String(opt.value) ? ' selected' : '';
                    return '<option value="' + opt.value + '"' + selected + '>' + opt.label + '</option>';
                }).join('');
                return '<div class="mb-3">' +
                    '<label for="field_' + f.key + '" class="form-label">' + f.label + (f.required ? ' <span class="text-danger">*</span>' : '') + '</label>' +
                    '<select class="form-select" id="field_' + f.key + '" name="' + f.key + '"' + (f.required ? ' required' : '') + '>' +
                    '<option value="">— Select —</option>' + optionsHtml +
                    '</select>' +
                    (f.hint ? '<div class="form-text text-muted">' + f.hint + '</div>' : '') +
                    '</div>';
            }
            if (f.type === 'password' && existingData) {
                return '<div class="mb-3">' +
                    '<label for="field_' + f.key + '" class="form-label">' + f.label + ' (leave blank to keep current)</label>' +
                    '<input type="password" class="form-control" id="field_' + f.key + '" name="' + f.key + '" autocomplete="new-password">' +
                    '</div>';
            }
            return '<div class="mb-3">' +
                '<label for="field_' + f.key + '" class="form-label">' + f.label + (f.required ? ' <span class="text-danger">*</span>' : '') + '</label>' +
                '<input type="' + f.type + '" class="form-control" id="field_' + f.key + '" name="' + f.key + '" value="' + (val !== null && val !== undefined ? val : '') + '"' + (f.required ? ' required' : '') + '>' +
                '</div>';
        }).join('');

        if (crudState.module === 'users') {
            // Permissions are now role-based — no per-user granular override needed.
            // To change what a user can do, change their Role or edit the Role's permissions
            // at Settings → Roles.
            fieldsHtml += '<div class="alert alert-info mt-3 py-2 small mb-0">' +
                '<i class="fas fa-info-circle me-2"></i>' +
                '<strong>Permissions are role-based.</strong> ' +
                'To adjust what this user can do, assign a different role or ' +
                '<a href="/roles" class="alert-link">edit the role\'s permissions</a>.' +
                '</div>';
        }
        form.innerHTML = fieldsHtml;

    }

    var modal = new bootstrap.Modal(document.getElementById('crudModal'));
    modal.show();

    document.getElementById('saveCrudBtn').onclick = function() { saveRecord(); };
}

function editRecord(id) {
    openModal(id);
}

async function saveRecord() {
    var config = crudState.config;
    if (!config) return;
    var form = document.getElementById('crudForm');
    var body = {};

    config.fields.forEach(function(f) {
        var el = form.querySelector('[name="' + f.key + '"]');
        if (!el) return;
        if (f.type === 'checkbox') {
            body[f.key] = el.checked;
        } else if (f.type === 'number' || (f.type === 'select' && f.numeric)) {
            if (el.value !== '') body[f.key] = Number(el.value);
        } else if (f.type === 'select') {
            // For selects that store numeric IDs (like roleId), convert to number if the value looks numeric
            if (el.value !== '') {
                body[f.key] = isNaN(Number(el.value)) ? el.value : Number(el.value);
            }
        } else {
            if (el.value !== '') body[f.key] = el.value;
        }
    });

    if (crudState.module === 'users') {
        var permissions = {};
        var rows = form.querySelectorAll('tr[data-menu]');
        rows.forEach(function(row) {
            var menuKey = row.getAttribute('data-menu');
            if (menuKey) {
                var hasEdit   = !!row.querySelector('.perm-canedit');
                var hasDel    = !!row.querySelector('.perm-candelete');
                var hasExport = !!row.querySelector('.perm-canexport');
                var p = {
                    visible:   row.querySelector('.perm-visible')   ? row.querySelector('.perm-visible').checked   : true,
                    canEdit:   hasEdit   ? row.querySelector('.perm-canedit').checked   : false,
                    canDelete: hasDel    ? row.querySelector('.perm-candelete').checked : false,
                    canExport: hasExport ? row.querySelector('.perm-canexport').checked : false
                };
                var undoChk = row.querySelector('.perm-canundo');
                p.canUndo = undoChk ? undoChk.checked : false;
                permissions[menuKey] = p;
            }
        });
        body.permissions = permissions;
    }

    // ── Duplicate patient check (new patients only) ──────────────────────────
    if (crudState.module === 'patients' && !crudState.editingId && body.firstName && body.lastName && body.dob) {
        try {
            const dupRes = await fetchWithAuth(
                `/api/patients/check-duplicate?firstName=${encodeURIComponent(body.firstName)}&lastName=${encodeURIComponent(body.lastName)}&dob=${encodeURIComponent(body.dob)}`
            );
            if (dupRes && dupRes.ok) {
                const { duplicates } = await dupRes.json();
                if (duplicates && duplicates.length > 0) {
                    // Show duplicate warning and wait for user decision
                    const proceed = await showDuplicateWarning(duplicates, body);
                    if (!proceed) return; // user chose to cancel
                }
            }
        } catch(e) { /* non-fatal, proceed with save */ }
    }
    // ────────────────────────────────────────────────────────────────────────

    var btn = document.getElementById('saveCrudBtn');
    var spinner = document.getElementById('saveSpinner');
    btn.disabled = true;
    spinner.classList.remove('d-none');

    try {
        var url = crudState.editingId ? (crudState.endpoint + '/' + crudState.editingId) : crudState.endpoint;
        var method = crudState.editingId ? 'PUT' : 'POST';
        var res = await fetchWithAuth(url, { method: method, body: JSON.stringify(body) });
        if (!res) return;
        if (res.ok) {
            bootstrap.Modal.getInstance(document.getElementById('crudModal')).hide();
            showToast((crudState.editingId ? 'Record updated' : 'Record created') + ' successfully!', 'success');
            await refreshTable();
        } else {
            var err = await res.json();
            showToast(err.error || err.message || 'Save failed.', 'danger');
        }
    } catch (e) {
        showToast('Network error.', 'danger');
    } finally {
        btn.disabled = false;
        spinner.classList.add('d-none');
    }
}

// Show duplicate patient warning modal — returns Promise<boolean> (true = proceed, false = cancel)
function showDuplicateWarning(duplicates, newPatient) {
    return new Promise((resolve) => {
        // Remove existing if any
        const existing = document.getElementById('dupWarnModal');
        if (existing) existing.remove();

        const rows = duplicates.map(d =>
            `<tr>
                <td><code>${d.patientCode}</code></td>
                <td>${d.firstName} ${d.lastName}</td>
                <td>${d.dob || '-'}</td>
                <td>${d.phone || '-'}</td>
            </tr>`
        ).join('');

        const div = document.createElement('div');
        div.innerHTML = `
        <div class="modal fade" id="dupWarnModal" tabindex="-1" data-bs-backdrop="static">
          <div class="modal-dialog modal-lg modal-dialog-centered">
            <div class="modal-content border-warning">
              <div class="modal-header bg-warning bg-opacity-10">
                <h5 class="modal-title text-warning"><i class="fas fa-exclamation-triangle me-2"></i>Possible Duplicate Patient</h5>
              </div>
              <div class="modal-body">
                <p>A patient with the same <strong>name and date of birth</strong> already exists:</p>
                <table class="table table-sm table-bordered mb-3">
                  <thead class="table-light"><tr><th>Patient ID</th><th>Name</th><th>DOB</th><th>Phone</th></tr></thead>
                  <tbody>${rows}</tbody>
                </table>
                <p class="mb-0 text-muted small">You are trying to create: <strong>${newPatient.firstName} ${newPatient.lastName}</strong> (DOB: ${newPatient.dob})</p>
              </div>
              <div class="modal-footer">
                <button class="btn btn-outline-secondary" id="dupCancelBtn"><i class="fas fa-times me-1"></i>Cancel — Go Back</button>
                <button class="btn btn-warning" id="dupProceedBtn"><i class="fas fa-save me-1"></i>Save Anyway</button>
              </div>
            </div>
          </div>
        </div>`;
        document.body.appendChild(div.firstElementChild);

        const modalEl = document.getElementById('dupWarnModal');
        const modal = new bootstrap.Modal(modalEl);

        document.getElementById('dupProceedBtn').onclick = () => { modal.hide(); resolve(true); };
        document.getElementById('dupCancelBtn').onclick  = () => { modal.hide(); resolve(false); };
        modalEl.addEventListener('hidden.bs.modal', () => modalEl.remove(), { once: true });

        modal.show();
    });
}

// ----- Delete (soft or hard depending on config) -----
function promptDelete(id) {
    crudState.deletingId = id;
    var isSoftDelete = crudState.config && crudState.config.softDelete;
    // Update modal text to reflect soft vs hard delete
    var modalBody = document.querySelector('#deleteModal .modal-body');
    var confirmBtn = document.getElementById('confirmDeleteBtn');
    if (modalBody) modalBody.textContent = isSoftDelete
        ? 'This will disable the record. All history will be preserved and it can be restored later.'
        : 'Are you sure you want to delete this record? This action cannot be undone.';
    if (confirmBtn) confirmBtn.textContent = isSoftDelete ? 'Disable' : 'Delete';
    var modal = new bootstrap.Modal(document.getElementById('deleteModal'));
    modal.show();
    document.getElementById('confirmDeleteBtn').onclick = function() { confirmDelete(); };
}

async function confirmDelete() {
    var id = crudState.deletingId;
    if (!id) return;
    try {
        var res = await fetchWithAuth(crudState.endpoint + '/' + id, { method: 'DELETE' });
        if (!res) return;
        if (res.ok || res.status === 204) {
            bootstrap.Modal.getInstance(document.getElementById('deleteModal')).hide();
            var isSoftDelete = crudState.config && crudState.config.softDelete;
            showToast(isSoftDelete ? 'Record disabled. History preserved.' : 'Record deleted.', 'success');
            await refreshTable();
        } else {
            var err = await res.json();
            showToast(err.error || err.message || 'Operation failed.', 'danger');
        }
    } catch (e) {
        showToast('Network error.', 'danger');
    }
}

async function restoreRecord(id) {
    try {
        var res = await fetchWithAuth(crudState.endpoint + '/' + id + '/restore', { method: 'PUT' });
        if (!res) return;
        if (res.ok) {
            var data = await res.json();
            showToast(data.message || 'Record restored.', 'success');
            await refreshTable();
        } else {
            var err = await res.json();
            showToast(err.error || err.message || 'Restore failed.', 'danger');
        }
    } catch (e) {
        showToast('Network error.', 'danger');
    }
}

// =============================================
// CSV Export — shared across all pages
// =============================================
async function exportToCsv(filename, headers, rows) {
    const csvLines = [headers, ...rows].map(row =>
        row.map(val => '"' + String(val == null ? '' : val).replace(/"/g, '""') + '"').join(',')
    );
    const csvContent = csvLines.join('\n');

    // 1. Try modern File System Access API to force Windows Explorer "Save As" Dialog
    if (window.showSaveFilePicker) {
        try {
            const handle = await window.showSaveFilePicker({
                suggestedName: filename,
                types: [{
                    description: 'CSV Files',
                    accept: {
                        'text/csv': ['.csv']
                    }
                }]
            });
            const writable = await handle.createWritable();
            await writable.write(csvContent); // Write string directly to avoid [object Blob] serialization bugs
            await writable.close();
            showToast('File saved successfully.', 'success');
            return;
        } catch (err) {
            // User aborted the dialog (cancelled)
            if (err.name === 'AbortError') {
                return;
            }
            console.warn('showSaveFilePicker failed or cancelled, falling back to anchor download:', err);
        }
    }

    // 2. Fallback: Standard automatic download
const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 150);
    showToast('Downloading: ' + filename, 'success');
}

// ----- Role & Permissions Helpers -----
// Single source of truth is rbac.js on the server.
// The client fetches from GET /api/roles/permission-defaults and caches it.
var _roleDefaultsCache = null;

// Sync fallback — used as OR fallback when user.permissions already exists.
// Returns empty object; the real defaults come from the server via fetchRoleDefaults().
function getRoleDefaultPermissions(roleName) {
    // If cache is already loaded, return from it synchronously
    if (_roleDefaultsCache && _roleDefaultsCache[roleName]) {
        return _roleDefaultsCache[roleName];
    }
    // Safe fallback: grant visible=true for known modules so UI doesn't hide anything
    // for users that do have stored permissions (which is the normal case)
    return {};
}

// Async: fetch role defaults from server (single source of truth) and cache
async function fetchRoleDefaults(roleName) {
    if (!_roleDefaultsCache) {
        try {
            var res = await fetchWithAuth('/api/roles/permission-defaults', { silent: true });
            if (res && res.ok) {
                _roleDefaultsCache = await res.json();
            }
        } catch(e) { /* network error — leave cache null */ }
    }
    return (_roleDefaultsCache && _roleDefaultsCache[roleName]) || {};
}

// Render a read-only Role Permissions Matrix into the given container element
async function renderRolePermissionsMatrix(containerId) {
    var container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '<p class="text-center text-muted py-3"><i class="fas fa-spinner fa-spin me-2"></i>Loading permissions matrix...</p>';

    var res = await fetchWithAuth('/api/roles/permission-defaults', { silent: true });
    if (!res || !res.ok) {
        container.innerHTML = '<p class="text-danger text-center">Failed to load permissions matrix.</p>';
        return;
    }
    var matrix = await res.json();

    var moduleLabels = [
        { key: 'dashboard',          label: 'Dashboard',                    group: 'Core' },
        { key: 'patients',           label: 'Patients',                     group: 'Core' },
        { key: 'rx_records',         label: 'RX Records',                   group: 'Core' },
        { key: 'reports',            label: 'Reports',                      group: 'Core' },
        { key: 'patient_notes',      label: 'Patient Notes',                group: 'Core' },
        { key: 'audit_log',          label: 'Audit Log',                    group: 'Admin' },
        { key: 'import',             label: 'Data Import',                  group: 'Admin' },
        { key: 'pharmacies',         label: 'Pharmacies',                   group: 'Settings' },
        { key: 'patient_transport',  label: 'Patient Transport',            group: 'Settings' },
        { key: 'pharmacy_transport', label: 'Pharmacy Transport',           group: 'Settings' },
        { key: 'workflow_actions',   label: 'Workflow Actions',             group: 'Settings' },
        { key: 'clinics',            label: 'Clinics',                      group: 'Settings' },
        { key: 'medication_catalog', label: 'RX Actions Catalog',           group: 'Settings' },
        { key: 'users',              label: 'User Management',              group: 'Admin-Only' },
        { key: 'backups',            label: 'Backups',                      group: 'Admin-Only' },
        { key: 'system_settings',    label: 'System Settings',              group: 'Admin-Only' }
    ];

    var roles = ['Administrator', 'Supervisor', 'Operator', 'Read Only'];

    function badge(val, icon, color) {
        return val ? '<span class="badge bg-' + color + ' me-1" style="font-size:.62rem"><i class="fas fa-' + icon + '"></i></span>'
                   : '<span class="badge bg-secondary opacity-25 me-1" style="font-size:.62rem"><i class="fas fa-' + icon + '"></i></span>';
    }

    function cellHTML(perm) {
        if (!perm || !perm.visible) {
            return '<td class="text-center" style="background:rgba(220,53,69,.08)"><span class="badge bg-danger" style="font-size:.65rem"><i class="fas fa-eye-slash me-1"></i>Hidden</span></td>';
        }
        var bits = badge(perm.canEdit,   'edit',       'primary') +
                   badge(perm.canDelete, 'trash',      'danger')  +
                   badge(perm.canExport, 'file-csv',   'success') +
                   (perm.canUndo ? badge(perm.canUndo, 'undo', 'warning') : '');
        return '<td class="text-center" style="background:rgba(25,135,84,.06)">' + bits + '</td>';
    }

    var lastGroup = '';
    var rows = moduleLabels.map(function(m) {
        var groupRow = '';
        if (m.group !== lastGroup) {
            lastGroup = m.group;
            var groupColors = { 'Core': '#0d6efd', 'Admin': '#fd7e14', 'Settings': '#6c757d', 'Admin-Only': '#dc3545' };
            groupRow = '<tr style="background:rgba(255,255,255,.03)"><td colspan="' + (roles.length + 1) + '" class="fw-bold py-1 px-3" style="font-size:.72rem;text-transform:uppercase;letter-spacing:.08em;color:' + (groupColors[m.group] || '#aaa') + '">' + m.group + '</td></tr>';
        }
        var cells = roles.map(function(r) {
            return cellHTML(matrix[r] && matrix[r][m.key]);
        }).join('');
        return groupRow + '<tr><td class="ps-3 fw-semibold" style="font-size:.85rem;white-space:nowrap">' + m.label + '</td>' + cells + '</tr>';
    }).join('');

    var legend = '<div class="d-flex flex-wrap gap-3 mt-3 small text-muted">' +
        '<span>' + badge(true,'edit','primary') + ' Can Edit / Add</span>' +
        '<span>' + badge(true,'trash','danger') + ' Can Delete</span>' +
        '<span>' + badge(true,'file-csv','success') + ' Can Export</span>' +
        '<span>' + badge(true,'undo','warning') + ' Can Undo</span>' +
        '<span><span class="badge bg-danger" style="font-size:.62rem"><i class="fas fa-eye-slash"></i></span> Hidden</span>' +
        '</div>';

    container.innerHTML =
        '<div class="table-responsive">' +
        '<table class="table table-bordered table-sm align-middle mb-0" style="font-size:.82rem">' +
        '<thead class="table-dark"><tr>' +
        '<th style="min-width:160px">Module / Section</th>' +
        roles.map(function(r) {
            var icons = { 'Administrator': 'fa-shield-alt', 'Supervisor': 'fa-user-tie', 'Operator': 'fa-user-cog', 'Read Only': 'fa-user-lock' };
            var colors = { 'Administrator': '#f59e0b', 'Supervisor': '#60a5fa', 'Operator': '#34d399', 'Read Only': '#9ca3af' };
            return '<th class="text-center" style="width:115px;color:' + colors[r] + '"><i class="fas ' + icons[r] + ' me-1"></i>' + r + '</th>';
        }).join('') +
        '</tr></thead><tbody>' + rows + '</tbody></table></div>' + legend;
}

function getPermissionsHTML(existingPermissions) {
    // Dashboard is always visible — not configurable
    // Columns: Visible | Edit | Delete | Export | Undo (rx_records only)
    var menus = [
        { key: 'patients',          label: 'Patients',                             hasUndo: false, visibleOnly: false },
        { key: 'rx_records',        label: 'RX Records',                            hasUndo: true,  visibleOnly: false },
        { key: 'reports',           label: 'Reports',                               hasUndo: false, visibleOnly: false },
        { key: 'audit_log',         label: 'Recent Activity / Audit Log',           hasUndo: false, visibleOnly: true  },
        { key: 'import',            label: 'Data Import',                           hasUndo: false, visibleOnly: false },
        { key: 'pharmacies',        label: 'Pharmacies (Settings)',                 hasUndo: false, visibleOnly: false },
        { key: 'patient_transport', label: 'Patient Transport (Settings)',           hasUndo: false, visibleOnly: false },
        { key: 'pharmacy_transport',label: 'Pharmacy Transport (Settings)',          hasUndo: false, visibleOnly: false },
        { key: 'workflow_actions',  label: 'Workflow Actions (Settings)',            hasUndo: false, visibleOnly: false },
        { key: 'clinics',           label: 'Clinics (Settings)',                    hasUndo: false, visibleOnly: false },
        { key: 'medication_catalog',label: 'RX Actions (Settings)',                 hasUndo: false, visibleOnly: false },
        { key: 'patient_notes',     label: 'Patient Notes',                         hasUndo: false, visibleOnly: false, notesOnly: true },
        { key: 'users',             label: 'User Management (Settings)',            hasUndo: false, visibleOnly: false },
        { key: 'backups',           label: 'Backups (Admin only by default)',        hasUndo: false, visibleOnly: true  },
        { key: 'system_settings',   label: 'System Settings (Admin only by default)',hasUndo: false, visibleOnly: true  }
    ];

    var html = '<div class="mb-3 mt-4 border-top pt-3">' +
        '<label class="form-label fw-bold"><i class="fas fa-user-shield me-2"></i>Granular Menu Permissions</label>' +
        '<p class="text-muted small mb-2">Control exactly what each user can see and do per section.</p>' +
        '<div class="table-responsive">' +
        '<table class="table table-bordered table-sm align-middle text-center small mb-0">' +
        '<thead class="table-dark">' +
        '<tr>' +
        '<th class="text-start" style="min-width:180px">Menu / Section</th>' +
        '<th style="width:70px"><i class="fas fa-eye me-1"></i>Visible</th>' +
        '<th style="width:70px"><i class="fas fa-edit me-1"></i>Edit</th>' +
        '<th style="width:70px"><i class="fas fa-trash me-1"></i>Delete</th>' +
        '<th style="width:70px"><i class="fas fa-file-csv me-1"></i>Export</th>' +
        '<th style="width:70px"><i class="fas fa-undo me-1"></i>Undo</th>' +
        '</tr>' +
        '</thead>' +
        '<tbody>' +
        // Locked Dashboard row
        '<tr class="table-secondary">' +
        '<td class="text-start"><strong>Dashboard</strong> <span class="badge bg-secondary ms-1"><i class="fas fa-lock me-1"></i>Always On</span></td>' +
        '<td><input type="checkbox" class="form-check-input" checked disabled></td>' +
        '<td><span class="text-muted">—</span></td>' +
        '<td><span class="text-muted">—</span></td>' +
        '<td><span class="text-muted">—</span></td>' +
        '<td><span class="text-muted">—</span></td>' +
        '</tr>';

    menus.forEach(function(m) {
        var raw = existingPermissions && existingPermissions[m.key];
        var perm;
        if (raw) {
            perm = {
                visible:   raw.visible   !== undefined ? !!raw.visible   : true,
                canEdit:   raw.canEdit   !== undefined ? !!raw.canEdit   : false,
                canDelete: raw.canDelete !== undefined ? !!raw.canDelete : false,
                canExport: raw.canExport !== undefined ? !!raw.canExport : false,
                canUndo:   raw.canUndo   !== undefined ? !!raw.canUndo   : false
            };
        } else {
            perm = { visible: true, canEdit: true, canDelete: true, canExport: true, canUndo: true };
        }

        if (m.visibleOnly) {
            // Only the Visible toggle — all action columns show —
            html += '<tr data-menu="' + m.key + '">' +
                '<td class="text-start"><strong>' + m.label + '</strong> <span class="badge bg-info ms-1" style="font-size:0.65em">View only</span></td>' +
                '<td><input type="checkbox" class="form-check-input perm-visible" ' + (perm.visible ? 'checked' : '') + '></td>' +
                '<td><span class="text-muted">\u2014</span></td>' +
                '<td><span class="text-muted">\u2014</span></td>' +
                '<td><span class="text-muted">\u2014</span></td>' +
                '<td><span class="text-muted">\u2014</span></td>' +
                '</tr>';
        } else if (m.notesOnly) {
            // Patient Notes row: canEdit = can add notes, canDelete = can delete notes
            // Visible / Export / Undo are not applicable \u2014 show dashes
            html += '<tr data-menu="' + m.key + '" style="background:rgba(255,193,7,.06)">' +
                '<td class="text-start"><strong>' + m.label + '</strong> <span class="badge bg-warning text-dark ms-1" style="font-size:0.65em"><i class="fas fa-sticky-note me-1"></i>Per-patient</span></td>' +
                '<td><span class="text-muted" title="Always visible when patient is accessible">\u2014</span></td>' +
                '<td title="Can add new notes"><input type="checkbox" class="form-check-input perm-canedit" ' + (perm.canEdit ? 'checked' : '') + '></td>' +
                '<td title="Can delete notes (own or others)"><input type="checkbox" class="form-check-input perm-candelete" ' + (perm.canDelete ? 'checked' : '') + '></td>' +
                '<td><span class="text-muted">\u2014</span></td>' +
                '<td><span class="text-muted">\u2014</span></td>' +
                '</tr>';
        } else {
            var undoCell = m.hasUndo
                ? '<input type="checkbox" class="form-check-input perm-canundo" ' + (perm.canUndo ? 'checked' : '') + '>'
                : '<span class="text-muted">\u2014</span>';
            html += '<tr data-menu="' + m.key + '">' +
                '<td class="text-start"><strong>' + m.label + '</strong></td>' +
                '<td><input type="checkbox" class="form-check-input perm-visible" ' + (perm.visible ? 'checked' : '') + '></td>' +
                '<td><input type="checkbox" class="form-check-input perm-canedit" ' + (perm.canEdit ? 'checked' : '') + '></td>' +
                '<td><input type="checkbox" class="form-check-input perm-candelete" ' + (perm.canDelete ? 'checked' : '') + '></td>' +
                '<td><input type="checkbox" class="form-check-input perm-canexport" ' + (perm.canExport ? 'checked' : '') + '></td>' +
                '<td>' + undoCell + '</td>' +
                '</tr>';
        }
    });


    html += '</tbody></table></div></div>';
    return html;
}

function applyReadOnlyRestrictions() {
    var user = null;
    try { user = JSON.parse(localStorage.getItem('user')); } catch (e) { return; }
    if (!user) return;

    var permissions = user.permissions || getRoleDefaultPermissions(user.role);
    // Dashboard always visible
    if (permissions.dashboard) permissions.dashboard.visible = true;
    else permissions.dashboard = { visible: true, canEdit: false, canDelete: false, canExport: true };

    var sidebarMapping = {
        '/dashboard':         'dashboard',
        '/patients':          'patients',
        '/rx-records':        'rx_records',
        '/reports':           'reports',
        '/import':            'import',
        '/pharmacies':        'pharmacies',
        '/patient-transport': 'patient_transport',
        '/pharmacy-transport':'pharmacy_transport',
        '/workflow-actions':  'workflow_actions',
        '/clinics':           'clinics',
        '/users':             'users'
    };

    var currentPath = window.location.pathname;
    var key = sidebarMapping[currentPath];
    if (!key) return;

    // Defaults: everything allowed ONLY when no permission object is stored
    var rawP = permissions[key];
    var perm = rawP
        ? {
            visible:   rawP.visible   !== undefined ? !!rawP.visible   : true,
            canEdit:   rawP.canEdit   !== undefined ? !!rawP.canEdit   : false,
            canDelete: rawP.canDelete !== undefined ? !!rawP.canDelete : false,
            canExport: rawP.canExport !== undefined ? !!rawP.canExport : false,
            canUndo:   rawP.canUndo   !== undefined ? !!rawP.canUndo   : false
          }
        : { visible: true, canEdit: true, canDelete: true, canExport: true, canUndo: true };

    // ---- hide EXPORT buttons ----
    if (!perm.canExport) {
        var exportIds = ['exportCsvBtn','exportPatientsCsvBtn','exportRxListCsvBtn',
                         'exportPatientCsv','exportRxCsv','drilldownCsvBtn'];
        exportIds.forEach(function(id) {
            var el = document.getElementById(id);
            if (el) el.classList.add('d-none');
        });
    }

    // ---- hide EDIT / ADD buttons ----
    if (!perm.canEdit) {
        ['addNewBtn','addPatientBtn','addRxBtn','savePatientBtn','saveRxBtn','saveCrudBtn','addMedBtn']
            .forEach(function(id) {
                var el = document.getElementById(id);
                if (el) el.classList.add('d-none');
            });
        // edit-record buttons generated into tables
        document.querySelectorAll(
            'button[onclick*="editRecord"],button[onclick*="openPatientModal"],button[onclick*="completeStep"]'
        ).forEach(function(el) { el.classList.add('d-none'); });
    }

    // ---- hide DELETE buttons ----
    if (!perm.canDelete) {
        ['confirmDeleteBtn']
            .forEach(function(id) {
                var el = document.getElementById(id);
                if (el) el.classList.add('d-none');
            });
        document.querySelectorAll(
            'button[onclick*="promptDelete"],button[onclick*="promptDeletePatient"],button[onclick*="deleteRx"],button[onclick*="restorePatient"]'
        ).forEach(function(el) { el.classList.add('d-none'); });
    }

    // ---- hide UNDO buttons (rx_records only) ----
    if (!perm.canUndo) {
        document.querySelectorAll('button[onclick*="undoStep"]')
            .forEach(function(el) { el.classList.add('d-none'); });
    }

    // ---- hide generic CRUD Actions column if nothing can be done ----
    if (!perm.canEdit && !perm.canDelete) {
        var thead = document.getElementById('tableHeaders');
        if (thead) {
            var thList = thead.querySelectorAll('th');
            if (thList.length > 0) {
                var lastTh = thList[thList.length - 1];
                if (lastTh && lastTh.textContent.trim() === 'Actions') lastTh.classList.add('d-none');
            }
        }
        document.querySelectorAll('#crudTable tbody tr').forEach(function(tr) {
            var tdList = tr.querySelectorAll('td');
            if (tdList.length > 0) {
                var lastTd = tdList[tdList.length - 1];
                if (lastTd && (lastTd.querySelector('button[onclick*="edit"]') || lastTd.querySelector('button[onclick*="promptDelete"]'))) {
                    lastTd.classList.add('d-none');
                }
            }
        });
    }

    // ---- hide Audit Log sidebar link + Reports button + Recent Activity card ----
    (function() {
        try {
            var auditRawP = permissions['audit_log'];
            var auditVisible;
            if (!auditRawP) {
                auditVisible = false;
            } else {
                auditVisible = auditRawP.visible === true;
            }
            if (!auditVisible) {
                // Sidebar: hide Audit Log link in all nav menus
                document.querySelectorAll('#auditLogSidebarLink, a[href="/audit-log"]').forEach(function(el) {
                    var li = el.closest('li');
                    if (li) li.style.display = 'none';
                    else el.style.display = 'none';
                });
                // Reports page: hide Audit Log shortcut button
                var auditShortcut = document.getElementById('auditLogShortcutBtn');
                if (auditShortcut) auditShortcut.classList.add('d-none');
                // Dashboard: hide Recent Activity card
                var activityCard = document.getElementById('recentActivityCard');
                if (activityCard) activityCard.classList.add('d-none');
                // If currently ON the audit-log page, redirect away
                if (window.location.pathname === '/audit-log') {
                    window.location.replace('/dashboard');
                }
            }
        } catch(e) {}
    })();
}

function observeAndApplyRestrictions() {
    applyReadOnlyRestrictions();
    // Always watch document.body — modals are rendered at body level, outside #content
    var observer = new MutationObserver(function(mutations) {
        observer.disconnect();
        applyReadOnlyRestrictions();
        observer.observe(document.body, { childList: true, subtree: true });
    });
    observer.observe(document.body, { childList: true, subtree: true });
}


// ── Notification Bell ────────────────────────────────────────────────────────
var _notifLastSeen = localStorage.getItem('notifLastSeen') ? parseInt(localStorage.getItem('notifLastSeen')) : 0;
var _notifData     = [];
var _notifOpen     = false;

const NOTIF_ICONS = {
    Create:  { icon: 'fa-plus-circle',    color: '#198754' },
    Update:  { icon: 'fa-edit',           color: '#0d6efd' },
    Delete:  { icon: 'fa-trash-alt',      color: '#dc3545' },
    Login:   { icon: 'fa-sign-in-alt',    color: '#0dcaf0' },
    Logout:  { icon: 'fa-sign-out-alt',   color: '#6c757d' },
    Restore: { icon: 'fa-undo',           color: '#fd7e14' },
    Disable: { icon: 'fa-ban',            color: '#dc3545' },
};

function setupNotifications() {
    var themeBtn = document.getElementById('themeToggle');
    if (!themeBtn) return;

    var bellWrapper = document.createElement('div');
    bellWrapper.id = 'notifWrapper';
    bellWrapper.style.cssText = 'position:relative;display:inline-block;';
    bellWrapper.innerHTML =
        '<button id="notifBell" class="btn btn-outline-secondary btn-sm" style="position:relative;min-width:36px" title="Notifications">' +
            '<i class="fas fa-bell"></i>' +
            '<span id="notifBadge" style="display:none;position:absolute;top:-6px;right:-6px;background:#dc3545;color:#fff;border-radius:50%;width:18px;height:18px;font-size:.65rem;font-weight:700;line-height:18px;text-align:center;border:2px solid var(--card-bg,#fff)">0</span>' +
        '</button>' +
        '<div id="notifDropdown" style="display:none;position:absolute;top:calc(100% + 8px);right:0;width:360px;' +
             'background:var(--card-bg,#fff);border:1px solid var(--border-color,#dee2e6);' +
             'border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.18);z-index:9999;overflow:hidden">' +
            '<div style="padding:12px 16px;border-bottom:1px solid var(--border-color,#dee2e6);display:flex;justify-content:space-between;align-items:center">' +
                '<span style="font-weight:700;font-size:.9rem"><i class="fas fa-bell me-2" style="color:#4a90e2"></i>Notifications</span>' +
                '<button id="notifMarkAll" style="border:none;background:none;font-size:.75rem;color:#4a90e2;cursor:pointer;padding:0">Mark all read</button>' +
            '</div>' +
            '<div id="notifList" style="max-height:360px;overflow-y:auto"></div>' +
            '<div style="padding:10px 16px;text-align:center;border-top:1px solid var(--border-color,#dee2e6)">' +
                '<a href="/audit-log" style="font-size:.8rem;color:#4a90e2;text-decoration:none"><i class="fas fa-history me-1"></i>View all in Audit Log</a>' +
            '</div>' +
        '</div>';

    themeBtn.parentNode.insertBefore(bellWrapper, themeBtn);

    var bell     = document.getElementById('notifBell');
    var dropdown = document.getElementById('notifDropdown');
    var badge    = document.getElementById('notifBadge');

    bell.addEventListener('click', function(e) {
        e.stopPropagation();
        _notifOpen = !_notifOpen;
        dropdown.style.display = _notifOpen ? 'block' : 'none';
        if (_notifOpen) {
            _notifLastSeen = Date.now();
            localStorage.setItem('notifLastSeen', _notifLastSeen);
            badge.style.display = 'none';
            renderNotifications();
        }
    });

    document.addEventListener('click', function() {
        if (_notifOpen) {
            _notifOpen = false;
            dropdown.style.display = 'none';
        }
    });

    dropdown.addEventListener('click', function(e) { e.stopPropagation(); });

    document.getElementById('notifMarkAll').addEventListener('click', function() {
        _notifLastSeen = Date.now();
        localStorage.setItem('notifLastSeen', _notifLastSeen);
        badge.style.display = 'none';
        renderNotifications();
    });

    fetchNotifications();
    setInterval(fetchNotifications, 60000);
}

async function fetchNotifications() {
    try {
        var token = localStorage.getItem('token');
        if (!token) return;
        var res = await fetch('/api/audit-logs?limit=20&page=1', {
            headers: { 'Authorization': 'Bearer ' + token }
        });
        if (!res.ok) return;
        var json = await res.json();
        _notifData = (json.data || json || []).slice(0, 20);
        updateNotifBadge();
    } catch(e) { /* silent — non-admin users won't have access */ }
}

function updateNotifBadge() {
    var badge = document.getElementById('notifBadge');
    if (!badge) return;
    var unread = _notifData.filter(function(n) {
        return new Date(n.createdAt).getTime() > _notifLastSeen;
    }).length;
    if (unread > 0) {
        badge.textContent = unread > 9 ? '9+' : unread;
        badge.style.display = 'block';
    } else {
        badge.style.display = 'none';
    }
    if (_notifOpen) renderNotifications();
}

function renderNotifications() {
    var list = document.getElementById('notifList');
    if (!list) return;
    if (!_notifData.length) {
        list.innerHTML = '<p style="text-align:center;color:#888;padding:24px 0;font-size:.85rem"><i class="fas fa-check-circle me-2 text-success"></i>No recent activity</p>';
        return;
    }
    list.innerHTML = _notifData.map(function(n) {
        var meta    = NOTIF_ICONS[n.action] || { icon: 'fa-info-circle', color: '#6c757d' };
        var user    = n.User ? (n.User.firstName + ' ' + n.User.lastName) : 'System';
        var timeStr = timeAgo(new Date(n.createdAt));
        var isUnread = new Date(n.createdAt).getTime() > _notifLastSeen;
        var bgColor  = isUnread ? 'rgba(74,144,226,0.06)' : 'transparent';
        var module   = (n.module || 'System').replace(/_/g, ' ');
        return '<div style="display:flex;align-items:flex-start;padding:11px 16px;border-bottom:1px solid var(--border-color,#dee2e6);cursor:default;background:' + bgColor + '" ' +
               'onmouseover="this.style.background=\'rgba(74,144,226,0.1)\'" onmouseout="this.style.background=\'' + bgColor + '\'">' +
            '<div style="width:34px;height:34px;border-radius:50%;background:' + meta.color + '1a;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-right:12px">' +
                '<i class="fas ' + meta.icon + '" style="color:' + meta.color + ';font-size:.82rem"></i>' +
            '</div>' +
            '<div style="flex:1;min-width:0">' +
                '<div style="font-size:.82rem;font-weight:' + (isUnread ? '700' : '500') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' +
                    '<span style="color:' + meta.color + '">' + (n.action || '') + '</span>' +
                    ' <span>' + module + '</span>' +
                '</div>' +
                '<div style="font-size:.75rem;color:#888;margin-top:2px">' +
                    '<i class="fas fa-user" style="font-size:.65rem;margin-right:3px"></i>' + user +
                '</div>' +
            '</div>' +
            '<div style="font-size:.7rem;color:#aaa;flex-shrink:0;margin-left:8px;margin-top:2px">' + timeStr + '</div>' +
        '</div>';
    }).join('');
}

function timeAgo(date) {
    var s = Math.floor((Date.now() - date.getTime()) / 1000);
    if (s < 60)    return 'just now';
    if (s < 3600)  return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
}
