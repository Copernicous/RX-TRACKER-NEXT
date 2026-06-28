Patient RX System v2.0.65
=========================

Production Rollup: v2.0.60 through v2.0.65

This package includes every production improvement from v2.0.60 through v2.0.65.
It promotes the tested staging work into production, improves dashboard graphing,
adds safer production graph schema handling, and speeds up RX Records and Reports
with database-level pagination.

Included improvements
---------------------

v2.0.65 - Dashboard analytics and pagination performance
- RX Records now uses database-level pagination for the visible page.
- RX Records patient selector loads in the background so it does not block the table.
- RX Records now supports workflow-stage filtering.
- Patient Report and RX Action Report now use database-level pagination for display.
- CSV/Excel exports still fetch the full filtered result only when export is used.
- Patient Management, RX Records, Patient Report, and RX Action Report default to 10 rows.

v2.0.64 - Production dashboard trend schema fallback
- Dashboard trend graph queries wait for the full DailySnapshots trend schema.
- Production no longer throws when older databases are missing newer trend columns.

v2.0.63 - Production graph fallback stabilization
- Dashboard trend panels show a visible fallback when graph data is empty or not ready.
- Trend cards no longer stay blank without explanation.

v2.0.62 - Production graphing schema guard
- Snapshot capture waits until required DailySnapshots graph columns exist.
- Dashboard graphing shows migration-pending messaging instead of failing silently.

v2.0.61 - Dashboard trends, analytics pagination, and production report prep
- Added dashboard trend metrics for patients, eligibility, no-RX, workflow, and activity.
- Added dashboard trend graph cards with range controls and CSV export.
- Kept Login Activity metrics in backoffice/snapshots, not on the main dashboard.
- Added Backoffice Analytics pagination.
- Fixed Patient Report and RX Action Report row selectors.
- Defaulted Patient Management toward active patients so dashboard totals match by default.
- Preserved staging/development bulk-data tooling for QA only.

v2.0.60 - Dashboard drilldowns and patient filter refinement
- Fixed Dashboard Pending Deliveries full-page link to open RX Records filtered to pending.
- Added RX Records workflow status filtering and sorting.
- Added Patient Management missing-info and relationship filters.
- Fixed Dashboard RX drilldown workflow progress bars for partial workflows.

Database impact
---------------

- No destructive data changes are included.
- Existing patients, RX records, service-date cycles, workflow history, report data,
  and audit records are preserved.
- Run the normal production migration/startup path so DailySnapshots trend columns
  are present.
- Required dashboard trend migration:
  20260628103000-add-dashboard-trend-metrics-to-daily-snapshots.js
- Existing performance indexes cover the promoted paginated query paths.
- Future optional tuning: if production text searches become slow at much larger
  data volume, add stronger functional or trigram indexes for name/search fields.

Production verification
-----------------------

After installing this package:

1. Confirm the sidebar/version badge shows v2.0.65.
2. Confirm Dashboard graphs load and do not stay blank.
3. Confirm Dashboard card links open the expected filtered patient or RX list.
4. Confirm Patients defaults to 10 rows and filters still work.
5. Confirm RX Records defaults to 10 rows, filters work, and workflow-stage filtering works.
6. Confirm Patient Report and RX Action Report open quickly with 10-row pages.
7. Confirm CSV/Excel exports still export the full filtered result.

Known graphing review note
--------------------------

The v2.0.65 graph review found that current totals match production data, but some
historical dashboard trend lines still use database createdAt dates. For imported
records, that can make history spike on the import date instead of following real
service/RX dates. The recommended next correction is to make historical patient/RX
trend lines use patient service dates and RX service/arrival dates.
