# RX Tracker NEXT database startup inventory

Baseline: RX Tracker 3.3.1, upstream commit
`e564097f7ac46ec2756706d824491c43148c507f`.

This document records every database write performed by the 3.3.1 web-server
startup path. NEXT must move these operations to explicit lifecycle commands so
normal application startup is read-only with respect to database structure and
reference data.

## Startup operations and migration coverage

| 3.3.1 startup operation | Existing migration coverage | NEXT disposition |
|---|---|---|
| Create the configured PostgreSQL database | None; `app.js` connects to `postgres` and creates it | Explicit `db:create` command only |
| Add `Users.permissions` | None | Audited compatibility migration |
| Add RX warehouse-return columns | Covered by `20260623114800-add-performance-indexes.js` | Remove duplicate startup DDL; retain verification |
| Add `AuditLogs.previousValue` | Present in the original create-table migration | Remove duplicate startup DDL; retain verification |
| Add `Users.notes` | None | Audited compatibility migration |
| Add `MedicationCatalogs.sortOrder` | None | Audited compatibility migration |
| Add DailySnapshots trend columns | Covered by `20260628103000-add-dashboard-trend-metrics-to-daily-snapshots.js` | Remove duplicate startup DDL; retain verification |
| Add the patient-code unique constraint | The patient-code migration creates a unique column | Normalize/verify the unique index in the compatibility migration |
| Add Users 2FA/security columns | Covered by `20260622200000-add-2fa-security-fields-to-users.js`, except `isMaster` | Add `isMaster` in the compatibility migration; remove duplicate startup DDL |
| Add Roles permissions/system/description columns | None | Audited compatibility migration |
| Re-seed built-in role permissions | None; application code runs on every start | Explicit idempotent reference-data command |
| Create `CallCenterLocks` and indexes | None | Audited compatibility migration |
| `sequelize.sync()` across every registered model | Not an auditable migration | Remove; explicitly create the seven legacy sync-only tables listed below |
| Create/backfill service-date cycles and link RX records | Covered substantially by `20260626153000-create-patient-service-date-cycles.js`; startup additionally normalizes status and links rows repeatedly | One audited, idempotent compatibility backfill; no startup writes |
| Create/backfill service-date history | Table migration exists; startup performs the initial history backfill | One audited, idempotent compatibility backfill; no startup writes |
| Add/backfill `PatientNotes.source` | None | Audited compatibility migration |
| Create built-in roles | Only a legacy seeder; startup also creates missing roles | Explicit idempotent reference-data command |
| Create a default admin | Legacy seeder and gated startup code use a known password | Explicit one-time admin bootstrap command requiring supplied credentials |

## Tables previously created only by `sequelize.sync()`

The legacy migrations do not create these registered model tables:

- `ApiKeys`
- `CallCenterLocks`
- `ErrorLogs`
- `PatientLocks`
- `PatientNotes`
- `RXHistories`
- `SystemSettings`

The NEXT compatibility migration creates each table and its required indexes
explicitly. Existing imported 3.3.1 databases are handled idempotently.

## Imported database adoption

A production copy may contain the correct 3.3.1 schema while lacking complete
`SequelizeMeta` history because legacy startup performed the work. NEXT must not
blindly run the old create-table migrations against such a copy. The adoption
workflow will:

1. connect only to the isolated target copy;
2. verify the legacy anchor tables and columns;
3. record only the pre-NEXT migration filenames as already applied;
4. run the NEXT compatibility migration normally;
5. verify the resulting schema and migration state;
6. produce a comparison report without patient values.

Adoption never runs automatically during web-server startup.

## Data boundary

No `.env`, database dump, uploaded document, application backup, log, patient
export, SIP credential, or encryption key may be committed to RX-TRACKER-NEXT.
Database working files belong under ignored `database-work/`, `imports/`,
`exports/`, or `sanitized-data/` paths. Reports may contain schema names and
aggregate counts, but not names, addresses, phone numbers, dates of birth,
free-text notes, credentials, tokens, or document contents.
