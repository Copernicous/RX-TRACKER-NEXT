const jwt = require('jsonwebtoken');

// Helper: parse a specific cookie from the Cookie header string
function getCookie(cookieHeader, name) {
    if (!cookieHeader) return null;
    const match = cookieHeader.match(new RegExp('(?:^|;)\\s*' + name + '=([^;]+)'));
    return match ? decodeURIComponent(match[1]) : null;
}

module.exports = (req, res, next) => {
    // 1. Try Authorization: Bearer header (standard JWT)
    let token = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.split(' ')[1];
    }

    // 2. Fallback: rxToken cookie — passes through FortiGate SSL VPN when Bearer header is stripped
    if (!token) {
        token = getCookie(req.headers.cookie, 'rxToken');
    }

    if (!token) {
        return res.status(401).json({ message: 'Authorization token required' });
    }

    jwt.verify(token, process.env.JWT_SECRET, async (err, decoded) => {
        if (err) {
            return res.status(403).json({ message: 'Invalid or expired token' });
        }

        // tokenVersion check — invalidates JWTs issued before a password change.
        // Only runs when the JWT contains a 'tv' claim (issued after this feature).
        if (typeof decoded.tv === 'number') {
            try {
                const db = require('../models');   // SEC-02: was './models' (broken path — always failed silently)
                const user = await db.User.findByPk(decoded.id, { attributes: ['tokenVersion'] });
                if (!user || (user.tokenVersion || 0) !== decoded.tv) {
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
        }

        req.user = decoded;
        next();
    });
};
