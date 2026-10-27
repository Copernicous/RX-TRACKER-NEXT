RX Tracker NEXT 4.0.0-next.99
============================

Backoffice retention and RX Profile Sync controls
------------------------------------------------
Backoffice shares archive settings, Active/Archived/All views, dated downloads
and active/archive counts. Resolving errors refreshes retention timestamps.
Verified gzip compression preserves older delivery logs and CSV snapshot files;
normal downloads and delivery printing recall their original content. Existing
saved policies add the new file sections disabled with 30-day windows.
CSV snapshots are no longer auto-deleted. Table viewing uses server pagination;
snapshot creation fetches 250 rows at a time in a read-only transaction.

RX Profile Sync defaults OFF. Stop / leave off persists across restarts and
blocks copying while paused. Enabling requires an inclusive starting date based
on RX creation time at 00:00 UTC. Explicit review while paused and individual/
bulk reviewed-ignore decisions do not change patient/RX values. Syncing values
requires an explicit enabled Sync action; no automatic copying is introduced.

Installation and recovery
-------------------------
Verify SHA256SUMS.txt and LOCAL_VALIDATION.json. Use Project Control option 8
then 15. No new migration since next.98 (65 migrations total); startup checks
only. Preserve .env, configured RX Actions and the paired app/database rollback
set. No installation-time patient/RX rewrite. Require healthy next.99 and check
archive settings, stored-file recall and paused RX Profile Sync.

Protect delivery/CSV snapshot folders, gzip files and .gz.sha256 receipts,
renderers and the delivery sequence ledger in separate filesystem backups.
General site packages exclude sensitive archives. Older binaries cannot read
compressed files: use a compatible application or verified file rehydration
when recovering. A paired database rollback does not restore external files.
See docs/HISTORY_ARCHIVING.md and docs/RX_PROFILE_SYNC_CONTROLS.md.

Both executables embed verified Node.js 22.23.4. Existing source/dependency
findings remain documented. Publication does not install production.
