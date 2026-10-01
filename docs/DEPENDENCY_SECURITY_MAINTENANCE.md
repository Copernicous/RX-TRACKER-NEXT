# RX Tracker dependency security maintenance

RX Tracker checks dependencies automatically. Production never installs an
update merely because GitHub finds one.

## Local checks and hosted automation

Dependabot continues proposing updates against staging. Hosted Actions are
manual-only while local execution is required. Do not enable or dispatch them
without explicit user authorization. Run the high-severity dependency audit,
JavaScript/C# CodeQL scans, lifecycle suite and package gates locally using
`docs/LOCAL_RELEASE.md` before promotion/publication. Retain the evidence for
that exact commit; a push is not validation.

## What the administrator needs to do

When GitHub emails about a Dependabot pull request:

1. Open the pull request. Do not press **Merge** immediately.
2. Confirm the destination shown near the title is `staging`.
3. Run the complete local release checks for the candidate commit.
4. If any local check fails, leave the pull request open and request technical
   review.
5. If all local checks pass, request a normal RX Tracker dependency promotion.
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
