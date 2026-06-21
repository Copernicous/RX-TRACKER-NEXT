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

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ message: 'Invalid or expired token' });
        }
        req.user = user;
        next();
    });
};
