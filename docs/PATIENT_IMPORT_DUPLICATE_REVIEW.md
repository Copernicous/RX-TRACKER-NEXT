# Patient CSV duplicate review

This is an unreleased source candidate. Production remains on its installed
official release until staging acceptance and the normal release process.

## Import behavior

Preview & Validate sends the CSV for server validation without saving patient,
RX, tag assignment, service-date history, or audit records. Any blocking error
aborts the whole file. After duplicate review, all selected rows save together;
explicitly skipped warning rows are excluded.

| Comparison | Result |
| --- | --- |
| Same first name, last name, and DOB | Cannot create another patient; merge into a database match or discard |
| Existing/repeated Patient ID | Cannot create another patient; merge into a database match or discard |
| Same first and last name, different DOB | Review warning |
| Same usable US phone number | Review warning; shared household numbers can be legitimate |
| Same address and matching first or last name | Review warning |
| Same address only, clinic, transport, Region, or Patient Tag | No warning from that field alone |

Names ignore case and repeated/leading/trailing whitespace. US phone comparison
ignores punctuation and an optional leading 1; blank, short, and repeated-digit
placeholder phones do not match. Address comparison keeps apartment/unit text,
uses street plus ZIP (or city/state), and falls back to a populated full address.
It is a conservative comparison, not fuzzy address or spelling matching.

Checks include inactive and deleted database patients and prior CSV data rows.
CSV row numbering starts at 2; a quoted multiline field remains one data row.
DOB accepts MM/DD/YYYY or YYYY-MM-DD, validates calendar dates, and rejects
future dates. The software never guesses or corrects a DOB.

The review popup shows each incoming patient, potential matches, and reasons.
Each flagged row requires Import, Merge, or Discard. Import is unavailable for
matching name/DOB or Patient ID. Merge requires Patient Edit permission and an
explicit database target. Same-file matches cannot merge into an unsaved row.
Unflagged rows remain selected; all selected changes commit together.

For each merge field, choose Keep existing, Fill if empty (default), or Use
incoming; Notes also offers Append. Supported fields include names, DOB, phone,
address as one group, notes, clinic, transport defaults, and service date.
Blank incoming values never erase existing data. Service-date eligibility and
Region rules still apply. Existing Patient ID and RX workflow history remain.
Multiple incoming rows cannot merge into the same patient in one operation.

Deleted/inactive matches are labeled. Selecting them requires an unchecked-by-
default confirmation to restore/reactivate and merge. This makes the same patient
active and restores linked hidden RX records, following existing restore behavior.
Cancellation or discard leaves the patient deleted/inactive. Restoration, profile
changes, RX restoration, and reports roll back together if any write fails.

Completed imports save a detailed snapshot with CSV row, action, patient ID,
operator, time, field choice, original/incoming/final values, and restoration
status/RX count. Download CSV immediately or later from Import History. Later
patient edits do not change past reports. Importers see their own reports; users
with Audit Log visibility can review all reports. Routine audit rotation excludes
these snapshots; explicit privileged audit deletion still removes them. Reports
contain sensitive patient data and belong in the database backup/retention plan.
Older imports without a saved snapshot cannot have reports reconstructed.

Manual patient creation uses the same comparisons, including inactive/deleted
patients. Matching name and DOB returns a non-overridable server error. Possible
matches return a review popup showing names, DOBs, phones, addresses, status, and
reasons. **Cancel ? Go Back** saves nothing; **Reviewed: create separate patient**
resubmits the captured form with a signed review token. A changed payload, user,
or matching patient requires another review. Patient creation, tags, service-date
context, and override audit share one transaction. Existing patient editing is
outside this change.

## Save safeguards

The server revalidates every submitted file, including direct API requests.
Warnings require a signed review token bound to the exact file, importer, and
current matches. Tokens expire after 15 minutes; a process restart or changed
matches requires review again. Tokens are not stored in browser persistence.

Final patient identity checks and writes run in one transaction under a
SHARE ROW EXCLUSIVE lock on Patients. The lock ends before any response asking
for human review. Concurrent patient writes can wait during this short final
save phase. Both CSV import and manual creation take this lock. This is not a new database
identity unique constraint; existing-patient editing is unchanged.

Confirmed warnings are audited inside the import transaction with user, time,
row references, decisions, patient IDs, reasons, and selected field changes.
Detailed report snapshots intentionally retain the compared patient field values.

## Validation

- `npm run test:patient-import-duplicates`: synthetic model/controller harness;
  no database configuration loaded. Covers no-write preview, exact and file
  duplicates, warning overrides, blank fields, household phones, apartment
  differences, changed-file/user/matches/expired tokens, final identity recheck,
  audited confirmation, future/invalid DOBs, multiline CSV, and HTML escaping.
- `npm run test:patient-create-duplicates`: passed synthetic controller tests for
  manual warning, hard block, token binding, audit, and transactional rollback.
- Import regression additionally covers skip-one, skip-all, same-file skips, and
  rejection of skips without review or of unflagged rows.
- `npm run check:public-js`: passed.
- `npm run staging:check`: passed; does not start a server.
- Playwright with local synthetic controller fixtures: initial import review,
  cancel/confirm, skipping one flagged row while importing an unflagged row,
  skipped-row results, and manual create warning/confirmed creation passed.
- Live staging import guard and cycle-context smoke tests passed on 2026-09-10
  after the isolated database reached 64 migrations with a verified checksum
  ledger. The earlier duplicate-warning server is running at localhost:3100; see runtime limitation below.
- Eleven synthetic CSV fixtures and setup instructions are in
  `output/patient-duplicate-test-kit.zip`. Files 07-11 cover deleted/inactive
  patients. Import 07 and manually delete/inactivate only those synthetic rows
  before testing 08-11; CSV upload itself does not delete patients.
- `npm run staging:patient-import-merge`: live isolated staging tests passed for
  field choices, exact merges, stale review, permission checks, rollback,
  service-date rules, mixed create/merge/discard, saved historical reports,
  explicit restoration, linked RX restoration, and restoration rollback.
- Staging was restarted on explicit user approval on 2026-09-10. Current code
  runs at localhost:3100. Browser merge review, target/field selection, cancel,
  and opening Import History passed. Restore UI and full browser save/download
  acceptance remain pending; these backend paths have integration coverage.
- For a fresh exercise use `output/patient-merge-fresh-test-kit.zip`: six CSVs,
  new identities and contact values, baseline not yet imported. Existing staging
  records remain intact. Follow START_HERE and import file 01 only once.
- Operator acceptance remains required before promotion. Follow
  `STAGING_WORKFLOW.md`.

Potential later enhancement: conservative spelling-variation suggestions. Name
and address comparisons remain deterministic to limit false alarms.
