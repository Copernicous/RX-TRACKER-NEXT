# Backoffice history rotation review - 2026-10-27

Scope: next.98 source review and an isolated controller fixture. No database,
archive files, policies, running servers or published assets were changed.

## Findings to address first

1. **Recently resolved errors do not get a fresh retention timestamp.**
   Backoffice `resolveErrorLogs` uses raw SQL to change `resolved`, without
   updating `updatedAt`. Archive eligibility requires both creation and modification
   timestamps to be old. An old error resolved today through Backoffice can
   therefore move immediately on the next archive run. It remains readable, but
   the recent-change protection is defeated. The normal Error Log controller
   uses ORM updates and refreshes this timestamp. Correct both Backoffice modes
   and test the configured window after resolution.
   Sources: controllers/adminController.js:3587; controllers/errorLogController.js:59;
   services/historyArchiveService.js:76.

2. **Combined-history rows have no storage identity in Backoffice.** Audit and
   Error viewers read combined history, without Active/Archived/All controls or
   archive markers. Error actions target only active rows. Resolution reports
   submitted IDs, even when no active row matches; archived selections can get
   a false success message. Tables & Data counts active AuditLogs only, while
   Audit Log shows both stores. Add explicit scope/counts, read-only archived
   actions and actual affected counts.
   Sources: controllers/adminController.js:171, 3072, 3124, 3528, 3587;
   views/backoffice.ejs:564, 900.

3. **Purge remains deletion, separate from archiving.** Backoffice Error Logs
   supports ID/age/filter/all deletion. Several modes can remove recent or
   unresolved active errors. Tables & Data can purge active AuditLogs. These
   are explicitly destructive administrative actions, deliberately separate
   from next.98 archiving. Never schedule these endpoints as rotation. Offer
   verified archiving for routine maintenance and keep permanent purge visibly
   separate with its existing confirmations.
   Sources: controllers/adminController.js:245, 3605;
   views/backoffice.ejs:391, 940; docs/HISTORY_ARCHIVING.md.

## Useful candidates

| Area | Current behavior | Recommendation |
| --- | --- | --- |
| Audit / Error Logs / activity | next.98 archive tables and complete-history readers already exist | Reuse the same policy, preview, status and numbered dated downloads. Add storage scope/counts and a link to Audit Log settings; avoid a second policy/schedule. |
| Delivery Log Archive Cleanup | JSON under writable administration/delivery-log-archives; manual age purge removes files; count/byte quotas bound storage | Good candidate for verified compression/cold storage and read-only recall. Keep recent files available; preserve original content, checksums, renderer dependencies and sequence ledger. Prove printing, download and backup/restore before removing hot originals. No automatic deletion. |
| Database CSV Review Snapshots | Includes every public base table, including archive tables; creating a snapshot prunes older backup_* directories | Separate snapshot and database-backup retention. Consider verified compression, dated inventory and downloads to preserve old snapshots. Saves disk, not database rows. CSV sets are not database restore backups. |
| Log Dashboard | Already reads combined audit/activity/error history | Preserve complete analytics, expose archive status and use bounded ranges. Measure query plans rather than assuming archiving accelerates combined reads. |
| Tables & Data | Active counts; raw viewer selects entire table | Expose storage scope and paginate/search on the server. Archiving alone does not fix unbounded fetching. |
| Daily metrics | One unique row per snapshot date | Low priority: retain compact long-term trend summaries. |
| Call Center / RX / driver / service-date history | Operational links; cleanup also deletes call attempts, notes and service-date events | Exclude from generic age rotation. Requires a dedicated dependency-aware design and complete-history regressions. |
| PostgreSQL/site backups and paired rollback sets | Separate backup-count retention and recovery rules | Preserve their recovery policy; do not apply log rotation or automatically move/delete rollback sets. |

## Benefit and limits

Same-database archive tables can reduce active-table work; total database storage
and full-history queries do not automatically shrink. Indexes, pagination, date
ranges and measured plans still matter. CSV generation currently reads entire
base tables into memory, including archives; rotation does not make it cheap.
Streaming or a bounded export job is a separate improvement. Delivery files are
already outside PostgreSQL, so compression primarily helps disk/storage browsing.
Archive objects need protected backup coverage; the general site ZIP excludes
sensitive runtime archives/logs.

## Suggested order

1. Fix resolution timestamps and affected counts; test both resolution modes,
   recent/exact-boundary/old timestamps and mixed active/archived IDs.
2. Add Backoffice access to the existing archive controls/downloads and scope.
3. Evaluate verified compression/recall for delivery JSON and CSV snapshots,
   including backup recovery, renderer and sequence compatibility.
4. Measure queries, paginate table viewing and stream heavy snapshots before
   extending database rotation to more business history.

## Verification

Traced routes, controllers, UI, archive predicates, history readers and file
retention/deletion. An isolated VM fixture ran the Backoffice resolution handler
with a stub query function, without model initialization or a database connection.
It confirmed missing updatedAt and a submitted-count success despite zero matches.
No data was changed. No application build/test suite was rerun for this review-only
change. The next.98 tag and packages remain unchanged.
