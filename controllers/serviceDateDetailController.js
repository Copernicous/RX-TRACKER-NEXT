'use strict';

const db = require('../models');
const { getRequestPermission } = require('../middleware/rbac');
const { parseLocalDateOnly } = require('../utils/dateUtils');

// This drilldown never calls cycle synchronization or any patient/RX writer.
exports.getDetails = async (req, res) => {
    try {
        const permission = await getRequestPermission(req, 'patients');
        if (!permission.visible) return res.status(403).json({ error: 'Permission denied.' });
        res.setHeader('Cache-Control', 'no-store');
        const id = req.params.id;
        if (typeof id !== 'string' || !/^[1-9]\d*$/.test(id) || Number(id) > 2147483647) return res.status(400).json({ error: 'Invalid patient.' });
        const serviceDate = req.query.serviceDate || null;
        if (serviceDate !== null && (typeof serviceDate !== 'string' || !parseLocalDateOnly(serviceDate))) return res.status(400).json({ error: 'Invalid service date.' });
        const requestedPage = req.query.page === undefined ? 1 : Number(req.query.page);
        if (req.query.page !== undefined && (typeof req.query.page !== 'string' || !/^[1-9]\d*$/.test(req.query.page)) || !Number.isSafeInteger(requestedPage) || requestedPage < 1 || requestedPage > 1000000) return res.status(400).json({ error: 'Invalid page.' });
        const rxPermission = await getRequestPermission(req, 'rx_records');
        await db.sequelize.transaction({ isolationLevel: 'REPEATABLE READ', readOnly: true }, async transaction => {
            const query = (sql, extra = {}) => db.sequelize.query(sql, { transaction, type: db.Sequelize.QueryTypes.SELECT,
                replacements: { id: Number(id), serviceDate, ...extra } });
            const [patient] = await query(`SELECT p.id, COALESCE(NULLIF(p."patientCode", ''), p.id::text) AS "patientCode",
                CONCAT_WS(' ', p."firstName", p."lastName") AS name, p.dob, p.phone, p.address,
                p."serviceDate" AS "currentServiceDate", p."isActive" IS TRUE AS active,
                COALESCE(NULLIF(BTRIM(c.name), ''), 'Not assigned') AS clinic,
                COALESCE(NULLIF(BTRIM(ph.name), ''), 'Not assigned') AS pharmacy
                FROM "Patients" p LEFT JOIN "Clinics" c ON c.id = p."clinicId"
                LEFT JOIN "Pharmacies" ph ON ph.id = p."pharmacyId"
                WHERE p.id = :id AND p."isDeleted" IS NOT TRUE`);
            if (!patient) return res.status(404).json({ error: 'Patient not found.' });
            if (!rxPermission.visible) return res.json({ patient, serviceDate, rxAccess: false, rows: [], total: null, page: 1, totalPages: 1 });
            const [count] = await query(`SELECT COUNT(*)::integer AS total FROM "RXRecords" r
                WHERE r."patientId" = :id AND r."isDeleted" IS NOT TRUE
                AND (:serviceDate IS NULL OR r."serviceDate" = CAST(:serviceDate AS date))`);
            const pageSize = 25, totalPages = Math.max(1, Math.ceil(count.total / pageSize)), page = Math.min(requestedPage, totalPages);
            const rows = await query(`SELECT r.id, r."serviceDate", r."arrivalDate", r."returnedToWarehouse",
                COALESCE(NULLIF(BTRIM(ph.name), ''), 'Not assigned') AS pharmacy,
                (SELECT COUNT(*)::integer FROM "WorkflowActions" WHERE "isActive" IS TRUE) AS "totalSteps",
                (SELECT COUNT(DISTINCT wt."workflowActionId")::integer FROM "RXWorkflowTrackings" wt
                    JOIN "WorkflowActions" wa ON wa.id = wt."workflowActionId" AND wa."isActive" IS TRUE
                    WHERE wt."rxRecordId" = r.id) AS "completedSteps",
                COALESCE((SELECT json_agg(json_build_object('name', m.name, 'quantity', m.quantity) ORDER BY m.id)
                    FROM "Medications" m WHERE m."rxRecordId" = r.id), '[]'::json) AS medications
                FROM "RXRecords" r LEFT JOIN "Pharmacies" ph ON ph.id = r."pharmacyId"
                WHERE r."patientId" = :id AND r."isDeleted" IS NOT TRUE
                AND (:serviceDate IS NULL OR r."serviceDate" = CAST(:serviceDate AS date))
                ORDER BY r."serviceDate" DESC NULLS LAST, r.id DESC LIMIT 25 OFFSET :offset`, { offset: (page - 1) * pageSize });
            res.json({ patient, serviceDate, rxAccess: true, rows, total: count.total, page, pageSize, totalPages });
        });
    } catch (error) {
        res.status(500).json({ error: 'Unable to load patient details.' });
    }
};
