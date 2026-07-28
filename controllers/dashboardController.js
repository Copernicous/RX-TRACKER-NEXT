const db = require('../models');
const { Op, fn, col, literal, QueryTypes } = require('sequelize');
const { getServiceWindowDays, getCallCenterLeadDays } = require('../utils/globalSettings');
const { evaluateServiceWindow, getCallCenterCutoffIso } = require('../utils/serviceWindowEligibility');
const {
    getFreshCurrentSnapshot,
    localSnapshotDate,
    materializeSnapshotHistory
} = require('../services/snapshotService');
const { activeRxWorkflowAggregateSql } = require('../utils/rxWorkflowAggregateSql');

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

async function loadCanonicalWorkflowCountMap() {
    const rows = await db.sequelize.query(activeRxWorkflowAggregateSql(), {
        type: QueryTypes.SELECT
    });
    return new Map(rows.map(row => [
        Number(row.rxRecordId),
        Number(row.completed_steps || 0)
    ]));
}

exports.getStats = async (req, res) => {
    try {
        const dateRange = buildDateRange(req);
        const currentSnapshot = dateRange
            ? null
            : await getFreshCurrentSnapshot({ maxAgeMs: 1000 });

        // M3 FIX: Use Op.or [false, null] to match getAll — include legacy rows where isDeleted IS NULL
        const notDeleted = { [Op.or]: [{ isDeleted: false }, { isDeleted: null }] };

        // Patient counts — filtered by createdAt if a date range is active
        const patientWhere = { ...notDeleted };
        if (dateRange) patientWhere.createdAt = dateRange;

        // Patient cards are operational counts and must match the Patients page
        // at request time. DailySnapshots remain the source for historical trends.
        const [activePatients, inactivePatients] = await Promise.all([
            db.Patient.count({ where: { ...patientWhere, isActive: true } }),
            db.Patient.count({ where: { ...patientWhere, isActive: false } })
        ]);

        // RX counts — filtered by serviceDate if a date range is active (UX-01: exclude deleted)
        const rxWhere = { ...notDeleted };
        if (dateRange) rxWhere.serviceDate = dateRange;

        // RX cards are operational counts: always read them live. The persisted
        // snapshot remains the source for trend history, not the live card total.
        const activeRxCount = await db.RXRecord.count({ where: rxWhere });

        // Pending deliveries: RX records that have NOT completed ALL workflow steps
        // PERF-01: Use a single aggregate query instead of N+1 per-record loop
        const totalWorkflowSteps = await db.WorkflowAction.count({ where: { isActive: true } });

        let pendingDeliveriesCount = 0;
        if (totalWorkflowSteps === 0) {
            // Fail closed when workflow configuration is empty.
            pendingDeliveriesCount = activeRxCount;
        } else {
            const doneMap = await loadCanonicalWorkflowCountMap();

            // Get all non-deleted RX IDs (with optional date filter)
            const allRxIds = await db.RXRecord.findAll({
                attributes: ['id'],
                where: rxWhere,
                raw: true
            });

            for (const { id } of allRxIds) {
                const done = Number(doneMap.get(Number(id)) || 0);
                if (done < totalWorkflowSteps) pendingDeliveriesCount++;
            }
        }
        const recentActivity = await db.AuditLog.findAll({
            limit: 10,
            order: [['date', 'DESC'], ['time', 'DESC']],
            include: [{ model: db.User, attributes: ['firstName', 'lastName'] }]
        });

        let patientsWithNoRx;
        if (currentSnapshot) {
            patientsWithNoRx = Number(currentSnapshot.patientsWithNoRx || 0);
        } else {
            // Active patients with NO RX records
            const patientIdsWithRx = await db.RXRecord.findAll({
                attributes: ['patientId'],
                where: { isDeleted: false },
                group: ['patientId'],
                raw: true
            });
            const idsWithRx = patientIdsWithRx.map(r => r.patientId);
            patientsWithNoRx = await db.Patient.count({
                where: {
                    isActive: true,
                    ...notDeleted,
                    id: { [Op.notIn]: idsWithRx.length ? idsWithRx : [0] }
                }
            });
        }

        res.json({
            activePatients,
            inactivePatients,
            pendingDeliveriesCount,
            activeRxCount,
            patientsWithNoRx,
            recentActivity,
            analyticsAsOf: currentSnapshot ? currentSnapshot.updatedAt : null
        });
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
        const workflowCountMap = await loadCanonicalWorkflowCountMap();
        const allRx = await db.RXRecord.findAll({
            where: { [Op.or]: [{ isDeleted: false }, { isDeleted: null }] },
            include: [
                { model: db.Patient,  attributes: ['firstName', 'lastName', 'patientCode'] },
                { model: db.Pharmacy, attributes: ['name'] },
                { model: db.RXWorkflowTracking }
            ],
            order: [['serviceDate', 'DESC']]
        });
        const pending = allRx
            .filter(rx => (
                totalWorkflowSteps === 0 ||
                Number(workflowCountMap.get(Number(rx.id)) || 0) < totalWorkflowSteps
            ))
            .map(rx => {
                const plain = rx.toJSON();
                plain.workflowStepsDone = Number(workflowCountMap.get(Number(rx.id)) || 0);
                plain.workflowStepTotal = totalWorkflowSteps;
                return plain;
            });
        res.json(pending);
    } catch (error) { res.status(500).json({ error: error.message }); }
};

exports.getTotalRx = async (req, res) => {
    try {
        const totalWorkflowSteps = await db.WorkflowAction.count({ where: { isActive: true } });
        const workflowCountMap = await loadCanonicalWorkflowCountMap();
        const allRx = await db.RXRecord.findAll({
            where: { [Op.or]: [{ isDeleted: false }, { isDeleted: null }] },
            include: [
                { model: db.Patient,  attributes: ['firstName', 'lastName', 'patientCode'] },
                { model: db.Pharmacy, attributes: ['name'] },
                { model: db.RXWorkflowTracking }
            ],
            order: [['serviceDate', 'DESC']]
        });
        res.json(allRx.map(rx => {
            const plain = rx.toJSON();
            plain.workflowStepsDone = Number(workflowCountMap.get(Number(rx.id)) || 0);
            plain.workflowStepTotal = totalWorkflowSteps;
            return plain;
        }));
    } catch (error) { res.status(500).json({ error: error.message }); }
};
function dashboardDateKeys(startDate, endDate) {
    const keys = [];
    const cursor = new Date(`${startDate}T12:00:00`);
    const last = new Date(`${endDate}T12:00:00`);
    if (isNaN(cursor.getTime()) || isNaN(last.getTime()) || cursor > last) return keys;
    while (cursor <= last) {
        keys.push(localDateString(cursor));
        cursor.setDate(cursor.getDate() + 1);
    }
    return keys;
}

async function resolveDashboardTrendRange(query) {
    query = query || {};
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    let rangeEnd = query.chartTo ? new Date(`${query.chartTo}T12:00:00`) : new Date(today);
    let rangeStart;
    if (query.chartFrom) {
        rangeStart = new Date(`${query.chartFrom}T12:00:00`);
    } else if (query.chartRange === 'all') {
        const [earliest] = await db.sequelize.query(`
            SELECT MIN(candidate)::date AS earliest
            FROM (
                SELECT MIN("serviceDate")::date AS candidate
                FROM "Patients"
                WHERE "serviceDate" IS NOT NULL
                  AND COALESCE("isDeleted", false) = false
                UNION ALL
                SELECT MIN("newServiceDate")::date
                FROM "PatientServiceDateHistories"
                WHERE "newServiceDate" IS NOT NULL
                UNION ALL
                SELECT MIN("serviceDate")::date
                FROM "PatientServiceDateCycles"
                WHERE "serviceDate" IS NOT NULL
                UNION ALL
                SELECT MIN("createdAt")::date
                FROM "RXRecords"
                WHERE COALESCE("isDeleted", false) = false
                UNION ALL
                SELECT MIN("createdAt")::date
                FROM "Patients"
                WHERE COALESCE("isDeleted", false) = false
                UNION ALL
                SELECT MIN("completionDate")::date
                FROM "RXWorkflowTrackings"
                WHERE "completionDate" IS NOT NULL
            ) AS candidates
        `, { type: QueryTypes.SELECT });
        rangeStart = earliest && earliest.earliest
            ? new Date(`${String(earliest.earliest).slice(0, 10)}T12:00:00`)
            : new Date(today);
    } else {
        rangeStart = new Date(today);
        rangeStart.setDate(rangeStart.getDate() - 29);
    }
    if (isNaN(rangeStart.getTime())) rangeStart = new Date(today);
    if (isNaN(rangeEnd.getTime())) rangeEnd = new Date(today);
    return {
        startDate: localDateString(rangeStart),
        endDate: localDateString(rangeEnd)
    };
}

function snapshotNumber(snapshot, field) {
    return Number(snapshot && snapshot[field] || 0);
}

async function serviceDateEntriesForRange(startDate, endDate) {
    const rows = await db.sequelize.query(`
        SELECT "serviceDate"::date::text AS date, COUNT(*)::integer AS count
        FROM "PatientServiceDateCycles"
        WHERE "serviceDate" BETWEEN :startDate AND :endDate
        GROUP BY "serviceDate"::date
    `, {
        type: QueryTypes.SELECT,
        replacements: { startDate, endDate }
    });
    return new Map(rows.map(row => [String(row.date).slice(0, 10), Number(row.count)]));
}

async function loadPersistedDashboardChart(query) {
    const range = await resolveDashboardTrendRange(query);
    const keys = dashboardDateKeys(range.startDate, range.endDate);
    if (!keys.length) return { response: null, missingDates: new Set(), range };

    const today = localSnapshotDate();
    if (range.startDate <= today && range.endDate >= today) {
        await getFreshCurrentSnapshot({ maxAgeMs: 1000 });
    }
    const snapshots = await db.DailySnapshot.findAll({
        where: { snapshotDate: { [Op.between]: [range.startDate, range.endDate] } },
        order: [['snapshotDate', 'ASC']],
        raw: true
    });
    const byDate = new Map(snapshots.map(snapshot => [String(snapshot.snapshotDate), snapshot]));
    const missingDates = new Set(keys.filter(key => !byDate.has(key)));
    if (missingDates.size) return { response: null, missingDates, range };

    const current = await getFreshCurrentSnapshot({ maxAgeMs: 1000 });
    const serviceEntries = await serviceDateEntriesForRange(range.startDate, range.endDate);
    const dailyTrends = {
        labels: keys,
        activePatients: [],
        inactivePatients: [],
        newPatientsToday: [],
        rxRecords: [],
        newRXToday: [],
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
        workflowStepsToday: [],
        workflowStepsCompletedDaily: [],
        completedWorkflowSteps: [],
        totalWorkflowSteps: [],
        workflowCompletionRate: [],
        serviceDateEntries: [],
        serviceDateChanges: []
    };
    keys.forEach(key => {
        const snapshot = byDate.get(key);
        dailyTrends.activePatients.push(snapshotNumber(snapshot, 'activePatients'));
        dailyTrends.inactivePatients.push(snapshotNumber(snapshot, 'inactivePatients'));
        dailyTrends.newPatientsToday.push(snapshotNumber(snapshot, 'newPatientsToday'));
        dailyTrends.rxRecords.push(snapshotNumber(snapshot, 'totalRX'));
        dailyTrends.newRXToday.push(snapshotNumber(snapshot, 'newRXToday'));
        dailyTrends.pendingDeliveries.push(snapshotNumber(snapshot, 'pendingRX'));
        dailyTrends.completedRX.push(snapshotNumber(snapshot, 'completedRX'));
        dailyTrends.patientsWithNoRx.push(snapshotNumber(snapshot, 'patientsWithNoRx'));
        dailyTrends.eligibleNow.push(snapshotNumber(snapshot, 'eligibleNow'));
        dailyTrends.expiringIn7.push(snapshotNumber(snapshot, 'expiringIn7'));
        dailyTrends.inWindow.push(snapshotNumber(snapshot, 'inWindow'));
        dailyTrends.noServiceDate.push(snapshotNumber(snapshot, 'noServiceDate'));
        dailyTrends.loginEventsToday.push(snapshotNumber(snapshot, 'loginEventsToday'));
        dailyTrends.uniqueLoginUsersToday.push(snapshotNumber(snapshot, 'uniqueLoginUsersToday'));
        dailyTrends.userActivityEventsToday.push(snapshotNumber(snapshot, 'userActivityEventsToday'));
        dailyTrends.uniqueActivityUsersToday.push(snapshotNumber(snapshot, 'uniqueActivityUsersToday'));
        dailyTrends.auditEventsToday.push(snapshotNumber(snapshot, 'auditEventsToday'));
        dailyTrends.workflowStepsToday.push(snapshotNumber(snapshot, 'workflowStepsToday'));
        dailyTrends.workflowStepsCompletedDaily.push(snapshotNumber(snapshot, 'workflowStepsToday'));
        dailyTrends.completedWorkflowSteps.push(snapshotNumber(snapshot, 'completedWorkflowSteps'));
        dailyTrends.totalWorkflowSteps.push(snapshotNumber(snapshot, 'totalWorkflowSteps'));
        dailyTrends.workflowCompletionRate.push(snapshotNumber(snapshot, 'workflowCompletionRate'));
        const entries = Number(serviceEntries.get(key) || 0);
        dailyTrends.serviceDateEntries.push(entries);
        dailyTrends.serviceDateChanges.push(entries);
    });
    const cardTotals = {
        labels: ['Active', 'Inactive', 'Total RX', 'Pending', 'No RX'],
        data: [
            snapshotNumber(current, 'activePatients'),
            snapshotNumber(current, 'inactivePatients'),
            snapshotNumber(current, 'totalRX'),
            snapshotNumber(current, 'pendingRX'),
            snapshotNumber(current, 'patientsWithNoRx')
        ]
    };
    return {
        response: {
            cardTotals,
            rxStatus: {
                labels: ['Completed', 'Pending'],
                data: [
                    snapshotNumber(current, 'completedRX'),
                    snapshotNumber(current, 'pendingRX')
                ]
            },
            dailyTrends,
            trendReady: true,
            trendWarning: '',
            analyticsSource: 'daily_snapshots',
            analyticsAsOf: current.updatedAt
        },
        missingDates,
        range
    };
}

async function persistDashboardTrendRows(dateKeys, dailyTrends, missingDates) {
    if (!missingDates || !missingDates.size) return 0;
    const value = (name, index) => Number((dailyTrends[name] || [])[index] || 0);
    const rows = dateKeys
        .map((snapshotDate, index) => ({ snapshotDate, index }))
        .filter(item => missingDates.has(item.snapshotDate))
        .map(({ snapshotDate, index }) => ({
            snapshotDate,
            totalPatients: value('activePatients', index) + value('inactivePatients', index),
            activePatients: value('activePatients', index),
            inactivePatients: value('inactivePatients', index),
            newPatientsToday: value('newPatientsToday', index),
            totalRX: value('rxRecords', index),
            newRXToday: value('newRXToday', index),
            pendingRX: value('pendingDeliveries', index),
            completedRX: value('completedRX', index),
            patientsWithNoRx: value('patientsWithNoRx', index),
            eligibleNow: value('eligibleNow', index),
            expiringIn7: value('expiringIn7', index),
            inWindow: value('inWindow', index),
            noServiceDate: value('noServiceDate', index),
            loginEventsToday: value('loginEventsToday', index),
            uniqueLoginUsersToday: value('uniqueLoginUsersToday', index),
            userActivityEventsToday: value('userActivityEventsToday', index),
            uniqueActivityUsersToday: value('uniqueActivityUsersToday', index),
            auditEventsToday: value('auditEventsToday', index),
            workflowStepsToday: value('workflowStepsToday', index),
            completedWorkflowSteps: value('completedWorkflowSteps', index),
            totalWorkflowSteps: value('totalWorkflowSteps', index),
            workflowCompletionRate: value('workflowCompletionRate', index)
        }));
    if (!rows.length) return 0;
    await db.DailySnapshot.bulkCreate(rows, { ignoreDuplicates: true });
    console.log(`[Snapshot] Materialized ${rows.length} missing dashboard trend day(s).`);
    return rows.length;
}

exports.getChartData = async (req, res) => {
    try {
        const persisted = await loadPersistedDashboardChart(req.query);
        if (persisted.response) return res.json(persisted.response);
        await materializeSnapshotHistory(persisted.range.startDate, persisted.range.endDate);
        const materialized = await loadPersistedDashboardChart(req.query);
        if (!materialized.response) {
            throw new Error('Dashboard analytics history could not be materialized.');
        }
        materialized.response.analyticsSource = 'daily_snapshots_materialized';
        return res.json(materialized.response);

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
                    else if (daysLeft <= getCallCenterLeadDays()) expiringIn7++;
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

        await persistDashboardTrendRows(dateKeys, dailyTrends, persisted.missingDates);
        res.json({
            cardTotals,
            rxStatus: { labels: ['Completed', 'Pending'], data: [completed2, pending] },
            dailyTrends,
            trendReady,
            trendWarning,
            analyticsSource: 'materialized_on_first_request'
        });
    } catch (error) { res.status(500).json({ error: error.message }); }
};

// GET /api/dashboard/eligibility
// Returns 90-day eligibility breakdown for active patients.
// SOURCE OF TRUTH: patient.serviceDate (canonical 90-day clock).
// This matches the frontend liveFilter() logic in patients.js.
async function getEligibilityStatsLegacy(req, res) {
    try {
        const notDeleted = { [Op.or]: [{ isDeleted: false }, { isDeleted: null }] };

        const today = new Date(); today.setHours(0, 0, 0, 0);
        const currentSnapshot = await getFreshCurrentSnapshot({ maxAgeMs: 1000 });
        const eligibilityCutoff = new Date(`${localSnapshotDate(today)}T12:00:00`);
        eligibilityCutoff.setDate(eligibilityCutoff.getDate() - getServiceWindowDays());
        const eligibilityCutoffIso = localDateString(eligibilityCutoff);

        // Totals come from the persisted current-day analytics row. Only the
        // bounded overdue preview is read live for the dashboard popup.
        const patients = await db.Patient.findAll({
            where: {
                isActive: true,
                ...notDeleted,
                serviceDate: { [Op.lte]: eligibilityCutoffIso }
            },
            attributes: ['id', 'firstName', 'lastName', 'patientCode', 'serviceDate'],
            order: [['serviceDate', 'ASC'], ['id', 'ASC']],
            limit: 20,
            raw: true
        });

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
            } else if (daysLeft <= getCallCenterLeadDays()) {
                // Inside the configured Call Center lead window before day 90.
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
            serviceWindowDays: getServiceWindowDays(),
            callCenterLeadDays: getCallCenterLeadDays(),
            callCenterCutoffDate: getCallCenterCutoffIso(today)
        });
    } catch (error) { res.status(500).json({ error: error.message }); }
}

exports.getEligibilityStats = async (req, res) => {
    try {
        const notDeleted = { [Op.or]: [{ isDeleted: false }, { isDeleted: null }] };
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const currentSnapshot = await getFreshCurrentSnapshot({ maxAgeMs: 1000 });
        const eligibilityCutoff = new Date(`${localSnapshotDate(today)}T12:00:00`);
        eligibilityCutoff.setDate(eligibilityCutoff.getDate() - getServiceWindowDays());
        const eligibilityCutoffIso = localDateString(eligibilityCutoff);
        const patients = await db.Patient.findAll({
            where: {
                isActive: true,
                ...notDeleted,
                serviceDate: { [Op.lte]: eligibilityCutoffIso }
            },
            attributes: ['id', 'firstName', 'lastName', 'patientCode', 'serviceDate'],
            order: [['serviceDate', 'ASC'], ['id', 'ASC']],
            limit: 20,
            raw: true
        });
        const eligibleList = patients.map(patient => {
            const eligibility = evaluateServiceWindow(patient.serviceDate, today);
            return {
                id: patient.id,
                patientCode: patient.patientCode,
                name: (patient.firstName || '') + ' ' + (patient.lastName || ''),
                lastService: patient.serviceDate,
                eligibleSince: eligibility.eligibleSince,
                daysPastDue: Math.abs(eligibility.daysLeft)
            };
        });

        res.json({
            eligibleNow: Number(currentSnapshot.eligibleNow || 0),
            expiringIn7: Number(currentSnapshot.expiringIn7 || 0),
            inWindow: Number(currentSnapshot.inWindow || 0),
            noServiceDate: Number(currentSnapshot.noServiceDate || 0),
            total: Number(currentSnapshot.activePatients || 0),
            eligibleList,
            serviceWindowDays: getServiceWindowDays(),
            callCenterLeadDays: getCallCenterLeadDays(),
            callCenterCutoffDate: getCallCenterCutoffIso(today),
            analyticsAsOf: currentSnapshot.updatedAt
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

exports.getRxPipeline = async (req, res) => {
    try {
        const steps = await db.WorkflowAction.findAll({
            where: { isActive: true },
            order: [['sequenceNumber', 'ASC'], ['id', 'ASC']],
            attributes: ['id', 'name', 'sequenceNumber'],
            raw: true
        });
        const totalSteps = steps.length;
        const serviceWindowDays = getServiceWindowDays();
        const grouped = await db.sequelize.query(`
            WITH workflow_counts AS (
                ${activeRxWorkflowAggregateSql()}
            ),
            pipeline_rows AS (
                SELECT
                    COALESCE(workflow_counts.completed_steps, 0)::integer AS completed_steps,
                    workflow_counts.current_stage_sequence,
                    (
                        rx."serviceDate" IS NOT NULL
                        AND (
                            rx."serviceDate"::date
                            + INTERVAL '${serviceWindowDays} days'
                        )::date < CURRENT_DATE
                        AND COALESCE(workflow_counts.completed_steps, 0) < :totalSteps
                    ) AS is_expired
                FROM "RXRecords" AS rx
                LEFT JOIN workflow_counts ON workflow_counts."rxRecordId" = rx.id
                WHERE COALESCE(rx."isDeleted", false) = false
            )
            SELECT completed_steps,
                   current_stage_sequence,
                   is_expired,
                   COUNT(*)::integer AS count
            FROM pipeline_rows
            GROUP BY
                completed_steps,
                current_stage_sequence,
                is_expired
            ORDER BY current_stage_sequence NULLS FIRST, is_expired
        `, {
            replacements: { totalSteps },
            type: QueryTypes.SELECT
        });
        const countByCurrentStage = new Map();
        grouped.forEach(row => {
            if (row.current_stage_sequence === null || row.current_stage_sequence === undefined) return;
            const sequenceNumber = Number(row.current_stage_sequence);
            countByCurrentStage.set(
                sequenceNumber,
                Number(countByCurrentStage.get(sequenceNumber) || 0) + Number(row.count)
            );
        });
        const total = grouped.reduce((sum, row) => sum + Number(row.count), 0);
        let notStarted = 0;
        let inProgress = 0;
        let expired = 0;
        let completed = 0;
        let startedIncomplete = 0;
        if (totalSteps === 0) {
            notStarted = total;
        } else {
            for (const row of grouped) {
                const done = Number(row.completed_steps);
                const count = Number(row.count);
                if (done > 0 && done < totalSteps) startedIncomplete += count;
                if (done >= totalSteps) completed += count;
                else if (row.is_expired === true) expired += count;
                else if (done === 0) notStarted += count;
                else inProgress += count;
            }
        }
        const allIncomplete = notStarted + inProgress + expired;
        const stepBreakdown = steps.map(step => ({
            id: step.id,
            name: step.name,
            sequenceNumber: Number(step.sequenceNumber),
            count: Number(countByCurrentStage.get(Number(step.sequenceNumber)) || 0)
        }));

        res.json({
            total,
            notStarted,
            inProgress,
            expired,
            completed,
            allIncomplete,
            startedIncomplete,
            totalSteps,
            stepBreakdown
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
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
                (filter === 'expiring' && daysLeft > 0 && daysLeft <= getCallCenterLeadDays()) ||
                (filter === 'window'   && daysLeft > getCallCenterLeadDays())
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
