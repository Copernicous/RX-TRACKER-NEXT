# Restricted database runtime role experiment

## Scope

This experiment is isolated on local branch `lab/restricted-db-runtime`. It
does not change staging, development, production, RX Tracker 3.3.1, or RX
Softphone. The disposable database and role contain no production data.

## Security boundary

```text
RX Tracker service (.env)                 Project Control update/rollback
        |                                              |
        | restricted runtime login                     | prompted maintenance login
        v                                              v
  SELECT / INSERT / UPDATE / DELETE             backup / migrate / restore
  business tables and sequences                 create / alter database objects
        |                                              |
        +---------------- PostgreSQL ------------------+

Runtime is denied:
  - CREATE or ALTER schema objects
  - database or schema creation
  - ownership of application objects
  - role administration and membership
  - writes to SequelizeMeta
```

The maintenance password is not placed in `.env`. Project Control reads it as
a secure interactive value and keeps it only in its process for that operation.

## Disposable proof performed on 2026-07-22

Database: `rx_next_runtime_role_test_20260722`

Runtime role: `rxnext_runtime_lab_20260722`

Both disposable objects were removed after the successful test run.

The experiment proved all of the following:

- 34 audited migrations provisioned by the maintenance identity.
- Runtime role covered 30 tables and 29 sequences.
- Schema verification and normal server startup passed as the runtime role.
- Health check and authenticated administrator login passed.
- Call Center queue, phone-client selection, shared-call state, RX Softphone
  setup, automatic call attempts, patient updates, RX override permissions,
  workflow dates, patient deletion, and service-window regressions passed.
- Runtime migration and `sequelize.sync()` attempts were rejected.
- Maintenance migration verification passed.
- Project Control's updater self-test confirmed that the runtime `.env`
  identity remains unchanged while a separate maintenance identity is used.

One regression test previously called `sequelize.sync()` during test setup.
When `RX_TEST_SCHEMA_READY=true`, it now uses the already migrated test schema,
allowing the test to execute with the same restrictions as the application.

## Promotion gate

Do not merge this branch directly into production. The formal path is:

1. review and commit the local experiment;
2. promote the reviewed commit to the staging branch and run the complete
   database and application suite against a disposable restored database;
3. promote the same commit to development and build an official checksum
   release candidate;
4. rehearse the one-time production role conversion on a fresh production dump;
5. merge the unchanged reviewed commit into the production branch and publish
   an official release ZIP plus `SHA256SUMS.txt`;
6. install the code release through Project Control option 15;
7. during a separate controlled window, configure and verify the production
   runtime role, change only `DB_USER`/`DB_PASS`, restart, and run health/login/
   write checks.

After step 7, later releases use the normal option 8 then option 15 workflow.
Project Control prompts for the maintenance login only when it must back up,
migrate, verify, or restore the database.
