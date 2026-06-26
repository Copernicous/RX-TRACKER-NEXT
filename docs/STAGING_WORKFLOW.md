# Patient RX Staging Reference

This document is the reference for using staging without putting development or production at risk. The short version is:

- `staging` is where new ideas are tested.
- `develop` is where proven staging work gets final polish.
- `main` is production.
- Staging must use its own database, port, and runtime files.

## Branches

- `main` is production only. Only merge here when a release is ready to deploy.
- `develop` is the integration branch for final polish after staging proves the idea.
- `staging` is the testing branch and staging-site branch.
- Feature branches are optional and short-lived, for example `feature/patient-service-date-history`.

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

## Folder And File Map

The project stays in one folder. Staging is separated by Git branch plus ignored local runtime files.

```text
Daniely RX/
|-- app.js
|-- public/
|-- views/
|-- docs/
|   |-- STAGING_WORKFLOW.md
|-- .env                  production/development local env, not committed
|-- .env.staging.example  committed template for staging
|-- .env.staging          local staging secrets, not committed
|-- staging/
|   |-- runtime/          local staging data/logs/uploads, not committed
|-- uploads/              normal app upload location unless runtime override is active
|-- logs/                 normal app logs unless runtime override is active
|-- backups/              normal app backups unless runtime override is active
```

Production builds do not need `.env.staging` or `staging/runtime`. Those are ignored local staging files. Production uses `main` plus the normal production environment.

## Local Staging Environment

Staging uses `.env.staging`, which is intentionally ignored by Git.

Create it from the example:

```powershell
Copy-Item .env.staging.example .env.staging
notepad .env.staging
```

Minimum values to review:

- `PORT=3100`
- `NODE_ENV=production`
- `APP_ENV=staging`
- `APP_ORIGIN=http://localhost:3100`
- `APP_WRITABLE_ROOT=staging/runtime`
- `DB_NAME=patient_rx_staging`
- `DB_PASS=...`
- `JWT_SECRET=...`
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

## Staging Visual Marker

Staging should look different so it is not confused with production.

When `APP_ENV=staging` or another staging marker is present, the app shows:

- A magenta/orange staging color theme.
- A `Staging Environment` banner on the login page.
- A `STAGING` badge in the sidebar.
- A `STAGING` marker in the top navigation area.

If staging does not look different, check `.env.staging` first and confirm:

```text
APP_ENV=staging
```

Then restart staging:

```powershell
npm run staging:start
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

## How To Ask Codex For Work

Use clear phase words so Codex knows which branch and risk level to use.

For a new idea that should not touch production:

```text
Work only in staging: explore this idea, implement it safely, run staging checks, and push staging only.
```

For a rough idea that needs discussion before code:

```text
Staging idea only: help me decide the best approach for [idea]. Do not edit files yet.
```

For building the idea after discussion:

```text
Implement this in staging only: [feature]. Keep production and develop untouched. Run the staging smoke test.
```

For moving tested work from staging to development:

```text
Bring staging to development: merge the tested staging changes into develop, run the development checks, and push develop.
```

For preparing production after development is approved:

```text
Prepare production: merge develop into main, run production checks, build the release, push main, and tell me what to verify in production.
```

For a production emergency:

```text
Production hotfix: fix only [bug] from main, test it, push main, then back-merge the fix into develop and staging.
```

## Idea To Production Process

Use this path for bigger decisions, risky changes, new workflows, or anything that touches patient data.

1. Inception

   Discuss the idea and decide if it belongs in staging. Good wording:

   ```text
   Staging idea only: I want to track patient service date history. Is this a simple change or a bigger design?
   ```

2. Staging design

   Decide what data changes, screens, uploads, reports, and backups are affected. If database changes are needed, keep them isolated and reversible until approved.

3. Staging implementation

   Build on `staging` or a short-lived feature branch from `staging`. Use the staging database and staging runtime folder.

4. Staging checks

   Run:

   ```powershell
   npm run staging:check
   npm run staging:start
   ```

   Then manually test the critical flows listed below.

5. User approval

   The user tries the staging preview and decides if the idea should continue, change direction, or be discarded.

6. Development promotion

   Merge staging into `develop` only after the staging behavior is approved.

7. Final development polish

   Clean wording, edge cases, migrations, and production readiness on `develop`.

8. Production release

   Merge `develop` into `main`, run production checks/build, push, deploy, then verify the real production workflow.

## Critical Manual Checks Before Promotion

Before moving staging into `develop`, check:

- Login/logout works.
- Dashboard loads.
- Patients list opens.
- Patient add/edit works.
- Patient profile pages open.
- RX records open and workflow actions still work.
- Reports open.
- Backups page opens but scheduled backups remain off unless intentionally enabled.
- Document upload works in the staging storage mode you are testing.
- Error Logs and Audit Logs do not show new crashes.

## Upload And Document Smoke Test

Because upload problems can appear only after deployment or environment changes, check this path before promotion:

- Open a patient.
- Upload one test document or image.
- Confirm the upload shows in the patient record.
- Open or download the uploaded file.
- Refresh the page and confirm the file is still listed.
- Check Error Logs for JSON, dynamic import, path, or storage errors.

If the browser shows an error like `Unexpected token '<'` or `A dynamic import callback was not specified`, treat it as a release blocker until the upload path is tested and fixed in staging.

## Promotion Checklist

Before merging `staging` into `develop`:

- `git status --short` is clean except ignored/local runtime files.
- `npm run staging:check` passes.
- Staging preview opens at `http://localhost:3100`.
- Staging has the visible staging marker.
- Critical manual checks pass.
- Upload smoke test passes.
- The user approves the behavior.

Before merging `develop` into `main`:

- Development checks pass.
- Production secrets are not committed.
- `.env.staging` is not committed.
- `staging/runtime` is not committed.
- The release build succeeds.
- The user approves production deployment.
