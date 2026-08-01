const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { resolveWritablePath } = require('../utils/runtimePaths');

const ARCHIVE_DIR = resolveWritablePath('administration', 'delivery-log-archives');
const ARCHIVE_EXT = '.json';

function ensureArchiveDirectory() {
    fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
}

function sanitizeArchiveId(id) {
    if (typeof id !== 'string') return '';
    return id.replace(/[^a-zA-Z0-9-_]/g, '');
}

function archivePath(id) {
    const safeId = sanitizeArchiveId(String(id || ''));
    if (!safeId) throw new Error('Invalid archive id');
    return path.join(ARCHIVE_DIR, safeId + ARCHIVE_EXT);
}

function cleanText(value, fallback) {
    if (value === undefined || value === null) return fallback || '';
    return String(value).trim();
}

function normalizeArchiveRecord(record, user) {
    const cleaned = record && typeof record === 'object' ? record : {};
    const metadata = cleaned.metadata && typeof cleaned.metadata === 'object' ? cleaned.metadata : {};
    return {
        id: cleaned.id,
        reference: cleanText(cleaned.reference),
        verification: cleanText(cleaned.verification),
        generated: cleanText(cleaned.generated),
        period: cleanText(cleaned.period),
        filters: cleanText(cleaned.filters),
        counts: cleaned.counts && typeof cleaned.counts === 'object' ? cleaned.counts : {},
        total: Number(cleaned.total || cleaned.rows?.length || 0) || 0,
        createdBy: {
            id: user && user.id,
            username: cleanText(user && user.username),
            firstName: cleanText(user && user.firstName),
            lastName: cleanText(user && user.lastName)
        },
        createdAt: new Date().toLocaleString(),
        createdAtEpoch: Date.now(),
        metadata: metadata
    };
}

exports.create = async (req, res) => {
    try {
        const record = req && req.body ? req.body : {};
        if (!record.reference || !record.verification) {
            return res.status(400).json({ error: 'reference and verification are required.' });
        }
        if (typeof record.documentHtml !== 'string' || !record.documentHtml.trim()) {
            return res.status(400).json({ error: 'documentHtml is required.' });
        }

        ensureArchiveDirectory();

        const id = crypto.randomUUID ? crypto.randomUUID() : (Date.now() + '-' + Math.floor(Math.random() * 9999));
        const archiveId = sanitizeArchiveId(id);
        const payload = {
            ...normalizeArchiveRecord(record, req.user),
            id: archiveId,
            rows: Array.isArray(record.rows) ? record.rows : [],
            pharmacyGroups: Array.isArray(record.pharmacyGroups) ? record.pharmacyGroups : [],
            documentHtml: record.documentHtml
        };

        const filePath = archivePath(archiveId);
        await fs.promises.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');

        return res.status(201).json({
            id: archiveId,
            reference: payload.reference,
            verification: payload.verification,
            createdAt: payload.createdAt
        });
    } catch (err) {
        return res.status(500).json({ error: err.message || 'Failed to save delivery-log archive.' });
    }
};

exports.list = async (_req, res) => {
    try {
        ensureArchiveDirectory();
        const files = await fs.promises.readdir(ARCHIVE_DIR);
        const records = [];

        for (const file of files) {
            if (!file.endsWith(ARCHIVE_EXT)) continue;
            try {
                const content = await fs.promises.readFile(path.join(ARCHIVE_DIR, file), 'utf8');
                const data = JSON.parse(content);
                records.push({
                    id: data.id,
                    reference: data.reference,
                    verification: data.verification,
                    total: data.total || 0,
                    createdAt: data.createdAt,
                    generated: data.generated,
                    filters: data.filters,
                    period: data.period
                });
            } catch (_error) {
                records.push({
                    id: sanitizeArchiveId(file.replace(ARCHIVE_EXT, '')),
                    reference: '(corrupt record)',
                    verification: 'unknown',
                    total: 0,
                    createdAt: null
                });
            }
        }

        records.sort(function (a, b) {
            const aTs = Number(a.createdAtEpoch || Date.parse(a.createdAt || 0) || 0);
            const bTs = Number(b.createdAtEpoch || Date.parse(b.createdAt || 0) || 0);
            return bTs - aTs;
        });

        res.json(records);
    } catch (err) {
        return res.status(500).json({ error: err.message || 'Failed to list delivery-log archives.' });
    }
};

exports.get = async (req, res) => {
    try {
        const filePath = archivePath(req.params.id);
        const content = await fs.promises.readFile(filePath, 'utf8');
        const data = JSON.parse(content);
        res.json(data);
    } catch (err) {
        if (err.code === 'ENOENT') {
            return res.status(404).json({ error: 'Archive not found.' });
        }
        return res.status(500).json({ error: err.message || 'Failed to load delivery-log archive.' });
    }
};

exports.print = async (req, res) => {
    try {
        const filePath = archivePath(req.params.id);
        const content = await fs.promises.readFile(filePath, 'utf8');
        const data = JSON.parse(content);

        const html = String(data.documentHtml || '');
        if (!html) {
            return res.status(409).json({ error: 'This archive does not include printable HTML.' });
        }
        res.set({
            'Content-Type': 'text/html; charset=utf-8',
            'Content-Disposition': 'inline; filename="delivery-log-' + sanitizeArchiveId(req.params.id) + '.html"'
        });
        res.send(html);
    } catch (err) {
        if (err.code === 'ENOENT') {
            return res.status(404).json({ error: 'Archive not found.' });
        }
        return res.status(500).json({ error: err.message || 'Failed to open delivery-log archive.' });
    }
};
