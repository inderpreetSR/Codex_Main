"""Revoke a local administrator role using the privileged maintenance role."""

from app.db import engine, one, query


def main():
    """Do not allow removal of the final administrator."""
    owner = input("Exact administrator identity shown in the dashboard: ").strip()
    with engine.begin() as connection:
        query(connection, "SELECT pg_advisory_xact_lock(740024981)")
        if not one(
            connection,
            "SELECT owner FROM workspace_admins WHERE owner = :owner",
            owner=owner,
        ):
            raise SystemExit("Administrator not found; no changes made.")
        if (
            one(connection, "SELECT count(*) AS total FROM workspace_admins")["total"]
            <= 1
        ):
            raise SystemExit("Cannot remove the last administrator; no changes made.")
        query(
            connection, "DELETE FROM workspace_admins WHERE owner = :owner", owner=owner
        )
        query(
            connection,
            "INSERT INTO admin_role_events (owner, event) VALUES (:owner, 'revoked')",
            owner=owner,
        )
    print("Administrator access removed.")


if __name__ == "__main__":
    main()
