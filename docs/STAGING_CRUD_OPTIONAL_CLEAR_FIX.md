# Staging Note: CRUD Optional Field Clear Fix

Date: 2026-06-30
Branch: develop
Environment: staging only

## Purpose

Clinics and Pharmacies could not reliably save optional fields back to blank. The shared CRUD form skipped empty string values, so clearing Address, Phone, Contact Person, or Notes did not send that field to the API and the old database value stayed in place.

## Change

- Generic CRUD saves now send intentionally cleared optional fields as `null`.
- Required fields are validated before saving from the modal.
- Clinic and Pharmacy API updates now reject blank required names instead of silently keeping the old name.
- Clinic and Pharmacy optional text fields are normalized to `null` when cleared.

## Staging Test

1. Open `/clinics` and edit an existing clinic.
2. Clear Address, Phone, Contact Person, and Notes.
3. Save and reopen the record.
4. Confirm those optional fields remain blank.
5. Repeat the same flow on `/pharmacies`.
6. Try clearing the required Name field and confirm the save is blocked with a required-field message.
