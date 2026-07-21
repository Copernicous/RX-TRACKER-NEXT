# Staging Validation - Changelog Loading Fix

Date: 2026-06-30
Target version: 2.0.71

## Production Bug

The production Changelog page could remain on the `Loading...` state instead of showing release notes.

## Root Cause

The page rendered release notes only after shared app initialization and after the browser Markdown renderer was available. If a production/proxy-specific static asset or shared script failed before rendering, the script could stop while the release-notes panel still showed its loading spinner.

The Git Commits panel also had no timeout/friendly fallback if the API was unavailable.

## Fix

- Render embedded `CHANGELOG.md` content before optional shared app initialization.
- Keep the page useful even if `marked.min.js` is unavailable by showing a safe plain-text changelog fallback.
- Use proxy-friendlier relative static paths on the Changelog page.
- Add a timeout and friendly unavailable state for the Git Commits panel.
- Keep `/api/version` and `/api/git-log` failures non-blocking.

## Staging Checks

- Open `/changelog` as an authenticated user.
- Confirm Release Notes replace the loading spinner.
- Temporarily block or rename `assets/marked.min.js` in a local/staging browser test and confirm the page shows a plain-text changelog instead of spinning.
- Open the Git Commits tab and confirm it either shows commits in development or a friendly unavailable message in compiled/production-style runtime.
- Confirm the version displayed by `/api/version` is `2.0.71`.

## Database Impact

No schema changes and no data changes.
