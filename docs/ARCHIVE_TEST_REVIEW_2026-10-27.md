# Local archive test review — October 27, 2026

Reviewed the user's manual archive operations on
`rx_history_backup_test_20261027134653` at localhost:3000. Current test data,
retention settings, runtime configuration and archive contents were not changed.
Read-only inspection used repeatable-read PostgreSQL snapshots, application read
controllers with database writes disabled, and the user's signed-in browser.
Normal browser navigation can add page-activity records. A separate restore of
the original Desktop backup provided a baseline for comparison.

## Result

Manual archive transfers and subsequent reading passed. No original audit,
activity or error records were missing or modified. There are two usability /
configuration findings below; automatic execution is not active on this server.

| Section | Archived rows verified |
| --- | ---: |
| Audit events | 37,564 |
| Completed import reports | 48 |
| Page activity | 44,434 |
| Completed correction groups | 0 |
| Resolved errors | 0 |

The audit archive table contains 37,612 rows because import reports share that
table. Archive receipts sum exactly to the stored rows. No IDs overlap between
active/archive tables. Combined history counts equal active plus archived.

Compared each original record's `to_jsonb` content hash against combined active
and archived history:

- Original AuditLogs: 49,280; missing **0**, changed **0**.
- Original UserActivityLogs: 57,994; missing **0**, changed **0**.
- Original ErrorLogs: 6; missing **0**, changed **0**.

New audit receipts and page visits account for the increased history totals.
The existing business-data fingerprint also matches the pre-migration restore.
No recent archived rows violated the cutoff recorded for their section. No
protected call events, referenced call events or archive receipts were moved.
All six unresolved errors stayed active; no new application ErrorLogs were found
since activating this backup. Correction/error archival was not exercised by
these user operations: no eligible records remain in those sections.

## Browsing, import files and exports

- Application readers successfully served Active / Archived / All audit,
  activity and import history. The signed-in browser displayed 37,612 archived
  audit rows and 44,434 archived page visits, with archive selection read-only.
- All 48 archived import report detail handlers succeeded. Eight retained
  original/corrected CSV representations downloaded through their existing
  handlers and matched their saved SHA-256 hashes. Reports without a retained
  upload were not assumed to contain one.
- All five archive export handlers produced valid gzip JSON and manifest
  checksums, including empty correction/error archives. Audit export pagination
  advanced to strictly later IDs. The real browser reported export success and
  advanced its next-page control; the browser automation download-event hook did
  not return a local file path, so filesystem delivery was not independently
  verified through that hook.

## Findings

The download-progress finding below was subsequently addressed in the local
workspace at the user's request: **Browse downloads** now provides numbered
pages, navigation, record ranges and saved per-browser attempt/pending status.
See HISTORY_ARCHIVING.md for current behavior. The scheduler pause is unchanged.

1. **Automatic archive execution is paused despite the saved checkbox.** The
   user saved automatic=true, hour 14 UTC (10 AM New York on this date), with
   audit/activity/corrections/errors at 30 days and imports at **10 days**.
   However, the restored-test launcher explicitly sets
   `HISTORY_ARCHIVE_SCHEDULER_ENABLED=false`, as recorded when the backup was
   activated. There is no automatic-run receipt. Manual operations worked;
   the saved schedule has not run. `status()` returns the saved policy without
   exposing the effective environment pause, so the checked control can mislead.
   Recommended correction: display effective scheduler state and pause reason;
   enable the test-process scheduler only when the user requests it. Review did
   not restart the server or change the user's settings.
2. **Download progress is unclear.** “Download next page” means the next export
   batch, not a page of the visible table. Audit/activity/error files contain at
   most 250 records, while import/correction files contain one record per export
   file. Thus the current 48 import reports require 48 separate export pages.
   The button tracks an ID cursor only in browser memory. Refresh resets it;
   reaching the end resets its label to “Download archive.” It does not show
   which page was downloaded, total pages or remaining work, and it does not
   keep a durable downloaded/pending ledger. Recommended correction: numbered
   batch progress, a clear completion state and a convenient complete export.

**Downloading never removes archive records.** Downloads are copies. Originals
stay in PostgreSQL and remain available through Archived / All, regardless of
how many files were downloaded, whether a download failed, or whether the page
was refreshed. In-app review needs no JSON download. For spreadsheet analysis,
the existing audit/activity CSV export is easier to read than raw JSON.

Private aggregate evidence and comparison scripts are ignored under
`output/history-archive-review`. The comparison database is
`rx_archive_review_baseline_test_20261027141100`; it is separate from the running
test copy and is not activated. No production change, new archive operation,
deletion, dependency update or release was performed by this review.
