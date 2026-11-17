RX Tracker NEXT 4.0.0-next.101
=============================

Service Date RX Validation and dashboard clarity
-----------------------------------------------
Patients > Service Date RX Validation now has clickable patient/date summary
tables, automatic and removable filters, patient status/RX-history/date-coverage
filters, sorting on every detail column, and top pagination up to 1,000 rows
with numbered pages and page jump. CSV preserves filters and global sorting.
The responsive filter grid has aligned columns and uniform 40px controls.

The dashboard Active patients: no RX card counts active, non-deleted patients
with zero non-deleted RX across all dates, including undated RX. It reads live
data and ignores the dashboard date selector. Its info icon explains the scope
and links separately to dates missing RX on patients with earlier records.

Installation and recovery
-------------------------
Verify SHA256SUMS.txt and LOCAL_VALIDATION.json. Project Control option 8 then 15.
Require healthy next.101. No new migration since next.98 (65 total), patient/RX
rewrite or configured RX Action change. Preserve .env and the paired application/
database rollback set. Publication is not installation.

Protect external delivery/CSV archives, gzip files and receipts, renderers and
the sequence ledger. Older binaries cannot read compressed files; retain the
existing filesystem recovery guidance as well as paired database rollback.

Both executables embed verified Node.js 22.23.4. Existing source/dependency
findings and unchanged Softphone warnings remain documented.
