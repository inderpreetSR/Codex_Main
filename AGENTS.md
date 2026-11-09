# Repository guidance

## Current state

This repository contains a React and FastAPI data science workspace with a
restricted ML and retrieval worker, plus Python/Rust quality and security CI.
Follow the check commands in `README.md` and report checks that could only be
exercised with fixtures or mocks.

## Working practices

- Read `README.md` and applicable nested instructions before making changes.
- Use the existing checkout. Cloud tasks are isolated; do not create a Git
  worktree unless the user explicitly requests one.
- Inspect Git status first and preserve existing user changes.
- Keep changes focused on the requested task. Avoid unrelated refactoring.
- Never commit credentials, private keys, or real environment values.
- When adding a stack, document setup, run, and test commands in `README.md`,
  commit the appropriate lockfile, and add relevant exclusions to `.gitignore`.
- Run checks appropriate to the change and report failures or unrun checks clearly.
- Use feature branches and pull requests unless the user authorizes direct pushes.
- Do not merge, push, or deploy without authorization from the task.

## Branch conventions

Keep shared repository conventions consistent across `main`, `dev`, `sit`, and
`uat`. Store environment-specific configuration outside tracked source files.
Promote changes through `dev`, `sit`, and `uat` before `main` once development
begins; the initial shared baseline can be applied to all four branches.
