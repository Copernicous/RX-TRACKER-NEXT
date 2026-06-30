// base.js — Proxy-aware base path detection.
// FortiGate Agentless VPN Portal rewrites href attributes on <a> elements,
// so a hidden <a id="xa-base" href="/login"> becomes the full proxy URL
// e.g. https://rx.camperos.net:10443/proxy/513c244a/http/192.168.15.87:3000/login
// We strip the trailing "/login" to get the base path prefix for ALL navigation.
//
// Usage (available globally after this script loads):
//   window.RX_BASE      — e.g. "https://rx.camperos.net:10443/proxy/513c244a/http/192.168.15.87:3000"
//   window.rxUrl(path)  — returns the full proxy-aware URL for any app path
//   window.rxNav(path)  — navigates to a proxy-aware URL (replaces window.location.href)

(function () {
    var base = '';

    // The anchor xa-base must exist in every page with href="/login"
    // FortiGate rewrites the href to its proxied equivalent.
    var el = document.getElementById('xa-base');
    if (el && el.href) {
        // el.href is the FULLY-RESOLVED URL (browsers always resolve href to absolute)
        // e.g. "https://rx.camperos.net:10443/proxy/513c244a/http/192.168.15.87:3000/login"
        var full = el.href;
        // Strip the "/login" suffix (and any trailing slash) to get base
        base = full.replace(/\/login\/?$/, '').replace(/\/$/, '');
    }

    // Fallback: if no anchor or href (direct local access), derive from location
    if (!base) {
        base = window.location.origin;
    }

    window.RX_BASE = base;

    /**
     * Returns the absolute, proxy-aware URL for an app-root-relative path.
     * path must start with '/', e.g. '/api/auth/login', '/dashboard'
     */
    window.rxUrl = function (path) {
        return base + path;
    };

    /**
     * Navigates to a proxy-aware URL (hard navigation).
     */
    window.rxNav = function (path) {
        window.location.href = base + path;
    };
})();

// ─── Security Utilities (globally available) ─────────────────────────────────

/**
 * escHtml — sanitize a string before inserting into innerHTML.
 * Converts <, >, &, " to safe HTML entities so user-supplied content
 * cannot execute as HTML/JS (prevents XSS via audit log, names, etc.)
 * Usage: element.innerHTML = escHtml(untrustedString);
 */
function escHtml(s) {
    return String(s == null ? '' : s)
        .replace(/&/g,  '&amp;')
        .replace(/</g,  '&lt;')
        .replace(/>/g,  '&gt;')
        .replace(/"/g,  '&quot;')
        .replace(/'/g,  '&#x27;');
}

/**
 * sanitizeCsvCell — prevent CSV/spreadsheet formula injection.
 * If a cell value starts with =, +, -, @, tab, or carriage return,
 * Excel/LibreOffice would execute it as a formula. Prefix with ' to neutralize.
 * Usage: replace all cell values with sanitizeCsvCell(value) before building CSV.
 */
function sanitizeCsvCell(val) {
    var s = String(val == null ? '' : val);
    if (s.length > 0 && ['=', '+', '-', '@', '\t', '\r'].indexOf(s[0]) !== -1) {
        s = "'" + s;
    }
    return '"' + s.replace(/"/g, '""') + '"';
}

function rxReadCookie(name) {
    var parts = String(document.cookie || '').split(';');
    for (var i = 0; i < parts.length; i++) {
        var pair = parts[i].trim();
        if (pair.indexOf(name + '=') === 0) {
            try { return decodeURIComponent(pair.slice(name.length + 1)); }
            catch (e) { return pair.slice(name.length + 1); }
        }
    }
    return '';
}

window.rxCsrfToken = function() {
    return rxReadCookie('rxCsrf');
};

function rxHeadersToObject(headers) {
    var merged = {};
    if (!headers) return merged;
    if (typeof Headers !== 'undefined' && headers instanceof Headers) {
        headers.forEach(function(value, key) {
            merged[key] = value;
        });
        return merged;
    }
    if (Array.isArray(headers)) {
        for (var i = 0; i < headers.length; i++) {
            if (headers[i] && headers[i].length >= 2) merged[headers[i][0]] = headers[i][1];
        }
        return merged;
    }
    return Object.assign({}, headers || {});
}

function rxGetHeader(headers, name) {
    var lookup = String(name || '').toLowerCase();
    var merged = rxHeadersToObject(headers);
    for (var key in merged) {
        if (Object.prototype.hasOwnProperty.call(merged, key) && String(key).toLowerCase() === lookup) {
            return String(merged[key] || '');
        }
    }
    return '';
}

function rxIsUnsafeMethod(method) {
    return ['POST', 'PUT', 'PATCH', 'DELETE'].indexOf(String(method || 'GET').toUpperCase()) !== -1;
}

function rxIsAppRequest(resource) {
    var url = '';
    if (typeof resource === 'string') {
        url = resource;
    } else if (typeof Request !== 'undefined' && resource instanceof Request) {
        url = resource.url;
    }
    return url.indexOf('/') === 0 ||
        url.indexOf(window.location.origin) === 0 ||
        (window.RX_BASE && url.indexOf(window.RX_BASE) === 0);
}

window.rxCsrfHeaders = function(headers) {
    var merged = rxHeadersToObject(headers);
    var token = window.rxCsrfToken ? window.rxCsrfToken() : '';
    if (token) {
        merged['X-CSRF-Token'] = token;
        merged['X-RX-CSRF-Token'] = token;
    }
    return merged;
};

window.rxApplyCsrf = function(resource, init) {
    init = init || {};
    var method = String(init.method || (typeof Request !== 'undefined' && resource instanceof Request ? resource.method : 'GET') || 'GET').toUpperCase();
    if (!rxIsUnsafeMethod(method) || !rxIsAppRequest(resource)) return init;

    var token = window.rxCsrfToken ? window.rxCsrfToken() : '';
    if (!token) return init;

    init.headers = window.rxCsrfHeaders(init.headers || {});

    if (typeof FormData !== 'undefined' && init.body instanceof FormData) {
        if (!init.body.has('_csrf')) init.body.append('_csrf', token);
        return init;
    }

    var contentType = rxGetHeader(init.headers, 'Content-Type');
    var isJson = !contentType || contentType.toLowerCase().indexOf('application/json') !== -1;
    if (!isJson) return init;

    if (init.body == null || init.body === '') {
        init.headers['Content-Type'] = contentType || 'application/json';
        init.body = JSON.stringify({ _csrf: token });
        return init;
    }

    if (typeof init.body !== 'string') return init;

    try {
        var data = JSON.parse(init.body);
        if (data && typeof data === 'object' && !Array.isArray(data)) {
            if (!data._csrf) data._csrf = token;
            init.body = JSON.stringify(data);
        }
    } catch (e) {
        // Non-JSON string body; keep the request unchanged.
    }
    return init;
};

(function() {
    if (!window.fetch) return;
    var originalFetch = window.fetch.bind(window);
    window.fetch = function(resource, init) {
        init = window.rxApplyCsrf ? window.rxApplyCsrf(resource, init || {}) : (init || {});
        return originalFetch(resource, init);
    };
})();

// ─── Active Session Heartbeat ─────────────────────────────────────────────────
// Sends the current page title + URL to the server every 30s so the
// "Who's Online" dashboard (active-users page) can track logged-in users.
// Uses the rxUrl() helper from base.js for FortiGate proxy compatibility.
(function () {
    function _rxHeartbeat() {
        var currentUser = window.__RX_AUTH_USER || null;
        if (!currentUser) return; // not logged in - skip silently
        var url = typeof window.rxUrl === 'function' ? window.rxUrl('/api/heartbeat') : '/api/heartbeat';
        fetch(url, {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                currentPage: document.title.replace(/ - Patient RX System$/, '').trim(),
                currentUrl:  window.location.pathname
            }),
            keepalive: true
        }).catch(function () {}); // fail silently — non-critical
    }

    // Fire immediately, then every 30 seconds
    _rxHeartbeat();
    setInterval(_rxHeartbeat, 30000);
})();

// ─── Client-Side Error Logger ─────────────────────────────────────────────────
// Logs frontend errors to POST /api/errors so developers can review them
// from the Audit Log → Error Log tab without needing to reproduce the issue.
//
// Usage anywhere in the app:
//   window.logClientError('Network error.', e.message + '\n' + e.stack, 'error');
//   window.logClientError('Validation failed', 'Missing field: arrivalDate', 'warning');
//
// severity: 'error' | 'warning' | 'info'
window.logClientError = function (message, detail, severity) {
    try {
        if (!window.__RX_AUTH_USER) return; // not authenticated - skip
        var url = typeof window.rxUrl === 'function' ? window.rxUrl('/api/errors') : '/api/errors';
        var stack = detail || '';
        // Append page context to make the log actionable
        stack += '\n\nPage: ' + document.title + ' (' + window.location.pathname + ')';
        fetch(url, {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message:  message  || 'Unknown client error',
                stack:    stack,
                url:      window.location.href,
                severity: severity || 'error'
            }),
            keepalive: true
        }).catch(function () {}); // never let logging itself crash the app
    } catch (e) { /* never let logging itself crash the app */ }
};

// ─── Auto-catch ALL unhandled JS errors + Promise rejections ─────────────────
// Any crash or unhandled rejection anywhere in the app is now automatically
// saved to the ErrorLog DB table — no manual try/catch needed.
(function () {
    // Uncaught JS errors (syntax errors, null references, etc.)
    window.addEventListener('error', function (evt) {
        var msg = evt.message || 'Uncaught JS error';
        var detail = 'Source: ' + evt.filename + ':' + evt.lineno + ':' + evt.colno;
        if (evt.error && evt.error.stack) detail += '\n' + evt.error.stack;
        window.logClientError(msg, detail, 'error');
    });

    // Unhandled Promise rejections (fetch failures, async errors, etc.)
    window.addEventListener('unhandledrejection', function (evt) {
        var reason = evt.reason;
        var msg = reason instanceof Error ? reason.message : String(reason || 'Unhandled promise rejection');
        var detail = reason instanceof Error && reason.stack ? reason.stack : '';
        window.logClientError(msg, detail, 'error');
    });
})();
