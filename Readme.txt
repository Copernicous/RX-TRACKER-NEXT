Patient RX System v2.0.73
=========================

Production Release: Patient CSV Notes Export

This package includes every production improvement through v2.0.73. The main
update in this release is that Patient List CSV exports now include patient
notes.

Included improvements
---------------------

v2.0.73 - patient CSV notes export
- The Patient List CSV export column selector now includes Notes.
- The Notes column includes the main patient record notes.
- The Notes column also includes all separate Patient Notes modal entries.
- Multiple notes are combined into one CSV cell using " | " between entries.
- Note date and author context are included when available.
- Full note text is loaded only for full Patient List export requests, so normal
  Patient List loading remains lightweight.

Database impact
---------------

- No destructive schema changes are included.
- No production data reset is included.
- Existing patients, patient notes, RX records, users, roles, permissions,
  settings, backups, audit logs, and changelog data are preserved.
- This release changes CSV output only; stored patient and note data are not
  modified.

Production verification
-----------------------

After installing this package:

1. Confirm /api/version shows 2.0.73.
2. Login and open Patients.
3. Open the Patient List Export CSV column selector.
4. Confirm Notes appears as an exportable column and is selected by default.
5. Export a patient with main record notes and multiple Patient Notes entries.
6. Confirm the CSV keeps that patient on one row and combines notes in the
   Notes column.
7. Confirm Patients still loads normally and note-count badges still display.

Production package
------------------

- Deploy dist/server-update-2.0.73.zip or approved dist files only.
- Keep the production .env unchanged and next to server.exe.
