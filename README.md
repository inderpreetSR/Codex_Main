# Codex_Main

A local data science workspace with a React frontend, FastAPI, PostgreSQL,
scikit-learn baseline evaluation, and LangChain retrieval with offline embeddings.

## Getting started

### Run the workspace on Windows

Start Docker Desktop in Linux container mode. From the repository root, create
the ignored local configuration file and build the services.

```powershell
& ./scripts/setup-local.ps1
docker --context desktop-linux compose up --build --wait
```

The workspace is at [127.0.0.1:8080](http://127.0.0.1:8080/), the original welcome
page is at [/welcome/](http://127.0.0.1:8080/welcome/), and the API reference is at
[127.0.0.1:8000/docs](http://127.0.0.1:8000/docs). The first build downloads the
locked dependencies and a pinned CPU embedding model. Use
`docker --context desktop-linux compose down` to stop the services. Database and
upload volumes persist across restarts.

**Auth0.** Create an Auth0 Single Page Application and an API with RS256
signing. Set the SPA's allowed callback URL, logout URL, and web origin to
`http://127.0.0.1:8080`. Fill in `AUTH0_DOMAIN` (hostname only),
`AUTH0_CLIENT_ID`, and `AUTH0_AUDIENCE` (the API identifier) in `.env`.
The public use-case library is available before Auth0 setup.

**Workspace sessions.** Auth0 validates sign-in; the API additionally requires a
random, per-tab workspace session credential. Only its SHA-256 digest is stored
in PostgreSQL. Sessions expire after 30 minutes without API activity or 12 hours
after creation, whichever comes first; job-status polling does not extend the
idle limit. Sign out ends the application session and redirects to Auth0. The
browser keeps the credential in session storage for that tab; close it or sign
out on shared computers. Unsaved edits can be lost on expiry. A tab with an
expired session should sign out and sign back in.

Minimal local audit events (session creation, sign-out, and detected expiry)
are stored in the `session_events` database table, with the user identifier,
session record ID and timestamp. No passwords, tokens, data files or project
contents are recorded there. Auth0 maintains its own authentication logs. Session
events are retained until an administrator removes them; retention and an account
activity UI are future work. An expired session is recorded when it is next used.
These application sessions do not revoke an already-issued Auth0 JWT; a holder
of a valid JWT can create another workspace session. Immediate account-wide
revocation and protected cookie-based sessions require further design before
production use.

**Local administrators.** The administrator overview displays aggregate project,
active-session, session-event and job counts. It lists up to 100 recent accounts,
active sessions and audit events, and can end an individual workspace session.
It does not expose project contents or manage Auth0 accounts. The backend verifies the role on
every administrative API request. Administrators are identified by the exact
Auth0 issuer and user ID (`sub`), not by an email address supplied by a client.

To assign an administrator, the intended person must first sign in to this
workspace. An operator with access to the local Docker database-owner credentials
can then run the command below and enter the Auth0 domain and exact user ID when
prompted. Find the user ID in Auth0 Dashboard > User Management > Users. The
command records a local role-grant event and refuses users who have not signed
in. Never publish this maintenance container or its database credentials.

```powershell
docker --context desktop-linux compose run --rm --no-deps migrate .venv/bin/python -m migrations.grant_admin
```

Refresh the page after the grant to see the **Admin** button on the dashboard.
The regular application database role cannot grant or revoke administrator roles.
To remove a role, run the following command and enter the exact account identity
shown in the admin dashboard. The command records the change and refuses to
remove the last administrator.

```powershell
docker --context desktop-linux compose run --rm --no-deps migrate .venv/bin/python -m migrations.revoke_admin
```

Role changes are intentionally not exposed through the web UI. The session-end
action revokes only that workspace session, not the Auth0 login or already-issued
JWTs. Audit retention and immediate account-wide revocation need further design
before a production rollout.

**OpenRouter.** Set `OPENROUTER_API_KEY` in `.env` to enable AI generation.
You can override the two model IDs in the same file. Models need a provider
that supports structured outputs and the configured data restrictions.
Run `docker --context desktop-linux compose up -d --wait` after changing
settings. The upload and ML worker runs offline. Local document retrieval uses
PostgreSQL and MiniLM embeddings. The outbound AI service receives only approved
planning metadata or eligible excerpts and has no upload volume.

### Verify the workspace

```powershell
(Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8080/).StatusCode
Invoke-RestMethod http://127.0.0.1:8000/api/v1/health
docker --context desktop-linux compose ps
docker --context desktop-linux compose -p codex-main-check build verify
docker --context desktop-linux compose -p codex-main-check up -d --wait db
docker --context desktop-linux compose -p codex-main-check run --rm --no-deps migrate
docker --context desktop-linux compose -p codex-main-check run --rm --no-deps verify
docker --context desktop-linux compose -p codex-main-check down --volumes
```

The test project uses its own disposable database and upload volumes. The suite
uses real PostgreSQL and offline embeddings, signed fixture tokens, and mocked
OpenRouter responses. With development credentials configured, sign in through
Auth0 in the browser and generate an approved suggestion to verify the live
integrations. Worker logs include duration and peak memory for profiling.

### Local Codex sandbox

Docker Sandboxes requires Windows Hypervisor Platform. Install the Windows CLI
with `winget install --id Docker.sbx --exact` and complete `sbx login` on the
host. Review source changes before preparing a fresh sibling checkout.

```powershell
$sandboxSource = Join-Path (Split-Path -Parent (Get-Location).Path) 'Codex_Main_Sandbox_Source'
& ./scripts/prepare-sandbox.ps1 -Destination $sandboxSource
sbx create --name codex-main-dev --clone --skills=off codex $sandboxSource
sbx policy ls codex-main-dev
sbx run --name codex-main-dev
```

Use synthetic fixtures in the sandbox and review its commits before transferring
them to the working checkout. The Docker Desktop daemon stays on its local named
pipe. Run live integration checks in the host's separate Compose environment.

### Python checks

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
The Docker-based verification above covers the application, ML, and RAG integration.

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
- **Build and Pytest:** build the frontend and backend, then run the workspace
  integration tests against a disposable PostgreSQL database.

Application dependencies are locked in `uv.lock` and
`frontend/package-lock.json`. Static check tools are pinned separately in
`requirements-ci.txt`. The tests use synthetic data for authorization,
feature preparation, reproducible model evaluation, and retrieval isolation.

## Rust CI

The [Rust quality workflow](https://github.com/inderpreetSR/Codex_Main/actions/workflows/rust-quality.yml)
runs on pushes and pull requests to all four branches, manually, and weekly:

- **rustfmt:** checks formatting.
- **Clippy:** checks all workspace targets; warnings fail CI.
- **Cargo build:** compiles all workspace targets.
- **Cargo test:** runs workspace unit, integration, and documentation tests.
- **cargo-audit:** fails on vulnerable dependencies reported by RustSec.

Rust is pinned in `rust-toolchain.toml`; the auditor version is pinned in the
workflow. Add a root `Cargo.toml` (a workspace for multiple crates) and commit
`Cargo.lock` to activate these checks. Missing Cargo projects are explicitly
skipped; nested crates without a root workspace fail with setup guidance. There
is no Rust application yet, so CI does not validate Rust application behavior.

With Rust installed through rustup, run these from the repository root:

```sh
rustup show
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo build --workspace --all-targets --locked
cargo test --workspace --locked
cargo install cargo-audit --version 0.22.2 --locked
cargo audit --file Cargo.lock
```

The baseline uses default Cargo features. Add project-specific feature and
platform matrices when code exists; enabling all features can be invalid for
mutually exclusive options. A zero-test Cargo run does not validate application
behavior. Configure Rust check requirements in branch rulesets once activated.
