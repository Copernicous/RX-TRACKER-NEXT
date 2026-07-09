# Release Notes

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
