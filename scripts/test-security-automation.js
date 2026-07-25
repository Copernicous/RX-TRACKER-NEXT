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
const guide = read('docs/DEPENDENCY_SECURITY_MAINTENANCE.md');

assert(dependabot.includes('target-branch: staging'), 'Dependabot updates must begin in staging.');
assert(dependabot.includes('package-ecosystem: npm'), 'Dependabot must monitor npm.');
assert(dependabot.includes('package-ecosystem: github-actions'), 'Dependabot must monitor GitHub Actions.');
assert(dependencyReview.includes('fail-on-severity: high'), 'Dependency review must block high-severity additions.');
assert(codeql.includes('javascript-typescript'), 'CodeQL must scan the RX Tracker JavaScript source.');
assert(codeql.includes('csharp'), 'CodeQL must scan the RX Softphone C# source.');
assert(weeklyAudit.includes('npm audit --audit-level=high'), 'The scheduled audit must block high or critical findings.');
assert(guide.includes('staging -> develop -> main -> official release'), 'The operator guide must preserve the release path.');

console.log('PASS automated dependency, CodeQL, pull-request review, and operator-guidance policy.');
