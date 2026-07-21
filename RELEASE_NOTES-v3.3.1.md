# Patient RX 3.3.1 / RX Softphone 0.4.2

Release date: 2026-07-21

## Purpose

This stability release turns the Windows RX Softphone into a managed RX Tracker workstation client. It preserves direct SIP/RTP calling and the outbound Cloudflare/Kasm relay while preventing Call Center users from changing the assigned PBX account or removing the pairing locally.

## What changed

- **Managed phone configuration:** RX Tracker supplies the account. RX Softphone locks PBX fields, Register/Unregister, and local unpair operations in both its UI and loopback API.
- **Administrator device control:** **Administration > Phone Devices** shows paired users, workstation/client version, managed state, account synchronization, registration, call state, and last heartbeat. An Administrator can revoke an idle device.
- **Safer SIP failures:** a rejected account is not resent every relay poll, and the client stops a permanent registration failure until the Administrator corrects the assignment. This reduces repeated-authentication and Fail2ban exposure.
- **More resilient relay:** temporary relay failures use bounded retry backoff; account updates wait for active calls to end; dialing waits until registration is ready; invalidated device tokens clear the local pairing and registration.
- **Version enforcement visibility:** RX Tracker identifies 0.4.2 as the minimum managed client and flags paired older clients for upgrade.

## Compatibility and database impact

- There is **no database migration** in 3.3.1. Managed metadata uses the existing `SoftphoneRelayDevices.snapshot` JSON.
- Existing 0.4.1 pairings remain compatible and do not need a new code during a normal in-place 0.4.2 upgrade, provided the same persistent Windows user/profile and relay state are retained.
- RX Softphone 0.4.1 can still call but is reported as requiring an update and does not enforce managed local controls.
- MicroSIP calling remains available through the existing Backoffice phone-client selector.

## Deployment

1. Back up the production database, current server package, production `.env`, and current RX Softphone workstation folder.
2. Deploy RX Tracker 3.3.1 without replacing `.env`.
3. Keep `SOFTPHONE_CREDENTIAL_KEY`, `SOFTPHONE_RELAY_SECRET`, `JWT_SECRET`, and the optional `SOFTPHONE_ACCOUNT_ADMIN_PIN` unchanged.
4. Replace the complete RX Softphone folder on each calling workstation with `RxSoftphone-0.4.2-win-x64.zip`. Do not mix individual files from 0.4.1 and 0.4.2.
5. Start the client under the same persistent Windows user. Confirm **v0.4.2**, **Relay online**, **Registered**, and **Managed by RX Tracker**.
6. In RX Tracker, open **Administration > Phone Devices** and confirm version 0.4.2, managed status, account synchronized, and a recent heartbeat.

## Production acceptance

- Sign in as Administrator and as one Call Center user.
- Verify Patients, RX Records, Call Center, Reports, Backoffice, and Phone Devices load.
- Verify the Call Center user cannot change local PBX fields, unregister, or remove pairing.
- Complete one answered call and confirm automatic Called status plus dial/ring/answer/end telemetry.
- Cancel one call before answer and confirm it remains an attempt without marking Called.
- Temporarily interrupt network access and confirm the relay reconnects after restoration without re-pairing.
- Revoke an idle test workstation from Phone Devices; confirm it goes offline/unregisters, its old token no longer works, and a new pairing code is required.
- If testing a deliberately incorrect SIP password, stop after the single failed registration, correct the assignment, and verify the remote public IP was not banned. Never disable Fail2ban as the workaround.

## Rollback

RX Tracker 3.3.0 can run against the unchanged 3.3.1 database because 3.3.1 adds no schema. Restoring RX Softphone 0.4.1 removes managed local-control enforcement, so use that only as a short emergency rollback on an administrator-controlled workstation. Restore the saved full server/workstation packages rather than mixing versioned files.
