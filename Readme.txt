RX Tracker NEXT 4.0.0-next.93
============================

Patient Address Save Hotfix

Fixes address edits reverting to the old address on save. Street, City, State,
and ZIP now take priority over the hidden previous full address. Region uses
the saved city. No new migration or automatic patient-data rewrite.

Installation
------------
Verify the official ZIP against SHA256SUMS.txt. Use Project Control option 8,
then option 15. The updater preserves .env and the paired rollback set.
For older installations affected by the next.78 recovery incident, follow
RELEASE_NOTES-v4.0.0-next.93.md and docs/database/COMPILED_RELEASE_UPDATES.md.

Verification
------------
Require healthy service version 4.0.0-next.93. Refresh Patients, re-enter the
intended Street, City, State, and ZIP, save, and reopen to verify address and
Region. Previously failed edits must be entered again.

Rollback
--------
Use Project Control option 16 for emergency paired application/database rollback.
Preserve the paired rollback set and follow the documented recovery procedure.
