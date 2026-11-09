"""Grant a local administrator role to an account that has signed in before.

Run only in the migration container; it has the separate database owner role.
"""

import re

from app.db import engine, one, query


def main():
    """Grant the role using the issuer hostname and stable Auth0 subject."""
    domain = input("Auth0 domain (hostname only): ").strip().lower()
    subject = input("Existing Auth0 user ID (subject): ").strip()
    if (
        not re.fullmatch(r"[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?", domain)
        or not subject
        or len(subject) > 255
        or any(ord(character) < 32 for character in subject)
    ):
        raise SystemExit("Invalid domain or user ID; no changes made.")
    owner = f"https://{domain}/{subject}"
    with engine.begin() as connection:
        query(connection, "SELECT pg_advisory_xact_lock(740024981)")
        if not one(
            connection,
            "SELECT id FROM app_sessions WHERE owner = :owner LIMIT 1",
            owner=owner,
        ):
            raise SystemExit(
                "That account has not signed in to this workspace; no changes made."
            )
        granted = one(
            connection,
            """INSERT INTO workspace_admins (owner) VALUES (:owner)
            ON CONFLICT DO NOTHING RETURNING owner""",
            owner=owner,
        )
        if granted:
            query(
                connection,
                "INSERT INTO admin_role_events (owner, event) VALUES (:owner, 'granted')",
                owner=owner,
            )
    print("Administrator access is enabled for the specified account.")


if __name__ == "__main__":
    main()
