# next.95 local security scan evidence

The previous hosted CodeQL workflow required successful extraction/analysis;
it did not require zero findings. Local scans preserve that evidence and add
comparison against the prior published JavaScript source using the same tool
and query bundle. They must not silently declare legacy findings resolved.
All SARIF results remain available in the local evidence directory.

## Report change

The RX Stage Report SQL-construction alert is also present on the published
baseline. Query values use Sequelize replacements, including baseline stage,
timezone, selected stages and pagination. Sort keys and direction are checked
against explicit allowlists before selecting fixed SQL expressions. Existing
injection-rejection and real PostgreSQL report regressions remain required.
No unrelated SQL, rate-limit, XSS, backup-path or API-key behavior is changed.

## New compiled smoke-test finding

`js/insecure-download` in `scripts/test-compiled-release.js` is reviewed as a
test-only fixed-loopback text read. The harness starts its own executable on
127.0.0.1:3213, verifies the health PID and exact version, then reads the report
JavaScript as text to check expected asset markers. It never evaluates, saves
or executes the downloaded text. The review script permits only this rule/path
with those fixed endpoint/PID assertions still present; any other new high or
error finding fails preparation. The result remains in SARIF and review JSON.

## Existing findings and dependencies

The local JavaScript scan reports findings across legacy routes, administrative
SQL, browser DOM handling, regexes and authentication helpers. Unchanged-source
findings are retained against the published baseline; comparison does not prove
that they are false positives or authorize a broad remediation project.

The unchanged RX Softphone SIPSorcery 10.0.12 dependency emitted NU1903 for
GHSA-jwjp-4649-v8jp and GHSA-pfvm-w89x-94jw during the .NET build. Softphone source
and its dependencies were not changed under this NEXT-only task. These warnings
need separate Softphone maintenance/review; a successful build is not a clean
NuGet audit. Existing moderate Sequelize/UUID npm findings also remain. The
required high-severity npm audit passes after the compatible updates and
Nodemailer update.

Preparation is not production installation or publication. Provide these open
findings with the local validation evidence when reviewing the release.
