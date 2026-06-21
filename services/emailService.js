/**
 * emailService.js
 *
 * Wraps nodemailer to send emails via Gmail SMTP (or any SMTP server).
 *
 * Configuration is read from system settings (DB) or .env fallback:
 *   SMTP_HOST      — default: smtp.gmail.com
 *   SMTP_PORT      — default: 587
 *   SMTP_USER      — Gmail address
 *   SMTP_PASS      — Gmail App Password (NOT your real password)
 *   SMTP_FROM      — "From" display name, default: "Patient RX System"
 *
 * Gmail App Password setup:
 *   1. Go to https://myaccount.google.com/security
 *   2. Enable 2-Step Verification
 *   3. Search "App Passwords" → Create one for "Mail"
 *   4. Paste the 16-char password into SMTP_PASS in your .env
 */

const nodemailer = require('nodemailer');

let _transporter = null;

// ── Build or return the cached transporter ────────────────────────────────────
function getTransporter() {
    const host  = process.env.SMTP_HOST || 'smtp.gmail.com';
    const port  = parseInt(process.env.SMTP_PORT || '587', 10);
    const user  = process.env.SMTP_USER || '';
    const pass  = process.env.SMTP_PASS || '';

    if (!user || !pass) {
        throw new Error('Email not configured. Please set SMTP_USER and SMTP_PASS in your .env file.');
    }

    // Re-create the transporter if credentials changed
    const key = `${host}:${port}:${user}`;
    if (!_transporter || _transporter._key !== key) {
        _transporter = nodemailer.createTransport({
            host,
            port,
            secure: port === 465,
            auth: { user, pass }
        });
        _transporter._key = key;
    }
    return _transporter;
}

/**
 * Send an email.
 * @param {Object} opts
 * @param {string|string[]} opts.to      - recipient(s)
 * @param {string}          opts.subject - email subject
 * @param {string}          opts.html    - HTML body
 * @param {string}          [opts.text]  - plain-text fallback
 * @param {Object[]}        [opts.attachments] - nodemailer attachments array
 * @returns {Promise<Object>}            - nodemailer send result
 */
exports.sendEmail = async ({ to, subject, html, text, attachments }) => {
    const transporter = getTransporter();
    const fromName  = process.env.SMTP_FROM_NAME || 'Patient RX System';
    const fromEmail = process.env.SMTP_USER;

    const result = await transporter.sendMail({
        from:        `"${fromName}" <${fromEmail}>`,
        to:          Array.isArray(to) ? to.join(', ') : to,
        subject,
        html,
        text:        text || html.replace(/<[^>]+>/g, ''),
        attachments: attachments || []
    });
    return result;
};

/**
 * Test connectivity — verify SMTP credentials are valid.
 * Returns { ok: true } or throws an error with a human-readable message.
 */
exports.testConnection = async () => {
    const transporter = getTransporter();
    await transporter.verify();
    return { ok: true, user: process.env.SMTP_USER };
};

/** Returns true if SMTP is configured (user + pass set) */
exports.isConfigured = () => !!(process.env.SMTP_USER && process.env.SMTP_PASS);
