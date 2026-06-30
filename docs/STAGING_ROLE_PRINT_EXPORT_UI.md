# Staging Note: Role Print and Export Button Controls

Date: 2026-06-30
Branch: develop
Environment: staging only

## Purpose

This staging feature adds a separate `Print` role permission next to the existing `Export` permission.

The first testing pass is UI-only:

- Users still see print/export buttons.
- Buttons are disabled when the current role does not allow that action.
- Disabled buttons show a role-based tooltip.
- Backend export/download route enforcement is not included in this staging pass.

## Scope

Covered in this pass:

- Roles Management permission editor and overview matrix
- Dashboard is always visible and no longer exposes Export/Print role toggles
- Patients export, print, and RX service history print/export buttons
- RX Records export and print buttons
- Reports CSV, Excel, PDF, and print buttons
- Audit Log export buttons
- Patient Timeline print/export buttons
- Generic CRUD export buttons

Not covered in this pass:

- Browser-native print shortcuts such as Ctrl+P
- Direct API blocking for known export/download URLs
- Master-only Back Office export tools

## Testing Notes

For staging validation:

1. Create or edit a non-admin role.
2. Turn `Export` off for Patients, RX Records, Reports, and Audit Log.
3. Turn `Print` off for Patients, RX Records, and Reports.
4. Assign the role to a staging test user.
5. Log in as that user and confirm the relevant buttons remain visible but disabled.
6. Re-enable one permission at a time and confirm buttons become clickable again after login refresh.

## 2026-06-30 Auth Cookie Fix

Adding `canPrint` to every module made the `rxToken` JWT exceed the browser cookie size limit for some roles. The login API returned success, but the browser dropped the oversized cookie, so the next `/dashboard` request redirected back to `/login`.

Staging fix:

- `rxToken` now stores only compact session/user claims.
- Role permissions are hydrated from the database in web/API auth middleware.
- Login/profile responses and rendered pages still receive the current role permissions for UI gating.

## 2026-06-30 Help Panel Layout Fix

The global Help/User Manual drawer could appear as normal page content at the bottom of Roles if its dynamically injected CSS did not apply in the browser. The drawer now sets critical `position: fixed`, hidden `right` offset, overlay display, and open/close styles directly on the created elements so it cannot leak into page flow.

## 2026-06-30 Read-Only Background Polling Fix

Read-only users should not call admin-only background APIs. The notification bell now initializes only when Audit Log is visible for the role, and the sidebar "Who's Online" poll starts only when the online badge is actually rendered. This prevents avoidable 403 noise for read-only sessions.

The `/roles` web route now also redirects server-side to `/dashboard` unless the user is an administrator or has the User Management module visible. This prevents restricted users from briefly loading the Roles page scripts before the client-side redirect runs.
