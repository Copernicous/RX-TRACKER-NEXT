# Verified test-copy restore

Project Control can restore a PostgreSQL custom-format production backup into
an isolated test database without exposing the maintenance password or
replacing the currently active database.

## Operator workflow

1. Install the current official RX Tracker NEXT release.
2. Open `PROJECT-CONTROL.bat` as Administrator.
3. Select **25. Restore verified dump into isolated test copy**.
4. Enter the full `.dump` path.
5. Accept the suggested database name or enter another name containing
   `test`, `copy`, `sandbox`, `rehearsal`, or `scratch` as an
   underscore-delimited token. Names containing a `prod`, `production`, or
   `live` token are refused.
6. Enter the PostgreSQL maintenance username and password when prompted.
7. If the test database already exists, the program creates and validates a
   replacement backup before accepting the exact `REPLACE:<database>` phrase.
8. Wait for dump validation, restore, migrations, schema validation,
   restricted-runtime-role configuration, runtime verification, and the
   business fingerprint.
9. Choose whether to activate the verified copy for the Windows service.

When activation is selected, Project Control backs up `.env`, changes only
`DB_NAME`, clears any stale NSSM multi-value environment entries, writes the
exact `.env` snapshot, restarts RX Tracker, and
requires exact-version/database health. Activation also verifies the exact
NSSM `server.exe` path and service `DB_NAME`, then uses an unguessable one-time
loopback token to confirm the actual PostgreSQL database and running executable.
The responding process must own the configured port and be the NSSM service
child. The token is consumed by that verification and removed from the stored
NSSM environment. Ordinary proxied and public health responses never include
the database name or executable path. A failed check restores the previous
`.env` and service configuration automatically and proves the recovered target
the same way.

## Safety properties

- The source dump is validated before any database is created or replaced.
- The target must be separately named and visibly marked as non-production.
- Non-production markers must be complete underscore-delimited tokens; a word
  such as `contest` or `copycat` does not satisfy the guard.
- The currently configured database can never be selected as the target.
- Existing test copies are backed up and checksummed before replacement.
- PostgreSQL maintenance credentials stay in process memory only and are not
  written to `.env`, logs, or the receipt.
- The application continues to use its restricted runtime role.
- The previous database remains unchanged as a fallback.
- The sanitized receipt under `deployment-state` contains database names,
  timestamps, version, dump hash, and recovery path only—never credentials or
  patient data.

This workflow is intended for backup validation, test-server refreshes, and
controlled rehearsals. It is not the production release rollback workflow;
Project Control option 16 remains the paired application/database emergency
rollback.
