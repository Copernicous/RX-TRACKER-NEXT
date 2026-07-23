# RX Tracker NEXT database operations

This runbook applies to RX Tracker NEXT `4.0.0-next.10`. The central rule is
simple: the web server validates the database, while `rx-db` changes it.

## Command forms

In a source checkout, use `npm run db:<command>`. In a packaged Windows release,
use `rx-db.exe <command>`. Both execute the same static migration manifest.

| Purpose | Source checkout | Packaged release |
|---|---|---|
| Migration status | `npm run db:status` | `.\rx-db.exe status` |
| Apply pending migrations | `npm run db:migrate` | `.\rx-db.exe migrate` |
| Verify schema | `npm run db:verify` | `.\rx-db.exe verify` |
| Fresh provision | `npm run db:provision` | `.\rx-db.exe provision` |
| Seed reference data | `npm run db:seed:reference` | `.\rx-db.exe seed-reference` |
| First administrator | `npm run db:bootstrap-admin -- --username <name> --master` | `.\rx-db.exe bootstrap-admin --username <name> --master` |

By default, commands read the same `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASS`,
and `DB_NAME` values as the server. Production should use a restricted runtime
identity in `.env`. Project Control obtains the separate maintenance identity
interactively for backup, migration, verification, and restore work. It keeps
that password only in the updater process and does not write it into `.env`.
Commands print the target identity but never print the database password,
administrator password, SIP credentials, relay secrets, or encryption keys.

## Restricted production runtime role

The long-running web service needs business-data read/write permissions but
does not need to own tables, create schema objects, or edit the migration
ledger. A maintenance identity such as `postgres` configures the runtime role:

```powershell
$env:RX_RUNTIME_DB_PASSWORD = '<new-long-random-runtime-password>'
.\rx-db.exe configure-runtime-role `
  --role rx_tracker_runtime `
  --confirm-database <exact-database-name>
.\rx-db.exe inspect-runtime-role --role rx_tracker_runtime
Remove-Item Env:RX_RUNTIME_DB_PASSWORD
```

Change only `DB_USER` and `DB_PASS` in the server `.env` after the inspection
passes, then start the service. Verify the actual runtime login independently:

```powershell
$env:RX_RUNTIME_DB_PASSWORD = '<runtime-password>'
.\rx-db.exe verify-runtime-role --role rx_tracker_runtime
Remove-Item Env:RX_RUNTIME_DB_PASSWORD
```

The configurator grants existing and future application table/sequence access,
removes schema-creation rights, and makes `SequelizeMeta` read-only. It refuses
to repurpose a role that has memberships or owns database objects. Run this
first against a disposable restored database and never place the maintenance
password in `.env`.

## Fresh database

1. Create a dedicated `.env`. Never copy a real secret into Git.
2. Run `.\rx-db.exe provision`. This creates the configured database when it is
   absent, applies all migrations, verifies the schema, and seeds reference
   rows.
3. Supply the first password through a temporary environment variable:

   ```powershell
   $env:RX_BOOTSTRAP_ADMIN_PASSWORD = '<strong temporary password>'
   .\rx-db.exe bootstrap-admin --username next_admin --master
   Remove-Item Env:RX_BOOTSTRAP_ADMIN_PASSWORD
   ```

4. Run `.\rx-db.exe verify` and require `READY`, 35 applied, 0 pending, and
   `Checksum ledger: verified`.
5. Start `server.exe` only after verification succeeds.

The bootstrap command refuses to run if any user already exists.

## Existing 3.3.1 database

Do not adopt the live database first. Restore a backup to a separately named,
isolated database and use the rehearsal workflow in
[SANITIZED_DUMP_REHEARSAL.md](SANITIZED_DUMP_REHEARSAL.md).

For a verified 3.3.1 copy without a complete `SequelizeMeta` ledger:

```powershell
.\rx-db.exe inspect-v331
.\rx-db.exe adopt-v331 --confirm-database <exact-copy-database-name>
.\rx-db.exe migrate
.\rx-db.exe verify
.\rx-db.exe seed-reference
```

Adoption first checks the legacy schema anchor. It records 32 legacy migration
names only when all required 3.3.1 objects exist. It then leaves the audited
NEXT compatibility migration pending for normal execution.

## Web-server startup

Normal startup performs these database operations only:

1. authenticate;
2. read migration state;
3. inspect required tables, model columns, and unique indexes;
4. verify the normalized SHA-256 checksum of every applied migration;
5. read system settings;
6. begin serving requests.

If the ledger or schema is incomplete, startup exits and directs the operator to
run `rx-db`. It does not call `sequelize.sync()`, create a database, alter a
table, backfill data, patch roles, seed settings, or create an administrator.

## Operational guardrails

- Back up before every migration and record the backup hash and timestamp.
- Never run NEXT and 3.3.1 concurrently against the same database.
- Use a database role with DDL rights for lifecycle commands. The long-running
  web service should use the restricted runtime role described above.
- Never run `adopt-v331`, restore, or sanitize against production.
- Adoption, restore, and sanitization require the exact database name as an
  explicit confirmation.
- A failed migration is a stop condition. Preserve logs and restore the test
  copy; do not improvise manual schema edits.
- Applied migration files are immutable. Add a new migration for every later
  change; editing an applied file causes status, verification, startup, and
  further migration execution to fail with checksum drift.

The first explicit NEXT `migrate` on a legacy name-only `SequelizeMeta` table
adds the checksum columns and establishes the audited baseline from this build.
After that transition, checksums are never silently replaced. This is why the
3.3.1 schema inspection and protected pre-migration backup are mandatory.
