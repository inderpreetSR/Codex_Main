# Future integrations

## Local PostgreSQL analysis platform

**Status: planned; not installed or connected.**

Evaluate self-hosted Redash as a local, open-source SQL and dashboarding tool for the Codex Main administrator. Cursor or a PostgreSQL client could also be evaluated separately for development; choose the tool when this work is scheduled.

### Proposed approach

1. Confirm the intended administrator workflows and the data that the tool may access. Start with aggregate operational metrics and synthetic fixtures.
2. Run Redash locally in Docker with its own required supporting services and persistent storage. Keep its web interface bound to Windows loopback. Do not expose PostgreSQL or the Docker daemon to the internet.
3. Create a dedicated PostgreSQL login with read-only privileges on explicitly approved reporting views or tables. Exclude session secrets, credentials, private document content, and personal information unless access is separately designed and authorized. The connection bypasses the workspace's normal project-ownership checks, so account and view permissions must enforce the intended scope.
4. Provide only the selected tool with a network route to PostgreSQL. Keep the existing offline worker's network isolation and credential boundaries intact. Store connection credentials locally outside Git and avoid printing them in logs.
5. Configure administrator access to Redash, connect its PostgreSQL data source, and create a small dashboard for approved operational metrics. Evaluate access control and data retention for saved queries and cached results.
6. Verify that the read-only account cannot write or read excluded data; check access from allowed and disallowed networks; test restart and persistence; and document local startup, backups, and removal. Use synthetic data for initial validation.

A connection string alone is insufficient until network access, database permissions, and the tool's own authentication are configured. Any future integration must preserve existing application data.
