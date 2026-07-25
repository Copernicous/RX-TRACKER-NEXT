# RX Tracker NEXT 4.0.0-next.22

This candidate adds safe RX Softphone line retirement and repository security
automation. RX Softphone remains version 0.6.0.

## Administrator phone-line retirement

Under **Administration -> Phone Devices**, each enabled phone assignment now
has two separate controls:

- **Revoke device** invalidates only the paired Windows workstation. The SIP
  assignment remains available for a replacement pairing.
- **Retire line** disables the user's SIP assignment, revokes any paired
  workstation, and removes the disabled assignment from **Live RX Phones**.

Retirement is blocked during an active call. It preserves call-attempt
history, audit records, patients, RX records, and the disabled phone-account
row. An Administrator can later authorize that user to run Phone Account Setup
again and replace the retired assignment.

For a shared extension such as 1006, retire the assignment for each user who
will no longer use that extension. Other users assigned to the same extension
are not changed automatically.

## Dependency security automation

- Dependabot checks npm packages and GitHub Actions weekly and opens proposals
  against `staging`.
- Pull requests receive a dependency review that blocks new high or critical
  findings.
- CodeQL scans JavaScript and RX Softphone C# on branch changes and weekly.
- A separate weekly workflow runs the high-severity npm audit and dependency
  policy regression.

See `docs/DEPENDENCY_SECURITY_MAINTENANCE.md` for the administrator workflow.
Production is never updated automatically.

## Database impact

None. This release uses existing account/device status fields and introduces
no schema migration or business-data rewrite.
