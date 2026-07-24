# RX Tracker NEXT portable new-server installer

Use this package for a brand-new Windows server or a disposable test server.
It is not an updater and it does not convert a 3.3.x database. An existing NEXT
server should continue to use **Project Control option 8, then option 15**.

## What the portable ZIP contains

- `server.exe` and `rx-db.exe`
- `INSTALL-NEW-SERVER.bat`
- Project Control and the normal NEXT operations documentation
- The complete static application payload for the packaged version

The ZIP intentionally does **not** contain `.env`, database passwords, SIP
passwords, pairing tokens, patient data, or production backups.

During installation, `INSTALL-NEW-SERVER.bat` creates the real `.env` in the
final application folder. It generates unique values for:

- JWT/session signing
- SIP credential encryption
- RX Softphone relay authentication
- the restricted PostgreSQL runtime-role password
- the RX Softphone account administration PIN

The PostgreSQL maintenance password and first RX Tracker administrator password
are read securely and held only in the installer process. The maintenance
password is not written to `.env`; the final server uses a restricted runtime
database role.

## Prerequisites

1. Windows Server or Windows 10/11 x64.
2. PostgreSQL 14 or later with the command-line tools installed.
3. The PostgreSQL maintenance username and password.
4. An unused TCP port, normally `3000`.
5. A new database name that does not already exist.
6. Administrator rights on Windows.
7. Internet access during installation if NSSM is not already present under
   `C:\RX-Tracker\nssm\win64\nssm.exe`.

Node.js and Git are not required on the destination server.

## Install

1. Copy `RX-Tracker-NEXT-New-Server-<version>.zip` to the new server.
2. Extract it to a temporary folder such as:

   ```text
   C:\Shared\RX-Tracker-NEXT-New-Server
   ```

3. Double-click `INSTALL-NEW-SERVER.bat`.
4. Approve the Administrator prompt.
5. Accept or change:
   - final installation root (`C:\RX-Tracker`);
   - application folder (`RX-APP-NEXT`);
   - server LAN IP/hostname and HTTP port;
   - optional public HTTPS origins;
   - PostgreSQL connection and the new database name;
   - first administrator username and email.
6. Enter the PostgreSQL maintenance password.
7. Enter the first RX Tracker administrator password. It must contain at least
   12 characters.
8. Record the generated RX Softphone administration PIN shown at completion.

The installer refuses to:

- replace an existing database;
- replace an existing `PatientRXSystem` service;
- install into a non-empty application folder;
- package or reuse a pre-existing `.env`;
- continue when schema or restricted-role verification fails.

## What the installer performs

```text
Portable package
       |
       +-- verifies server.exe, rx-db.exe and Project Control payload
       +-- verifies the database name is unused
       +-- copies the application to C:\RX-Tracker\RX-APP-NEXT
       +-- provisions all audited migrations and reference data
       +-- creates the first master Administrator
       +-- creates/verifies a restricted database runtime role
       +-- generates and protects the final .env
       +-- verifies NEXT using the restricted role
       +-- installs/starts PatientRXSystem
       +-- requires a healthy version/database response
```

The non-secret installation receipt is stored at:

```text
C:\RX-Tracker\RX-APP-NEXT\new-server-installation.json
```

## After installation

1. Open the URL printed by the installer.
2. Sign in with the administrator created during setup.
3. Store the first administrator credential in the approved password manager
   and change it if it was shared for acceptance testing.
4. Verify Dashboard, Patients, RX Records, Call Center, Backups, and
   Administration.
5. Configure `APP_ORIGINS` and HTTPS proxy flags in `.env` before using a new
   public hostname not entered during the installer.
6. Keep `.env` unchanged across releases.
7. Use `PROJECT-CONTROL.bat` option 8 to check for an update and option 15 to
   install a verified official NEXT release.

## Command-line validation

An administrator can validate an extracted package without installing
anything:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\Install-NewServer.ps1 `
  -Action ValidatePackage
```

For scripted lab deployments, use `-NonInteractive` and provide the two
passwords through process-scoped environment variables:

```powershell
$env:RX_NEW_SERVER_DB_PASSWORD = '<maintenance password>'
$env:RX_NEW_SERVER_ADMIN_PASSWORD = '<first administrator password>'

.\scripts\Install-NewServer.ps1 `
  -NonInteractive `
  -InstallRoot 'C:\RX-Tracker' `
  -AppFolderName 'RX-APP-NEXT' `
  -ServerAddress '192.168.60.21' `
  -Port 3000 `
  -DatabaseName 'patient_rx_next_test'

Remove-Item Env:RX_NEW_SERVER_DB_PASSWORD
Remove-Item Env:RX_NEW_SERVER_ADMIN_PASSWORD
```

Never place these passwords in a batch file, JSON file, command-line argument,
Git repository, ticket, or chat transcript.

## Retiring an old 3.3.x server

The portable installer does not delete a legacy application or database. Keep
retirement separate from installation so a working rollback remains available.

### Phase 1 — make the old system read-only

1. Confirm the active `PatientRXSystem` service points to
   `C:\RX-Tracker\RX-APP-NEXT\server.exe`.
2. Confirm NEXT health, login, dashboard totals, patient/RX counts, Call Center,
   reports, exports, backups, and RX Softphone operations.
3. Do not start the old `RX-APP\server.exe` again after the final cutover.

The same NSSM service name may have been repointed from 3.3.x to NEXT. Never
delete the `PatientRXSystem` service merely because the old application folder
still exists.

### Phase 2 — preserve one verified rollback set

1. Create a final custom-format PostgreSQL dump of the exact old database with
   `pg_dump.exe`.
2. Calculate its SHA-256 hash.
3. Copy the dump, hash, old release ZIP, and the old `.env` to an encrypted,
   access-controlled backup location.
4. Test that `pg_restore.exe --list` can read the dump.
5. Record the old database name, PostgreSQL version, application version, and
   cutover date.

The archived `.env` contains credentials and must not be placed in Git,
ordinary shared storage, email, or a support ticket.

### Phase 3 — retention period

Keep the old database and app folder offline for at least 30 days, or for the
organization's longer approved retention period. During that time, compare
important NEXT totals and complete normal business use. The old database can
remain present in PostgreSQL as long as no application points to it.

### Phase 4 — controlled deletion

After the retention period:

1. Identify the exact old database name from the archived `.env`.
2. Prove NEXT uses a different database name.
3. Verify the final dump and its SHA-256 hash again.
4. Verify there are no active connections to the old database.
5. Have a second administrator approve the exact database name.
6. Drop only that database.
7. Remove or securely archive only the old `C:\RX-Tracker\RX-APP` folder.

Do not drop the shared PostgreSQL `postgres` maintenance role, PostgreSQL
service, `C:\RX-Tracker\RX-APP-NEXT`, NEXT database, backups, NSSM folder, or
the active `PatientRXSystem` service.

This deletion is intentionally not automated by `INSTALL-NEW-SERVER.bat`.
Database and patient-record destruction must remain a separate, named,
approval-gated operation.
