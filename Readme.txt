RX Tracker NEXT 4.0.0-next.3
============================

Database Lifecycle Preview

RX Tracker NEXT begins with the tested RX Tracker 3.3.1 web interface and
feature set. RX Softphone is unchanged. NEXT replaces database creation,
sequelize.sync(), startup ALTER TABLE statements, startup backfills, reference
seeding, and default-administrator creation with explicit rx-db commands.

This package is for isolated development, sanitized-data testing, and database
rehearsals. Do not replace the frozen production 3.3.1 application until every
gate in docs/database/CUTOVER_AND_ROLLBACK.md passes.

Package contents
----------------

- server.exe: web application; validates schema and migration state at startup
- rx-db.exe: explicit create, migrate, verify, adopt, restore, sanitize, and
  comparison lifecycle tool
- docs/database/: operations, rehearsal, sanitization, cutover, and rollback
  runbooks
- scripts/Invoke-NextProduction.ps1: guarded Windows preflight, rehearsal,
  local test, cutover, and rollback orchestrator

First verification
------------------

1. Preserve/create .env beside both executables. Never take .env from the ZIP.
2. Run: rx-db.exe status
3. Run: rx-db.exe verify
4. Require READY, 34 applied migrations, 0 pending migrations, and a verified
   checksum ledger.
5. Run: server.exe --v
6. Require version 4.0.0-next.3.

Windows production workflow
---------------------------

Keep 3.3.1 in C:\RX-Tracker\RX-APP and extract NEXT to
C:\RX-Tracker\RX-APP-NEXT. Then run the packaged orchestrator from an
Administrator PowerShell terminal. Start with `-Action Preflight`; it does not
change a database or service. Follow docs/database/CUTOVER_AND_ROLLBACK.md for
the exact guarded commands.

Fresh databases and imported 3.3.1 copies have different procedures. Follow
docs/database/NEXT_DATABASE_OPERATIONS.md exactly. Never adopt, restore, or
sanitize the live production database.

Rollback
--------

Keep the exact 3.3.1 package and a verified pre-cutover database backup. The
supported rollback restores both; an application-only rollback is not the
approved recovery procedure.
