# Changelog — Patient RX System

All notable changes are documented here with file-level detail and git commit references.
Format follows [Keep a Changelog](https://keepachangelog.com).

---

## [2.0.3] — 2026-06-23

### ✨ New Feature — Emergency Password Reset CLI Flag
**Files changed:** 1 | FEAT-19

- **FEAT-19** `app.js` — Added `--reset-password` CLI flag for emergency admin account recovery.

  **Usage (production exe):**
  ```
  server.exe --reset-password admin YourNewPassword
  ```
  **Usage (dev):**
  ```
  node app.js --reset-password admin YourNewPassword
  ```
  - Works in both compiled (`server.exe`) and dev (`node app.js`) mode
  - Connects to the DB, hashes the new password with bcrypt (cost 12), updates the user
  - Also resets `failedLoginCount` and `lockedUntil` (unlocks accounts locked by failed attempts)
  - Prints clear success/error message and exits immediately without starting the HTTP server
  - Does NOT require the server to be stopped first

---

## [2.0.2] — 2026-06-23

### 🐛 Bug Fix — Backoffice Orphan Cleanup also fails with FK constraint
**Files changed:** 1 | BUG-12

- **BUG-12** `controllers/adminController.js` — Fixed `cleanOrphans` function. When cleaning orphaned `RXRecords` (whose `patientId` no longer exists), the DELETE failed with the same FK constraint as BUG-11: `RXHistories` and `RXWorkflowTrackings` still referenced the orphaned RX rows. Fixed by wrapping orphan cleanup in a transaction that first cascade-deletes children (using the same `FK_CHILDREN` map) before removing the orphaned rows. Orphan cleanup now correctly removes: RXHistories → RXWorkflowTrackings → Medications → then the orphaned RXRecord itself.

---

## [2.0.1] — 2026-06-23

### 🐛 Bug Fix — Backoffice Delete: "violates foreign key constraint RXHistories_rxRecordId_fkey"
**Files changed:** 1 | BUG-11

- **BUG-11** `controllers/adminController.js` — Fixed a multi-level FK cascade error when deleting records from the backoffice Database Manager.

  **Root cause:** The `FK_CHILDREN` map for `Patients` and `RXRecords` was missing the correct order. When deleting a `Patient` (or selecting rows from `Patients` in the backoffice), the code deleted `RXRecords` first — but `RXRecords` still had `RXHistories` rows referencing it, so PostgreSQL blocked with "violates foreign key constraint RXHistories_rxRecordId_fkey".

  **Fix 1:** Reordered `FK_CHILDREN['Patients']` to delete grandchildren (`RXHistories`, `RXWorkflowTrackings`, `Medications`) BEFORE deleting `RXRecords`. Added `via` property to indicate grandchild relationship.

  **Fix 2:** Updated `deleteRows()` to handle the `via` pattern — grandchildren use a subquery (`WHERE rxRecordId IN (SELECT id FROM RXRecords WHERE patientId IN (:ids))`) instead of direct IN clause.

  **Fix 3:** Added `Users` to `FK_CHILDREN` — deleting a user now sets `userId = NULL` on `RXHistories` and `AuditLogs` (ON DELETE SET NULL) instead of crashing with a FK violation.

---

## [2.0.0] — 2026-06-23

### 🐛 Critical Fix — "Network Error" on Workflow Step Complete (True Root Cause)
**Files changed:** 1 | BUG-10

- **BUG-10** `views/rx-records.ejs` — Found and fixed the **true root cause** of the "Network error." toast after clicking any workflow **Complete** button.

  **Root cause:** `openWorkflow()` was missing a `return` statement before its `fetchWithAuth(...)` call. The function returned `undefined` instead of its Promise. Every caller (5 places: `completeStep`, `undoStep`, reset cycle, warehouse, etc.) chained `.then()` on the return value: `openWorkflow(rxId).then(...)`. Since `undefined.then` doesn’t exist, this immediately threw `TypeError: Cannot read properties of undefined (reading 'then')`, which was caught by the `.catch()` and displayed as “Network error.”

  **What was happening from user perspective:** The workflow step WAS being saved successfully on the server — but the UI refresh after saving crashed, showing a misleading “Network error.” toast.

  **Fix:** Added `return` before `fetchWithAuth` in `openWorkflow` (1 character change). The function now correctly returns its Promise chain, allowing all 5 callers to chain `.then(loadRxRecords)` on it safely.

---

## [1.1.9] — 2026-06-23

### 🐛 Root Cause Fix — Workflow Steps Showing "Network Error"
**Files changed:** 1 | BUG-09

- **BUG-09** `public/js/app.js` — Found and fixed the **true root cause** of the "Network error." toast that appeared when clicking workflow step buttons ("Complete") for users with limited roles (Read Only, Operator, etc.).

  **Root cause:** `fetchWithAuth()` handled 403 responses by reading the body via `res.clone().json()` to show the "Access denied" toast — but then returned the **original `res` object** whose body stream was already consumed. Any caller that subsequently called `res.json()` on that consumed response would throw a TypeError, fall into its `.catch()`, and display "Network error." instead of the real message.

  **Fix:** For 403 responses, `fetchWithAuth` now returns `null` (matching the same pattern as 401). The "Access denied" toast was already shown before returning. All existing callers already have `if (!res) return;` guards that correctly handle `null`, so no other code changes were needed.

  **Result:** Users with restricted permissions will now see the clear "Access denied: you cannot add records to rx_records." message instead of "Network error." — and no spurious error log entries are created.

---

## [1.1.8] — 2026-06-23

### 🐛 Bug Fix — RX Save "Network Error" + Global Error Logging
**Files changed:** 3 | BUG-08, FEAT-18

- **BUG-08** `views/rx-records.ejs` — Fixed `.catch(function()` → `.catch(function(e)` in the "Save New RX" submit handler. The previous catch silently discarded the real error object, always showing the generic "Network error." toast. Now shows the actual error message (e.g. "Arrival date must be within 90 days prior to Service Date.") AND logs it to the DB error log for developer review.

- **FEAT-18a** `public/js/base.js` — Added `window.logClientError(message, detail, severity)` global function. Sends structured error reports to `POST /api/errors` (the existing ErrorLog table) including: error message, stack trace, page title, URL, and user context. Available on every page — call it from any catch block. FortiGate-safe: uses `fetch()` with `keepalive:true`, no inline handlers.

- **FEAT-18b** `public/js/base.js` — Added automatic `window.onerror` and `window.addEventListener('unhandledrejection')` hooks. Any uncaught JS error OR unhandled Promise rejection on ANY page is now **automatically** recorded in the ErrorLog DB table — no manual try/catch needed. Developers can review errors from Audit Log → Error Log tab without waiting for users to report them.

- **Developer note:** Error logs include page URL, window title, user token (resolved to userId server-side), stack trace, and timestamp. Errors can be marked resolved or deleted from the Error Log tab. Severity levels: `error`, `warning`, `info`.

---

## [1.1.7] — 2026-06-23

### ✨ New Feature — Who's Online (Active Users Dashboard)
**Files changed:** 8 | FEAT-17

- **FEAT-17a** `services/sessionTracker.js` *(NEW)* — In-memory active session store. Tracks userId, username, firstName, lastName, role, currentPage, currentUrl, loginTime, lastSeen. Auto-expires entries older than 10 min on every read. No DB changes required.
- **FEAT-17b** `routes/apiRoutes.js` — Added `POST /api/heartbeat` (any authenticated user) and `GET /api/active-sessions` (requires `active_users` read permission). Logout route now calls `sessionTracker.remove()` so users vanish immediately on logout.
- **FEAT-17c** `public/js/base.js` — Heartbeat sender IIFE: fires immediately on page load then every 30s. FortiGate-safe: pure `fetch()`, no inline handlers, uses `window.rxUrl()` for proxy compatibility.
- **FEAT-17d** `views/active-users.ejs` *(NEW)* — "Who's Online" dashboard: card grid with role-colored avatar + initials, status dot, idle progress bar (green/amber/red), current page with icon, login time, URL. Summary pills + 30s countdown ring + manual refresh.
- **FEAT-17e** `routes/webRoutes.js` — Added `GET /active-users` web route.
- **FEAT-17f** `views/partials/sidebar.ejs` — "Who's Online" link under Administration + live green online-count badge. Badge hidden automatically for roles without `active_users` permission.
- **FEAT-17g** `middleware/rbac.js` — Added `active_users` key to all 4 built-in role defaults (Admin/Supervisor = visible, Operator/Read Only = hidden). Configurable from Roles Management.
- **FEAT-17h** `app.js` — Startup migration now surgically backfills any newly added permission keys into existing DB roles without resetting customized permissions.

### 🎨 UI — Icon-Only Search Buttons (Uniform Size)
**Files changed:** 5 | UI-03

- **UI-03a** `public/css/style.css` — `.btn-search` class: fixed 38×38px square, overrides all flex contexts.
- **UI-03b/c/d/e** `patients.ejs`, `reports.ejs`, `rx-records.ejs`, `audit-log.ejs` — All search buttons now use `.btn-search` instead of `flex-fill`/`flex-grow-1`. Added `title="Search"` tooltips where missing.

---

## [1.1.5] — 2026-06-23

### ✨ Improvements & Bug Fixes
**Files changed:** 7 | IMPROVE-01 through IMPROVE-05, BUG-04, BUG-05

- **IMPROVE-01** `views/login.ejs` — Login shake animation: CSS `@keyframes shake` + `.shake-card` class added. `showError()` now triggers shake on the `.login-card` on every failed login, with forced reflow so repeated failures retrigger. FortiGate-safe (pure class toggle, no inline handlers).
- **IMPROVE-02** `views/patients.ejs` — "Clear Filters" button now shows `<i fa-times> Clear` text label instead of icon-only, improving discoverability.
- **IMPROVE-03** `views/rx-records.ejs` — Bulk workflow update now fires a `showToast()` summary (green on all-success, amber on partial skips) in addition to the results overlay, so users see feedback even after closing the modal.
- **IMPROVE-04** `services/emailService.js`, `controllers/userController.js` — Welcome email sent on new user creation. `emailService.sendWelcome()` added: branded HTML email with username and optional system URL. Call is fire-and-forget (non-blocking); skips silently if SMTP not configured or user has no email address. Optional env var `SYS_URL` shown in the email.
- **IMPROVE-05** `public/js/patients.js` — Patient CSV export filename now includes active date range: `patients_2026-01-01_to_2026-06-30_exported-2026-06-23.csv`. Falls back to `patients_YYYY-MM-DD.csv` when no date filters are set.
- **BUG-04/BUG-05** `views/reports.ejs`, `public/js/reports.js` — Reports page now has **Excel (.xls)** and **PDF (print dialog)** export buttons on both Patient Report and RX Action Report tabs. Excel export uses native HTML-table-to-XLS data URI (no external libraries). Print/PDF uses browser print dialog. All buttons use `addEventListener` only — FortiGate proxy-safe. New `downloadXls()` and `getFilteredPatientData()` helpers added.

### ✅ Test results
- Login shake visible on wrong password, retriggerable on repeated attempts.
- "Clear" text visible on patients filter bar.
- Bulk workflow toast fires with correct count after apply.
- Welcome email logs `[Email] Welcome email sent to ...` in server console (requires SMTP configured).
- Export filename includes date range when service date filters are set.
- Excel and PDF export buttons visible and functional on Reports page.

---

## [1.1.4] — 2026-06-23

### ✨ Feature: Security Settings card in System Settings (ISSUE-02)
**Files changed:** 3 | **Lines:** +70 (system-settings.ejs), +48 (system-settings.js), +2 (settingsService.js)

- `views/system-settings.ejs` — Added **Security Settings** card in the General tab, below the 2FA card:
  - Amber/gold accent color (border-left: `#f59e0b`), lock icon, "Admin Only" badge.
  - **Session Timeout** (`number` input, 1–480 min, default 30, shows "min" suffix unit).
  - **Max Failed Logins** (`number` input, 1–20 tries, default 5, shows "tries" suffix unit).
  - "Save Security Settings" button (amber), inline "Saved!" indicator, inline error indicator.
  - Info alert explaining DB value overrides `.env` and persists without editing files.
- `public/js/system-settings.js` — Added two blocks:
  - `loadSettings()` now pre-fills `sessionTimeoutInput` and `maxFailedLoginsInput` from `GET /api/settings`.
  - `saveSecurityBtn` click handler: validates ranges (1–480 / 1–20), calls `PUT /api/settings` with `{ session_timeout_minutes, max_failed_logins }`, shows Saved!/error indicators and toast. FortiGate-safe: pure `addEventListener`, no inline handlers.
- `services/settingsService.js` — Added `session_timeout_minutes` (default: `process.env.SESSION_TIMEOUT_MINUTES || '30'`) and `max_failed_logins` (default: `process.env.MAX_FAILED_LOGINS || '5'`) to `DEFAULTS`. Auto-seeded into DB on first startup via existing seed loop.
- **No new routes or controller changes required** — the existing `PUT /api/settings` endpoint accepts any key/value.

### ✅ Test results
- Card renders correctly below 2FA card with amber accent.
- Default values (30, 5) pre-filled on page load.
- Save succeeds — PUT /api/settings returns 200, Saved! indicator appears, toast fires.
- Settings table at bottom of General tab updates to show new values.
- Validation blocks values outside range (999 → "Timeout must be 1-480 minutes"; 99 → "Max logins must be 1-20").
- No browser console errors.

---

## [1.1.3] — 2026-06-23

### ✨ Feature: File logging with daily rotation (Option A)
**Files changed:** 2 | **Lines:** +38 (app.js), +4 (.env)

- `app.js` — Added `setupLogFiles()` IIFE after `dotenv.config()`. Controlled entirely by `.env` variables, no recompile needed:
  - `LOG_FILE=true` opens daily append streams for `logs/access-YYYY-MM-DD.log` (HTTP requests via Morgan) and `logs/error-YYYY-MM-DD.log` (console.error + crashes).
  - `LOG_RETENTION_DAYS=7` (default) — on each startup, log files older than N days are automatically deleted.
  - `DEBUG=true` — switches Morgan to verbose `dev` format even in production (shows response time, status color, method).
  - Log directory is created automatically next to `server.exe` in compiled mode, or project root in dev mode.
  - Morgan updated to dual-stream when file logging is active: writes to both console AND file simultaneously.
- `.env` — Added `LOG_FILE=true`, `LOG_RETENTION_DAYS=7`, `DEBUG=false`.

### Fix: Build tool corrected
- All future compilations use `@yao-pkg/pkg` (v6.20.0) with `node22-win-x64` — same tool that produced the original working binary. Previous broken builds used `pkg` v5 (vercel) with `node18` which did not bundle views/ejs correctly.

---

## [1.1.2] — 2026-06-23

### ✨ Feature: Count badges on RX Records, History, and Timeline buttons
**Files changed:** 2 | **Lines:** +38 (patients.js), +7 (patientController.js)

- `controllers/patientController.js` — `getAll` now includes `RXRecord` (id-only, LEFT JOIN, non-deleted) alongside existing `PatientNotes` include. Zero performance impact — only fetches the `id` column.
- `public/js/patients.js` lines 518–590 — Added `makeBadgePill(count, color, borderColor)` helper. Applied to all 3 action buttons:
  - 💊 **RX Records button** (blue `#0dcaf0`): shows count of active RX records. Title: "3 RX records" or "No RX records".
  - 📅 **History button** (purple `#7c3aed`): shows same RX count (same records, historical view). Title: "3 service records".
  - ⏱ **Timeline button** (teal `#20c9a0`): shows `rxCount + noteCount` (total events). Title: "5 events in timeline".
- **Zero badge:** All 3 show a gray `0` pill when empty — so users instantly see which patients have no activity.
- **Tooltip:** Each button title updates dynamically to reflect the actual count.

---

## [1.1.1] — 2026-06-23

### 🐛 Bug Fixes (QA Walkthrough — Full Production Audit)

#### BUG-01 Fix: Card print layout — DOB and Service Date now show MM/DD/YYYY
**Files changed:** 1 | **Lines:** +1 / -1
- `public/js/patients.js` line 1219 — `_farr` in `cardHTML` builder
- **Root cause:** Card layout info-grid used raw `p.dob` and `p.serviceDate` (ISO string from DB: `1990-01-15`) while Classic layout correctly used `window.fmtDate()`.
- **Fix:** Wrapped both fields with `(p.dob ? window.fmtDate(p.dob) : '—')` and `(p.serviceDate ? window.fmtDate(p.serviceDate) : '—')`.

#### BUG-02 Fix: "Email Report" button was non-functional (dead click)
**Files changed:** 2 | **Lines:** +75 (reports.js), +52 (reports.ejs)
- `public/js/reports.js` — Added `setupEmailReport()` function registered in `DOMContentLoaded`. Opens Bootstrap modal, handles Send click with fetch to `POST /api/email-report`, shows spinner + success/error feedback inline in modal.
- `views/reports.ejs` — Added `#emailReportModal` Bootstrap modal HTML before `</body>`. Fields: Report Type (4 options), Recipient Email, Subject, Date From/To.
- **Root cause:** `#emailReportBtn` existed in the HTML but had no `addEventListener`. The email controller `POST /api/email-report` was fully implemented server-side.

#### BUG-03 Fix: Patient soft-delete not recorded in Audit Log
**Files changed:** 1 | **Lines:** +2 / -1
- `controllers/patientController.js` line 195
- **Root cause:** `exports.delete` called `res.status(204).send()`. The `auditLogger` middleware hooks into `res.json()` (line 88 of `middleware/auditLogger.js`) — a `.send()` call bypasses the hook entirely.
- **Fix:** Changed to `res.json({ ok: true, message: 'Patient deleted', id: parseInt(req.params.id) })`. Frontend already checks `res.ok || res.status === 204` so no frontend change needed.

### 🔧 Improvements (QA Walkthrough)

#### ISSUE-03 Fix: Dashboard charts now re-render correctly in dark mode
**Files changed:** 1 | **Lines:** +15
- `public/js/dashboard.js` lines 817–842
- **Root cause:** Charts were created once on load with the initial theme's colors. Theme toggle via `rxTheme` CSS variable did not destroy/recreate the Chart.js instances.
- **Fix:** Stored chart data in `window._lastChartData`. Added `themeToggle` click listener that calls `Chart.getChart().destroy()` on both canvases then calls `renderCharts()` after 60ms (allows CSS transition to settle). `renderCharts()` already reads `document.documentElement.getAttribute('data-theme')` to pick colors.

#### ISSUE-04 Fix: Changelog "Git Commits" tab now shows "Dev Only" badge
**Files changed:** 1 | **Lines:** +2 / -0
- `views/changelog.ejs` line 112–116
- **Root cause:** Tab existed in production but always showed fallback "Running as compiled exe" message — misleading for users who thought something was broken.
- **Fix:** Added a `<span class="badge bg-warning text-dark">Dev Only</span>` and `title` attribute explaining the tab only works via `node app.js`, not `server.exe`.

---

## [1.1.0] — 2026-06-23

### 🐛 Bug Fixes (post-release)

#### Fix: Classic print preview — invisible text in dark mode
**Commit:** `d1d207f` | **Files changed:** 1 | **Lines:** +24 / -24
- `public/js/patients.js` — `classicHTML` container and all `buildRxBlock('classic')` cells
- **Root cause:** `.modal-body { background: var(--surface) !important }` (dark in dark mode) overrode the JS `body.style.background = '#fff'` assignment. Container div had `color:#1a2234` but no background, inheriting dark surface → text invisible.
- **Fix:** added `background:#ffffff` explicitly on the outer container div and every `<td>`/`<th>` in the classic layout so it renders as a white paper document on the dark backdrop.
- **Bonus:** classic layout dates now display as `MM/DD/YYYY` via `window.fmtDate()`.

#### Fix: Date picker calendar icon invisible in dark mode
**Commit:** `b28b0cc` | **Files changed:** 1 | **Lines:** +20
- `public/css/style.css` +20 lines — added `DK-DATE` block
- **Root cause:** `input[type="date"]` browser-native chrome (calendar icon, spin buttons) follows the page `color-scheme`. Our dark theme set a dark input background, but the icon was still rendered dark (default `light` color-scheme) → invisible.
- **Fix:** added `color-scheme: light` on all date/time inputs globally; `color-scheme: dark` when `[data-theme="dark"]` is set. Applies to all `input[type=date/time/datetime-local]` across every page.

#### Feat: `server.exe --v` prints version and exits (no server start)
**Commit:** `9339328` | **Files changed:** 1 | **Lines:** +21
- `app.js` lines 1–20 — `checkCliFlags()` IIFE added before `require('dotenv')`
- Flags accepted: `--v`, `-v`, `--version`
- Output: name, version, Node.js version, platform/arch, mode (compiled vs dev), build date
- Exits with code 0 immediately — no DB connection, no `.env` required, safe on any machine
- Also works with `node app.js --v` in dev mode

#### Fix: "invalid input syntax for type date" — date format normalization
**Commit:** `e254da3` | **Files changed:** 5 | **Lines:** +150 / -15
- `utils/dateUtils.js` (NEW, +80 lines) — `parseDate()` / `formatDate()` helpers
  - `parseDate()`: accepts `MM/DD/YYYY`, `M/D/YYYY`, `YYYY-MM-DD` → returns `YYYY-MM-DD` for DB; `null` for invalid
  - `formatDate()`: `YYYY-MM-DD` → `MM/DD/YYYY` for display
- `controllers/patientController.js` — `create` and `update` now call `parseDate(dob)` and `parseDate(serviceDate)` before any DB write
- `controllers/rxController.js` — `create` now calls `parseDate(arrivalDate)` and `parseDate(serviceDate)`
- `public/js/app.js` — `window.fmtDate()` (YYYY-MM-DD → MM/DD/YYYY) and `window.isoDate()` (MM/DD/YYYY → YYYY-MM-DD) added as global helpers
- `public/js/patients.js` — DOB/service date columns use `fmtDate()`; edit modal uses `isoDate()` to load into `<input type=date>`
- **Root cause:** `<input type=date>` `.value` returns `""` when typed manually in wrong format; `new Date("")` produces "Invalid Date" string which was sent raw to PostgreSQL

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
