# Database rehearsal record — 2026-07-21

Environment: isolated PostgreSQL 17 cluster on a non-application port. All
accounts and data were synthetic. No 3.3.1 production, development, staging, or
RX Softphone files were changed.

## Results

- Fresh provision applied 33 migrations and verified zero missing tables,
  columns, or required unique indexes.
- A repeated migration applied zero changes.
- Reference seeding was idempotent and first-admin bootstrap succeeded once.
- Repeated web startup returned a healthy API and produced no canonical
  database-content or tracked settings-file change.
- A v3.3.1-shaped dump without `SequelizeMeta` restored successfully.
- Adoption recorded 32 legacy migration names; the one NEXT compatibility
  migration applied; final status was 33 applied and 0 pending.
- Sanitization removed credentials/identities and preserved patient and
  call-attempt analytics; all validation categories passed.
- Schema/count comparison reported compatible schemas and printed no row values.
- An invalid custom-format dump was rejected during preflight before the target
  schema was changed.
- The compiled `rx-db.exe` independently completed restore, adoption, migration,
  sanitization, and final verification on a second isolated target.
- The compiled `server.exe` reported `4.0.0-next.1`, started against a verified
  isolated database, and returned HTTP 200 from `/api/healthz`.
- Existing public JavaScript, Call Center, phone client/shared state, one-time
  setup, automatic attempt, patient date, RX override, workflow date, permanent
  delete, and service-window regressions passed.
- The complete staging smoke suite passed configuration, import rollback,
  security alerts/hardening, Call Center API restrictions, browser clicks,
  reporting/export, account setup, shared call state, and queue workflows.

This is an engineering baseline, not production acceptance. Recent
production-shaped backups must repeat the same workflow before cutover.
