# Codex_Main

Repository baseline for a Python website, machine learning, and data science
project. The web framework and application implementation are not selected yet.

## Getting started

Clone this repository and check out the branch for your work. Use Python 3.12
for the shared CI tools:

```sh
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements-ci.txt
python .github/scripts/python_checks.py pylint
python .github/scripts/python_checks.py ruff
python .github/scripts/python_checks.py bandit
python .github/scripts/python_checks.py notebooks
python .github/scripts/python_checks.py tests
```

Checks discover tracked files with Git; stage new files before running them.
No application, services, training pipeline, or application tests exist yet.

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

Application build checks must be added when the framework is selected.
Automated web security testing with
[OWASP ZAP](https://www.zaproxy.org/) requires an authorized, deployed test target
and is not configured yet. These scans are not a complete penetration test.

Branch protection is not configured. To enforce these checks before merging,
enable a GitHub branch ruleset requiring the two Security jobs after their first
successful run. GitHub Actions availability and usage limits depend on the
repository plan and visibility.

## Python, machine learning, and notebook CI

The [Python quality workflow](https://github.com/inderpreetSR/Codex_Main/actions/workflows/python-quality.yml)
runs five independent checks on pushes and pull requests to all four branches:

- **Pylint:** code quality, with a minimum score of 8/10. Fatal and error messages
  also fail the check regardless of the score.
- **Ruff:** Python lint and formatting checks.
- **Bandit:** Python security analysis; medium/high severity findings with at
  least medium confidence fail the check.
- **Notebooks:** validate Jupyter notebook structure, require cleared execution
  counts and outputs, and lint code cells with Ruff through nbQA. Notebooks are
  not executed automatically.
- **Pytest:** run tracked `test_*.py` and `*_test.py` files. Missing tests or
  notebooks are explicitly reported as skipped, not validated application work.

CI installs application dependencies from `requirements.txt` when present and
installs the project when `pyproject.toml` declares a build system. Update this
installation step if you choose Poetry, uv, Conda, a frontend package manager, or
optional ML dependency groups. CI dependencies are separately pinned in
`requirements-ci.txt`.

Future tests should cover website routes and authorization, data schema and
missing-value constraints, train/test separation, reproducibility, and model
quality against a defined baseline. These need actual project code and datasets;
they are not implemented by generic linting. Keep large datasets and model
artifacts in appropriate external storage, and use small non-sensitive fixtures
in tests. JavaScript linting, browser tests, and accessibility checks can be added
when the frontend stack is chosen.
