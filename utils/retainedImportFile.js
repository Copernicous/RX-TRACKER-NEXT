'use strict';
const crypto = require('crypto');
function capture(file, now = new Date()) {
    const name = String(file.originalname || 'patients.csv').replace(/^.*[\\/]/, '').replace(/[\x00-\x1f\x7f]/g, '').slice(0,255);
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year:'numeric', month:'2-digit', day:'2-digit' }).format(now);
    return { name, downloadName: name.replace(/\.csv$/i, '').slice(0,220) + '-imported-' + date + '.csv',
        encoding: 'base64', content: file.buffer.toString('base64'), sha256: crypto.createHash('sha256').update(file.buffer).digest('hex') };
}
function send(res, file) {
    if (!file || file.encoding !== 'base64') return res.status(404).json({ error: 'The original uploaded file was not retained for this older record.' });
    const bytes = Buffer.from(file.content, 'base64');
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== file.sha256) return res.status(500).json({ error: 'Uploaded file integrity check failed.' });
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Type','text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', "attachment; filename=uploaded.csv; filename*=UTF-8''" + encodeURIComponent(file.downloadName).replace(/['()*]/g, ch => '%' + ch.charCodeAt(0).toString(16).toUpperCase()));
    return res.send(bytes);
}
module.exports = { capture, send };
