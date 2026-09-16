# RX Tracker NEXT v4.0.0-next.90

Fixes manual patient creation failing with "Could not generate a unique Patient
ID. Please provide one manually." when Patient ID is left blank.

- Automatic allocation now skips every occupied code instead of stopping after
  ten candidates. Imported/manual codes can be ahead of internal database IDs.
- Existing, inactive, and deleted patient codes remain reserved, including case
  variants. Allocation and save retain the existing patient table write lock.
- Explicit Patient IDs and duplicate patient review retain their existing checks.
- Synthetic regression reproduces the old failure with 25 occupied codes and
  verifies successful allocation, subsequent saves, empty databases, explicit
  conflicts, and preservation of existing patients. Manual/import suites pass.

No new migration or existing-patient rewrite. Upgrading from next.89 requires
no schema changes; older versions still apply intervening audited migrations.

## Installation

Use the official checksummed ZIP through Project Control, option 8 then 15.
For older installations affected by the next.78 recovery incident, use
`UPDATE-EXISTING-SERVER.bat` from the verified next.90 extraction outside the
application, passing the actual application path and downloaded ZIP path.
The guarded updater preserves `.env` and the paired application/database rollback
set. Earlier recovered-host upgrade acceptance remains unconfirmed; validate
that older upgrade path before rollout to an affected host.

After installation, require healthy service version 4.0.0-next.90. Retry the
blocked new-patient form with Patient ID blank and confirm an unused ID is saved.
Publication alone does not install the update on a server.
