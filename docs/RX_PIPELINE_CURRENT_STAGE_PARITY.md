# RX Workflow Pipeline Current Stage parity

## Decision

Starting with the `4.0.0-next.35` staging candidate, each Dashboard **RX
Workflow Pipeline** action row means **Current Stage**: the highest active
workflow action completed for that RX record.

This is the same definition used by the primary **Current Stage** filter in RX
Records and by RX Reports. The graph no longer uses raw tracking-row counts as
an offset to the next action.

## What is counted

- Counts are per RX record, not per unique patient. If one patient has two RX
  records, each visible RX contributes once.
- Patient names, notes, addresses, and other stored patient/business data are
  neither changed nor displayed by this graph calculation.
- Soft-deleted RX records are excluded, matching the default RX Records view.
- **Not Started** means no active workflow action has been completed.
- **In Progress** means at least one, but not every, distinct active action has
  been completed.
- **Completed** means every distinct active action has been completed.
- A completed RX remains in the final Current Stage bar and in the top
  Completed summary card. There is no second Completed row below the bars.

The endpoint reads the current RX and tracking rows whenever the widget is
refreshed, so changes made through a patient's RX workflow are reflected in the
next graph refresh.

## History safeguards

Dashboard, RX Records, and RX Reports share one aggregate with these rules:

1. Count distinct workflow action IDs so duplicate history rows cannot advance
   an RX or mark it completed.
2. Join only active workflow definitions for live progress and Current Stage.
3. Ignore retired or orphaned actions for current state while preserving their
   underlying audit/history rows.
4. Use the highest active sequence number as Current Stage, including for a
   non-contiguous history.

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
The summary remained internally reconciled:

```text
12,000 total = 1,529 Not Started + 2,404 In Progress + 8,067 Completed
```

Warm staging measurements at 51,420 tracking rows were approximately 28 ms
median for the pipeline and 47–53 ms for paginated Current Stage filters. No
new index or materialized data is required at this scale.

## Regression and operator check

Automated coverage:

```powershell
npm run test:rx-pipeline-filter-parity
npm run test:dashboard-analytics
npm run test:report-filter-parity
npm run test:i18n-branding
npm run check:public-js
```

For a manual staging check:

1. Refresh the Dashboard pipeline.
2. Note a graph row's action name and count.
3. Open RX Records and choose the same action under **Current Stage**.
4. Run the search and compare the total. The two values must match.
5. Repeat for the first, an intermediate, and the final action.

Do not compare these rows with **Next Action Required**. That advanced filter
answers a different operational question: what action must happen next.

## Scope and deployment

This is a query/UI correction only. It adds no migration and rewrites no
patient or workflow data. It does not change proxy routes, origins, ports,
sessions, authentication, PBX integration, or RX Softphone.

Promote through `staging` and then `develop` only after validation. Production
requires a separately approved immutable official release; never modify the
existing `v4.0.0-next.34` release.
