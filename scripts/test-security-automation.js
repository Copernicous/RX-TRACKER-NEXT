'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const dependabot = read('.github/dependabot.yml');
const dependencyReview = read('.github/workflows/dependency-review.yml');
const codeql = read('.github/workflows/codeql.yml');
const weeklyAudit = read('.github/workflows/weekly-security-audit.yml');
const releaseWorkflow = read('.github/workflows/release-notes-from-file.yml');
const gitignore = read('.gitignore');
const apiRoutes = read('routes/apiRoutes.js');
const guide = read('docs/DEPENDENCY_SECURITY_MAINTENANCE.md');

assert(dependabot.includes('target-branch: staging'), 'Dependabot updates must begin in staging.');
assert(dependabot.includes('package-ecosystem: npm'), 'Dependabot must monitor npm.');
assert(dependabot.includes('package-ecosystem: github-actions'), 'Dependabot must monitor GitHub Actions.');
assert(dependencyReview.includes('fail-on-severity: high'), 'Dependency review must block high-severity additions.');
assert(codeql.includes('javascript-typescript'), 'CodeQL must scan the RX Tracker JavaScript source.');
assert(codeql.includes('csharp'), 'CodeQL must scan the RX Softphone C# source.');
assert(weeklyAudit.includes('npm audit --audit-level=high'), 'The scheduled audit must block high or critical findings.');
assert(releaseWorkflow.includes('actions: read'), 'Release publishing must be able to verify lifecycle workflow evidence.');
assert(releaseWorkflow.includes('database-lifecycle-ci.yml/runs?head_sha=$sha'), 'Release publishing must require lifecycle success for the exact tagged commit.');
assert(releaseWorkflow.includes("$_.head_branch -eq 'main'"), 'Release lifecycle evidence must come from main.');
assert(releaseWorkflow.includes('Missing required version-specific release notes'), 'Release publishing must reject missing tag-specific notes.');
assert(gitignore.includes('administration/delivery-log-archives/'), 'Delivery-log archives containing patient data must never be tracked by git.');
assert(!apiRoutes.includes("auditLogger('Delivery Log Archive')"), 'Delivery-log creation must not duplicate its full request into the generic audit log.');
assert(apiRoutes.includes("'/reports/delivery-log-archives/:id/reprint'") && apiRoutes.includes('deliveryLogArchiveController.reprint'), 'Delivery-log reprints must use the audited mutation endpoint.');
assert(apiRoutes.includes("rbac.requirePermission('rx_records', 'print'), deliveryLogArchiveCreateLimiter, deliveryLogArchiveController.create"), 'Delivery-log archive creation must require RX print permission and rate limiting.');
assert(apiRoutes.includes("'/reports/delivery-log-archives/:id/print', requireDeliveryLogPrintPermission"), 'Delivery-log printing must preserve RX Records and Reports permission compatibility.');
assert(guide.includes('staging -> develop -> main -> official release'), 'The operator guide must preserve the release path.');

console.log('PASS automated dependency, CodeQL, pull-request review, and operator-guidance policy.');
