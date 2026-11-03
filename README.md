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
