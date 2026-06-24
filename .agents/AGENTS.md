# Daniely RX — Agent Rules

## Template Sync Policy

**Every fix committed to this project MUST also be applied to `E:\Documents\A TEMPLATE AI`.**

### What to sync

| Change Type | What to sync to template |
|---|---|
| Bug fix in a core framework file | Apply the identical fix to the matching file in the template |
| Security fix | Apply immediately — changelog entries in BOTH projects |
| New feature in a core file (auth, rbac, backup, audit, settings) | Mirror to template; replace domain-specific parts with stubs if needed |
| New domain feature (RX-specific models, routes, views) | Do NOT sync — domain code stays in RX only |
| Changelog entry | Add a matching entry to `E:\Documents\A TEMPLATE AI\CHANGELOG.md` |
| OPERATIONS_MANUAL change | Update `E:\Documents\A TEMPLATE AI\OPERATIONS_MANUAL.md` with the same information |

### Which files are "core framework" (always sync)
- `controllers/authController.js`
- `middleware/auth.js`, `middleware/rbac.js`, `middleware/auditLogger.js`, `middleware/webAuth.js`
- `public/css/style.css`
- `public/js/app.js`, `public/js/base.js`
- `views/login.ejs`, `views/layout.ejs`
- `services/backupService.js`, `services/emailService.js`, `services/settingsService.js`
- `models/user.js`, `models/role.js`, `models/auditlog.js`, `models/errorlog.js`
- `app.js` (startup, middleware config, CORS, seed gate)
- `package.json` (scripts, devDependencies)
- `scripts/post-build.js`
- `qa/` folder — any infrastructure change (lib/, start/stop/status/web scripts)

### Workflow when checking uncommitted changes

1. Run `git status` and `git diff` in Daniely RX
2. For each changed file, determine: core framework or domain-specific?
3. Apply core framework fixes to the matching template file
4. Add a CHANGELOG entry in Daniely RX with full file-level detail
5. Add a matching (condensed) entry to the template CHANGELOG `[2.0.x]` section
6. Update `OPERATIONS_MANUAL.md` in the template if the fix affects documented behavior
7. Then commit both projects

### Version numbering
- Daniely RX uses explicit semver: `[2.0.20]`, `[2.0.21]`, etc.
- Template CHANGELOG consolidates under `[2.0.x]` — no per-fix version numbers needed
- OPERATIONS_MANUAL.md version header = latest RX version applied
