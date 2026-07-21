# Production-shaped dump rehearsal — 2026-07-21

This record contains only aggregate counts, hashes, and lifecycle results. It
does not contain row values, patient identifiers, credentials, SIP secrets, or
the unpublished sanitizer date offset.

## Input

- Source file: `backup_2026-07-21T23-43-04 (1).dump`
- Format: PostgreSQL custom archive (`PGDMP`), 288 archive entries
- Size: 727,406 bytes
- SHA-256: `C758B569937A2D220454031CB953D0DA62EA95E8D1B126F98D19DD0742D2EBAC`
- Source handling: read-only; restored into isolated PostgreSQL 17 targets

## Drift discovered

The restored 3.3.1 schema contained `Users.username` but lacked its required
single-column unique index. Aggregate inspection found zero duplicate username
groups. Migration `20260721234500-repair-users-username-unique-index.js` now
repairs that invariant and stops safely if a future database contains duplicate
groups.

## Independent clean rehearsal

Target: `rx_next_import_rehearsal_test`, an isolated local database whose name
satisfies the destructive-operation guard.

1. Validated and restored the custom archive into an empty target.
2. Inspected the v3.3.1 anchors without printing row values.
3. Adopted 32 legacy migration records.
4. Applied the audited compatibility and username-index repair migrations.
5. Verified `READY`: 34 applied, 0 pending, checksum ledger verified.
6. Seeded reference values.
7. Sanitized atomically and received sanitizer validation `PASS`.
8. Created an explicit test-only administrator after sanitization.
9. Verified login, Dashboard, and Call Center routes returned HTTP 200.

## Aggregate retention/removal proof

| Table | Before | After sanitization |
|---|---:|---:|
| `AuditLogs` | 3,730 | 3,730 |
| `CallCenterCallAttempts` | 6 | 6 |
| `Patients` | 2,034 | 2,034 |
| `RXRecords` | 1,276 | 1,276 |
| `Users` | 10 | 10 |
| `UserSoftphoneAccounts` | 3 | 0 |
| `SoftphoneRelayDevices` | 3 | 0 |
| `SoftphoneRelayCommands` | 11 | 0 |

The retained rows are pseudonymized and date-shifted. The sanitized target is a
test artifact, not a backup, and must never be promoted into production.
