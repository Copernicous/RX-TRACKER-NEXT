# Release Notes

## v2.0.38 (2026-06-24)

### What's New
- **Transport/company matching in patient import is now more tolerant**
  - Patient and pharmacy transport lookup accepts common hidden/formatting variants when matching import values (spaces, punctuation, non-breaking spaces).
  - Company validation now returns a single clear message when a value is unresolved or inactive: `"not found or inactive"`.
- **Duplicate validation unchanged, now more explicit**
  - Duplicate patient IDs in the import file are still hard-stopped and continue to be reported as a blocking import error, including the line where the original value first appeared.

### QA & Validation
- Keep dry-run import simulation tooling in QA for workflow scenarios:
  - same-date scenario
  - +1 day incremental scenario
  - inferred service-date scenario
- Add a regression check for transport input:
  - upload a patient CSV with a transport name that does not exist and confirm it reports `"not found or inactive"`.

### Notes
- Versioned build is `2.0.38` in `package.json`.
- Deployment package generated for server delivery: `dist/server-update-2.0.38.zip`.
