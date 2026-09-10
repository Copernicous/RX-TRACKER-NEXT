# Compiled production updates with Project Control 2.2

The side-by-side 3.3.1-to-NEXT cutover is a one-time conversion. Routine NEXT
updates do not create another database copy and do not repeat the cutover
orchestrator. Administrators use `PROJECT-CONTROL.bat` from the active
`C:\RX-Tracker\RX-APP-NEXT` folder.

## Historical Project Control 2.0 bootstrap

Version `4.0.0-next.4` contains the old source-checkout updater. Version
`4.0.0-next.5` contains a Windows PowerShell release-discovery defect. Perform
this bootstrap when installing `4.0.0-next.6` from either version:

1. Download `server-update-4.0.0-next.6.zip` and `SHA256SUMS.txt` from the
   official GitHub release.
2. Verify the ZIP SHA-256 against `SHA256SUMS.txt` before extracting it.
3. Extract the ZIP into a temporary folder outside `RX-APP-NEXT`.
4. Run `INSTALL-PROJECT-CONTROL.bat` from that temporary folder. The default
   target is `C:\RX-Tracker\RX-APP-NEXT`; a different target can be supplied as
   the first argument.
5. The bootstrap copies only the BAT, its configuration, and its two
   PowerShell helpers. It backs up the previous controls and does not touch the
   service, executables, database, or `.env`.
6. Open `C:\RX-Tracker\RX-APP-NEXT\PROJECT-CONTROL.bat` as Administrator and
   confirm the header shows `Project Control 2.0.0`.

## Corrective next.87 update from older installations

For the repeated next.78-to-next.85/86 recovery incident, use the direct
packaged updater. Verify the official next.87 ZIP against SHA256SUMS.txt, extract
outside the application, and open an Administrator terminal in that folder:

```powershell
.\UPDATE-EXISTING-SERVER.bat "C:\NODE-SERVER\RX-APP-NEXT" "C:\Downloads\server-update-4.0.0-next.87.zip"
```

Adjust both paths to the actual installation and downloaded ZIP. This runs the
new helper directly, without depending on the old installed menu. It prints its
version/path and checks its own hash against the verified package before stopping
the service. A mismatch stops the update. Future releases that change this helper
also require running their packaged launcher (or installing their control helpers
first). The old installed helper cannot enforce this new check by itself.

The Region gap fingerprint now counts only patients eligible for the historical
structured-city migration: nonblank city or blank COALESCE(address,addressLine1).
Addresses without a city that the migration cannot classify do not count toward
the allowed assignment increase. Applied migrations remain unchanged.

Production rollout remains on hold until the recovered test host completes the
update, has a healthy next.87 service, and passes patient/RX/import acceptance.

## Historical bootstrap before next.86

An older installed updater does not receive fixes merely by downloading a new
release. Verify the official next.86 ZIP/checksum and extract outside the active
application. Run `INSTALL-PROJECT-CONTROL.bat` from the extracted folder with the
actual compiled application path as its argument. Close old menus and reopen
Project Control from the active application folder before option 15. This replaces
only the backed-up control files, leaving executables, .env, service and database
untouched. Complete the test-server update before production.

next.86 fixes Windows PowerShell 5.1 manifest array parsing and restores runtime
permissions after database recovery. Older backups omitted ACLs; the updater
reinstates canonical application table/sequence access and keeps the migration
ledger read-only. It verifies runtime database readiness before starting service.

## Normal update

1. Open `PROJECT-CONTROL.bat` as Administrator.
2. Select **8** to check the latest official GitHub release.
3. Select **15 - Install official release ZIP**.
4. Press Enter at the ZIP prompt to download the latest release automatically,
   or paste the full path to an already-downloaded official ZIP.
5. When `.env` uses a restricted database role, enter the database maintenance
   username and password when prompted. The password remains only in the
   running Project Control process and is not saved to `.env` or disk.
6. Confirm the update and wait for the final green health result.

Project Control performs these guarded steps internally:

1. downloads or opens the release ZIP;
2. rejects unsafe/archive-traversal entries and secret/data files;
3. verifies the ZIP, `server.exe`, and `rx-db.exe` against official GitHub
   checksums and verifies the embedded version;
4. verifies the Windows service points to the active application folder;
5. stops the service and creates a validated PostgreSQL custom-format backup;
6. records patient, RX, workflow, user, call, and reference-data fingerprints;
7. applies audited migrations and explicit reference initialization;
8. refuses the release if existing business counts or the configured RX Actions
   change unexpectedly;
9. installs only approved package files while preserving `.env` byte-for-byte;
10. starts the service and requires the exact release version plus a healthy
    database response.

If a step fails during downtime, Project Control attempts to restore both the
pre-update database backup and the previous application files before restarting
the former version.

The first conversion from `DB_USER=postgres` to a restricted runtime account is
a separate, one-time guarded database operation. It must be rehearsed and
verified before changing production `.env`. Once that conversion is complete,
normal future updates remain the usual Project Control flow: option **8**, then
option **15**, supply the maintenance login when prompted, and wait for the
green health result.

## Rollback

Menu option **16** is an emergency release rollback. It restores the pre-update
application and database; records created after the update will no longer be in
the active database. Before doing that, Project Control creates a separate
forward-recovery backup of the current application and database. Type
`ROLLBACK` only during controlled downtime and after notifying users.

## Files and state

- Downloaded packages: `C:\RX-Tracker\updates`
- Database backups: `C:\RX-Tracker\backups`
- Previous application files: `C:\RX-Tracker\release-backups`
- Update state: `C:\RX-Tracker\deployment-state\release-update.json`

Never place `.env` in an update ZIP and never run old and new server executables
against the same database simultaneously.

## Refresh a testing server from a production dump

Project Control option **25** is separate from updates and emergency rollback.
It accepts a PostgreSQL custom-format `.dump`, restores it only into a
separately named database containing `test`, `copy`, `sandbox`, `rehearsal`, or
`scratch`, applies and verifies migrations, configures the existing restricted
runtime role, and optionally points the testing service to that copy.

If the target test database already exists, Project Control first creates and
validates a checksummed backup and then requires the exact
`REPLACE:<database>` confirmation. The active database is never a valid target.
If service activation fails, the prior `.env` and service configuration are
restored automatically. See
[`TEST_COPY_RESTORE.md`](TEST_COPY_RESTORE.md) for the operator procedure.
