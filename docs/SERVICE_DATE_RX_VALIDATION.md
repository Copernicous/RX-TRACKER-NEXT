# Service Date RX Validation (4.0.0-next.100)

Open **Patients > Service Date RX Validation** (beside Export CSV in Patient List).
The full-screen validation view now lives in Patients instead of Reports.
The default **Only pending RX**
view finds patient service dates with zero non-deleted RX records for that
patient and date. Use this list to investigate why no RX was created. It does
not infer a reason, measure workflow completion, or automatically create RX.

- Search by patient name or Patient ID and optionally bound the service date.
- Select multiple current clinics and default pharmacies using searchable
  checkbox dropdowns, including Not assigned alongside named assignments.
  No selections means All; Clear selection restores All. Selected values match
  any choice within a filter, with both filters applied together. Pagination and
  complete CSV preserve the same selections.
- Last RX service date shows the maximum service date across all non-deleted
  RX for that patient, independent of the service-date range above. It is not
  necessarily before the missing service date. Filter its inclusive From/To
  range or choose Has RX service date / No RX service date. No dated RX includes
  patients whose existing RX records have no service date; it does not mean
  that no RX record of any kind exists. Deleted RX never provide this date.
- Assigned clinic and pharmacy columns show the patient's current clinic and
  default pharmacy in the table and CSV. Missing assignments show Not assigned.
- Select **All service dates** to review dates with and without RX together.
- Each row is one distinct patient/date. Multiple RX on one date cannot satisfy
  another date. Patient totals cover the selected date range before filtering
  by RX status; the summary above the table covers the displayed filter.
- Includes active and inactive patients, excludes deleted patients. Deleted RX
  do not satisfy a date. Future service dates are included unless filtered out;
  a missing RX is a review finding, not proof that it is overdue.
- Uses retained service-date cycles, previous/new date history, current patient
  dates and RX dates. It cannot recover dates absent from all retained sources.
  A historical correction can retain a date that staff should assess in context.
- CSV exports every matching date, including later pages and the last RX date,
  using Patients export permission. Viewing and filter options use Patients read
  permission. The endpoints are `/api/patients/service-date-validation` and
  `/api/patients/service-date-validation/export`.

The report is read-only with no schema migration, cycle synchronization, RX
creation, patient update or production release. Import backups only through the
guarded isolated test-copy workflow in `database/TEST_COPY_RESTORE.md`; production
installation remains separate. A running source server needs a normal restart
to load the new API routes, then refresh Reports.

Validation: `npm run test:service-date-report` executes the real report SQL
against synthetic connection-local PostgreSQL TEMP tables with rollback and
connection closure. It uses the existing safe staging configuration and does
not modify business tables. `npm run test:report-view-render` verifies the EJS.
