RX Tracker NEXT 4.0.0-next.79
============================

Structured Address and Region Cleanup Release

This server package is an approved routine update for an existing RX Tracker
NEXT installation. Project Control must preserve the installed production .env
and verify the official release checksums before replacing application files.

Package contents
----------------

- server.exe: web application; validates schema and migration state at startup
- rx-db.exe: explicit create, migrate, verify, adopt, restore, sanitize, and
  comparison lifecycle tool
- PROJECT-CONTROL.bat / scripts/Invoke-ReleaseUpdate.ps1: routine official-ZIP
  updates with database backup, business-data fingerprints, .env preservation,
  health validation, and automatic paired recovery
- scripts/Invoke-TestCopyRestore.ps1: guided option 25 for validating and
  restoring a production dump into an isolated testing database
- docs/database/: operations, rehearsal, sanitization, cutover, test-copy
  restore, compiled update, and rollback runbooks

Release highlights
------------------

- Adds City: None for patients without a usable address.
- Adds structured patient address fields: Address / Street, City, State, ZIP.
- Keeps the original full Address field intact for reference and compatibility.
- Adds address filters and autocomplete to Patients, RX Records, Patient
  Reports, RX Action Reports, imports, and complete-history exports.
- Cleans structured City/State/ZIP values using ZIP-confirmed references.
- Improves import parsing for blank structured columns, disordered ZIP/city
  text, malformed ZIP digits, and city/state endings without ZIP.
- Reassigns the regional Miami/Tampa/None tag from structured City using the
  approved Tampa-region city list; ambiguous rows remain manual.
- Keeps Patient Tags as manual/business markers once assigned; the structured
  City filter is address-based and is not forced to match manual City tags.

First verification
------------------

1. Preserve/create .env beside both executables. Never take .env from the ZIP.
2. Run: rx-db.exe status
3. Run: rx-db.exe verify
4. Require READY, 59 applied migrations, 0 pending migrations, and a verified
   checksum ledger.
5. Run: server.exe --v
6. Require version 4.0.0-next.79.

Windows production workflow
---------------------------

Open C:\RX-Tracker\RX-APP-NEXT\PROJECT-CONTROL.bat as Administrator. Use option
8 to check the release and option 15 to download, verify, back up, and install
it. See docs/database/COMPILED_RELEASE_UPDATES.md. Do not repeat the one-time
3.3.1-to-NEXT cutover orchestrator for routine NEXT releases.

On a testing server, option 25 can restore a verified custom-format dump into
a separately named test-copy database. It never restores over the currently
configured database. See docs/database/TEST_COPY_RESTORE.md.

Rollback
--------

Use Project Control option 16 for an emergency paired application/database
rollback. Keep the frozen 3.3.1 fallback and verified historical backup until
the separately approved retirement checkpoint.
