# RX Tracker NEXT project handoff

Last updated: 2026-07-30

This file is the sanitized continuity record for a future administrator or
Codex session. It intentionally contains no credentials, `.env` values,
patient data, SIP secrets, pairing secrets, or production database dumps.

## Current state

- Release candidate **v4.0.0-next.45** corrects the RX Details response so stored Patient Transport and Pharmacy Transport assignments are resolved and displayed after RX Profile Sync. Playwright verification against test-server `v4.0.0-next.44` confirmed RX #1296 stored the synchronized transport ID and the sync scanner reported no differences while the single-record API omitted both transport associations. The candidate reuses the canonical RX include set and adds a focused regression assertion. No database migration, workflow-action configuration, synchronization behavior, or business-data change is included.

- Official **v4.0.0-next.44** was published on 2026-07-30 from `main` commit `f2a2e8752bc93a7d9895d5cf2319515809b79f7b` after the PostgreSQL lifecycle CI, CodeQL, and tagged compiled-release workflow passed. It strengthens RX Profile Sync transport persistence, adds master-only multi-RX selection (maximum 100 per batch), and exports completed sync audit history as CSV. Pharmacy synchronization retains its existing update path; blank Patient assignments do not erase RX values; and each changed RX receives independent RX History and Audit Log entries. No database migration, workflow-action configuration, automatic background sync, or business-data rewrite is included. It is ready for test-server validation before production. Published SHA-256 values: `server-update-4.0.0-next.44.zip` `683dd8439eb12dc4a500a145ec3361c85de552fedcb3ed6ba0105ab8cbb0b768`, `server.exe` `36fd22eba11161b0b3be5ecaf758b7ea4247b8000d52c709a9ab9ea037333842`, and `rx-db.exe` `5058a203b23225861ac2c3b3c5798bb77d1f13b0ffb1f1b328fa0a759f13edd1`.
- Official **v4.0.0-next.43** was published on 2026-07-30 from `main` commit `d40bd5f93c2739e213e6fdfcae830087439d1c20` after the PostgreSQL lifecycle CI and tagged compiled-release workflow passed. It corrects RX Records multi-select filter layout: selected text remains inside the control, multiple selections use a compact count, and a single long selection truncates safely. No database migration, workflow-action configuration, or business-data change is included. It is ready for test-server validation before any production update. Published SHA-256 values: `server-update-4.0.0-next.43.zip` `83130a5d4d329a53699249776471cd95bddc6515266bf2094d7745225869ad9b`, `server.exe` `22c9cd2a52fb771c8c126d2a70238aaf6b694953caa4c9c256605330ddf0f492`, and `rx-db.exe` `6a9ceb92a3ff4251028479c3f6ed01362e707aceef595a66c2f3866e99648f65`.

- Official **v4.0.0-next.42** was published on 2026-07-30 from `main` commit `dbe18da13fb2a34e8e7960021e64f7cbb898ffa1` after the PostgreSQL lifecycle CI and tagged compiled-release workflow passed. It adds a master-administrator RX Profile Sync screen that can search a specific active RX record, show Patient-to-RX Pharmacy/Transport differences, and apply only selected fields with RX History and Audit Log entries. It does not modify the Patient profile, workflow/delivery state, future RX creation, deleted records, or any RX record that the administrator did not select. No database migration or automatic bulk synchronization is included. It is ready for test-server validation before any production update. Published SHA-256 values: `server-update-4.0.0-next.42.zip` `0ca52e12d2d3f1f3e80f04427e50704317feeebf4cd9d91344a7d52fc521c4c5`, `server.exe` `49225f3655f14f2897734af8001c8beba56c6db3a7250d4b0542499a1a97398f`, and `rx-db.exe` `b908b8d34d7f863409dffe202f13874226604b9c68cdaa0713f47ab44371a91d`.

- Official **v4.0.0-next.41** was published on 2026-07-30 from `main` commit `ac143a0776a30e9474875b823d680df1114a0216` after the PostgreSQL lifecycle CI and tagged compiled-release workflow passed. It fixes Delivery Log preview closing, excludes fully closed/archived RX workflows from PDF and Excel, and reserves acknowledgement space to prevent row/signature overlap. No database migration, workflow-action configuration, or business-data change is included. It is ready for test-server validation before any production update. Published SHA-256 values: `server-update-4.0.0-next.41.zip` `2de2eb0d3ba073d8113122372e41cb901e27b65876c98dce872464d8cec27e2b`, `server.exe` `20af7817c9456623aef2da3dd0cb9ded2d75889eb20fcb1162764139078d7dce`, and `rx-db.exe` `7681f60ff3a25bcd0832af80cba7258d5ebdc014b6c8237178e479bd0104d91a`.

- Official **v4.0.0-next.40** was published on 2026-07-30 from `main` commit
  `07a28abd0daf7beca34278a2df2c10c2fdcf6f59` after PostgreSQL lifecycle CI and
  the tagged compiled-release workflow passed. It adds native browser Save As
  selection for Patient CSV, RX Records CSV, and Delivery Log Excel exports on
  secure browser origins, with the existing browser-download fallback otherwise.
  It also simplifies the Delivery Log audit strip, changes report references
  from `RX-LOG-...` to `LOG-...`, and replaces the PDF preview window address
  from `about:blank` to a same-origin preview address without changing the
  validated page footer layout. No database migration, workflow configuration,
  or business-data change is included. Production remains on
  **v4.0.0-next.35** until Project Control option **8** then **15** installs
  this release. Published SHA-256 values: `server-update-4.0.0-next.40.zip`
  `bac399de74e6221e222de43461b740fada42b342abe4c547acdfacb35af92d46`,
  `server.exe` `e119844461ecb1c5771aec7316d5c5437765eb40c33e70e1916a7bcc9c64f8f2`,
  and `rx-db.exe` `9bf8547f780c72c430af2f6d6bfe2bdcd91fffd58da02675de4e5b610cf32957`.

- Official **v4.0.0-next.39** was published on 2026-07-30 from `main` commit
  `a2f069c0e871e01157813326674894651038665c` after PostgreSQL lifecycle CI
  and the tagged compiled-release workflow passed. It corrects only Delivery
  Log Excel browser downloads: readable report-reference `.xls` filenames,
  UTF-8 BOM, and delayed temporary-link cleanup. No database migration,
  workflow configuration, PDF, CSV, or business-data behavior changed.
  Production remains on **v4.0.0-next.35** until Project Control option **8**
  then **15** installs this release. Published SHA-256 values:
  `server-update-4.0.0-next.39.zip` `2ce75ce63a764b2a7aa81c6d45dba8b2a25471794eb4f9e6aa33f7a508d7a3d3`, `server.exe` `ede40e6869d9f36cf82e427d41c044021215d6913cca07b03b7a53ce64d56b92`,
  and `rx-db.exe` `b11eb0ccd73ea7ca587150962d3e8f46529a6ea4c2d9f8995b35a777b65c8cb8`.
- Official **v4.0.0-next.38** was published on 2026-07-30 from `main` commit
  `d9d72af857f8343cab6e1cd61bff16672d6d07ea` after the required PostgreSQL
  lifecycle CI passed and the tagged release workflow built, verified, and
  published the compiled assets. The release is published but not installed:
  production remains on **v4.0.0-next.35** until an operator runs Project
  Control option **8** followed by option **15**. Published SHA-256 values:
  `server-update-4.0.0-next.38.zip`
  `44652df56c87ba17e737e78f9922df671ae8df16c2e3d347767feb68bcada5e3`,
  `server.exe` `aaa2b623e2c40403709d6db0ab0d6cadbc749d0569824a349fe3b6d4d8e769ba`,
  and `rx-db.exe` `dfcb88f314407a081bb7b8a49959fc84b39d8e5f4ae4f4392fa9a1f337ca9b0a`.
  It contains two additive audited migrations:
  `20260729233000-add-delivery-outcome-mode-to-workflow-actions.js` and
  `20260730000000-add-rx-delivery-outcome.js`. The migrations add outcome
  configuration/data fields and an index only; they do not reseed, rename,
  enable, disable, or reorder existing configured RX Actions, and they do not
  rewrite business data. Before option 15, verify the production reverse-proxy
  origin is already included in the production CORS configuration through the
  approved configuration process; do not overwrite production `.env`.
- Staging has an unpromoted delivery-outcome correction: **Returned to Pharmacy** is now stored separately from the pre-existing **Returned to Warehouse** flag. The Dashboard tile and RX Records Current Stage filter count only the explicit pharmacy-return outcome; legacy warehouse returns are not auto-converted. A permission-controlled **Reopen Warehouse Return** action preserves the audit and Step 1, then allows the operator to continue the normal delivery outcome, print-log, signature, and archive flow. RX Records also supports searchable multi-select Pharmacy and Clinic filters. The audited migration `20260730000000-add-rx-delivery-outcome.js` adds outcome, date, and note fields only; it performs no business-data rewrite. Staging schema check and read-only parity verification passed on 2026-07-29 (`1` dashboard outcome record = `1` filtered record).
- Staging is healthy on the `4.0.0-next.37` source candidate at port 3100. It
  adds inclusive RX Records **Current Stage Date From/To** filters and a
  **Current Stage Date** CSV column based on the canonical highest completed
  active workflow step. The range and CSV use the configured application
  timezone; deterministic tests cover 23-hour and 25-hour DST days, duplicate
  and inactive history, Not Started null dates, completed old-service-date
  precedence, combined filters, clear behavior, and export parity. The full
  staging API/database/security/report/relay suite and isolated Playwright
  browser-click suite passed on 2026-07-28, including a browser deliberately
  set to a different timezone. There is no migration or business-data rewrite.
  This candidate is not installed on development or production.
- Development is healthy on `4.0.0-next.36`. This version separates the Dashboard pipeline
  summary into the same mutually exclusive Workflow Status groups used by RX
  Records: Not Started, non-expired In Progress, Expired, and Completed.
  Dashboard Pending and both dashboard charts remain All Incomplete and include
  Expired. Current Stage remains independent and retains expired RX at their
  actual completed step. Local database regressions cover expired RX with and
  without progress, duplicate workflow history, zero active workflow actions,
  exact RX filter parity, chart math, and Spanish UI. No migration or business
  data rewrite is included. Development was installed from merge commit
  `f49ea3b` and validated against its separate restored production-copy database
  on 2026-07-27. The candidate has not been installed in production.
- Production is confirmed healthy on official `v4.0.0-next.35`. The verified
  live baseline used for this correction is 1,771 Total RX = 2 Not Started +
  156 In Progress + 2 Expired + 1,611 Completed; Dashboard All Incomplete is
  160 and operational Pending is 158. Current Stage remains
  127/17/14/0/0/1,611. Production data was not modified while developing
  `next.36` or `next.37`.
- Official release `v4.0.0-next.34` adds an English-default,
  Spanish-selectable program UI plus configurable login/sidebar branding.
  Translation is browser-side and UI-only, Backoffice is explicitly excluded,
  and stored patient/business data is untouched. A second localization pass
  expands the catalog beyond 700 fixed entries, adds formatted/dynamic UI
  handling, and specifically verifies every Call Center metric card and its
  dynamic list state. Branding uses existing audited System Settings storage
  and safe same-site image paths; its visual picker includes transport presets
  and bundled people-riding/boarding-minivan SVG icons. Spanish add-only and
  edit-only role checks use stable modal-mode markers, so authorization UI does
  not depend on translated words. Staging, develop, main, lifecycle CI, the
  Windows softphone build, CodeQL, tag packaging, checksum publication, and an
  independent downloaded-package verification all passed. Live-production
  installation and operator validation remain unconfirmed.
- Repository: `Copernicous/RX-TRACKER-NEXT`
- Branch: official `v4.0.0-next.35` release on `main` at commit
  `1ed9a71acb887e059faacdac91205df3337d81ba`.
- Current production release: `v4.0.0-next.35`, confirmed through the live
  version and health endpoints on 2026-07-27.
- Production application folder: `C:\RX-Tracker\RX-APP-NEXT`
- Windows service ID: `PatientRXSystem`
- Production HTTP port: `3000`
- NEXT database name at the completed cutover: `patient_rx_next_cutover_copy`
- Project Control version: `2.2.0`
- Latest official release: `v4.0.0-next.35`. Version `next.31` made
  **Current Stage** the primary RX Records workflow filter, kept **Next Action
  Required** under Advanced filters, and exported both meanings explicitly.
  Version `next.32` applies the same clarity to **Reports â†’ RX Actions**:
  Current Stage is primary, Next Action Required is operational follow-up,
  and History Includes Action is explicitly historical. It also uses active
  workflow definitions for report progress/current-stage calculations while
  preserving retired actions in audit history. There is no migration or data
  rewrite. RX Softphone remains 0.6.0. It retains the application-owned
  WebView2 control window, hides the window to the existing tray on close,
  focuses the same window on a second launch, and adds a per-user
  **Start with Windows** tray option. It does not install a Windows service,
  because the phone, tray, audio devices, and DPAPI-protected pairing must run
  in the employee's interactive Windows session. The tray continues to show
  SIP registration, relay state, live call state/duration, and last-call
  details and provides Hang Up, managed Disable/Enable,
  administrator-locked Unpair, and graceful Exit. It also makes the Administrator
  Phone Devices inventory use FortiGate's rewritten API URL, versions the page
  scripts to avoid SSL-VPN session caching, reports script/API timeouts
  instead of remaining indefinitely on **Loading devices**, and renders device
  rows through a FortiGate-safe two-step assignment after authenticated proxy
  testing exposed an invalid rewrite of the prior compound expression. It also
  prevents a newly queued relay call from inheriting an older call's terminal
  timestamps by correlating every active browser snapshot and clearing previous
  call metadata from the synthetic dialing state. It also excludes patients marked
  **Non-Company Patient** from new Call Center work, blocks direct claims/saves/call
  attempts for them, and gives the Patients list an amber warning treatment plus
  Company/Non-Company filtering while preserving historical call reporting.
  Version `next.17` also adds RX Records warehouse-return filtering and a
  readable return badge, plus a transactional **Calls Only** cleanup that
  removes automatic call attempts and legacy call audit events without
  removing patients or RX records. Versions `next.23` through `next.25` add
  the Supervisor Summary and bounded SQL-backed Patients, Dashboard, Call
  Center queue, and call-attempt report queries described below. For each
  future deployment, confirm the installed version through Project
  Control or `server.exe --v`; publication alone does not install it.
- Official `v4.0.0-next.34` assets were published on 2026-07-27 and
  independently verified against both GitHub asset digests and
  `SHA256SUMS.txt`. The downloaded server archive contains no `.env`, dump,
  log, upload, or unsafe traversal entry; `server.exe --v` reports
  `4.0.0-next.34` and `rx-db.exe help` succeeds. Official hashes:
  - `server-update-4.0.0-next.34.zip`:
    `536cd49b35665e6f6cf81f1895e596783f19cbe0d09babacf0d1cf6568822b9e`
  - packaged `server.exe`:
    `72a3345a34f8cd4c093932ea9ec90532bbac4adc4dec327561b278cbcb4c122f`
  - packaged `rx-db.exe`:
    `0b1e1630139d82267891faf033402d6b1ca6608fa5788c1181b849adb402d820`
  - `RxSoftphone-0.6.0-win-x64.zip`:
    `a75715d401a77e3e423e789358786d507aa76cbd986214df97fb2097bc93dca1`
  The release requires no database migration, data rewrite, proxy/PBX change,
  or RX Softphone workstation update. Install it only through Project Control
  options 8 then 15; do not repeat the one-time NEXT cutover workflow.
- Testing-production server update remains pending (2026-07-27). The first
  option 15 attempt stopped at the Administrator check before changing the
  service, files, or database. A later `next.34` to `next.35` attempt stopped
  at the updater's pre-update health gate because the current installation did
  not become healthy at `http://127.0.0.1:3090/api/healthz`. That gate runs
  before download, backup, service stop, migration, or file replacement, so no
  update mutation or rollback was required. The application may be running on
  a different inherited NSSM port than the `.env` value used by the updater.
  Before retrying option 15, use Project Control status, port, version, health,
  logs, and doctor diagnostics to make the current installation healthy at one
  consistent local URL. Inspect only the necessary `PORT` and `DB_NAME` NSSM
  environment entries; never print the full environment because it contains
  secrets.
- Official release `4.0.0-next.33` adds bounded CRM context to the
  Administrator-only **Live RX Phones** board for RX Tracker-originated calls:
  patient name, patient ID, clinic, and dialed number. The context comes from
  the existing call-attempt snapshot matched by relay correlation ID; manual
  calls remain phone-only. No database migration, data rewrite, proxy change,
  PBX change, or RX Softphone update is required.
- Last operator-confirmed production validation (2026-07-26):
  `v4.0.0-next.33` was installed through Project Control and a real
  RX Tracker-originated call displayed its patient call information correctly
  on **Administration â†’ Live RX Phones**. Staging, develop, main, database
  lifecycle, Windows softphone build, CodeQL, release packaging, published
  checksum, and downloaded-package version validation all passed. This feature
  has no pending corrective work. At the start of a future session, confirm the
  currently installed/running version through Project Control option 4 before
  making new changes; do not repeat this release or modify RX Softphone for
  this completed feature.
- Staging candidate `4.0.0-next.18` adds an Administrator-only, view-only
  **Live RX Phones** presence board for configured or paired RX Softphone
  workstations. It shows registration, relay heartbeat, idle/dialing/ringing/
  connected state, active peer, live duration, shared-extension count, device,
  and last reported call. It does not listen to audio, record, control calls,
  or query the PBX. The complete isolated staging browser smoke, role-boundary
  check, relay regression, Call Center phone-client regression, public
  JavaScript validation, and staging configuration guard passed. It has no
  database migration and does not require an RX Softphone update.
- Staging candidate `4.0.0-next.21` adds a compiled
  `RX-Tracker-NEXT-New-Server-<version>.zip`. The package contains no reusable
  `.env`; `INSTALL-NEW-SERVER.bat` creates a fresh database, explicit first
  administrator, restricted runtime role, destination-specific `.env`, NSSM
  service, and non-secret receipt, then requires an exact-version health
  check. Existing databases, non-empty app folders, and existing
  `PatientRXSystem` services fail closed. This installer is for fresh servers;
  established NEXT servers continue with Project Control option 8 then 15. A
  disposable PostgreSQL test passed all migrations, exact-version health, and
  the first master-administrator login before removing its test database and
  roles. The accompanying retirement runbook keeps old 3.3.x deletion separate
  and approval-gated.
- Candidate `4.0.0-next.22` adds an audited Administrator-only **Retire line**
  action under Phone Devices. It disables the selected user's SIP assignment,
  revokes any paired workstation, removes the disabled assignment from Live RX
  Phones, and preserves call-attempt history. **Revoke device** remains a
  separate pairing-only action. It also adds staging-first Dependabot updates,
  dependency review, CodeQL, and a weekly high-severity npm audit with a
  plain-language administrator guide. Database impact: none.
- Release `4.0.0-next.23` adds a read-only Call Center
  **Supervisor Summary** with answered/no-answer rates, total and average talk
  time, and calls grouped by agent, clinic, and local date. It uses the
  existing report permission and automatic call-attempt history, adds no
  migration or writes, and does not change the proxy, application origins,
  ports, or RX Softphone.
- Release `4.0.0-next.24` moves Patients filtering, facets, sorting,
  counts, and pagination into PostgreSQL before related records are loaded;
  stores current dashboard totals in the existing `DailySnapshots` table;
  materializes missing historical trend rows with set-based PostgreSQL work;
  and aggregates the RX workflow pipeline in SQL. The annual stress dataset
  improved from about 3.4 seconds to 50-90 ms for a 10-patient page, while
  persisted all-time charts return in about 25-100 ms. Its one additive
  migration creates five Patients indexes and rewrites no business data.
- Release `4.0.0-next.25` applies the same bounded database access
  pattern to Call Center. PostgreSQL now performs queue count, filtering,
  sorting, and ID pagination before the server loads page details and history.
  Call-attempt report totals use grouped SQL aggregates instead of loading all
  matching attempts. On the annual stress dataset, warm 10-row queue requests
  improved from about 1.0-1.2 seconds to 11-14 ms, and the 50,000-attempt
  summary improved from about 92-96 ms to 51-53 ms. One additive migration
  creates eight growth-query indexes and rewrites no business data.
- Release `4.0.0-next.26` expands Patient and RX reports with exact clinic,
  pharmacy, patient/pharmacy transport, patient type, assignment completeness,
  service/arrival dates, eligibility, RX presence, workflow state/stage, and
  warehouse-return filters. Filtering, sorting, and pagination remain
  database-side and CSV/Excel exports preserve the selected filter set.
  Project Control 2.2 adds option **25**, which validates a production dump,
  restores it only into a visibly named isolated test database, applies and
  verifies migrations, configures the restricted runtime role, fingerprints
  business data, and optionally activates the copy with automatic `.env` and
  service recovery. It does not modify the source dump or current database.
- Staging candidate `4.0.0-next.27` adds exact completed-stage and
  stage-activity date filtering, visible current-stage/date/user details, and
  expandable ordered workflow history to RX Reports. It also adds a filtered
  Full Patient + RX Transfer Export with one vertical row per RX, repeated
  patient columns for multiple RX records, and one blank-RX row for patients
  without RX. The complete staging smoke and isolated browser workflow pass.
  It has no migration, data rewrite, proxy/origin/port change, or RX Softphone
  change. It is not official until promoted through develop/main and published.
- Staging candidate `4.0.0-next.28` keeps the report screen compact but upgrades
  the filtered Patient/RX CSV into a versioned, normalized history ledger for
  future system transfer. Patient/RX parent rows precede separate linked rows
  for every workflow step (completed and pending), medication, RX change,
  patient note, service-date change/cycle, document reference, and Call Center
  attempt. Numeric relationship IDs accompany readable labels. Attachment file
  contents, credentials, secrets, sessions, and unrelated security logs remain
  excluded. The complete staging smoke and isolated Chromium CSV download pass.
  A 5,000-patient/12,000-RX/50,000-call annual stress export streamed 186,611
  rows (200.5 MB) in about 12.8 seconds with roughly 197 MB process growth;
  the rejected all-at-once JSON design required about 1.0 GB. It has no
  migration, data rewrite, proxy/origin/port change, or RX Softphone change.
  It is not official until promoted through develop/main and published.
- Staging candidate `4.0.0-next.29` keeps every configured workflow definition
  visible in Patient/RX Summary Excel and RX Report CSV/Excel. Each definition
  has separate Status, Date, and Completed By columns; an uncompleted step is
  `Pending` with a blank date/user, and a workflow header remains present even
  when production has no completions for that step. Packed process-history
  cells were removed from these summary files. The versioned Complete History
  CSV remains the lossless vertical ledger from `next.28`. PostgreSQL report
  parity, public JavaScript, EJS rendering, and isolated Chromium downloads of
  the real Summary Excel passed. There is no migration, business-data rewrite,
  proxy/origin/port change, or RX Softphone change. It is not official until
  promoted through develop/main and published.
- Official `v4.0.0-next.26` assets were published on 2026-07-26 and
  independently verified against `SHA256SUMS.txt`:
  - `server-update-4.0.0-next.26.zip`:
    `de0c2449d93d03b1f7d7c5c66ee0c02843109bf7b8acc9992420bca7bdd0c362`
  - packaged `server.exe`:
    `ad7de2821c35893e6df099e1b43a2c6ffead96432c92f5660aa456cce27dd5fe`
  - packaged `rx-db.exe`:
    `2c02b562afe11c7da6c106e23619a4bd1ab88c0bfe0ffd94eee397127083794c`
  - `RxSoftphone-0.6.0-win-x64.zip`:
    `7bae17f10d1ea9811dd48058d81f66c9110c1c431b0f4bc391d79b467ad78342`
- Tag `v4.0.0-next.7` is a failed, non-deployable release attempt. Its server
  build passed, but the first clean-runner RX Softphone restore lacked an
  explicit Windows runtime identifier, so no GitHub release assets were
  published. Never reuse or deploy that tag.
- Legacy fallback application remains under `C:\RX-Tracker\RX-APP`.
- Current operating posture: production is healthy and the team is waiting for
  customer feedback. No confirmed production incident is open.
- Release `4.0.0-next.17` adds an RX Records warehouse-return
  filter/readable badge and makes Backoffice **Calls Only** cleanup include both
  automatic `CallCenterCallAttempts` rows and legacy `Called` audit events.
  The cleanup is transactional and preserves patients, RX records, notes,
  service dates, users, phone accounts, and pairings. Targeted database and
  browser regressions plus the complete staging smoke suite passed.
- Official `v4.0.0-next.17` assets were published on 2026-07-23 and verified
  against `SHA256SUMS.txt`:
  - `server-update-4.0.0-next.17.zip`:
    `b792727ce3073af73d7749f042e2d7745d139b9df057f423d5ac52df1ebb25e8`
  - `RxSoftphone-0.6.0-win-x64.zip`:
    `dcf6ed505495236400b43fbca6d09cac22687babaf03db5ce0da00fa54059d41`
- On 2026-07-22, a controlled production data repair removed six inactive,
  unreferenced default WorkflowActions that had been added during the original
  NEXT cutover. Production now retains exactly the seven configured 3.3.1
  workflow actions (IDs 1-7); all 7,142 RX workflow tracking rows were
  preserved. The verified post-repair business fingerprint is
  `bbf46041a6e5f9a6972d764e3a85394e5f737ac655cc51eaef84fd9d3ca6fa03`.

The production `.env` is authoritative and must remain in place during every
update. Never derive or reconstruct its secret values from Git or this file.

## Deployment layout

```text
C:\RX-Tracker\
|-- RX-APP\                 Frozen legacy fallback application
|-- RX-APP-NEXT\            Active compiled NEXT application
|-- nssm\                   Windows service wrapper
|-- backups\                PostgreSQL update/cutover/scheduled backups
|-- release-backups\        Previous application files paired to updates
|-- deployment-state\       Update and rollback manifests
|-- control-backups\        Previous Project Control scripts
|-- updates\                Project Control automatic-download cache
|-- update-staging\         Temporary extraction area
`-- logs\                    Runtime logs

C:\Shared\Versions\         Permanent official release ZIP/checksum archive
```

`C:\Shared\Versions` is the operator archive. Project Control may also cache
automatically downloaded packages under `C:\RX-Tracker\updates`. Rollback does
not depend on a release ZIP; it depends on the matching files in `backups`,
`release-backups`, and `deployment-state`.

Keep the final legacy 3.3.x package, the original NEXT cutover package, the
current NEXT package, the immediately previous NEXT package, and their
checksums. Older preview packages may be moved to an Archive subfolder.

## Legacy application and local development

- Do not delete `C:\RX-Tracker\RX-APP` yet. Keep it stopped and unchanged as
  the final legacy recovery/reference package while customer acceptance is in
  progress.
- `192.168.15.87:3000` is now the local **NEXT development** site, not the
  former 3.3.x runtime. It runs from the develop worktree against a separate
  test-copy database and dedicated `database-work/dev-runtime`; scheduled
  backups are disabled there.
- Staging work belongs in
  `E:\Documents\0-PROJECTS\RX-TRACKER\RX-TRACKER-NEXT-STAGING-PROMOTE` and
  tested promotion belongs in the `RX-TRACKER-NEXT-STAGE-FIX` develop worktree.
- Any deliberate legacy comparison must use a different unused port and a
  separate database. Never point legacy and NEXT at the same database, and do
  not reuse port 3000 while the NEXT development site is active.
- Do not remove the legacy server or local repository until the customer has
  accepted NEXT, production backups have been verified, and a deliberate
  retirement decision has been recorded here.

### Deferred cleanup checkpoint

Status: **Deferred until customer acceptance and the agreed recovery window
have both ended.** Do not perform this cleanup merely because NEXT is healthy
today.

When the checkpoint is approved, handle the server and local workstation as
separate controlled tasks:

Production server cleanup:

1. Confirm `PatientRXSystem` points to `C:\RX-Tracker\RX-APP-NEXT\server.exe`.
2. Confirm NEXT is using `patient_rx_next_cutover_copy` and no process is using
   the legacy database.
3. Create and validate a final legacy database backup and checksum in protected
   storage.
4. Confirm the legacy application and any legacy automatic startup are
   disabled.
5. After the approved retention period, remove the old PostgreSQL database and
   obsolete rehearsal databases. Do not remove the active NEXT database.
6. Retain the final legacy application package and database backup according to
   the organization's recovery and data-retention policy.

Local development cleanup:

1. Confirm all current work is committed and pushed to RX-TRACKER-NEXT.
2. Treat `192.168.15.87:3000` as the active NEXT development site; do not stop
   or remove it as part of legacy cleanup.
3. Identify any remaining legacy runtime by its executable path, working
   directory, service, scheduled task, or shortcut rather than by port 3000,
   then verify it is stopped and cannot start automatically.
4. Preserve one clearly labeled, read-only legacy source archive if still
   required for historical reference.
5. Remove obsolete local databases, dumps, build artifacts, and working copies
   only after verifying they are not the production recovery copy and contain
   no uniquely required information.

Before executing either cleanup, update this handoff with the approval date,
retention deadline, exact targets, final backup/checksum locations, and the
person authorizing removal. Never place credentials, patient data, or dump
contents in this document.

## Routine production update

1. Open `C:\RX-Tracker\RX-APP-NEXT\PROJECT-CONTROL.bat` as Administrator.
2. Select option 8 to check the newest official release.
3. If a newer release exists, select option 15.
4. Leave the ZIP field blank to download the newest official release, or give
   a full path under `C:\Shared\Versions`.
5. Confirm and wait for the final green version/database health result.
6. Verify login, dashboard totals, configured RX Actions, call center, and any
   feature changed by the release.

Project Control validates GitHub checksums and embedded versions, confirms the
NSSM service target, stops the service, creates and validates a PostgreSQL
backup, records business-data fingerprints, runs audited migrations and
explicit reference initialization, preserves `.env` byte-for-byte, installs
approved package files, restarts the service, and requires an exact healthy
release response. A failure during downtime attempts paired application and
database recovery.

If option 8 reports no newer release, do not run option 15. Installing the same
version is intentionally refused before the service is stopped.

## Rollback

Project Control option 16 is the emergency release rollback. It requires the
administrator to type `ROLLBACK`. It first creates a forward-recovery backup,
then restores the previous application and its matching pre-update database.

Rollback removes records created after the restored database backup from the
active database. Use it only during controlled downtime. Do not move, rename,
or independently delete files from these folders:

```text
C:\RX-Tracker\backups
C:\RX-Tracker\release-backups
C:\RX-Tracker\deployment-state
```

## Decisions that must remain true

- NEXT is isolated from the frozen RX Tracker 3.3.x repository.
- RX Softphone remains a separate workstation deliverable. Its version 0.6.0
  source is preserved under `rx-softphone-desktop` in NEXT, and every approved
  NEXT release that needs workstation distribution publishes its ZIP as a
  separate checksummed asset; it is never embedded in the server ZIP.
- The Windows production server deploys official compiled packages; it does
  not require Git, Node.js, npm, or a source checkout.
- The one-time 3.3.x-to-NEXT cutover is complete. Do not repeat the cutover
  orchestrator for routine NEXT updates.
- Web startup performs validation only; it must not create or alter schemas.
- Existing workflow actions are customer configuration. Defaults are created
  only when the WorkflowActions table is genuinely empty.
- Do not restore or recreate the removed cutover defaults (`RX Received`,
  `Pharmacy Contacted`, `Transportation Assigned`, `Delivery Scheduled`,
  `RX Delivered`, and `Driver Receipt Obtained`). They were inactive, had zero
  tracking references, and were not part of the configured 3.3.1 workflow.
- Production release packages and checksum files are permanently archived in
  `C:\Shared\Versions`.

## Recent release history

- `v4.0.0-next.4`: corrected multiline/null NSSM application-path parsing in
  the one-time production orchestrator.
- `v4.0.0-next.5`: added Project Control 2.0, official compiled ZIP updates,
  database/application rollback pairing, business-data fingerprints, and
  protection against workflow-action reseeding.
- `v4.0.0-next.6`: corrected Windows PowerShell GitHub release discovery for
  Project Control options 8 and 15. Database impact: none.
- `v4.0.0-next.15`: isolated relay call-attempt snapshots by correlation so a
  new call cannot inherit terminal timestamps from a previous call. Database
  impact: none.
- `v4.0.0-next.16`: excludes Non-Company patients from new Call Center work,
  adds patient-type filtering and visual warnings, and fixes persistence when
  the Non-Company checkbox is cleared or restored. Database impact: none.

## Latest candidate validation

- On 2026-07-27, staging commit `9b89549` was promoted to `develop` by merge
  commit `f49ea3b` and installed only on the local NEXT development runtime at
  `192.168.15.87:3000`. Health reported application and database `ok` on
  `4.0.0-next.36`.
- The restored development data reconciled exactly: 1,771 Total RX = 2 Not
  Started + 156 In Progress + 2 Expired + 1,611 Completed; All Incomplete is
  160 and operational Pending is 158. RX Records filter totals matched all six
  status views, and actual Current Stage totals were
  127/17/14/0/0/1,611.
- The exact candidate passed public JavaScript validation, dashboard template
  compilation, 784-row English/Spanish regression coverage, focused pipeline
  and analytics regressions, the complete isolated staging smoke suite, and a
  fresh isolated Chrome smoke covering all four dashboard status links. The
  live development login loaded in English and Spanish with no browser console
  errors. No production service or database was changed.
- On 2026-07-23, staging commits `ba9f9a0` and `8175567` were promoted to
  `develop` by merge commit `2d6d0bc`; the development continuity update is
  commit `18d85b4`.
- The validated development history was merged into `main` by production
  promotion commit `d7bf34a`. The release must still pass `main` CI and the
  tag-triggered asset verification before it is offered to the production
  operator.
- GitHub development CI run `30061313262` passed, including the clean Windows
  RX Softphone build and PostgreSQL lifecycle/regression suite.
- The compiled `v4.0.0-next.16` server package, release self-tests, public
  JavaScript validation, reference-data regression, and high-severity npm
  audit gate all passed. The remaining npm findings are two moderate
  transitive `uuid` findings under Sequelize; no forced dependency downgrade
  was applied.
- An authenticated live test through the user-opened
  `portal.rbandrc.com` Cloudflare/Kasm session verified the Patients advanced
  Company/Non-Company filter, amber Non-Company warning treatment, both
  checkbox transitions and persistence, and Call Center exclusion after the
  flag was restored. The RX Softphone relay remained online, the Call Center
  continued to show the eligible company patient, and the tested application
  requests completed successfully.
- The Non-Company change uses the existing patient column and requires no
  database migration. The simulated patient used for the transition test was
  restored to Non-Company before the test ended.
- Main lifecycle CI run `30062451301` passed for release commit `3e944b9`,
  including the PostgreSQL lifecycle and clean Windows RX Softphone jobs.
- Release workflow run `30062544346` published the official
  `v4.0.0-next.16` prerelease. The downloaded assets, manifest, embedded
  executables, and reported versions were independently verified. Official
  package hashes:
  - `server-update-4.0.0-next.16.zip`:
    `3F8F6B53B46CD12B1CE9DC1E32F2892329892789257320D6025AFE697F48AE3D`
  - `RxSoftphone-0.6.0-win-x64.zip`:
    `37EAC4FF425B983F2C494C74F2250A52A25129BC925EF0E0C52209109B54608F`

## Release procedure for maintainers

1. Work only in the NEXT repository and inspect the existing worktree first.
2. Update code, tests, changelog, version, and version-specific release notes.
3. Run relevant local checks and build/test the Windows package.
4. Commit and push `main`.
5. Wait for the full PostgreSQL lifecycle CI to pass.
6. Create and push a new annotated `v<version>` tag.
7. Wait for the Windows release workflow to publish the server ZIP, RX
   Softphone workstation ZIP, and `SHA256SUMS.txt`.
8. Verify the published assets and executable versions before giving the
   production operator deployment instructions.

Never reuse a tag, publish unverified local binaries as official, or commit a
production `.env` or database dump.

## New-session checklist

At the beginning of a future session:

```powershell
cd E:\Documents\0-PROJECTS\RX-TRACKER-NEXT
git status --short
git branch --show-current
git log -5 --oneline
git tag --points-at HEAD
```

Then read `AGENTS.md`, this handoff, the latest changelog section, and the
relevant runbook. Confirm the live production version with Project Control or
`server.exe --v` before planning another release. Ask the user only for facts
that cannot be discovered safely; never ask them to paste secret `.env`
contents into chat.
