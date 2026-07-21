# Sanitized 3.3.1 dump rehearsal

Use this workflow to prove that an RX Tracker 3.3.1 backup can become an RX
Tracker NEXT database without exposing production data to development.

## Safety boundary

The target database name must contain `sanitized`, `copy`, `qa`, `test`,
`sandbox`, `rehearsal`, or `scratch`. The operator must also pass the exact name
with `--confirm-database`. The command refuses all other targets.

Store dumps only in an access-controlled working directory such as the ignored
`database-work\` directory. Never commit, upload, email, or attach a production
dump. A restored copy contains sensitive data until sanitization completes.
Keep it isolated from application users and destroy it if any rehearsal step
fails before the sanitizer reports `PASS`.

## One-command rehearsal

Set `.env` to an empty, isolated target database and make PostgreSQL client
tools available through `PATH` or `PGBIN`:

```powershell
$env:PGBIN = 'C:\Program Files\PostgreSQL\17\bin'
.\rx-db.exe rehearse-v331 `
  --dump 'D:\secure-work\rx-v331.dump' `
  --confirm-database rx_next_restore_rehearsal
```

The command performs this sequence:

1. validates that the dump is readable before changing the target;
2. drops and recreates only the confirmed target's `public` schema;
3. restores the dump with `pg_restore` or `psql`;
4. verifies and adopts the complete 3.3.1 schema;
5. applies the NEXT compatibility migration;
6. verifies the final schema and seeds reference rows;
7. sanitizes the copy and validates every sanitizer category.

Then run:

```powershell
.\rx-db.exe verify
.\rx-db.exe validate-sanitized
```

Expected result: `READY`, 34 applied migrations, 0 pending migrations, a
verified checksum ledger, and a sanitized-data `PASS`.

## What the sanitizer does

| Retained for testing | Removed or replaced |
|---|---|
| Patient/RX relationships and row counts | Names, addresses, dates of birth, phone numbers, patient codes, and notes |
| Call states, outcomes, ordering, SIP response codes, and durations | Exact timestamps (uniformly shifted), dialed numbers, patient/clinic/agent snapshots, extensions, and SIP reason text |
| Workflow and service-date relationships | Free-text reasons and metadata payloads |
| Aggregate daily statistics | User names, emails, passwords, 2FA secrets, backup codes, and lockout state |
| Role and reference-row structure | Clinic, pharmacy, and transport identity/contact text |
| Migration ledger and schema | SIP accounts, relay devices/tokens/commands, API keys, document pointers, and transient locks |
| Safe system behavior settings | SMTP identities/passwords/recipients, subscriptions, and unknown setting values |

The sanitizer changes the copied database only. It does not sanitize files from
`.env`, upload storage, backup folders, logs, or Google Drive. Do not copy those
artifacts into the NEXT workspace.

Every database date and timestamp receives one randomized, unpublished offset.
That preserves relative intervals and cross-table chronology but removes exact
real-world dates from the copy. Re-running the sanitizer applies a new offset.

## Test administrator

All copied user credentials are disabled. Create one explicit account after a
successful sanitization:

```powershell
$env:RX_SANITIZED_ADMIN_PASSWORD = '<strong test-only password>'
.\rx-db.exe sanitized-admin `
  --confirm-database rx_next_restore_rehearsal
Remove-Item Env:RX_SANITIZED_ADMIN_PASSWORD
```

The resulting username is `sanitized_admin`.

## Aggregate comparison

`compare-copy` reads only schema metadata and aggregate row counts. It never
prints row values:

```powershell
$env:SOURCE_DB_HOST = '<read-only-source-host>'
$env:SOURCE_DB_PORT = '5432'
$env:SOURCE_DB_USER = '<read-only-user>'
$env:SOURCE_DB_PASS = '<temporary password>'
$env:SOURCE_DB_NAME = '<source database>'
.\rx-db.exe compare-copy
Remove-Item Env:SOURCE_DB_PASS
```

Require `Schema compatible: yes`. Count differences are expected for credential,
pairing, document-pointer, and lock tables because the sanitizer empties them.
