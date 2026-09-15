# RX Tracker NEXT v4.0.0-next.89

Fixes false patient matches when importing a CSV without Patient IDs.

- Blank IDs remain blank during comparison, so generated codes cannot match
  unrelated patients. Name/DOB, phone, and address comparisons still apply.
- New patients receive unused IDs during the locked final save, avoiding
  existing IDs and IDs supplied elsewhere in the CSV.
- Merges retain the existing patient's ID. Explicit supplied ID collisions
  still require merge or discard.
- Synthetic regressions cover false matches, multiple blank IDs, explicit ID
  conflicts, and a code taken by another save after preview.

No new migration or existing-patient rewrite is introduced. Upgrades from older
versions still apply their intervening audited migrations.

## Installation and acceptance

Use the official checksummed ZIP through Project Control. For older installations
affected by the next.78 recovery incident, run `UPDATE-EXISTING-SERVER.bat` from
the verified next.89 extraction outside the application, passing the actual
application path and downloaded next.89 ZIP path. The guarded updater preserves
`.env` and the paired application/database rollback set.

The prior recovered test-host upgrade and patient/RX/import acceptance remain
unconfirmed. Complete that acceptance before production rollout; publishing this
package does not install it or clear the existing rollout hold.

After installation, preview a synthetic CSV with blank IDs: only genuine matches
should appear. Confirm a new patient receives an unused ID, a merge preserves
the existing ID, and Import History shows the final saved IDs.
