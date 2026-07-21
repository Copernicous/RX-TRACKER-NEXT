# Staging Remove Patient + RX Toolbar Shortcut

Date: 2026-06-30

## Change

Removed the redundant Patient List toolbar button labeled `Add Patient + RX`.

The Patient modal still keeps `Save & Add RX`, which is the preferred flow because it is available after entering the patient details and also supports the service-date-change workflow.

## Reason

The toolbar shortcut opened the same Add Patient modal and only focused the `Save & Add RX` button. That duplicated the existing in-modal action and added permission/UI confusion without creating a separate workflow.

## Backup

Pre-change backup:

`backups/pre-change/remove-patient-rx-toolbar-shortcut-20260630-121631.zip`

## Validation

- Patient List toolbar shows `Export CSV` and `Add Patient`.
- Patient modal still shows `Save & Add RX` when the user has both Patients Add and RX Records Add/Complete permission.
- `Save & Add RX` still saves the patient and redirects to RX Records with `addRx=1`.
