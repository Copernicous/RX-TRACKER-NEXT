# Release Notes

## v2.0.39 (2026-06-24)

### What's New
- 90-day workflow controls now support an explicit `Needs Action` workflow state on the Patient list.
- A patient is flagged as `Needs Action` when the service date is past 90 days and there is at least one incomplete RX workflow step.
- Patients can be filtered by `Needs Action`, and a quick banner lets operators jump directly into those records.
- Existing RX workflow step updates stay editable during the 90+ day window so teams can close out active cycles.
- New RX cycles (patient reset) remain blocked until the cycle is eligible again unless Backoffice override is used.

### What's included
- `controllers/patientController.js` - add `needsAction` classification for list responses and include workflow counts.
- `controllers/rxController.js` - remove hard 90-day block from workflow update/create paths while preserving service-date guard semantics.
- `public/js/patients.js` - add `needsAction` filter, banner, and filter-chip updates.
- `views/patients.ejs` - add new eligibility option and inline banner mount point.
- `CHANGELOG.md` - 2.0.39 entry with file-level detail.
- `.github/releases/v2.0.39.md` - release notes for GitHub tag body.
- `.github/RELEASE_NOTES.md` - deployment release summary.
- `package.json` - version bumped to 2.0.39.
- `OPERATIONS_MANUAL.md` - version updated to 2.0.39.
- `dist/server-update-2.0.39.zip` - deployment archive after build.

### QA & Validation
- Confirm that patients with incomplete RX workflows after 90 days appear in `Needs Action`.
- Confirm existing RX workflow entries still allow step transitions during the 90+ period.
- Confirm service date change remains locked unless backoffice override is enabled.
- Build and package executable with `npm run build:exe`.
- Verify deployment zip opens correctly and includes `server.exe`, `.env`, `CHANGELOG.md`, `RX-Manager.bat`, and operation docs.

### Notes
- Versioned build is `2.0.39` in `package.json`.
- Deployment package generated for server delivery: `dist/server-update-2.0.39.zip`.
