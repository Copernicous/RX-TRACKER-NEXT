Patient RX System v3.0.12
=========================

Production Release: Call Center MicroSIP Dialing Context

This release adds one-click MicroSIP dialing to the Call Center roster and
shows each patient's Clinic / Location and Patient Transport company. The
application sends a normalized number to the workstation's registered
`callto:` handler. Answer and hang-up remain in MicroSIP, and the agent marks
Called and saves manually after the attempt.

Approved direct LAN login cookies now work over HTTP while HTTPS and FortiGate
proxy sessions retain Secure cookies. The release also includes a managed
Chrome policy installer and runbook for suppressing the external-application
confirmation on exact trusted origins.

No proxy, DNS, certificate, firewall, PBX, or database migration is changed by
this release. Existing production records are preserved.

Previous production hardening retained
--------------------------------------

This release hardens authenticated changes, staging destructive operations,
backup/restore processing, and FortiGate proxy compatibility. It also fixes
Call Center CSRF claim/save failures, duplicate login submission, duplicate
Back Office modal/menu markup, and missing Back Office deletion audit details.

PROJECT-CONTROL.bat now uses the same production-safe launcher pattern as NOC,
CORE, and ALARM: PowerShell prerequisite validation, stable working directory,
exact command exit-code propagation, required controller packaging, and
compiled/legacy RX service detection.

The Project Control menu now also uses their standardized framed/versioned
header, colored section headings, aligned choices, confirmations, command
results, and press-any-key return behavior.

No database migration or data reset is required.

v3.0.5 - exact configurable eligibility day
- An 80-day setting becomes eligible on day 80.
- A 90-day setting becomes eligible on day 90.
- Any custom N-day setting becomes eligible on day N.

v3.0.4 - eligibility alignment
- Removes the remaining fixed Call Center eligible-since offset.
- Returns the configured window and cutoff through Call Center APIs.
- Limits Patient eligibility categories to active patients, matching the
  Dashboard and Call Center totals.

v3.0.3 - configurable patient service window
- Adds Backoffice > Settings > Service Window (Days).
- Accepts whole numbers from 1 through 365 and defaults to 90.
- Applies the value to eligibility, locks, workflows, imports, Call Center,
  dashboard metrics, snapshots, service-date cycles, and patient/RX displays.
- Call Center eligible-since dates and new-service-date limits use the same
  configured window and server cutoff.
- Persists and audit-logs setting changes.
- Preserves all existing patient, RX, workflow, and service-date history.

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

1. Confirm /api/version shows 3.0.12 for an administrator.
2. Confirm /api/version returns 403 for a Call Center user.
3. Login as a Call Center user and confirm it opens /call-center directly.
4. Confirm dashboard URL injection redirects the Call Center user back to
   /call-center.
5. Confirm Backoffice Settings shows Service Window (Days), defaulting to 90.
6. Confirm the queue only shows eligible active patients and page size offers
   only 5 or 10.
7. Mark a patient called more than once and confirm multiple call timestamps
   are retained.
8. Add a Call Center note and confirm author/date/source context appears in
   review/reporting.
9. Enter a new service date and confirm the patient leaves the active queue
   after refresh/login.
10. Confirm Dashboard Call Center Metrics cards, charts, drilldowns, sorting,
   and CSV export.
11. Confirm Reports > Analytics & Export > Call Center Report filters, totals,
    sorting, CSV export, and Excel export.
12. Confirm the Call Center roster shows Clinic / Location and Patient
    Transport, including Unassigned when no relationship exists.
13. Click the green phone icon and confirm MicroSIP receives the complete,
    normalized phone number and starts the call when MicroSIP is Online.
14. Answer and hang up in MicroSIP, then mark Called and Save in RX Tracker;
    confirm the call timestamp/history is retained after refresh.
15. On managed Call Center workstations, install the packaged Chrome policy,
    restart Chrome, reload chrome://policy, and confirm
    AutoLaunchProtocolsFromOrigins has status OK.

Security and proxy verification
-------------------------------

1. Through FortiGate, add and update a disposable patient.
2. Claim and save a disposable Call Center patient.
3. Add a disposable RX record.
4. Permanently delete only disposable test data from Back Office and confirm
   the Audit Log retains the table name, record IDs, counts, and cascades.
5. Run PROJECT-CONTROL.bat and confirm the menu opens and command failures
   return a non-zero exit code.

Production package
------------------

- Deploy dist/server-update-3.0.12.zip or approved dist files only.
- Keep the production .env unchanged and next to server.exe.
