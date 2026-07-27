'use strict';

/**
 * Canonical per-RX workflow projection used by list, report, and dashboard
 * queries. Retired/orphaned actions and duplicate tracking rows must not
 * change current workflow state.
 */
function activeRxWorkflowAggregateSql() {
    return `
        SELECT
            wt."rxRecordId",
            COUNT(DISTINCT wt."workflowActionId")::integer AS completed_steps,
            MAX(wa."sequenceNumber")::integer AS current_stage_sequence,
            (ARRAY_AGG(
                wt."completionDate"
                ORDER BY
                    wa."sequenceNumber" DESC NULLS LAST,
                    wt."completionDate" DESC NULLS LAST,
                    wt.id DESC
            ))[1] AS current_stage_at
        FROM "RXWorkflowTrackings" wt
        INNER JOIN "WorkflowActions" wa
            ON wa.id = wt."workflowActionId"
           AND wa."isActive" = TRUE
        GROUP BY wt."rxRecordId"
    `;
}

module.exports = {
    activeRxWorkflowAggregateSql
};
