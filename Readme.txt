Patient RX System v3.3.1
=========================

Production Release: RX Softphone and Call Center Telemetry

This release adds native RX Softphone calling, automatic answered-call
recording, unanswered-attempt history, SIP outcomes, ring/conversation
durations, connected-call controls, live patient availability, and Call
Center attempt reporting.

RX Softphone 0.4.2 adds the managed outbound Windows relay used by Kasm and other
remote browsers. SIP registration and audio remain on the physical Windows
computer. A pre-answer local or relay hangup is recorded as cancelled and
does not mark the patient Called. Local phone-account and unpair controls are
locked; Administrators inspect and revoke devices from Administration > Phone Devices.

Phone account setup
-------------------

1. In Backoffice > Settings, choose the production Call Center phone client.
2. In Administration > Users, select Allow setup for an individual user.
3. The selected user completes Phone Account Setup once.
4. Start RX Softphone 0.4.2 or later on the Windows calling computer.
5. For Kasm/remote-browser operation, pair the Windows phone from Call Center.

Database impact
---------------

The additive migrations create UserSoftphoneAccounts, CallCenterCallAttempts,
SoftphoneRelayDevices, and SoftphoneRelayCommands and add the per-user phone
setup permission. Existing patient, RX, reference, user, and audit data is
preserved. Call-attempt history remains available after normal patient deletion.

Production configuration
------------------------

- Preserve the existing production .env during deployment.
- Configure stable SOFTPHONE_CREDENTIAL_KEY and SOFTPHONE_RELAY_SECRET values.
- Configure SOFTPHONE_ACCOUNT_ADMIN_PIN when approval is required for account changes.
- Install/distribute RX Softphone 0.4.2 or later to each calling workstation.
- Back up the production database and keep the previous release package.

Production verification
-----------------------

1. Confirm server.exe --v reports 3.3.1.
2. Confirm login, Patients, RX Records, and Call Center load normally.
3. Confirm the Windows client reports Relay online and Registered.
4. Complete one answered call and verify automatic Called status, SIP 200,
   ring duration, conversation duration, and final end time in reports.
5. Cancel one call before answer and verify it remains an attempt without a
   Called record.
6. Confirm the cooldown countdown expires and another agent can call afterward.
7. Verify a Call Center user cannot change the managed local phone account or
   remove the pairing; verify an Administrator can revoke it in Phone Devices.

Production package
------------------

- Deploy dist/server-update-3.3.1.zip or approved dist files only.
- Keep the production .env unchanged beside server.exe.
- Keep the previous server update ZIP and database backup for rollback.
