RX Tracker NEXT 4.0.0-next.98
============================

Verified history archiving
--------------------------
Older eligible records move transactionally to database archive tables. Recent
events, unresolved work and operational call references remain active. Initial
retention is 30 days per section; automatic archiving starts disabled. Existing
saved settings are preserved, and server-level scheduler pauses are shown.
Browse Active/Archived/All and numbered downloads with event date ranges.
Downloading makes a copy; archived records remain stored and readable.

Archive tables are included in full database backups. This reduces active-table
load, not total database storage. Technical file logs are compressed separately;
back up logs/archive separately. See docs/HISTORY_ARCHIVING.md.

Installation and verification
-----------------------------
Verify SHA256SUMS.txt. Use Project Control option 8 then option 15. One audited
migration creates archive tables/views (65 migrations total); startup is check-only.
Preserve .env, configured RX Actions and the paired application/database rollback
set. Require healthy version 4.0.0-next.98; check archive status and full history.
Migration rollback refuses populated archives. Use Project Control option 16 for
emergency paired application/database recovery, never an older binary alone.
Publication does not install production. See RELEASE_NOTES-v4.0.0-next.98.md.

Both executables embed Node.js 22.23.4. Local validation records exact source,
checks and package hashes. Existing dependency/source findings remain documented.
