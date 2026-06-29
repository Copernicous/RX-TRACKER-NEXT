'use strict';

const fs = require('fs');
const path = require('path');
const { getWritableRoot, resolveMaybeWritable } = require('../utils/runtimePaths');

const WRITABLE_ROOT = getWritableRoot();
const DEFAULT_LOCAL_DIR = path.join(WRITABLE_ROOT, 'uploads', 'documents');

function getLocalBaseDir() {
    const configured = process.env.DOCUMENT_STORAGE_LOCAL_DIR;
    if (!configured) return DEFAULT_LOCAL_DIR;
    return resolveMaybeWritable(configured);
}

function isDriveConfigured() {
    return false;
}

async function openReadStream(attachment) {
    if (attachment.provider === 'drive') {
        throw new Error('Google Drive document access is disabled.');
    }

    if (!attachment.localPath || !fs.existsSync(attachment.localPath)) {
        throw new Error('Local document file was not found.');
    }
    return fs.createReadStream(attachment.localPath);
}

async function deleteStoredFile(attachment) {
    if (attachment.provider === 'drive') {
        return;
    }

    if (attachment.provider === 'local' && attachment.localPath && fs.existsSync(attachment.localPath)) {
        fs.unlinkSync(attachment.localPath);
    }
}

module.exports = {
    openReadStream,
    deleteStoredFile,
    isDriveConfigured,
    getLocalBaseDir
};
