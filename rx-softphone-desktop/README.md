# RX Tracker Softphone

The first-party Windows softphone customized for RX Tracker. It registers directly to the PBX with SIP over UDP and uses native Windows microphone/speaker audio over RTP. The interface is served locally at `http://127.0.0.1:5188`; it is not a WebRTC client and does not use WSS.

RX Tracker can control this process through its loopback-only integration API. The softphone still registers directly to Asterisk and does not change the proxy or Asterisk configuration.

## Current test defaults

- PBX server: `192.168.15.200`
- SIP port: `5060`
- Transport: UDP
- Extension: `1006`
- Local SIP port: automatic by default
- Registration refresh: `300` seconds
- UDP keep-alive: `15` seconds
- Media encryption: disabled
- Audio codecs: G.711 &mu;-law (PCMU), G.711 A-law (PCMA), G.722, and G.729
- Account password: never stored by the native softphone; enter it locally or let RX Tracker supply it transiently from the encrypted per-user server assignment

## MicroSIP field equivalent

Use the extension number for **Account Name**, **Username**, **Login**, and normally **Display Name**. Use `192.168.15.200` for **SIP Server**, **SIP Proxy**, and **Domain**. The native client treats that same PBX address as its registrar, outbound proxy, account domain, and call destination host. It uses UDP, automatic public-address handling, disabled media encryption, a 300-second registration refresh, and a 15-second UDP keep-alive.

The screenshot supplied for extension `1002` is an example of this pattern. The proof-of-concept default remains extension `1006`; changing the extension in the interface applies the same mapping without changing source code.

## Run the test build

From this folder, use the installed .NET 10 SDK or the optional untracked portable SDK under `.dotnet`:

```powershell
dotnet run -c Release
```

The program opens the control panel in the default browser. To keep it from opening the browser automatically, append `-- --no-browser`.

After publishing, double-click `Start-Softphone.cmd` or start `release\0.4.1\RxSoftphone.exe`. The published release contains its own .NET runtime. Keep the console window open while using the phone; closing it unregisters the softphone and exits the local service.

To verify the default Windows speaker without registering to SIP, run `RxSoftphone.exe --test-ringtone`. The diagnostic plays the same local tone used for outbound ringback and incoming calls for three seconds, then exits.

## PBX test checklist

1. Close or unregister MicroSIP if Asterisk permits only one contact for extension `1006`.
2. Start RX Native Softphone and enter the account password.
3. Select **Register** and wait for the badge to show **Registered**.
4. Call another internal extension first. Confirm ringing, two-way audio, mute, DTMF, and hangup.
5. Call extension `1006` from a different phone. Confirm the incoming-call panel, Answer, Reject, two-way audio, and remote hangup.
6. Only after internal calls work, test an external number allowed by the Asterisk dial plan.

Windows may ask for firewall permission the first time. SIP signaling uses UDP 5060 on the PBX; RTP audio uses the UDP media ports negotiated by Asterisk and the client. The PC must have network access to those ports.

## Local integration API

The browser interface and RX Tracker call a loopback-only API. It exposes a tracker correlation ID, registration status, precise call states, dial/ring/answer/end timestamps, terminal outcome, and SIP response code/reason. RX Tracker uses these fields for click-to-call, automatic attempt analytics, answered-call recording, and Hang Up.

The API rejects non-loopback clients and browser origins outside `Softphone:AllowedOrigins`. The default allowlist contains the approved RX Tracker production, staging/LAN, and localhost origins. Keep the API bound to `127.0.0.1`; do not expose it to the LAN.

In RX Tracker, a master user selects **MicroSIP**, **RX Softphone**, or **Automatic** under Backoffice settings. RX Softphone must be running and show **Registered**. In Automatic mode, RX Tracker falls back to MicroSIP when the local client is unavailable. A supported browser may request one-time permission to connect to a service on the local computer.

## Outbound relay for Kasm

Kasm and similar remote browsers run on another computer, so their `127.0.0.1` is not the employee's Windows PC. Version 0.4.0 adds an outbound relay without exposing the local API:

1. In RX Tracker Call Center, select **Pair Windows phone** and generate the 8-digit one-time code.
2. In RX Softphone on the employee's Windows PC, enter a direct RX Tracker server address that the PC can reach, such as the staging LAN address, plus the pairing code.
3. Select **Pair** and wait for **Relay online**. The pairing token is protected for the current Windows user and reconnects automatically after restarts.
4. Open RX Tracker in Kasm under the same RX user. The status changes to **RX Softphone ready via relay** and calls ring through the physical Windows PC.

The browser sends only an authenticated server command. The Windows app continues to register directly to Asterisk over SIP/UDP, and microphone/speaker audio remains on that Windows PC. Local and FortiGate browser-to-loopback calling remain the preferred path when available.

## Security notes

- The password is held only in process memory while registered and is cleared from the application's state on unregister or exit.
- The relay device token is encrypted with Windows DPAPI for the current Windows user. It cannot be reused by a different Windows account and is never the SIP password.
- The password is intentionally absent from source code, `appsettings.json`, logs, and build output.
- SIP/UDP and ordinary RTP are not encrypted. This matches the requested LAN test architecture but should be reviewed before use across untrusted networks.
- Rotate any password that has previously been shared in chat or another non-secret channel.

## Build a Windows release

```powershell
.\build-release.ps1
```

The script requires .NET SDK `10.0.302` or a compatible later patch, publishes a self-contained `win-x64` build, and creates `release\RxSoftphone-<version>-win-x64.zip`. Generated releases, local pairing state, and SDK files are intentionally excluded from Git. Attach the ZIP to the matching RX Tracker GitHub release or copy it to the approved internal software share.

Version: `0.4.1` (persistent outbound relay plus correct pre-answer cancellation reporting).

See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) before redistribution or commercial deployment.
