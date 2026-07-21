# Call Center MicroSIP and RX Softphone Chrome policy

RX Tracker launches MicroSIP through the `callto:` protocol after an agent clicks the green phone icon. Chrome normally asks the user to confirm before opening an external application.

On dedicated, managed Call Center workstations, Chrome can skip that prompt for the exact approved RX Tracker production origins:

- Protocol: `callto`
- Allowed origins:
  - `https://rx.rbandrc.com`
  - `https://rx.camperos.net:10443`
  - `http://192.168.60.21:3000`

Development and staging origins are intentionally excluded. `https://portal.rbandrc.com` is also excluded because RX Tracker runs inside Kasm there; a protocol launch inside Kasm cannot open MicroSIP on the physical Windows host. When installed, the script removes those three legacy entries if an older copy added them.

The same installer also sets Chrome's legacy `LocalNetworkAccessAllowedForUrls` policy and the current `LocalNetworkAllowedForUrls` and `LoopbackNetworkAllowedForUrls` policies for those exact website origins. Chrome 145 and later classify `127.0.0.1` separately as the `loopback` address space, so RX Tracker declares `targetAddressSpace: "loopback"` and the dedicated loopback policy grants access to the RX Softphone service on `http://127.0.0.1:5188`. These policies do not expose the softphone to the LAN: the service remains bound to loopback and independently rejects browser origins outside its own allowlist.

## Server origin configuration

Environment files are intentionally excluded from Git. On the second server and production server, configure the application allowlist explicitly:

```dotenv
APP_ORIGINS=https://rx.rbandrc.com,https://rx.camperos.net:10443,https://portal.rbandrc.com,http://192.168.60.21:3000
```

Restart the application after changing its environment file. The Chrome policy and the application origin allowlist are separate controls; both must include the browser URL being tested.

For server-managed RX Softphone accounts, also set a stable encryption key before assigning any extensions:

```dotenv
SOFTPHONE_CREDENTIAL_KEY=replace-with-a-long-random-production-secret
SOFTPHONE_RELAY_SECRET=replace-with-a-separate-long-random-production-secret
```

Back up both keys with the protected production configuration. Changing or losing `SOFTPHONE_CREDENTIAL_KEY` makes existing encrypted SIP passwords unreadable. Changing `SOFTPHONE_RELAY_SECRET` invalidates existing Windows relay pairings, so affected workstations must pair again.

## Install on a workstation

1. Sign in to Windows on the Call Center workstation.
2. Open PowerShell as Administrator.
3. From the deployed RX Tracker folder, run:

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-production-microsip-chrome-policy.ps1
   ```

4. Restart Chrome.
5. Open `chrome://policy` and click **Reload policies**.
6. Confirm that `AutoLaunchProtocolsFromOrigins`, `LocalNetworkAccessAllowedForUrls`, `LocalNetworkAllowedForUrls`, and `LoopbackNetworkAllowedForUrls` have status **OK**.
7. Open production or staging and test the green phone icon.

The installer preserves other protocols and origins already present in the Chrome policy. Do not replace the production origins with `*`.

## Remove the permission

Run the same script as Administrator with `-Remove`:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-production-microsip-chrome-policy.ps1 -Remove
```

Restart Chrome and reload `chrome://policy` afterward.

## Central deployment

For multiple managed workstations, deploy both Chrome machine policies through Active Directory Group Policy or Chrome Enterprise. Use this `AutoLaunchProtocolsFromOrigins` value:

```json
[
  {
    "allowed_origins": [
      "http://192.168.60.21:3000",
      "https://rx.rbandrc.com",
      "https://rx.camperos.net:10443"
    ],
    "protocol": "callto"
  }
]
```

Set all three local-network policies to the same three exact direct-browser production origins. On Windows registry policy, create numbered string values beneath each path:

```text
Software\Policies\Google\Chrome\LocalNetworkAccessAllowedForUrls
Software\Policies\Google\Chrome\LocalNetworkAllowedForUrls
Software\Policies\Google\Chrome\LoopbackNetworkAllowedForUrls
```

The policy must remain limited to the trusted production and testing origins. The user's click on the green phone icon provides the required user gesture.
