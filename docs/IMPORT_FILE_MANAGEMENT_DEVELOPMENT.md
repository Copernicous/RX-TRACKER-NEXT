# Import File Management in development

2026-10-12. User authorized development promotion after reviewing staging.
This is a selective promotion of the importer from `4eebd22`, built on develop
`c93c957`. Staging-only delivery/history/report work, shared history filters,
release files, workflows, dependencies and version changes are excluded.

## Scope

- Familiar patient import review, with Import History / Files to Correct /
  Corrected Files tabs. Development keeps its existing history controls.
- Persisted correction snapshots and transaction-bound resolution. Failed or
  skipped rows stay pending; completed rows cannot be replayed as corrections.
- Original and actual corrected CSV downloads, byte-preserved and checked by
  SHA-256, with New York import dates appended to their filenames.
- Existing historical reports are not rewritten or backfilled.
- Audit rotation protects these import snapshots and their resolution records.
  This is the sole change to the audit controller; other audit behavior stays.
- Patient identity checks, permissions, locked revalidation, signed review,
  restoration, address/Region/service-date rules and rollback remain enforced.

The other pages, shared styling, app startup, schema/migrations, configured RX
Actions, dependency lockfile, release machinery and Softphone source are unchanged.
The original baseline behavior remains available with the switch off.

## Enable and review

Both `APP_ENV=development` (or staging) and `IMPORT_REVIEW_V2=true` are required.
Production is disabled and the flag defaults off. With an independently verified
development database configuration, use these launch-environment settings:

```powershell
$env:APP_ENV = 'development'
$env:IMPORT_REVIEW_V2 = 'true'
npm start
```

Do not replace `.env` or point development at production to enable this feature.
Disable the flag and restart to restore the baseline interface and validation;
disabling does not delete correction records or undo explicitly saved patients.

For this review, a separate synthetic database
`patient_rx_import_development_test` was provisioned on the disposable PostgreSQL
cluster at loopback port 55439. Its preview runs on port 3000 from
`output/import-development-worktree`, using ignored configuration/runtime files
under `output/import-development-validation`. Existing development configuration
and database are untouched. No two application versions share this database.

## Validation

The promoted development code passed locally:

| Check | Result |
| --- | --- |
| File Management PostgreSQL suite | 20 scenarios passed |
| Experimental controller/model suite | 30 scenarios passed; includes explicit development enablement and production rejection |
| Additional PostgreSQL importer suite | 9 scenarios passed |
| Original duplicate/merge regressions | Passed |
| Address/tag, manual-create and address-parser regressions | Passed |
| Public JavaScript syntax/encoding | Passed for 25 files |
| Database verification | READY; 64 applied, no pending, verified checksums |
| Authenticated development browser | Three tabs, error retention, valid subset save, corrected-only save, persistence after refresh, uploaded-file buttons and original development history controls passed; no console errors |

All fixtures were synthetic. No real patient file was imported. Exact file scope
was checked against development; unrelated staging changes were not merged.
Local evidence and screenshots remain ignored under
`output/import-development-validation`.

This promotes development source only. No push, hosted workflow, production
release, compiled package or production installation is included. CSV only;
XLSX support is not added.
