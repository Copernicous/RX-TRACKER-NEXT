Patient RX System v3.0.0
=========================

Production Release: Dedicated Call Center Workspace And Analytics

This package includes every production improvement through v3.0.0. The main
update in this release is the dedicated restricted Call Center workflow, plus
dashboard metrics, reports, cleanup tools, API restrictions, and automated
smoke/click validation.

Included improvements
---------------------

v3.0.0 - call center workspace and analytics
- Dedicated /call-center workspace for Call Center users.
- Call Center users are redirected away from dashboard and other menus.
- Queue shows only active 90-day eligible patients.
- Queue displays only the limited call-center fields needed for work: name,
  phone, notes, call status/history, and new service date entry.
- Pagination is limited to 5 or 10 rows.
- Calls, repeat calls, Call Center notes, and service-date entries are retained
  with user/date attribution.
- Hard patient claims prevent two Call Center agents from working the same
  patient at the same time.
- Dashboard Call Center Metrics include date ranges, user scope, charts,
  drilldowns, sorting, and CSV export.
- Reports include a Call Center Report with advanced filters, totals, history,
  sorting, CSV export, and Excel export.
- Backoffice includes Call Center cleanup preview/purge for calls, notes,
  service-date event logs, and stale locks.
- Backoffice service-date-history delete repair removes matching stale
  Call Center blockers and returns patients to the available queue when safe.
- The regular sidebar places Call Center below RX Records.
- Sensitive APIs are restricted for Call Center users, including /api/version.

Database impact
---------------

- Startup verification creates/updates the CallCenterLocks table and indexes.
- Startup verification adds PatientNotes.source when missing.
- No destructive schema changes are included.
- No production data reset is included.
- Existing patients, patient notes, RX records, users, roles, permissions,
  settings, backups, audit logs, and changelog data are preserved.

Production verification
-----------------------

After installing this package:

1. Confirm /api/version shows 3.0.0 for an administrator.
2. Confirm /api/version returns 403 for a Call Center user.
3. Login as a Call Center user and confirm it opens /call-center directly.
4. Confirm dashboard URL injection redirects the Call Center user back to
   /call-center.
5. Confirm the queue only shows eligible active patients and page size offers
   only 5 or 10.
6. Mark a patient called more than once and confirm multiple call timestamps
   are retained.
7. Add a Call Center note and confirm author/date/source context appears in
   review/reporting.
8. Enter a new service date and confirm the patient leaves the active queue
   after refresh/login.
9. Confirm Dashboard Call Center Metrics cards, charts, drilldowns, sorting,
   and CSV export.
10. Confirm Reports > Analytics & Export > Call Center Report filters, totals,
    sorting, CSV export, and Excel export.

Production package
------------------

- Deploy dist/server-update-3.0.0.zip or approved dist files only.
- Keep the production .env unchanged and next to server.exe.
