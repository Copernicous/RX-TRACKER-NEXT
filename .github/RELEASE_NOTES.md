# Release Notes

## v2.0.36 (2026-06-24)

### What's New
- **Import template simplification**
  - Patient import now has one clear CSV template download action.
  - The template includes headers plus one example row so users can start immediately.

- **Patient import workflow behavior preserved**
  - RX workflow date columns continue to auto-create matching RX tracking history entries.
  - Completed step dates are kept in order and marked as completed.
  - Patient names are normalized to uppercase during import.

### QA & Validation
- Kept dry-run import simulation tooling in QA for workflow scenarios.
- Continue validating with `npm run qa:web`:
  - same-date scenario
  - +1 day incremental scenario
  - inferred service-date scenario

### Notes
- Versioned build is `2.0.36` in `package.json`.
- Deployment package generated for server delivery: `dist/server-update-2.0.36.zip`.

