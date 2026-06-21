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
