# Changelog

## 0.5.0 - 2026-07-23

- Replaced the persistent CMD window with a native Windows notification-area application.
- Added colored tray state, SIP registration, relay, active-call state and duration, and last-call number/outcome/duration.
- Added Open, Hang Up, managed Disable/Enable, administrator-locked Unpair, and graceful Exit tray controls.
- Added a single-instance guard so a second launch opens the existing control panel without competing for port 5188.
- Made packaged control-panel assets load from the executable directory, including when launched by a Windows Startup shortcut.
- Kept SIP, RTP/audio, Auth ID, relay pairing, DPAPI token storage, and RX Tracker call telemetry behavior unchanged.

## 0.4.4 - 2026-07-23

- Fixed outbound calls with a separate SIP Authentication ID ending immediately after the PBX returned `200 OK`.
- Restored the SIPSorcery outbound descriptor fields used by the proven pre-Auth-ID call path while retaining the distinct digest authentication username.
- Added a credential-safe diagnostic event for an in-dialog `BYE` received from the remote SIP endpoint.
- Verified ringing, answer, two-way connected call state, and a normal local hangup during a 52-second Grandstream UCM test call.

## 0.4.3 - 2026-07-22

- Added an optional SIP Authentication ID for PBX accounts whose digest login differs from the visible extension.
- Kept the extension in the SIP address-of-record, Contact, From identity, and RX Tracker status while using Authentication ID only for REGISTER and authenticated outbound INVITE challenges.
- Preserved backward compatibility by using the extension as Authentication ID whenever the new field is blank.
- Kept SIP signaling on UDP and RTP/audio behavior unchanged.

## 0.4.2 - 2026-07-21

- Enabled managed mode by default: RX Tracker supplies the assigned PBX account, while local PBX fields, Register/Unregister, and Remove pairing are locked in both the interface and loopback API.
- Added client-version and managed-policy reporting so Administrators can identify outdated, unsynchronized, offline, or unregistered workstations in RX Tracker.
- Deferred account replacement during active calls and held relay dial commands until registration succeeds.
- Stopped a permanent SIP registration failure from repeatedly using the rejected credential; the client waits for an updated Administrator assignment.
- Added bounded relay network backoff and automatic local cleanup when an Administrator revokes or replaces the pairing.
- Preserved local manual dialing, direct SIP/RTP, DPAPI-protected pairing, and the existing 0.4.1 pre-answer cancellation behavior.

## 0.4.1 - 2026-07-21

- Fixed a local or relay hangup before answer being reported as `failed`; it is now recorded as `cancelled` while retaining the SIP response and ring duration.

## 0.4.0 - 2026-07-21

- Added a persistent outbound RX Tracker relay for Kasm and other remote-browser sessions that cannot access the Windows loopback API.
- Added one-time pairing, encrypted per-Windows-user device-token storage, heartbeat status, remote dial, remote hangup, and automatic call-state reporting.
- Kept the local API bound to `127.0.0.1`; SIP registration remains native UDP and call audio remains on the Windows microphone and speakers.
- Preserved direct local and FortiGate browser-to-loopback calling as the preferred path, with the relay available only as a fallback.

## 0.3.1 - 2026-07-20

- Added deterministic local ringback when Asterisk reports an outbound call as ringing, without depending on RTP early media from the PBX.
- Added a local incoming-call ringtone using the same default Windows speaker.
- Stopped local ringing immediately on answer, rejection, failure, cancellation, hangup, unregister, and application exit.
- Added the `--test-ringtone` diagnostic switch to verify the selected Windows output device without registering to SIP.

## 0.3.0 - 2026-07-20

- Added an RX Tracker correlation ID to each outgoing call so browser reloads can reconcile the same durable call-attempt record.
- Added dial, ring, answer, and end timestamps plus terminal outcome and SIP response code/reason to the loopback status API.
- Classified answered, no-answer, busy, rejected, unavailable, cancelled, and failed outcomes for administrator reporting.
- Retained the completed call snapshot long enough for RX Tracker polling to persist the final analytics automatically.

## 0.2.1 - 2026-07-20

- Added the accepted audio codec list to the RX Softphone interface: G.711 &mu;-law (PCMU), G.711 A-law (PCMA), G.722, and G.729.
- Clarified that the PBX negotiates a common advertised codec automatically for each call.

## 0.2.0 - 2026-07-20

- Added the reviewed RX Tracker integration while keeping the control API bound to loopback only.
- Allowed only the configured RX Tracker production, staging, server, and localhost origins to use the local API from a browser.
- Added CORS and compatible local/private-network preflight responses for browser-to-loopback requests.
- Kept call state, answered timestamp, and hangup controls available to RX Tracker without storing SIP credentials in the tracker.

## 0.1.1 - 2026-07-20

- Matched the supplied MicroSIP account pattern: PBX server, proxy, and domain use the same Asterisk address while account name, username, and login use the extension.
- Changed SIP registration refresh from 180 to 300 seconds.
- Added a 15-second UDP CRLF keep-alive from the same native SIP socket.
- Documented that transport is UDP and media encryption is disabled.

## 0.1.0 - 2026-07-20

- Added native SIP/UDP registration to an Asterisk PBX on port 5060.
- Added Windows microphone and speaker RTP audio.
- Added outgoing dial, incoming answer/reject, hangup, mute, and DTMF controls.
- Added precise registration and call-state reporting for later RX Tracker integration.
- Added a loopback-only web-style control panel with runtime-only password handling.
- Added a self-contained Windows x64 release build.
