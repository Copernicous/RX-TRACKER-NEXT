# RX Tracker NEXT v4.0.0-next.91

Fixes the patient Delete button staying disabled after copying and pasting the
confirmation name when the stored name contains extra whitespace.

- Normalize leading, trailing, repeated, and nonbreaking spaces consistently in
  the displayed name and confirmation input.
- Preserve case-sensitive full-name matching and reject different, incomplete,
  and empty names. Opening the dialog requires fresh confirmation.
- Synthetic UI regression reproduces the previous failure and verifies the fix;
  it runs in the PostgreSQL lifecycle CI workflow.

No new migration or existing-patient rewrite. Upgrading from next.90 requires
no schema changes; older versions still apply intervening audited migrations.

## Installation

Use the official checksummed ZIP through Project Control, option 8 then 15.
For older installations affected by the next.78 recovery incident, use
`UPDATE-EXISTING-SERVER.bat` from the verified next.91 extraction outside the
application, passing the actual application path and downloaded ZIP path.
The guarded updater preserves `.env` and the paired application/database rollback
set. Earlier recovered-host upgrade acceptance remains unconfirmed; validate
that older upgrade path before rollout to an affected host.

After installation, require healthy service version 4.0.0-next.91. Refresh the
Patients page, open the affected patient's Delete dialog, and paste the displayed
full name. Confirm Delete becomes enabled, then cancel unless deletion is intended.
Publication alone does not install the update on a server.
