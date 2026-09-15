RX Tracker NEXT 4.0.0-next.89
============================

Patient Import ID Correction

Blank Patient IDs remain blank during import comparison. New patients receive
unused IDs when saved; merges retain the existing patient ID. Supplied IDs,
name/DOB, phone, and address still participate in duplicate checks.

This patch adds no migration or existing-patient rewrite. Updates from older
versions still apply intervening audited migrations.

Installation
------------
Verify the official ZIP against SHA256SUMS.txt. Use Project Control option 8,
then option 15. For older installations affected by the next.78 recovery incident,
run UPDATE-EXISTING-SERVER.bat from the verified next.89 extraction outside the
application, passing the actual application path and downloaded ZIP path.
The updater preserves .env and the paired application/database rollback set.
See RELEASE_NOTES-v4.0.0-next.89.md and docs/database/COMPILED_RELEASE_UPDATES.md.

The prior recovered test-host upgrade and patient/RX/import acceptance remain
unconfirmed. Complete acceptance before production rollout. Publication does
not install the package or clear the existing rollout hold.

Verification
------------
Require a healthy service reporting 4.0.0-next.89, no pending migrations, and a
verified migration checksum ledger. Preview a synthetic CSV with blank IDs and
confirm only genuine matches appear. Check new-patient IDs, merge preservation,
and the saved Import History report.

Rollback
--------
Use Project Control option 16 for emergency paired application/database rollback.
Preserve the paired rollback set and follow the documented recovery procedure.
