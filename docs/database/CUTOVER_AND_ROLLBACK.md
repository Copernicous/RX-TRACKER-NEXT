# RX Tracker NEXT cutover and rollback

NEXT is not a production replacement merely because it builds. Promotion
requires repeatable dump rehearsals, a recorded acceptance run, and a paired
application/database rollback package.

## Promotion gates

- The exact release commit and executable hashes are recorded.
- `rx-db verify` reports `READY`, 33 applied, and 0 pending on a restored copy.
- At least two recent production-shaped backups complete the full rehearsal.
- Aggregate comparison reports no missing source tables or columns.
- Login, Patients, RX Records, Call Center, reports, backups, permissions, and
  one answered/unanswered phone flow pass in a non-production environment.
- Production `.env`, softphone encryption values, relay secret, and PIN are
  preserved; none are included in the release ZIP.
- The current 3.3.1 package and a pre-cutover database backup are available.

## Cutover

1. Announce downtime and stop every 3.3.1 server instance and scheduled job.
2. Create and verify a final PostgreSQL custom-format backup.
3. Copy the final backup to the protected rollback location and record its hash.
4. Deploy the NEXT package without replacing `.env`.
5. Run `rx-db status`, then `rx-db migrate`, `rx-db verify`, and
   `rx-db seed-reference` using the lifecycle/DDL database role.
6. Require `READY` before starting the web service.
7. Start one NEXT instance and complete the acceptance checks.
8. Re-enable normal scheduling only after acceptance passes.

Do not have 3.3.1 and NEXT serving the same database at the same time.

## Rollback

The NEXT compatibility migration is additive, but its down migration is
intentionally blocked because some objects may have existed before adoption.
The supported rollback is therefore application plus database restore:

1. stop NEXT immediately;
2. preserve NEXT logs and a failure-state backup for investigation;
3. restore the pre-cutover database backup to the production database;
4. restore the exact prior 3.3.1 application package;
5. restore/preserve the prior `.env` without regenerating secrets;
6. start one 3.3.1 instance and verify version, login, Patients, RX Records,
   Call Center, reports, and a controlled call;
7. document the failure and keep NEXT offline until corrected and rehearsed.

An application-only rollback may appear to work because the schema changes are
additive, but it is not the supported recovery path. Restoring the paired backup
removes ambiguity from migration ledger and backfill state.
