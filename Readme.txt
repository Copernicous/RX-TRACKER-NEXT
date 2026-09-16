RX Tracker NEXT 4.0.0-next.90
============================

Automatic Patient ID Hotfix

Manual patient creation now skips every occupied Patient ID instead of failing
after ten candidates. Inactive/deleted patient codes remain reserved. Existing
patients and duplicate review rules are preserved. No new migration is added.
Older versions still apply intervening audited migrations.

Installation
------------
Verify the official ZIP against SHA256SUMS.txt. Use Project Control option 8,
then option 15. For older installations affected by the next.78 recovery incident,
run UPDATE-EXISTING-SERVER.bat from the verified next.90 extraction outside the
application, passing the actual application path and downloaded ZIP path.
The updater preserves .env and the paired application/database rollback set.
Validate the older recovered-host upgrade path before rollout to affected hosts.
See RELEASE_NOTES-v4.0.0-next.90.md and docs/database/COMPILED_RELEASE_UPDATES.md.

Verification
------------
Require a healthy service reporting 4.0.0-next.90. Retry the blocked new-patient
form with Patient ID blank and confirm an unused ID is saved.

Rollback
--------
Use Project Control option 16 for emergency paired application/database rollback.
Preserve the paired rollback set and follow the documented recovery procedure.
