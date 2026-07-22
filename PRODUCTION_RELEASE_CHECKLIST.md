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
- [ ] Confirm the real `.env` exists on the build machine and production machine, but is not committed to Git or packaged in release zips.

## Build Package

- [ ] Run `npm run build:exe`.
- [ ] Confirm `dist/server.exe` exists.
- [ ] Confirm `dist/rx-db.exe` exists and `rx-db.exe help` succeeds.
- [ ] Confirm `dist/server-update-<version>.zip` exists.
- [ ] Confirm the zip opens and includes `server.exe`, `rx-db.exe`, `.env.example`, `README.md`, `CHANGELOG.md`, `RELEASE_NOTES-v<version>.md`, `PRODUCTION_RELEASE_CHECKLIST.md`, `PROJECT-CONTROL.bat`, `INSTALL-PROJECT-CONTROL.bat`, `scripts/project-control.ps1`, `scripts/Invoke-ReleaseUpdate.ps1`, `scripts/Install-ProjectControl.ps1`, `scripts/Invoke-NextProduction.ps1`, `project-control.json`, `package.json`, `OPERATIONS_MANUAL.md`, `DEFERRED-ITEMS.txt`, `docs/database/COMPILED_RELEASE_UPDATES.md`, the remaining database runbooks, `docs/PRODUCTION_MICROSIP_CHROME_POLICY.md`, `docs/RX_SOFTPHONE_REMOTE_TESTING.md`, `scripts/install-production-microsip-chrome-policy.ps1`, `install-service.ps1`, and `uninstall-service.ps1`.
- [ ] Extract the zip into an isolated folder and run `PROJECT-CONTROL.bat version`; confirm it reports the release version without missing-file errors.
- [ ] Confirm the zip does not include `.env`, `.env.staging`, database dumps, secrets, or Git bundles.

## Local Validation

- [ ] Update the affected user-facing documentation before shipping the change (checklist, operations note, release note, or page-specific doc as needed).
- [ ] Run `dist/server.exe --v` and confirm it prints the expected version.
- [ ] Run `dist/rx-db.exe status` and `dist/rx-db.exe verify` against an isolated test database.
- [ ] Rehearse a recent v3.3.1 custom dump according to `docs/database/SANITIZED_DUMP_REHEARSAL.md`.
- [ ] Run targeted smoke checks for changed pages or APIs.
- [ ] Confirm no unwanted files are staged with `git status --short`.
- [ ] Confirm large generated files remain outside Git unless intentionally attached to a release.
- [ ] Build `rx-softphone-desktop` with `rx-softphone-desktop/build-release.ps1`, verify the ZIP hash, and attach or copy it to the approved distribution location.
- [ ] Complete the remote-workstation acceptance record in `docs/RX_SOFTPHONE_REMOTE_TESTING.md` when the release changes phone or relay behavior.

## GitHub Upload

- [ ] Commit the version files, changelog, release notes, workflow/script updates, and checklist updates.
- [ ] Create the matching tag: `git tag v<version>`.
- [ ] Push the branch: `git push origin main`.
- [ ] Push the tag: `git push origin v<version>`.
- [ ] Confirm the GitHub Actions release workflow runs on the new tag.
- [ ] Confirm the GitHub Release body uses `.github/releases/v<version>.md`.

## Production Upload

- [ ] Copy `dist/server-update-<version>.zip` to the production upload/staging path.
- [ ] Extract the package into the side-by-side `C:\RX-Tracker\RX-APP-NEXT` folder; do not overwrite `C:\RX-Tracker\RX-APP`.
- [ ] From an Administrator PowerShell terminal, run `scripts\Invoke-NextProduction.ps1 -Action Preflight`; confirm it reports that no database or service changes were made.
- [ ] Run the exact-confirmation `Rehearsal` action while production remains online, then record the verified dump and hash.
- [ ] Optionally run `StartRehearsal`, complete browser acceptance at port 3100, and run `StopRehearsal`.
- [ ] Back up the current production app folder or confirm the scheduled backup completed before final cutover.
- [ ] Record the backup filename, path, or timestamp used for this deployment: `__________`.
- [ ] Announce downtime and run the exact-confirmation `Cutover` action. It stops the service, takes the final backup, rebuilds/migrates/verifies the isolated database, switches the service, and health-checks NEXT.
- [ ] Confirm `C:\RX-Tracker\RX-APP\.env` remains unchanged and `RX-APP-NEXT\.env` differs only by the isolated `DB_NAME`.
- [ ] Run `server.exe --v` on production and confirm the expected version.
- [ ] Open `/login` and changed production pages through the normal production URL or FortiGate URL.
- [ ] Record any deployment notes, rollback notes, or manual `.env` changes in the release notes or operations log.

## Rollback Reference

- [ ] Keep the previous `server-update-<previous-version>.zip` available.
- [ ] Know the previous Git tag: `v__________`.
- [ ] Know the latest known-good production backup timestamp: `__________`.
- [ ] During the controlled early acceptance window, use the script's guarded `Rollback` action to return the service to the untouched 3.3.1 folder/database; stop users first because new NEXT records are not copied back.
- [ ] For a later or reconciled rollback, stop NEXT and restore both the previous package and its paired pre-cutover database backup, confirm `.env`, and restart.
