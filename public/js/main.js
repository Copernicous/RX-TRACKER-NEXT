// Ensure same-origin fetch requests send cookies, so FortiGate proxy users can authenticate with rxToken cookie fallback.
(function() {
    if (window.fetch) {
        const originalFetch = window.fetch.bind(window);
        window.fetch = function(resource, init) {
            init = init || {};
            const sameOrigin = typeof resource === 'string'
                ? resource.startsWith('/') || resource.startsWith(window.location.origin)
                : resource instanceof Request && resource.url.startsWith(window.location.origin);
            if (sameOrigin && !init.credentials) {
                init.credentials = 'include';
            }
            return originalFetch(resource, init);
        };
    }
})();

document.addEventListener('DOMContentLoaded', () => {
    // Sidebar Toggle
    const sidebarCollapse = document.getElementById('sidebarCollapse');
    if (sidebarCollapse) {
        sidebarCollapse.addEventListener('click', () => {
            document.getElementById('sidebar').classList.toggle('active');
            const content = document.getElementById('content');
            if (document.getElementById('sidebar').classList.contains('active')) {
                content.style.marginLeft = '0';
            } else {
                content.style.marginLeft = '250px';
            }
        });
    }

    // Theme Toggle
    const themeToggle = document.getElementById('themeToggle');
    if (themeToggle) {
        const currentTheme = localStorage.getItem('theme') || 'light';
        document.documentElement.setAttribute('data-theme', currentTheme);
        themeToggle.innerHTML = currentTheme === 'dark' ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
        
        themeToggle.addEventListener('click', () => {
            const theme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', theme);
            localStorage.setItem('theme', theme);
            themeToggle.innerHTML = theme === 'dark' ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
        });
    }

    // Login Handle
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = document.getElementById('username').value;
            const password = document.getElementById('password').value;

            try {
                const res = await fetch(window.rxUrl('/api/auth/login'), {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password })
                });
                const data = await res.json();
                if (res.ok) {
                    localStorage.setItem('token', data.token);
                    localStorage.setItem('user', JSON.stringify(data.user));
                    window.rxNav('/dashboard');
                } else {
                    showToast(data.message || 'Login failed', 'danger');
                }
            } catch (err) {
                showToast('An error occurred.', 'danger');
            }
        });
    }

    // Auth Check on Protected Pages
    if (!loginForm) {
        const token = localStorage.getItem('token');
        if (!token) {
            window.rxNav('/login');
        } else {
            const user = JSON.parse(localStorage.getItem('user'));
            const userGreeting = document.getElementById('userGreeting');
            if (userGreeting && user) {
                userGreeting.innerText = `Hello, ${user.firstName}`;
            }
        }
    }

    // Logout
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            window.rxNav('/login');
        });
    }
});

// Generic Fetch function with Auth header
// Pass options.silent = true to suppress the 403 toast for background/init calls
async function fetchWithAuth(url, options = {}) {
    const token = localStorage.getItem('token');
    const silent = !!options.silent;
    const fetchOptions = Object.assign({}, options);
    delete fetchOptions.silent; // don't send to fetch()
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token,
        ...(fetchOptions.headers || {})
    };
    const res = await fetch(url, { ...fetchOptions, headers });
    // 401 = token expired / invalid → logout
    if (res.status === 401) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.rxNav('/login');
        throw new Error('Unauthorized');
    }
    // 403 = authenticated but forbidden (hidden module, no permission)
    // silent=true → return quietly (background init calls, dropdown loading)
    // silent=false → show a toast so the user knows the action was blocked
    if (res.status === 403) {
        if (!silent) {
            const body = await res.clone().json().catch(() => ({}));
            if (typeof showToast === 'function') {
                showToast(body.message || 'Access denied.', 'warning');
            }
        }
        return res;
    }
    return res;
}

// Toast notification function
function showToast(message, type = 'success') {
    const container = document.querySelector('.toast-container');
    var toastHtml = '<div class="toast align-items-center text-white bg-' + type + ' border-0 show" role="alert" aria-live="assertive" aria-atomic="true" style="margin-bottom: 10px;">' +
        '<div class="d-flex">' +
        '<div class="toast-body">' + message + '</div>' +
        '<button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>' +
        '</div></div>';
    container.insertAdjacentHTML('beforeend', toastHtml);
    setTimeout(() => {
        if (container.firstChild) {
            container.firstChild.remove();
        }
    }, 3000);
}

// Generic CRUD loader placeholder
async function loadCrudData(moduleName, apiEndpoint) {
    try {
        const res = await fetchWithAuth(apiEndpoint);
        const data = await res.json();
        // Here we dynamically build the table based on object keys. 
        // This is a simplification for the foundational phase.
        if (data.length > 0) {
            const headers = Object.keys(data[0]).filter(k => k !== 'passwordHash');
            var _hHtml = ''; for (var _hi = 0; _hi < headers.length; _hi++) { _hHtml += '<th>' + headers[_hi] + '</th>'; }
            document.getElementById('tableHeaders').innerHTML = _hHtml + '<th>Actions</th>';
            
            var _tHtml = ''; for (var _tri = 0; _tri < data.length; _tri++) {
                var row = data[_tri];
                var rowHtml = '<tr>';
                headers.forEach(function(h) {
                    rowHtml += '<td>' + (typeof row[h] === 'object' && row[h] !== null ? row[h].name || row[h].companyName || 'Obj' : row[h]) + '</td>';
                });
                rowHtml += '<td>' +
                    '<button class="btn btn-sm btn-info" data-edit-id="' + row.id + '"><i class="fas fa-edit"></i></button> ' +
                    '<button class="btn btn-sm btn-danger" data-del-id="' + row.id + '" data-del-ep="' + apiEndpoint + '"><i class="fas fa-trash"></i></button>' +
                    '</td></tr>';
                _tHtml += rowHtml;
            }
            document.getElementById('tableBody').innerHTML = _tHtml;
        } else {
            document.getElementById('tableBody').innerHTML = '<tr><td colspan="100%" class="text-center">No records found.</td></tr>';
        }
    } catch (err) {
        showToast('Error loading data', 'danger');
    }
}
