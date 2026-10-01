'use strict';
// Retain all SARIF findings. Gate regressions against the published baseline
// rather than turning the historical scan-completion check into a new zero-debt policy.
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { execFileSync, spawnSync } = require('child_process');
const [directory, baselineRef] = process.argv.slice(2);
if (!directory || !baselineRef) throw Error('Provide the evidence directory and published baseline ref.');
function findings(name) {
    const sarif = JSON.parse(fs.readFileSync(path.join(directory, name)));
    return sarif.runs.flatMap(run => {
        assert.ok(!run.invocations?.some(invocation => invocation.executionSuccessful === false), 'CodeQL invocation failed');
        return (run.results || []).map(result => {
            const rule = run.tool.driver.rules.find(rule => rule.id === result.ruleId);
            const file = result.locations[0].physicalLocation.artifactLocation.uri;
            const lineHash = result.partialFingerprints?.primaryLocationLineHash;
            assert.ok(lineHash, 'CodeQL finding lacks a stable line fingerprint.');
            return { rule: result.ruleId, file, lineHash, severity: Number(rule?.properties?.['security-severity'] || 0), level: result.level,
                key: [result.ruleId, file, lineHash].join('|') };
        });
    });
}
const baseline = findings('baseline-javascript.sarif');
const current = findings('javascript.sarif');
const csharp = findings('csharp.sarif');
const existing = new Set(baseline.map(finding => finding.key));
const introduced = current.filter(finding => !existing.has(finding.key));
const reviewed = [];
for (const finding of introduced) {
    // The new smoke test reads text from its own fixed loopback server and
    // asserts the PID/version first. It neither saves nor executes downloads.
    if (finding.rule === 'js/insecure-download' && finding.file === 'scripts/test-compiled-release.js') {
        const source = fs.readFileSync(path.join(__dirname, 'test-compiled-release.js'), 'utf8');
        assert.ok(source.includes("fetch('http://127.0.0.1:3213/js/rx-stage-report.js')"));
        assert.ok(source.includes('assert.equal(health?.pid, child.pid)'));
        reviewed.push({ ...finding, disposition: 'Reviewed test-only loopback asset read; no downloaded code is executed.' });
    } else if (finding.severity >= 7 || finding.level === 'error') {
        throw Error('New unreviewed CodeQL finding: ' + finding.key);
    }
}
const unchangedCsharp = spawnSync('git', ['diff','--quiet',baselineRef,'HEAD','--','rx-softphone-desktop'], { cwd: path.resolve(__dirname, '..') }).status === 0;
if (!unchangedCsharp && csharp.some(finding => finding.severity >= 7 || finding.level === 'error')) throw Error('Changed C# source has security findings requiring review.');
const evidence = {
    sourceCommit: execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
    baselineCommit: execFileSync('git',['rev-parse',baselineRef + '^{commit}'],{encoding:'utf8'}).trim(),
    passed: true, baselineJavaScriptFindings: baseline.length, candidateJavaScriptFindings: current.length,
    existingFindingsRetained: current.length - introduced.length, introduced, reviewed,
    csharpFindings: csharp.length, csharpSourceUnchanged: unchangedCsharp,
    note: 'Scan completion and no new unreviewed high/error findings. Existing findings are retained, not fixed or declared safe. See LOCAL_RELEASE_SECURITY_REVIEW.md.'
};
fs.writeFileSync(path.join(directory,'codeql-review.json'),JSON.stringify(evidence,null,2)+'\n');
console.log('PASS CodeQL comparison/review; existing findings retained in SARIF.');
