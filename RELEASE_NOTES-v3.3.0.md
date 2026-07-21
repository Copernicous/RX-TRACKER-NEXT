# Patient RX System v3.3.0

## Highlights

- The customized RX Softphone source is now maintained with RX Tracker under `rx-softphone-desktop`; generated Windows packages remain release artifacts rather than tracked binaries.
- Added `docs/RX_SOFTPHONE_REMOTE_TESTING.md` for Windows installation, pairing, startup, two-PC/shared-extension validation, and server-side secret/backup/migration preparation.
- Adds RX Softphone call-state integration with automatic Call Center attempt history, answer acknowledgement, durations, SIP results, and reporting.
- Adds the outbound Windows relay used by Kasm and other remote browsers while SIP registration and audio remain on the physical Windows computer.
- Adds per-user, administrator-authorized Phone Account Setup and persistent encrypted SIP assignments.
- Adds live phone availability, cooldown countdowns, connected-call timers, in-row hangup, clinic/location, and patient transport information.
- Preserves unanswered attempts without marking the patient Called; answered calls are recorded automatically.

## Windows client

Install RX Softphone `0.4.1` or later. Version 0.4.1 correctly records a pre-answer local or relay hangup as `cancelled` rather than `failed`.

## Database impact

This release adds `UserSoftphoneAccounts`, `CallCenterCallAttempts`, `SoftphoneRelayDevices`, and `SoftphoneRelayCommands`, plus the per-user phone-setup permission. The migrations are additive. Existing applications can be rolled back while the added tables remain unused, but retained call history should not be removed during a normal rollback.

## Production configuration

- Set stable, protected `SOFTPHONE_CREDENTIAL_KEY` and `SOFTPHONE_RELAY_SECRET` values.
- Set `SOFTPHONE_ACCOUNT_ADMIN_PIN` when administrative approval is required for SIP account changes.
- Back up the production database and current application package before deployment.
- After deployment, choose the production Call Center phone client and configure each user through **Administration > Users > Allow setup**.

## Verification

- Confirm RX Softphone reports `Relay online` and `Registered`.
- Verify one answered call is marked Called automatically with ring/conversation durations.
- Verify one cancelled/unanswered attempt is retained without a Called record.
- Verify cooldown/claim behavior with two Call Center users and review the Call Attempts report.
