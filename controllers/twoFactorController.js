'use strict';
const speakeasy = require('speakeasy');
const QRCode    = require('qrcode');
const jwt       = require('jsonwebtoken');
const db        = require('../models');
const { issueFullToken } = require('./authController');

const APP_NAME = process.env.APP_NAME || 'Daniely RX';

// ── GET /api/auth/2fa/setup ───────────────────────────────────────────────────
// Generates a TOTP secret + QR code. Does NOT save to DB yet (user must verify first).
exports.setup = async (req, res) => {
    try {
        const user = await db.User.findByPk(req.user.id);
        if (!user) return res.status(404).json({ message: 'User not found.' });

        // Generate a new TOTP secret
        const secret = speakeasy.generateSecret({
            name:   `${APP_NAME} (${user.username})`,
            length: 20
        });

        // Generate QR code as base64 data URL
        const qrCodeDataUrl = await QRCode.toDataURL(secret.otpauth_url);

        // Temporarily store the secret so enable() can verify against it.
        // We store it even before enabling — enable() will check the code before making it active.
        await user.update({ twoFactorSecret: secret.base32 });

        res.json({
            secret:   secret.base32,       // for manual entry in authenticator apps
            qrCode:   qrCodeDataUrl,       // base64 PNG for display as <img src="...">
            message:  'Scan the QR code with Google Authenticator or Authy, then call /2fa/enable with the 6-digit code to activate.'
        });
    } catch (e) {
        console.error('[2FA] setup error:', e.message);
        res.status(500).json({ message: 'Internal server error.' });
    }
};

// ── POST /api/auth/2fa/enable ─────────────────────────────────────────────────
// Verifies the TOTP code and activates 2FA for the user.
exports.enable = async (req, res) => {
    try {
        const { code } = req.body;
        if (!code) return res.status(400).json({ message: 'Verification code is required.' });

        const user = await db.User.findByPk(req.user.id);
        if (!user) return res.status(404).json({ message: 'User not found.' });
        if (!user.twoFactorSecret) {
            return res.status(400).json({ message: 'No 2FA setup in progress. Call /2fa/setup first.' });
        }
        if (user.twoFactorEnabled) {
            return res.status(400).json({ message: '2FA is already enabled for this account.' });
        }

        const verified = speakeasy.totp.verify({
            secret:   user.twoFactorSecret,
            encoding: 'base32',
            token:    String(code).replace(/\s/g, ''),
            window:   1    // allow 30s clock drift
        });

        if (!verified) {
            return res.status(401).json({ message: 'Invalid verification code. Please try again.' });
        }

        await user.update({ twoFactorEnabled: true });

        // Audit log
        await db.AuditLog.create({
            userId:    user.id,
            date:      new Date(),
            time:      new Date().toTimeString().split(' ')[0],
            module:    'Authentication',
            action:    '2FA Enabled',
            ipAddress: req.ip
        }).catch(() => {});

        res.json({ message: '2FA has been enabled successfully. You will now be asked for a code on every login.' });
    } catch (e) {
        console.error('[2FA] enable error:', e.message);
        res.status(500).json({ message: 'Internal server error.' });
    }
};

// ── POST /api/auth/2fa/disable ────────────────────────────────────────────────
// Disables 2FA — requires verifying current TOTP code first for security.
exports.disable = async (req, res) => {
    try {
        const { code } = req.body;
        if (!code) return res.status(400).json({ message: 'Current authenticator code is required to disable 2FA.' });

        const user = await db.User.findByPk(req.user.id);
        if (!user) return res.status(404).json({ message: 'User not found.' });
        if (!user.twoFactorEnabled) {
            return res.status(400).json({ message: '2FA is not enabled for this account.' });
        }

        const verified = speakeasy.totp.verify({
            secret:   user.twoFactorSecret,
            encoding: 'base32',
            token:    String(code).replace(/\s/g, ''),
            window:   1
        });

        if (!verified) {
            return res.status(401).json({ message: 'Invalid authenticator code. 2FA was NOT disabled.' });
        }

        await user.update({ twoFactorEnabled: false, twoFactorSecret: null });

        // Audit log
        await db.AuditLog.create({
            userId:    user.id,
            date:      new Date(),
            time:      new Date().toTimeString().split(' ')[0],
            module:    'Authentication',
            action:    '2FA Disabled',
            ipAddress: req.ip
        }).catch(() => {});

        res.json({ message: '2FA has been disabled.' });
    } catch (e) {
        console.error('[2FA] disable error:', e.message);
        res.status(500).json({ message: 'Internal server error.' });
    }
};

// ── GET /api/auth/2fa/status ──────────────────────────────────────────────────
// Returns current 2FA status for the logged-in user.
exports.status = async (req, res) => {
    try {
        const user = await db.User.findByPk(req.user.id, {
            attributes: ['id', 'twoFactorEnabled']
        });
        if (!user) return res.status(404).json({ message: 'User not found.' });
        res.json({ twoFactorEnabled: !!user.twoFactorEnabled });
    } catch (e) {
        res.status(500).json({ message: 'Internal server error.' });
    }
};

// ── POST /api/auth/login/2fa ──────────────────────────────────────────────────
// Second step of login: verify TOTP code using the tempToken from step 1.
exports.verifyLogin = async (req, res) => {
    try {
        const { tempToken, code } = req.body;
        if (!tempToken || !code) {
            return res.status(400).json({ message: 'Temp token and code are required.' });
        }

        // Verify temp token
        let payload;
        try {
            payload = jwt.verify(tempToken, process.env.JWT_SECRET);
        } catch (e) {
            return res.status(401).json({ message: 'Session expired. Please log in again.' });
        }

        if (payload.purpose !== '2fa_pending') {
            return res.status(401).json({ message: 'Invalid token.' });
        }

        const user = await db.User.findByPk(payload.id, {
            include: [{ model: db.Role }]
        });

        if (!user || !user.isActive) {
            return res.status(401).json({ message: 'User not found or inactive.' });
        }

        if (!user.twoFactorEnabled || !user.twoFactorSecret) {
            return res.status(400).json({ message: '2FA is not set up for this account.' });
        }

        const verified = speakeasy.totp.verify({
            secret:   user.twoFactorSecret,
            encoding: 'base32',
            token:    String(code).replace(/\s/g, ''),
            window:   1
        });

        if (!verified) {
            // Count this as a failed attempt too
            const newCount = (user.failedLoginCount || 0) + 1;
            const updates  = { failedLoginCount: newCount };
            if (newCount >= 10) {
                updates.lockedUntil = new Date(Date.now() + 15 * 60 * 1000);
            }
            await user.update(updates);
            return res.status(401).json({ message: 'Invalid authenticator code.' });
        }

        // Reset lockout on successful 2FA
        if (user.failedLoginCount > 0 || user.lockedUntil) {
            await user.update({ failedLoginCount: 0, lockedUntil: null });
        }

        // Issue the full JWT token
        return issueFullToken(user, req, res);

    } catch (e) {
        console.error('[2FA] verifyLogin error:', e.message);
        res.status(500).json({ message: 'Internal server error.' });
    }
};
