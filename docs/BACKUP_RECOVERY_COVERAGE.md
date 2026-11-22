# Backup retention and delivery recovery

Starting with next.102, a successful daily dump or full-site ZIP is accompanied
by a separate `delivery-recovery/<backup-stem>.delivery-recovery.zip`, its
`.sha256.json` checksum receipt and a helper process-ownership receipt. The main
backup log records the verified companion. Daily entries also bind the companion
to that dump's SHA256. A failed companion prevents success/pruning of prior backups.

The companion preserves the entire delivery archive subtree, including hidden
sequence ledger, original JSON, gzip files and checksum receipts. Its manifest
records relative names, lengths, per-file SHA256 values and application version.
Compiled installations also include `renderer/server.exe` and package metadata;
the executable embeds the compatible renderer and frozen stylesheet. Restore the
corresponding official release and verify the manifest before using these files.

These are private recovery artifacts containing patient information. Protect the
complete backup folders with restricted ACLs and the organization's off-host
encryption/access controls. Keep the main artifact and its companion together.
General site ZIPs deliberately exclude delivery PHI and nested `backups` folders.
Keep custom backup directories outside the application root; arbitrary custom
directory names inside that root are not covered by the generic exclusion.
Do not treat a general site ZIP alone as complete delivery recovery.

Restore only into a separate isolated directory first. Validate the outer ZIP
SHA256 against its receipt, every entry against manifest hashes, and the recorded
application version. Reject absolute/traversing/link entries. Rehydrate the delivery
subtree without merging it into a running application; preserve the complete
ledger and renderer. Perform the database test restore using the guarded runbook
and verify application/business fingerprints before any controlled cutover.

`BACKUP_RETAIN` and `SITE_BACKUP_RETAIN` are file counts, not days. Existing saved
settings are not automatically changed by installation. The approved production
target is one latest daily pair and one latest weekly pair, plus the independent
current update rollback set. A scoped service environment override can implement
these values while preserving production `.env`; restart only after backing up
and reviewing the exact changes. Do not reduce retention before the replacement
main artifact and delivery companion are verified. A rollback set remains protected
outside these routine-pruning paths.

Source snapshot verification checks file inventory and source hashes before and
after archive creation. Concurrent delivery activity causes a failed snapshot
rather than a claimed successful inconsistent copy. Re-run through the normal
backup operation after activity settles; no blind retry loop is installed.
