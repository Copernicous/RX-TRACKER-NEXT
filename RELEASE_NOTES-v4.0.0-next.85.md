# RX Tracker NEXT v4.0.0-next.85

Patient imports now review possible duplicates before saving and support selected-field merges into existing patients.

## Import and merge

- Review shared phones, same names with different DOBs, and matching address plus name, including deleted/inactive patients and rows in the same CSV.
- Choose import as a separate patient, discard, or merge into an existing patient. Matching name/DOB or Patient ID cannot create another patient.
- Compare existing, incoming, and final values. Keep existing values, fill empty fields, or explicitly override selected fields including DOB and phone. Notes can be appended; blank incoming values never erase data.
- Deleted/inactive targets require explicit restore/reactivate confirmation. The same patient ID is retained and linked hidden RX records are restored, following existing restore behavior.
- Download detailed reports immediately or later from Import History. Reports retain the values recorded at import time; routine audit rotation preserves them.
- Manual patient creation also checks possible duplicates and blocks identical name/DOB.

## Production update

Install through Project Control option 8, then option 15 using the official verified release ZIP. Preserve the paired application/database rollback set and wait for the green health check.

No database migration is added. Installation does not merge, restore, delete, or deduplicate existing patients automatically. Patient changes occur only through an operator's confirmed action. Configured RX Actions are not modified.

Final import saves use a short patient table write lock; other patient writes can briefly wait. Reports retain patient field values in the audit database and follow its backup/access controls. Privileged explicit audit deletion can remove historical reports.

Validation includes synthetic duplicate/manual-create regressions and isolated PostgreSQL merge, permission, stale-review, service-date, report-history, restoration, and rollback tests. Operator review accepted the staging merge flow.

## Dependency maintenance

The lockfile updates Multer to 2.3.0, Nodemailer to 9.1.1, Morgan to 1.12.0, and qs to 6.16.0 within existing compatible version ranges. The high-severity audit gate passes. A moderate uuid advisory remains through Sequelize; the suggested forced database-library downgrade is not applied.
