const db = require('../models');
const { Op, fn, col, literal } = require('sequelize');
const { getServiceWindowDays } = require('../utils/globalSettings');
const { evaluateServiceWindow } = require('../utils/serviceWindowEligibility');

// ── Helper: build a date-range WHERE clause from ?from= / ?to= params ─────────
function buildDateRange(req) {
    const from = req.query.from || null;   // 'YYYY-MM-DD' or empty
    const to   = req.query.to   || null;
    if (!from && !to) return null;
    const clause = {};
    if (from) clause[Op.gte] = new Date(from + 'T00:00:00');
    if (to)   clause[Op.lte] = new Date(to   + 'T23:59:59');
    return clause;
}

function localDateString(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function localDateOnlyStart(value) {
    if (!value) return null;
    const iso = String(value).slice(0, 10);
    const parts = iso.split('-').map(Number);
    if (parts.length === 3 && parts.every(Number.isFinite)) {
        const d = new Date(parts[0], parts[1] - 1, parts[2]);
        d.setHours(0, 0, 0, 0);
        return d;
    }
    const fallback = new Date(value);
    if (isNaN(fallback.getTime())) return null;
    fallback.setHours(0, 0, 0, 0);
    return fallback;
}

exports.getStats = async (req, res) => {
    try {
        const dateRange = buildDateRange(req);

        // M3 FIX: Use Op.or [false, null] to match getAll — include legacy rows where isDeleted IS NULL
        const notDeleted = { [Op.or]: [{ isDeleted: false }, { isDeleted: null }] };

        // Patient counts — filtered by createdAt if a date range is active
        const patientWhere = { ...notDeleted };
        if (dateRange) patientWhere.createdAt = dateRange;

        const activePatients   = await db.Patient.count({ where: { ...patientWhere, isActive: true  } });
        const inactivePatients = await db.Patient.count({ where: { ...patientWhere, isActive: false } });

        // RX counts — filtered by serviceDate if a date range is active (UX-01: exclude deleted)
        const rxWhere = { isDeleted: false };
        if (dateRange) rxWhere.serviceDate = dateRange;

        const activeRxCount = await db.RXRecord.count({ where: rxWhere });

        // Pending deliveries: RX records that have NOT completed ALL workflow steps
        // PERF-01: Use a single aggregate query instead of N+1 per-record loop
        const totalWorkflowSteps = await db.WorkflowAction.count({ where: { isActive: true } });

        let pendingDeliveriesCount = 0;
        if (totalWorkflowSteps === 0) {
            // No steps defined — all RX records are "pending"
            pendingDeliveriesCount = await db.RXRecord.count({ where: rxWhere });
        } else {
            // Fetch tracking counts grouped by rxRecordId in one query
            const trackingCounts = await db.RXWorkflowTracking.findAll({
                attributes: ['rxRecordId', [fn('COUNT', col('id')), 'stepsDone']],
                group: ['rxRecordId'],
                raw: true
            });

            const doneMap = {};
            for (const row of trackingCounts) {
                doneMap[row.rxRecordId] = parseInt(row.stepsDone, 10);
            }

            // Get all non-deleted RX IDs (with optional date filter)
            const allRxIds = await db.RXRecord.findAll({
                attributes: ['id'],
                where: rxWhere,
                raw: true
            });

            for (const { id } of allRxIds) {
                const done = doneMap[id] || 0;
                if (done < totalWorkflowSteps) pendingDeliveriesCount++;
            }
        }

        const recentActivity = await db.AuditLog.findAll({
            limit: 10,
            order: [['date', 'DESC'], ['time', 'DESC']],
            include: [{ model: db.User, attributes: ['firstName', 'lastName'] }]
        });

        // Active patients with NO RX records
        const patientIdsWithRx = await db.RXRecord.findAll({
            attributes: ['patientId'],
            where: { isDeleted: false },
            group: ['patientId'],
            raw: true
        });
        const idsWithRx = patientIdsWithRx.map(r => r.patientId);
        const patientsWithNoRx = await db.Patient.count({
            where: {
                isActive: true,
                ...notDeleted,
                id: { [Op.notIn]: idsWithRx.length ? idsWithRx : [0] }
            }
        });

        res.json({ activePatients, inactivePatients, pendingDeliveriesCount, activeRxCount, patientsWithNoRx, recentActivity });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
exports.getActivePatients = async (req, res) => {
    try {
        const patients = await db.Patient.findAll({
            // M3 FIX: include legacy rows where isDeleted IS NULL
            where: { isActive: true, [Op.or]: [{ isDeleted: false }, { isDeleted: null }] },
            include: [{ model: db.Clinic }, { model: db.PatientTransportCompany }, { model: db.PharmacyTransportCompany }],
            order: [['lastName', 'ASC']]
        });
        res.json(patients);
    } catch (error) { res.status(500).json({ error: error.message }); }
};

exports.getInactivePatients = async (req, res) => {
    try {
        const patients = await db.Patient.findAll({
            // M3 FIX: include legacy rows where isDeleted IS NULL
            where: { isActive: false, [Op.or]: [{ isDeleted: false }, { isDeleted: null }] },
            include: [{ model: db.Clinic }, { model: db.PatientTransportCompany }, { model: db.PharmacyTransportCompany }],
            order: [['lastName', 'ASC']]
        });
        res.json(patients);
    } catch (error) { res.status(500).json({ error: error.message }); }
};

exports.getPatientsWithNoRx = async (req, res) => {
    try {
        const patientIdsWithRx = await db.RXRecord.findAll({
            attributes: ['patientId'],
            where: { isDeleted: false },
            group: ['patientId'],
            raw: true
        });
        const idsWithRx = patientIdsWithRx.map(r => r.patientId);
        // M3 FIX: include legacy rows where isDeleted IS NULL
        const notDeleted = { [Op.or]: [{ isDeleted: false }, { isDeleted: null }] };
        const patients = await db.Patient.findAll({
            where: {
                isActive: true,
                ...notDeleted,
                id: { [Op.notIn]: idsWithRx.length ? idsWithRx : [0] }
            },
            include: [{ model: db.Clinic }, { model: db.PatientTransportCompany }, { model: db.PharmacyTransportCompany }],
            order: [['lastName', 'ASC']]
        });
        res.json(patients);
    } catch (error) { res.status(500).json({ error: error.message }); }
};

exports.getPendingRx = async (req, res) => {
    try {
        const totalWorkflowSteps = await db.WorkflowAction.count({ where: { isActive: true } });
        const allRx = await db.RXRecord.findAll({
            where: { isDeleted: false },   // BUG-12 fix: exclude soft-deleted
            include: [
                { model: db.Patient,  attributes: ['firstName', 'lastName', 'patientCode'] },
                { model: db.Pharmacy, attributes: ['name'] },
                { model: db.RXWorkflowTracking }
            ],
            order: [['serviceDate', 'DESC']]
        });
        const pending = allRx
            .filter(rx => (rx.RXWorkflowTrackings || []).length < totalWorkflowSteps)
            .map(rx => {
                const plain = rx.toJSON();
                plain.workflowStepTotal = totalWorkflowSteps;
                return plain;
            });
        res.json(pending);
    } catch (error) { res.status(500).json({ error: error.message }); }
};

exports.getTotalRx = async (req, res) => {
    try {
        const totalWorkflowSteps = await db.WorkflowAction.count({ where: { isActive: true } });
        const allRx = await db.RXRecord.findAll({
            where: { isDeleted: false },   // exclude soft-deleted
            include: [
                { model: db.Patient,  attributes: ['firstName', 'lastName', 'patientCode'] },
                { model: db.Pharmacy, attributes: ['name'] },
                { model: db.RXWorkflowTracking }
            ],
            order: [['serviceDate', 'DESC']]
        });
        res.json(allRx.map(rx => {
            const plain = rx.toJSON();
            plain.workflowStepTotal = totalWorkflowSteps;
            return plain;
        }));
    } catch (error) { res.status(500).json({ error: error.message }); }
};

exports.getChartData = async (req, res) => {
    try {
        const chartFrom = req.query.chartFrom || '';
        const chartTo   = req.query.chartTo || '';
        const chartRange = req.query.chartRange || '';

        const totalSteps2 = await db.WorkflowAction.count({ where: { isActive: true } });
        const allRxIds = await db.RXRecord.findAll({ attributes: ['id', 'patientId'], where: { isDeleted: false }, raw: true });
        let completed2 = 0, pending = 0;
        if (totalSteps2 === 0) {
            pending = allRxIds.length;
        } else {
            const trackingCounts = await db.RXWorkflowTracking.findAll({ attributes: ['rxRecordId', [fn('COUNT', col('id')), 'stepsDone']], group: ['rxRecordId'], raw: true });
            const doneMap = {};
            for (const row of trackingCounts) doneMap[row.rxRecordId] = parseInt(row.stepsDone, 10);
            for (const rec of allRxIds) {
                if ((doneMap[rec.id] || 0) >= totalSteps2) completed2++; else pending++;
            }
        }
        const notDeletedPatient = { [Op.or]: [{ isDeleted: false }, { isDeleted: null }] };
        const activePatientsTotal = await db.Patient.count({ where: { isActive: true, ...notDeletedPatient } });
        const inactivePatientsTotal = await db.Patient.count({ where: { isActive: false, ...notDeletedPatient } });
        const patientIdsWithRxMap = {};
        for (const rx of allRxIds) {
            if (rx.patientId) patientIdsWithRxMap[rx.patientId] = true;
        }
        const patientIdsWithRx = Object.keys(patientIdsWithRxMap);
        const patientsWithNoRxTotal = await db.Patient.count({
            where: {
                isActive: true,
                ...notDeletedPatient,
                id: { [Op.notIn]: patientIdsWithRx.length ? patientIdsWithRx : [0] }
            }
        });
        const cardTotals = {
            labels: ['Active', 'Inactive', 'Total RX', 'Pending', 'No RX'],
            data: [activePatientsTotal, inactivePatientsTotal, allRxIds.length, pending, patientsWithNoRxTotal]
        };

        let rangeStart = chartFrom ? new Date(chartFrom + 'T00:00:00') : (function(){ var d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate()-29); return d; })();
        let rangeEnd = chartTo ? new Date(chartTo + 'T23:59:59') : new Date();
        if (chartRange === 'all' && !chartFrom && !chartTo) {
            const earliestCandidates = [];

            const firstPatientService = await db.Patient.findOne({
                attributes: ['serviceDate'],
                where: {
                    serviceDate: { [Op.ne]: null },
                    [Op.or]: [{ isDeleted: false }, { isDeleted: null }]
                },
                order: [['serviceDate', 'ASC']],
                raw: true
            });
            if (firstPatientService && firstPatientService.serviceDate) earliestCandidates.push(firstPatientService.serviceDate);

            const firstServiceHistory = await db.PatientServiceDateHistory.findOne({
                attributes: ['newServiceDate'],
                where: { newServiceDate: { [Op.ne]: null } },
                order: [['newServiceDate', 'ASC']],
                raw: true
            });
            if (firstServiceHistory && firstServiceHistory.newServiceDate) earliestCandidates.push(firstServiceHistory.newServiceDate);

            const firstServiceCycle = await db.PatientServiceDateCycle.findOne({
                attributes: ['serviceDate'],
                where: { serviceDate: { [Op.ne]: null } },
                order: [['serviceDate', 'ASC']],
                raw: true
            });
            if (firstServiceCycle && firstServiceCycle.serviceDate) earliestCandidates.push(firstServiceCycle.serviceDate);

            const firstRxCreated = await db.RXRecord.findOne({
                attributes: ['createdAt'],
                where: { isDeleted: false },
                order: [['createdAt', 'ASC']],
                raw: true
            });
            if (firstRxCreated && firstRxCreated.createdAt) earliestCandidates.push(localDateString(new Date(firstRxCreated.createdAt)));

            const firstPatientCreated = await db.Patient.findOne({
                attributes: ['createdAt'],
                where: { [Op.or]: [{ isDeleted: false }, { isDeleted: null }] },
                order: [['createdAt', 'ASC']],
                raw: true
            });
            if (firstPatientCreated && firstPatientCreated.createdAt) earliestCandidates.push(localDateString(new Date(firstPatientCreated.createdAt)));

            const firstWorkflowCompletion = await db.RXWorkflowTracking.findOne({
                attributes: ['completionDate'],
                where: { completionDate: { [Op.ne]: null } },
                order: [['completionDate', 'ASC']],
                raw: true
            });
            if (firstWorkflowCompletion && firstWorkflowCompletion.completionDate) earliestCandidates.push(localDateString(new Date(firstWorkflowCompletion.completionDate)));

            if (earliestCandidates.length) {
                earliestCandidates.sort();
                rangeStart = new Date(earliestCandidates[0] + 'T00:00:00');
            }
        }
        const startDate = localDateString(rangeStart);
        const endDate = localDateString(rangeEnd);
        const trendReady = true;
        const trendWarning = '';
        const dateKeys = [];
        for (let d = new Date(startDate + 'T00:00:00'); localDateString(d) <= endDate; d.setDate(d.getDate() + 1)) {
            dateKeys.push(localDateString(d));
        }

        function dateOnly(value) {
            return localDateString(new Date(value));
        }
        function countByDate(rows, field, dateOnlyField) {
            const counts = {};
            for (const row of rows) {
                if (!row[field]) continue;
                const key = dateOnlyField ? String(row[field]).slice(0, 10) : dateOnly(row[field]);
                counts[key] = (counts[key] || 0) + 1;
            }
            return dateKeys.map(function(date) { return counts[date] || 0; });
        }
        function latestServiceDate(cycles, date) {
            if (!cycles || !cycles.length) return null;
            let latest = null;
            for (const cycle of cycles) {
                if (cycle.serviceDate <= date) latest = cycle.serviceDate;
                else break;
            }
            return latest;
        }
        function daysFromTo(fromDate, toDate) {
            return Math.ceil((new Date(toDate + 'T00:00:00') - new Date(fromDate + 'T00:00:00')) / 86400000);
        }

        const rangeEndTs = new Date(endDate + 'T23:59:59');
        const patientRows = await db.Patient.findAll({
            attributes: ['id', 'createdAt', 'isActive'],
            where: { [Op.or]: [{ isDeleted: false }, { isDeleted: null }] },
            raw: true
        });
        const rxRows = await db.RXRecord.findAll({
            attributes: ['id', 'patientId', 'createdAt'],
            where: { isDeleted: false },
            raw: true
        });
        const workflowStepRows = await db.RXWorkflowTracking.findAll({
            attributes: ['rxRecordId', 'completionDate'],
            where: { completionDate: { [Op.lte]: rangeEndTs } },
            raw: true
        });
        const serviceCycles = await db.PatientServiceDateCycle.findAll({
            attributes: ['patientId', 'serviceDate'],
            where: { serviceDate: { [Op.lte]: endDate } },
            order: [['patientId', 'ASC'], ['serviceDate', 'ASC']],
            raw: true
        });
        const auditRows = await db.AuditLog.findAll({
            attributes: ['createdAt', 'module', 'action', 'userId'],
            where: { createdAt: { [Op.between]: [new Date(startDate + 'T00:00:00'), rangeEndTs] } },
            raw: true
        }).catch(() => []);
        const activityRows = await db.UserActivityLog.findAll({
            attributes: ['visitedAt', 'userId'],
            where: { visitedAt: { [Op.between]: [new Date(startDate + 'T00:00:00'), rangeEndTs] } },
            raw: true
        }).catch(() => []);

        const patients = patientRows.map(function(p) {
            return { id: p.id, createdDate: dateOnly(p.createdAt), isActive: p.isActive === true };
        });
        const rxRecords = rxRows.map(function(rx) {
            return { id: rx.id, patientId: rx.patientId, createdDate: dateOnly(rx.createdAt) };
        });
        const cyclesByPatient = {};
        for (const cycle of serviceCycles) {
            if (!cyclesByPatient[cycle.patientId]) cyclesByPatient[cycle.patientId] = [];
            cyclesByPatient[cycle.patientId].push({ serviceDate: String(cycle.serviceDate).slice(0, 10) });
        }
        const trackingDatesByRx = {};
        const trackingRows = [];
        for (const row of workflowStepRows) {
            if (!row.completionDate) continue;
            const completionDate = dateOnly(row.completionDate);
            trackingRows.push({ rxRecordId: row.rxRecordId, completionDate });
            if (!trackingDatesByRx[row.rxRecordId]) trackingDatesByRx[row.rxRecordId] = [];
            trackingDatesByRx[row.rxRecordId].push(completionDate);
        }
        Object.keys(trackingDatesByRx).forEach(function(rxId) {
            trackingDatesByRx[rxId].sort();
        });

        const totalWorkflowSteps = await db.WorkflowAction.count({ where: { isActive: true } });
        const newPatientsToday = countByDate(patients.map(function(p) { return { createdAt: p.createdDate }; }), 'createdAt', true);
        const newRXToday = countByDate(rxRecords.map(function(rx) { return { createdAt: rx.createdDate }; }), 'createdAt', true);
        const workflowStepsToday = countByDate(trackingRows.map(function(t) { return { completionDate: t.completionDate }; }), 'completionDate', true);
        const serviceDateEntries = countByDate(serviceCycles, 'serviceDate', true);

        const loginEventsByDate = {};
        const auditEventsByDate = {};
        const uniqueLoginUsersByDate = {};
        for (const row of auditRows) {
            const key = dateOnly(row.createdAt);
            auditEventsByDate[key] = (auditEventsByDate[key] || 0) + 1;
            if (row.module === 'Authentication' && row.action === 'Login') {
                loginEventsByDate[key] = (loginEventsByDate[key] || 0) + 1;
                if (row.userId) {
                    if (!uniqueLoginUsersByDate[key]) uniqueLoginUsersByDate[key] = {};
                    uniqueLoginUsersByDate[key][row.userId] = true;
                }
            }
        }
        const activityEventsByDate = {};
        const uniqueActivityUsersByDate = {};
        for (const row of activityRows) {
            const key = dateOnly(row.visitedAt);
            activityEventsByDate[key] = (activityEventsByDate[key] || 0) + 1;
            if (row.userId) {
                if (!uniqueActivityUsersByDate[key]) uniqueActivityUsersByDate[key] = {};
                uniqueActivityUsersByDate[key][row.userId] = true;
            }
        }

        const dailyTrends = {
            labels: dateKeys,
            activePatients: [],
            inactivePatients: [],
            newPatientsToday,
            rxRecords: [],
            newRXToday,
            pendingDeliveries: [],
            completedRX: [],
            patientsWithNoRx: [],
            eligibleNow: [],
            expiringIn7: [],
            inWindow: [],
            noServiceDate: [],
            loginEventsToday: [],
            uniqueLoginUsersToday: [],
            userActivityEventsToday: [],
            uniqueActivityUsersToday: [],
            auditEventsToday: [],
            workflowStepsToday,
            workflowStepsCompletedDaily: workflowStepsToday,
            completedWorkflowSteps: [],
            totalWorkflowSteps: [],
            workflowCompletionRate: [],
            serviceDateEntries
        };

        for (const date of dateKeys) {
            const patientsAsOfDate = patients.filter(function(p) { return p.createdDate <= date; });
            const activePatientsAsOfDate = patientsAsOfDate.filter(function(p) { return p.isActive; });
            const rxAsOfDate = rxRecords.filter(function(rx) { return rx.createdDate <= date; });
            const rxCreatedByPatient = {};
            for (const rx of rxAsOfDate) {
                if (!rxCreatedByPatient[rx.patientId] || rx.createdDate < rxCreatedByPatient[rx.patientId]) {
                    rxCreatedByPatient[rx.patientId] = rx.createdDate;
                }
            }

            let eligibleNow = 0;
            let expiringIn7 = 0;
            let inWindow = 0;
            let noServiceDate = 0;
            let patientsWithNoRx = 0;
            for (const patient of activePatientsAsOfDate) {
                const serviceDate = latestServiceDate(cyclesByPatient[patient.id], date);
                if (!serviceDate) {
                    noServiceDate++;
                } else {
                    const expiryDate = localDateString(new Date(new Date(serviceDate + 'T00:00:00').getTime() + getServiceWindowDays() * 86400000));
                    const daysLeft = daysFromTo(date, expiryDate);
                    if (daysLeft <= 0) eligibleNow++;
                    else if (daysLeft <= 7) expiringIn7++;
                    else inWindow++;
                }
                if (!rxCreatedByPatient[patient.id]) patientsWithNoRx++;
            }

            let completedRX = 0;
            let completedWorkflowSteps = 0;
            for (const rx of rxAsOfDate) {
                const doneDates = trackingDatesByRx[rx.id] || [];
                let done = 0;
                for (const doneDate of doneDates) {
                    if (doneDate <= date) done++;
                    else break;
                }
                completedWorkflowSteps += done;
                if (totalWorkflowSteps > 0 && done >= totalWorkflowSteps) completedRX++;
            }
            const totalStepsForDate = rxAsOfDate.length * totalWorkflowSteps;

            dailyTrends.activePatients.push(activePatientsAsOfDate.length);
            dailyTrends.inactivePatients.push(patientsAsOfDate.length - activePatientsAsOfDate.length);
            dailyTrends.rxRecords.push(rxAsOfDate.length);
            dailyTrends.pendingDeliveries.push(totalWorkflowSteps === 0 ? rxAsOfDate.length : rxAsOfDate.length - completedRX);
            dailyTrends.completedRX.push(completedRX);
            dailyTrends.patientsWithNoRx.push(patientsWithNoRx);
            dailyTrends.eligibleNow.push(eligibleNow);
            dailyTrends.expiringIn7.push(expiringIn7);
            dailyTrends.inWindow.push(inWindow);
            dailyTrends.noServiceDate.push(noServiceDate);
            dailyTrends.completedWorkflowSteps.push(completedWorkflowSteps);
            dailyTrends.totalWorkflowSteps.push(totalStepsForDate);
            dailyTrends.workflowCompletionRate.push(totalStepsForDate > 0 ? Number(((completedWorkflowSteps / totalStepsForDate) * 100).toFixed(2)) : 0);
            dailyTrends.loginEventsToday.push(loginEventsByDate[date] || 0);
            dailyTrends.uniqueLoginUsersToday.push(uniqueLoginUsersByDate[date] ? Object.keys(uniqueLoginUsersByDate[date]).length : 0);
            dailyTrends.userActivityEventsToday.push(activityEventsByDate[date] || 0);
            dailyTrends.uniqueActivityUsersToday.push(uniqueActivityUsersByDate[date] ? Object.keys(uniqueActivityUsersByDate[date]).length : 0);
            dailyTrends.auditEventsToday.push(auditEventsByDate[date] || 0);
        }
        dailyTrends.serviceDateChanges = dailyTrends.serviceDateEntries;

        res.json({ cardTotals, rxStatus: { labels: ['Completed', 'Pending'], data: [completed2, pending] }, dailyTrends, trendReady, trendWarning });
    } catch (error) { res.status(500).json({ error: error.message }); }
};

exports.getRxPipeline = async (req, res) => {
    try {
        const steps = await db.WorkflowAction.findAll({
            where: { isActive: true },
            order: [['sequenceNumber', 'ASC'], ['id', 'ASC']]
        });
        const totalSteps = steps.length;

        const allRx = await db.RXRecord.findAll({
            include: [{ model: db.RXWorkflowTracking }],
            where: { isDeleted: false }
        });

        let notStarted = 0, inProgress = 0, completedCount = 0;
        const stepCounts = steps.map(s => ({ id: s.id, name: s.name, count: 0 }));

        for (const rx of allRx) {
            const done = (rx.RXWorkflowTrackings || []).length;
            if (totalSteps === 0 || done >= totalSteps) {
                completedCount++;
            } else if (done === 0) {
                notStarted++;
            } else {
                inProgress++;
                const currentStepIndex = done;
                if (stepCounts[currentStepIndex]) stepCounts[currentStepIndex].count++;
            }
        }

        res.json({
            total: allRx.length,
            notStarted,
            inProgress,
            completed: completedCount,
            totalSteps,
            stepBreakdown: stepCounts
        });
    } catch (error) { res.status(500).json({ error: error.message }); }
};

// GET /api/dashboard/eligibility
// Returns 90-day eligibility breakdown for active patients.
// SOURCE OF TRUTH: patient.serviceDate (canonical 90-day clock).
// This matches the frontend liveFilter() logic in patients.js.
exports.getEligibilityStats = async (req, res) => {
    try {
        const notDeleted = { [Op.or]: [{ isDeleted: false }, { isDeleted: null }] };

        // Get all active non-deleted patients
        const patients = await db.Patient.findAll({
            where: { isActive: true, ...notDeleted },
            attributes: ['id', 'firstName', 'lastName', 'patientCode', 'serviceDate'],
            raw: true
        });

        const today = new Date(); today.setHours(0, 0, 0, 0);

        let eligibleNow    = 0;   // patient.serviceDate window fully expired (daysLeft < 0)
        let expiringIn7    = 0;   // window expires in 0–7 days
        let inWindow       = 0;   // window active, > 7 days remaining
        let noServiceDate  = 0;   // patient has no serviceDate at all
        const eligibleList = [];

        for (const p of patients) {
            // ── Canonical source: patient.serviceDate ──────────────────────────
            // This is the same field the frontend patients.js liveFilter() uses.
            if (!p.serviceDate) {
                noServiceDate++;
                continue;
            }
            const eligibility = evaluateServiceWindow(p.serviceDate, today);
            if (!eligibility.serviceDate) {
                noServiceDate++;
                continue;
            }
            const daysLeft = eligibility.daysLeft;

            if (eligibility.eligible) {
                // Window fully expired — patient is eligible for a new service
                eligibleNow++;
                eligibleList.push({
                    id:            p.id,
                    patientCode:   p.patientCode,
                    name:          (p.firstName || '') + ' ' + (p.lastName || ''),
                    lastService:   p.serviceDate,
                    eligibleSince: eligibility.eligibleSince,
                    daysPastDue:   Math.abs(daysLeft)
                });
            } else if (daysLeft <= 7) {
                // Window closing soon (0–7 days left)
                expiringIn7++;
            } else {
                // Active window, > 7 days remaining
                inWindow++;
            }
        }

        // Sort eligible list: longest overdue first
        eligibleList.sort((a, b) => b.daysPastDue - a.daysPastDue);

        res.json({
            eligibleNow,
            expiringIn7,
            inWindow,
            noServiceDate,
            total: patients.length,
            eligibleList: eligibleList.slice(0, 20),
            serviceWindowDays: getServiceWindowDays()
        });
    } catch (error) { res.status(500).json({ error: error.message }); }
};

// GET /api/dashboard/eligibility-drilldown/:filter
// Returns the full patient list for a specific 90-day eligibility category.
// Filter values: eligible | expiring | window | none
// Uses the SAME logic as getEligibilityStats so popup counts match card numbers.
exports.getEligibilityDrilldown = async (req, res) => {
    try {
        const filter     = req.params.filter;  // eligible | expiring | window | none
        const notDeleted = { [Op.or]: [{ isDeleted: false }, { isDeleted: null }] };

        const patients = await db.Patient.findAll({
            where: { isActive: true, ...notDeleted },
            attributes: ['id', 'firstName', 'lastName', 'patientCode', 'serviceDate', 'phone', 'dob'],
            include: [
                { model: db.Clinic, attributes: ['name'], required: false },
                { model: db.Pharmacy, attributes: ['name'], required: false }
            ],
            raw: false
        });

        const today = new Date(); today.setHours(0, 0, 0, 0);
        const results = [];

        for (const p of patients) {
            const svcDate = p.serviceDate;

            if (!svcDate) {
                // 'none' category: no service date on the patient record
                if (filter === 'none') {
                    results.push({
                        id:          p.id,
                        patientCode: p.patientCode,
                        firstName:   p.firstName,
                        lastName:    p.lastName,
                        phone:       p.phone,
                        serviceDate: null,
                        expiryDate:  null,
                        daysLeft:    null,
                        status:      'none',
                        clinicName:  p.Clinic ? p.Clinic.name : null,
                        pharmacyName: p.Pharmacy ? p.Pharmacy.name : null
                    });
                }
                continue;
            }

            // Canonical 90-day window calculation
            const eligibility = evaluateServiceWindow(svcDate, today);
            if (!eligibility.serviceDate) continue;
            const daysLeft = eligibility.daysLeft;

            const matches = (
                (filter === 'eligible' && daysLeft < 0)       ||  // window expired
                (filter === 'expiring' && daysLeft >= 0 && daysLeft <= 7) ||  // closing soon
                (filter === 'window'   && daysLeft > 7)        // active, plenty of time
            );

            if (matches) {
                results.push({
                    id:           p.id,
                    patientCode:  p.patientCode,
                    firstName:    p.firstName,
                    lastName:     p.lastName,
                    phone:        p.phone,
                    serviceDate:  svcDate,
                    expiryDate:   eligibility.expiryDate,
                    daysLeft:     daysLeft,
                    daysPastDue:  daysLeft < 0 ? Math.abs(daysLeft) : 0,
                    status:       filter,
                    clinicName:   p.Clinic   ? p.Clinic.name   : null,
                    pharmacyName: p.Pharmacy ? p.Pharmacy.name : null
                });
            }
        }

        // Sort: eligible → oldest first; expiring → fewest days first; window → most days first; none → alpha
        results.sort((a, b) => {
            if (filter === 'eligible') return b.daysPastDue - a.daysPastDue;
            if (filter === 'expiring') return a.daysLeft   - b.daysLeft;
            if (filter === 'window')   return b.daysLeft   - a.daysLeft;
            return (a.lastName || '').localeCompare(b.lastName || '');
        });

        res.json(results);
    } catch (error) { res.status(500).json({ error: error.message }); }
};
