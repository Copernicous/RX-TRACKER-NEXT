RX Tracker NEXT 4.0.0-next.100
=============================

Patients > Service Date RX Validation
------------------------------------
Open beside Export CSV in Patient List. Review exact patient/service dates with
no non-deleted RX, current clinic/default pharmacy and last RX service date.
Searchable multi-select clinic/pharmacy filters include Not assigned. Service
date and last RX date bounds, dated/undated RX filters, totals, pagination and
complete CSV use Patients permissions. No dated RX means no RX has a service
date; historical/future dates require staff review. See the packaged guide.

Installation and recovery
-------------------------
Verify SHA256SUMS.txt and LOCAL_VALIDATION.json. Project Control option 8 then 15.
Require healthy next.100. No new migration since next.98 (65 total), patient/RX
rewrite, configured RX Action change or dashboard metric change. Preserve .env
and the paired application/database rollback set. Publication is not installation.

Protect external delivery/CSV archives, gzip files and receipts, renderers and
the sequence ledger. Older binaries cannot read compressed files; retain the
existing filesystem recovery guidance as well as paired database rollback.

Both executables embed verified Node.js 22.23.4. Existing source/dependency
findings and unchanged Softphone warnings remain documented.
