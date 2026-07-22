# RX Tracker NEXT project handoff

Last updated: 2026-07-22

This file is the sanitized continuity record for a future administrator or
Codex session. It intentionally contains no credentials, `.env` values,
patient data, SIP secrets, pairing secrets, or production database dumps.

## Current state

- Repository: `Copernicous/RX-TRACKER-NEXT`
- Branch: `main`
- Current production release: `v4.0.0-next.6`
- Production application folder: `C:\RX-Tracker\RX-APP-NEXT`
- Windows service ID: `PatientRXSystem`
- Production HTTP port: `3000`
- NEXT database name at the completed cutover: `patient_rx_next_cutover_copy`
- Project Control version: `2.0.0`
- Legacy fallback application remains under `C:\RX-Tracker\RX-APP`.
- Current operating posture: production is healthy and the team is waiting for
  customer feedback. No confirmed production incident is open.

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
- RX Softphone is a separate deliverable and is not modified by NEXT server
  maintenance unless explicitly requested.
- The Windows production server deploys official compiled packages; it does
  not require Git, Node.js, npm, or a source checkout.
- The one-time 3.3.x-to-NEXT cutover is complete. Do not repeat the cutover
  orchestrator for routine NEXT updates.
- Web startup performs validation only; it must not create or alter schemas.
- Existing workflow actions are customer configuration. Defaults are created
  only when the WorkflowActions table is genuinely empty.
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

## Release procedure for maintainers

1. Work only in the NEXT repository and inspect the existing worktree first.
2. Update code, tests, changelog, version, and version-specific release notes.
3. Run relevant local checks and build/test the Windows package.
4. Commit and push `main`.
5. Wait for the full PostgreSQL lifecycle CI to pass.
6. Create and push a new annotated `v<version>` tag.
7. Wait for the Windows release workflow to publish the server ZIP and
   `SHA256SUMS.txt`.
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
