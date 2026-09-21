# RX Tracker NEXT v4.0.0-next.92

Backoffice Patients now shows the same Patient ID as the Patients list and
supports precise status filtering before reviewing permanent deletion.

- Patient ID is the first data column and stays visible. Internal Database ID
  remains available as a separately labeled, initially hidden column.
- Deleted status: All / Not deleted / Deleted. Active status: All / Active /
  Inactive. Both filters combine with text search and check only their own flag.
  Select Not deleted + Inactive to find inactive patients that are not deleted.
- Changing a status filter or reopening the viewer clears deletion selection.
- Permanent deletion confirmation lists every selected Patient ID and full name.
  The request retains the exact reviewed internal IDs; displayed patient codes
  never replace database relationship keys.
- Delete remains disabled until impact analysis succeeds. Cancellation ignores
  late responses, and failed requests require a fresh impact review.

Synthetic client/API tests, existing permanent-delete controller regressions,
Chromium checks using actual viewer/modal markup, and JavaScript validation pass.
No real records were deleted during validation.

No new migration or automatic patient-data rewrite. Upgrading from next.91 needs
no schema changes; older versions still apply intervening audited migrations.
Existing server authorization, deletion transactions, cascading behavior, and
audit recording are unchanged. Backoffice deletion remains permanent.

## Installation

Use the official checksummed ZIP through Project Control, option 8 then 15.
For older installations affected by the next.78 recovery incident, use
`UPDATE-EXISTING-SERVER.bat` from the verified next.92 extraction outside the
application, passing the actual application path and downloaded ZIP path.
The guarded updater preserves `.env` and the paired application/database rollback
set. Earlier recovered-host upgrade acceptance remains unconfirmed; validate
that older upgrade path before rollout to an affected host.

Require healthy service version 4.0.0-next.92. Refresh Backoffice, open Patients,
and compare Patient ID with the Patients list. Verify Deleted and Active filters,
select a patient, and confirm the review shows the matching Patient ID and name.
Cancel the review unless permanent deletion is intended.
Publication alone does not install the update on a server.
