# Release Notes

## v2.0.37 (2026-06-24)

### What's New
- **Patient import validation tightened for workflow windows**
  - If a service date is provided and workflow dates exist, import now blocks rows where:
    - first workflow step is before service date, or
    - any workflow date is more than 90 days after service date.
  - Service date is still auto-inferred from the earliest workflow date when blank.
- **Simulation output updated for same validation logic**
  - `scripts/simulate-patient-workflow-import.js` now reports service-date/window rule failures in the same import flow.

### QA & Validation
- Kept dry-run import simulation tooling in QA for workflow scenarios.
- Continue validating with `npm run qa:web`:
  - same-date scenario
  - +1 day incremental scenario
  - inferred service-date scenario
- Verify import rejection when workflow steps violate the service-date window.

### Notes
- Versioned build is `2.0.37` in `package.json`.
- Deployment package generated for server delivery: `dist/server-update-2.0.37.zip`.
