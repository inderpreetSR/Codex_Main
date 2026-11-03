# Codex_Main

Project repository. The application stack and implementation have not been selected yet.

## Getting started

Clone this repository and check out the branch for your work. No dependencies,
build commands, services, or tests are configured yet. Add setup, run, and test
instructions here when the application stack is introduced.

## Branches

- `main`: stable, reviewed code and shared repository conventions.
- `dev`: integration of active development work.
- `sit`: code selected for system integration testing.
- `uat`: code selected for user acceptance testing.

Use feature branches and pull requests for changes. Promote tested changes from
`dev` to `sit`, then `uat`, then `main`. These are Git branches; deployments and
branch protection rules are not configured.

## Configuration

Keep credentials and environment-specific values out of Git. Use environment
variables or deployment settings. When configuration is introduced, document its
variable names in an `.env.example` file containing safe placeholders only.

## Minimum security CI

The [Security workflow](../../actions/workflows/security.yml) runs on pushes and
pull requests to `main`, `dev`, `sit`, and `uat`, every Monday, and manually from
GitHub Actions. It uses read-only repository permissions and requires no scanner
license or additional secret.

- [Gitleaks](https://github.com/gitleaks/gitleaks) scans Git history for secrets.
  Any detection fails the job; output is redacted. Rotate exposed credentials
  rather than merely deleting their current file.
- [Trivy](https://github.com/aquasecurity/trivy) scans supported dependency files
  and infrastructure configuration. High or critical findings fail the job,
  including vulnerabilities without a published fix. Database or scanner failures
  also fail the job.

Scanner versions and archive SHA-256 checksums are pinned in the workflow. Update
both together after verifying official release checksums. Dependency and
infrastructure coverage starts when supported manifests, lockfiles, or
configuration are added; a scan of this baseline does not validate an application.

Build, lint, unit tests, and static code security analysis must be added when the
application stack is selected. Automated web security testing with
[OWASP ZAP](https://www.zaproxy.org/) requires an authorized, deployed test target
and is not configured yet. These scans are not a complete penetration test.

Branch protection is not configured. To enforce these checks before merging,
enable a GitHub branch ruleset requiring the two Security jobs after their first
successful run. GitHub Actions availability and usage limits depend on the
repository plan and visibility.
