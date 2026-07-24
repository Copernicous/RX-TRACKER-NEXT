# RX Tracker NEXT project handoff

Last updated: 2026-07-23

This file is the sanitized continuity record for a future administrator or
Codex session. It intentionally contains no credentials, `.env` values,
patient data, SIP secrets, pairing secrets, or production database dumps.

## Current state

- Repository: `Copernicous/RX-TRACKER-NEXT`
- Branch: `main` (official `v4.0.0-next.17` release published and verified;
  production installation is still pending)
- Current production release: `v4.0.0-next.6`
- Production application folder: `C:\RX-Tracker\RX-APP-NEXT`
- Windows service ID: `PatientRXSystem`
- Production HTTP port: `3000`
- NEXT database name at the completed cutover: `patient_rx_next_cutover_copy`
- Project Control version: `2.0.0`
- Latest official release: `v4.0.0-next.17` with RX Softphone 0.6.0. It retains the application-owned
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
  removing patients or RX records. This release is not yet installed in
  production. Production remains on `v4.0.0-next.6` until it is installed
  through Project Control.
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
- The former local 3.3.x development instance at `192.168.15.87:3000` is
  frozen. Disable automatic startup when it is no longer needed for a
  controlled comparison; do not add features or fixes there.
- All new development belongs in
  `E:\Documents\0-PROJECTS\RX-TRACKER-NEXT`.
- NEXT development and any deliberate legacy comparison must use different
  ports and separate databases. Never point both versions at the same
  database. A suitable comparison layout is legacy on port 3000 and NEXT on
  port 3100 with a dedicated non-production NEXT database.
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
2. Stop and disable the former 3.3.x local runtime at
   `192.168.15.87:3000`.
3. Verify that no local service, scheduled task, tunnel, or shortcut still
   starts the legacy runtime.
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
