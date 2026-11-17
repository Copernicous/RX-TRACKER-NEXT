# Service Date RX Validation

Updated in 4.0.0-next.101:

- Two collapsible, clickable summary tables distinguish service dates from
  unique patients. Available counts apply base filters (search, service/last-RX
  dates, assignments, patient status and focused patient). In current list also
  applies RX status, RX history and date coverage. Both count all matching pages.
  Patients without any retained date are absent from this validation view.
- RX history distinguishes zero non-deleted RX ever from patients with any RX,
  including undated RX. Date coverage classifies dates in the selected range as
  only pending, mixed, or only with RX, before quick filters. History and coverage
  categories overlap; do not add the two classifications together.
- Changing a filter runs validation automatically. Summary rows/counts filter
  the list. Detail values open a read-only popup: patient ID/name, clinic,
  pharmacy and status show patient information and all RX; a service date, RX
  count/status or last RX date shows RX for that exact date. Date totals open
  retained dates in the report range; pending totals show only pending dates.
  Removable filter buttons and Reset broaden the main list.
  Filter fields use six aligned columns in two rows on desktop, with fewer
  columns on smaller screens. Search, date inputs, native selects and
  multi-select dropdown buttons share a consistent 40px height.
- Popups preserve the main filters, sort, page and scroll position. Close or
  Escape returns focus to the selected cell; Escape closes only the popup.
  Switch among patient/all RX, selected date and service dates in range. RX
  lists page in batches of 25 and show arrival date, RX pharmacy, active workflow
  progress and expandable medication names/quantities. Exact-date empty states
  explain missing RX without treating older records as covering the date.
  Explicit Filter report buttons optionally narrow the underlying report.
  Patient information requires Patients read permission; RX detail additionally
  requires RX Records read permission. Deleted patients/RX are excluded, including
  legacy NULL deletion flags consistently. No cycle synchronization or write
  occurs. The endpoint is `/api/patients/service-date-validation/details/:id`.
- Every detail column sorts on the server across the whole matching list.
  Pagination above the detail grid offers 10/20/50/100/250/500/1000 rows,
  numbered pages, first/last and a page jump. CSV uses the same filters and sort
  and exports all pages. A stale asynchronous response cannot replace newer data.
- Dashboard **Active patients with zero RX records** is a live count of active,
  non-deleted patients with no non-deleted RX at any date. Legacy NULL deletion
  flags and undated RX count as existing RX. The dashboard date selector does
  not limit this explicitly all-history card or its matching patient drilldown.
  It includes patients with no assigned service date. It does not measure missing
  RX for later service dates on patients with earlier RX. A separate link opens
  pending service-date validation. Historical trends retain their snapshot scope.
  The compact card is labeled Active patients: no RX. Its info icon reveals
  the definition and validation link on hover, click or keyboard focus.

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
to load the updated controllers, then refresh Patients or Dashboard.

Validation: `npm run test:service-date-report` executes the real report SQL
against synthetic connection-local PostgreSQL TEMP tables with rollback and
connection closure. It uses the existing safe staging configuration and does
not modify business tables. `npm run test:report-view-render` verifies the EJS.
