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
- Push `main`, require the PostgreSQL lifecycle CI to pass, then create and
  push the release tag. Verify the published ZIP and `SHA256SUMS.txt` assets.
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
