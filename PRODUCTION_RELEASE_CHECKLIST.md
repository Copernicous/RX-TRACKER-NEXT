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

## Local validation and packages

- [ ] Follow docs/LOCAL_RELEASE.md from an intended clean source commit.
- [ ] All hosted workflows are disabled/manual-only before pushing anything.
- [ ] Prepare-LocalRelease.ps1 passes the complete PostgreSQL lifecycle suite,
      recovery tests, application regressions, JavaScript/C# CodeQL scans,
      dependency gate, unchanged Softphone build, and server/rx-db builds.
- [ ] LOCAL_VALIDATION.json identifies the exact source commit and version.
- [ ] Verify the two server ZIPs, Softphone ZIP, embedded executables and
      SHA256SUMS.txt. Generated packages, credentials, logs and dumps stay out of Git.
- [ ] Stage Report user acceptance completed; unrelated staging work excluded.

## GitHub upload

- [ ] Fast-forward approved develop then main to the locally verified commit.
- [ ] Push source and a new matching annotated tag; no hosted jobs may start.
- [ ] Create a draft with version-specific notes and upload finished ZIPs,
      SHA256SUMS.txt and sanitized LOCAL_VALIDATION.json.
- [ ] Download every draft asset and compare hashes to local originals;
      validate embedded executable hashes and version before publication.
- [ ] Publish only after verification. Never replace an existing release.
- [ ] Update the handoff with commit, validation and verified release hashes.
- [ ] Publishing does not authorize installing on production.

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
