# Audit Log rotation review

Historical review of the original purge behavior. The user subsequently authorized
implementation and selected 30 days. See [HISTORY_ARCHIVING.md](HISTORY_ARCHIVING.md)
for the unreleased replacement; the findings below describe the prior code.

Reviewed 2026-10-27 against the current workspace (next.97). Source review and
capture-only synthetic controller checks; no live database or installed server
inspection, rotation, deployment or release performed.

## Current behavior

- Events reside in PostgreSQL `AuditLogs`, not in a rotating audit file.
- An Administrator manually presses **Rotate Logs**. The UI offers 30, 60,
  90 (default), 180 or 365 days. The choice is sent for that operation; it is
  not a persisted automatic retention policy. No Audit Log rotation scheduler
  was found in the source.
- `POST /api/audit-logs/rotate` calculates a cutoff by subtracting the supplied
  number of calendar days from the server's current date/time. It permanently
  deletes rows whose `createdAt` is strictly earlier than that cutoff. Rows at
  the cutoff or newer stay in the active database for valid positive values.
  Server-local calendar arithmetic can differ from exact 24-hour periods at DST.
- Four actions are excluded: `Patient import report`, `Patient import correction
  file`, `Patient import correction revision`, `Patient import correction resolved`.
- Rotation does not apply the Audit Log screen's user, module, action or date
  filters. It applies across eligible audit rows in the database.
- It writes no archive, manifest, checksum, or pre-rotation backup. There is
  consequently no rotation archive directory and no reload/import control.
- Audit Log **Export** downloads matching accessible rows as CSV to the browser's
  download destination, including previous/new JSON values. It exports all
  matching rows rather than only the visible page. This is a separate manual
  export, not a verified archive or a supported restore format. Dates/times are
  formatted in the browser locale without an explicit timezone column.

Evidence: `controllers/auditLogController.js:146`, `routes/apiRoutes.js:531`,
`public/js/audit-log.js:484`, `public/js/audit-log.js:846`,
`public/js/audit-log.js:926`, `views/audit-log.ejs:131`.

## Findings

1. **High: retention is not validated by the server.** `parseInt(days)` accepts
   zero, negative and partially numeric values. A negative number moves the
   cutoff into the future and can delete recent events; zero provides no recent
   retention window. The dropdown restricts ordinary UI use, but direct API
   requests can bypass it. Validate a bounded positive integer before any
   selection or mutation; invalid input must fail without deleting anything.
2. **High: older evidence cannot be recalled after rotation.** The implementation
   is a purge. It does not satisfy archive-and-review requirements.
3. **High: age alone does not establish safe removal.** Call Center reads `Called`
   events for history/counts/last-call data; log dashboards and snapshot generation
   read AuditLogs too. These events are not among the four exclusions. Deletion
   can shorten operational history and change historical analysis. Classify all
   readers and keep dependent rows active until archive-aware behavior is proven.
4. **Medium: rotation has no dedicated audit receipt.** The controller does not
   create an audit record and its route does not attach `auditLogger`. The Help
   text in `public/js/help.js:138` claims that rotation records who performed it;
   that claim is unsupported by this path. Record actor, cutoff, counts, archive
   identity, integrity result and outcome for any replacement implementation.

## How to review older events today

Before rotation, use Audit Log filters and **Export** to download a CSV for
external analysis. Verify the export and protect it according to its contents;
it may contain patient information. The app cannot reload that CSV.

If rotation already deleted rows, a database backup taken before deletion may
contain them. Restore that backup into a separately named isolated test copy
using the guarded process in `database/TEST_COPY_RESTORE.md`, then review/export
from that isolated environment. Do not replace the live database merely to
review old events. A backup may not include events written after its capture.
Without a prior export or suitable backup, this feature provides no recovery.

## Required replacement behavior

The user's requirement is to retain the newest **X days** in the live Audit Log
and preserve eligible older events for later analysis. X has not been selected;
90 days is the existing UI default, not an approved archival policy.

1. Display and validate X and one precise cutoff before starting. Define the
   timezone and calendar-day versus elapsed-hour rule. Always keep timestamps
   at/after the cutoff, concurrent new events, protected import records and
   operationally required events active.
2. Preview eligible counts/date bounds and exclusions. Archive only classified
   eligible old events, with no archive expiry or permanent deletion by default.
3. Preserve original IDs, UTC timestamps, payloads, user attribution and a schema
   version in a durable archive. Include a readable CSV companion plus a manifest
   with counts, date range, source identity and SHA-256 checksums. Preserve JSON
   types and raw content in the canonical format.
4. Use an explicitly configured protected storage destination with verified
   backup coverage. No audit archive location exists or is selected today.
   General site ZIPs exclude logs; do not assume they back up future archives.
5. Verify a complete durable archive and successful readback before any active
   row removal. Use a crash-safe, bounded process targeting exactly the archived
   rows. Failures must leave the active source available. Check operational
   dependencies before permitting removal, regardless of age.
6. Support external read-only analysis first, consistent with the earlier
   preference in `HISTORY_ARCHIVAL_REVIEW.md`. If in-app recall is selected later,
   provide a separate read-only archive viewer with current access checks and
   integrity verification. Do not insert old events into live business tables
   simply to view them. Reports must clearly define active/archive coverage.

This review does not implement or enable archival, source removal, or scheduling.

## Validation performed

Executed the real controller in a Node VM with a fixed synthetic clock and a
capture-only `AuditLog.destroy` mock. Confirmed the positive 90-day cutoff uses
strict older-than selection, preserving recent and exact-boundary timestamps,
and retains all four import exclusions. Reproduced acceptance of `-1`, `0` and
`30junk`; `-1` selects current timestamps for deletion. No database module was
loaded and no records were changed. Actual PostgreSQL lifecycle, archive failure,
restore, authorization and concurrency tests remain necessary for implementation.

## Separate technical logs

`app.js:105` implements optional `LOG_FILE=true` logging under
`<writable root>/logs` (normally next to `server.exe`, or `APP_WRITABLE_ROOT`).
It opens `access-YYYY-MM-DD.log` and `error-YYYY-MM-DD.log` at startup and removes
`.log` files based on modification age at startup using `LOG_RETENTION_DAYS`
(default seven). The open streams do not roll over automatically at midnight.
This is independent of database Audit Log rotation and creates no archive.
NSSM has separate service-output rotation configuration in the installer; it
does not archive or reload AuditLogs.
