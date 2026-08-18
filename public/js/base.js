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
    var base = window.RX_BASE || '';

    function joinKey(parts) {
        return parts.join('');
    }

    // FortiGate rewrites direct window.location.href/pathname/origin property
    // access in downloaded JavaScript so it returns the internal target URL.
    // Resolve the same native browser properties without spelling those access
    // patterns in source, preserving the public /proxy/... URL.
    function getNativeLocation() {
        try {
            return window[joinKey(['loc', 'ation'])];
        } catch (e) {
            return null;
        }
    }

    function getNativeLocationPart(parts) {
        var locationObject = getNativeLocation();
        if (!locationObject) return '';
        try {
            return String(locationObject[joinKey(parts)] || '');
        } catch (e) {
            return '';
        }
    }

    function getNativeObjectPart(object, parts) {
        if (!object) return '';
        try {
            return String(object[joinKey(parts)] || '');
        } catch (e) {
            return '';
        }
    }

    function getOriginFromAbsoluteUrl(value) {
        var match = String(value || '').match(/^(https?:\/\/[^/]+)/i);
        return match ? match[1] : '';
    }

    function getPathnameFromAbsoluteUrl(value) {
        return String(value || '')
            .replace(/^https?:\/\/[^/]+/i, '')
            .replace(/[?#].*$/, '') || '/';
    }

    function cleanProxyPath(pathname) {
        return String(pathname || '').replace(/[?#].*$/, '');
    }

    function splitPath(pathname) {
        return String(cleanProxyPath(pathname)).split('/').filter(function(part) {
            return !!part;
        });
    }

    function parseProxyPrefixFromPath(pathname) {
        var parts = splitPath(pathname);
        var i = -1;
        for (var j = 0; j < parts.length; j++) {
            if (parts[j] === 'proxy') {
                i = j;
                break;
            }
        }
        if (i === -1 || parts.length <= i + 3) return '';
        return '/proxy/' + parts[i + 1] + '/' + parts[i + 2] + '/' + parts[i + 3];
    }

    // The anchor xa-base must exist in every page with href="/login"
    // FortiGate rewrites the href to its proxied equivalent.
    var pageHref = getNativeLocationPart(['h', 'ref']);
    var pagePathname = getNativeLocationPart(['path', 'name'])
        || getPathnameFromAbsoluteUrl(pageHref);
    var pageOrigin = getOriginFromAbsoluteUrl(pageHref);
    var proxyPrefix = parseProxyPrefixFromPath(pagePathname);
    var anchorBase = '';
    if (!base) {
        var el = document.getElementById('xa-base');
        var anchorHref = getNativeObjectPart(el, ['h', 'ref']);
        if (anchorHref) {
            // el.href is the FULLY-RESOLVED URL (browsers always resolve href to absolute)
            // e.g. "https://rx.camperos.net:10443/proxy/513c244a/http/192.168.15.87:3000/login"
            var full = cleanProxyPath(anchorHref);
            // Strip the "/login" suffix (and any trailing slash) to get base
            anchorBase = full.replace(/\/login\/?$/, '').replace(/\/$/, '');
        }
    }
    if (!base && proxyPrefix) {
        base = pageOrigin + proxyPrefix;
    }
    if (!base && anchorBase) base = anchorBase;
    // Fallback path for responses that do not include xa-base.
    if (!base) {
        var fallbackPrefix = parseProxyPrefixFromPath(pagePathname);
        if (fallbackPrefix) base = pageOrigin + fallbackPrefix;
    }
    if (!base) {
        // Local access (no proxy prefix)
        base = pageOrigin;
    }

    window.RX_BASE = base;
    window.RX_PROXY_BASE = base;

    /**
     * Returns the absolute, proxy-aware URL for an app-root-relative path.
     * path must start with '/', e.g. '/api/auth/login', '/dashboard'
     */
    window.rxUrl = function (path) {
        var value = String(path || '');
        if (!value) return base;
        if (value.indexOf('//') === 0) return value;
        if (/^https?:\/\//i.test(value)) return value;
        if (/^mailto:|^tel:|^data:|^#/.test(value)) return value;
        if (value[0] !== '/') return value;
        // Do not prepend the proxy base twice when FortiGate has already
        // rewritten a root-relative attribute to /proxy/<session>/....
        var baseOrigin = getOriginFromAbsoluteUrl(base);
        var basePath = getPathnameFromAbsoluteUrl(base).replace(/\/$/, '');
        if (basePath && (value === basePath || value.indexOf(basePath + '/') === 0)) {
            return baseOrigin + value;
        }
        return base + value;
    };

    /**
     * Navigates to a proxy-aware URL (hard navigation).
     */
    window.rxNav = function (path) {
        var locationObject = getNativeLocation();
        if (locationObject) {
            locationObject[joinKey(['h', 'ref'])] = window.rxUrl(path);
        }
    };

    window.rxNativeLocationHref = function () {
        return getNativeLocationPart(['h', 'ref']);
    };

    window.rxNativeLocationOrigin = function () {
        return getOriginFromAbsoluteUrl(getNativeLocationPart(['h', 'ref']));
    };

    window.rxNativeLocationPathname = function () {
        return getNativeLocationPart(['path', 'name'])
            || getPathnameFromAbsoluteUrl(getNativeLocationPart(['h', 'ref']));
    };

    // Read an anchor's resolved public URL without spelling the property or
    // getAttribute access pattern that FortiGate replaces with get_attr().
    // FortiGate's replacement deliberately restores the internal target URL,
    // which bypasses proxy-aware CSRF classification.
    window.rxElementHref = function (element) {
        return getNativeObjectPart(element, ['h', 'ref']);
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
    var meta = document.querySelector('meta[name="rx-csrf-token"]');
    if (meta && meta.content) return meta.content;
    return rxReadCookie('rxCsrf');
};

// A long-lived proxy tab can retain the token embedded in its HTML after the
// server has refreshed the CSRF cookie (for example after another login or a
// second proxied backend is opened). Call this only after an explicit CSRF
// rejection so the server response has had a chance to refresh the cookie.
window.rxSyncCsrfTokenFromCookie = function() {
    var token = rxReadCookie('rxCsrf');
    if (!token) return '';
    var meta = document.querySelector('meta[name="rx-csrf-token"]');
    if (meta) meta.content = token;
    return token;
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
        url = String(resource[['u', 'rl'].join('')] || '');
    }
    var nativeOrigin = typeof window.rxNativeLocationOrigin === 'function'
        ? window.rxNativeLocationOrigin()
        : '';
    return url.indexOf('/') === 0 ||
        (nativeOrigin && url.indexOf(nativeOrigin) === 0) ||
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

window.rxApplyCsrf = function(resource, init, replaceExisting) {
    init = init || {};
    var method = String(init.method || (typeof Request !== 'undefined' && resource instanceof Request ? resource.method : 'GET') || 'GET').toUpperCase();
    if (!rxIsUnsafeMethod(method) || !rxIsAppRequest(resource)) return init;

    var token = window.rxCsrfToken ? window.rxCsrfToken() : '';
    if (!token) return init;

    init.headers = window.rxCsrfHeaders(init.headers || {});

    if (typeof FormData !== 'undefined' && init.body instanceof FormData) {
        if (replaceExisting && typeof init.body.set === 'function') init.body.set('_csrf', token);
        else if (!init.body.has('_csrf')) init.body.append('_csrf', token);
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
            if (replaceExisting || !data._csrf) data._csrf = token;
            init.body = JSON.stringify(data);
        }
    } catch (e) {
        // Non-JSON string body; keep the request unchanged.
    }
    return init;
};

window.rxWaitForDeliveryLogArchivePrintReady = function(reportWindow) {
    var targetWindow = reportWindow || window;
    var doc = targetWindow.document;
    if (!doc || typeof doc.querySelectorAll !== 'function') {
        return Promise.reject(new Error('Archived delivery log document is unavailable.'));
    }

    var links = Array.prototype.slice.call(doc.querySelectorAll('link[rel~="stylesheet"]'));
    if (!links.length) {
        return Promise.reject(new Error('Archived delivery log stylesheet is missing.'));
    }

    var hrefKey = ['h', 'ref'].join('');
    var stylesheetUrl = typeof window.rxUrl === 'function'
        ? window.rxUrl('/css/rx-delivery-log-archive-v2.css')
        : '/css/rx-delivery-log-archive-v2.css';
    var timerApi = typeof targetWindow.setTimeout === 'function' ? targetWindow : window;

    function waitForStylesheet(link) {
        return new Promise(function(resolve, reject) {
            var settled = false;
            var timer = null;

            function cleanup() {
                if (timer !== null && typeof timerApi.clearTimeout === 'function') timerApi.clearTimeout(timer);
                if (typeof link.removeEventListener === 'function') {
                    link.removeEventListener('load', loaded);
                    link.removeEventListener('error', failed);
                }
            }

            function finish(error) {
                if (settled) return;
                settled = true;
                cleanup();
                if (error) reject(error);
                else resolve();
            }

            function loaded() { finish(); }
            function failed() { finish(new Error('Archived delivery log stylesheet could not be loaded.')); }

            if (typeof link.addEventListener !== 'function') {
                try {
                    if (link.sheet) return finish();
                } catch (_error) {}
                return finish(new Error('Archived delivery log stylesheet readiness cannot be verified.'));
            }

            link.addEventListener('load', loaded);
            link.addEventListener('error', failed);
            timer = timerApi.setTimeout(function() {
                finish(new Error('Archived delivery log stylesheet did not become ready in time.'));
            }, 10000);

            var currentHref = '';
            try { currentHref = String(link[hrefKey] || ''); } catch (_error) {}
            if (stylesheetUrl && currentHref !== stylesheetUrl) {
                link[hrefKey] = stylesheetUrl;
                return;
            }
            try {
                if (link.sheet) finish();
            } catch (_error) {}
        });
    }

    return Promise.all(links.map(waitForStylesheet)).then(function() {
        if (doc.fonts && doc.fonts.ready) return doc.fonts.ready;
        return null;
    }).then(function() {
        if (typeof targetWindow.requestAnimationFrame !== 'function') return null;
        return new Promise(function(resolve) {
            targetWindow.requestAnimationFrame(function() {
                targetWindow.requestAnimationFrame(resolve);
            });
        });
    });
};

// Staging destructive-action confirmation shared by pages that do not load
// app.js (notably Back Office). The token remains memory-only.
if (!window.rxStagingGuard) {
    var rxStagingConfirmation = { header: '', token: '' };
    window.rxStagingGuard = {
        isSafeHeaderName: function(value) {
            return /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(String(value || ''));
        },
        read: function() {
            return {
                header: rxStagingConfirmation.header,
                token: rxStagingConfirmation.token
            };
        },
        remember: function(header, token) {
            if (!this.isSafeHeaderName(header) || !token) return;
            rxStagingConfirmation = {
                header: String(header).toLowerCase(),
                token: String(token)
            };
        },
        forget: function() {
            rxStagingConfirmation = { header: '', token: '' };
        }
    };
}

window.rxFetchWithStagingGuard = async function(resource, init) {
    var requestInit = Object.assign({}, init || {});
    var guard = window.rxStagingGuard;

    function buildRequest(replaceCsrf) {
        var next = Object.assign({}, requestInit, {
            headers: rxHeadersToObject(requestInit.headers || {})
        });
        var remembered = guard && guard.read ? guard.read() : {};
        if (guard
            && guard.isSafeHeaderName(remembered.header)
            && remembered.token) {
            next.headers[remembered.header] = remembered.token;
        }
        if (window.rxApplyCsrf) {
            next = window.rxApplyCsrf(resource, next, !!replaceCsrf);
        }
        return next;
    }

    var requestOptions = buildRequest(false);
    var response = await window.fetch(resource, requestOptions);

    if (response.status === 403) {
        var csrfFailure = await response.clone().json().catch(function() { return {}; });
        var csrfMessage = String((csrfFailure && (csrfFailure.message || csrfFailure.error)) || '');
        if (/csrf validation failed/i.test(csrfMessage)
            && window.rxSyncCsrfTokenFromCookie
            && window.rxSyncCsrfTokenFromCookie()) {
            requestOptions = buildRequest(true);
            response = await window.fetch(resource, requestOptions);
        }
    }

    if (response.status === 428 && guard) {
        var stagingFailure = await response.clone().json().catch(function() { return {}; });
        var requiredHeader = String(stagingFailure.requiredHeader || '').trim().toLowerCase();
        if (guard.isSafeHeaderName(requiredHeader)) {
            guard.forget();
            var stagingToken = window.prompt(
                'Staging safety check: enter the value of STAGING_DESTRUCTIVE_CONFIRM_TOKEN from .env.staging. This is not your application admin password.'
            );
            if (stagingToken) {
                guard.remember(requiredHeader, stagingToken);
                requestOptions = buildRequest(false);
                response = await window.fetch(resource, requestOptions);
                if (response.status === 428) guard.forget();
            }
        }
    }

    return response;
};

function rxNormalizeFetchResource(resource) {
    if (!window.rxUrl || typeof window.rxUrl !== 'function') return resource;
    if (!resource) return resource;
    if (typeof resource === 'string') {
        var value = String(resource);
        if (!value) return value;
        if (value.indexOf('//') === 0) return value;
        if (/^https?:\/\//i.test(value) || /^mailto:|^tel:|^data:|^#/.test(value)) return value;
        if (value[0] === '/') return window.rxUrl(value);
    }
    return resource;
}

function rxIsSameOriginResource(resource) {
    var value = '';
    if (typeof resource === 'string') {
        value = resource;
    } else if (typeof Request !== 'undefined' && resource && resource instanceof Request) {
        value = String(resource[['u', 'rl'].join('')] || '');
    }
    if (!value) return false;
    if (value[0] === '/') return true;
    var nativeOrigin = typeof window.rxNativeLocationOrigin === 'function'
        ? window.rxNativeLocationOrigin()
        : '';
    if (nativeOrigin && value.indexOf(nativeOrigin) === 0) return true;
    return !!(window.RX_BASE && value.indexOf(window.RX_BASE) === 0);
}

window.rxNormalizeFetchResource = rxNormalizeFetchResource;

(function() {
    if (window.__rxFetchWrapped || !window.fetch) return;
    window.__rxFetchWrapped = true;
    var originalFetch = window.fetch.bind(window);
    window.fetch = function(resource, init) {
        resource = rxNormalizeFetchResource(resource);
        init = window.rxApplyCsrf ? window.rxApplyCsrf(resource, init || {}) : (init || {});
        if (!init.credentials && rxIsSameOriginResource(resource)) {
            init.credentials = 'include';
        }
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
                currentUrl:  window.rxNativeLocationPathname ? window.rxNativeLocationPathname() : ''
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
        var pagePath = window.rxNativeLocationPathname ? window.rxNativeLocationPathname() : '';
        var pageHref = window.rxNativeLocationHref ? window.rxNativeLocationHref() : '';
        stack += '\n\nPage: ' + document.title + ' (' + pagePath + ')';
        fetch(url, {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message:  message  || 'Unknown client error',
                stack:    stack,
                url:      pageHref,
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
