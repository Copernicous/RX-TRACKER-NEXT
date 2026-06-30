# Patient RX - New Server Setup And Recovery Runbook

Use this document when installing Patient RX on a new Windows server or recovering a server from backup.

Keep this file with the release package. Do not store real production passwords in this file.

## 1. Install Required Software

Install PostgreSQL 14 or newer on the new server.

Recommended Windows install:

- Install the PostgreSQL server.
- Install PostgreSQL command-line tools, including `psql.exe`, `pg_dump.exe`, and `pg_restore.exe`.
- Remember the PostgreSQL `postgres` user password.
- Confirm PostgreSQL is running from Windows Services.

Common PostgreSQL tool path:

```powershell
C:\Program Files\PostgreSQL\16\bin
```

If backup restore from the web UI cannot find `pg_dump` or `pg_restore`, add this to `.env`:

```env
PGBIN=C:\Program Files\PostgreSQL\16\bin
```

## 2. Create Production Folders

Create the application and backup folders:

```powershell
New-Item -ItemType Directory -Force -Path "C:\RX-Tracker\RX-APP"
New-Item -ItemType Directory -Force -Path "C:\RX-SiteBackups"
New-Item -ItemType Directory -Force -Path "C:\RX-Tracker\RX-APP\backups"
New-Item -ItemType Directory -Force -Path "C:\RX-Tracker\RX-APP\logs"
New-Item -ItemType Directory -Force -Path "C:\RX-Tracker\RX-APP\uploads"
```

Copy the contents of the release `dist` folder into:

```text
C:\RX-Tracker\RX-APP
```

The folder should include at least:

- `server.exe`
- `.env`
- `.env.example`
- `RX-Manager.bat`
- `OPERATIONS_MANUAL.md`
- `NEW_SERVER_SETUP_RECOVERY.md`
- `CHANGELOG.md`
- `PRODUCTION_RELEASE_CHECKLIST.md`

## 3. Prepare `.env`

Open:

```text
C:\RX-Tracker\RX-APP\.env
```

Use production values similar to this:

```env
PORT=3000
NODE_ENV=production

DB_USER=postgres
DB_PASS=PUT_POSTGRES_PASSWORD_HERE
DB_NAME=patient_rx_dev
DB_HOST=127.0.0.1
DB_PORT=5432

JWT_SECRET=PUT_A_LONG_RANDOM_SECRET_HERE
TZ=America/New_York
APP_ORIGIN=http://SERVER-IP:3000

SITE_BACKUP_DIR=C:\RX-SiteBackups
PGBIN=C:\Program Files\PostgreSQL\16\bin
```

For FortiGate/reverse proxy production access, also set the correct public origin and proxy flags. Example:

```env
APP_ORIGIN=https://rx.camperos.net:10443,http://SERVER-IP:3000
FORCE_HTTPS=true
HTTPS_ALLOW_BACKEND_HTTP=true
HTTPS_ASSUME_PROXY_HTTPS=true
ENABLE_HSTS=false
```

Only enable `ENABLE_HSTS=true` after the public HTTPS URL is final and verified.

## 4. PostgreSQL First-Time Database Setup

Open PowerShell and set the PostgreSQL password for this session:

```powershell
$env:PGPASSWORD = "PUT_POSTGRES_PASSWORD_HERE"
```

Confirm PostgreSQL responds:

```powershell
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -h 127.0.0.1 -d postgres -c "SELECT version();"
```

Create the database if it does not exist:

```powershell
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -h 127.0.0.1 -d postgres -c "CREATE DATABASE patient_rx_dev TEMPLATE template0;"
```

If the database already exists, PostgreSQL will report that it exists. Continue only if this is expected.

Optional: change the PostgreSQL `postgres` password:

```powershell
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -h 127.0.0.1 -d postgres -c "ALTER USER postgres WITH PASSWORD 'PUT_NEW_POSTGRES_PASSWORD_HERE';"
```

After changing it, update `DB_PASS` in `.env`.

## 5. First-Use Admin Creation

For a brand-new empty database, temporarily add this line to `.env`:

```env
ALLOW_DEFAULT_SEED=true
```

Start the server once:

```powershell
cd C:\RX-Tracker\RX-APP
.\server.exe
```

On first run, the app creates the built-in roles and the first admin user only when the `Users` table is empty.

Default first-use login:

```text
Username: admin
Password: admin123
```

Immediately after login:

- Change the `admin` password.
- Remove `ALLOW_DEFAULT_SEED=true` from `.env`.
- Restart `server.exe` or the Windows service.

Important: do not leave `ALLOW_DEFAULT_SEED=true` in production after the first admin is created.

## 6. If Admin Is Missing But Database Has Data

Use this only when the database is not empty and no usable admin account exists.

Run this against the Patient RX database:

```powershell
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -h 127.0.0.1 -d patient_rx_dev
```

Then run:

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;

INSERT INTO "Users"
("firstName", "lastName", "username", "email", "passwordHash", "roleId",
 "isActive", "isMaster", "twoFactorEnabled", "failedLoginCount", "tokenVersion",
 "createdAt", "updatedAt")
SELECT
'System', 'Administrator', 'admin', 'admin@rxsystem.local',
crypt('TempAdmin#2026!', gen_salt('bf', 12)),
r.id,
true, true, false, 0, 0,
NOW(), NOW()
FROM "Roles" r
WHERE r."name" = 'Administrator'
AND NOT EXISTS (
  SELECT 1 FROM "Users" WHERE "username" = 'admin'
);
```

Temporary login:

```text
Username: admin
Password: TempAdmin#2026!
```

Change this password immediately after login.

If the `admin` user already exists but is not a Back Office master admin, grant master access with:

```sql
UPDATE "Users"
SET "isMaster" = true
WHERE "username" = 'admin';
```

## 7. Reset Existing Admin Password

If the `admin` user exists but the password is lost, use the built-in recovery command:

```powershell
cd C:\RX-Tracker\RX-APP
.\server.exe --reset-password admin "NewStrongPasswordHere"
```

This command:

- Hashes the new password.
- Clears failed login count.
- Clears account lockout.
- Exits without starting the server.

It does not create a missing user. It only resets an existing user.

## 8. Restore Database From `.dump`

Use this when restoring a PostgreSQL custom dump backup.

Stop the app or Windows service first.

Set the PostgreSQL password:

```powershell
$env:PGPASSWORD = "PUT_POSTGRES_PASSWORD_HERE"
```

Terminate active database connections:

```powershell
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -h 127.0.0.1 -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='patient_rx_dev';"
```

Drop and recreate the database:

```powershell
& "C:\Program Files\PostgreSQL\16\bin\dropdb.exe" -U postgres -h 127.0.0.1 --if-exists patient_rx_dev
& "C:\Program Files\PostgreSQL\16\bin\createdb.exe" -U postgres -h 127.0.0.1 patient_rx_dev
```

Restore the backup:

```powershell
& "C:\Program Files\PostgreSQL\16\bin\pg_restore.exe" -U postgres -h 127.0.0.1 -d patient_rx_dev --no-owner --no-privileges "C:\RX-Tracker\RX-APP\backups\backup_FILE.dump"
```

Warnings during restore can happen if the dump contains ownership or privilege information. The critical check is whether tables and data are restored and the app starts correctly.

## 9. Restore From Site Backup ZIP

Site backup ZIP files may include a database dump named:

```text
db_backup.dump
```

Recommended method:

```text
Run RX-Manager.bat -> Restore from Site Backup
```

Manual method:

1. Extract `db_backup.dump` from the site backup ZIP.
2. Restore it using the commands in section 8.
3. Copy any needed files from the site backup into `C:\RX-Tracker\RX-APP`.
4. Confirm `.env` has the correct new server values.

## 10. Install Or Start The Windows Service

If using the included service script:

```powershell
cd C:\RX-Tracker\RX-APP
PowerShell -ExecutionPolicy Bypass -File .\install-service.ps1
```

If running manually:

```powershell
cd C:\RX-Tracker\RX-APP
.\server.exe
```

## 11. Verification Checklist

After setup or restore:

- Run `.\server.exe --version` and confirm the expected version.
- Open `http://SERVER-IP:3000/login`.
- Login with the admin account.
- Confirm Dashboard loads.
- Confirm Patients and RX Records load.
- Confirm Backups page loads.
- Run a manual backup from the Backups page.
- Confirm a `.dump` file appears in `C:\RX-Tracker\RX-APP\backups`.
- Confirm site backup folder exists at `C:\RX-SiteBackups`.
- Remove `ALLOW_DEFAULT_SEED=true` from `.env` if it was used.
- Confirm users can login from the expected LAN/FortiGate URL.

## 12. Emergency Notes

- Keep a copy of the latest `server-update-VERSION.zip`.
- Keep at least one recent `.dump` database backup off the server.
- Keep the production `.env` backed up securely, but do not put it in public source control.
- If login breaks after restore, first check `.env`, PostgreSQL connection, `Users.isActive`, and role permissions.
- If Back Office is unavailable for admin, confirm `Users.isMaster=true` for the intended master admin.
