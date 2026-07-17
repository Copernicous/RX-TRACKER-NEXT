# Changelog — Patient RX System

All notable changes are documented here with file-level detail and git commit references.
Format follows [Keep a Changelog](https://keepachangelog.com).

---

## [Unreleased]

- No unreleased changes.

## [3.0.5] - 2026-07-17

### [RELEASE-305] Exact configurable-day Call Center eligibility
**Files changed:** Shared service-window eligibility policy, Call Center controller/UI, regression tests, release metadata

- Call Center eligibility now begins on the exact day configured in Backoffice: day 80 for an 80-day setting, day 90 for a 90-day setting, or day N for a custom N-day setting.
- Dashboard, Patients, snapshots, and Call Center now use the same shared inclusive configured-day boundary.
- Removed the separate database cutoff comparison from Call Center patient selection.
- Updated the Call Center card label to show the exact configured eligibility day.
- Added deterministic boundary regression coverage.

**Database impact:**
- No migration or data reset is required.

## [3.0.4] - 2026-07-17

### [RELEASE-304] Call Center and Patient eligibility alignment
**Files changed:** Call Center API/UI, Patient eligibility filtering, configurable-window regression test, release metadata

- Fixed the remaining Call Center fixed-offset calculation so `eligibleSince` uses the configured service window plus the inclusive boundary day.
- Call Center queue and metrics responses now include `serviceWindowDays` and the server-calculated `eligibilityCutoff`.
- The Call Center screen displays the configured window and applies the server cutoff to new-service-date inputs.
- Aligned the Patients page eligibility filter with Dashboard and Call Center rules by limiting service-window eligibility categories to active patients, even when the separate Status filter is set to `All`.
- Added regression guards for the former fixed 91-day Call Center offset and active-patient population alignment.

**Database impact:**
- No migration or data reset is required.
- Existing settings and patient history are preserved.

## [3.0.3] - 2026-07-17

### [RELEASE-303] Configurable patient service window
**Files changed:** Backoffice settings, shared settings utilities, patient/RX eligibility controllers, Call Center queue, imports, dashboard and snapshot metrics, service-date cycles, patient/RX UI, regression tests, release metadata

- Replaced the fixed operational 90-day service window with a Backoffice-configurable value.
- Added **Backoffice > Settings > Service Window (Days)** with whole-number validation from 1 through 365 and a backward-compatible default of 90.
- Applied the configured value to patient eligibility, service-date locks, RX workflow deadlines, arrival-date validation, Call Center eligibility, import validation, dashboard/drilldown calculations, daily snapshots, service-date cycle end dates, and startup cycle repair.
- Corrected the Call Center `eligibleSince` value to use the configured window instead of the former fixed 91-day offset, and added shared window/cutoff metadata to Call Center queue and metrics responses.
- The Call Center screen now displays the configured window and applies the server cutoff to new-service-date inputs.
- Updated patient, RX, dashboard, and Backoffice displays to use the configured value.
- Service-window changes are persisted in the existing settings file and recorded in the audit log.
- Added `npm run test:service-window` coverage for defaults, custom persistence, boundary values, invalid-value fallback, and rule wiring.

**Database impact:**
- No database migration or data reset is required.
- Existing installations continue using 90 days until an administrator changes the setting.
- Changing the value recalculates runtime eligibility and deadlines from existing service dates; it does not rewrite service-date history.

## [3.0.2] - 2026-07-16

### [RELEASE-302] RX workflow date correction and Backoffice patient deletion repair
**Files changed:** RX workflow controller, Backoffice controller, shared date utilities, regression tests, release metadata

- Fixed workflow completion-date overrides rolling back one day when a date selected in Eastern Time was parsed as midnight UTC.
- Workflow override values are now validated as `YYYY-MM-DD` calendar dates and stored at local noon so the selected day remains stable through database and browser timezone conversion.
- Added a timezone regression test covering today's date and invalid calendar input.
- Fixed Backoffice permanent patient deletion when document attachments or patient service-date cycles still reference the patient or their RX records.
- Patient deletion now validates and locks every target first, verifies the exact number deleted, confirms no target remains, and rolls back the transaction if verification fails.
- Added regression coverage for active, inactive, soft-deleted, missing, incomplete, and still-present patient deletion cases.

**Database impact:**
- No schema migration or data reset is required.
- Existing records are preserved. Dates previously saved incorrectly must be corrected manually if needed.

## [3.0.1] - 2026-07-09

### [RELEASE-301] Patient service-date update locking and Call Center queue repair follow-up
**Files changed:** Patient update controller, Call Center queue repair regression tests, release metadata

- Added row-level locking around normal Patient updates so duplicate or concurrent saves of the same service-date change create only one Patient Service Date History entry.
- Added a regression test for concurrent normal Patient service-date updates.
- Preserved the v3.0.0 Call Center Backoffice queue repair behavior, including queue reopen handling and service-date cycle status repair.
- Bumped production package version to `3.0.1`.

**Database impact:**
- No schema changes and no destructive data reset are introduced.
- Existing patients, RX records, users, roles, permissions, settings, backups, audit logs, and changelog data are preserved.
- Patient service-date history remains append-only, but duplicate concurrent history rows for the same normal Patient service-date update are prevented.

## [3.0.0] - 2026-07-09

### [RELEASE-300] Dedicated Call Center workspace, analytics, restrictions, and smoke coverage
**Files changed:** Call Center workspace, dashboard analytics, reports, backoffice cleanup, role permissions, API restrictions, smoke tests, release metadata

- Added a dedicated `/call-center` workspace for Call Center users with no dashboard access, no export access from the queue, and no patient detail navigation.
- Added a restricted Call Center queue showing only active 90-day eligible patients, with sortable columns, search, and pagination limited to 5 or 10 rows.
- Added Call Center actions for marking calls, recording repeat call history with date/user attribution, entering append-only Call Center notes, and assigning new service dates.
- Added hard Call Center patient claims through `CallCenterLocks` so multiple agents cannot work the same patient at the same time.
- Added Call Center audit logging for calls, notes, service-date changes, lock activity, and restricted URL/API attempts.
- Added separate note source tracking so Call Center notes are distinguishable from normal patient notes and include author/date context.
- Added dashboard Call Center Metrics below RX Workflow Pipeline with date presets, custom ranges, chart type selection, user scope, CSV export, and drilldown popups with sorting/export.
- Added a Reports > Analytics & Export > Call Center Report with advanced filtering, totals, patient/user/call/note/service-date history, sorting, CSV export, and Excel export.
- Added Backoffice Call Center cleanup preview/purge controls for calls, Call Center notes, service-date event history, and stale locks.
- Added Backoffice repair behavior when deleting Call Center service-date history rows so matching stale Call Center service-date audit blockers and locks are removed and the patient can return to the available queue when the previous service date is restored.
- Fixed the Backoffice service-date-history delete repair so restored eligible patients return to the Call Center queue even when they still have same-day call history.
- Synced service-date cycle status during the Backoffice repair so the reverted old service date becomes the active cycle and the undone Call Center service-date cycle becomes historical.
- Moved the regular-user Call Center sidebar item below RX Records.
- Restricted `/api/version` and sensitive APIs so unauthenticated users receive `401`, Call Center users receive `403`, and administrators retain access.
- Added automated staging smoke coverage for Call Center API restrictions, full UI click paths, dashboard cards, calculators, drilldowns, exports, reports, URL injection defense, repeat calls, and service-date removal from the active queue.
- Bumped production package version to `3.0.0`.

**Database impact:**
- Adds startup verification for the `CallCenterLocks` table and related indexes.
- Adds `PatientNotes.source` startup verification so Call Center notes can be separated from normal patient notes.
- No destructive data reset is introduced.
- Existing patients, RX records, users, roles, permissions, settings, backups, audit logs, and changelog data are preserved.

## [2.0.73] - 2026-07-09

### [RELEASE-73] Patient CSV notes export
**Files changed:** Patients export UI, patient export API, release metadata

- Added a `Notes` column to the Patient List CSV export column selector.
- Included the main patient record notes in the exported `Notes` column.
- Included all separate Patient Notes modal entries in the same exported `Notes` column.
- Combined multiple notes into one CSV cell using a readable separator so spreadsheet tools keep each patient on one row.
- Loaded full Patient Notes details only for full patient export requests, keeping normal Patient List loading lightweight while preserving existing note-count badges.
- Bumped production package version to `2.0.73`.

**Database impact:**
- No schema changes and no data resets are introduced.
- Existing patient notes, patient records, RX records, users, roles, permissions, settings, backups, audit logs, and changelog data are preserved.
- Export behavior changes only the generated CSV content; stored data is not modified.

## [2.0.72] - 2026-07-05

### [RELEASE-72] Development setup hardening, configurable CORS, mobile layout, and backoffice 2FA fix
**Files changed:** Windows setup flow, environment loading, CORS configuration, database setup validation, dashboard/mobile CSS, Patients table, RX Records table, release metadata
**Commit references:** `9e6d656`, `d4b8c71`, `ed73519`, `d73dc4d`, `df28f85`, `3bddd1f`, `65ccdc4`

- Fixed the Backoffice 2FA reset lookup so the target user is resolved correctly.
- Hardened the Windows setup workflow and added a development database connection check script.
- Forced setup and app startup paths to load `.env` overrides consistently, reducing stale environment variable issues during setup, migrations, and local development.
- Made the performance indexes migration safer for fresh installs and repeat setup flows.
- Added configurable CORS origin support through `APP_ORIGINS`, `CORS_ORIGINS`, or `ALLOWED_ORIGINS`, while preserving `APP_ORIGIN` compatibility.
- Added `.env.example` guidance for multi-origin LAN/local browser URLs.
- Added mobile-only layout refinements for dashboards, workflow cards, menus, selectors, Patients, and RX Records so phone screens use smaller cards, scaled icons, readable labels, and card-style tables.
- Bumped production package version to `2.0.72`.

**Database impact:**
- No destructive schema changes and no data resets are introduced.
- Existing patients, RX records, users, roles, permissions, settings, backups, audit logs, and changelog data are preserved.
- Existing production environments using `APP_ORIGIN` continue to work; new multi-origin deployments can use `APP_ORIGINS`.
- Existing database migrations remain compatible; setup/migration handling is safer for new installs.

## [2.0.71] - 2026-06-30

### [RELEASE-71] Proxy 2FA, Data Import permission, changelog fallback, and packaging safety
**Files changed:** Changelog page, auth/CSRF middleware, dashboard shell scripts, Data Import access, release packaging, fresh-server recovery docs, release metadata

- Fixed the Changelog page so Release Notes render before optional shared app initialization.
- Added a safe plain-text fallback when the browser Markdown renderer is unavailable or fails.
- Added proxy-friendlier relative static asset paths on the Changelog page.
- Added a timeout and friendly unavailable state for the Git Commits panel so it cannot stay on a permanent loading spinner.
- Added `NEW_SERVER_SETUP_RECOVERY.md` to document fresh-server setup, PostgreSQL preparation, first-use admin seeding, admin recovery SQL, password reset, and database restore steps.
- Hardened release packaging so update zips include approved deployment files only and never include real `.env`, `.env.staging`, database dumps, SQL exports, or local runtime artifacts.
- Fixed Data Import access for copied/custom administrator-style roles by enforcing the role permission instead of hard-coded role names.
- Hardened CSRF handling for proxied requests by allowing CSRF tokens from headers, JSON/FormData body, and a session-bound dashboard token.
- Added versioned dashboard script URLs so FortiGate/browser cache loads the current dashboard JavaScript after a restart.
- Fixed 2FA activation through FortiGate by allowing only TOTP-protected 2FA actions to bypass CSRF transport checks; the current authenticator code is still required.
- Bumped production package version to `2.0.71`.

**Database impact:**
- No schema changes and no data changes are introduced.
- Existing patients, RX records, users, roles, permissions, settings, backups, audit logs, and changelog data are preserved.
- Existing users keep their current 2FA state in production; the staging-only 2FA reset was not included in this release package.

## [2.0.70] - 2026-06-30

### [HOTFIX-70] Patient add shortcut cleanup and RX role wording
**Files changed:** Patients UI, Roles UI, staging validation docs, release metadata

- Removed the redundant Patient List toolbar button labeled `Add Patient + RX`.
- Kept the Patient modal `Save & Add RX` workflow, which remains available after creating a patient or changing an existing patient service date when the user has both Patients Add and RX Records Add/Complete permission.
- Clarified the Roles editor for RX Records by renaming the workflow permission column to `Add RX / Complete`.
- Replaced the RX Records `Add New` dash-only cell with a `See Add RX / Complete` hint so administrators understand that adding RX records is controlled by the workflow permission.
- Added a Roles editor note explaining that adding RX records and completing RX workflow steps currently share `rx_records.canAdd`.
- Bumped production package version to `2.0.70`.

**Database impact:**
- No schema changes and no data changes are introduced.
- Existing patients, RX records, workflow records, roles, permissions, settings, and audit data are preserved.
- No role permission behavior changed; this release only clarifies the UI and removes a redundant shortcut.

## [2.0.69] - 2026-06-30

### [RELEASE-69] Security hardening, FortiGate support, role controls, and staging bug fixes
**Files changed:** web/API access hardening, document handling, System Settings security, FortiGate proxy handling, role permissions, dashboard UI, Clinics/Pharmacies CRUD, release packaging, release metadata
**Commit references:** `e3a99ed`, `8613e9a`, `b1a25e2`, `aa822c6`, `b24ef14`, `7c7635e`, `07dd17a`, `5fc6700`

#### Security, auth, and proxy hardening

- Promoted the tested security hardening from staging/development into production.
- Switched browser authentication to server-set `HttpOnly` cookies and removed browser-readable full-token compatibility paths.
- Added dedicated CSRF protection for cookie-authenticated unsafe requests.
- Added nonce-based CSP handling for inline script/style blocks while keeping legacy inline event/style attributes compatible until they are refactored.
- Added FortiGate-aware HTTPS handling so the browser can use HTTPS through the proxy while the internal Node backend remains HTTP.
- Centralized proxy/secure-request decisions so auth cookies, CSRF cookies, HTTPS redirects, and FortiGate backend behavior use the same rules.
- Added server-side idle-session enforcement for authenticated API requests and protected web pages, with `/api/session/activity` refreshing user activity.
- Added safe HTTPS/proxy environment keys to `.env.example`.
- Added safer rendering for System Settings user/settings tables and documented the implemented security controls.
- Encrypted SMTP passwords at rest when saved through System Settings.
- Removed document upload routes/UI and disabled Google Drive document API usage for uploads.

#### Security monitoring and admin alerts

- Added automatic security alert detection for failed-login thresholds, account lockouts, missing-auth spikes, permission-denied spikes, admin logins, security setting changes, API key changes, backup failures, missing scheduled backups, critical errors, and email configuration failures.
- Wired alert detection through auth, 2FA, RBAC, API key, backup, settings, and error paths.
- Added staging smoke coverage for security-alert wiring.

#### Roles, permissions, dashboard cleanup, and copy protection

- Added granular role controls for Print, Export, and Copy permissions.
- Added role-controlled screen copy protection so selected roles can be prevented from copying, cutting, selecting, context-menu copying, or dragging visible app data.
- Added server-side permission default/fallback handling so missing role flags default safely and do not break admin/read-only login.
- Fixed read/admin role permission edge cases caused by Print/Export permission changes, including admin login after disabling patient Print/Export.
- Updated role matrix/help documentation to explain Print, Export, and Copy permission behavior.
- Removed unused Dashboard export/search controls because the dashboard no longer exposes valid export/print actions.
- Prevented stale dashboard export behavior from producing misleading zero-valued exports.
- Kept Print/Export controls off Dashboard because Dashboard has no current print/export actions.
- Fixed the Roles editor blur/backdrop issue where editing/saving roles could leave the screen dimmed or stack modal backdrops.

#### Clinics, Pharmacies, and CRUD validation

- Fixed Clinics editing so optional fields can be cleared back to blank/null while required Name validation remains enforced.
- Fixed Pharmacies editing so optional fields can be cleared back to blank/null while required Name validation remains enforced.
- Updated shared CRUD save handling so cleared optional text/select/number fields are submitted as `null` instead of being silently omitted.
- Preserved the special blank-password behavior for editing users so leaving the password field blank does not overwrite an existing password.

#### Release packaging

- Hardened the release zip packaging step so `server.exe` is added with a read-sharing file stream instead of relying on PowerShell `Compress-Archive`, which can fail on freshly built `.exe` files.
- Bumped production package version to `2.0.69`.

**Database impact:**
- No schema changes and no destructive data changes are introduced.
- Existing patient, RX, workflow, audit, report, and settings data are preserved.
- SMTP password values are encrypted when saved through System Settings after this release.
- Existing production documents are not expected for this deployment; document uploads remain disabled.
- Role permission JSON may include `canPrint`, `canExport`, and `canCopy` flags; existing roles keep safe defaults where a flag is missing.

## [2.0.68] - 2026-06-29

### [HOTFIX-68] Dark-mode edit patient contrast fix
**Files changed:** Patient Management UI, Patient Timeline UI, shared CSS, release metadata

- Fixed the low-contrast `RX #` badge shown in Service Date History on the Edit Patient screen when dark mode is enabled.
- Applied the same readable badge styling to the Patient Timeline Service Date History so related RX pills stay consistent across both screens.
- Added dedicated light/dark theme styles for service-history RX badges instead of relying on Bootstrap `bg-light text-dark`, which conflicted with the app dark-mode overrides.
- Bumped production package version to `2.0.68`.

**Database impact:**
- No schema changes and no data changes are introduced.
- Existing patients, RX records, service-date history, workflow records, settings, and audit data are preserved.

## [2.0.67] - 2026-06-29

### [RELEASE-67] Security hardening and document upload removal
**Files changed:** web/API access hardening, System Settings email alerts, document handling, release metadata

- Removed patient and RX document upload UI and disabled the document upload API routes.
- Removed the Google Drive web-view link from document API responses and stopped requesting/storing that link for new document records.
- Kept existing document downloads role-restricted while forcing safer download headers for document responses.
- Added login enforcement for protected HTML pages so logged-out users are redirected to `/login`.
- Added safer rendering for System Settings email-alert user configuration and settings tables to reduce stored-XSS risk from user or settings values.
- Added audit logging for System Settings updates with sensitive setting values redacted.
- Expanded email alert settings to support global rules, granular per-user subscriptions, test alerts, and plain-language per-user configuration inspection.
- Bumped production package version to `2.0.67`.

**Database impact:**
- No destructive schema changes are introduced.
- Existing production documents are not expected for this deployment. Existing patient, RX, workflow, audit, settings, and report data are preserved.
- New System Settings updates will write audit records. Sensitive values such as passwords, secrets, tokens, and keys are redacted in the audit payload.

## [2.0.66] - 2026-06-28

### [RELEASE-66] Patient notice-group carousel
**Files changed:** Patients UI, release metadata

- Added a rotating notice-group carousel to the Patient Management alert banner.
- Changed the banner from a single visible task notice to `Notice N of X`, with a `Next` button that loops through available patient task groups.
- Included dynamic notice groups for expired 90-day windows with incomplete RX workflow, eligible patients, expiring service windows, missing service dates, active patients with no RX records, and missing required default information.
- Kept `Show Patients` contextual so it applies the filter for the currently visible notice group.
- Bumped production package version to `2.0.66`.

**Database impact:**
- No schema changes and no data changes are introduced.
- The notice groups are calculated from existing patient, RX, dashboard, and missing-info filters.

## [2.0.65] - 2026-06-28

### [RELEASE-65] Dashboard analytics and pagination performance
**Files changed:** dashboard analytics, RX Records API/UI, Reports API/UI, Patient/RX defaults, release metadata

- Promoted the tested staging dashboard analytics work into production, including the over-time dashboard graph improvements.
- Changed RX Records list display from browser-side pagination to database-level pagination. The database now filters, sorts, counts, and returns only the current page before the API hydrates visible rows.
- Kept legacy `/api/rx-records` full-array behavior for existing callers while the RX Records screen uses `paginated=true`.
- Changed the RX Records patient picker to load in the background so the full patient picker no longer blocks the RX table display.
- Added workflow-stage filtering support to the RX Records list.
- Changed Patient Report and RX Action Report display to server/database pagination. Exports still fetch the full filtered result only when CSV/Excel is requested.
- Defaulted Patient Management, RX Records, Patient Report, and RX Action Report page sizes to `10` rows.
- Bumped production package version to `2.0.65`.

**Database impact:**
- Normal production migration/startup verification is required so the `DailySnapshots` trend columns from `20260628103000-add-dashboard-trend-metrics-to-daily-snapshots.js` are present.
- No destructive schema or data changes are introduced. Existing patients, RX records, workflow history, and reports data are preserved.
- Existing performance indexes cover the new paginated patient/RX/report query paths. If production text searches grow very large later, the next tuneup would be adding stronger functional/trigram indexes for name/search fields.

**Staging speed results:**
- RX Records page display: from about `800-850 ms` to about `30-55 ms`.
- RX Records workflow stage filter: about `26 ms`.
- RX Records patient-name filter: about `35 ms`.
- Patient Report display: from about `1.2 sec` full load to about `28 ms` page load.
- RX Action Report display: from about `9.8 sec` full load to about `28 ms` page load.
- RX Action Report pending filter: about `20 ms`.

## [2.0.64] - 2026-06-28

### [HOTFIX-64] Production dashboard trend schema fallback
**Files changed:** 3 | dashboard graph schema guard, release metadata, production rebuild

- Expanded the dashboard trend schema guard so production waits for the full `DailySnapshots` trend column set before querying graphs.
- Prevented `/api/dashboard/charts` from throwing when older production databases are missing `patientsWithNoRx` or related trend columns.
- Bumped production package version to `2.0.64`.

## [2.0.63] - 2026-06-28

### [HOTFIX-63] Production graph fallback stabilization
**Files changed:** 1 | dashboard trend rendering fallback

- Added an explicit blank-state fallback so dashboard trend panels show a message when the snapshot series is empty or not yet available.
- Prevented the dashboard from leaving the trend cards blank when the graph payload has no usable points.
- Bumped production package version to `2.0.63`.

## [2.0.62] - 2026-06-28

### [HOTFIX-62] Production graphing schema guard
**Files changed:** 3 | dashboard graph safety guard, snapshot schema readiness check, release metadata

- Added a production-safe snapshot schema check so dashboard trend graphing waits until the new `DailySnapshots` trend columns exist.
- Prevented daily snapshot capture from running against an older production schema before the migration is applied.
- Added a visible dashboard message so graphing shows as migration-pending instead of failing silently.
- Bumped production package version to `2.0.62`.

## [2.0.61] - 2026-06-28

### [RELEASE-61] Dashboard trends, analytics pagination, and production report prep
**Files changed:** 30 | dashboard trend snapshots/UI, analytics and reports pagination, patient filters, staging QA data tools, release metadata

- Added dashboard trend history metrics to `DailySnapshots`, including patient eligibility, no-RX, service-date window, workflow, and activity counters.
- Added Dashboard trend graph cards for patients, RX/workflow, eligibility, and workflow completion, with shared range controls and CSV export support.
- Kept Login Activity metrics in the snapshot/backoffice layer while removing the Login Activity card from the main dashboard.
- Fixed dashboard trend date handling so date-only snapshot values stay on the intended local calendar day.
- Added server-side Backoffice Analytics pagination so large snapshot histories no longer delay the table display.
- Fixed Patient Report and RX Action Report row selectors so `10`, `20`, `50`, and `100` display only the selected page size.
- Defaulted Patient Management filtering toward active patients so Dashboard card drilldowns and list totals match unless inactive records are explicitly requested.
- Preserved staging/development bulk-data tooling for QA speed and functionality tests; production does not use the bulk seed path.
- Bumped production package version to `2.0.61`.

## [2.0.60] - 2026-06-28

### [RELEASE-60] Dashboard drilldowns and patient filter refinement
**Files changed:** 9 | dashboard controller/UI, patient filters, RX Records filters, release metadata

- Fixed the Dashboard Pending Deliveries full-page link so it opens RX Records with the pending workflow filter applied.
- Added RX Records Workflow Status filtering and sorting for Pending, Not Started, In Progress, and Completed workflow states.
- Added Patient Management filters for missing clinic, default pharmacy, patient transport, and pharmacy transport information.
- Added cascading Patient Management relationship filters so Clinic, Default Pharmacy, Patient Transport, and Pharmacy Transport options narrow to related patients.
- Fixed Dashboard RX drilldown workflow progress bars so partial workflows no longer render as fully complete.
- Bumped production package version to `2.0.60`.

## [2.0.59] - 2026-06-26

### [RELEASE-59] Service date cycle context auditing
**Files changed:** 30 | service date cycle model/migration/service, patient/RX controllers, importer guard, timeline/profile views, session heartbeat handling, staging smoke tests, release metadata

- Added service date cycles so each RX record can stay linked to the service-date period where it was created or imported.
- Preserved historical workflow/RX records when starting a new 90-day cycle instead of clearing records from previous cycles.
- Added importer protections and smoke coverage for old patients, expired service dates, and RX records with out-of-range service dates.
- Captured clinic, default pharmacy, patient transport, and pharmacy transport snapshots per service date cycle, including audit metadata when those defaults change.
- Added timeline/profile display, print, and export coverage for captured cycle defaults and related RX records.
- Added heartbeat/session handling improvements for the sudden logout workflow and verified the staged cycle-context smoke tests.
- Bumped production package version to `2.0.59`.

## [2.0.58] - 2026-06-26

### [RELEASE-58] Service date history, staging workflow, and print/export promotion
**Files changed:** 36 | staging workflow docs/config, patient service date history model/migration/service, patient/RX timeline views, runtime path helpers, production packaging metadata

- Added the staging workflow and branch-safe staging runtime configuration so new ideas can be tested separately before development and production promotion.
- Added patient service date history tracking with related RX service records while preserving the existing 90-day service-date behavior.
- Added print/export actions for patient timeline history, service-date related RX records, and patient RX history previous service date cycles.
- Fixed RX Records detail printing so the details modal closes before opening the print preview, avoiding stacked modal/backdrop behavior.
- Clarified patient timeline service-date history wording: full-history print/export buttons are now separate from per-row related RX print/CSV actions.
- Bumped production package version to `2.0.58`.

## [2.0.57] - 2026-06-26

### [HOTFIX-57] Production Google Drive document upload transport
**Files changed:** 4 | `services/documentStorageService.js`, `package.json`, `package-lock.json`, `.github/releases/v2.0.57.md`

- Replaced the production document-storage Google Drive runtime path with direct Drive REST calls using Node.js built-in `fetch`.
- Avoided the packaged-executable `gaxios`/`node-fetch` dynamic import path that caused `A dynamic import callback was not specified` during document uploads.
- Preserved the existing Drive folder structure, `GOOGLE_DRIVE_ROOT_FOLDER_ID` behavior, database attachment records, local-storage fallback behavior, and Drive delete/download support.
- Added a Drive download stream conversion so Google Drive files can still be opened from the compiled `server.exe`.
- Verified the Drive upload/download/delete cycle with mocked Google endpoints and bumped production package version to `2.0.57`.

## [2.0.56] - 2026-06-26

### [HOTFIX-56] Patient RX rename and document upload response handling
**Files changed:** 30 | `public/js/documents.js`, `controllers/twoFactorController.js`, `services/documentStorageService.js`, `utils/globalSettings.js`, `views/backoffice.ejs`, `data/settings.json`, `.env.example`, `scripts/setup-google-drive-oauth.js`, `fix_encoding.js`, `qa/smoke-qa.js`, `qa/start-local-qa.js`, QA labels/docs, operations docs, release metadata

- Renamed remaining `Daniely RX` product/default labels to `Patient RX`, including app defaults, 2FA issuer fallback, Backoffice placeholders, Google Drive folder defaults, QA labels, and operations documentation.
- Fixed document upload/list frontend handling so proxy HTML responses no longer surface as raw `Unexpected token '<'` JSON parser errors.
- Made document upload/list/delete/download URLs proxy-aware through `window.rxUrl(...)`, improving FortiGate compatibility for patient and RX document attachments.
- Updated the real production `.env` on the build machine to use `GOOGLE_DRIVE_ROOT_FOLDER_NAME="Patient RX Documents"` while preserving the configured Drive folder ID behavior.
- Hardened QA startup so an existing local HTTPS certificate is recreated if the QA passphrase changes.
- Fixed Needs Action smoke-test setup to seed the selected QA database, accept the current workflow-action banner text, and click the workflow button in the intended RX row.
- Verified the normal smoke path, Needs Action smoke path, RX override permission scenarios, and a focused patient document upload/list API cycle.
- Bumped production package version to `2.0.56`.

## [2.0.55] - 2026-06-25

### [OPS-55] Production release checklist packaging
**Files changed:** 6 | `PRODUCTION_RELEASE_CHECKLIST.md`, `.github/releases/v2.0.55.md`, `scripts/post-build.js`, `package.json`, `package-lock.json`, `CHANGELOG.md`

- Added a reusable production release checklist for versioning, GitHub release uploads, production machine upload steps, `.env` verification, and rollback notes.
- Updated the production post-build package to include `.env.example`, `PRODUCTION_RELEASE_CHECKLIST.md`, and the tag-specific `RELEASE_NOTES-v<version>.md` file in `dist/server-update-<version>.zip`.
- Kept real `.env` handling local to the build and production machines so secrets remain outside Git.
- Bumped production package version to `2.0.55`.

## [2.0.54] - 2026-06-25

### [FIX-54] GitHub release workflow compatibility
**Files changed:** 5 | `.github/workflows/release-notes-from-file.yml`, `.github/releases/v2.0.54.md`, `package.json`, `package-lock.json`, `CHANGELOG.md`

- Fixed the release-notes fallback script so Bash no longer parses an indented heredoc and exits with code `2`.
- Updated the release workflow to Node 24-compatible GitHub Actions majors for checkout and release publishing.
- Added tag-specific release notes for `v2.0.54` so the GitHub Release body is resolved directly.
- Bumped production package version to `2.0.54`.

## [2.0.53] - 2026-06-25

### [HOTFIX] Fortigate proxy script rewrite compatibility
**Files changed:** 16 | `.gitignore`, `public/js/patients.js`, `public/js/reports.js`, `public/js/audit-log.js`, `public/js/backoffice.js`, `public/js/dashboard.js`, `public/js/help.js`, `views/patients.ejs`, `views/reports.ejs`, `views/backups.ejs`, `views/changelog.ejs`, `views/patient-timeline.ejs`, `views/rx-records.ejs`, `package.json`, `package-lock.json`, `CHANGELOG.md`

- Replaced Fortigate-sensitive template-literal and `.map(...).join('')` HTML renderers on the production-breaking Patients and Reports pages.
- Built Patients alert banners with DOM nodes instead of conditional `innerHTML` assignments that SSL-VPN rewriting can corrupt.
- Added restart-based cache tokens to Patients and Reports scripts so the Fortigate portal pulls fresh JavaScript after deployment.
- Verified the production portal failures were limited to `/patients` and `/reports` before the hotfix package was prepared.
- Verified the developer target through Fortigate end-to-end after adding the developer LAN origin to the local `APP_ORIGIN` allowlist.
- Ignored the local Fortigate Chrome profile used for proxy QA so browser cache/session files do not enter source control.

## [2.0.52] - 2026-06-25

### [UX-12] Collapsible HTTP status meaning guide
**Files changed:** 5 | `public/js/backoffice-features.js`, `views/backoffice.ejs`, `package.json`, `package-lock.json`, `CHANGELOG.md`

- Made the Back Office Log Dashboard `HTTP Status Meaning` section collapsed by default so the page stays compact.
- Added a short quick-reference preview with common status chips and a `Show all` / `Hide details` toggle for the full 16-status explanation list.
- Verified in Chrome that the collapsed view shows no long detail rows and expanding reveals all HTTP status explanations.
- Bumped production package version to `2.0.52`.

## [2.0.51] - 2026-06-25

### [UX-11] Back Office Log Dashboard autocomplete and richer filters
**Files changed:** 6 | `services/logDashboardService.js`, `views/backoffice.ejs`, `public/js/backoffice-features.js`, `package.json`, `package-lock.json`, `CHANGELOG.md`

- Added autocomplete-backed filter fields for user, role, page/path, IP, browser/device, log source/file, HTTP method, severity, and log type.
- Restored richer Page Activity context from the older RX Log screen by adding role and browser filtering plus visible top-role and page-IP summaries.
- Added real backend filtering for role, browser, error-log source/severity, and server-log source, method, severity, and type so the new filters affect the dashboard data.
- Added Log Sources and HTTP Methods summaries inside Server Log Signals to make server-log analysis more useful than raw charts alone.
- Verified `/api/admin/log-dashboard` with the new filter parameters returns 200, serves autocomplete option lists, and the Back Office page renders the datalist-driven filters.
- Bumped production package version to `2.0.51`.

## [2.0.50] - 2026-06-25

### [UX-10] Back Office Log Dashboard pagination controls
**Files changed:** 6 | `public/js/backoffice-features.js`, `services/logDashboardService.js`, `views/backoffice.ejs`, `package.json`, `package-lock.json`, `CHANGELOG.md`

- Added top-of-section pagination controls and selectable row counts for Recent Page Visits, Audit Activity, Error Activity, and Recent Server Events.
- Added 10, 20, 50, 100, and 250 row-size options so master admins can review operational activity without a long uncontrolled page.
- Expanded the Log Dashboard API recent-row slices to support up to 250 rows for page visits, audit events, error events, and server-log events.
- Verified `/api/admin/log-dashboard?limit=250` returns 200 and the Back Office Log Dashboard renders four pagers with Recent Page Visits switching to 10 rows correctly.
- Bumped production package version to `2.0.50`.

## [2.0.49] - 2026-06-25

### [FIX-50] Back Office Log Dashboard auth and full analysis restore
**Files changed:** 7 | `services/logDashboardService.js`, `views/backoffice.ejs`, `public/js/backoffice.js`, `public/js/backoffice-features.js`, `package.json`, `package-lock.json`, `CHANGELOG.md`

- Fixed Back Office loading for cookie-authenticated master admins by injecting the server-authenticated user into the page instead of depending only on stale `localStorage`.
- Fixed Back Office API calls so they no longer send `Authorization: Bearer null`, allowing the FortiGate-compatible `rxToken` cookie fallback to work correctly.
- Restored richer RX Log Dashboard analysis with traffic-over-time charts, HTTP status mix chart, stability/risk scoring, dangerous-status focus, top IPs, browsers, server paths, log sources, and files scanned.
- Verified the Log Dashboard tab in Chrome with `/api/admin/log-dashboard` returning 200 and charts rendering.
- Bumped production package version to `2.0.49`.

## [2.0.48] - 2026-06-25

### [FEAT-25] Back Office RX Log Dashboard integration
**Files changed:** 9 | `services/logDashboardService.js`, `controllers/adminController.js`, `routes/apiRoutes.js`, `views/backoffice.ejs`, `public/js/backoffice.js`, `public/js/backoffice-features.js`, `package.json`, `package-lock.json`, `CHANGELOG.md`

- Ported the standalone RX log analysis dashboard into Back Office as a new master-admin `Log Dashboard` tab.
- Added `/api/admin/log-dashboard` to summarize page activity, audit activity, error logs, safe server-log signals, operational insights, and HTTP status explanations.
- Added filters for range, user, page/path, IP, HTTP status, and free-text search, plus CSV export from the Back Office tab.
- Shows real page visits from `UserActivityLogs` without patient identifiers or query-string details, with status badges linking to MDN status references.
- Bumped production package version to `2.0.48`.

## [2.0.47] - 2026-06-25

### [UX-09] Page Activity HTTP status explanations
**Files changed:** 5 | `views/audit-log.ejs`, `public/js/audit-log.js`, `package.json`, `package-lock.json`, `CHANGELOG.md`

- Added an expandable HTTP status quick guide to the Page Activity filters with short explanations for 200, 204, 302, 400, 401, 403, 404, 409, 429, and 500.
- Made each Page Activity status badge show a short label, hover explanation, and direct MDN reference link from the status number.
- Added common status codes to the Page Activity status filter so 204, 400, 409, and 429 can be isolated quickly.
- Bumped production package version to `2.0.47`.

### [QA-10] Smoke and Back Office version alignment
**Files changed:** 8 | `app.js`, `views/backoffice.ejs`, `qa/lib/qa-env.js`, `qa/smoke-qa.js`, `qa/.env.qa.example`, `qa/README.md`, `qa/QA-WEB-MANUAL.md`, `CHANGELOG.md`

- Added `QA_SMOKE_NEEDS_ACTION=false` to the QA environment template after reviewing the smoke runner.
- Routed the toggle through the shared QA config object and included the active mode in `smoke-report.json`.
- Added a smoke-test version assertion that compares `/api/version` against `package.json` and records both values in `smoke-report.json`.
- Added the application version badge and versioned script cache keys to Back Office.
- Documented the command-line way to run the optional Needs Action workflow smoke path.

## [2.0.46] - 2026-06-25

### [FEAT-24] RX Log page-visit activity tracking
**Files changed:** 12 | `models/useractivitylog.js`, `migrations/20260625120000-create-user-activity-logs.js`, `middleware/userActivityLogger.js`, `controllers/userActivityLogController.js`, `models/index.js`, `app.js`, `routes/apiRoutes.js`, `views/audit-log.ejs`, `public/js/audit-log.js`, `package.json`, `package-lock.json`, `CHANGELOG.md`

- Added a `UserActivityLog` model and migration to record authenticated web page visits with user ID, username/role snapshot, sanitized page path/title, timestamp, IP address, browser/user agent, referrer, and HTTP status code.
- Added web-only activity logging after `webAuth`, excluding API/static/download traffic and stripping query strings plus patient timeline IDs before saving.
- Added authenticated `/api/user-activity-logs` endpoints with user, role, page, status, date, IP, browser, and free-text filters.
- Added a new `Page Activity` tab to the RX Log/Audit dashboard with status-code explanations, pagination, filter controls, and CSV export.
- Bumped production package version to `2.0.46`.

## [2.0.45] - 2026-06-25

### [BUG-49] Patient modal permission refresh from server profile
**Files changed:** 3 | `public/js/app.js`, `public/js/patients.js`, `views/patients.ejs`

- Added server-authenticated user data to the Patients page so modal permissions do not depend only on stale browser `localStorage`.
- Patients now refresh `/api/auth/profile` on page load and update the browser user permission cache from the current database role.
- Patients page API calls now prefer the server auth cookie when server-authenticated page data exists, preventing stale browser JWTs from overriding the current session.
- Fixed the Patient modal banner hide logic to use `d-none` plus `display:none !important`, because Bootstrap `d-flex` was overriding plain inline `display: none`.
- Exposed patient soft-lock helpers to the global modal code to prevent `acquireModalLock is not defined` while opening the Patient modal.
- Bumped Patients page script cache keys to `2.0.45-patperm3` so browsers fetch the corrected permission logic immediately.
- Prevents the `View Only — you do not have permission to edit patient records.` banner from persisting after an Administrator/Supervisor role or permissions are corrected.

### [UX-08] Responsive web design safety layer
**Files changed:** 5 | `public/css/style.css`, `public/js/app.js`, `scripts/post-build.js`, `package.json`, `package-lock.json`

- Added tablet and phone responsive rules for the main navbar, content spacing, glass cards, filter rows, tables, pagination, modals, and document upload controls.
- Preserved desktop layout behavior while making tables horizontally scrollable on narrow screens instead of forcing page-wide overflow.
- Improved the mobile sidebar with an overlay, outside-click close behavior, and automatic close when a normal sidebar link is selected.
- Made patient/RX document upload controls and attachment rows stack cleanly on small screens.
- Updated the production post-build step to create `dist/server-update-<version>.zip` automatically.

## [2.0.44] - 2026-06-25

### [FEAT-19] Google Drive OAuth setup for document storage
**Files changed:** 6 | `package.json`, `package-lock.json`, `.gitignore`, `.env.example`, `scripts/setup-google-drive-oauth.js`, `CHANGELOG.md`

- Added `npm run drive:auth` to perform one-time OAuth authorization for a dedicated Google Drive document account.
- Added Google Drive API client dependency for future patient/RX document upload integration.
- Added local secret protection for `secrets/`, Google OAuth client JSON, and generated token files.
- Added Google Drive environment placeholders to `.env.example`.
- OAuth setup writes Drive credentials to ignored local files and updates `.env` without printing secret values.
- Fixed Windows OAuth browser launching so query-string parameters are preserved when opening Google's authorization URL.

### [FEAT-21] Patient and RX picture/document uploads
**Files changed:** 16 | `models/documentattachment.js`, `migrations/20260624130000-create-document-attachments.js`, `controllers/documentController.js`, `services/documentStorageService.js`, `routes/apiRoutes.js`, `models/index.js`, `models/patient.js`, `models/rxrecord.js`, `public/js/documents.js`, `public/js/patients.js`, `views/patients.ejs`, `views/rx-records.ejs`, `.env.example`, `.gitignore`, `OPERATIONS_MANUAL.md`, `CHANGELOG.md`

- Added a `DocumentAttachment` table/model for pictures and documents attached to patient records or RX records.
- Added authenticated upload/list/download/delete APIs for patient and RX attachments.
- Added Google Drive upload storage using the existing OAuth `.env` values; when Drive is enabled, uploads fail instead of silently archiving files on the server.
- Drive folders are organized by patient identity, with RX uploads nested under the matching patient folder.
- Added a reusable browser document widget for multi-file uploads, Drive/local badges, open/download links, and delete controls.
- Added the upload area to the Patient modal and RX Record Details modal; new patients must be saved before uploads are available.
- Restricted uploads to users with Edit permission on the owning Patients/RX Records module; read-only users can view/download only.

### [BUG-47] Administrator still saw patient View Only banner with stale auth data
**Files changed:** 2 | `public/js/app.js`, `views/patients.ejs`

- Hardened the shared browser permission helper to identify Administrator sessions from the stored user object, JWT payload, `Role.name`, or `roleId: 1`.
- Updated auth/page-permission checks to use the normalized current user helper instead of relying only on `localStorage.user.role`.
- Added a Patients page script cache-buster so browsers stop reusing the older modal permission logic after deployment.
- Prevents stale browser auth data from keeping the Patients modal in read-only mode after an Administrator account or role permissions are corrected.

### [BUG-48] Patient modal direct Administrator permission guard
**Files changed:** 2 | `public/js/patients.js`, `views/patients.ejs`

- Added a Patient-page-specific Administrator guard that checks stored user data, JWT role, `Role.name`, and `roleId: 1` before applying modal view-only restrictions.
- Updated Patient list/modal permission checks to use the same direct guard so an Administrator cannot be locked into the `View Only` state by stale frontend permission JSON.
- Bumped Patients page script cache keys again so browsers fetch the corrected modal code immediately after restart/deploy.

## [2.0.43] - 2026-06-25

### [BUG-46] Administrator patient modal incorrectly showed View Only
**Files changed:** 1 | `public/js/app.js`

- Fixed the shared frontend permission helper so `Administrator` users always receive full page permissions, matching the backend RBAC rule.
- Updated generic view-only modal and Save-button checks to use the same normalized page permission helper instead of reading stale `localStorage.user.permissions` directly.
- Prevents the Patients modal from showing `View Only — you do not have permission to edit patient records.` for Administrator sessions after role/permission data changes.

## [2.0.42] - 2026-06-25

### [BUG-45] Duplicate patient warning for existing patient states
**Files changed:** 5 | `package.json`, `package-lock.json`, `controllers/patientController.js`, `public/js/app.js`, `public/js/patients.js`

- Added duplicate-patient checking to the direct Patients page add flow before a new patient is created.
- Duplicate checks now normalize patient name and DOB inputs so matching is consistent with stored patient records.
- Duplicate lookup now includes active, inactive/suspended, and deleted patients so staff can see when the patient already exists in another state.
- Updated the duplicate warning popup with a Status column showing `Active`, `Suspended / Inactive`, or `Deleted`.
- Escaped duplicate warning modal content before rendering patient data into HTML.

## [2.0.41] - 2026-06-24

### [FEAT-18] Role-based 90-day override and expired RX resolution
**Files changed:** 17 | `app.js`, `package.json`, `package-lock.json`, `middleware/rbac.js`, `controllers/patientController.js`, `controllers/roleController.js`, `controllers/rxController.js`, `routes/apiRoutes.js`, `public/js/app.js`, `public/js/patients.js`, `public/js/roles.js`, `views/roles.ejs`, `views/rx-records.ejs`, `qa/smoke-qa.js`, `qa/README.md`, `qa/QA-WEB-MANUAL.md`, `scripts/test-rx-override-permissions.js`

- Added role permission `canOverrideExpired` so designated users can override 90-day service-date/workflow locks without requiring the global Backoffice override.
- Extended Roles Management with an `Override` checkbox and startup backfill for existing role permission JSON.
- Existing RX workflow can continue during the active 90-day window; after expiry, old-cycle workflow date edits require override access.
- Expired incomplete RX workflows now show a centered access guidance modal and a `Close RX Record` option that completes remaining workflow steps at the 90-day expiry date.
- Added Needs Action web QA coverage for the expired workflow banner and close-record modal path.
- Fixed Undo targeting so it follows the visible workflow order (`sequenceNumber`, then `id`) instead of database `createdAt`, preventing the wrong workflow step from being undone.
- Added `npm run test:rx-override` to validate override permissions, close-record behavior, and undo order against a guarded QA database.
- Fixed Read Only + `Override` behavior so a role with no Add/Edit permission can still close an expired RX record when override is granted.
- Fixed the expired RX modal close-button visibility so workflow closure is detected by exact active workflow steps instead of raw completed-row count.
- Fixed Patient `Override` behavior so authorized users can change a locked service date; override-only users can update `serviceDate` while other patient fields remain locked.
- Fixed RX Records `Override` behavior so override-only users can resolve expired workflow date locks without requiring full Edit permission.
- Added Windows Service installer/remover scripts to the release package and fixed service install to load `.env` from the same folder as `server.exe`.

## [2.0.40] - 2026-06-24

### [FEAT-17] QA smoke coverage for Needs Action queue
**Files changed:** 5 | `qa/smoke-qa.js`, `qa/web-ui.js`, `qa/web/public/index.html`, `qa/README.md`, `qa/QA-WEB-MANUAL.md`

- Added a dedicated QA web dashboard smoke task (`Run Needs Action Smoke`) behind a runtime flag (`QA_SMOKE_NEEDS_ACTION`).
- Smoke run seeds a stable needs-action fixture (expired service date + incomplete workflow) and validates:
  - Needs-Action filter behavior on `/patients`,
  - banner visibility,
  - fixture patient visibility in filtered results.
- Integrated the new task into `qa/web-ui.js` and dashboard controls so it can be run from `npm run qa:web` without custom scripts.
- Added concise documentation in QA manuals about the new option and what it validates.

## [2.0.39] - 2026-06-24

### [BUG-44] 90-Day Needs-Action workflow handling
**Files changed:** 4 | `controllers/patientController.js`, `controllers/rxController.js`, `public/js/patients.js`, `views/patients.ejs`

- Reworked 90-day controls so existing RX workflow actions are no longer blocked after day 90; service-date locking remains in patient/RX update paths where intended.
- Added backend `needsAction` classification on `/api/patients` for patients whose service date passed 90 days and whose RX tracker is still incomplete.
- Added Patient list filtering for **Needs Action (expired + open workflow)** plus an in-list action banner with a one-click filter shortcut.
- Kept patient and RX service-date overrides/lock checks untouched except where necessary to honor the same 90-day cycle strategy.

## [2.0.38] - 2026-06-24

### [BUG-41] Improve patient transport matching and clearer company validation messages
**Files changed:** 1 | `controllers/importController.js`

- Patient transport and pharmacy transport lookup in import now tolerates hidden whitespace/punctuation variants and token-based matches (for example `Health Transit` style values with non-breaking spaces or spacing differences).
- Transport validation messages now use the full "not found or inactive" wording for easier triage.
- Duplicate patient-code error now points to the first line number where that code was first seen.
- Duplicate patient-code validation behavior remains strict and continues to block import when duplicates are present across valid rows.

## [2.0.37] - 2026-06-24

### [BUG-40] Import validation for workflow date windows
**Files changed:** 2 | `controllers/importController.js`, `scripts/simulate-patient-workflow-import.js`

- Patient workflow import now enforces service-date rules:
  - first imported workflow step cannot be before the provided service date,
  - all imported workflow steps must be within service date + 90 days,
  - service date still auto-infers from the earliest workflow step when blank.
- Duplicate transport and patient validation errors from import continue to be handled as hard-stop blockers before any writes, and QA simulation output now reflects the same checks.

## [2.0.36] - 2026-06-24

### UX - Import template simplification
**Files changed:** 3 + 7 removed | `controllers/importController.js`, `public/js/import.js`, `views/import.ejs`, `public/samples/import/*`

- Combined patient sample/template download flow into one "Download CSV Template" action to remove ambiguity.
- Patient template now includes the header row plus one editable example row (uppercase names), while still validating required fields and workflow date columns.
- Removed unused import sample CSV assets from `public/samples/import` because the separate download path is no longer exposed.

## [2.0.35] - 2026-06-24

### UX - New RX prefills patient from context
**Files changed:** 2 | `views/rx-records.ejs`, `views/patient-timeline.ejs`

When users open RX Records from a patient context (Patient list, timeline, or search result), **New RX** now starts with the patient already selected:
- The incoming `patient`/`name` context is preserved from RX navigation URLs.
- New RX form preloads patient name, pharmacy, transport, and service date without requiring manual re-entry.
- Timeline and patient-entry entry points now send patient context consistently to RX Records links.

## [2.0.34] - 2026-06-24

### ✨ Feature — Patient import + workflow simulation + QA web action (FEAT-16)
**Files changed:** 9 | `controllers/importController.js`, `controllers/patientController.js`, `public/js/import.js`, `public/js/patients.js`, `qa/README.md`, `qa/qa-menu.bat`, `qa/web/public/index.html`, `qa/web-ui.js`, `public/samples/import/patients_import_sample.csv`, `scripts/simulate-patient-workflow-import.js`

**FEAT-16** — Added workflow-step-aware patient import:
- Patient CSV import now accepts the headers `RX Received Warehouse`, `On Route with Driver`, `Delivered`, `Mark as Received to print log`, `Signed by Pharmacy`, and `Archived on local and case close`.
- Any completed step date auto-generates corresponding RX workflow tracking entries in sequence order; all workflow entries and patient creation happen only when required validation passes.
- If service date is blank but workflow dates are present, service date is inferred from the earliest workflow step date and saved on both patient and RX row.
- Patient `firstName` / `lastName` are normalized to uppercase during import.
- Import now supports “all dates on same day”, “daily increment (+1 day)”, and “inferred service date” scenarios for QA verification.

**UX / QA**
- Added a new QA Web Dashboard action, `Run Import Workflow Simulation`, and menu option so teams can run the three scenarios above from `npm run qa:web` and the QA menu.
- Added `scripts/simulate-patient-workflow-import.js` as a text-only dry-run harness (no database writes), plus sample CSV files under `public/samples/import/` for import testing.

## [2.0.33] — 2026-06-24

### ✨ Feature — Backoffice 90-day service-date overrides + report filter linkage (FEAT-14 / FEAT-15)
**Files changed:** 12 | `controllers/adminController.js`, `controllers/patientController.js`, `controllers/rxController.js`, `routes/apiRoutes.js`, `public/js/backoffice-features.js`, `public/js/patients.js`, `public/js/reports.js`, `views/backoffice.ejs`, `views/rx-records.ejs`, `utils/globalSettings.js`, `data/settings.json`, `qa/QA-WEB-MANUAL.md`

**FEAT-14** — Report search filters now stay related to the filter the user started with. Selecting/searching by first name narrows the last name and related demographic/service filters instead of leaving unrelated values available.

**FEAT-15** — Added Backoffice 90-day service-date override tools for import correction:
- Per-patient override lets a master Backoffice user select one patient, set the corrected service date, optionally sync matching active RX records, and write an audit entry.
- Global override in Backoffice Settings temporarily lifts service-date 90-day blocks for all users while old/imported data is being corrected. It is saved in `data/settings.json`, defaults to `false`, and writes audit events when toggled.
- Patient and RX service-date guards now read shared global settings from `utils/globalSettings.js`; inactive-patient checks, workflow sequence rules, and legacy reset-cycle safeguards remain in place.
- Patient and RX UI now query `/api/service-date-override/status` so lock banners/readonly states match the active override mode.

**Rule clarity** — Patient service-date blocking is now consistent at the boundary: Day 90 remains blocked, Day 91 is allowed. Added a blocking-date timeline diagram to the QA manual to explain the service-date clock and the override behavior.

---

## [2.0.32] — 2026-06-24

### 🐛 Bug Fix — Workflow modal view-only banner + step badges showing 'undefined' (BUG-37 / BUG-38)
**Files changed:** 3 | `views/rx-records.ejs`, `routes/apiRoutes.js`, `middleware/rbac.js`

**BUG-37** — Workflow Tracking modal had no visual indicator that the user is in view-only mode. Added a blue “View Only — you do not have permission to update workflow steps.” info banner that appears at the top of the step list when `canComplete + canUndo + canWarehouse` are all false (Read Only / restricted roles).

**BUG-38** — Workflow step sequence number badges rendered as “undefined” for all roles. Root cause: `/api/lookup/workflow-actions` only returned `id` and `name`; `sequenceNumber` and `description` were missing. Fixed by adding both fields and sorting by `sequenceNumber ASC`. `medication-catalog` lookup also updated to include `description`.

**UI** — View Details eye button on RX Records table changed from `btn-outline-dark` (invisible on dark theme) to `btn-outline-info` — consistent with eye buttons on Patients and other CRUD pages.

**Role fix** — Test user `read` was incorrectly assigned “Add Only — No export” role instead of “Read Only”. Corrected in DB and session invalidated.

---

## [2.0.31] — 2026-06-24

### 🐛 Bug Fix — Workflow status + progress bar hidden on RX Records for restricted roles (BUG-36)
**Files changed:** 1 | `views/rx-records.ejs`

`loadRxDropdowns()` loaded pharmacies, transport companies, workflow actions and medication catalog directly from the RBAC-gated full API endpoints. When any of those were `visible:false` for a role, the calls returned 403 and `allWorkflowActions` was empty — causing the workflow status column, progress bar, and all form selectors to be blank. Switched all 5 calls to `/api/lookup/:module` (auth-only, no visibility check), matching the same fix applied to `patients.js` and `reports.js` in BUG-34.

---

## [2.0.30] — 2026-06-24

### ✨ Feature — Read Only role can now see Workflow Actions + RX Actions (FEAT-13)
**Files changed:** 1 | `middleware/rbac.js`

Read Only role defaults changed: `workflow_actions` and `medication_catalog` updated from `{ visible: false }` to `{ visible: true, canEdit: false, canAdd: false, canDelete: false }`. Read Only users can now browse both catalog pages and use the eye-icon view button to inspect each record. No write access. DB role record patched directly to take effect immediately without requiring admin re-save.

---

## [2.0.29] — 2026-06-24

### ✨ Feature — View-only mode for Patients + all CRUD pages (BUG-35 / FEAT-12)
**Files changed:** 2 | `public/js/patients.js`, `public/js/app.js`

Read Only users had no way to view record details — the Edit button was the only entry point into the modal, and it was hidden when `canEdit=false`. Fixed in two places:
- **Patients** (`patients.js`): Eye 👁 View button in every row when `canEdit=false`. Modal opens with all fields readonly/disabled, Save hidden, blue "View Only" banner at top.
- **All CRUD pages** (`app.js`) incl. RX Records, Pharmacies, Clinics, Transport, Workflow/RX Actions: Same pattern — eye icon in Actions column, modal fields locked, View Only banner injected.

---

## [2.0.28] — 2026-06-24

### 🐛 Bug Fix — Reference data dropdowns empty when module visibility is off (BUG-34)
**Files changed:** 3 | `routes/apiRoutes.js`, `public/js/patients.js`, `public/js/reports.js`

**Root cause:** The RBAC `visible` flag both hides the nav link **and** blocks the entire API (`GET /api/pharmacies` returns 403 when `visible: false`). When an admin set Reference Data modules to hidden for a role, all form dropdowns (pharmacies, clinics, transport companies, workflow actions, medication catalog) became empty — breaking patient record entry for that role.

**Fix:** Added a new `/api/lookup/:module` endpoint that only requires authentication — no visibility check. Forms that load dropdown data now use `/api/lookup/` instead of the full management endpoints. This decouples "can navigate to the management page" from "can read data to populate selects".

---

## [2.0.27] — 2026-06-24

### 🐛 Bug Fix — Read Only sees Edit/Disable/Add New on all unlisted pages (BUG-33)
**Files changed:** 1 | `public/js/app.js`

`getPagePerms()` URL→permission mapping was missing `/medication-catalog`, `/workflow-actions`, `/audit-log`, `/backups`, `/system-settings`, `/active-users`. Any unmapped path returned `fullAccess` (canEdit + canDelete = true), so Edit and Disable buttons rendered for all roles on those pages. Backend blocked the actual operations but UI was misleading. All 6 paths added to the mapping.

### ✨ Feature — Sidebar nav reorganization: Workflow Actions + RX Actions → Reference Data (FEAT-11)
**Files changed:** 1 | `views/partials/sidebar.ejs`

Workflow Actions and RX Actions are catalog/lookup tables, not administrative functions. Moved from the **Administration** group to **Reference Data**. Updated `refActive`, `adminActive`, `refVisible`, and `adminVisible` logic so the correct submenu auto-expands on those pages. Administration now contains only: Roles, User Management, System Settings, Backups, Data Import, Who's Online.

---

## [2.0.26] — 2026-06-24

### 🐛 Bug Fix — `Cannot find module 'ejs'` in server.exe (BUG-32)
**Files changed:** 1 | `app.js`

**Root cause:** `app.set('view engine', 'ejs')` makes Express call `require(ext)` internally where `ext` is a runtime variable. `@yao-pkg/pkg` cannot statically analyze dynamic `require()` calls — it only bundles modules it sees as **string literals** at compile time. Even with `ejs` listed in `pkg.scripts`, the dynamic path was never resolved inside the snapshot.

**Fix:** Added `const ejs = require('ejs')` and `app.engine('ejs', ejs.renderFile)` before the `app.set('view engine', 'ejs')` call. The static string literal `'ejs'` is now visible to pkg at compile time and is correctly bundled into `server.exe`.

---

## [2.0.25] — 2026-06-24

### 🐛 Bug Fix — Error Log Export Incomplete (BUG-31)
**Files changed:** 2

- **`controllers/adminController.js`** — `getErrorLogs` page size was hard-capped at `200`. Export sends `size=9999` but silently received only 200 rows. Fix: when `size >= 9999`, cap is raised to `10000` (export mode detection).
- **`public/js/backoffice-features.js`** — `exportErrorLogsCSV()`: `stack` and `message` fields contain `\n` newlines. Even inside RFC 4180 quoted CSV fields, some parsers (Excel) split on bare `\n`, causing each stack frame to appear as a new row. Fix: `flattenField()` replaces all `\r\n`, `\n`, `\r` with ` | ` before encoding. Also added `ipAddress` column to the export (was missing).

---

## [2.0.24] — 2026-06-24

### ✨ Feature — Site Backup History: Filename + Path Column (FEAT-09b)
**Files changed:** 1

- **`views/backups.ejs`** — `renderSiteHistory()` now accepts `backupDir` (passed from `loadSiteStatus()`). Added **File / Path** column between "Triggered By" and "Size" — identical pattern to the DB dump history table. Shows ZIP filename in `font-monospace`; full absolute path below in small muted text. Uses `b.filepath` from log entry if present (all new backups), falls back to `backupDir + filename` for older entries. Failed entries show `—`.

---

## [2.0.23] — 2026-06-24

### 🐛 Bug Fix — Nodemon Infinite Restart Loop (BUG-29)
**Files changed:** 1 | BUG-29

- **`package.json`** — Added `nodemonConfig` block. Root cause: `backupService.js` (BUG-28 fix) now writes to `data/settings.json` on startup to persist schedules. Nodemon watches `.json` files by default, detected the write, restarted the app, which triggered another write — infinite loop.

  **Fix:** `nodemonConfig.watch` restricts watching to source directories only (`app.js`, `controllers/`, `middleware/`, `models/`, `routes/`, `services/`, `views/`, `public/`, `config/`). `nodemonConfig.ignore` explicitly excludes all runtime-written paths: `data/*`, `logs/*`, `backups/*`, `dist/*`, `*.log`, `*.log.json`.

---

## [2.0.22] — 2026-06-24

### ✨ Feature — DB Backup History: Filename + Path Column, and Configurable Dump Directory

**Files changed:** 3 | FEAT-09, FEAT-10

#### FEAT-09 — Filename and full path shown in DB backup history table
- **`services/backupService.js`** — `runBackup()` now stores `filepath` (full absolute path) in each backup log entry alongside `filename`.
- **`views/backups.ejs`** — `renderHistory()` accepts a second `backupDir` argument (passed from `loadStatus()`). A new **File / Path** column is added between "Triggered By" and "Size". The filename is displayed in `font-monospace`; below it the full path is shown in a smaller muted style. Failed entries (no file) show a dash.

#### FEAT-10 — DB dump backup folder is now configurable (was fixed at `backups/`)
- **`services/backupService.js`** — `BACKUP_DIR` constant removed. Replaced with dynamic `getDbBackupDir()` (reads `data/settings.json` → `dbBackupPath`, falls back to `WRITABLE_ROOT/backups`) and `setDbBackupDir()` (persists to `settings.json`, creates the new directory). All internal usages of `BACKUP_DIR` / `BACKUP_LOG` updated to call the function at runtime. `runBackup`, `pruneOldBackups`, `syncLogWithDisk`, `deleteBackup`, `restoreBackup` all use the dynamic path.
- **`routes/apiRoutes.js`** — `POST /api/backups/config` now accepts `dbBackupDir` (as well as `siteBackupDir`). Either or both can be sent in the same request. `GET /api/backups/download/:filename` updated to use `getDbBackupDir()` instead of the hardcoded `../backups/` path.
- **`views/backups.ejs`** — Added **Change DB Dump Folder** editor (blue, above the existing site folder editor). `loadBackupConfig()` now also populates the `dbBackupDirInput` field. New `saveDbBackupDir()` JS function posts to `POST /api/backups/config`. Updated DB info card description to say "Folder is configurable" instead of "Kept inside the project folder".

---

## [2.0.21] — 2026-06-24

### 🐛 Bug Fix — Backup Schedule Save Not Updating (BUG-27 + BUG-28)
**Files changed:** 3 | BUG-27, BUG-28

#### BUG-27 — `POST /api/backups/schedule` silently accepted invalid cron expressions
- **`services/backupService.js`** — `startScheduler()` and `startSiteBackupScheduler()` now return `{ ok, error }` instead of `void`. On invalid cron expression, they return `{ ok: false, error: 'Invalid cron expression: ...' }` without modifying `_currentSchedule`.
- **`routes/apiRoutes.js`** — Both `POST /api/backups/schedule` and `POST /api/backups/site/schedule` now check the return value. Invalid expressions get a `400 Bad Request` with the exact error. Previously the API always returned `200 { ok: true }` regardless, so the UI showed a success toast but `loadStatus()` revealed the old schedule — making it appear as if the save "didn't work."
- **`views/backups.ejs`** — `saveSchedule()` and `saveSiteSchedule()` now parse the `400` error body and show the server error text in the toast (e.g. `"Schedule not saved: Invalid cron expression: xyz"`). On failure, `loadStatus()` is still called so the input field reverts to the current (unchanged) schedule.

#### BUG-28 — Schedule reverts to `.env` default on server restart
- **`services/backupService.js`** — `startScheduler()` and `startSiteBackupScheduler()` now write the accepted schedule to `data/settings.json` (same file used by `siteBackupPath`). On module load, the persisted value is read first; if absent, falls back to `process.env.BACKUP_SCHEDULE` / `SITE_BACKUP_SCHEDULE`. Disabled state (`off`) is also persisted.

---

## [2.0.20] — 2026-06-24

### 🔒 Security / API — `changePassword` Returns 400 Instead of 401 on Wrong Current Password
**Files changed:** 1 | SEC-07

- **`controllers/authController.js`** — `changePassword()` was returning `401 Unauthorized` when the user supplied an incorrect current password. This was semantically wrong: `401` means the request is unauthenticated (missing/invalid JWT), while `400 Bad Request` is correct for a client input error where the session itself is valid.

  **Impact:** Some `fetchWithAuth()` callers treat 401 as a global "session expired" signal and auto-redirect to login. A wrong current password was incorrectly triggering the session-expired redirect flow in certain browsers/timing conditions.

  **Fix:** Status code changed from `401` → `400`. The error message is unchanged: `"Current password is incorrect."` The frontend `changePassword()` in `dashboard.js` now handles the 400 response correctly via the `showChangePasswordError()` helper (see below).

### 🐛 Bug Fix — Global Shake Animation Utility Added to style.css (BUG-24)
**Files changed:** 1 | BUG-24

- **`public/css/style.css`** — Page-specific shake animations were defined inline in each EJS view's `<style>` block. This led to duplicated keyframe definitions and inconsistent timing/easing between views. A new unified global shake utility is now available across all pages without inline `<style>` overhead.

  **Added:**
  ```css
  @keyframes rxShake {
      0%, 100% { transform: translate3d(0,0,0); }
      15%      { transform: translate3d(-8px,0,0); }
      ...
  }
  .shake-feedback {
      animation: rxShake 0.55s cubic-bezier(.36,.07,.19,.97) both;
      will-change: transform;
  }
  ```

  Using `translate3d()` instead of `translateX()` ensures the animation runs on the GPU compositing layer, resolving the `backdrop-filter` conflict that caused BUG-23.

  **Usage pattern:**
  ```js
  shakeFeedback(document.getElementById('someElement'));
  ```

### 🐛 Bug Fix — Change Password Error Handling Refactored with Shake Feedback (BUG-25)
**Files changed:** 1 | BUG-25

- **`public/js/dashboard.js`** — The `changePassword()` function had several issues:
  1. Error display was inline (4 repeated `errEl.textContent = ...; errEl.classList.remove('d-none')` callsites) with no visual feedback beyond text.
  2. No null-guard on the `fetchWithAuth()` return value (returns `null` on 403/network failure).
  3. On `401` responses (now `400`), the error message would appear but no shake animation fired.

  **Fix — two new helpers extracted:**
  ```js
  function shakeFeedback(el) { ... }     // Generic element shake (uses .shake-feedback class)
  function showChangePasswordError(msg) { ... }  // Sets #cpError text + calls shakeFeedback()
  ```

  **`changePassword()` updated:**
  - All error paths now call `showChangePasswordError()` for consistent shake + message.
  - Added `if (!res) return;` null-guard at top of `.then()` — prevents `res.json()` TypeError when `fetchWithAuth` returns null on 403/network error.
  - `.catch()` now calls `showChangePasswordError('Network error.')` instead of bare DOM manipulation.

### 🐛 Bug Fix — Login Shake Animation Scoped and Extracted as Named Function (BUG-26)
**Files changed:** 1 | BUG-26

- **`views/login.ejs`** — The login shake animation had two related issues introduced in BUG-23's fix:
  1. `@keyframes shake` was a generic name — it could conflict with the new global `rxShake` keyframe added to `style.css` in BUG-24.
  2. The shake logic in `showError()` was inline (`classList.remove/add` + bare `setTimeout`) with no mechanism to cancel a previous timer before restarting — rapid failed logins could stack multiple timers.

  **Fix:**
  - Keyframe renamed: `@keyframes shake` → `@keyframes loginShake`
  - CSS selector tightened: `.shake-card` → `.login-card.shake-card` (prevents global `.shake-card` from triggering the login animation on other elements)
  - `shakeLoginCard()` extracted as a named function:
    ```js
    function shakeLoginCard() {
        var card = document.querySelector('.login-card');
        if (!card) return;
        if (window._loginShakeTimer) clearTimeout(window._loginShakeTimer);
        card.classList.remove('shake-card');
        void card.offsetWidth; // force reflow
        card.classList.add('shake-card');
        window._loginShakeTimer = setTimeout(function() {
            card.classList.remove('shake-card');
            window._loginShakeTimer = null;
        }, 650);
    }
    ```
  - `showError()` now calls `shakeLoginCard()` instead of the inline timer block.
  - Early return error (`username/password empty`) now routed through `showLoginError()` for consistency.
  - `will-change: transform` added to `.login-card.shake-card` for GPU compositing hint.

---

## [2.0.19] — 2026-06-24

### 🔒 Security — Password Change No Longer Leaves Current Session Active (BUG-22)
**Files changed:** 2 | BUG-22

- **BUG-22** After changing password, the user was shown a success toast but the current browser session was **never terminated** — the old JWT remained in localStorage and was still accepted by the server. The user could continue browsing until the next automatic API call (e.g., heartbeat at 30s) happened to fail with 401.

  **Root cause:** `changePassword()` in `public/js/dashboard.js` showed a success message and cleared the input fields, but did NOT clear `localStorage.token`, did NOT remove the `rxToken` cookie, and did NOT redirect to login.

  **Fix (`dashboard.js`):** After a successful password change, a 1.2-second toast is shown then the client immediately:
  1. Clears `localStorage.token` and `localStorage.user`
  2. Expires the JS-writable `rxToken` cookie
  3. Navigates to `/login?reason=password-changed`

  **Fix (`login.ejs`):** Added handler for `?reason=password-changed` that shows a blue informational banner — *"Password changed successfully. Please log in with your new password."* — instead of a red error.

### 🔒 Security — Token Revocation Bypass for Pre-feature Tokens Closed (SEC-05)
**Files changed:** 1 | SEC-05

- **SEC-05** `middleware/auth.js` — The tokenVersion check had a bypass: tokens issued **before the `tv` claim was added** (v2.0.14) had no `tv` field in the JWT. The old code only checked `if (typeof decoded.tv === 'number')`, so pre-feature tokens skipped the DB check entirely and remained valid indefinitely — even after a password change.

  **Fix:** The DB tokenVersion check now always runs. Logic:
  - If `dbVersion > 0` (user has changed password at least once) AND the token has no `tv` claim → **reject** (old token, account has been updated).
  - If the token has a `tv` claim AND it doesn't match `dbVersion` → **reject** (password changed since this token was issued).
  - If `dbVersion === 0` AND no `tv` claim → **allow** (user has never changed password, feature just landed).

### 🐛 Bug Fix — Login Shake Animation Broken (BUG-23)
**Files changed:** 1 | BUG-23

- **BUG-23** `views/login.ejs` — The shake animation on wrong password (`shake-card` CSS class + `@keyframes shake`) stopped working because `.login-card` uses `backdrop-filter: blur(20px)`. This is a known Chromium/Edge issue: `backdrop-filter` creates an isolated stacking context that can block CSS `transform` animations on the same element.

  **Fix:** Added `transform: translateZ(0)` to `.login-card` base styles. This forces the browser to promote the element to its own GPU compositing layer *before* the animation starts, which resolves the conflict. The shake animation now works correctly across Chrome, Edge, and Firefox.

### 📦 Build — dist/ Is Now a Complete Deployment Package (IMPROVE-08)
**Files changed:** 2 | IMPROVE-08

- **IMPROVE-08** Every `npm run build:exe` now produces a `dist/` folder containing all files needed on the production server — not just the binary.

  **`scripts/post-build.js`** (new file) is called at the end of the build and copies:
  - `server.exe` — production binary (built by pkg)
  - `.env` — environment configuration
  - `RX-Manager.bat` — production management menu
  - `CHANGELOG.md` — what changed in this release
  - `DEFERRED-ITEMS.txt` — security / tech-debt tracking
  - `OPERATIONS_MANUAL.md` — admin and recovery procedures

  **`package.json`** `build:exe` script updated to call `node scripts/post-build.js` instead of the inline `copyFileSync` one-liner.

---

## [2.0.18] — 2026-06-24


### ✅ QA — Playwright Smoke Test Suite Integrated (DEFERRED-04 CLOSED)
**Files changed:** 3 | QA-01

- **QA-01** A full browser-based smoke test suite (`qa/` folder) is now part of the development and release workflow. It was authored separately and wired into the project in this release.

  **What the smoke test covers (`qa/smoke-qa.js`):**
  - HTTPS login through local self-signed proxy
  - All 18 main pages reachable (dashboard, patients, RX records, reports, audit log, import, pharmacies, transport, clinics, workflow, medication catalog, users, roles, backups, system settings, active users, changelog)
  - Patients: search for seeded QA patient, add modal, export button, advanced filters
  - RX Records: search, workflow modal, history modal, clear filters
  - CRUD pages: seeded fake data visible + add modal clickable (pharmacies, clinics, transport, workflow, medication)
  - Reports, Backups, System Settings pages load
  - **Security regression:** Non-isMaster admin blocked from `/backoffice` — will FAIL if the check breaks
  - Authenticated API dashboard stats respond correctly

  **Additional QA tools:**
  - `qa/seed-qa-data.js` — idempotent fake data seeder (QA Patient, QA Pharmacy, QA Clinic, etc.) targeting `patient_rx_qa` DB
  - `qa/start-local-qa.js` — starts backend on port `3001` + HTTPS proxy on `3443`
  - `qa/stop-local-qa.js` — stops only QA processes (PIDs tracked in `qa/pids/`)
  - `qa/web-ui.js` — local web control panel at `http://127.0.0.1:3200`
  - `qa/status.js` — shows ports, PIDs, and last result summary
  - `qa/view-last-result.js` — prints last smoke report
  - `qa/qa-menu.bat` — Windows menu for all QA commands
  - `qa/.env.qa.example` — QA config template

  **FortiGate mode:** Paste the FortiGate web URL into the web dashboard → `Run FortiGate Smoke` — runs the same checks through the real proxy without saving the URL.

  **Safety model:**
  - Default QA database: `patient_rx_qa` (never the production DB)
  - Seeder refuses non-QA database names unless `QA_ALLOW_NON_QA_DB=true`
  - Destructive/heavy actions intentionally skipped (backup restore, delete, purge)
  - `playwright-core` is a devDependency — NOT bundled in `server.exe`

- **RX-Manager.bat** — Added **Option [21] Launch QA Smoke Test Menu** which opens `qa/qa-menu.bat`, checks that the `qa/` folder exists, and shows first-time setup instructions.

- **DEFERRED-ITEMS.txt** — `DEFERRED-04` (no automated test suite) marked as ✅ RESOLVED with full documentation of what the suite covers.

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
