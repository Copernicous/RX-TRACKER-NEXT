# Changelog — Patient RX System

All notable changes are documented here with file-level detail and git commit references.
Format follows [Keep a Changelog](https://keepachangelog.com).

---

## [1.1.0] — 2026-06-23

### 🐛 Bug Fixes (post-release)

#### Fix: Changelog page stuck on "Loading…" in production
**Commit:** `7e9f659` | **Files changed:** 2 | **Lines:** +70 / -1
- `public/assets/marked.min.js` (new, 39 KB) — bundled locally
- `views/changelog.ejs` line 12 — changed `src` from `https://cdn.jsdelivr.net/npm/marked/marked.min.js` to `/assets/marked.min.js`
- **Root cause:** production server CSP header `script-src 'self' 'unsafe-inline'` blocked the external CDN URL. Page loaded but `marked` was undefined so JS crashed silently and content stayed on the spinner.

### 🚀 New Features

#### GUI Database Restore from `.dump` file
**Commit:** `5675c68` | **Files changed:** 4 | **Lines:** +279
- `routes/apiRoutes.js` +45 lines — `POST /api/backups/restore` with multer upload (`.dump` only, 500 MB cap), admin-only, temp file cleanup
- `services/backupService.js` +58 lines — `restoreBackup()` function, auto-safety-backup before restore
- `views/backups.ejs` +158 lines — "Restore Database from Backup" card: file picker, typed `RESTORE` confirmation, XHR progress bar, terminal log output, success/failure badge

#### Auto-create database on first boot
**Commit:** `d6ef75c` | **Files changed:** 1 | **Lines:** +36
- `app.js` +36 lines — `ensureDatabase()` connects to `postgres` default DB, checks `pg_database` catalog, runs `CREATE DATABASE TEMPLATE template0` if missing

#### Auto-seed Roles + admin user on fresh database
**Commit:** `272d56b` | **Files changed:** 1 | **Lines:** +47
- `app.js` +47 lines — after `db.sequelize.sync()`, `findOrCreate` all 4 built-in roles, then creates `admin / admin123` if Users table is empty; prints credential banner in console

#### BAT option 19 — Restore from Site Backup ZIP
**Commit:** `44c19e3` | **Files changed:** 1 | **Lines:** +155
- `RX-Manager.bat` +155 lines — scans `SITE_BACKUP_DIR` for `*.zip`, validates `db_backup.dump` inside ZIP, extracts via PowerShell `System.IO.Compression`, stop→drop→recreate→pg_restore→start flow

#### Version badge + Changelog page
**Commit:** `17fc76b` | **Files changed:** 6 | **Lines:** +271
- `CHANGELOG.md` +65 lines — this file (initial version)
- `package.json` +1 line — version bumped `1.0.0` → `1.1.0`
- `routes/apiRoutes.js` +13 lines — `GET /api/version` (public) returns `{ version, node, uptime, buildDate }`
- `routes/webRoutes.js` +13 lines — `GET /changelog` reads `CHANGELOG.md`, renders via EJS
- `views/changelog.ejs` +149 lines — changelog page with version card, uptime, marked.js markdown render
- `views/partials/sidebar.ejs` +30 lines — version badge at sidebar bottom, `Changelog` link

### ⚡ Performance

#### 27 database indexes — Patient → RXRecord query chain
**Commit:** `78239a2` | **Files changed:** 1 | **Lines:** +183
- `migrations/20260623114800-add-performance-indexes.js` +183 lines

  | Table | Index | Type |
  |---|---|---|
  | `Patients` | `isDeleted` | INDEX |
  | `Patients` | `lastName, firstName` | COMPOSITE |
  | `Patients` | `clinicId` | INDEX |
  | `Patients` | `pharmacyId` | INDEX |
  | `Patients` | `patientTransportCompanyId` | INDEX |
  | `Patients` | `pharmacyTransportCompanyId` | INDEX |
  | `Patients` | `isActive` | INDEX |
  | `RXRecords` | `patientId` | INDEX |
  | `RXRecords` | `isDeleted` | INDEX |
  | `RXRecords` | `patientId + isDeleted` | COMPOSITE |
  | `RXRecords` | `arrivalDate` | INDEX |
  | `RXRecords` | `serviceDate` | INDEX |
  | `RXRecords` | `pharmacyId` | INDEX |
  | `RXRecords` | `patientTransportCompanyId` | INDEX |
  | `RXRecords` | `pharmacyTransportCompanyId` | INDEX |
  | `RXRecords` | `returnedToWarehouse` | INDEX |
  | `Medications` | `rxRecordId` | INDEX |
  | `RXWorkflowTrackings` | `rxRecordId` | INDEX |
  | `RXWorkflowTrackings` | `workflowActionId` | INDEX |
  | `RXHistories` | `rxRecordId` | INDEX |
  | `Users` | `username` | UNIQUE INDEX |
  | `Users` | `roleId` | INDEX |
  | `Users` | `isActive` | INDEX |
  | `PatientNotes` | `patientId` | INDEX |
  | `AuditLogs` | `userId` | INDEX |
  | `AuditLogs` | `createdAt` | INDEX |
  | `ErrorLogs` | `resolved` | INDEX |

### 🐛 Bug Fixes

#### Fix: `server.exe` — pg_restore/pg_dump ENOENT (not in PATH)
**Commit:** `37c371e` | **Files changed:** 1 | **Lines:** +70 / -4
- `services/backupService.js` — added `findPgTool(name)` helper
  - Checks `PGBIN` env var first
  - Runs `where <tool>` via PATH
  - Scans `C:\Program Files\PostgreSQL\*\bin\` (picks highest version)
  - All 3 `spawn()` calls updated: `runBackup`, `runFullSiteBackup`, `restoreBackup`

#### Fix: Restore — FK cascade errors (34 errors with `--clean`)
**Commit:** `3becc3f` | **Files changed:** 1 | **Lines:** +85 / -40
- `services/backupService.js` — replaced `--clean` with drop+recreate strategy:
  - `pg_terminate_backend` all active connections
  - `DROP DATABASE IF EXISTS`
  - `CREATE DATABASE TEMPLATE template0`
  - `pg_restore --no-owner --no-privileges` into empty DB

#### Fix: `server.exe` — bcrypt native addon crash
**Commit:** `d5478e5` | **Files changed:** 10 | **Lines:** +27 / -16
- `package.json` — replaced `bcrypt` with `bcryptjs`
- `controllers/adminController.js` — `require('bcryptjs')`
- `controllers/authController.js` — `require('bcryptjs')`
- `controllers/importController.js` — `require('bcryptjs')`
- `controllers/twoFactorController.js` — `require('bcryptjs')`
- `controllers/userController.js` — `require('bcryptjs')`
- `models/user.js` — `require('bcryptjs')`
- `seeders/20260619000003-initial-admin.js` — `require('bcryptjs')`

#### Fix: `server.exe` — `Cannot mkdir in snapshot` crash
**Commit:** `53d94ee` | **Files changed:** 1 | **Lines:** +69 / -86
- `services/backupService.js` — moved all `mkdirSync` calls inside `ensureDir()` lazy helper, never at module load time; rooted all paths at `path.dirname(process.execPath)`

#### Fix: `server.exe` — `process.execDir` undefined crash
**Commit:** `dcecb5c` + `1406aa5` | **Files changed:** 1
- `services/backupService.js` — replaced `process.execDir` with `path.dirname(process.execPath)`

#### Fix: `server.exe` — dynamic require crash in models
**Commit:** `9e8de19` | **Files changed:** 1 | **Lines:** +38 / -21
- `models/index.js` — replaced `readdirSync` glob pattern with explicit static `require()` for every model file so `pkg` bundles them all

#### Fix: RX Records delete not working
**Commit:** `53f5545`
- `controllers/rxController.js` — restored missing `loadRxDropdowns`, `openWorkflow`, `completeStep` handlers

---

## [1.0.0] — 2026-06-19

### 🚀 Initial Release
- Patient management (CRUD, soft-delete, restore, patientCode)
- RX Records with workflow tracking and medication entries
- Role-based access control (Administrator, Supervisor, Operator, Read Only)
- Pharmacy, Clinic, Patient/Pharmacy Transport reference data
- Medication catalog with sort order
- Audit logging on all write operations
- Automated database backups (`pg_dump`, cron-scheduled)
- Full Site Backup (ZIP: code + fresh DB dump)
- Two-factor authentication (TOTP + backup codes)
- User management with account locking + failed login counter
- Reports, analytics, CSV/Excel export
- Data import (CSV/Excel)
- System settings (timezone, SMTP, backup schedule)
- Dark mode (persisted in localStorage)
- `RX-Manager.bat` — server/database/config management (options 1–18)
- Portable `server.exe` build via `@yao-pkg/pkg`
- FortiGate reverse-proxy compatibility (base-path detection)
