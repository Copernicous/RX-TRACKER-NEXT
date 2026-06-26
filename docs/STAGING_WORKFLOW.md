# Patient RX Staging Workflow

This workflow keeps production stable while bigger decisions are tested safely.

## Branches

- `main` is production only. Only merge here when a release is ready to deploy.
- `develop` is the integration branch for final polish after staging proves the idea.
- `staging` is the testing branch and staging-site branch.
- Feature branches should be short-lived, for example `feature/patient-service-date-history`.

Recommended flow:

```powershell
git checkout staging
git checkout -b feature/patient-service-date-history

# build and test the feature

git checkout staging
git merge --no-ff feature/patient-service-date-history
npm run staging:check
npm run staging:start

# after staging passes real workflow testing
git checkout develop
git merge --no-ff staging

# after final dev polish and tests
git checkout main
git merge --no-ff develop
npm run build:exe
git tag vX.Y.Z
git push origin main develop staging --tags
```

## Local Staging Environment

Staging uses `.env.staging`, which is intentionally ignored by Git.

Create it from the example:

```powershell
Copy-Item .env.staging.example .env.staging
notepad .env.staging
```

Minimum values to review:

- `PORT=3100`
- `DB_NAME=patient_rx_staging`
- `DB_PASS=...`
- `JWT_SECRET=...`
- `APP_WRITABLE_ROOT=staging/runtime`
- `BACKUP_SCHEDULE=off`
- `SITE_BACKUP_SCHEDULE=off`

Run the safety check:

```powershell
npm run staging:check
```

Start staging:

```powershell
npm run staging:start
```

Open:

```text
http://localhost:3100
```

## Production Data Copy

Do not connect staging to the production database.

Use a production backup file and restore it into a separate staging DB, for example:

```powershell
createdb -h 127.0.0.1 -U postgres patient_rx_staging
pg_restore -h 127.0.0.1 -U postgres -d patient_rx_staging --clean --if-exists path\to\production-backup.dump
```

After restoring, confirm `.env.staging` still points to `patient_rx_staging`.

## Safety Guardrails

The staging launcher refuses to start when:

- `.env.staging` is missing.
- `DB_NAME` does not look like a staging/test/sandbox database.
- `DB_NAME` equals the root `.env` database.
- `PORT` equals the root `.env` port.

Staging writes runtime data under `APP_WRITABLE_ROOT`, so these stay separate:

- `data/settings.json`
- `logs`
- `backups`
- `uploads/documents`
- temporary restore uploads

## Critical Manual Checks Before Promotion

- Login/logout works.
- Dashboard loads.
- Patients list opens.
- Patient add/edit works.
- RX records open and workflow actions still work.
- Reports open.
- Backups page opens but scheduled backups remain off unless intentionally enabled.
- Document upload works in the staging storage mode you are testing.
- Error Logs and Audit Logs do not show new crashes.

Only after those checks pass should staging be merged into `develop`.
