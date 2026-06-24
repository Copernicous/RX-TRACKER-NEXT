# Changelog — Patient RX System

All notable changes are documented here with file-level detail and git commit references.
Format follows [Keep a Changelog](https://keepachangelog.com).

---

## [2.0.17] — 2026-06-24

### 🔒 Security — CORS Fail-Closed in Production (SEC-04)
**Files changed:** 1 | SEC-04

- **SEC-04** `app.js` — CORS previously fell back to `origin: true` (accept any origin) with only a warning log when `APP_ORIGIN` was unset in production. This is now a hard startup failure.
  - In `NODE_ENV=production`: if `APP_ORIGIN` is not set, server prints a clear FATAL error and calls `process.exit(1)` — it refuses to start.
  - In development/test: the previous permissive fallback is kept (warn + open CORS) so local dev is unaffected.
  - This prevents a future deployment without `APP_ORIGIN` from silently reopening credentialed CORS.

### ✨ Enhancement — API Keys "Not Active" Notice (IMPROVE-07)
**Files changed:** 1 | IMPROVE-07

- **IMPROVE-07** `views/backoffice.ejs` — Added a prominent amber warning banner at the top of the API Key Management panel.
  - Makes it clear that `X-API-Key` authentication is **not currently wired into the server middleware**.
  - Keys can be generated and managed, but cannot authenticate API requests.
  - Prevents operators from thinking integrations work when they don't.
  - Planned feature — banner will be removed when API key auth is fully implemented.

### 🔧 Maintenance — package-lock.json Version Sync (MAINT-01)
**Files changed:** 1 | MAINT-01

- **MAINT-01** `package-lock.json` — Root version entries were still showing `1.0.0` while `package.json` was at `2.0.16`. Ran `npm install --package-lock-only` to sync metadata. Both root entries now correctly show `2.0.17`. No dependency changes.

### 📋 Documentation — Deferred Items Register
**Files changed:** 1 | DOC-01

- **DOC-01** Created `DEFERRED-ITEMS.txt` — a formal register of the 4 items from the expert security review that were intentionally deferred:
  - **DEFERRED-01**: JWT in localStorage / JS-readable cookie (requires FortiGate staging)
  - **DEFERRED-02**: Boot-time schema mutations (requires migration workflow)
  - **DEFERRED-03**: uuid/Sequelize moderate vuln (monitor only — no forced upgrade)
  - **DEFERRED-04**: No automated test suite (staged build plan included)
  - Includes fix approaches, risk levels, file locations, and a recommended quarterly review schedule.

---

## [2.0.16] — 2026-06-23


### 🐛 Bug Fix — Logout Button Broken on Who's Online Page
**Files changed:** 1 | BUG-21

- **BUG-21** The **Logout** button (and also the theme toggle, auth guard, and session timeout) were completely non-functional on the `Who's Online` (`/active-users`) page.

  **Root cause:** Every page in the app that uses `app.js` must call `initApp()` inside its `DOMContentLoaded` handler to wire up the shared UI components (logout, auth, theme, session timeout, global search, notifications, etc.). `active-users.ejs` had its own `DOMContentLoaded` block for the session cards but was missing the `initApp()` call — so `setupLogout()` (and all other app-level setup functions) were never executed.

  **Fix:** Added `initApp()` as the first call inside the `DOMContentLoaded` handler in `views/active-users.ejs`.

---

## [2.0.15] — 2026-06-23


### 🐛 Bug Fix — CORS Blocking LAN Users on Production Server
**Files changed:** 2 | BUG-20

- **BUG-20** Production `server.exe` (at `C:\RX-Tracker\RX-APP\`) threw `CORS: origin not allowed — http://192.168.60.21:3000` for all API requests made by LAN users accessing the app directly by internal IP (not through FortiGate).

  **Root cause:** The new CORS allowlist (SEC-01, v2.0.14) correctly locked origins, but only included `https://rx.camperos.net:10443` (FortiGate) and `http://localhost:3000` (loopback). Users on the local network hitting the server by IP (`192.168.60.21`) send `Origin: http://192.168.60.21:3000` — which was not in the list.

  **Fix:** Added `http://192.168.60.21:3000` to `APP_ORIGIN` in `.env`:
  ```
  APP_ORIGIN=https://rx.camperos.net:10443,http://192.168.60.21:3000,http://localhost:3000
  ```

### ✨ Enhancement — `.env` Auto-Copied to `dist/` on Build
**Files changed:** 1 | IMPROVE-06

- **IMPROVE-06** `package.json` — `build:exe` script now automatically copies `.env` into `dist/` after compiling `server.exe`.
  - `dist/` is now a complete, self-contained deployment package: `server.exe` + `.env`
  - No need to manually remember to update `.env` on the production server separately from the binary
  - Uses `node -e` for cross-platform compatibility (no `copy`/`cp` OS dependency)

---

## [2.0.14] — 2026-06-23

### 🔒 Security — Expert Review Fixes (SEC-01 through SEC-06)
**Files changed:** 5 | Based on independent panel security audit

- **SEC-01 — CORS locked to FortiGate origin** (`app.js`)
  - `APP_ORIGIN` was already set but the code fell back to `origin: true` (reflect any origin) when it was unset, and did not support multiple origins.
  - Replaced with an explicit allowlist parser that supports comma-separated origins.
  - `APP_ORIGIN=https://rx.camperos.net:10443,http://localhost:3000` now set in `.env`.
  - In production, if `APP_ORIGIN` is unset: server logs a loud `[WARN]` but stays open (safe for existing installs). Set the var to activate enforcement.
  - Browser requests from any other origin are now rejected with a CORS error.

- **SEC-02 — tokenVersion revocation was silently broken** (`middleware/auth.js`) ← *Critical*
  - `require('./models')` was a wrong relative path — always threw a module error, always caught silently, always allowed through.
  - Result: password changes never invalidated old sessions. Old tokens remained valid until 8-hour natural expiry.
  - Fixed: `require('../models')` (correct path). Also split the catch block — programmer/module errors now re-throw and surface; only genuine DB-unavailable errors (ECONNREFUSED, ETIMEDOUT, Sequelize errors) allow through with a console warning.

- **SEC-03 — `isMaster` writable via User create API** (`controllers/userController.js`)
  - `create()` spread the full `req.body` into `db.User.create()`. Any authenticated Administrator could `POST /api/users` with `"isMaster": true` and bypass the PostgreSQL-only rule.
  - Fixed: applied the same `USER_ALLOWED_FIELDS` whitelist that `update()` already used.
  - Security fields now hard-forced on create regardless of request body: `isMaster: false`, `tokenVersion: 0`, `failedLoginCount: 0`, `lockedUntil: null`, `twoFactorEnabled: false`.

- **SEC-05 — API key rate limiter on wrong path** (`app.js`)
  - Limiter was mounted at `/api/keys` but routes live at `/api/api-keys`. Rate limiting had no effect on API key management endpoints.
  - Fixed: `app.use('/api/api-keys', apiKeyLimiter)`.

- **SEC-06 — Default `admin/admin123` seed gated** (`app.js`)
  - Boot code created `admin/admin123` automatically whenever the Users table was empty, regardless of environment.
  - Dangerous if the table is accidentally emptied in production (restore, purge, failed migration).
  - Fixed: seed now only runs when `ALLOW_DEFAULT_SEED=true` is set in `.env`.
  - Default is `ALLOW_DEFAULT_SEED=false`. Set to `true` only for fresh installs, remove after first login.
  - If table is empty and flag is not set: a clear `[WARN]` is logged instead of silently creating credentials.

- **Deferred — SEC-04: JWT in localStorage / JS-readable cookie** (`views/login.ejs`)
  - The `setRxTokenCookie()` function uses `window.RX_BASE` to compute a FortiGate-proxy-aware cookie path. Removing this without validating end-to-end through `rx.camperos.net:10443` risks breaking login for all users. Deferred until FortiGate staging validation.

---

## [2.0.13] — 2026-06-23


### 🔒 Security — MASTER Admin Tier for Backoffice (Data Control Center)
**Files changed:** 8 | SEC-01

- **SEC-01** Introduced a new **MASTER admin** security tier that restricts access to the `/backoffice` (Data Control Center) to a single designated account. This tier is enforced entirely server-side and at the database level — no UI or API endpoint can grant or revoke it.

  **Problem:** The `/backoffice` route had **no server-side access guard**. Any authenticated user who knew the URL could load the page. The client-side JS role check (`USER.role === 'Administrator'`) was trivially bypassable via browser DevTools / `localStorage` manipulation. All 22 `/api/admin/*` endpoints also only required the `Administrator` role, not a separate master flag.

  **Solution — `isMaster` database flag:**
  - A new `isMaster BOOLEAN DEFAULT false` column was added to the `Users` table.
  - This column **can only be set via direct SQL on PostgreSQL** — no UI panel or API endpoint exposes it.
  - On every server boot, a startup migration ensures the column exists (`ADD COLUMN IF NOT EXISTS`).

  **Grant / Revoke MASTER access (PostgreSQL only):**
  ```sql
  -- Grant:   UPDATE "Users" SET "isMaster" = true  WHERE "username" = 'admin';
  -- Revoke:  UPDATE "Users" SET "isMaster" = false WHERE "username" = 'admin';
  -- Verify:  SELECT id, username, "firstName", "lastName", "isMaster" FROM "Users" WHERE "isMaster" = true;
  ```
  After running the SQL, the user must **log out and back in** to receive a new JWT containing `isMaster: true`.

  **Files changed:**

  | File | Change |
  |---|---|
  | `models/user.js` | Added `isMaster: { type: BOOLEAN, defaultValue: false }` field |
  | `app.js` | Startup migration: `ALTER TABLE "Users" ADD COLUMN IF NOT EXISTS "isMaster" BOOLEAN DEFAULT false` |
  | `controllers/authController.js` | `isMaster: user.isMaster === true` added to JWT payload and login response user object |
  | `middleware/webAuth.js` | Set `req.user = decoded` (was missing — caused requireMaster to always fail on web routes) · Added `res.locals.isMaster = decoded.isMaster === true` |
  | `middleware/rbac.js` | New `requireMaster` export: checks `req.user.isMaster === true`; redirects web requests to `/dashboard?error=backoffice_restricted`, returns `403 JSON` for API/XHR requests |
  | `routes/webRoutes.js` | `/backoffice` route now guarded by `requireMaster` middleware (server-side, not client-side) |
  | `routes/apiRoutes.js` | New `masterOnly` inline guard function; all 22 `/api/admin/*` routes changed from `adminOnly` → `masterOnly` |
  | `public/js/backoffice.js` | Client-side guard updated to also check `USER.isMaster === true`; badge text changed from "Administrator" → "Master Admin" |

  **Security model:**
  - `Administrator` role → access to all standard features (users, backups, settings, audit logs, etc.)
  - `isMaster = true` (DB only) → **additionally** grants access to the Data Control Center (raw table view/purge/schema/health/locks)
  - Even a full `Administrator` **cannot** reach `/backoffice` or any `/api/admin/*` endpoint without `isMaster` set in the database.
  - Client-side checks are cosmetic defence-in-depth — every API call independently enforces the flag server-side.

---

## [2.0.12] — 2026-06-23


### 🐛 Bug Fix — Garbled Text (UTF-8 Encoding Corruption) Throughout RX Records Page
**Files changed:** 1 | BUG-18

- **BUG-18** Multiple user-visible strings on the RX Records page displayed garbled characters (`ÃƒÂ¢Ã…â€œÃ¢â‚¬Â¦`, `Ã¢â€šÂ¬Ã¢â‚¬Â`) instead of their intended content. Affected locations:
  - **Bulk toolbar dropdown** — `-- Choose step --` placeholder rendered as garbled bytes in both the static HTML `<option>` and the JS-reset version inside `_rxPopulateBulkStepSel()`
  - **Cycle Status column** — "no service date" cells showed garbled em-dash instead of `—`
  - **Cycle Status print/detail view** — Active (`🔒`), Expiring (`⏱️`), Eligible (`✅`) labels all garbled
  - **Bulk Results modal title** — `Results — Step Name` showed garbled em-dash
  - **Results list patient separator** — `RX #N — Patient Name` separator garbled
  - **Pagination text** — `Showing X–Y of Z` showed garbled en-dash between page numbers

  **Root cause:** Raw Unicode / emoji characters (em-dash `—`, en-dash `–`, `🔒`, `⏱️`, `⚠️`, `✅`) were saved into the EJS file as UTF-8 bytes but the file was subsequently re-encoded, producing double-encoded Latin-1 sequences. Node.js read and served these garbled byte sequences verbatim to the browser.

  **Fix:** All garbled sequences replaced with safe `\uXXXX` JavaScript Unicode escape sequences (e.g. `'\u2014'` for `—`, `'\uD83D\uDD12'` for 🔒) which JavaScript engines always interpret correctly regardless of file encoding. Also improved Cycle Status badge labels for clarity (Expired→Eligible, added day counts).

### 🐛 Bug Fix — Bulk Workflow "Apply to Selected" Button Restored Immediately (Not After API Settles)
**Files changed:** 1 | BUG-19

- **BUG-19** After clicking "Apply to Selected", the button was supposed to be disabled (showing spinner) until the API call completed. Instead it was immediately re-enabled because the restore code used a broken `.finally` pattern:
  ```js
  // BEFORE (broken): Runs the restore IIFE immediately at call time, not on promise settle
  }).finally ? (function(){ applyBtn.disabled = false; })() : (function(){})();
  ```
  The ternary expression evaluated `.finally` as a truthy property check, then immediately executed the restore IIFE synchronously — before the fetch even had a chance to complete. A 5-second `setTimeout` fallback was the only actual restore mechanism.

  **Fix:** Moved button restore into both the `.then()` success handler and the `.catch()` error handler. Also added `_rxUpdateBulkBar()` call after `_rxBulkSel.clear()` so the bulk toolbar correctly hides after a successful bulk operation.

---

## [2.0.11] — 2026-06-23


### 🐛 Bug Fix — Export Column Selector (All/None/Individual) Had No Effect
**Files changed:** 1 | BUG-17

- **BUG-17** Clicking **All**, **None**, or toggling individual column checkboxes in the "Export CSV" column selector had zero effect — the exported CSV always contained all columns regardless of selection.

  **Root cause — JavaScript scope isolation:**
  The `_exportColState` object and `updateEcStyle()` / `setAllExportCols()` functions were declared as `let`/`function` inside the `DOMContentLoaded` callback, making them closure-scoped (not global). However:
  - The column checkboxes used **inline `onchange=`** handlers (e.g. `onchange="_exportColState['x']=this.checked"`)
  - The "All" / "None" buttons in the EJS used **inline `onclick="setAllExportCols(true)"`**

  Inline HTML event handlers always execute in the **global scope**, meaning they cannot access variables declared inside a function. The assignments to `_exportColState` silently failed (or wrote to a phantom global), and `updateEcStyle` / `setAllExportCols` threw silent `ReferenceError`s. The actual closure-scoped `_exportColState` was never modified, so the export always used the initial state (all columns checked).

  **Fix (`public/js/patients.js`):**
  1. Removed all inline `onchange=` from checkbox HTML
  2. After setting `list.innerHTML`, attached `change` event listeners programmatically via `addEventListener` — these closures correctly access `_exportColState`
  3. Exposed `setAllExportCols` as `window.setAllExportCols` so the EJS button `onclick` handlers can reach it

---

## [2.0.10] — 2026-06-23


### ✨ Enhancement — Eligibility Cards Now Show Popup (Same as Top Stat Cards)
**Files changed:** 4 | FEAT-17

- **FEAT-17** The 4 eligibility cards on the dashboard now behave exactly like the top stat cards (Active Patients, Inactive Patients, etc.) — clicking a card opens a popup first with a detailed patient list, and the popup has a "View Full Filter" button that navigates to the Patients page with the filter pre-applied.

  **Changes:**
  - `controllers/dashboardController.js` — Added `getEligibilityDrilldown` function. Returns the full patient list for a given eligibility category (`eligible | expiring | window | none`) with computed fields: `serviceDate`, `expiryDate`, `daysLeft`, `daysPastDue`. Uses the same canonical `patient.serviceDate` logic as the card counts (guaranteed match).
  - `routes/apiRoutes.js` — Added `GET /api/dashboard/eligibility-drilldown/:filter` route.
  - `views/dashboard.ejs` — Changed all 4 card `onclick` handlers from `goEligFilter()` to `openEligDrilldown()`. Added 4 page-link anchors (`xl-elig-*`) and 1 API-URL anchor (`xa-elig-base`) for FortiGate-safe URL handling.
  - `public/js/dashboard.js` — Added `openEligDrilldown(filter)` function that reuses the existing drilldown modal. Added `_renderEligDrilldownTable()` that renders an eligibility-specific table (Patient ID, Name, Service Date, 90-Day Expiry, colored status badge, Clinic). The "Open Full Page" button is re-labeled "View Full Filter" and navigates to the Patients page with the filter active.

  **Popup table columns by category:**
  - **Eligible Now:** overdue days badge (green)
  - **Expiring ≤7d:** days-left badge (red)
  - **In Window:** days-left badge (blue)
  - **No Date:** "No date" grey badge

---

## [2.0.9] — 2026-06-23


### 🐛 Bug Fix — Dashboard Eligibility Card Counts Didn't Match Patient Filter Results
**Files changed:** 2 | BUG-16

- **BUG-16** The numbers shown on the 4 eligibility cards on the dashboard were not consistent with the number of patients shown when clicking through to the patients filter. Two root causes:

  1. **Different source of truth** — The backend (`dashboardController.js`) was using the **latest RX record's `serviceDate`** to determine the 90-day window, while the frontend patient filter (`patients.js`) was using the **patient's own `serviceDate` field**. Both now use `patient.serviceDate` exclusively (the canonical 90-day clock as previously agreed).

  2. **Different thresholds for "Expiring"** — The backend used `<= 7 days`, the frontend used `<= 14 days`. Both are now unified to `<= 7 days`.

  3. **Different definition of "None"** — The backend used "no RX record at all", the frontend used "no serviceDate on the patient record". Both now use "no `patient.serviceDate`".

  **Result:** After this fix, the count on each card will exactly match the number of rows displayed when clicking that card to filter the Patients page.

---

## [2.0.8] — 2026-06-23


### ✨ Enhancement — 90-Day Eligibility Dashboard Cards + Patient Filter
**Files changed:** 4 | FEAT-16

- **FEAT-16** Redesigned the 90-Day Service Eligibility widget on the dashboard and connected it end-to-end with the Patients filter page.

  **Problems fixed:**
  1. Only the "Eligible Now" card was clickable — the other 3 (Expiring, In Window, No Date) were static with no action.
  2. No count-up animation on any of the 4 counters (unlike the top stat cards).
  3. The embedded table list below the cards was an extra click and only showed "Eligible Now" data.
  4. `srchEligibility` filter dropdown was referenced in `patients.js` logic but the `<select>` element was completely missing from `patients.ejs`.

  **Changes:**
  - `views/dashboard.ejs` — All 4 eligibility cards now use `glass-card stat-card-clickable card-icon` style matching the top stat cards. Each card shows "View patients →" and navigates directly to the Patients page with the matching filter applied. The embedded table list is removed.
  - `public/js/dashboard.js` — Added `countUp(elId, target, duration)` animation function. Added `goEligFilter(filter)` navigation function. `loadEligibility()` now animates all 4 counters on load.
  - `views/patients.ejs` — Added `srchEligibility` dropdown (All / Eligible Now / Expiring ≤7d / In Active Window / No Service Date) to the Advanced Filters panel.
  - `public/js/patients.js` — Added `?eligFilter=` URL param handler: auto-sets the dropdown, expands the Advanced panel, calls `liveFilter()`, and shows a descriptive toast.

  **User flow:** Dashboard → click any eligibility card → Patients page opens with Advanced filter pre-applied and toast confirmation.

---

## [2.0.7] — 2026-06-23


### 🐛 Bug Fix — Inactive Patients Could Receive New RX Records
**Files changed:** 2 | BUG-15

- **BUG-15** An inactive patient (`isActive = false`) could previously receive new RX records without any warning or block. This violates the business rule that only active patients are eligible for services.

  **Root cause — two gaps, both fixed:**

  1. `controllers/rxController.js` — `create()` fetched the patient for the 90-day check but never verified `patient.isActive`. Added an explicit guard **before** the 90-day check that returns HTTP 400 with code `PATIENT_INACTIVE` and a clear message:
     > *"Cannot create an RX record for an inactive patient (Name). Re-activate the patient first before adding new services."*

  2. `views/rx-records.ejs` — The patient search dropdown in the "New RX Record" modal filtered on name/code/id but did NOT exclude inactive patients. Inactive patients now never appear in the dropdown results, making selection impossible at the UI level.

  **Defense-in-depth:** Both layers now enforce the rule independently — the UI prevents selection, and the backend rejects any direct API call that bypasses the UI.

---

## [2.0.6] — 2026-06-23


### 🔒 Security / Integrity — Service Date Lock During Active 90-Day Window
**Files changed:** 3 | BUG-14

- **BUG-14** Plugged a data-integrity gap: the **RX record `serviceDate`** field had no protection against edits while a 90-day cycle was active. Any user with edit access could silently change the service date on an existing RX record, which would shift the 90-day eligibility clock forward or backward without restriction.

  **Root cause:** `rxController.update()` accepted `serviceDate` unconditionally (zero guard). The `create()` endpoint and the patient-level `serviceDate` field already had 90-day checks, but the RX record's own edit endpoint did not.

  **Fix — three files:**
  - `controllers/rxController.js` — Added `SERVICE_DATE_LOCKED` guard to `update()`. If the incoming `serviceDate` differs from the current value **and** today ≤ current serviceDate + 90 days, the request is rejected (HTTP 400) with a clear message:
    > *"The Service Date cannot be changed during an active 90-day window. Current window expires on [date] ([N] days remaining)."*
    Returns: `{ code: 'SERVICE_DATE_LOCKED', windowExpiry, daysRemaining, currentServiceDate }`.
    Admin override available via `bypassEligibility: true` in the request body.

  - `views/rx-records.ejs` — Added a **blue 🔒 "90-Day Window Active — Service Date Locked"** banner inside the Workflow Modal when the RX record is still within the active window. The banner shows: service start date, window expiry date, and days remaining. Updated Cycle Status in the Detail View to display `🔒 Active Window (N days remaining) — Date Locked` (was the misleading `✅ Active`).

  - `views/rx-records.ejs` — Cycle Status now uses four states:
    - `🔒 Active Window (N days remaining) — Date Locked` (>14 days left)
    - `⏱️ Expiring soon (N days left) — 🔒 Date Locked` (≤14 days left)
    - `⚠️ Eligible for renewal (N days ago)` (window has passed)
    - `—` (no service date on record)

---

## [2.0.5] — 2026-06-23


### ✨ New Feature — 90-Day Service Eligibility Enforcement
**Files changed:** 7 | FEAT-20

- **FEAT-20** Full 90-day cycle eligibility enforcement across backend and frontend.

  **Business Rule:** A patient receives one service period starting on the service date of their first RX record. They are only eligible for a NEW service after 90 days have elapsed from their most recent RX service date.

  **Backend Changes:**
  - `controllers/rxController.js` — Added 90-day eligibility guard to `create()`. Before creating a new RX record, the system now looks up the patient's most recent active RX record. If today ≤ that record's serviceDate + 90 days, the request is blocked with HTTP 400, returning `code: INELIGIBLE_90_DAY`, the `eligibleAfter` date, and `daysRemaining`. An admin bypass flag (`bypassEligibility: true`) is available in the request body for exceptional cases.
  - `controllers/dashboardController.js` — Added `getEligibilityStats()` endpoint that computes per-patient eligibility buckets: `eligibleNow` (past 90 days), `expiringIn7` (0–7 days to renewal), `inWindow` (>7 days remaining), `noServiceDate` (no RX yet). Returns a sorted `eligibleList` (top 20 by days overdue).
  - `routes/apiRoutes.js` — Registered `GET /api/dashboard/eligibility` route with `dashboard.read` RBAC permission.

  **Frontend Changes:**
  - `public/js/patients.js` — Renamed the misleading **red "Expired" badge** to a clear **green "Eligible ✓" badge** in the Next Svc Date column (past-window = ready for renewal). Split expiring-soon into two tiers: ≤7 days (red/urgent) and 8–14 days (yellow/warning). Added `srchEligibility` filter to `applyPatientSearch()` supporting four modes: Eligible Now, Expiring (≤14d), In Window, No Service Date.
  - `views/patients.ejs` — Added **90-Day Eligibility** filter dropdown to the advanced search row (clears with other filters).
  - `views/dashboard.ejs` — Added **90-Day Service Eligibility** widget card between the stat cards and charts. Shows 4 mini-stats with click-to-expand eligible patient table. FortiGate-safe anchor `xa-elig` added to the hidden URL map.
  - `public/js/dashboard.js` — Added `_api.elig` URL, `loadEligibility()`, `openEligibleList()`, `toggleEligibleList()` functions. Widget loads independently on page load and on manual refresh.

---

## [2.0.4] — 2026-06-23


### 🐛 Bug Fix — Trash button does nothing on failed backup history entries
**Files changed:** 3 | BUG-13

- **BUG-13** — Failed backup entries (status=failed, filename=null) could not be deleted from the Backup History table. Clicking the trash 🗑️ icon had no effect because:
  1. `deleteBackupEntry('')` was called with an empty filename
  2. The function hit `if (!filename) { await loadStatus(); return; }` and silently refreshed without deleting

  **Fix:** Three-file fix:
  - `services/backupService.js` — Added `deleteBackupHistoryEntry(id)` and `deleteBackupSiteHistoryEntry(id)` which remove log entries by their numeric `id` field without requiring a filename
  - `routes/apiRoutes.js` — Added `DELETE /api/backups/history/:id` and `DELETE /api/backups/site/history/:id` endpoints
  - `views/backups.ejs` — Updated `deleteBackupEntry(filename, id)` and `deleteSiteBackupEntry(filename, id)` to route to the new history endpoint when filename is empty. Trash button on failed entries now works correctly.

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
