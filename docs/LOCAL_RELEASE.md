# Verified local releases

User policy: staging -> develop -> main -> official release, with all checks,
compilation and packaging on this computer. GitHub stores source, tags, notes
and finished downloads. Do not dispatch hosted workflows without explicit
user authorization. All workflow triggers are manual-only.

## Prepare

1. Promote only accepted staging changes to develop. Exclude deferred work.
2. Use a clean release worktree from develop. Align package/lock versions,
   changelog, Readme.txt and `.github/releases/v<version>.md`, then commit.
3. Install PostgreSQL 17 client tools, Node.js, .NET SDK matching
   `rx-softphone-desktop/global.json`, and a verified CodeQL bundle. Portable
   tools may live outside the worktree. No production configuration belongs
   in the release checkout.
4. Supply a local maintenance environment file. The harness reads only its
   loopback database connection credentials, never its database name. It
   refuses pre-existing `rx_next_ci_*` test database names, creates fresh
   synthetic databases, and removes only its own fixtures. Test logs/dumps
   stay local and must not be committed or uploaded.
5. From Windows PowerShell 5.1 run:

```powershell
.\scripts\Prepare-LocalRelease.ps1 `
  -MaintenanceEnv <absolute-local-maintenance-env-file> `
  -OutputDirectory <new-local-evidence-directory> `
  -DotnetDirectory <portable-sdk-directory> `
  -CodeqlExe <codeql.exe-path> `
  -BaselineRef <previous-published-release-tag> `
  -PgBin 'C:\Program Files\PostgreSQL\17\bin'
```

The script requires a clean commit and no `.env` in the release worktree.
It installs locked dependencies, runs `local-release-checks.js`, compiles the
unchanged Softphone, runs both CodeQL scans, builds server/rx-db with pinned
pkg 6.23.0, builds all three ZIPs, verifies source/package parity and compiled
versions, and writes SHA256SUMS.txt and LOCAL_VALIDATION.json. Failures block
release; they never fall back to GitHub. CodeQL runs on the candidate and the
published JavaScript baseline with the same tool/query bundle. New unreviewed
high/error findings block; existing findings stay in the evidence and are not
declared safe. Unchanged Softphone source is identified against the baseline.
See LOCAL_RELEASE_SECURITY_REVIEW.md for the narrow test-only review and
existing source/dependency findings.
Existing moderate Sequelize/UUID findings do not justify a forced downgrade.

The lifecycle harness includes fresh provisioning/idempotence, checksum drift,
sanitization, synthetic legacy dump adoption, real backup restore/runtime-role
recovery, historical Region migration validation, application regressions,
relay integration and restricted runtime health. Its explicit local test flag
extends the former hosted-only test guard without permitting live databases.

## Promote and publish

1. Check LOCAL_VALIDATION.json passed for the exact intended source commit.
   Fast-forward develop and then main to that commit; preserve local unrelated
   edits and never replace a published tag. Revalidate if source changes.
2. Before any push, confirm all remote workflows are disabled (including the
   previously scheduled workflows) or remote automatic triggers have already
   been removed. This avoids old branch/PR definitions starting hosted jobs.
3. Push only intended branches and the matching new annotated version tag.
   A Git push transfers source/tag history, not release ZIPs.
4. Create a **draft** release from that existing tag with the version notes.
   Upload the two server ZIPs, unchanged-source Softphone ZIP, SHA256SUMS.txt
   and sanitized LOCAL_VALIDATION.json. Never upload test logs or dumps.
5. Download every draft asset again into a fresh directory; compare all hashes
   with local originals and SHA256SUMS.txt. Verify both executables inside the
   server ZIPs. Publish only after the downloaded assets pass.
6. Record the source commit, local validation, release URL and verified hashes
   in PROJECT_HANDOFF.md. Production installation is a separate user action
   through Project Control, not a source checkout or a manual migration.

Preparation does not push or publish automatically. It leaves a concrete,
verified set of files ready for the authorized push/upload step.
