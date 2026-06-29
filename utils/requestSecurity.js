'use strict';

function forwardedProto(req) {
    return String(req.headers['x-forwarded-proto'] || req.headers['x-forwarded-protocol'] || '').toLowerCase();
}

function isSecureRequest(req) {
    if (req.secure) return true;
    if (forwardedProto(req).includes('https')) return true;
    if (String(req.headers['front-end-https'] || '').toLowerCase() === 'on') return true;
    if (req.headers['x-arr-ssl']) return true;
    return false;
}

function hostName(req) {
    const raw = String(req.headers.host || '').trim().toLowerCase();
    if (!raw) return '';
    if (raw[0] === '[') return raw.slice(1, raw.indexOf(']'));
    return raw.split(':')[0];
}

function isLoopbackHost(req) {
    const host = hostName(req);
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

function shouldAllowLocalHttp(req) {
    return process.env.HTTPS_ALLOW_LOCAL_HTTP === 'true' && isLoopbackHost(req);
}

function shouldAllowBackendHttp(req) {
    return process.env.HTTPS_ALLOW_BACKEND_HTTP === 'true' && !isLoopbackHost(req);
}

function shouldTreatAsSecure(req) {
    if (isSecureRequest(req)) return true;
    if (shouldAllowLocalHttp(req)) return false;
    return process.env.HTTPS_ASSUME_PROXY_HTTPS === 'true';
}

function shouldUseSecureCookie(req) {
    return shouldTreatAsSecure(req);
}

module.exports = {
    isSecureRequest,
    isLoopbackHost,
    shouldAllowLocalHttp,
    shouldAllowBackendHttp,
    shouldTreatAsSecure,
    shouldUseSecureCookie
};
