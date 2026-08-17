# RX Tracker NEXT

RX Tracker NEXT is the migration-managed successor to RX Tracker 3.3.1. It
starts from the tested 3.3.1 application and preserves its web interface,
features, and RX Softphone protocol while replacing database changes during web
startup with explicit, audited lifecycle commands.

NEXT is an isolated project. Development in this repository must not modify the
frozen 3.3.1 repository, its production database, or the RX Softphone source.

## Current status

Version: `4.0.0-next.64` release candidate

| Area | NEXT behavior |
|---|---|
| Web startup | Verifies migration and schema state; performs no schema creation or migration |
| Migration audit | Stores normalized SHA-256 checksums and blocks edited applied migrations |
| Fresh database | Explicit `rx-db provision`, followed by one-time administrator bootstrap |
| 3.3.1 database | Restore to an isolated copy, adopt the verified legacy schema, migrate, and compare |
| Test data | Explicit sanitizer removes identities, credentials, tokens, pairings, document pointers, and free text |
| Delivery Log archive | Saves a bounded, server-canonical, integrity-bound local carbon-copy record only when Print is requested; controlled reprints and cleanup are audited |
| Database health | Backoffice analysis is read-only and reports evidence, confidence, checker errors, and backup creation separately from verified recoverability |
| CSV review snapshots | Exports every public database table, including empty-table headers; sensitive review artifact only, not a PostgreSQL restore backup |
| Test-copy restore | Project Control 2.2.2 option 25 verifies the exact service process, executable, listener, and database before optional activation |
| RX Softphone | Version 0.6.0 runs as a tray application with its own Windows control window and per-user automatic startup, supports optional PBX Authentication ID, and is published as a separate, checksummed workstation ZIP |

Version `next.64` fixes Backoffice **RX Profile Sync** scans so pending
Pharmacy/Transport differences are not silently limited to the first 1,000
oldest active RX records. Results support 50, 100, or 250 rows per page,
Previous/Next navigation through every result, and a complete filtered CSV via
**Export All Scan**. Synchronization remains manual, audited, and limited to
100 selected RX records per batch. No migration, business-data rewrite,
configured RX Action, or proxy/security change is included.

Version `next.63` adds the compact RX Records **Stage Completion** filter. It
matches the selected historical stage and that stage's own date range, so dates
from another stage do not count. A record can be at a later Current Stage and
still appear when it completed the selected historical stage during the range.
Current Stage remains the primary filter; its existing date range is available
under **More date filters**. This release also corrects affected display-text
encoding and removes the unused header search control.

No migration, schema change, business-data rewrite, configured RX Action
change, or proxy/security change is included. The lockfile also pins patched
transitive `brace-expansion` and `ip-address` releases required by CI.

Version `next.62` adds a compact plain-language interpretation table above the
detailed Backoffice Routine Database Checks. It uses the existing read-only
results and does not change database checks, thresholds, or recommendations.

Version `next.61` assigns new Delivery Log copies a durable incremental
reference scoped independently to each pharmacy. Printed references no longer
contain the combined RX count or cross-pharmacy group position. Reprints retain
their assigned reference, deletion cannot reuse a number, and existing archives
remain unchanged.

Version `next.60` makes Project Control option 25 store and verify NSSM's
multi-value service environment through its native Windows `REG_MULTI_SZ`
registry value. This avoids command-line serialization differences observed on
the testing server while preserving all activation identity and health checks.

Version `next.59` corrects Project Control option 25 activation and automatic
recovery when NSSM retains an older test-copy database in its multi-value
service environment. The workflow clears the stale environment block before
writing and verifying the exact `.env` snapshot and one-time health token.
It also prevents the Windows GUI restore safety backup from confusing HTTP
`PORT=3000` with PostgreSQL `DB_PORT`; PostgreSQL defaults to `5432` when its
dedicated port is absent.
The isolated restored database and all existing activation identity checks are
preserved. There is no schema migration, business-data rewrite, production GUI
restore change, or proxy/security configuration change.

Version `next.58` corrected Delivery Log archive creation, reprint, and cleanup
requests so the strict validators accept the browser's middleware-owned
top-level CSRF transport field without storing it. CSRF enforcement and the
rejection of unknown or nested input remain unchanged. Controlled-copy print
now waits for its frozen stylesheet and browser paint, and archive lists keep
full technical evidence under an expandable control instead of displaying it
as primary row content. It includes no schema migration, configured RX Action
change, business-data rewrite, or Kasm, Cloudflare, CORS, cookie, HTTPS,
trust-proxy, or reverse-proxy behavior change.

Official `next.63` passed the exact PostgreSQL lifecycle CI, CodeQL, and
compiled-release workflow. Production installation remains separately pending.
Use Project Control only: record the installed version with option **4**, then
use **8** and **15**; do not manually extract files, run migrations, or alter
production `.env`.
The frozen application remains an emergency rollback option. New NEXT changes
must pass staging and development validation before a separately approved,
checksummed production release.

## Start here

- [Current project handoff](docs/PROJECT_HANDOFF.md)
- [Portable new-server installer](docs/NEW_SERVER_PORTABLE_INSTALLER.md)
- [Database operations](docs/database/NEXT_DATABASE_OPERATIONS.md)
- [Sanitized dump rehearsal](docs/database/SANITIZED_DUMP_REHEARSAL.md)
- [Cutover and rollback](docs/database/CUTOVER_AND_ROLLBACK.md)
- [Routine compiled updates](docs/database/COMPILED_RELEASE_UPDATES.md)
- [Verified test-copy restore](docs/database/TEST_COPY_RESTORE.md)
- [3.3.1 startup mutation inventory](docs/database/STARTUP_MUTATION_INVENTORY.md)

Every push and pull request runs the fresh-provision, checksum-drift,
sanitization, v3.3.1 dump-rehearsal, application-regression, and restricted
read/write runtime-role checks in GitHub Actions.

For source development, install Node.js and PostgreSQL, create a local `.env`
from `.env.example`, then run:

```powershell
npm ci
npm run db:status
npm run db:verify
npm start
```

The server intentionally refuses to start if migrations are missing. Run
database lifecycle commands separately; never make the web service account a
database owner merely to make startup succeed.

The packaged `scripts\Invoke-NextProduction.ps1` orchestrator is only for the
one-time 3.3.1-to-NEXT conversion. After cutover, use Project Control 2.2 for
routine compiled updates. It verifies the official release, backs up the live
database, checks business-data fingerprints, preserves `.env`, applies audited
migrations, starts the service, and automatically attempts paired recovery when
an update fails during downtime. On a testing server, option **25** restores a
verified custom-format dump into a separately named test database, configures
the restricted runtime role, and can activate the copy with automatic
service-configuration recovery.
