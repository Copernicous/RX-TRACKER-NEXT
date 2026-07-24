# RX Tracker NEXT 4.0.0-next.17

Release date: 2026-07-23

## RX Records warehouse visibility

- Adds **Warehouse Status** to the RX Records advanced filters.
- Supports **Returned to Warehouse** and **Not Returned** filtering in the
  paginated list, direct API results, and filtered CSV export.
- Replaces the warehouse icon-only marker with a readable
  **Returned to Warehouse** badge.
- Adds warehouse status, return date, and return note to RX Records CSV files.

## Complete Call Center call cleanup

- Backoffice **Calls Only** cleanup now previews and removes both automatic
  `CallCenterCallAttempts` analytics and legacy `Called` audit events.
- Leaving date, user, and patient filters blank selects all call history.
- Cleanup remains transactional and requires the existing master-administrator
  confirmation.
- Patients, RX records, notes, current service dates, service-date history,
  users, phone accounts, pairings, and softphone configuration are not removed
  by **Calls Only**.

## Validation

- Database-backed warehouse filter and cleanup regressions passed.
- The isolated browser test verified both filter modes, the readable badge,
  and filtered CSV download.
- The complete staging API, security, import, reporting, Call Center, and
  browser smoke suite passed.
- Development executable builds passed.

## Database impact

None. This release uses existing tables and fields and adds no migration,
table, column, index, or constraint.

