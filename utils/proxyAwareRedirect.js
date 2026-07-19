'use strict';

function extractProxyPrefixFromHeaderValue(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';

    let path = raw;
    if (/^https?:\/\//i.test(raw)) {
        try {
            path = new URL(raw).pathname;
        } catch (err) {
            path = raw.split(/[?#]/)[0];
        }
    } else {
        path = raw.split(/[?#]/)[0];
    }

    const m = String(path).match(/^(\/proxy\/[^/]+\/(?:http|https)\/[^/?#]+)/i);
    return m ? m[1] : '';
}

function getProxyPrefix(req) {
    if (!req || !req.headers) return '';

    const candidates = [
        req.headers['x-forwarded-uri'],
        req.headers['x-original-uri'],
        req.headers['x-original-url'],
        req.headers['x-rewrite-url'],
        req.headers['x-forwarded-path'],
        req.headers['x-request-uri'],
        req.headers['referer']
    ];

    for (let i = 0; i < candidates.length; i += 1) {
        const prefix = extractProxyPrefixFromHeaderValue(candidates[i]);
        if (prefix) return prefix;
    }

    return '';
}

function normalizeAppPath(value) {
    const appPath = String(value || '/');
    return appPath.startsWith('/') ? appPath : '/' + appPath;
}

function buildProxyAwareUrl(req, appPath) {
    const normalizedPath = normalizeAppPath(appPath);
    const prefix = getProxyPrefix(req);
    if (!prefix) return normalizedPath;
    return prefix + normalizedPath;
}

function proxyRedirect(req, res, path) {
    const target = buildProxyAwareUrl(req, path);
    return res.redirect(target);
}

module.exports = {
    getProxyPrefix,
    buildProxyAwareUrl,
    proxyRedirect
};
