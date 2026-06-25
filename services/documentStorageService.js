'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');
const { google } = require('googleapis');

const IS_PKG = typeof process.pkg !== 'undefined';
const APP_ROOT = IS_PKG ? path.dirname(process.execPath) : path.join(__dirname, '..');
const DEFAULT_LOCAL_DIR = path.join(APP_ROOT, 'uploads', 'documents');

function boolEnv(value) {
    return String(value || '').toLowerCase() === 'true';
}

function safeSegment(value) {
    return String(value || 'file')
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120) || 'file';
}

function uniqueName(originalName) {
    const ext = path.extname(originalName || '').slice(0, 20);
    const base = safeSegment(path.basename(originalName || 'document', ext)).slice(0, 80);
    return Date.now() + '-' + crypto.randomBytes(5).toString('hex') + '-' + base + ext;
}

function escapeDriveQueryValue(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function isDriveConfigured() {
    return boolEnv(process.env.GOOGLE_DRIVE_ENABLED)
        && !!process.env.GOOGLE_DRIVE_CLIENT_ID
        && !!process.env.GOOGLE_DRIVE_CLIENT_SECRET
        && !!process.env.GOOGLE_DRIVE_REFRESH_TOKEN;
}

function getOAuthClient() {
    const client = new google.auth.OAuth2(
        process.env.GOOGLE_DRIVE_CLIENT_ID,
        process.env.GOOGLE_DRIVE_CLIENT_SECRET
    );
    client.setCredentials({ refresh_token: process.env.GOOGLE_DRIVE_REFRESH_TOKEN });
    return client;
}

async function findOrCreateFolder(drive, name, parentId) {
    const safeName = escapeDriveQueryValue(name);
    let query = "mimeType='application/vnd.google-apps.folder' and "
        + "name='" + safeName + "' and trashed=false";
    if (parentId) query += " and '" + escapeDriveQueryValue(parentId) + "' in parents";

    const existing = await drive.files.list({
        q: query,
        spaces: 'drive',
        pageSize: 1,
        fields: 'files(id,name)'
    });

    const folder = existing.data.files && existing.data.files[0];
    if (folder) return folder.id;

    const requestBody = {
        name,
        mimeType: 'application/vnd.google-apps.folder'
    };
    if (parentId) requestBody.parents = [parentId];

    const created = await drive.files.create({
        requestBody,
        fields: 'id,name'
    });
    return created.data.id;
}

function patientFolderName(patient) {
    if (!patient) return null;
    const code = patient.patientCode || ('Patient-' + patient.id);
    const fullName = [patient.lastName, patient.firstName].filter(Boolean).join(' ').trim() || 'Unknown Name';
    const dob = patient.dob ? ('DOB ' + patient.dob) : 'DOB unknown';
    return safeSegment(code + ' - ' + fullName + ' - ' + dob);
}

function rxFolderName(rx) {
    const parts = ['RX-' + (rx && rx.id ? rx.id : 'unknown')];
    if (rx && rx.serviceDate) parts.push('Service ' + rx.serviceDate);
    return safeSegment(parts.join(' - '));
}

async function ensureDriveOwnerFolder(drive, ownerType, ownerId, owner) {
    const rootName = process.env.GOOGLE_DRIVE_ROOT_FOLDER_NAME || 'Daniely RX Documents';
    const rootId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID
        || await findOrCreateFolder(drive, rootName, null);
    const patientsId = await findOrCreateFolder(drive, 'Patients', rootId);

    if (ownerType === 'patient') {
        const folderName = patientFolderName(owner) || ('Patient-' + ownerId);
        return await findOrCreateFolder(drive, folderName, patientsId);
    }

    const patient = owner && owner.Patient ? owner.Patient : null;
    if (patient) {
        const patientId = await findOrCreateFolder(drive, patientFolderName(patient), patientsId);
        const rxGroupId = await findOrCreateFolder(drive, 'RX Records', patientId);
        return await findOrCreateFolder(drive, rxFolderName(owner), rxGroupId);
    }

    const rxGroupId = await findOrCreateFolder(drive, 'RX Records', rootId);
    return await findOrCreateFolder(drive, 'RX-' + ownerId, rxGroupId);
}

async function uploadToDrive(file, ownerType, ownerId, owner) {
    const auth = getOAuthClient();
    const drive = google.drive({ version: 'v3', auth });
    const parentId = await ensureDriveOwnerFolder(drive, ownerType, ownerId, owner);
    const storedName = uniqueName(file.originalname);

    const created = await drive.files.create({
        requestBody: {
            name: storedName,
            parents: [parentId]
        },
        media: {
            mimeType: file.mimetype || 'application/octet-stream',
            body: Readable.from(file.buffer)
        },
        fields: 'id,name,webViewLink,webContentLink'
    });

    return {
        provider: 'drive',
        storedName,
        driveFileId: created.data.id,
        driveWebViewLink: created.data.webViewLink || null,
        localPath: null
    };
}

function getLocalBaseDir() {
    const configured = process.env.DOCUMENT_STORAGE_LOCAL_DIR;
    if (!configured) return DEFAULT_LOCAL_DIR;
    return path.isAbsolute(configured)
        ? configured
        : path.resolve(APP_ROOT, configured);
}

async function uploadToLocal(file, ownerType, ownerId) {
    const storedName = uniqueName(file.originalname);
    const dir = path.join(getLocalBaseDir(), ownerType === 'rx-record' ? 'rx-records' : 'patients', String(ownerId));
    fs.mkdirSync(dir, { recursive: true });
    const filepath = path.join(dir, storedName);
    fs.writeFileSync(filepath, file.buffer);
    return {
        provider: 'local',
        storedName,
        driveFileId: null,
        driveWebViewLink: null,
        localPath: filepath
    };
}

async function upload(file, ownerType, ownerId, owner) {
    if (isDriveConfigured()) {
        try {
            return await uploadToDrive(file, ownerType, ownerId, owner);
        } catch (err) {
            if (boolEnv(process.env.GOOGLE_DRIVE_ENABLED)) throw err;
            if (!boolEnv(process.env.DOCUMENT_STORAGE_ALLOW_LOCAL_FALLBACK)) throw err;
            console.warn('[documents] Google Drive upload failed; using local storage because Drive is disabled:', err.message);
        }
    }
    if (boolEnv(process.env.GOOGLE_DRIVE_ENABLED) || boolEnv(process.env.DOCUMENT_STORAGE_REQUIRE_DRIVE)) {
        throw new Error('Google Drive document storage is enabled but not configured.');
    }
    return uploadToLocal(file, ownerType, ownerId);
}

async function openReadStream(attachment) {
    if (attachment.provider === 'drive') {
        if (!attachment.driveFileId) throw new Error('Drive file ID is missing.');
        const drive = google.drive({ version: 'v3', auth: getOAuthClient() });
        const result = await drive.files.get(
            { fileId: attachment.driveFileId, alt: 'media' },
            { responseType: 'stream' }
        );
        return result.data;
    }

    if (!attachment.localPath || !fs.existsSync(attachment.localPath)) {
        throw new Error('Local document file was not found.');
    }
    return fs.createReadStream(attachment.localPath);
}

async function deleteStoredFile(attachment) {
    if (attachment.provider === 'drive' && attachment.driveFileId && isDriveConfigured()) {
        const drive = google.drive({ version: 'v3', auth: getOAuthClient() });
        await drive.files.update({
            fileId: attachment.driveFileId,
            requestBody: { trashed: true },
            fields: 'id,trashed'
        });
        return;
    }

    if (attachment.provider === 'local' && attachment.localPath && fs.existsSync(attachment.localPath)) {
        fs.unlinkSync(attachment.localPath);
    }
}

module.exports = {
    upload,
    openReadStream,
    deleteStoredFile,
    isDriveConfigured,
    getLocalBaseDir
};
