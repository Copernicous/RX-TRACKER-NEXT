'use strict';
const db              = require('../models');
const { QueryTypes }  = require('sequelize');
const { captureSnapshot } = require('../services/snapshotService');
const { Op }          = require('sequelize');

// ── GET /api/admin/snapshots  ────────────────────────────────────────────────
exports.getSnapshots = async (req, res) => {
    try {
        const { from, to, limit = 90, offset = 0 } = req.query;
        const where = {};
        if (from || to) {
            where.snapshotDate = {};
            if (from) where.snapshotDate[Op.gte] = from;
            if (to)   where.snapshotDate[Op.lte] = to;
        }
        const rows = await db.DailySnapshot.findAll({
            where,
            order: [['snapshotDate', 'ASC']],
            limit:  Math.min(500, parseInt(limit, 10)),
            offset: parseInt(offset, 10),
        });
        const total = await db.DailySnapshot.count({ where });

        // Also send the very latest snapshot for KPI cards
        const latest = await db.DailySnapshot.findOne({ order: [['snapshotDate', 'DESC']] });
        const prev   = latest ? await db.DailySnapshot.findOne({
            where: { snapshotDate: { [Op.lt]: latest.snapshotDate } },
            order: [['snapshotDate', 'DESC']],
        }) : null;

        res.json({ rows, total, latest, prev });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

// ── POST /api/admin/snapshots/capture  ──────────────────────────────────────
exports.captureNow = async (req, res) => {
    try {
        const { date } = req.body;  // optional — defaults to today
        const snap = await captureSnapshot(date);
        res.json({ success: true, snapshot: snap });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

// ── GET /api/admin/snapshots/export  ────────────────────────────────────────
exports.exportCSV = async (req, res) => {
    try {
        const { from, to } = req.query;
        const where = {};
        if (from || to) {
            where.snapshotDate = {};
            if (from) where.snapshotDate[Op.gte] = from;
            if (to)   where.snapshotDate[Op.lte] = to;
        }
        const rows = await db.DailySnapshot.findAll({
            where,
            order: [['snapshotDate', 'ASC']],
            raw: true,
        });
        if (!rows.length) return res.status(404).json({ error: 'No snapshots in range.' });

        const cols = Object.keys(rows[0]).filter(k => k !== 'id');
        const header = cols.join(',');
        const lines  = rows.map(r =>
            cols.map(c => {
                const v = r[c];
                if (v == null) return '';
                const s = String(v);
                return s.includes(',') ? `"${s}"` : s;
            }).join(',')
        );
        const csv = [header, ...lines].join('\r\n');

        const filename = `daily-snapshots-${from || 'all'}-to-${to || 'today'}.csv`;
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(csv);
    } catch (e) { res.status(500).json({ error: e.message }); }
};

// ── DELETE /api/admin/snapshots/:date  ──────────────────────────────────────
exports.deleteSnapshot = async (req, res) => {
    try {
        const deleted = await db.DailySnapshot.destroy({ where: { snapshotDate: req.params.date } });
        if (!deleted) return res.status(404).json({ error: 'Snapshot not found.' });
        res.json({ success: true, deleted });
    } catch (e) { res.status(500).json({ error: e.message }); }
};
