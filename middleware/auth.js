const jwt = require('jsonwebtoken');
const securityAlertService = require('../services/securityAlertService');
const sessionIdleService = require('../services/sessionIdleService');

function clearAuthCookies(res) {
    res.clearCookie('rxToken', { path: '/', sameSite: 'lax' });
    res.clearCookie('rxToken', { path: '/', sameSite: 'none', secure: true });
    res.clearCookie('rxCsrf', { path: '/', sameSite: 'lax' });
    res.clearCookie('rxCsrf', { path: '/', sameSite: 'none', secure: true });
}

// Helper: parse a specific cookie from the Cookie header string
function getCookie(cookieHeader, name) {
    if (!cookieHeader) return null;
    const match = cookieHeader.match(new RegExp('(?:^|;)\\s*' + name + '=([^;]+)'));
    return match ? decodeURIComponent(match[1]) : null;
}

module.exports = (req, res, next) => {
    // Cookie-only authentication: the full JWT stays in the HttpOnly rxToken cookie.
    const token = getCookie(req.headers.cookie, 'rxToken');
    if (!token) {
        securityAlertService.recordMissingAuth({ req, reason: 'missing_auth_cookie' }).catch(() => {});
        return res.status(401).json({ message: 'Authentication cookie required' });
    }

    jwt.verify(token, process.env.JWT_SECRET, async (err, decoded) => {
        if (err) {
            securityAlertService.recordMissingAuth({ req, reason: 'invalid_or_expired_token' }).catch(() => {});
            return res.status(401).json({ message: 'Invalid or expired token' });
        }

        // tokenVersion check — invalidates JWTs issued before a password change.
        // SEC-02: Always run the DB check so that:
        //   (a) new tokens (with tv claim) must match the DB version exactly, AND
        //   (b) old tokens (no tv claim, issued before this feature) are rejected
        //       if the DB version is > 0 (user has changed password since feature landed).
        //
        // This closes the bypass where a stolen old token remained valid after
        // a password change because it lacked the tv claim.
        try {
            const db   = require('../models');
            const user = await db.User.findByPk(decoded.id, { attributes: ['tokenVersion'] });
            if (!user) {
                securityAlertService.recordMissingAuth({ req, reason: 'token_user_not_found' }).catch(() => {});
                return res.status(401).json({ message: 'Session expired. Please log in again.' });
            }
            const dbVersion    = user.tokenVersion || 0;
            const tokenVersion = typeof decoded.tv === 'number' ? decoded.tv : null;

            if (dbVersion > 0 && tokenVersion === null) {
                securityAlertService.recordMissingAuth({ req, reason: 'missing_token_version' }).catch(() => {});
                // Old token without tv claim, but account has had password changes — reject.
                return res.status(401).json({ message: 'Session expired. Please log in again.' });
            }
            if (tokenVersion !== null && dbVersion !== tokenVersion) {
                securityAlertService.recordMissingAuth({ req, reason: 'stale_token_version' }).catch(() => {});
                // Token version doesn't match DB — password was changed, old token invalid.
                return res.status(401).json({ message: 'Session expired. Please log in again.' });
            }
        } catch (_e) {
            // Only swallow genuine DB-unavailable errors (ECONNREFUSED, ETIMEDOUT, etc.)
            // Re-throw programmer errors (wrong path, missing module, etc.) so they surface.
            const isDbError = _e.code === 'ECONNREFUSED' || _e.code === 'ETIMEDOUT' ||
                (_e.name && _e.name.includes('Sequelize'));
            if (!isDbError) throw _e;
            // DB temporarily unavailable — allow through to avoid full lockout during maintenance
            console.warn('[Auth] tokenVersion DB check skipped (DB unavailable):', _e.message);
        }

        const idleCheck = sessionIdleService.validate(token, decoded);
        if (!idleCheck.ok) {
            securityAlertService.recordMissingAuth({ req, reason: 'idle_timeout' }).catch(() => {});
            clearAuthCookies(res);
            return res.status(401).json({
                message: 'Session expired due to inactivity. Please log in again.',
                reason: 'idle_timeout',
                timeoutMinutes: idleCheck.timeoutMinutes
            });
        }

        req.user = decoded;
        req.authToken = token;
        req.authSessionKey = idleCheck.key;
        next();
    });
};
