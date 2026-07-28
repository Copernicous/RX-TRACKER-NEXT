# RX Workflow Pipeline Current Stage parity

## Decision

Starting with `4.0.0-next.35`, each Dashboard **RX Workflow Pipeline** action
row means **Current Stage**: the highest active workflow action completed for
that RX record. This is the same definition used by the primary **Current
Stage** filter in RX Records and by RX Reports.

Starting with the `4.0.0-next.36` candidate, the summary cards independently
represent the same mutually exclusive **Workflow Status** groups used by RX
Records: Not Started, In Progress, Expired, and Completed. Current Stage remains
separate and is never replaced by Next Action Required.

## What is counted

- Counts are per RX record, not per unique patient. If one patient has two RX
  records, each visible RX contributes once.
- Patient names, notes, addresses, and other stored patient/business data are
  neither changed nor displayed by this graph calculation.
- Soft-deleted RX records are excluded, matching the default RX Records view.
- **Not Started** means no active workflow action has been completed and the RX
  is not expired.
- **In Progress** means at least one, but not every, distinct active action has
  been completed and the RX is not expired.
- **Expired** means the RX is incomplete and its service window has passed. It
  may have zero or several completed workflow actions.
- **Completed** means every distinct active action has been completed and takes
  precedence over the service-window date.
- With no active workflow definitions, RX records fail closed as Not Started
  and All Incomplete; they are not reported as expired or completed.
- An expired RX with progress remains in its actual Current Stage bar. An
  expired RX with no completed step has no Current Stage row.
- A completed RX remains in the final Current Stage bar and in the top
  Completed summary card. There is no second Completed row below the bars.

The endpoint reads the current RX and tracking rows whenever the widget is
refreshed, so changes made through a patient's RX workflow are reflected in the
next graph refresh. On the all-time Dashboard, Total RX and Pending are then
rendered from that same live response, enforcing:

```text
Total RX = Not Started + In Progress + Expired + Completed
All Incomplete = Not Started + In Progress + Expired
Operational Pending = Not Started + In Progress
```

The Dashboard Pending card and Pending graph open the explicit **All
Incomplete** RX Records filter. They include expired incomplete cycles. The
regular **Pending** workflow status remains the narrower operational view that
excludes records shown under **Expired**.

## History safeguards

Dashboard, RX Records, RX Reports, Patient RX History, Patient Timeline, and
Patient Needs Action status share these rules:

1. Count distinct workflow action IDs so duplicate history rows cannot advance
   an RX or mark it completed.
2. Join only active workflow definitions for live progress and Current Stage.
3. Ignore retired or orphaned actions for current state while preserving their
   underlying audit/history rows.
4. Use the highest active sequence number as Current Stage, including for a
   non-contiguous history.
5. Apply the same distinct-active rule to current snapshots and to newly
   materialized historical days; existing stored history rows are not rewritten.

Configured active workflow actions are expected to have unique sequence
numbers. This was already an application configuration assumption; `next.35`
does not add or change workflow definitions.

## Staging comparison

The pre-fix graph and the RX Records Current Stage filter were compared on an
isolated 12,000-RX staging dataset. This table contains aggregate test counts
only and no patient information.

| Active stage sequence | Old graph row | RX Current Stage filter | Corrected graph row |
|---:|---:|---:|---:|
| 1 | 0 | 2,161 | 2,161 |
| 2 | 2,161 | 60 | 60 |
| 3 | 60 | 58 | 58 |
| 4 | 58 | 62 | 62 |
| 5 | 62 | 63 | 63 |
| 6 | 63 | 8,067 | 8,067 |

The old values were shifted because they represented the next action. After
the correction, all six graph rows equal the filter for the same sequence.
The original `next.35` comparison recorded structural started/incomplete totals
before Expired became a separate summary card. The `next.36` production-shaped
comparison uses the four-way status contract:

```text
1,771 Total RX = 2 Not Started + 156 In Progress + 2 Expired + 1,611 Completed
160 All Incomplete = 2 Not Started + 156 In Progress + 2 Expired
158 Operational Pending = 2 Not Started + 156 In Progress
```

Warm staging measurements at 51,420 tracking rows were approximately 28 ms
median for the pipeline and 47–53 ms for paginated Current Stage filters. No
new index or materialized data is required at this scale.

## Regression and operator check

Automated coverage (use a disposable database for the mutating pipeline fixture):

```powershell
$env:RX_PIPELINE_FILTER_TEST_DB_NAME = 'rx_next_regression_test'
$env:RX_PIPELINE_FILTER_TEST_CONFIRM_DB_NAME = 'rx_next_regression_test'
$env:DASHBOARD_ANALYTICS_TEST_DB_NAME = 'rx_next_regression_test'
$env:DASHBOARD_ANALYTICS_TEST_CONFIRM_DB_NAME = 'rx_next_regression_test'
npm run test:rx-pipeline-filter-parity
npm run test:dashboard-analytics
npm run test:report-filter-parity
npm run test:i18n-branding
npm run check:public-js
```

Each mutating regression requires an exact matching confirmation variable.
Production database names are refused even if a confirmation variable is supplied.

For a manual staging check:

1. Refresh the Dashboard pipeline.
2. Note a graph row's action name and count.
3. Open RX Records and choose the same action under **Current Stage**.
4. Run the search and compare the total. The two values must match.
5. Repeat for the first, an intermediate, and the final action.
6. Confirm **Total RX = Not Started + In Progress + Expired + Completed**.
7. Confirm **All Incomplete = Not Started + In Progress + Expired** and the
   Dashboard Pending card and charts use that value.
8. Open each summary card and confirm RX Records selects the corresponding
   Workflow Status with the same total.
9. Confirm expired RX with completed steps remain in their actual Current Stage
   row, while an expired RX with no completed step has no Current Stage.

Do not compare these rows with **Next Action Required**. That advanced filter
answers a different operational question: what action must happen next.

## Scope and deployment

This is a query/UI correction only. It adds no migration and rewrites no
patient or workflow data. It does not change proxy routes, origins, ports,
sessions, authentication, PBX integration, or RX Softphone.

Promote through `staging` and then `develop` only after validation. Production
requires a separately approved immutable `v4.0.0-next.36` release; never modify
the existing `v4.0.0-next.35` release.
