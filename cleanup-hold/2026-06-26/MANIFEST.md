# Cleanup Hold - 2026-06-26

This folder is a reversible holding area for files that looked like cleanup candidates.
Nothing here was deleted.

Branch at cleanup time: `main`
Commit at cleanup time: `3a305de`

## Moved Files

| Original path | Holding path | Reason | SHA256 |
| --- | --- | --- | --- |
| `server.log` | `cleanup-hold/2026-06-26/ignored/server.log` | Old root log file, ignored by Git. | `F42596E32D163E19D3886143A0865BF09CF76E55753F0C92B51B362FCBBC0214` |
| `migrations/_migname.tmp` | `cleanup-hold/2026-06-26/tracked/migrations/_migname.tmp` | Temporary migration-name scratch file; no code references found; real migration exists. | `C7EB2583845879F6B941C501F0B11F627F935AC53D00A2B6D981DB25B017A891` |
| `public/js/reports.js.tmp` | `cleanup-hold/2026-06-26/tracked/public/js/reports.js.tmp` | Temporary JS scratch copy; no code references found; active `public/js/reports.js` exists. | `41ECA4BAFA48C2B3CFB081F5D11BDE3B2D9B9A777D698CAFAA10F17899F5D32E` |
| `public/js/audit-log.js.tmp` | `cleanup-hold/2026-06-26/tracked/public/js/audit-log.js.tmp` | Temporary JS scratch copy; no code references found; active `public/js/audit-log.js` exists. | `F1072AEF9E50B87B92945B904B85535269EC3BB662035B5E4933BB29FF34ADAC` |

## Intentionally Not Moved

- `.staging-3100.pid`: active staging server PID for running Node process `29272`.
- `dist/`: current production build artifacts, including `server-update-2.0.59.zip`.
- `backups/`: app/database backups.
- `logs/`: app and staging logs.
- `.env`, `.env.staging`, and `secrets/`: local configuration and credentials.
- `node_modules/`: dependency install folder.
- `staging/runtime/`: staging runtime files and uploaded test document.
- `data/settings.json` and `backups/backup.log.json`: tracked runtime files currently modified locally.

## Restore Notes

To restore a file, move it back to its original path from the table above.
The `tracked/` files were tracked by Git before cleanup, so committing this cleanup would be a repository change.
