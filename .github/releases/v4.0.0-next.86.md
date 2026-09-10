# RX Tracker NEXT v4.0.0-next.86

Fixes the updater recovery failures encountered upgrading a next.78 test server to next.85. Includes the patient-import review and merge features from next.85.

## Required bootstrap for older installations

Do not start this update with the old installed updater. Download the official server-update-4.0.0-next.86.zip and SHA256SUMS.txt, verify the ZIP checksum, and extract into a separate temporary folder. From that extracted folder, run INSTALL-PROJECT-CONTROL.bat with the actual compiled application folder as its argument, for example:

```powershell
.\INSTALL-PROJECT-CONTROL.bat "C:\NODE-SERVER\RX-APP-NEXT"
```

This backs up and replaces Project Control helpers only; it does not replace server.exe, rx-db.exe, .env, or the database. Close any previously open Project Control menu, reopen it from the application folder as Administrator, then choose option 8 and option 15. Use the same verified next.86 ZIP. Test the complete update on the recovered test server before production.

## Fixes

- Correct Windows PowerShell 5.1 JSON array parsing during application rollback. Valid manifest entries no longer collapse into one combined filename.
- Validate every application backup entry and required rollback binary before migrations; reject invalid manifests before any rollback file changes.
- Skip application restoration if file installation never began; include partial file installations in recovery.
- Retain database ACLs in new backups. Reapply the existing application's limited table/sequence permissions after restores, including legacy backups without ACLs. Passwords and .env are unchanged; the migration ledger remains read-only for the runtime role.
- Verify database readiness with the application account before service startup during update/recovery.
- Retain strict business validation and the existing narrowly checked missing-Region backfill allowance. No applied migration is edited or added.

## Production precautions

A next.78 upgrade includes migrations from earlier releases, even though this patch adds none. Those migrations can add missing Region tag assignments. Require the updater's business-data checks and green final health result. Keep the matched pre-update application/database backups, use a maintenance window, and check patient/RX screens afterward. Do not retry while a server is still in failed recovery.

Validation: Windows PowerShell 5.1 real-file backup/restore tests; real PostgreSQL backup/restore with both retained and legacy omitted ACLs; runtime login/read and migration-ledger protection; updater and test-copy safety regressions. Remote test-server acceptance of next.86 is still required.
