# RX Tracker dependency security maintenance

RX Tracker checks dependencies automatically. Production never installs an
update merely because GitHub finds one.

## What happens automatically

- Every Monday, Dependabot checks npm packages and GitHub Actions.
- Dependabot opens update pull requests against `staging`, not `main`.
- Every pull request receives a dependency review. A newly introduced high or
  critical vulnerability blocks the pull request.
- Every Tuesday, the locked dependency tree receives a separate high-severity
  npm audit even when nobody changed the repository.
- CodeQL scans JavaScript and the RX Softphone C# source on pushes, pull
  requests, and every Sunday.
- Existing staging, development, main, release-build, database, browser, and
  softphone checks remain required.

## What the administrator needs to do

When GitHub emails about a Dependabot pull request:

1. Open the pull request. Do not press **Merge** immediately.
2. Confirm the destination shown near the title is `staging`.
3. Wait for the checks at the bottom of the pull request.
4. If any check is red, leave the pull request open and request technical
   review.
5. If all checks are green, request a normal RX Tracker dependency promotion.
   The update still follows `staging -> develop -> main -> official release`.

The simplest request to send for review is:

> Review Dependabot PR `<link>`, test it in staging, and promote it only if all
> RX Tracker checks pass.

Never run `npm audit fix --force` on the server and never copy `node_modules`
into production. Production updates only through verified compiled releases.

## One-time GitHub repository settings

An owner of `Copernicous/RX-TRACKER-NEXT` should open:

**Settings -> Advanced Security**

Enable these repository features if GitHub shows them as disabled:

- Dependency graph
- Dependabot alerts
- Dependabot security updates
- Secret scanning

The repository workflows provide CodeQL scanning, weekly audits, dependency
review, and version-update pull requests. Security results appear under the
repository **Security** tab. Workflow results appear under **Actions**.

## Review schedule

- High or critical alert: review within one business day.
- Weekly: review Dependabot pull requests and failed security workflows.
- Monthly: promote tested patch/minor updates that remain open.
- Quarterly: review major Node.js, PostgreSQL, Sequelize, Express, .NET, and
  RX Softphone dependency upgrades separately.
