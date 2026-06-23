# Patient RX System — Operations & Developer Manual

Version: 1.1.3 | Last Updated: 2026-06-23

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Architecture](#2-architecture)
3. [File Tree](#3-file-tree)
4. [Environment Variables (.env)](#4-environment-variables)
5. [Running the Server](#5-running-the-server)
6. [Logging & Debug Mode](#6-logging--debug-mode)
7. [Building the Executable](#7-building-the-executable)
8. [Windows Service Setup](#8-windows-service-setup)
9. [Database](#9-database)
10. [User Roles & Permissions](#10-user-roles--permissions)
11. [Key Features Reference](#11-key-features-reference)
12. [API Routes Summary](#12-api-routes-summary)
13. [Troubleshooting Guide](#13-troubleshooting-guide)
14. [Known Constraints & Notes](#14-known-constraints--notes)
15. [Deployment Checklist](#15-deployment-checklist)

---

## 1. System Overview

Patient RX Delivery Management System is a Node.js/Express web application
that manages patient records, prescription (RX) delivery tracking, transport
companies, pharmacies, and reporting for a medical delivery operation.

- **Backend:** Node.js 22 + Express 5 + Sequelize ORM
- **Database:** PostgreSQL 14+
- **Frontend:** Server-rendered EJS templates + Vanilla JS + Bootstrap 5
- **Auth:** JWT (cookie-based) + optional 2FA (TOTP/QR code)
- **Production:** Compiled to single self-contained `server.exe` via @yao-pkg/pkg
- **Access:** Via FortiGate SSL VPN reverse proxy (HTTPS termination at proxy)

---

## 2. Architecture

```
Browser
  |
  | HTTPS (port 10443)
  v
FortiGate SSL VPN / Reverse Proxy
  |
  | HTTP (port 3000, internal)
  v
server.exe (Node.js 22, Express 5)
  |
  |-- /api/*        -> REST API routes (JSON)
  |-- /*            -> EJS-rendered HTML pages (web routes)
  |
  v
PostgreSQL 14+ (localhost:5432)
  database: patient_rx_dev
```

**Trust proxy** is set to 1 hop — this allows Express to read the real client IP
from X-Forwarded-For headers set by FortiGate. Do NOT expose port 3000 directly
to the internet.

---

## 3. File Tree

```
Daniely RX\                         <- Project root (source)
  app.js                            <- Entry point. CLI flags, middleware, routes.
  package.json                      <- Dependencies, build script, pkg config
  .env                              <- Runtime config (never commit to git)
  .env.example                      <- Template for .env (safe to share)
  CHANGELOG.md                      <- Version history with file-level detail
  OPERATIONS_MANUAL.md              <- This file
  pm2.config.js                     <- PM2 config (alternative to service install)
  setup.bat                         <- Windows first-run setup helper
  RX-Manager.bat                    <- Quick launch shortcut

  app.js                            <- Main Express app
  |
  controllers\                      <- Request handlers (one per resource)
  |   adminController.js            <- Admin user management
  |   authController.js             <- Login, logout, 2FA, JWT
  |   auditLogController.js         <- Read audit log entries
  |   dashboardController.js        <- Stats + chart data
  |   emailReportController.js      <- Send reports by email (SMTP)
  |   errorLogController.js         <- Backend error recording
  |   importController.js           <- CSV bulk import
  |   medicationCatalogController.js
  |   patientController.js          <- CRUD for patients + soft delete
  |   patientLockController.js      <- Record locking (prevent concurrent edits)
  |   patientNoteController.js      <- Patient sticky notes
  |   patientTransportController.js
  |   pharmacyController.js
  |   pharmacyTransportController.js
  |   reportController.js           <- Generate reports (PDF, CSV, Excel)
  |   roleController.js             <- Role permissions management
  |   rxController.js               <- RX record CRUD
  |   searchController.js           <- Global search
  |   settingsController.js         <- System settings read/write
  |   snapshotController.js         <- Daily metrics snapshots
  |   twoFactorController.js        <- TOTP 2FA enable/disable/verify
  |   userController.js             <- User CRUD
  |   workflowActionController.js   <- RX workflow status tracking

  models\                           <- Sequelize ORM models
  |   index.js                      <- DB connection + model loader
  |   patient.js                    <- Patient (hasMany RXRecord, PatientNotes)
  |   rxrecord.js                   <- RX prescription record
  |   RXHistory.js                  <- Previous service dates history
  |   user.js                       <- User account + roles
  |   role.js                       <- Role definitions + permissions JSON
  |   patientnote.js                <- Sticky notes per patient
  |   patientlock.js                <- Record lock tracking
  |   auditlog.js                   <- Audit trail entries
  |   errorlog.js                   <- Backend error log entries
  |   clinic.js
  |   pharmacy.js
  |   medication.js
  |   medicationcatalog.js
  |   systemsetting.js              <- Key/value settings stored in DB
  |   dailysnapshot.js              <- Daily metrics history
  |   apikey.js                     <- API key management
  |   rxworkflowtracking.js

  routes\                           <- Express router definitions
  |   webRoutes.js                  <- HTML page routes (GET /patients, etc.)
  |   patientRoutes.js
  |   rxRoutes.js
  |   authRoutes.js
  |   userRoutes.js
  |   reportRoutes.js
  |   auditLogRoutes.js
  |   importRoutes.js
  |   ... (one file per resource)

  middleware\
  |   auth.js                       <- JWT verification middleware
  |   auditLogger.js                <- Intercepts res.json() to log API actions
  |   roleCheck.js                  <- Permission enforcement per role

  services\
  |   backupService.js              <- Auto daily/weekly DB dump scheduler
  |   snapshotService.js            <- Daily metrics capture
  |   settingsService.js            <- System settings cache (load from DB)
  |   emailService.js               <- Nodemailer SMTP wrapper

  utils\
  |   dateUtils.js                  <- parseDate() + fmtDate() (MM/DD/YYYY)

  views\                            <- EJS templates (bundled into server.exe)
  |   layout.ejs                    <- Master layout (sidebar, nav, dark mode)
  |   login.ejs
  |   dashboard.ejs
  |   patients.ejs
  |   rx.ejs
  |   reports.ejs
  |   users.ejs
  |   audit-log.ejs
  |   changelog.ejs
  |   system-settings.ejs
  |   ... (one per page)

  public\                           <- Static files (bundled into server.exe)
  |   css\
  |   |   style.css                 <- Global styles + dark mode variables
  |   js\
  |   |   patients.js               <- Patient list, cards, print, badges
  |   |   rx.js                     <- RX record management
  |   |   dashboard.js              <- Charts (Chart.js) + theme toggle
  |   |   reports.js                <- Report generation + email modal
  |   |   audit-log.js
  |   |   users.js
  |   |   system-settings.js
  |   |   changelog.js

  migrations\                       <- Sequelize DB schema migrations
  seeders\                          <- DB seed data
  config\
  |   config.json                   <- Sequelize DB config (reads from .env)
  |   settings.json                 <- Default system settings

  dist\                             <- PRODUCTION DEPLOYMENT FOLDER
  |   server.exe                    <- Compiled self-contained binary
  |   install-service.ps1           <- Windows Service installer
  |   uninstall-service.ps1         <- Windows Service remover
  |   README.md                     <- Quick-start guide (ships with exe)
  |   .env                          <- Copy from project root (not auto-copied)
  |   logs\                         <- Created automatically when LOG_FILE=true
  |   |   access-YYYY-MM-DD.log
  |   |   error-YYYY-MM-DD.log

  backups\                          <- Auto DB dump files (.dump format)
  logs\                             <- Dev-mode log files
  uploads\                          <- Uploaded files (imported CSVs, etc.)
  data\                             <- Static reference data
```

---

## 4. Environment Variables

All configured in `.env` next to server.exe (or project root in dev mode).
**Never commit `.env` to git. Use `.env.example` as template.**

```env
# ---- Server ----------------------------------------------------------------
PORT=3000                           # HTTP port server listens on
NODE_ENV=production                 # production | development
TZ=America/New_York                 # Server timezone for timestamps

# ---- Database (PostgreSQL) -------------------------------------------------
DB_HOST=127.0.0.1                   # DB host (localhost or remote IP)
DB_PORT=5432                        # DB port (default 5432)
DB_NAME=patient_rx_dev              # Database name
DB_USER=postgres                    # DB login user
DB_PASSWORD=yourpassword            # DB login password

# ---- Security --------------------------------------------------------------
JWT_SECRET=your-long-random-secret  # Min 32 chars. Change this in production!
SESSION_TIMEOUT_MINUTES=30          # Idle session timeout (minutes)
MAX_FAILED_LOGINS=5                 # Lock account after N failed logins

# ---- Network / Proxy -------------------------------------------------------
APP_ORIGIN=https://rx.yourdomain.com  # Allowed CORS origin (your proxy URL)
FORCE_HTTPS=false                     # true = redirect HTTP -> HTTPS

# ---- Email / SMTP (optional) -----------------------------------------------
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your@gmail.com
SMTP_PASS=your-app-password         # Gmail: use App Password, not account password
SMTP_FROM_NAME=Patient RX System

# ---- Logging ---------------------------------------------------------------
LOG_FILE=true                       # true = write logs to files in logs\
LOG_RETENTION_DAYS=7                # Delete log files older than N days on boot
DEBUG=false                         # true = verbose request logging (no recompile)
```

### Changing settings without recompiling

All `.env` changes take effect on server restart — no recompile needed.
The only thing that requires a recompile is changes to `.js` or `.ejs` source files.

---

## 5. Running the Server

### Development (requires Node.js installed)
```bash
npm install           # First time only
npm run dev           # nodemon auto-restarts on file changes
npm start             # node app.js (no auto-restart)
```

### Production (compiled exe)
```
dist\server.exe --v   # Show version and exit (does NOT start the server)
dist\server.exe       # Start the server
Ctrl+C                # Stop gracefully
```

### Startup output (when server starts)
```
[Log] File logging ON -- E:\...\dist\logs  (retain 7 days)
Server is running on port 3000.
```

---

## 6. Logging & Debug Mode

### Log files (when LOG_FILE=true in .env)

Stored next to server.exe in `logs\`:

| File                       | Contains                                        |
|----------------------------|-------------------------------------------------|
| `access-2026-06-23.log`    | All HTTP requests: IP, method, URL, status, ms  |
| `error-2026-06-23.log`     | console.error output + unhandled crashes        |

- New file created every day at midnight
- Files older than LOG_RETENTION_DAYS deleted on startup
- Both console AND file receive output simultaneously

### Debug mode

**No recompile required.** Just change `.env` and restart:

```env
DEBUG=true
```

Debug mode changes Morgan to `dev` format which shows:
```
GET /api/patients 200 47ms - 8984 bytes
POST /api/auth/login 401 12ms - 58 bytes
```

Color-coded by status code in the console. Useful for tracing:
- FortiGate proxy routing issues
- Slow API endpoints (response time in ms)
- Authentication failures (401/403 patterns)

To disable: set `DEBUG=false` and restart.

### Database query logging (advanced)

Not enabled by default. To see raw SQL queries, temporarily add to .env:
```env
DB_LOGGING=true
```
Then in `models/index.js`, set `logging: process.env.DB_LOGGING === 'true'`.

---

## 7. Building the Executable

### Prerequisites
- Node.js 22+ installed on the BUILD machine (not needed on production)
- All npm packages installed: `npm install`
- PostgreSQL accessible for dev testing

### Build command
```bash
npm run build:exe
```

Which runs:
```
npx --yes @yao-pkg/pkg app.js --target node22-win-x64 --output dist/server.exe --compress GZip
```

### CRITICAL: Use @yao-pkg/pkg — NOT the old vercel pkg

| Tool              | npm package      | Works? | Notes                                    |
|-------------------|------------------|--------|------------------------------------------|
| @yao-pkg/pkg      | @yao-pkg/pkg     | YES    | Actively maintained, supports node22     |
| vercel pkg (old)  | pkg              | NO     | Does not bundle EJS views correctly      |

Signs you used the wrong build tool:
- `Error: Cannot find module 'ejs'` on startup
- `Failed to lookup view "login" in views directory`

### What gets bundled
- All `.js` source files (app.js, controllers, models, routes, middleware, services)
- All EJS templates (views\)
- All static files (public\)
- All config and data files
- bcryptjs (listed explicitly because dynamically required)

### What does NOT get bundled (must be in same folder as server.exe)
- `.env` (contains secrets, must be placed manually)
- `logs\` folder (created automatically at runtime)

### After compiling
1. Copy `dist\server.exe` to the production machine
2. Copy `.env` to the same folder as `server.exe`
3. Start: `server.exe`

---

## 8. Windows Service Setup

### Installing as a service (auto-start on boot, auto-restart on crash)

```powershell
# Run as Administrator
cd "path\to\dist"
.\install-service.ps1
```

The installer:
1. Downloads NSSM to `parent-of-dist\nssm\` (one-time)
2. Registers `server.exe` as Windows Service `PatientRXSystem`
3. Reads `.env` and injects all variables into the service environment
4. Configures auto-restart with 60-second throttle (max 3 restarts)
5. Writes stdout/stderr to `parent-of-dist\logs\` with daily rotation
6. Starts the service immediately

### Service management
```
net start PatientRXSystem    # Start
net stop  PatientRXSystem    # Stop
sc query  PatientRXSystem    # Check status
```

Or via: `services.msc` -> "Patient RX System"

### Uninstalling
```powershell
.\uninstall-service.ps1
```

### NSSM location
After install: `parent-of-dist\nssm\win64\nssm.exe`
NSSM is NOT placed inside `dist\` — only `server.exe` and the two scripts live in dist.

---

## 9. Database

### PostgreSQL requirements
- Version 14 or later
- Database must be created before first run
- User must have CREATE TABLE privileges

### Auto-migrations
On every startup, the server runs `db.sequelize.sync({ alter: true })` which:
- Creates missing tables automatically
- Adds missing columns to existing tables
- Does NOT delete existing data or columns

### Manual migrations (dev only)
```bash
npx sequelize-cli db:migrate
npx sequelize-cli db:seed:all
```

### Backups
Automatic backups via `services/backupService.js`:
- Daily: 2:00 AM -> `backups\backup_YYYY-MM-DDTHH-MM-SS.dump`
- Weekly: Sunday 3:00 AM -> same location
- Format: PostgreSQL custom dump (`.dump`), restore with `pg_restore`

Manual restore:
```bash
pg_restore -U postgres -d patient_rx_dev backup_2026-06-23.dump
```

---

## 10. User Roles & Permissions

| Role          | Patients | RX Records | Reports | Users | Settings | Notes |
|---------------|----------|------------|---------|-------|----------|-------|
| admin         | Full     | Full       | Full    | Full  | Full     | Full  |
| manager       | Full     | Full       | Full    | View  | View     | Full  |
| dispatcher    | View/Edit| Full       | View    | None  | None     | Full  |
| viewer        | View     | View       | View    | None  | None     | View  |

Permissions are stored as JSON in the `roles` table and editable from Settings > Roles.

---

## 11. Key Features Reference

### Patient Records
- Full CRUD with soft delete (isDeleted flag, not physical delete)
- Date format: MM/DD/YYYY in all inputs and exports
- Patient code auto-generated if not provided
- Duplicate detection on create
- Print preview: Classic layout and Card layout
- CSV import with duplicate handling

### Action Button Badges (Patient List)
- RX Records button: shows count of active RX records (hidden when 0)
- History button: shows same RX count (hidden when 0)
- Timeline button: shows RX count + Notes count (hidden when 0)
- Notes button: shows note count (hidden when 0)

### Notes System
- Per-patient sticky notes with timestamp and author
- Note count badge on patient list row
- Role-based access control

### Audit Log
- Records all create/edit/delete/restore actions via auditLogger middleware
- Captured via res.json() hook (routes returning res.send() or 204 are NOT logged)
- Viewable at /audit-log with filtering by user, action, module, date

### RX Records & Workflow
- Track delivery status through configurable workflow stages
- Service date tracking with history (previous service dates)
- Medication catalog integration

### Reports
- Patient reports, RX reports, daily summaries
- Export: PDF, CSV, Excel
- Email report via SMTP (configured in .env)
- Date range filtering

### Dashboard
- Patient counts, RX counts, delivery status charts (Chart.js)
- Dark/light mode — charts re-render automatically on theme toggle
- Daily snapshot history for trend tracking

### Dark Mode
- Toggle via moon/sun icon in navigation
- All pages including print preview support dark mode
- Classic print layout forces white background regardless of theme
- Preference saved in localStorage

### System Settings
- Timezone, session timeout, security settings
- Stored in PostgreSQL `SystemSettings` table (key/value)
- Loaded and cached at startup via settingsService

### 2FA (Two-Factor Authentication)
- TOTP-based (compatible with Google Authenticator, Authy)
- Per-user opt-in
- QR code provisioning from profile page
- Backup codes supported

### Changelog
- /changelog page shows version history from CHANGELOG.md
- "Git Commits" tab shows recent commits (DEV only — not available in server.exe)

---

## 12. API Routes Summary

All API routes require `Authorization: Bearer <token>` header.
Tokens obtained from `POST /api/auth/login`.

| Method | Route                      | Description                        |
|--------|----------------------------|------------------------------------|
| POST   | /api/auth/login            | Login, returns JWT token           |
| POST   | /api/auth/logout           | Invalidate token                   |
| GET    | /api/patients              | List patients (supports ?includeDeleted=true) |
| POST   | /api/patients              | Create patient                     |
| PUT    | /api/patients/:id          | Update patient                     |
| DELETE | /api/patients/:id          | Soft delete patient                |
| GET    | /api/rx                    | List RX records                    |
| POST   | /api/rx                    | Create RX record                   |
| GET    | /api/reports/:type         | Generate report                    |
| POST   | /api/email-report          | Send report by email               |
| GET    | /api/audit-logs            | Get audit log (paginated)          |
| GET    | /api/users                 | List users                         |
| GET    | /api/dashboard/stats       | Summary counts                     |
| GET    | /api/dashboard/charts      | Chart data                         |
| GET    | /api/version               | Server version info (auth required)|
| GET    | /api/settings              | System settings                    |
| PUT    | /api/settings              | Update system settings             |

---

## 13. Troubleshooting Guide

### Server won't start
- Check .env is present next to server.exe
- Check DB_PASSWORD is correct
- Check PostgreSQL is running: `sc query postgresql-x64-14`
- Check port is free: `netstat -ano | findstr :3000`

### Login page shows {"error":"Internal server error"}
- If using server.exe: likely wrong build tool used. Rebuild with `npm run build:exe`
- Signs: `Cannot find module 'ejs'` or `Failed to lookup view "login"` in logs
- Fix: recompile using `@yao-pkg/pkg` (not vercel `pkg`)

### Unicode characters in app.js break compilation
- The @yao-pkg/pkg tool handles UTF-8 correctly
- The old vercel pkg v5 did NOT — caused "Internal server error" on all page loads
- Solution: always use `npm run build:exe` which uses @yao-pkg/pkg

### Audit log not recording deletes
- Route must return `res.json()` not `res.status(204).send()`
- The auditLogger middleware hooks into res.json() only

### Date showing as YYYY-MM-DD instead of MM/DD/YYYY
- Use `window.fmtDate(value)` in all frontend JS date displays
- Use `parseDate()` from `utils/dateUtils.js` on all backend date inputs

### Charts invisible or wrong color after dark mode toggle
- Charts must be destroyed and re-created on theme change
- dashboard.js listens to the theme toggle click and calls Chart.destroy() before re-render

### Email report not sending
- Check SMTP_HOST, SMTP_USER, SMTP_PASS in .env
- Gmail: use App Password (not account password), enable 2-Step Verification first
- Check error log for SMTP connection errors

### Session keeps timing out
- Adjust SESSION_TIMEOUT_MINUTES in .env (default 30)
- Does not require recompile

---

## 14. Known Constraints & Notes

### FortiGate Proxy
- Trust proxy set to 1 hop in app.js
- All JS event handlers must use event delegation (addEventListener on container)
- Avoid inline onclick attributes in dynamically built HTML strings
- CSS: some properties may be stripped by FortiGate content inspection

### Compilation
- ALWAYS use `npm run build:exe` (uses @yao-pkg/pkg)
- NEVER use plain `npx pkg` (vercel pkg v5) — breaks EJS and views
- Unicode characters in console.log strings inside app.js CAN cause issues
  with some pkg versions — use ASCII only in log output
- Arrow functions (=>) are fine; the old breakage was encoding, not syntax

### Database
- `db.sequelize.sync({ alter: true })` runs on every start
- Avoid renaming columns in migrations — alter:true won't rename, only add
- RXRecord soft delete: always use `isDeleted: false` WHERE clause in includes

### Frontend
- All date rendering must use `window.fmtDate()` from public/js
- Badge pills use position:absolute — parent button must have position:relative
- Dark mode state stored in localStorage key 'rxTheme'

---

## 15. Deployment Checklist

### First deployment
- [ ] PostgreSQL 14+ installed and running
- [ ] Database created: `createdb -U postgres patient_rx_dev`
- [ ] `.env` file filled with correct values (especially JWT_SECRET and DB_PASSWORD)
- [ ] PORT 3000 open on firewall (or set different PORT)
- [ ] `dist\server.exe` and `.env` in same folder
- [ ] Test: `server.exe --v` shows correct version
- [ ] Test: browse to `http://server-ip:3000/login`
- [ ] Change default admin password after first login

### After every recompile
- [ ] Stop the running server.exe
- [ ] Replace server.exe with new dist\server.exe
- [ ] Verify .env is still present and correct
- [ ] Start server and check startup log
- [ ] Browse to /login and confirm it loads
- [ ] Run `server --v` to confirm version number

### Updating .env only (no recompile)
- [ ] Stop the server
- [ ] Edit .env
- [ ] Start the server
- [ ] No other steps needed

---

*This document was generated 2026-06-23. Keep it updated when adding features.*
*See CHANGELOG.md for version-by-version change history.*
