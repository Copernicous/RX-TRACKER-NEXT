# RX Tracker NEXT

RX Tracker NEXT is the migration-managed successor to RX Tracker 3.3.1. It
starts from the tested 3.3.1 application and preserves its web interface,
features, and RX Softphone protocol while replacing database changes during web
startup with explicit, audited lifecycle commands.

NEXT is an isolated project. Development in this repository must not modify the
frozen 3.3.1 repository, its production database, or the RX Softphone source.

## Current status

Version: `4.0.0-next.26` production release candidate

| Area | NEXT behavior |
|---|---|
| Web startup | Verifies migration and schema state; performs no schema creation or migration |
| Migration audit | Stores normalized SHA-256 checksums and blocks edited applied migrations |
| Fresh database | Explicit `rx-db provision`, followed by one-time administrator bootstrap |
| 3.3.1 database | Restore to an isolated copy, adopt the verified legacy schema, migrate, and compare |
| Test data | Explicit sanitizer removes identities, credentials, tokens, pairings, document pointers, and free text |
| RX Softphone | Version 0.6.0 runs as a tray application with its own Windows control window and per-user automatic startup, supports optional PBX Authentication ID, and is published as a separate, checksummed workstation ZIP |

The frozen application remains the production fallback until repeated
production-shaped dump rehearsals and user acceptance are complete.

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
