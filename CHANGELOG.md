# Changelog — Patient RX System

All notable changes to this project are documented here.
Format: [VERSION] YYYY-MM-DD — summary of changes.

---

## [1.1.0] — 2026-06-23

### 🚀 New Features
- **GUI Database Restore** — Upload any `.dump` file from the Backups page to restore the database from another server. Includes typed `RESTORE` confirmation guard, live progress bar, and terminal log output.
- **Auto-create database on first boot** — `server.exe` now automatically creates the `patient_rx_dev` database if it does not exist. No manual psql/pgAdmin steps needed on a fresh machine.
- **Auto-seed on fresh database** — On first boot with an empty database, the 4 built-in roles and default admin account (`admin / admin123`) are created automatically.
- **BAT option 19 — Restore from Site Backup ZIP** — Extracts `db_backup.dump` from inside a Site Backup ZIP and restores the database. Only restores database (preserves current app code).
- **Version badge in sidebar** — App version displayed at the bottom of the sidebar on all pages.
- **`/api/version` endpoint** — Returns current app version, build date, and Node.js version as JSON.

### ⚡ Performance
- **27 database indexes added** — Covers the full Patient → RXRecord query chain:
  - `Patients`: `isDeleted`, `lastName+firstName`, `clinicId`, `pharmacyId`, transport FKs, `isActive`
  - `RXRecords`: `patientId`, `isDeleted`, `patientId+isDeleted` (composite), `arrivalDate`, `serviceDate`, pharmacy/transport FKs, `returnedToWarehouse`
  - `Medications`: `rxRecordId`
  - `RXWorkflowTrackings`: `rxRecordId`, `workflowActionId`
  - `RXHistories`: `rxRecordId`
  - `Users`: `username` (UNIQUE), `roleId`, `isActive`
  - `AuditLogs`: `userId`, `createdAt`
  - `ErrorLogs`: `resolved`

### 🐛 Bug Fixes
- **RX Records delete not working** — Fixed soft-delete logic in the RX records controller.
- **`server.exe` crash: `Cannot mkdir in a snapshot`** — Refactored `backupService.js` to use lazy directory creation (never at module load time inside the pkg snapshot).
- **`server.exe` crash: `process.execDir` undefined** — Replaced with `path.dirname(process.execPath)` for correct host filesystem path resolution.
- **`server.exe` crash: bcrypt native binary** — Replaced `bcrypt` (C++ native addon, incompatible with pkg) with `bcryptjs` (pure JavaScript, identical API).
- **`server.exe` crash: dynamic model loading** — Replaced `readdirSync` glob in `models/index.js` with explicit static `require()` calls so pkg bundles all model files.
- **`server.exe` crash: `SequelizeConnectionError` database does not exist** — Added `ensureDatabase()` step that auto-creates the database before Sequelize initializes.
- **GUI Restore: `pg_restore ENOENT`** — Added `findPgTool()` helper that auto-locates `pg_restore`/`pg_dump` by scanning common PostgreSQL installation directories (`C:\Program Files\PostgreSQL\*\bin\`). Falls back to `PGBIN` env var.
- **GUI Restore: FK cascade errors (34 errors)** — Replaced `--clean` strategy with drop+recreate: terminates all connections, drops the database entirely, creates it fresh, then restores. Eliminates all foreign-key constraint ordering issues.

### 🔧 Infrastructure
- `pg` client used for database management (`ensureDatabase`, restore drop/recreate)
- `multer` file upload middleware added for restore endpoint (`.dump` only, 500 MB cap)
- Temp upload files stored in `backups/uploads/` (writable path outside pkg snapshot)
- Auto-cleanup of temp files after restore completes

---

## [1.0.0] — 2026-06-19

### 🚀 Initial Release
- Patient management (create, edit, soft-delete, restore)
- RX Records management with workflow tracking
- Role-based access control (Administrator, Supervisor, Operator, Read Only)
- Pharmacy, Clinic, Transport Company reference data
- Medication catalog
- Audit logging on all write operations
- Automated database backups (pg_dump, scheduled via cron)
- Full Site Backup (ZIP containing code + database dump)
- Two-factor authentication (TOTP)
- User management with account locking
- Reports and analytics
- Data import (CSV/Excel)
- System settings (timezone, SMTP, etc.)
- Dark mode support
- RX-Manager.bat for server/database management
- Portable server.exe build via @yao-pkg/pkg
