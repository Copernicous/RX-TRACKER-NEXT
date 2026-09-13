# RX Tracker NEXT v4.0.0-next.88

Fixes Patients **Status** sorting when deleted patients retain their Active flag.

- Ascending: Inactive, Active, Deleted (deleted patients at the bottom).
- Descending: Deleted, Active, Inactive (deleted patients at the top).
- Applies before server pagination and to the browser fallback.
- Includes PostgreSQL pagination regression coverage and synthetic SQL/client checks.

No new migration or patient-data change is introduced by this patch. Upgrades from
older versions still apply their intervening audited migrations.

## Installation and acceptance

Use the official checksummed ZIP through Project Control. When updating an older
installation affected by the next.78 recovery incident, use the packaged
`UPDATE-EXISTING-SERVER.bat` from the verified next.88 extraction outside the active
application, with the actual application path and downloaded next.88 ZIP path.
The guarded updater preserves `.env` and the paired application/database rollback set.

The prior recovered test-host upgrade and patient/RX/import acceptance are still
unconfirmed. Complete that acceptance before production rollout; this publication
does not install the release or clear the existing rollout hold.

After installation, include deleted patients in Patients and click **Status** in
both directions. Confirm deleted patients move to the bottom/top of the complete
filtered list, including when results span multiple pages.
