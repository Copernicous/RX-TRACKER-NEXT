# Release Notes

## v2.0.40 (2026-06-24)

### What's New
- Added a dedicated QA smoke task to validate the `Needs Action` workflow flow from `npm run qa:web`.
- The new task seeds an expired-cycle patient fixture with incomplete RX workflow and verifies the Needs-Action filter, banner, and list results.
- Existing 2.0.39 service-date and RX workflow behavior remains unchanged.

### What's included
- `qa/smoke-qa.js` - added needs-action fixture seed + verification flow.
- `qa/web-ui.js` - added `Run needs-action smoke check` task.
- `qa/web/public/index.html` - added dashboard button for the task.
- `qa/README.md` - documented the optional QA smoke check.
- `qa/QA-WEB-MANUAL.md` - documented validation checks.
- `CHANGELOG.md` - 2.0.40 entry with file-level detail.
- `.github/releases/v2.0.40.md` - release notes for GitHub tag body.
- `package.json` - version bumped to 2.0.40.
- `OPERATIONS_MANUAL.md` - version updated to 2.0.40.
- `dist/server-update-2.0.40.zip` - deployment archive after build.

### QA & Validation
- Confirm the dashboard needs-action smoke task passes on a seeded fixture.
- Confirm needs-action banner and filtered list rendering work on `/patients`.
- Build and package executable with `npm run build:exe`.
- Verify deployment zip opens correctly and includes `server.exe`, `.env`, `CHANGELOG.md`, `RX-Manager.bat`, and operation docs.

### Notes
- Versioned build is `2.0.40` in `package.json`.
- Deployment package generated for server delivery: `dist/server-update-2.0.40.zip`.
