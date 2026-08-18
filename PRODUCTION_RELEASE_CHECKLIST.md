# Production Release Checklist

Use this list every time a new production version is compiled, tagged, uploaded to GitHub, and copied to the production machine.

## Release Identity

- [ ] Version: `v__________`
- [ ] Commit: `__________`
- [ ] Build date: `__________`
- [ ] Production machine: `__________`
- [ ] Production app path: `__________`
- [ ] Production upload/staging path: `__________`

## Version Files

- [ ] Update `package.json` version.
- [ ] Update `package-lock.json` root version and package version.
- [ ] Add a top entry to `CHANGELOG.md`.
- [ ] Add tag-specific GitHub release notes at `.github/releases/v<version>.md`.
- [ ] Confirm `.env.example` contains any new safe, non-secret config keys.
- [ ] Confirm the real production `.env` exists, but is not committed to Git or packaged in release zips. A release build does not require a production `.env`.

## Package Policy

- [ ] Do not run `npm run build:exe` or create release ZIPs in the local working tree. Official executables, server ZIPs, RX Softphone ZIPs, and checksums are built only by GitHub Actions from the approved tag.
- [ ] Confirm `dist/` and generated ZIPs remain untracked and are not staged.
- [ ] Confirm the tagged release workflow still builds `server.exe`, `rx-db.exe`, the update/new-server ZIPs, the RX Softphone ZIP, and `SHA256SUMS.txt`.

## Local Validation

- [ ] Update the affected user-facing documentation before shipping the change (checklist, operations note, release note, or page-specific doc as needed).
- [ ] Run the source-level and targeted regression checks required by database lifecycle CI.
- [ ] Run `node scripts/db-lifecycle.js status` and `node scripts/db-lifecycle.js verify` only against an approved isolated development or testing database when database validation is required.
- [ ] Rehearse a recent v3.3.1 custom dump according to `docs/database/SANITIZED_DUMP_REHEARSAL.md`.
- [ ] Run targeted smoke checks for changed pages or APIs.
- [ ] Confirm no unwanted files are staged with `git status --short`.
- [ ] Confirm generated executables and ZIPs remain outside Git; GitHub Actions attaches them to the release.
- [ ] Complete the remote-workstation acceptance record in `docs/RX_SOFTPHONE_REMOTE_TESTING.md` when the release changes phone or relay behavior.

## GitHub Upload

- [ ] Commit the version files, changelog, release notes, workflow/script updates, and checklist updates.
- [ ] Push the branch: `git push origin main`.
- [ ] Wait for the exact `main` commit to pass database lifecycle CI, CodeQL, and the Windows RX Softphone build.
- [ ] Create the matching annotated tag only after `main` CI passes: `git tag -a v<version> -m "RX Tracker NEXT <version>"`.
- [ ] Push the tag: `git push origin v<version>`.
- [ ] Confirm the GitHub Actions release workflow runs on the new tag.
- [ ] Confirm the GitHub Release body uses `.github/releases/v<version>.md`.
- [ ] Confirm the release contains `server-update-<version>.zip`, `RX-Tracker-NEXT-New-Server-<version>.zip`, the RX Softphone ZIP, and `SHA256SUMS.txt`.
- [ ] Download the official GitHub release assets and verify every asset against `SHA256SUMS.txt`; never deploy a local build as the official release.
- [ ] Confirm the downloaded server ZIP opens and includes `server.exe`, `rx-db.exe`, `.env.example`, `README.md`, `CHANGELOG.md`, `RELEASE_NOTES-v<version>.md`, `PRODUCTION_RELEASE_CHECKLIST.md`, `PROJECT-CONTROL.bat`, `INSTALL-PROJECT-CONTROL.bat`, `scripts/project-control.ps1`, `scripts/Invoke-ReleaseUpdate.ps1`, `scripts/Install-ProjectControl.ps1`, `scripts/Invoke-NextProduction.ps1`, `project-control.json`, `package.json`, `OPERATIONS_MANUAL.md`, `DEFERRED-ITEMS.txt`, `docs/database/COMPILED_RELEASE_UPDATES.md`, the remaining database runbooks, `docs/PRODUCTION_MICROSIP_CHROME_POLICY.md`, `docs/RX_SOFTPHONE_REMOTE_TESTING.md`, `scripts/install-production-microsip-chrome-policy.ps1`, `install-service.ps1`, and `uninstall-service.ps1`.
- [ ] Confirm the downloaded ZIP does not include `.env`, `.env.staging`, database dumps, secrets, or Git bundles.
- [ ] Extract the downloaded ZIP into an isolated folder and run `PROJECT-CONTROL.bat version`; confirm it reports the release version without missing-file errors.
- [ ] Run the downloaded `server.exe --v` and `rx-db.exe help`; validate `rx-db.exe status` and `verify` only against an approved isolated testing database.

## Routine Production Installation

- [ ] Use only the official GitHub `server-update-<version>.zip` whose hash matches `SHA256SUMS.txt`; optionally archive it under `C:\Shared\Versions`.
- [ ] Open `C:\RX-Tracker\RX-APP-NEXT\PROJECT-CONTROL.bat` as Administrator. Do not manually extract files into the active application folder and do not run the one-time `Invoke-NextProduction.ps1` cutover workflow.
- [ ] Select option **4** and record the currently installed/running version: `__________`.
- [ ] Select option **8** and confirm it reports `<version>` as a newer official release. If it reports no newer release, do not run option 15.
- [ ] Select option **15**. Leave the ZIP field blank for the verified official download, or provide the archived official ZIP path.
- [ ] Supply the maintenance database login only in the Project Control prompt when required; never save it in `.env` or an operations note.
- [ ] Confirm the update and wait for the final green exact-version and database-health result. Project Control creates the paired application/database backup and preserves `.env` byte-for-byte.
- [ ] Record the Project Control backup/deployment-state timestamp used for this deployment: `__________`.
- [ ] Run Project Control options **4**, **3**, and **6** to verify version, health, and doctor results.
- [ ] Open `/login` and changed production pages through the normal production URL or FortiGate URL.
- [ ] Verify dashboard totals, configured RX Actions, Call Center, and the features changed by this release. Record deployment and rollback notes in the sanitized operations log.

## Rollback Reference

- [ ] Keep the previous `server-update-<previous-version>.zip` available.
- [ ] Know the previous Git tag: `v__________`.
- [ ] Know the latest known-good production backup timestamp: `__________`.
- [ ] For an emergency release rollback, stop user activity and use Project Control option **16**. Type `ROLLBACK` only during controlled downtime.
- [ ] Confirm the rollback restores the paired previous application and pre-update database. Records created after that database backup will not remain in the active database.
- [ ] Do not move, rename, or separately delete `C:\RX-Tracker\backups`, `C:\RX-Tracker\release-backups`, or `C:\RX-Tracker\deployment-state`.
