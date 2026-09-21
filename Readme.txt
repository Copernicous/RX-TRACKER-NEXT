RX Tracker NEXT 4.0.0-next.92
============================

Backoffice Patient IDs and Status Filters

Backoffice shows the same Patient ID as the Patients list. Deleted and Active
status filters work independently and combine with search. Permanent deletion
review lists selected Patient IDs and names and retains the reviewed internal
IDs. No new migration or automatic patient-data rewrite is included.

Installation
------------
Verify the official ZIP against SHA256SUMS.txt. Use Project Control option 8,
then option 15. For older installations affected by the next.78 recovery incident,
run UPDATE-EXISTING-SERVER.bat from the verified next.92 extraction outside the
application, passing the actual application path and downloaded ZIP path.
The updater preserves .env and the paired application/database rollback set.
Validate the older recovered-host upgrade path before rollout to affected hosts.
See RELEASE_NOTES-v4.0.0-next.92.md and docs/database/COMPILED_RELEASE_UPDATES.md.

Verification
------------
Require healthy service version 4.0.0-next.92. Refresh Backoffice Patients,
compare Patient ID with the Patients list, and try Deleted/Active status filters.
Confirm the deletion review shows the selected Patient ID and name, then cancel
unless permanent deletion is intended.

Rollback
--------
Use Project Control option 16 for emergency paired application/database rollback.
Preserve the paired rollback set and follow the documented recovery procedure.
