# History archiving and automatic retention

Available in **4.0.0-next.98**. Initial retention is **30 days** per section.
Publication does not install production or move records. Install through the
guarded Project Control updater before configuring archiving.

## Configure and review

1. After an approved release is installed through Project Control, open
   **Audit Log > Automatic history archiving** as an Administrator.
2. Set **Keep recent days** for each section (1–3650 whole days). Initially all
   section switches are selected and their retention is 30 days. The global
   automatic switch starts off; installing/migrating does not move existing rows.
3. Choose the daily **Run at hour (UTC)** (default 06:00 UTC), enable daily
   automatic archiving when ready, and **Save settings**. The policy survives
   restarts. `HISTORY_ARCHIVE_SCHEDULER_ENABLED=false` suppresses the scheduler in
   an isolated copy or maintenance process without changing the saved policy.
4. **Preview / archive** shows the eligible count and cutoff using the saved
   retention. Confirming moves a bounded batch. Repeat manually for a backlog;
   automatic jobs process another bounded amount each day.
5. Use **History storage: Active / Archived / All** on Audit Log or Import File
   Management to review older records. Audit Log's choice also applies to Page
   Activity and Error Log. Existing history/report access and driver-history
   restrictions still apply. Import correction files remain owner-scoped.
6. Open archived reports or download original/corrected CSVs using their existing
   controls and IDs. Viewing does not reinsert rows into active storage. Existing
   complete reports and analytics read both stores.

The schedule checks once per minute and runs once per UTC date at/after the chosen
hour while the server is running. A restart after that hour catches up if that
day has not been claimed. A persistent daily claim prevents duplicate automatic
jobs across processes/restarts. Failed/interrupted jobs are visible in **Last
automatic run**; retry manually or allow the next day's run. An interrupted
claim may remain `running` until the next day; it never authorizes deletion of
uncommitted rows. There is no permanent archive-expiry job.
Automatic batches recheck the policy under the transfer lock; disabling a section
or changing its retention stops its remaining batches at the next batch boundary.
Manual runs use the retention confirmed for that operation.

## What moves

| Section | Selection and protections | Per invocation |
| --- | --- | --- |
| Audit events | Older events except Data Import, History Archive receipts, Call Center modules, Called actions, and events referenced by call attempts | Up to 2,500 rows in batches of 250 |
| Completed import reports | Old `Patient import report` snapshots, including captured original/corrected files and source-row evidence | Up to 100 reports in batches of 10 |
| Completed correction files | A source file whose every item has a resolution; moves source, revision and resolution rows together | Up to 10 groups; each group at most 250 rows |
| Page activity | Old visits whose creation and last modification are also old | Up to 2,500 rows in batches of 250 |
| Resolved errors | Resolved old errors whose last modification is also old | Up to 2,500 rows in batches of 250 |

Cutoff = the job's starting instant minus X × 24 hours, using absolute timestamps.
Rows exactly at or after the cutoff stay active. `createdAt` and `updatedAt` must
also be strictly older than the cutoff; Page Activity additionally checks
`visitedAt`. Newly inserted/changed rows are therefore protected even if a
historical event date was supplied. For corrections, **every** revision and
resolution must also be old. Pending items, recent resolution activity and very
large correction groups remain active. The manual section archive does not use
the screen's search filters. Explicit Delete Selected / administrative purge
operations remain separate destructive operations against active storage.

Patients, RX records, workflow histories, delivery copies, call attempts, service
cycles, medications, notes, documents, configurations, backups and paired rollback
sets are not rotated by this feature. Operational call audit records stay active.

## Where archives reside and how to export them

Database rows remain **inside the same configured PostgreSQL database**, in:

- `AuditLogsArchive` — audit events, completed import reports and correction groups.
- `UserActivityLogsArchive` — older page activity.
- `ErrorLogsArchive` — resolved older errors.

The original tables hold active data. Read-only `*History` views combine active
and archived rows. Archived IDs, timestamps, JSON types and file bytes are
preserved. These are database archives, not external cold-storage files; full
database dumps include them automatically. Back up and protect the database as
before and rehearse restore. No archive `.env`, credentials or secret is created.

Administrators can use **Browse downloads** per section to see numbered export
pages, record ranges, total pages, download attempts and pending pages. Use
**Previous page**, **Next page**, the page number / **Go** control, or **Go to next
pending** to move around. Navigation does not download anything. Each page has
its own **Download page N** / **Download page N again** button.

The heading shows the oldest/newest dates in the entire archive. **Event dates**
shows the oldest/newest included timestamp for each displayed download page,
using the configured application timezone (normally America/New_York). Activity
uses `visitedAt`; other sections use `createdAt`. These are event/import dates,
not the time the archive was created or the file downloaded. Pages retain stable
ID ordering, so backdated records can make page date ranges overlap; a range is
not a claim that its page contains every event within those dates.

Downloads are gzip-compressed JSON with original records, format version, UTC
export time, numbered page/total/range, archive revision and a SHA-256 manifest.
Filenames include section, `YYYY-MM-DD_to_YYYY-MM-DD` for the included records,
revision and `page-N-of-total`. Manifests preserve exact UTC first/last timestamps,
the date field used and display timezone, as well as the whole archive's period.
Imports/corrections
export one row per page because their payloads can contain whole CSV files;
audit/activity/error pages contain at most 250 rows. One correction group's rows
can span pages: retain every page for complete external analysis. These downloads
can contain patient information and require the same protection as the database.

**Download started** records that the app successfully retrieved a page and asked
the browser to save it. Check browser Downloads to confirm the file was saved;
the app cannot verify its final filesystem location or whether the browser
cancelled/blocked saving. **Pending** means no such attempt is recorded for that
page in the current browser/site/account/database/archive revision. Downloads
made before these controls were added are not marked retroactively.

Progress and the current page survive refresh through browser local storage.
Only section/user/database-scoped opaque keys, revision, page numbers and attempt
flags are saved; no patient records or credentials are stored there. Another
account/database has separate progress. Clearing browser storage removes progress
markers, not archive records or files already saved. If browser storage is
unavailable the UI explicitly labels progress as temporary.

Pages are bound to an archive revision. If another archive transfer commits
during a multi-page download, the next page fails explicitly and asks you to
refresh that section's archive pages. The updated revision starts fresh progress;
previously saved files remain untouched. This prevents silently missing delayed
lower-ID rows. Pause automatic processing and avoid manual transfers while
downloading large archives; retain a complete set of pages from one revision.

Decompress with a standard gzip utility and open JSON in a suitable viewer. The
manifest hash is SHA-256 of the UTF-8 bytes of JavaScript
`JSON.stringify(packet.records)`. For a spreadsheet-friendly export of audit or
activity data, select **Archived** or **All** and use the existing **Export**
control. There is no arbitrary archive-file upload into business tables; the
database archive is already browsable without reload. Recover a lost database
archive from its database backup into an isolated copy using
[TEST_COPY_RESTORE.md](database/TEST_COPY_RESTORE.md).

## Transfer safety, backup and rollback

Each batch obtains a PostgreSQL advisory lock and row locks, copies rows into
the archive, compares every field using `to_jsonb`, removes exactly the verified
source IDs, and writes an audit receipt in **one transaction**. Receipt failure,
copy conflict, verification failure, statement timeout or process termination
rolls back that batch. Earlier committed batches remain available in the archive.
Locked rows may be skipped until a later run; concurrent new events are not
selected. Never treat a zero-row run as proof that every protected/locked row
has been moved. Manual and automatic archiving share the lock.

The new audited migration creates storage/views only. Web startup remains
check-only, requires the migration, and does not create schema objects. Runtime
role configuration grants the new tables/views through the existing guarded
lifecycle process. Archive model writes are blocked; no archive-delete API is
provided. Sanitization covers both stores and removes inherited archive policies
and scheduler receipts from isolated sanitized copies.

Before production installation retain the paired application/database rollback
set through Project Control. An older binary does not know the history views;
reverting application files alone would omit archived events. Use the supported
paired rollback process. The migration's down operation refuses to drop populated
archives. Do not manually reverse it or merge archive rows into production.

## Technical access/error log files

With `LOG_FILE=true`, technical logs use UTC-dated filenames under
`<writable root>/logs` (normally next to `server.exe`, or `APP_WRITABLE_ROOT`).
`LOG_RETENTION_DAYS` defaults to **30** and must be a whole number from 1–3650.
These settings are independent of the per-section database settings above.

The logger opens the new UTC day's files on its next write or minute check. At
startup and daily rollover it streams eligible closed `access-YYYY-MM-DD.log`
and `error-YYYY-MM-DD.log` files into `logs/archive/<original>.<sha256>.gz` one at
a time, flushes the archive, verifies decompression against the source hash, then
removes the old uncompressed copy. Retention uses modification time. Recent and
current open files stay in place. Changed/corrupt/unverified files retain their
source. Archives have no expiry. NSSM service-output logs remain separately
managed; there is no generic sweep of unrelated log files.

Open a `.gz` with a standard archive utility and extract the original text for
analysis; it is not a database Audit Log and is not imported into the app. The
filename's hash verifies the uncompressed original. Protect and back up this
folder separately: the general site ZIP intentionally excludes logs, and database
backups do not contain filesystem logs. Do not remove that sensitive-data exclusion.

## Expected database benefit

Default browsing reads smaller active tables and recent indexes. Complete-history
queries still read both stores. Total database data and full dump size do not
shrink merely because rows move between tables. PostgreSQL autovacuum reuses dead
row space; do not schedule blocking `VACUUM FULL` as part of archiving. Measure
query latency, active table/index size, I/O and backlog on the installed system
before claiming a performance improvement. See PostgreSQL's
[routine vacuuming documentation](https://www.postgresql.org/docs/17/routine-vacuuming.html).

## Local validation

- 13 dedicated PostgreSQL integration scenarios: strict boundaries/invalid input,
  payload preservation, protected rows, completed correction grouping, original
  import downloads, permissions, rollback injection, concurrency lock, checksum
  exports, persisted scheduling, migration-down refusal and technical compression.
- Existing importer/file-management, call-attempt/pagination, report, dashboard,
  profile-sync, driver-history permission, delivery archive and health regressions.
- Fresh provision; legacy adoption without archive objects, then migration and
  schema verification; custom dump/restore with archive views; archive sanitization;
  actual restricted runtime transfer and view/status access.
- Browser controls checked using synthetic responses with Playwright; this was
  not a live authenticated deployment or a production-data browser test.
- The full release harness stopped at the pre-existing high Multer advisory
  (GHSA-q7qp-rjg7-q26m). The gate is preserved; no release or deployment is ready
  solely on the basis of these scoped tests. No dependency changes made here.

Synthetic local evidence is ignored under `output/history-archive-validation`;
the UI screenshot is under `output/playwright/history-archive-controls.png`.
