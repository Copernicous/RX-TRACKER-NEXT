# Patient RX Security Controls Implemented

Inventory date: 2026-06-29
Application version reviewed: 2.0.68

This document lists the security controls currently implemented in the Patient RX application code and the security controls visible to users in the front end. It is an engineering inventory, not a legal/HIPAA compliance certification.

## Summary

The application is protected mainly by cookie-only authenticated access, role-based permissions, security headers, CSRF protection, CORS restrictions, rate limits, 2FA support, audit logging, document upload removal, SMTP secret encryption at rest, and admin/master-admin separation.

Patient and RX data are stored on the local server/PostgreSQL. The application does not currently encrypt individual patient columns inside PostgreSQL. Protection at rest depends on the server/database/storage controls, such as Windows BitLocker, PostgreSQL storage security, backups security, and OS permissions.

## Server And Code Controls

### Network, Proxy, And Browser Headers

| Control | Current implementation | Code location |
| --- | --- | --- |
| Reverse proxy trust is limited | Express trusts only the first proxy hop, intended for the FortiGate/reverse proxy path. This reduces spoofing risk from arbitrary `X-Forwarded-*` headers. | `app.js` |
| Optional HTTPS enforcement | If `FORCE_HTTPS=true`, HTTP requests redirect to HTTPS and Helmet HSTS is enabled. If HTTPS is not configured, upgrade-insecure-requests is intentionally omitted. | `app.js` |
| Helmet security headers | Helmet is enabled with CSP, frame/object restrictions, base URI and form-action restrictions, and HSTS when HTTPS is forced. | `app.js` |
| Content Security Policy | CSP limits default/script/style/image/connect sources. `frameSrc` and `objectSrc` are blocked. `frameAncestors` is restricted to self. | `app.js` |
| CORS allowlist | `APP_ORIGIN` supports a comma-separated allowlist. Production refuses to start if `APP_ORIGIN` is missing, preventing open credentialed CORS. | `app.js` |
| No proxy/browser caching of app pages | Responses set `Cache-Control: no-store, no-cache, no-transform`, `Pragma: no-cache`, and `Expires: 0`. This reduces stale page and proxy transformation problems. | `app.js` |
| Local assets | Bootstrap, Font Awesome, and app assets are served locally instead of external CDNs. | `views`, `public/assets` |

### Authentication And Session Controls

| Control | Current implementation | Code location |
| --- | --- | --- |
| Cookie-only JWT authentication | APIs require the JWT in the HttpOnly `rxToken` cookie. Browser-readable Bearer-token auth was removed from the front end and shared auth middleware. | `middleware/auth.js`, `controllers/authController.js`, `public/js/app.js`, `public/js/base.js` |
| CSRF protection | Unsafe cookie-authenticated requests require an `X-CSRF-Token` header matching the same-origin `rxCsrf` cookie. | `app.js`, `public/js/base.js` |
| Web page login gate | Protected HTML pages redirect to `/login` if there is no valid web auth cookie. | `routes/webRoutes.js`, `middleware/webAuth.js` |
| JWT expiry | Full login tokens expire after 8 hours. | `controllers/authController.js` |
| Token invalidation after password change | Tokens include `tv` token version. Password changes increment `tokenVersion`, invalidating old tokens. | `middleware/auth.js`, `controllers/authController.js` |
| Password hashing | User passwords are stored as bcrypt hashes, not plaintext. Normal user create/update uses bcrypt; password change/reset uses stronger bcrypt cost where implemented. | `controllers/userController.js`, `controllers/authController.js`, `app.js` |
| Generic login failure message | Login does not reveal whether the username exists. | `controllers/authController.js` |
| Inactive account block | Inactive users cannot log in. | `controllers/authController.js` |
| Account lockout | Failed password or 2FA attempts increment `failedLoginCount`; account is locked for 15 minutes after the configured `max_failed_logins` threshold. | `controllers/authController.js`, `controllers/twoFactorController.js`, `services/settingsService.js` |
| Login rate limit | `/api/auth/login` allows 15 failed attempts per IP per 15 minutes; successful requests are skipped. | `app.js` |
| Logout tracking | Logout writes an audit log entry, removes the active session from the in-memory session tracker, and clears local/proxy auth and CSRF cookie variants. | `routes/apiRoutes.js` |
| Profile data excludes secrets | Profile responses exclude `passwordHash`, `twoFactorSecret`, and `backupCodes`. | `controllers/authController.js` |

### Two-Factor Authentication

| Control | Current implementation | Code location |
| --- | --- | --- |
| TOTP setup | Users can enroll an authenticator app with QR code setup. | `controllers/twoFactorController.js`, `views/dashboard.ejs`, `public/js/dashboard.js` |
| 2FA login step | Password success for a 2FA-enabled user returns a temporary 5-minute token; full login is issued only after TOTP or backup-code verification. | `controllers/authController.js`, `controllers/twoFactorController.js` |
| 2FA rate limit | `/api/auth/login/2fa` is limited to 10 attempts per IP per 15 minutes. | `routes/twoFactorRoutes.js` |
| 2FA setup rate limit | 2FA setup/enable endpoints are limited to 10 requests per IP per 15 minutes. | `app.js` |
| Backup codes | Eight one-time backup codes are generated; plaintext is shown once, only bcrypt hashes are stored, and used codes are consumed. | `controllers/twoFactorController.js` |
| 2FA disable protection | Disabling 2FA requires a current authenticator code. | `controllers/twoFactorController.js` |
| Admin 2FA reset | Admins can reset a user's 2FA enrollment if the user loses access. | `controllers/twoFactorController.js` |
| Global 2FA enforcement toggle | System Settings can enable/disable whether users with configured 2FA are prompted at login. User 2FA secrets are preserved. | `services/settingsService.js`, `public/js/system-settings.js` |

### Role-Based Access Control

| Control | Current implementation | Code location |
| --- | --- | --- |
| Server-side RBAC | API routes enforce permissions on the server, not only in the UI. | `middleware/rbac.js`, `routes/apiRoutes.js` |
| Granular permission actions | Permissions include `visible`, `canAdd`, `canEdit`, `canDelete`, `canExport`, `canUndo`, `canWarehouse`, and `canOverrideExpired`. | `middleware/rbac.js` |
| Built-in roles | Administrator, Supervisor, Operator, and Read Only roles are seeded/maintained with default permissions. | `middleware/rbac.js`, `app.js` |
| Admin-only role management | Role management endpoints require Administrator role. | `routes/apiRoutes.js` |
| Admin-only settings | System Settings endpoints require Administrator role. | `routes/apiRoutes.js` |
| Master-admin backoffice | `/backoffice` and `/api/admin/*` require `isMaster=true`. That flag is not exposed in the normal UI or API and must be set directly in PostgreSQL. | `middleware/rbac.js`, `routes/webRoutes.js`, `routes/apiRoutes.js` |
| User field whitelist | User create/update only accepts allowed fields and blocks arbitrary writes to sensitive fields such as `isMaster`, `tokenVersion`, 2FA fields, and password hash except through intended password flows. | `controllers/userController.js` |
| Self-disable prevention | A user cannot disable their own account through normal user management. | `controllers/userController.js` |

### Patient, RX, And Document Protection

| Control | Current implementation | Code location |
| --- | --- | --- |
| Patient/RX API permissions | Patient and RX read/write/delete/export/workflow actions are permission-gated. | `routes/apiRoutes.js`, `middleware/rbac.js` |
| Patient soft locks | Patient edit/timeline viewing has soft-lock/awareness endpoints so users can see when another user is viewing/editing the same patient. | `routes/apiRoutes.js`, `controllers/patientLockController.js`, `views/patients.ejs`, `views/patient-timeline.ejs` |
| Document upload removed | Patient/RX document upload routes, upload controller exports, upload client method, and storage upload service were removed/disabled. | `routes/apiRoutes.js`, `controllers/documentController.js`, `services/documentStorageService.js`, `public/js/documents.js` |
| Document listing protected | Existing document metadata can only be listed by users with patient/RX read permission. | `routes/apiRoutes.js`, `controllers/documentController.js` |
| Document download protected | Existing document downloads are role-checked before serving the file. | `controllers/documentController.js` |
| Document download hardening | Downloads use a safe MIME allowlist fallback, `X-Content-Type-Options: nosniff`, a sandbox CSP, and `Content-Disposition: attachment`. | `controllers/documentController.js` |
| Google Drive document access disabled | Drive-backed document rows are not exposed as downloadable links, and the storage service no longer performs Google Drive API token/download/delete calls. | `controllers/documentController.js`, `services/documentStorageService.js`, `public/js/documents.js` |
| Document delete protected | Existing document delete requires delete permission and soft-deletes the DB record. Local stored files are removed when present. | `controllers/documentController.js`, `services/documentStorageService.js` |

### Import, Backup, And Restore Controls

| Control | Current implementation | Code location |
| --- | --- | --- |
| CSV import auth | Import routes require authentication. Import execution requires import write permission. | `routes/importRoutes.js` |
| CSV upload limits | Import accepts CSV-like files only and limits upload size to 5 MB. | `routes/importRoutes.js` |
| Import validation before write | Patient import validates rows, duplicates, dates, service-date/workflow timing, and reference matches before writing records. | `controllers/importController.js` |
| Backup management admin-only | Backup status, run, schedule, download, delete, and restore endpoints require Administrator role. | `routes/apiRoutes.js` |
| Restore upload restriction | DB restore accepts `.dump` files only and caps upload size at 500 MB. | `routes/apiRoutes.js` |
| Backup file path hardening | Backup download/delete endpoints use `path.basename()` to avoid using raw path input as a filesystem path. | `routes/apiRoutes.js` |
| Full site backup admin-only | Full site backup actions are Administrator-only. | `routes/apiRoutes.js`, `services/backupService.js` |

### Settings, Secrets, And Email Alerts

| Control | Current implementation | Code location |
| --- | --- | --- |
| Sensitive settings masking | `smtp_pass` is masked when settings are returned to the browser. Email status exposes only `smtp_pass_set`, not the password value. | `services/settingsService.js`, `controllers/settingsController.js` |
| SMTP password encrypted at rest | `smtp_pass` is encrypted before being saved to the settings table using AES-256-GCM and decrypted only into server memory. Existing plaintext values are migrated on settings load when a server secret is available. | `services/settingsService.js` |
| SMTP password preservation | Saving SMTP settings with a blank password does not erase the existing saved SMTP password. | `controllers/settingsController.js` |
| Settings write rate limit | `/api/settings` is limited to 20 changes per IP per 15 minutes. | `app.js` |
| Settings validation | Timezone is validated against a known list; SMTP port is validated as 1-65535. | `controllers/settingsController.js` |
| Settings audit logging | Setting changes write audit records, with password/secret/token/key values redacted in audit payloads. | `controllers/settingsController.js` |
| Email alert recipients | Email alerts support global recipients plus per-user granular subscriptions. | `services/settingsService.js`, `controllers/settingsController.js`, `public/js/system-settings.js` |
| Email alert user inspection | Admins can inspect one user's alert configuration in plain language. | `controllers/settingsController.js`, `public/js/system-settings.js` |

### Audit, Activity, And Monitoring

| Control | Current implementation | Code location |
| --- | --- | --- |
| CRUD audit logging | Create/update/delete/restore/workflow operations are logged with module, action, record, user, IP, and sanitized request body. | `middleware/auditLogger.js`, `routes/apiRoutes.js` |
| Password excluded from audit body | Audit logger strips `password` and `passwordHash` from standard request bodies. | `middleware/auditLogger.js` |
| Authentication audit logs | Login, failed login, account lockout, logout, password change, 2FA changes, and backup-code login events are logged. | `controllers/authController.js`, `controllers/twoFactorController.js`, `routes/apiRoutes.js` |
| Page activity logs | Authenticated page visits are logged with username/role snapshot, page, IP, user agent, referrer, and status code. | `middleware/userActivityLogger.js` |
| Active sessions tracker | Heartbeats maintain a "Who's Online" view with current page and last seen time. | `services/sessionTracker.js`, `public/js/base.js`, `routes/apiRoutes.js` |
| Front-end error logging | Client-side errors and unhandled promise rejections can be posted to `/api/errors` and reviewed by admins. | `public/js/base.js`, `public/js/app.js`, `routes/apiRoutes.js` |
| Error log admin controls | Error log viewing/resolution/deletion is Administrator-only. | `routes/apiRoutes.js`, `controllers/errorLogController.js` |

### Input And Output Safety

| Control | Current implementation | Code location |
| --- | --- | --- |
| Request size/file limits | CSV import and DB restore have explicit file limits. | `routes/importRoutes.js`, `routes/apiRoutes.js` |
| File type allowlists | CSV import, document downloads, and restore uploads use extension/MIME allowlists. | `routes/importRoutes.js`, `routes/apiRoutes.js`, `controllers/documentController.js` |
| HTML escaping helpers | Shared front-end helpers such as `escHtml`, `safeHtml`, and module-specific escape helpers are used in many dynamic render paths. | `public/js/base.js`, `public/js/system-settings.js`, `public/js/documents.js`, `public/js/patients.js` |
| CSV formula protection helper | `sanitizeCsvCell()` prefixes dangerous spreadsheet formula-leading characters before CSV export when used by export code. | `public/js/base.js` |
| Sequelize/replacements | Main CRUD paths use Sequelize models; many raw SQL paths use replacements for user values. | `controllers`, `models` |

## User-Facing Security Controls

These are the security protections or indicators that users see in the application UI.

| User-facing control | What the user sees | Server enforcement behind it |
| --- | --- | --- |
| Login screen | Username/password login; generic errors; 2FA step appears when required. | JWT auth, password hashing, inactive-user block, lockout, rate limits |
| 2FA account panel | Users can set up 2FA, scan QR code, save backup codes, disable 2FA with authenticator code, or regenerate backup codes. | TOTP verification, hashed backup codes, audit logs |
| Global 2FA setting | Admins see a System Settings toggle and warning when global 2FA enforcement is disabled. | `require_2fa` setting checked during login |
| Session warning | Users see "Session Expiring Soon" and can stay logged in or log out. | Front-end idle timer uses `/api/session-config`; JWT still expires after 8 hours |
| Access denied feedback | Forbidden actions show "Access denied" toast/message instead of exposing data. | Server returns 403 from RBAC/admin/master checks |
| Permission-aware sidebar | Users only see modules their role can access. | Server routes still enforce permissions |
| Read-only/edit restrictions | Buttons, fields, save/delete/export controls are hidden or disabled when permission is missing. | Server RBAC enforces the same actions |
| Audit Log page | Authorized users can review audit and activity history. | Audit routes require `audit_log` permission or Administrator for deletion |
| Who's Online | Authorized users can see active sessions and pages being used. | Active sessions endpoint requires `active_users` permission |
| Staging banner | Staging environment is visibly marked on login/sidebar/navbar. | Environment markers from server locals |
| Document area | Existing documents can be listed/downloaded if allowed; upload controls are removed. | Upload routes are not mounted; document list/download checks permissions |
| System Settings security card | Admins can configure session timeout and max failed login threshold. | Session timeout is read by front end; failed-login and 2FA lockout code reads the configured threshold |
| Email security alerts | Admins can configure security alert conditions and per-user subscriptions. | Settings are admin-only and audited |
| Backup/restore warnings | Restore UI requires deliberate confirmation and shows warnings. | Backup/restore endpoints are Administrator-only |

## Configuration Parameters That Affect Security

| Parameter/setting | Purpose | Current behavior |
| --- | --- | --- |
| `APP_ORIGIN` | Allowed browser origins for credentialed CORS | Required in production; comma-separated allowlist |
| `FORCE_HTTPS` | Enforce HTTPS redirect and HSTS | Only active when set to `true` |
| `JWT_SECRET` | Signs/verifies JWT tokens | Required for secure auth; must be strong and private |
| `SESSION_TIMEOUT_MINUTES` / `session_timeout_minutes` | Front-end idle timeout | Default 30 minutes; clamped by API to 5-480 minutes |
| `MAX_FAILED_LOGINS` / `max_failed_logins` | Failed-login threshold setting | Login and 2FA lockout paths read this setting; valid range is 1-20 |
| `require_2fa` | Global 2FA enforcement | Defaults to true; if false, users with 2FA configured skip code prompt |
| `DOCUMENT_UPLOAD_MAX_MB` | Legacy document upload limit | Patient/RX document upload code is removed/disabled, so this no longer controls patient/RX uploads |
| `GOOGLE_DRIVE_ENABLED` | Legacy Drive storage flag | Document storage service returns disabled and does not call Google Drive APIs |
| `LOG_FILE` / `DEBUG` | Controls HTTP access logging verbosity/destination | Production uses combined logging unless debug is enabled |
| `SMTP_*` settings | Email delivery for alerts/reports | SMTP password is masked to browser, encrypted in the settings table, and decrypted into server memory/process env for mail delivery |

## Remaining Gaps And Recommended Next Hardening

These are the items still pending after the staging hardening pass.

1. CSP still allows inline scripts/styles. CSP uses `'unsafe-inline'` because the current app still has inline handlers and inline scripts. Recommended fix: move inline scripts/handlers into static JS files and then switch to a nonce-based or stricter CSP.

2. Session timeout is still primarily front-end idle enforcement. Users are redirected after inactivity, and the auth cookie/JWT still has an 8-hour absolute expiry. Recommended fix: add server-side idle session tracking or rotate/refresh tokens with an idle timeout if stricter inactivity enforcement is required.

3. PostgreSQL patient/RX column-level encryption is not implemented. Patient names, phones, addresses, notes, service dates, and RX workflow data are stored normally in PostgreSQL. Current protection should rely on BitLocker/full-disk encryption, restricted Windows/PostgreSQL accounts, secure backups, and limited server access. Future option: add application-level encryption for selected sensitive columns if required.

4. Security alerts are configurable, but not every alert rule is wired to automatic background detection yet. Recommended fix: connect enabled rules to scheduled jobs or event hooks for failed-login spikes, backup missing, permission-denied spikes, critical-error spikes, and similar events.

## Practical Production Verification

Use this checklist after each security-related release:

1. Confirm `/api/version` and sidebar show the expected version.
2. Open a protected page while logged out and confirm it redirects to `/login`.
3. Log in as a low-permission user and confirm hidden modules are not visible.
4. Try calling a forbidden API action and confirm it returns 403.
5. Log in with an incorrect password enough times to confirm failed attempts are logged and lockout occurs.
6. Confirm a 2FA-enabled user is prompted for a code when global 2FA is enabled.
7. Confirm the browser does not receive/store a full JWT in `localStorage` or a JavaScript-readable `rxToken` cookie.
8. Confirm unsafe API requests without the `X-CSRF-Token` header return 403.
9. Confirm logout clears the session and writes an Authentication / Logout audit entry.
10. Confirm System Settings returns masked SMTP password values only and stores `smtp_pass` encrypted in the database.
11. Confirm patient/RX document upload controls are absent.
12. Confirm old Drive-backed document rows do not expose Drive download links.
13. Confirm Audit Log and User Activity Log are visible only to authorized roles.
14. Confirm Backup Management is Administrator-only.
15. Confirm Back Office is blocked unless `isMaster=true`.
