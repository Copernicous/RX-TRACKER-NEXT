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
- [ ] Confirm `dist/server-update-<version>.zip` exists.
- [ ] Confirm the zip opens and includes `server.exe`, `.env.example`, `CHANGELOG.md`, `RELEASE_NOTES-v<version>.md`, `PRODUCTION_RELEASE_CHECKLIST.md`, `PROJECT-CONTROL.bat`, `scripts/project-control.ps1`, `project-control.json`, `package.json`, `OPERATIONS_MANUAL.md`, `DEFERRED-ITEMS.txt`, `install-service.ps1`, and `uninstall-service.ps1`.
- [ ] Extract the zip into an isolated folder and run `PROJECT-CONTROL.bat version`; confirm it reports the release version without missing-file errors.
- [ ] Confirm the zip does not include `.env`, `.env.staging`, database dumps, secrets, or Git bundles.

## Local Validation

- [ ] Update the affected user-facing documentation before shipping the change (checklist, operations note, release note, or page-specific doc as needed).
- [ ] Run `dist/server.exe --v` and confirm it prints the expected version.
- [ ] Run targeted smoke checks for changed pages or APIs.
- [ ] Confirm no unwanted files are staged with `git status --short`.
- [ ] Confirm large generated files remain outside Git unless intentionally attached to a release.

## GitHub Upload

- [ ] Commit the version files, changelog, release notes, workflow/script updates, and checklist updates.
- [ ] Create the matching tag: `git tag v<version>`.
- [ ] Push the branch: `git push origin main`.
- [ ] Push the tag: `git push origin v<version>`.
- [ ] Confirm the GitHub Actions release workflow runs on the new tag.
- [ ] Confirm the GitHub Release body uses `.github/releases/v<version>.md`.

## Production Upload

- [ ] Copy `dist/server-update-<version>.zip` to the production upload/staging path.
- [ ] On the production machine, stop the running service or app.
- [ ] Back up the current production app folder or confirm the scheduled backup completed before applying the update.
- [ ] Record the backup filename, path, or timestamp used for this deployment: `__________`.
- [ ] Extract `server-update-<version>.zip` into the production app path.
- [ ] Confirm production `.env` is still present next to `server.exe`; updates must preserve this file and not replace it.
- [ ] Start the service or app.
- [ ] Run `server.exe --v` on production and confirm the expected version.
- [ ] Open `/login` and changed production pages through the normal production URL or FortiGate URL.
- [ ] Record any deployment notes, rollback notes, or manual `.env` changes in the release notes or operations log.

## Rollback Reference

- [ ] Keep the previous `server-update-<previous-version>.zip` available.
- [ ] Know the previous Git tag: `v__________`.
- [ ] Know the latest known-good production backup timestamp: `__________`.
- [ ] If rollback is needed, stop the service, restore the previous package or backup, confirm `.env`, and restart.
