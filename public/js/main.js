// Ensure same-origin fetch requests send cookies, and keep CSRF + proxy-safe URL handling
// compatible with FortiGate portal sessions.
(function() {
    if (!window.fetch || window.__rxFetchWrapped || (typeof window.rxNormalizeFetchResource === 'function' && typeof window.rxApplyCsrf === 'function')) return;
    var originalFetch = window.fetch.bind(window);

    function normalizeFetchResource(resource) {
        if (typeof window.rxNormalizeFetchResource === 'function') {
            return window.rxNormalizeFetchResource(resource);
        }
        if (!resource) return resource;
        if (typeof resource === 'string') {
            var value = String(resource);
            if (!value) return value;
            if (value.indexOf('//') === 0) return value;
            if (/^https?:\/\//i.test(value) || /^mailto:|^tel:|^data:|^#/.test(value)) return value;
            if (value[0] !== '/') return value;
            if (typeof window.rxUrl === 'function') return window.rxUrl(value);
        }
        return resource;
    }

    function isSameOriginResource(resource) {
        var value = '';
        if (typeof resource === 'string') {
            value = resource;
        } else if (resource instanceof Request && resource.url) {
            value = String(resource.url || '');
        }
        if (!value) return false;
        if (value[0] === '/') return true;
        var nativeOrigin = typeof window.rxNativeLocationOrigin === 'function'
            ? window.rxNativeLocationOrigin()
            : '';
        if (nativeOrigin && value.indexOf(nativeOrigin) === 0) return true;
        return !!(window.RX_BASE && value.indexOf(window.RX_BASE) === 0);
    }

    window.fetch = function(resource, init) {
        resource = normalizeFetchResource(resource);
        init = init || {};
        init = window.rxApplyCsrf ? window.rxApplyCsrf(resource, init) : init;
        if (isSameOriginResource(resource) && !init.credentials) {
            init.credentials = 'include';
        }
        return originalFetch(resource, init);
    };
    window.__rxFetchWrapped = true;
})();

document.addEventListener('DOMContentLoaded', function() {
    // Sidebar Toggle
    var sidebarCollapse = document.getElementById('sidebarCollapse');
    if (sidebarCollapse) {
        sidebarCollapse.addEventListener('click', function() {
            document.getElementById('sidebar').classList.toggle('active');
            var content = document.getElementById('content');
            if (document.getElementById('sidebar').classList.contains('active')) {
                content.style.marginLeft = '0';
            } else {
                content.style.marginLeft = '250px';
            }
        });
    }

    // Theme Toggle
    var themeToggle = document.getElementById('themeToggle');
    if (themeToggle) {
        var currentTheme = localStorage.getItem('rxTheme') || 'light';
        document.documentElement.setAttribute('data-theme', currentTheme);
        themeToggle.innerHTML = currentTheme === 'dark' ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';

        themeToggle.addEventListener('click', function() {
            var theme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', theme);
            localStorage.setItem('rxTheme', theme);
            themeToggle.innerHTML = theme === 'dark' ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
        });
    }

    // Auth Check on Protected Pages
    var loginForm = document.getElementById('loginForm');
    if (!loginForm) {
        var user = window.__RX_AUTH_USER || null;
        if (!user) {
            window.rxNav('/login');
        } else {
            var userGreeting = document.getElementById('userGreeting');
            if (userGreeting && user) {
                userGreeting.innerText = 'Hello, ' + user.firstName;
            }
        }
    }

    // Logout
    var logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', function() {
            localStorage.removeItem('token');
            localStorage.removeItem('rxToken');
            localStorage.removeItem('user');
            window.rxNav('/login');
        });
    }
});

// Generic Fetch function with Auth header
// Pass options.silent = true to suppress the 403 toast for background/init calls
async function fetchWithAuth(url, options) {
    options = options || {};
    var silent = !!options.silent;
    var fetchOptions = Object.assign({}, options);
    delete fetchOptions.silent; // don't send to fetch()
    var hasFormDataBody = typeof FormData !== 'undefined' && fetchOptions.body instanceof FormData;
    var headers = Object.assign(hasFormDataBody ? {} : {
        'Content-Type': 'application/json'
    }, fetchOptions.headers || {});
    if (headers.Authorization) delete headers.Authorization;
    var targetUrl = (/^https?:\/\//i.test(String(url || '')) || typeof window.rxUrl !== 'function') ? url : window.rxUrl(url);
    var requestOptions = Object.assign({}, fetchOptions, { headers: headers, credentials: fetchOptions.credentials || 'include' });
    if (typeof window.rxApplyCsrf === 'function') requestOptions = window.rxApplyCsrf(targetUrl, requestOptions);
    var res = await fetch(targetUrl, requestOptions);
    // 401 = token expired / invalid -> logout
    if (res.status === 401) {
        localStorage.removeItem('token');
        localStorage.removeItem('rxToken');
        localStorage.removeItem('user');
        window.rxNav('/login');
        throw new Error('Unauthorized');
    }
    // 403 = authenticated but forbidden
    if (res.status === 403) {
        if (!silent) {
            var body = await res.clone().json().catch(function() { return {}; });
            if (typeof showToast === 'function') {
                showToast(body.message || 'Access denied.', 'warning');
            }
        }
        return res;
    }
    return res;
}

// Toast notification function
function showToast(message, type) {
    type = type || 'success';
    var container = document.querySelector('.toast-container');
    var toastHtml = '<div class="toast align-items-center text-white bg-' + type + ' border-0 show" role="alert" aria-live="assertive" aria-atomic="true" style="margin-bottom: 10px;">' +
        '<div class="d-flex">' +
        '<div class="toast-body">' + message + '</div>' +
        '<button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>' +
        '</div></div>';
    container.insertAdjacentHTML('beforeend', toastHtml);
    setTimeout(function() {
        if (container.firstChild) {
            container.firstChild.remove();
        }
    }, 3000);
}

// Generic CRUD loader placeholder
async function loadCrudData(moduleName, apiEndpoint) {
    try {
        var res = await fetchWithAuth(apiEndpoint);
        var data = await res.json();
        if (data.length > 0) {
            var headers = Object.keys(data[0]).filter(function(k) { return k !== 'passwordHash'; });
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
