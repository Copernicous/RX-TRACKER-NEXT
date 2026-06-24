# Release Notes

## v2.0.35 (2026-06-24)

### ✨ What's New
- **RX patient prefill in New RX flow**
  - Opening RX Records from patient context now keeps patient context in the URL (`patient` + `name`).
  - New RX modal automatically preselects the patient, pharmacy, transport, and service-date fields.
  - Timeline and patient list entry points now pass the same context, reducing manual re-entry.

- **Patient import workflow enhancements**
  - Added support for RX workflow status columns in patient imports.
  - Completed workflow step dates now auto-populate RX tracking history at import time.
  - Service date is inferred from workflow dates when blank.
  - Added text-based import simulation scenarios via QA tooling.

### 🧪 QA & Validation
- Added import sample files for workflow simulation.
- Added dry-run import simulator (`scripts/simulate-patient-workflow-import.js`) and QA dashboard/run button for:
  - same-date scenario
  - incremental-by-1-day scenario
  - inferred service-date scenario.
- Text export of validation output added for QA review.

### ℹ️ Notes
- Versioned build is `2.0.35` in `package.json`.
- Deployment package generated for server delivery: `dist/server-update-2.0.35-deploy.zip`.
