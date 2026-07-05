Patient RX System v2.0.72
=========================

Production Release: Development Setup, Mobile Layout, CORS, And Backoffice 2FA

This package includes every production improvement through v2.0.72. The main
updates in this release are safer setup/environment handling, configurable CORS
origins, phone-friendly Patients/RX layouts, and a Backoffice 2FA reset lookup
fix.

Included improvements
---------------------

v2.0.72 - setup, mobile, CORS, and Backoffice 2FA
- Windows setup flow is hardened for local development and deployment prep.
- Setup migrations and app startup now load .env overrides consistently.
- Performance index migration handling is safer for fresh installs.
- APP_ORIGINS, CORS_ORIGINS, and ALLOWED_ORIGINS are supported for multi-origin
  browser access while APP_ORIGIN remains supported.
- Dashboard, RX Workflow Pipeline, Patients, and RX Records receive mobile-only
  layout improvements for phone screens.
- Patients and RX Records tables become readable card rows on small screens.
- Backoffice 2FA reset resolves the selected user correctly.

Database impact
---------------

- No destructive schema changes are included.
- No production data reset is included.
- Existing patients, RX records, users, roles, permissions, settings, backups,
  audit logs, and changelog data are preserved.
- Existing production APP_ORIGIN values continue to work. Use APP_ORIGINS when
  production needs to allow multiple browser URLs.

Production verification
-----------------------

After installing this package:

1. Confirm /api/version shows 2.0.72.
2. Login on desktop and confirm Dashboard, Patients, and RX Records load.
3. Open the site from a phone-width browser viewport.
4. Confirm Dashboard cards and RX Workflow Pipeline fit without clipped icons.
5. Confirm Patients rows are readable card rows with tappable actions.
6. Confirm RX Records rows and workflow actions are readable on phone width.
7. Confirm the production .env contains the browser origin users type.
8. If available, run a controlled Backoffice 2FA reset for a test user.

Production package
------------------

- Deploy dist/server-update-2.0.72.zip or approved dist files only.
- Keep the production .env unchanged and next to server.exe.
