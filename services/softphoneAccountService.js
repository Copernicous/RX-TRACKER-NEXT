'use strict';

const crypto = require('crypto');

const PREFIX = 'rxsoft:v1:';

function encryptionKey() {
    const secret = process.env.SOFTPHONE_CREDENTIAL_KEY || process.env.SETTINGS_ENCRYPTION_KEY || process.env.JWT_SECRET || process.env.DB_PASS || '';
    if (!secret) {
        throw new Error('Softphone credential encryption is not configured.');
    }
    return crypto.createHash('sha256').update('patient-rx-softphone-account:' + secret).digest();
}

function associatedData(userId) {
    return Buffer.from('rx-softphone-user:' + String(userId), 'utf8');
}

function encryptPassword(userId, password) {
    const plain = String(password || '');
    if (!plain) throw new Error('SIP password is required.');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
    cipher.setAAD(associatedData(userId));
    const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return PREFIX + [
        iv.toString('base64url'),
        tag.toString('base64url'),
        ciphertext.toString('base64url')
    ].join(':');
}

function decryptPassword(userId, encryptedPassword) {
    const raw = String(encryptedPassword || '');
    if (!raw.startsWith(PREFIX)) throw new Error('Stored softphone credential is invalid.');
    const parts = raw.slice(PREFIX.length).split(':');
    if (parts.length !== 3) throw new Error('Stored softphone credential is invalid.');
    try {
        const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(parts[0], 'base64url'));
        decipher.setAAD(associatedData(userId));
        decipher.setAuthTag(Buffer.from(parts[1], 'base64url'));
        return Buffer.concat([
            decipher.update(Buffer.from(parts[2], 'base64url')),
            decipher.final()
        ]).toString('utf8');
    } catch (err) {
        throw new Error('Stored softphone credential could not be decrypted.');
    }
}

module.exports = {
    encryptPassword,
    decryptPassword
};
