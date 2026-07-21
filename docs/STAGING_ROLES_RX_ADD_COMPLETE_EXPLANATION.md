# Staging Roles RX Add / Complete Explanation

Date: 2026-06-30

## Change

Clarified the RX Records row in Roles:

- The editor now labels the RX workflow permission as `Add RX / Complete`.
- The RX Records `Add New` cell now points admins to `Add RX / Complete` instead of showing only a dash.
- The modal includes a short note explaining that adding RX records and completing RX workflow steps are currently controlled by the same permission.
- The role overview legend now includes the same clarification.

## Behavior

No permission behavior changed.

`rx_records.canAdd` still controls both:

- adding new RX records
- completing RX workflow steps

## Backup

Pre-change backup:

`backups/pre-change/roles-rx-add-complete-explanation-20260630-121733.zip`
