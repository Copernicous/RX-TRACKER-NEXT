# RX Tracker NEXT cutover and rollback

NEXT is not a production replacement merely because it builds. Promotion
requires repeatable dump rehearsals, a recorded acceptance run, and a paired
application/database rollback package.

## Promotion gates

- The exact release commit and executable hashes are recorded.
- `rx-db verify` reports `READY`, 34 applied, 0 pending, and a verified checksum
  ledger on a restored copy.
- At least two recent production-shaped backups complete the full rehearsal.
- Aggregate comparison reports no missing source tables or columns.
- Login, Patients, RX Records, Call Center, reports, backups, permissions, and
  one answered/unanswered phone flow pass in a non-production environment.
- Production `.env`, softphone encryption values, relay secret, and PIN are
  preserved; none are included in the release ZIP.
- The current 3.3.1 package and a pre-cutover database backup are available.

## Cutover

### Guarded Windows orchestrator (recommended)

Release `4.0.0-next.3` packages one script that owns the mechanical production
workflow. Keep these folders side by side:

```text
C:\RX-Tracker\RX-APP       unchanged 3.3.1 fallback
C:\RX-Tracker\RX-APP-NEXT  extracted NEXT release
C:\RX-Tracker\backups      verified custom-format dumps and hashes
```

Open PowerShell **as Administrator** in `C:\RX-Tracker\RX-APP-NEXT`. If
PostgreSQL is installed in its normal Windows folder, the script discovers the
running PostgreSQL service and client tools automatically. Otherwise add
`-PgBin 'C:\path\to\PostgreSQL\bin'` to every command.

1. Run the read-only preflight:

   ```powershell
   .\scripts\Invoke-NextProduction.ps1 -Action Preflight
   ```

   This verifies both executables against the official GitHub checksums, copies
   the current 3.3.1 `.env` into `RX-APP-NEXT`, changes only `DB_NAME` to the
   isolated target, and locates `pg_dump`/`pg_restore`. It makes no database or
   Windows-service changes.

2. Rehearse from an online production snapshot:

   ```powershell
   .\scripts\Invoke-NextProduction.ps1 -Action Rehearsal `
     -Confirm 'REHEARSE:patient_rx_dev->patient_rx_next_cutover_copy'
   ```

   Replace `patient_rx_dev` only if the existing production `.env` uses a
   different database name. The command creates and verifies a PostgreSQL
   custom dump, rebuilds only the isolated target database, adopts the v3.3.1
   ledger, migrates, seeds reference data, and requires `READY`. Production
   remains online and unchanged.

3. Optionally start the rehearsed copy on port 3100, perform browser acceptance,
   then stop it:

   ```powershell
   .\scripts\Invoke-NextProduction.ps1 -Action StartRehearsal
   .\scripts\Invoke-NextProduction.ps1 -Action StopRehearsal
   ```

4. During the scheduled downtime, run the guarded final cutover:

   ```powershell
   .\scripts\Invoke-NextProduction.ps1 -Action Cutover `
     -Confirm 'CUTOVER:patient_rx_dev->patient_rx_next_cutover_copy'
   ```

   The command stops the current service, takes a final verified dump, rebuilds
   the isolated NEXT database from that final dump, runs the lifecycle gates,
   switches the existing NSSM service to `RX-APP-NEXT`, and requires a healthy
   response with the exact release version. If the operation fails after
   stopping production, it attempts to restore the service pointer to the
   unchanged `RX-APP` application.

5. Inspect the recorded non-secret state at any time:

   ```powershell
   .\scripts\Invoke-NextProduction.ps1 -Action Status
   ```

The default database names above match the current deployment plan. Override
the isolated name consistently with `-NextDatabase` only when required. The
script rejects a target equal to production and requires target names containing
`copy`, `qa`, `test`, `sandbox`, `rehearsal`, or `scratch`.

### Manual reference

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

During the early acceptance window, the orchestrator can return the NSSM
service to the untouched 3.3.1 folder and database:

```powershell
.\scripts\Invoke-NextProduction.ps1 -Action Rollback `
  -Confirm 'ROLLBACK:patient_rx_next_cutover_copy'
```

This fast application/database-pointer rollback does not copy records created
after NEXT went live back into the old database. Stop user activity before
using it. Preserve the NEXT database and logs for reconciliation and diagnosis.
For a later rollback, or when records must be reconciled, use the paired-backup
procedure below under a reviewed recovery plan.

The NEXT compatibility migration is additive, but its down migration is
intentionally blocked because some objects may have existed before adoption.
When the guarded side-by-side workflow was used, the old database was never
migrated: rollback switches 3.3.1 back to that untouched database. If the old
database was changed outside this workflow, or the side-by-side state is not
trusted, use the full paired application plus database restore:

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
