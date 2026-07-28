'use strict';
/**
 * snapshotService.js
 * Computes and persists dashboard metrics in one row per local calendar day.
 * The current day is refreshed every five minutes; completed days remain
 * immutable unless an administrator intentionally rebuilds trend history.
 */
const { QueryTypes } = require('sequelize');
const { getServiceWindowDays, getCallCenterLeadDays } = require('../utils/globalSettings');
const { activeRxWorkflowAggregateSql } = require('../utils/rxWorkflowAggregateSql');

let _db = null;
let _trendSchemaReady = null;
let _currentSnapshotPromise = null;
let _historySnapshotPromise = null;
const TREND_COLUMNS = [
    'patientsWithNoRx',
    'eligibleNow',
    'expiringIn7',
    'inWindow',
    'noServiceDate',
    'loginEventsToday',
    'uniqueLoginUsersToday',
    'userActivityEventsToday',
    'uniqueActivityUsersToday',
    'workflowCompletionRate',
    'completedWorkflowSteps',
    'workflowStepsToday',
    'totalWorkflowSteps'
];
function db() {
    if (!_db) _db = require('../models');
    return _db;
}

async function isTrendSnapshotSchemaReady() {
    if (_trendSchemaReady !== null) return _trendSchemaReady;
    try {
        const qi = db().sequelize.getQueryInterface();
        const table = await qi.describeTable('DailySnapshots');
        _trendSchemaReady = !!table && TREND_COLUMNS.every(function(col) {
            return Object.prototype.hasOwnProperty.call(table, col);
        });
    } catch (e) {
        _trendSchemaReady = false;
    }
    return _trendSchemaReady;
}

/**
 * Capture a snapshot for a given date (defaults to today).
 * If a snapshot already exists for that date it is overwritten (upsert).
 * @param {string|Date} [forDate]  — ISO date string 'YYYY-MM-DD' or Date object.
 * @returns {Promise<object>}      — The saved DailySnapshot instance.
 */
async function captureSnapshot(forDate) {
    const schemaReady = await isTrendSnapshotSchemaReady();
    if (!schemaReady) {
        console.warn('[Snapshot] Skipping capture: DailySnapshots trend columns are not available yet.');
        return null;
    }

    let d;
    if (typeof forDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(forDate)) {
        const parts = forDate.split('-').map(n => parseInt(n, 10));
        d = new Date(parts[0], parts[1] - 1, parts[2]);
    } else {
        d = forDate ? new Date(forDate) : new Date();
    }
    // Normalise to YYYY-MM-DD in local time
    const pad = n => String(n).padStart(2, '0');
    const snapshotDate = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    // M6 FIX: Build the local-day boundaries in the configured process timezone.
    // ISO conversion makes the PostgreSQL TIMESTAMPTZ comparisons unambiguous.
    const dayStartDt = new Date(`${snapshotDate}T00:00:00`);
    const dayEndDt   = new Date(`${snapshotDate}T00:00:00`);
    dayEndDt.setDate(dayEndDt.getDate() + 1);
    // ISO strings are always UTC; use a half-open range [start, next midnight).
    const dayStart = dayStartDt.toISOString();
    const dayEnd   = dayEndDt.toISOString();
    const seq = db().sequelize;

    // ── Patients ──────────────────────────────────────────────────────────
    const [pat] = await seq.query(`
        SELECT
            COUNT(*)                                                             AS "totalPatients",
            COUNT(*) FILTER (WHERE "isActive" = true)                            AS "activePatients",
            COUNT(*) FILTER (WHERE "isActive" = false)                           AS "inactivePatients",
            COUNT(*) FILTER (WHERE "createdAt" >= :dayStart AND "createdAt" < :dayEnd)    AS "newPatientsToday",
            COUNT(*) FILTER (WHERE "isNonCompanyPatient" = true)                 AS "nonCompanyPatients"
        FROM "Patients"
        WHERE COALESCE("isDeleted", false) = false
    `, { type: QueryTypes.SELECT, replacements: { dayStart, dayEnd } });

    // ── RX Records ────────────────────────────────────────────────────────
    // pendingRX = RX where NOT all workflow steps are completed
    const [rx] = await seq.query(`
        WITH active_step_total AS (
            SELECT COUNT(*)::integer AS total_steps
            FROM "WorkflowActions"
            WHERE "isActive" = TRUE
        ),
        workflow_counts AS (
            ${activeRxWorkflowAggregateSql()}
        ),
        wf_totals AS (
            SELECT
                r.id,
                active_step_total.total_steps,
                COALESCE(workflow_counts.completed_steps, 0)::integer AS done_steps
            FROM "RXRecords" r
            CROSS JOIN active_step_total
            LEFT JOIN workflow_counts ON workflow_counts."rxRecordId" = r.id
            WHERE COALESCE(r."isDeleted", false) = false
        )
        SELECT
            (SELECT COUNT(*) FROM wf_totals)                                                                                         AS "totalRX",
            (SELECT COUNT(*) FROM "RXRecords" WHERE COALESCE("isDeleted", false) = false AND "createdAt" >= :dayStart AND "createdAt" < :dayEnd) AS "newRXToday",
            (SELECT COUNT(*) FROM wf_totals WHERE total_steps = 0 OR done_steps < total_steps)                                    AS "pendingRX",
            (SELECT COUNT(*) FROM wf_totals WHERE total_steps > 0 AND done_steps >= total_steps)                                   AS "completedRX",
            (SELECT COUNT(*) FROM "RXRecords" WHERE "isDeleted" = true)                                                           AS "deletedRX",
            (SELECT COUNT(*) FROM "RXRecords" WHERE "returnedToWarehouse" = true AND COALESCE("isDeleted", false) = false)        AS "returnedToWarehouseRX"
    `, { type: QueryTypes.SELECT, replacements: { dayStart, dayEnd } });

    // ── Workflow steps ────────────────────────────────────────────────────
    const totalActiveStepDefs = await seq.query(
        `SELECT COUNT(*) AS cnt FROM "WorkflowActions" WHERE "isActive" = true`,
        { type: QueryTypes.SELECT }
    );
    const activeRXCount = parseInt((await seq.query(
        `SELECT COUNT(*) AS cnt FROM "RXRecords" WHERE COALESCE("isDeleted", false) = false`,
        { type: QueryTypes.SELECT }
    ))[0].cnt, 10);
    const totalWorkflowSteps     = parseInt(totalActiveStepDefs[0].cnt, 10) * activeRXCount;
    const completedWorkflowSteps = await seq.query(
        `SELECT COUNT(DISTINCT (t."rxRecordId", t."workflowActionId")) AS cnt
         FROM "RXWorkflowTrackings" t
         INNER JOIN "WorkflowActions" a
             ON a.id = t."workflowActionId"
            AND a."isActive" = true
         INNER JOIN "RXRecords" r
             ON r.id = t."rxRecordId"
            AND COALESCE(r."isDeleted", false) = false`,
        { type: QueryTypes.SELECT }
    ).then(r => parseInt(r[0].cnt, 10));
    const workflowStepsToday = await seq.query(
        `SELECT COUNT(*) AS cnt
         FROM (
             SELECT
                 t."rxRecordId",
                 t."workflowActionId",
                 MIN(t."completionDate") AS first_completion
             FROM "RXWorkflowTrackings" t
             INNER JOIN "WorkflowActions" a
                 ON a.id = t."workflowActionId"
                AND a."isActive" = true
             INNER JOIN "RXRecords" r
                 ON r.id = t."rxRecordId"
                AND COALESCE(r."isDeleted", false) = false
             GROUP BY t."rxRecordId", t."workflowActionId"
         ) completed_steps
         WHERE first_completion >= :dayStart AND first_completion < :dayEnd`,
        { type: QueryTypes.SELECT, replacements: { dayStart, dayEnd } }
    ).then(r => parseInt(r[0].cnt, 10));
    const workflowCompletionRate = totalWorkflowSteps > 0
        ? parseFloat(((completedWorkflowSteps / totalWorkflowSteps) * 100).toFixed(2))
        : 0;

    // ── Users & Activity ──────────────────────────────────────────────────
    const [usr] = await seq.query(`
        SELECT
            COUNT(*)                                       AS "totalUsers",
            COUNT(*) FILTER (WHERE "isActive" = true)     AS "activeUsers"
        FROM "Users"
    `, { type: QueryTypes.SELECT });

    const [elig] = await seq.query(`
        SELECT
            COUNT(*) FILTER (WHERE "isActive" = true AND "serviceDate" IS NOT NULL AND (("serviceDate"::date + INTERVAL '${getServiceWindowDays()} days')::date <= CAST(:snapshotDate AS date))) AS "eligibleNow",
            COUNT(*) FILTER (WHERE "isActive" = true AND "serviceDate" IS NOT NULL AND (("serviceDate"::date + INTERVAL '${getServiceWindowDays()} days')::date > CAST(:snapshotDate AS date)) AND (("serviceDate"::date + INTERVAL '${getServiceWindowDays()} days')::date <= CAST(:snapshotDate AS date) + INTERVAL '${getCallCenterLeadDays()} days')) AS "expiringIn7",
            COUNT(*) FILTER (WHERE "isActive" = true AND "serviceDate" IS NOT NULL AND (("serviceDate"::date + INTERVAL '${getServiceWindowDays()} days')::date > CAST(:snapshotDate AS date) + INTERVAL '${getCallCenterLeadDays()} days')) AS "inWindow",
            COUNT(*) FILTER (WHERE "isActive" = true AND "serviceDate" IS NULL) AS "noServiceDate",
            COUNT(*) FILTER (
                WHERE "isActive" = true
                  AND NOT EXISTS (
                      SELECT 1 FROM "RXRecords" r
                      WHERE r."patientId" = "Patients".id
                        AND r."isDeleted" = false
                  )
            ) AS "patientsWithNoRx"
        FROM "Patients"
        WHERE COALESCE("isDeleted", false) = false
    `, { type: QueryTypes.SELECT, replacements: { snapshotDate } });

    const loginEventsToday = await seq.query(
        `SELECT COUNT(*) AS cnt FROM "AuditLogs" WHERE "createdAt" >= :dayStart AND "createdAt" < :dayEnd AND "module" = 'Authentication' AND "action" = 'Login'`,
        { type: QueryTypes.SELECT, replacements: { dayStart, dayEnd } }
    ).then(r => parseInt(r[0].cnt, 10));

    const uniqueLoginUsersToday = await seq.query(
        `SELECT COUNT(DISTINCT "userId") AS cnt FROM "AuditLogs" WHERE "createdAt" >= :dayStart AND "createdAt" < :dayEnd AND "module" = 'Authentication' AND "action" = 'Login' AND "userId" IS NOT NULL`,
        { type: QueryTypes.SELECT, replacements: { dayStart, dayEnd } }
    ).then(r => parseInt(r[0].cnt, 10));

    const userActivity = await seq.query(
        `SELECT COUNT(*) AS events, COUNT(DISTINCT "userId") AS users FROM "UserActivityLogs" WHERE "visitedAt" >= :dayStart AND "visitedAt" < :dayEnd`,
        { type: QueryTypes.SELECT, replacements: { dayStart, dayEnd } }
    ).then(r => ({
        events: parseInt(r[0].events, 10) || 0,
        users: parseInt(r[0].users, 10) || 0
    })).catch(() => ({ events: 0, users: 0 }));

    const auditEventsToday = await seq.query(
        `SELECT COUNT(*) AS cnt FROM "AuditLogs" WHERE "createdAt" >= :dayStart AND "createdAt" < :dayEnd`,
        { type: QueryTypes.SELECT, replacements: { dayStart, dayEnd } }
    ).then(r => parseInt(r[0].cnt, 10));

    const errorLogsToday = await seq.query(
        `SELECT COUNT(*) AS cnt FROM "ErrorLogs" WHERE "createdAt" >= :dayStart AND "createdAt" < :dayEnd`,
        { type: QueryTypes.SELECT, replacements: { dayStart, dayEnd } }
    ).then(r => parseInt(r[0].cnt, 10));

    const unresolvedErrors = await seq.query(
        `SELECT COUNT(*) AS cnt FROM "ErrorLogs" WHERE "resolved" = false`,
        { type: QueryTypes.SELECT }
    ).then(r => parseInt(r[0].cnt, 10));

    // Pharmacies and Clinics use isActive, no isDeleted column
    const totalPharmacies = await seq.query(
        `SELECT COUNT(*) AS cnt FROM "Pharmacies"`,
        { type: QueryTypes.SELECT }
    ).then(r => parseInt(r[0].cnt, 10));

    const totalClinics = await seq.query(
        `SELECT COUNT(*) AS cnt FROM "Clinics"`,
        { type: QueryTypes.SELECT }
    ).then(r => parseInt(r[0].cnt, 10));

    const totalTransportCompanies = await seq.query(
        `SELECT (
            (SELECT COUNT(*) FROM "PatientTransportCompanies")  +
            (SELECT COUNT(*) FROM "PharmacyTransportCompanies")
        ) AS cnt`,
        { type: QueryTypes.SELECT }
    ).then(r => parseInt(r[0].cnt, 10));

    // ── Build payload ─────────────────────────────────────────────────────
    const payload = {
        snapshotDate,
        // patients
        totalPatients:           parseInt(pat.totalPatients,   10) || 0,
        activePatients:          parseInt(pat.activePatients,  10) || 0,
        inactivePatients:        parseInt(pat.inactivePatients,10) || 0,
        newPatientsToday:        parseInt(pat.newPatientsToday,10) || 0,
        nonCompanyPatients:      parseInt(pat.nonCompanyPatients,10) || 0,
        // rx
        totalRX:                 parseInt(rx.totalRX,           10) || 0,
        newRXToday:              parseInt(rx.newRXToday,         10) || 0,
        pendingRX:               parseInt(rx.pendingRX,          10) || 0,
        completedRX:             parseInt(rx.completedRX,        10) || 0,
        deletedRX:               parseInt(rx.deletedRX,          10) || 0,
        returnedToWarehouseRX:   parseInt(rx.returnedToWarehouseRX, 10) || 0,
        // workflow
        totalWorkflowSteps,
        completedWorkflowSteps,
        workflowStepsToday,
        workflowCompletionRate,
        // users
        totalUsers:              parseInt(usr.totalUsers,       10) || 0,
        activeUsers:             parseInt(usr.activeUsers,      10) || 0,
        loginEventsToday,
        uniqueLoginUsersToday,
        userActivityEventsToday:  userActivity.events,
        uniqueActivityUsersToday: userActivity.users,
        auditEventsToday,
        errorLogsToday,
        unresolvedErrors,
        eligibleNow:             parseInt(elig.eligibleNow,     10) || 0,
        expiringIn7:             parseInt(elig.expiringIn7,     10) || 0,
        inWindow:                parseInt(elig.inWindow,        10) || 0,
        noServiceDate:           parseInt(elig.noServiceDate,   10) || 0,
        patientsWithNoRx:        parseInt(elig.patientsWithNoRx,10) || 0,
        // lookup
        totalPharmacies,
        totalClinics,
        totalTransportCompanies,
    };

    // Upsert — replace if same date already exists
    const [snap] = await db().DailySnapshot.upsert(payload, { returning: true });
    console.log(`[Snapshot] Captured ${snapshotDate}: patients=${payload.totalPatients} rx=${payload.totalRX} pending=${payload.pendingRX}`);
    return snap;
}

function localSnapshotDate(value) {
    const d = value ? new Date(value) : new Date();
    if (isNaN(d.getTime())) return null;
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addLocalDays(isoDate, days) {
    const d = new Date(`${isoDate}T12:00:00`);
    d.setDate(d.getDate() + days);
    return localSnapshotDate(d);
}

function assertSnapshotDate(value, label) {
    const date = String(value || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new Error(`${label} must be an ISO date (YYYY-MM-DD).`);
    }
    return date;
}

async function findEarliestAnalyticsDate() {
    const timeZone = process.env.TZ || 'America/New_York';
    const [row] = await db().sequelize.query(`
        SELECT MIN(candidate)::date::text AS earliest
        FROM (
            SELECT MIN(("createdAt" AT TIME ZONE :timeZone)::date) AS candidate
              FROM "Patients" WHERE COALESCE("isDeleted", false) = false
            UNION ALL
            SELECT MIN(("createdAt" AT TIME ZONE :timeZone)::date)
              FROM "RXRecords" WHERE "isDeleted" = false
            UNION ALL
            SELECT MIN("serviceDate"::date) FROM "PatientServiceDateCycles"
            UNION ALL
            SELECT MIN(("completionDate" AT TIME ZONE :timeZone)::date)
              FROM "RXWorkflowTrackings" WHERE "completionDate" IS NOT NULL
        ) AS candidates
    `, {
        type: QueryTypes.SELECT,
        replacements: { timeZone }
    });
    return row && row.earliest ? String(row.earliest).slice(0, 10) : localSnapshotDate();
}

function numberValue(row, key) {
    return Number(row && row[key] || 0);
}

async function materializeSnapshotChunk(startDate, endDate) {
    const existing = await db().DailySnapshot.findAll({
        where: { snapshotDate: { [db().Sequelize.Op.between]: [startDate, endDate] } },
        attributes: ['snapshotDate'],
        raw: true
    });
    const existingDates = new Set(existing.map(row => String(row.snapshotDate)));
    const missingDates = new Set();
    for (let date = startDate; date <= endDate; date = addLocalDays(date, 1)) {
        if (!existingDates.has(date)) missingDates.add(date);
    }
    if (!missingDates.size) return 0;

    const timeZone = process.env.TZ || 'America/New_York';
    const serviceWindowDays = getServiceWindowDays();
    const callCenterLeadDays = getCallCenterLeadDays();
    const rows = await db().sequelize.query(`
        WITH
        dates AS (
            SELECT generate_series(
                CAST(:startDate AS date),
                CAST(:endDate AS date),
                INTERVAL '1 day'
            )::date AS snapshot_date
        ),
        workflow_config AS (
            SELECT COUNT(*)::integer AS active_steps
            FROM "WorkflowActions"
            WHERE "isActive" = true
        ),
        patient_base AS (
            SELECT id,
                   ("createdAt" AT TIME ZONE :timeZone)::date AS created_date,
                   ("isActive" = true) AS is_active,
                   ("isNonCompanyPatient" = true) AS is_non_company
            FROM "Patients"
            WHERE COALESCE("isDeleted", false) = false
        ),
        patient_daily AS (
            SELECT d.snapshot_date,
                   COUNT(p.id)::integer AS total_patients,
                   COUNT(p.id) FILTER (WHERE p.is_active)::integer AS active_patients,
                   COUNT(p.id) FILTER (WHERE NOT p.is_active)::integer AS inactive_patients,
                   COUNT(p.id) FILTER (WHERE p.created_date = d.snapshot_date)::integer AS new_patients,
                   COUNT(p.id) FILTER (WHERE p.is_non_company)::integer AS non_company
            FROM dates d
            LEFT JOIN patient_base p ON p.created_date <= d.snapshot_date
            GROUP BY d.snapshot_date
        ),
        rx_base AS (
            SELECT id,
                   "patientId" AS patient_id,
                   ("createdAt" AT TIME ZONE :timeZone)::date AS created_date,
                   ("returnedToWarehouse" = true) AS returned_to_warehouse
            FROM "RXRecords"
            WHERE COALESCE("isDeleted", false) = false
        ),
        rx_daily AS (
            SELECT d.snapshot_date,
                   COUNT(r.id)::integer AS total_rx,
                   COUNT(r.id) FILTER (WHERE r.created_date = d.snapshot_date)::integer AS new_rx,
                   COUNT(r.id) FILTER (WHERE r.returned_to_warehouse)::integer AS returned_rx
            FROM dates d
            LEFT JOIN rx_base r ON r.created_date <= d.snapshot_date
            GROUP BY d.snapshot_date
        ),
        first_rx AS (
            SELECT patient_id, MIN(created_date) AS first_rx_date
            FROM rx_base
            WHERE patient_id IS NOT NULL
            GROUP BY patient_id
        ),
        cycle_ranges AS (
            SELECT "patientId" AS patient_id,
                   "serviceDate"::date AS service_date,
                   LEAD("serviceDate"::date) OVER (
                       PARTITION BY "patientId" ORDER BY "serviceDate"::date
                   ) AS next_service_date
            FROM "PatientServiceDateCycles"
            WHERE "serviceDate" IS NOT NULL
        ),
        eligibility_daily AS (
            SELECT d.snapshot_date,
                   COUNT(p.id) FILTER (
                       WHERE f.first_rx_date IS NULL OR f.first_rx_date > d.snapshot_date
                   )::integer AS patients_with_no_rx,
                   COUNT(p.id) FILTER (
                       WHERE c.service_date IS NULL
                   )::integer AS no_service_date,
                   COUNT(p.id) FILTER (
                       WHERE c.service_date IS NOT NULL
                         AND c.service_date + CAST(:serviceWindowDays AS integer) <= d.snapshot_date
                   )::integer AS eligible_now,
                   COUNT(p.id) FILTER (
                       WHERE c.service_date IS NOT NULL
                         AND c.service_date + CAST(:serviceWindowDays AS integer) > d.snapshot_date
                         AND c.service_date + CAST(:serviceWindowDays AS integer)
                             <= d.snapshot_date + CAST(:callCenterLeadDays AS integer)
                   )::integer AS expiring_soon,
                   COUNT(p.id) FILTER (
                       WHERE c.service_date IS NOT NULL
                         AND c.service_date + CAST(:serviceWindowDays AS integer)
                             > d.snapshot_date + CAST(:callCenterLeadDays AS integer)
                   )::integer AS in_window
            FROM dates d
            JOIN patient_base p
              ON p.created_date <= d.snapshot_date
             AND p.is_active
            LEFT JOIN first_rx f ON f.patient_id = p.id
            LEFT JOIN cycle_ranges c
              ON c.patient_id = p.id
             AND c.service_date <= d.snapshot_date
             AND (c.next_service_date IS NULL OR c.next_service_date > d.snapshot_date)
            GROUP BY d.snapshot_date
        ),
        tracking_first AS (
            SELECT
                t."rxRecordId" AS rx_id,
                t."workflowActionId" AS action_id,
                MIN((t."completionDate" AT TIME ZONE :timeZone)::date) AS completion_date
            FROM "RXWorkflowTrackings" t
            INNER JOIN "WorkflowActions" a
                ON a.id = t."workflowActionId"
               AND a."isActive" = true
            INNER JOIN rx_base r ON r.id = t."rxRecordId"
            WHERE t."completionDate" IS NOT NULL
            GROUP BY t."rxRecordId", t."workflowActionId"
        ),
        rx_completion AS (
            SELECT
                tf.rx_id,
                MAX(tf.completion_date) AS completed_date
            FROM tracking_first tf
            CROSS JOIN workflow_config wc
            GROUP BY tf.rx_id, wc.active_steps
            HAVING wc.active_steps > 0 AND COUNT(*) = wc.active_steps
        ),
        workflow_step_daily AS (
            SELECT d.snapshot_date,
                   COUNT(tf.rx_id) FILTER (WHERE tf.completion_date <= d.snapshot_date)::integer AS completed_steps,
                   COUNT(tf.rx_id) FILTER (WHERE tf.completion_date = d.snapshot_date)::integer AS steps_today
            FROM dates d
            LEFT JOIN tracking_first tf ON tf.completion_date <= d.snapshot_date
            GROUP BY d.snapshot_date
        ),
        completion_daily AS (
            SELECT d.snapshot_date,
                   COUNT(rc.rx_id) FILTER (WHERE rc.completed_date <= d.snapshot_date)::integer AS completed_rx
            FROM dates d
            LEFT JOIN rx_completion rc ON rc.completed_date <= d.snapshot_date
            GROUP BY d.snapshot_date
        ),
        audit_daily AS (
            SELECT ("createdAt" AT TIME ZONE :timeZone)::date AS event_date,
                   COUNT(*)::integer AS audit_events,
                   COUNT(*) FILTER (
                       WHERE module = 'Authentication' AND action = 'Login'
                   )::integer AS login_events,
                   COUNT(DISTINCT "userId") FILTER (
                       WHERE module = 'Authentication' AND action = 'Login' AND "userId" IS NOT NULL
                   )::integer AS login_users
            FROM "AuditLogs"
            WHERE ("createdAt" AT TIME ZONE :timeZone)::date
                  BETWEEN CAST(:startDate AS date) AND CAST(:endDate AS date)
            GROUP BY ("createdAt" AT TIME ZONE :timeZone)::date
        ),
        activity_daily AS (
            SELECT ("visitedAt" AT TIME ZONE :timeZone)::date AS event_date,
                   COUNT(*)::integer AS activity_events,
                   COUNT(DISTINCT "userId")::integer AS activity_users
            FROM "UserActivityLogs"
            WHERE ("visitedAt" AT TIME ZONE :timeZone)::date
                  BETWEEN CAST(:startDate AS date) AND CAST(:endDate AS date)
            GROUP BY ("visitedAt" AT TIME ZONE :timeZone)::date
        ),
        error_daily AS (
            SELECT ("createdAt" AT TIME ZONE :timeZone)::date AS event_date,
                   COUNT(*)::integer AS error_events
            FROM "ErrorLogs"
            WHERE ("createdAt" AT TIME ZONE :timeZone)::date
                  BETWEEN CAST(:startDate AS date) AND CAST(:endDate AS date)
            GROUP BY ("createdAt" AT TIME ZONE :timeZone)::date
        ),
        constants AS (
            SELECT
                (SELECT COUNT(*)::integer FROM "Users") AS total_users,
                (SELECT COUNT(*)::integer FROM "Users" WHERE "isActive" = true) AS active_users,
                (SELECT COUNT(*)::integer FROM "RXRecords" WHERE "isDeleted" = true) AS deleted_rx,
                (SELECT COUNT(*)::integer FROM "ErrorLogs" WHERE "resolved" = false) AS unresolved_errors,
                (SELECT COUNT(*)::integer FROM "Pharmacies") AS total_pharmacies,
                (SELECT COUNT(*)::integer FROM "Clinics") AS total_clinics,
                (
                    (SELECT COUNT(*) FROM "PatientTransportCompanies")
                    + (SELECT COUNT(*) FROM "PharmacyTransportCompanies")
                )::integer AS total_transport
        )
        SELECT
            d.snapshot_date::text AS "snapshotDate",
            COALESCE(pd.total_patients, 0) AS "totalPatients",
            COALESCE(pd.active_patients, 0) AS "activePatients",
            COALESCE(pd.inactive_patients, 0) AS "inactivePatients",
            COALESCE(pd.new_patients, 0) AS "newPatientsToday",
            COALESCE(pd.non_company, 0) AS "nonCompanyPatients",
            COALESCE(rd.total_rx, 0) AS "totalRX",
            COALESCE(rd.new_rx, 0) AS "newRXToday",
            CASE WHEN wc.active_steps = 0
                 THEN COALESCE(rd.total_rx, 0)
                 ELSE GREATEST(COALESCE(rd.total_rx, 0) - COALESCE(cd.completed_rx, 0), 0)
            END AS "pendingRX",
            CASE WHEN wc.active_steps = 0 THEN 0 ELSE COALESCE(cd.completed_rx, 0) END AS "completedRX",
            c.deleted_rx AS "deletedRX",
            COALESCE(rd.returned_rx, 0) AS "returnedToWarehouseRX",
            COALESCE(ed.patients_with_no_rx, 0) AS "patientsWithNoRx",
            COALESCE(ed.eligible_now, 0) AS "eligibleNow",
            COALESCE(ed.expiring_soon, 0) AS "expiringIn7",
            COALESCE(ed.in_window, 0) AS "inWindow",
            COALESCE(ed.no_service_date, 0) AS "noServiceDate",
            (COALESCE(rd.total_rx, 0) * wc.active_steps)::integer AS "totalWorkflowSteps",
            COALESCE(wsd.completed_steps, 0) AS "completedWorkflowSteps",
            COALESCE(wsd.steps_today, 0) AS "workflowStepsToday",
            CASE WHEN COALESCE(rd.total_rx, 0) * wc.active_steps > 0
                 THEN ROUND(
                     COALESCE(wsd.completed_steps, 0)::numeric
                     / (COALESCE(rd.total_rx, 0) * wc.active_steps)::numeric * 100,
                     2
                 )::double precision
                 ELSE 0
            END AS "workflowCompletionRate",
            c.total_users AS "totalUsers",
            c.active_users AS "activeUsers",
            COALESCE(ad.login_events, 0) AS "loginEventsToday",
            COALESCE(ad.login_users, 0) AS "uniqueLoginUsersToday",
            COALESCE(ud.activity_events, 0) AS "userActivityEventsToday",
            COALESCE(ud.activity_users, 0) AS "uniqueActivityUsersToday",
            COALESCE(ad.audit_events, 0) AS "auditEventsToday",
            COALESCE(er.error_events, 0) AS "errorLogsToday",
            c.unresolved_errors AS "unresolvedErrors",
            c.total_pharmacies AS "totalPharmacies",
            c.total_clinics AS "totalClinics",
            c.total_transport AS "totalTransportCompanies"
        FROM dates d
        CROSS JOIN workflow_config wc
        CROSS JOIN constants c
        LEFT JOIN patient_daily pd ON pd.snapshot_date = d.snapshot_date
        LEFT JOIN rx_daily rd ON rd.snapshot_date = d.snapshot_date
        LEFT JOIN eligibility_daily ed ON ed.snapshot_date = d.snapshot_date
        LEFT JOIN workflow_step_daily wsd ON wsd.snapshot_date = d.snapshot_date
        LEFT JOIN completion_daily cd ON cd.snapshot_date = d.snapshot_date
        LEFT JOIN audit_daily ad ON ad.event_date = d.snapshot_date
        LEFT JOIN activity_daily ud ON ud.event_date = d.snapshot_date
        LEFT JOIN error_daily er ON er.event_date = d.snapshot_date
        ORDER BY d.snapshot_date
    `, {
        type: QueryTypes.SELECT,
        replacements: {
            startDate,
            endDate,
            timeZone,
            serviceWindowDays,
            callCenterLeadDays
        }
    });

    const missingRows = rows
        .filter(row => missingDates.has(String(row.snapshotDate)))
        .map(row => Object.keys(row).reduce((out, key) => {
            out[key] = key === 'snapshotDate' ? row[key] : numberValue(row, key);
            return out;
        }, {}));
    if (missingRows.length) {
        await db().DailySnapshot.bulkCreate(missingRows, { ignoreDuplicates: true });
    }
    return missingRows.length;
}

async function materializeSnapshotHistory(startDate, endDate) {
    const start = assertSnapshotDate(startDate, 'Snapshot start date');
    const end = assertSnapshotDate(endDate, 'Snapshot end date');
    if (start > end) return 0;
    if (_historySnapshotPromise) {
        await _historySnapshotPromise;
        // The completed request may have covered a different custom range.
        // Re-enter so this caller verifies/materializes its own exact dates.
        return materializeSnapshotHistory(start, end);
    }

    _historySnapshotPromise = (async () => {
        const startedAt = Date.now();
        let inserted = 0;
        let chunkStart = start;
        while (chunkStart <= end) {
            const chunkEnd = [addLocalDays(chunkStart, 365), end].sort()[0];
            inserted += await materializeSnapshotChunk(chunkStart, chunkEnd);
            chunkStart = addLocalDays(chunkEnd, 1);
        }
        console.log(
            `[Snapshot] Historical analytics ready for ${start} through ${end}: `
            + `${inserted} row(s) inserted in ${Date.now() - startedAt}ms.`
        );
        return inserted;
    })().finally(() => {
        _historySnapshotPromise = null;
    });
    return _historySnapshotPromise;
}

async function warmDashboardHistoryInBackground() {
    try {
        const earliest = await findEarliestAnalyticsDate();
        const yesterday = addLocalDays(localSnapshotDate(), -1);
        if (earliest <= yesterday) {
            await materializeSnapshotHistory(earliest, yesterday);
        }
    } catch (error) {
        console.error('[Snapshot] Historical analytics warm-up failed:', error.message);
    }
}

async function getFreshCurrentSnapshot(options) {
    options = options || {};
    const maxAgeMs = Number.isFinite(Number(options.maxAgeMs))
        ? Math.max(1000, Number(options.maxAgeMs))
        : 5 * 60 * 1000;
    const snapshotDate = localSnapshotDate();
    const existing = await db().DailySnapshot.findOne({ where: { snapshotDate } });
    if (existing && Date.now() - new Date(existing.updatedAt).getTime() <= maxAgeMs) {
        return existing;
    }

    // Dashboard cards, charts, and eligibility load concurrently. Share one
    // refresh so a cold page never launches three copies of the same aggregate
    // workload.
    if (!_currentSnapshotPromise) {
        _currentSnapshotPromise = captureSnapshot(snapshotDate)
            .finally(() => { _currentSnapshotPromise = null; });
    }
    return _currentSnapshotPromise;
}

function refreshCurrentSnapshotInBackground() {
    return getFreshCurrentSnapshot({ maxAgeMs: 4 * 60 * 1000 })
        .catch(error => {
            console.error('[Snapshot] Background refresh failed:', error.message);
            return null;
        });
}

module.exports = {
    captureSnapshot,
    getFreshCurrentSnapshot,
    refreshCurrentSnapshotInBackground,
    materializeSnapshotHistory,
    warmDashboardHistoryInBackground,
    isTrendSnapshotSchemaReady,
    localSnapshotDate
};
