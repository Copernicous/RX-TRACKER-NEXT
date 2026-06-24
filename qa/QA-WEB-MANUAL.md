# Daniely RX QA Web Dashboard Manual

## Purpose

The QA web dashboard is a local-only control panel for the smoke test scripts in this folder. It gives you buttons for the same commands that are available in `qa/qa-menu.bat`.

It is intended for QA/release testing only.

## Security Model

The dashboard has no password by design because it is only for local testing.

It does use a temporary browser token for task buttons. This is not a login. It only helps prevent another website from silently triggering QA tasks while the dashboard is open.

Default binding:

```text
http://127.0.0.1:3200
```

Do not expose this dashboard through FortiGate, the LAN, or the public internet. It can start/stop the local QA app and run scripts.

If you ever bind it remotely, add authentication first or use an isolated QA workstation.

## Start The Dashboard

From the project root:

```powershell
npm run qa:web
```

Then open:

```text
http://127.0.0.1:3200
```

Alternative through the batch menu:

```powershell
qa\qa-menu.bat
```

Then choose the QA web dashboard option.

## Recommended Workflow

1. Click `Start QA Site`.
2. Click `Seed Fake Data`.
3. Click `Run Smoke Test`.
4. Review the `Latest Result` cards.
5. Review logs if a failure appears.
6. Click `Stop QA Site` when finished.

## Seed Fake Data vs Add More Fake Data

`Seed Fake Data` is intentionally idempotent. Pressing it again updates the same baseline QA records instead of creating duplicates. The smoke test depends on these stable records:

- `QA Patient`
- `QA Pharmacy`
- `QA Clinic`
- `QA Medication Action`
- `QA Received Warehouse`

Use `Add More Fake Data` when you want extra records for manual testing. Every click creates a unique QA batch with a timestamp-like suffix.

## FortiGate Mode

FortiGate mode runs the same smoke test through the real FortiGate web access URL instead of the local QA proxy.

Use this when you need to validate proxy-specific behavior:

- Cookie path handling.
- Login after refresh.
- Static assets under `/proxy/...`.
- API calls behind the FortiGate path.
- Redirects that may lose the proxy prefix.
- Headers stripped or rewritten by the proxy.

In the dashboard:

1. Paste the current FortiGate web access URL into `FortiGate QA URL`.
2. Click `Run FortiGate Smoke`.
3. Review `Current Task`, `Latest Result`, and logs.

Example URL:

```text
https://rx.camperos.net:10443/proxy/5b2552c5/http/192.168.60.21:3000
```

If you paste a page URL like:

```text
https://rx.camperos.net:10443/proxy/5b2552c5/http/192.168.60.21:3000/audit-log
```

the dashboard normalizes it back to the app root before running the smoke test.

The FortiGate URL is used only for that run and is not saved to disk.

## Visible Browser Mode

Click `Visible Smoke` if you want to watch Chrome move through the site.

This runs slower and is useful for debugging.

## Output Files

- `qa/results/smoke-report.json` - full smoke result.
- `qa/results/seed-result.json` - seeded fake record IDs.
- `qa/results/screenshots/` - failure screenshots.
- `qa/logs/backend.log` - local QA backend log.
- `qa/logs/https-proxy.log` - local HTTPS proxy log.
- `qa/pids/` - process IDs for the QA backend/proxy.

## What The Smoke Test Checks

- Login through HTTPS.
- Dashboard loads.
- Core pages open.
- Patients search works.
- RX Records search and workflow/history modals open.
- CRUD catalog pages show seeded data and open add modals.
- Reports page has action buttons.
- Backups page loads.
- System Settings page loads.
- Non-master admin is restricted from Backoffice.
- Authenticated dashboard API responds.

In FortiGate mode, these same checks run through the FortiGate URL you paste.

## What The Smoke Test Skips

The test intentionally does not click destructive or heavy actions:

- Backup restore.
- Delete/purge actions.
- Hide RX.
- Full backup execution.
- Any operation that could remove or overwrite data.

## Credentials

The dashboard itself has no password.

The smoke test still logs into the app using the QA login from `qa/.env.qa` or defaults:

```text
QA_LOGIN_USERNAME=admin
QA_LOGIN_PASSWORD=admin
```

The seeder creates or updates that QA login in the QA database.
