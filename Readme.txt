RX Tracker NEXT 4.0.0-next.9
============================

Database Security and Lifecycle Release

RX Tracker NEXT began with the tested RX Tracker 3.3.1 web interface and
feature set. NEXT replaces database creation,
sequelize.sync(), startup ALTER TABLE statements, startup backfills, reference
seeding, and default-administrator creation with explicit rx-db commands.
RX Softphone 0.4.3 source is preserved in NEXT and its Windows ZIP is published
as a separate checksummed workstation asset.

This server package is an approved routine update for an existing NEXT
installation. Project Control must preserve the installed production .env and
verify the official release checksums before replacing application files.

Package contents
----------------

- server.exe: web application; validates schema and migration state at startup
- rx-db.exe: explicit create, migrate, verify, adopt, restore, sanitize, and
  comparison lifecycle tool
- docs/database/: operations, rehearsal, sanitization, cutover, and rollback
  runbooks
- scripts/Invoke-NextProduction.ps1: guarded Windows preflight, rehearsal,
  local test, cutover, and rollback orchestrator
- PROJECT-CONTROL.bat / scripts/Invoke-ReleaseUpdate.ps1: routine official-ZIP
  updates with database backup, business-data fingerprints, .env preservation,
  health validation, and automatic paired recovery
- INSTALL-PROJECT-CONTROL.bat: Project Control bootstrap or repair helper

The separate RxSoftphone-0.4.3-win-x64.zip is installed only on managed calling
workstations. It is not embedded in this server ZIP.

First verification
------------------

1. Preserve/create .env beside both executables. Never take .env from the ZIP.
2. Run: rx-db.exe status
3. Run: rx-db.exe verify
4. Require READY, 35 applied migrations, 0 pending migrations, and a verified
   checksum ledger.
5. Run: server.exe --v
6. Require version 4.0.0-next.9.

Windows production workflow
---------------------------

Open C:\RX-Tracker\RX-APP-NEXT\PROJECT-CONTROL.bat as Administrator. Use option
8 to check the release and option 15 to download, verify, back up, and install
it. See docs/database/COMPILED_RELEASE_UPDATES.md. Do not repeat the one-time
3.3.1-to-NEXT cutover orchestrator for routine NEXT releases.

Fresh databases and imported 3.3.1 copies have different procedures. Follow
docs/database/NEXT_DATABASE_OPERATIONS.md exactly. Never adopt, restore, or
sanitize the live production database.

Rollback
--------

Use Project Control option 16 for an emergency paired application/database
rollback. Keep the frozen 3.3.1 fallback and verified historical backup until
the separately approved retirement checkpoint.
