# RX Softphone Remote Workstation Test

Use this runbook to prepare a physical Windows test computer, pair it with RX Tracker, validate two computers using the same extension, and identify the server-only preparation required before production.

## 1. Before installing on the remote computer

The Windows computer needs:

- Windows 10 or 11 x64, a working microphone and speaker/headset, and a persistent Windows user profile.
- The approved `RxSoftphone-0.4.1-win-x64.zip` package.
- Network access to the RX Tracker HTTPS/LAN address used for pairing.
- Direct network access from Windows to the configured Asterisk/provider SIP address and its RTP media range. The web relay does not carry SIP or audio.
- Power settings that do not suspend the computer during the calling shift.

For the local PBX test, the computer must reach `192.168.15.200` on UDP `5060` and the RTP range configured in Asterisk. An Internet-only remote computer needs the approved VPN/private route, or a public provider/PBX address configured for NAT and firewall traversal.

### Private PBX connectivity

Keep the PBX private. Use one of these approved routed-network approaches on the physical Windows computer:

- **Recommended — FortiClient VPN:** connect the Windows computer to a FortiGate tunnel-mode VPN. The VPN policy and split routes must include `192.168.15.200` and the Asterisk RTP range. The FortiGate browser-only SSL-VPN portal is not sufficient because it does not provide the Windows softphone with a routed UDP path.
- **Cloudflare — Mesh/subnet routing:** use Cloudflare Mesh with a subnet router for the PBX network and enroll the Windows computer in the Cloudflare One Client. A normal proxied hostname or outbound `cloudflared` Tunnel can carry the RX Tracker website and relay commands, but Cloudflare documents that ordinary Tunnel does not support server-initiated VoIP/SIP.

Do not publish SIP UDP `5060` directly to the Internet solely for this integration. Whichever private tunnel is selected must carry bidirectional SIP and RTP traffic and allow the PBX to return media to the Windows computer.

References: [Cloudflare connectivity options](https://developers.cloudflare.com/cloudflare-one/networks/connectivity-options/) and [Cloudflare private networks](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/private-net/).

## 2. Install and start RX Softphone

1. Create a permanent folder such as `C:\RX-Softphone`.
2. Extract the ZIP into that folder. Do not run the executable from inside the ZIP.
3. Start `RxSoftphone.exe` or `Start-Softphone.cmd` as the normal Windows user who will make calls.
4. Open `http://127.0.0.1:5188` on that same physical computer.
5. Confirm the local page loads. Windows Firewall may prompt the first time; keep the API loopback-only and allow only the network access required for SIP/RTP.

To start it automatically for that Windows user, press `Win+R`, open `shell:startup`, and place a shortcut to `C:\RX-Softphone\Start-Softphone.cmd` there. Pairing survives an application restart, Windows restart, or sleep/wake because its relay token is protected in the persistent Windows user profile. Re-pair only after the RX user changes, the administrator replaces the pairing, or the Windows profile/local pairing data is removed.

## 3. Assign the account and pair the computer

Server/application steps:

1. An administrator opens **Administration > Users** and selects **Allow setup** for the test RX user.
2. The test user signs in, opens **Phone Account Setup**, enters the assigned PBX hostname/IP, SIP port, extension/login, and password, then saves. Do not share or record the SIP password in this runbook.
3. The same RX user opens **Call Center > Pair Windows phone** and generates the one-time 8-digit code.

Remote Windows steps:

1. In the local RX Softphone page, enter the RX Tracker address reachable by that Windows computer and the pairing code.
2. Select **Pair**.
3. Confirm **Relay online** and **Registered**.
4. Refresh Call Center and confirm **RX Softphone ready via relay**.
5. Place one call, verify ringback and two-way audio, then hang up. Confirm the Call Center report contains dialing, ringing, answered/end times, ring/conversation duration, SIP result, patient, agent, extension, and number.

One running Windows softphone is paired to one RX user at a time. A second RX user on the same computer must pair that softphone again.

## 4. Validate two computers sharing extension 1006

1. Use two physical Windows computers and two RX Tracker users.
2. Install and pair RX Softphone separately on each computer.
3. Assign extension `1006` to both RX users only for this authorized test.
4. Confirm both softphones show **Registered** at the same time.
5. On Asterisk, run `pjsip show endpoint 1006` and `pjsip show contacts`. Two current contacts should be visible.
6. Start an outbound call from computer A and, while it remains connected, start another outbound call from computer B.
7. Confirm separate audio, hangup controls, agents, attempt records, and durations.

The Asterisk AoR must permit at least two contacts (`max_contacts` of at least `2`) and must not replace the first current contact when the second registers. The provider/trunk and dial plan must also allow two concurrent outbound channels. Make PBX changes only through the PBX administrator and take a configuration backup first.

Reference: [Asterisk `res_pjsip` AoR options](https://docs.asterisk.org/Latest_API/API_Documentation/Module_Configuration/res_pjsip/) and the [Asterisk PJSIP troubleshooting guide](https://docs.asterisk.org/Configuration/Channel-Drivers/SIP/Configuring-res_pjsip/Asterisk-PJSIP-Troubleshooting-Guide/).

## 5. Server-only production preparation

Do not place these values on the remote Windows computer. On the RX Tracker production server, preserve the existing `.env` and verify stable values for:

```dotenv
SOFTPHONE_CREDENTIAL_KEY=<stable random secret>
SOFTPHONE_RELAY_SECRET=<different stable random secret>
SOFTPHONE_ACCOUNT_ADMIN_PIN=<administrator-only PIN>
```

Keep the existing `JWT_SECRET`. Never rotate `SOFTPHONE_CREDENTIAL_KEY` after phone accounts are saved without first planning to re-enter every SIP password.

Before deployment:

1. Create and verify a full production database/site backup from **Backups**.
2. Record the backup filename and timestamp and keep the previous release ZIP.
3. Stop the production service.
4. Deploy the approved server package without replacing production `.env`.
5. From the production source checkout, run `PROJECT-CONTROL.bat migrate`, or use the documented deployment workflow that applies the same pending Sequelize migrations.
6. Start the service and run `PROJECT-CONTROL.bat version`, `PROJECT-CONTROL.bat health`, and `PROJECT-CONTROL.bat db-test`.
7. Perform answered and pre-answer-cancelled call tests before enabling the full queue.

The call-attempt and relay schema is additive. A previous application version ignores the added tables, but the production backup is still the rollback authority.

## Acceptance record

- Windows computer A / RX user: `____________________`
- Windows computer B / RX user: `____________________`
- PBX/provider and extension: `____________________`
- Two simultaneous contacts confirmed: `Yes / No`
- Two simultaneous calls confirmed: `Yes / No`
- Answered call automatically marked Called: `Yes / No`
- Pre-answer cancellation not marked Called: `Yes / No`
- Backup used for deployment: `____________________`
- Tester/date: `____________________`
