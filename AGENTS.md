# RX Tracker NEXT repository instructions

This repository is the migration-managed RX Tracker NEXT project. At the start
of every new working session, read these files before changing code:

1. `docs/PROJECT_HANDOFF.md`
2. `README.md`
3. the newest entries in `CHANGELOG.md`
4. the runbook relevant to the requested operation

## Scope boundaries

- Work only in this repository unless the user explicitly names another
  project and authorizes changes there.
- Do not modify the frozen RX Tracker 3.3.x project or RX Softphone while
  working on NEXT.
- Do not copy NEXT changes into template repositories automatically. The
  legacy `.agents/AGENTS.md` file points back to these authoritative rules.
- Never commit `.env` files, credentials, pairing secrets, SIP passwords,
  patient information, production dumps, logs containing sensitive data, or
  generated executables/ZIPs.

## Release discipline

- Production uses compiled official GitHub releases, not a source checkout.
- Keep version, changelog, release notes, package lock, executable metadata,
  and tag consistent.
- Run and pass the PostgreSQL lifecycle checks locally before pushing
  `main` and the release tag. Prevent hosted workflow triggers before pushing.
  Verify the published ZIP and `SHA256SUMS.txt` assets.
- Do not rewrite or replace an existing release tag or its assets; publish a
  new patch version for corrections.
- Routine production updates go through Project Control. Do not manually run
  migrations or replace production `.env`.

## Database safety

- Web startup is check-only. Schema changes use audited migrations through
  `rx-db` and the guarded release updater.
- Treat configured RX Actions as customer process data. Never reseed, rename,
  enable, disable, or reorder them in a populated database.
- Before a production update, preserve the paired application/database
  rollback set and validate business-data fingerprints.
- Never run old and new application binaries against the same live database
  simultaneously.

## Handoff maintenance

Update `docs/PROJECT_HANDOFF.md` whenever the production version, deployment
layout, release process, rollback process, major decision, or confirmed
pending issue changes. Keep it sanitized and commit it with the related work.

## Publishing default: verified local builds

User-requested workspace policy: when asked to publish, release, or prepare a
production release, build, test, and package on this computer. Use GitHub for
source history, version tags, release notes, and finished release downloads.

- Read the project's instructions and runbooks, then use or establish its own
  repeatable local release script. Do not assume Tool Atlas commands fit it.
- Run the project's required checks locally, including database lifecycle,
  migration, packaging, and deployment checks where applicable. Preserve all
  existing safety gates. If prerequisites are missing or checks fail, report
  the blocker; do not publish an unverified release or silently use cloud CI.
- Before pushing source or tags, inspect automatic workflows and disable or
  migrate hosted build/release triggers so the push cannot start cloud builds.
  Do not enable or run GitHub-hosted Actions without explicit user authorization.
  This local execution requirement supersedes older instructions to wait for
  hosted CI; the checks themselves remain required.
- Release only intended committed changes from a clean checkout/worktree.
  Keep private data, credentials, local configuration, and unrelated edits out.
- Keep version, release notes, and tag consistent. Generate SHA256 checksums,
  upload verified packages as a draft release, download them again, and compare
  hashes before publishing. Record the source commit and local validation.
  Never overwrite an existing published release; use a new version.
- Publishing alone does not mean installing on production. The user performs
  installation unless they explicitly request deployment as a separate action.
- Keep this policy in the project's instructions when updating its release
  process. This note does not itself disable existing workflows or configure
  a working local build script; those steps must be verified before publishing.
