# RX Tracker NEXT v4.0.0-next.93

Urgent correction for patient address edits reverting to the previous address
when Save is clicked.

- Visible Street, City, State, and ZIP values take priority over the hidden old
  full address. Saving rebuilds the full address from the edited fields.
- Partial updates preserve omitted fields from the current patient record;
  explicitly cleared fields remain cleared.
- Region assignment receives the saved city, allowing a move between regions
  to follow the existing City Region Rules.
- Existing import and historical cleanup parsing are unchanged.

Synthetic regression reproduced the original failure and verifies replacement,
reopening/saving, partial edits, clearing, legacy full-address requests, Region
input, and permission limits. Address parser, import address/tag, duplicate
review, manual creation, and public JavaScript checks pass.

No new migration or automatic patient-data rewrite. Upgrades from next.92
require no schema changes; older versions apply intervening audited migrations.

## Installation

Use the official checksummed ZIP through Project Control, option 8 then 15.
The guarded updater preserves .env and the paired application/database rollback
set. For older installations affected by the next.78 recovery incident, run
UPDATE-EXISTING-SERVER.bat from the verified next.93 extraction outside the
application, passing the actual application path and downloaded ZIP path.
Earlier recovered-host upgrade acceptance remains unconfirmed; validate that
older upgrade path before rollout to an affected host.

Require healthy service version 4.0.0-next.93. Refresh Patients, enter the intended
address in Street, City, State, and ZIP, save, then reopen the patient and verify
all address fields and Region. Previous failed edits must be entered again.
Publication alone does not install the update on a server.
