# History archival and recall: implementation review

Status: deferred by the user on 2026-09-24; low priority. No cold-storage jobs, automatic rotation,
movement, removal, retention settings, or production changes are authorized
by this document. Review the scope and operational effects before implementing.

## Latest decision: postpone and consider external viewing instead

Do not resume this work automatically when reopening the repository. Wait for
an explicit user request. Keep the existing data in place.

The preferred direction for later evaluation is a self-contained archive of
eligible old history that can be opened outside RX Tracker, rather than an
integrated cold-storage/recall system. This could avoid catalog integration,
recall jobs, temporary retrieval caches and application-version dependencies.
It still requires proof that the archived records are not used by operations.

Possible formats to evaluate, not implement now:

- CSV for structured import/history details, accompanied by a field dictionary
  and clear date/time-zone information; preserve original snapshots separately
  when CSV would lose information.
- PDF or self-contained HTML for human-readable delivery copies. Any conversion
  must be verified against the original; retain original evidence and references.
  A PDF rendition is not automatically equivalent to the original signed/hash-
  verified application artifact or its audited reprint workflow.
- Compressed plain text for closed technical log files.
- A dated package with a simple index, record counts, format version and checksums,
  readable using standard programs without installing RX Tracker.

No format, external program, storage destination, retention window, compression
policy, or source deletion has been selected. Patient/RX records and their
operational dependencies remain excluded. Sensitive archives need protected
access and verified backups even when opened outside the app. An exported copy
does not authorize deleting the source, and moving files alone does not reduce
total storage usage.

The in-app recall sequence below is the earlier alternative retained for review,
not the chosen implementation. If work resumes, compare the simpler external
archive against it before proposing implementation. Pagination/filter/export
work already committed on staging is separate and remains unreleased.

The separate staging pagination/filter/export work does not archive data. Its
Delivery Log metadata cache is process-local, rebuildable browsing metadata;
it is not durable cold storage and does not reduce original-file storage.

## Scope and sensitivity

| Data | Proposed treatment | Sensitive contents / operational risk |
| --- | --- | --- |
| Patients and RX records | Keep active; excluded from archival | Core operational records. This exclusion includes inactive/deleted records; their identity and relationships still matter. |
| RX workflow tracking, RX history, driver assignment history, profile-sync review events | Keep active in the initial design | Completion state, historical evidence, driver correction, review status, and complete-history exports can depend on them. Do not infer eligibility from age. |
| Patient notes, medications, service-date history/cycles, documents and attachment references | Keep active in the initial design | Clinical/operational context, service eligibility, historical relationships, and exports. File attachments must not be detached from their records. |
| Delivery Log saved copies | First candidate for a separately approved pilot | Contains patient information and frozen print evidence. Must preserve original bytes, hashes, renderer dependencies, original reference, and audited/authorized reprinting. |
| Patient Import report snapshots | Later candidate after a dedicated design | Stored inside AuditLogs, including previous/incoming/final patient field values. Preserve report IDs, original snapshots, and owner/all-audit-reader access. Never rebuild from current patient values. |
| Other AuditLogs | Classify each module/action before selecting any | Call Center uses Called events for counts, last-call sorting, and activity views. Audit/security evidence and analytics also depend on these rows. No table-wide age-based move. |
| Call Center attempts, queues/claims/locks, relay state | Keep active initially | Open attempts determine active call ownership; historical attempts feed reports and exports. Pending/in-flight records are never archival candidates. A later proposal must cover closed attempts independently. |
| UserActivityLogs and resolved ErrorLogs | Potential later candidates | Activity/security investigation, log dashboards, trend reconstruction, and snapshot backfills use these records. Unresolved errors stay active; access restrictions remain. |
| DailySnapshots | Keep active initially | Already summarized trend data; removing it would break or shorten historical analytics. Measure size before considering changes. |
| Closed technical log files | Candidate for compression/rotation with retrieval | May contain sensitive values or operational evidence. Identify actual writer, open-file handling, investigation requirements, permissions, and existing retention first. No generic filesystem sweep. |
| Users, roles, permissions, API keys, configuration, credentials and pairing data | Excluded | Required for runtime/security; not historical log payloads. Never copy secrets into an archive catalog or export. |
| Backups and release rollback sets | Separate existing lifecycle; excluded | They are recovery assets, not disposable history. Preserve the paired application/database rollback process. |

## Confirmed implementation facts

- Delivery archives are files managed by
  [deliveryLogArchiveController](../controllers/deliveryLogArchiveController.js).
  Current defaults cap active storage at 5,000 files and 1 GiB, configurable
  through existing environment settings. Pagination does not remove these limits.
  The pharmacy sequence ledger must remain durable and active; archival, recall,
  and cleanup must never rewind it or reuse a reference.
- [importController](../controllers/importController.js) stores completed
  Patient import report snapshots in AuditLogs. Importers see their own reports;
  readers with Audit Log visibility can review all reports.
- [auditLogController](../controllers/auditLogController.js) currently implements
  Rotate as deletion of older audit rows, excluding Patient import report
  actions. It is not a recallable archive. Do not reuse or schedule this endpoint
  as an archival job.
- [callCenterController](../controllers/callCenterController.js) queries audit
  Called events for counts, last-call ordering, and activity views.
  [callCenterClaimService](../services/callCenterClaimService.js) checks active,
  unended call attempts before handling claims.
- [snapshotService](../services/snapshotService.js) and
  [logDashboardService](../services/logDashboardService.js) read historical audit,
  activity, and error rows. Moving those rows without adapting their readers
  would produce incomplete analytics or misleading backfilled trends.
- The full-site ZIP path in
  [backupService](../services/backupService.js) explicitly excludes
  administration/delivery-log-archives and logs. This is an intentional
  sensitive-data exclusion with a regression test, not a setting to bypass.
  The production archive backup coverage and runtime storage layout have not
  been inspected. A database dump alone cannot preserve file-based copies.

## Proposed implementation sequence and review gates

| Step | Concrete implementation | What must be reviewed before enabling it |
| --- | --- | --- |
| 1. Read-only inventory | Measure counts, bytes, growth, age bands, read frequency, existing cleanup, references, and every reader/export/backup for each candidate. Report aggregates, not patient values. | Candidate eligibility, exclusions, actual benefits; no assumed retention thresholds. |
| 2. Policy per data type | Define active age window, optional cold retention, pinned/investigation exclusions, scheduler, storage budget, and who can change policy. Disabled by default. | Archiving is separate from permanent deletion. No expiry/deletion in the initial pilot. |
| 3. Protected storage and catalog | Choose an approved location and protection/key-recovery model. Keep a small active catalog with stable ID, type, timestamp, owner/scope, content hash, size, format/renderer version, location and state. | Same access rules as originals; catalog also protected. Minimize identifying metadata. A same-disk folder saves no disaster-recovery risk; compression, not folder naming, saves bytes. |
| 4. Per-type archival adapter | Start with Delivery Logs only after approval. Create immutable, bounded archive objects; copy, checksum, and verify recall before considering removal of the active copy. | No patient/RX writes, ID changes, sequence resets, signed-content changes, or broad AuditLogs deletion. Specific eligibility and reference checks required. |
| 5. Resumable lifecycle | Persist states such as Planned, Copying, Verified, Archived, Recall requested, Ready, Failed. Lock a job/object, use bounded batches, resume after interruption, and audit each transition. | Duplicate jobs, crashes, disk-full, network loss, permission errors, and concurrent reads/writes cannot leave neither copy available. Keep source on failure. |
| 6. Archive-aware browsing | Search catalog metadata with date filters/pagination. Label Archived clearly and provide Load / Download / Reprint with loading, retry, and unavailable states. | Existing IDs/links must still resolve. Define whether broad searches include cold history by default; no silent omissions from counts. |
| 7. On-demand recall | Fetch only the requested item, verify checksum/format and current authorization, then serve a read-only copy from a restricted temporary cache. Record access and clean cache after a reviewed lifetime. | Prevent duplicate imports or writes into active business tables. Recheck current permissions and ownership. Missing/corrupt archives must fail clearly, never substitute current patient/RX data. |
| 8. Complete exports and analytics | Define active-only versus complete-history scope explicitly. Complete exports retrieve all matching archived content, with asynchronous jobs if needed; errors mark the export incomplete. | No silently truncated reports. Preserve Call Center behavior and historical totals before approving any dependent log type. |
| 9. Backup, restore, migration and rollback | Protect catalog, archive objects, sequence ledger, renderer dependencies and necessary key recovery material together through an approved protected backup path. Rehearse disaster recovery and application rollback compatibility. | Do not assume the current site ZIP covers archives. Preserve sensitive-data exclusions on general packages. A moved original may be invisible to an older binary, so older-version access/rehydration must be proven before eviction. |
| 10. Off-hours pilot and monitoring | Test synthetic data in isolation, then explicitly approve a small real batch. Limit CPU/I/O/concurrency, pause automatically on failures, and show capacity, job failures and recall latency. | Set measurable acceptance targets and a stop/recovery procedure; no broad scheduler activation on deployment. |

## Acceptance tests before any active-copy removal

1. Patient/RX data, configured RX Actions, linked operational histories, and
   pharmacy reference sequences remain unchanged.
2. The archived item recalls byte-for-byte; Delivery Log integrity checks and
   audited reprint still succeed; import reports preserve every saved field.
3. Unauthorized users cannot discover or retrieve another user's restricted
   records through search, export, direct IDs, or recalled cache files.
4. Active and archived searches have stable pagination and accurate totals;
   complete exports include matching old records, even across multiple objects.
5. Failure injection covers interruption between every copy/verify/catalog/remove
   step, concurrent jobs, unavailable storage, corruption, cache expiration,
   download cancellation, and insufficient capacity.
6. Restore from the protected backup works on an isolated environment, including
   a rebuilt catalog, original IDs, renderer compatibility and sequence ledger.
7. Rollback to the supported previous application can still access required
   history; restoring the database alone must not orphan catalog/object state.
8. Call Center queues/claims, call totals/ordering, trends, security review and
   historical exports match the pre-archive baseline for any later log pilot.

## Decisions for review

- Confirm the first pilot is Delivery Log copies only. Import reports and
  technical logs are separate later adapters, not automatic additions.
- Choose storage location and protected backup ownership; verify usable capacity.
- Choose the active window using inventory results, rather than an arbitrary age.
- Choose acceptable recall delay and temporary-cache lifetime.
- Approve who may archive, recall, change policy, and pin records.
- Keep permanent deletion disabled unless a separate retention proposal is approved.

No user decision above has been assumed. This document is the review checklist,
not an instruction to move or remove data.
