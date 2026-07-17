# Release Notes

## v3.0.7 (2026-07-17)

- Dashboard pre-eligibility uses the configured Call Center lead value.
- Call Queue and Dashboard pre-eligibility populations are aligned.

## v3.0.6 (2026-07-17)

- Service eligibility is fixed at 90 days.
- Backoffice configures Call Center Lead Days.
- Call threshold equals 90 minus the lead value.
- Existing threshold value 80 upgrades to lead 10.

## v3.0.5 (2026-07-17)

- Call Center eligibility begins on the exact day configured in Backoffice.
- Dashboard, Patients, snapshots, and Call Center share the same inclusive boundary.
- Added configurable exact-day regression coverage.

## v3.0.4 (2026-07-17)

### What's Fixed

- Removed the remaining fixed Call Center eligible-since offset.
- Added configured-window and cutoff metadata to Call Center queue/metrics responses.
- Aligned Patients eligibility filters with the active-patient population used by Dashboard and Call Center.

### QA & Validation

- Run `npm run test:service-window`.
- Run `npm run test:call-center-queue-reopen`.
- Build and verify `dist/server-update-3.0.4.zip`.

## v3.0.3 (2026-07-17)

### What's New

- The patient service window is configurable from Backoffice Settings.
- The setting accepts 1 through 365 days and defaults to 90.
- Eligibility, service-date locks, workflow deadlines, imports, Call Center queues, dashboards, snapshots, cycle end dates, and patient/RX screens use the shared value.
- Call Center queue/metrics responses include the configured window and cutoff, and the Call Center date input enforces that same boundary.
- Setting changes are persisted and audit-logged.

### QA & Validation

- Run `npm run test:service-window`.
- Run `npm run test:workflow-date`.
- Run `npm run test:rx-override`.
- Run `npm run test:call-center-queue-reopen`.
- Run `npm run test:backoffice-patient-delete`.
- Build with `npm run build:exe` and verify `dist/server-update-3.0.3.zip`.

## v3.0.1 (2026-07-09)

### What's Fixed

- Normal Patient service-date updates now use a row-level database lock so duplicate/concurrent saves create only one Patient Service Date History entry.
- Added automated regression coverage for concurrent normal Patient service-date saves.
- Kept the Call Center Backoffice queue repair follow-up in the release stream, including restored queue visibility and service-date cycle status repair.

### QA & Validation

- Run `npm run test:patient-double-update`.
- Run `npm run test:call-center-queue-reopen`.
- Run `npm run test:rx-override`.
- Run `npm run db:test`.

## v3.0.0 (2026-07-09)

### What's New

- Dedicated restricted Call Center workspace at `/call-center`.
- Eligible-patient queue for active 90-day service-date candidates only.
- Append-only Call Center notes with author/date/source attribution.
- Repeat call history with timestamp and user attribution.
- Service-date entry that removes completed patients from the active Call Center queue.
- Hard Call Center patient claims to prevent multiple agents from working the same patient at once.
- Dashboard Call Center Metrics with date ranges, user filtering, charts, drilldowns, sorting, and CSV export.
- Reports > Analytics & Export > Call Center Report with advanced filters, totals, history, sorting, CSV export, and Excel export.
- Backoffice cleanup preview/purge for Call Center calls, notes, service-date events, and stale locks.
- Backoffice service-date-history delete repair so reverted Call Center patients can return to the available queue.
- Queue reopen handling for reverted Call Center patients that still have same-day call history.
- Service-date cycle status repair when Backoffice reverts a Call Center service-date entry.
- Call Center sidebar placement below RX Records.
- Restricted `/api/version` and sensitive API access for Call Center users.
- Full staging smoke/click coverage for the Call Center workflow and existing dashboard/report cards.

### What's Included

- `CHANGELOG.md` - v3.0.0 entry with file-level summary.
- `.github/releases/v3.0.0.md` - tag-specific GitHub release body.
- `controllers/callCenterController.js` - Call Center queue, actions, metrics, and drilldowns.
- `views/call-center.ejs` and `public/js/call-center.js` - dedicated Call Center workspace.
- `controllers/reportController.js`, `views/reports.ejs`, and `public/js/reports.js` - Call Center report.
- `views/dashboard.ejs` and `public/js/dashboard.js` - Call Center Metrics dashboard cards, charts, and drilldowns.
- `scripts/smoke-staging-call-center-security.js`, `scripts/smoke-staging-ui-clicks.js`, and `scripts/smoke-staging-full.js` - automated staging validation.
- `package.json` and `package-lock.json` - version bumped to 3.0.0.

### QA & Validation

- Run `npm run staging:full-smoke` before packaging or promoting to production.
- Confirm administrators can access `/api/version` and Call Center users receive `403`.
- Confirm Call Center users cannot navigate to dashboard or other restricted menus by direct URL.
- Confirm dashboard Call Center Metrics and Reports Call Center Report calculations match expected data for selected ranges/users.

### Notes

- Versioned build is `3.0.0` in `package.json`.
- Deployment package should be generated as `dist/server-update-3.0.0.zip`.
