# RX Tracker NEXT v4.0.0-next.87

Corrects the repeated next.78 test-server update failure. Includes the patient import review, merge, restore, and historical reports from next.85 and recovery fixes from next.86.

## Required installation path for this correction

Do not retry from the old installed menu. Download the official server-update-4.0.0-next.87.zip and SHA256SUMS.txt, verify the ZIP checksum, and extract into a separate folder outside the installed application. Open an Administrator PowerShell terminal in that extracted folder, then run (adjust the ZIP path):

```powershell
.\UPDATE-EXISTING-SERVER.bat "C:\NODE-SERVER\RX-APP-NEXT" "C:\Downloads\server-update-4.0.0-next.87.zip"
```

This runs the packaged Project Control updater directly. It requires the exact application and ZIP paths and checks its own SHA-256 against the verified package before service downtime. Look for 'Updater matches verified package: 4.0.0-next.87'. Supply the maintenance database credentials only at the local prompt. The updater preserves .env, creates paired application/database backups, validates migrations/business data, installs the release, and verifies service health.

## Fixes and validation

- Region-backfill validation now counts only patients eligible for the unchanged historical migration. When the historical address cleanup is pending, validation projects its result without writing data. Nonempty addresses that still have no city remain unclassified; they no longer cause false rollback after the eligible assignments are added.
- New UPDATE-EXISTING-SERVER.bat avoids the old installed helper. The updater displays its version/path and refuses mismatched package/helper code before database changes.
- Retains next.86 Windows PowerShell 5.1 manifest parsing, pre-write backup validation, ACL preservation, runtime permission recovery, and runtime readiness checks.
- Synthetic PostgreSQL regression executes the actual historical migration: 39 eligible additions, unknown addresses preserved, repeat execution unchanged, unrelated assignment increases and patient loss rejected. A second case executes Region reassignment, address cleanup, and missing-Region completion in their actual upgrade order, including a city extracted from a legacy address. Tests also exercise package/helper mismatch and existing recovery cases.

## Production status

Test candidate: production rollout remains on hold until the recovered test host upgrades successfully, returns healthy on next.87, and patient/RX and import/merge/report screens are checked. Do not retry an update while recovery is unresolved. Keep the paired rollback set. CI and local synthetic tests do not prove the remote production database is ready.
