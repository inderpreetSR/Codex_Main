"""Validate Auth0 access tokens and derive a stable owner identity."""

import hashlib
import os
import secrets
from functools import lru_cache
from typing import Annotated

import jwt
from fastapi import Depends, Header, HTTPException, Request, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.db import engine, one, query

bearer = HTTPBearer(auto_error=False)


@lru_cache(maxsize=4)
def signing_keys(issuer):
    """Cache Auth0's rotating signing keys."""
    return jwt.PyJWKClient(f"{issuer}.well-known/jwks.json", timeout=5)


def verified_owner(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Security(bearer)],
):
    """Require a signed access token for the configured API."""
    if credentials is None:
        raise HTTPException(
            401, "Sign in to continue.", headers={"WWW-Authenticate": "Bearer"}
        )
    domain = os.getenv("AUTH0_DOMAIN", "")
    audience = os.getenv("AUTH0_AUDIENCE", "")
    if not domain or not audience:
        raise HTTPException(503, "Auth0 is not configured.")
    issuer = f"https://{domain}/"
    try:
        token = credentials.credentials
        key = signing_keys(issuer).get_signing_key_from_jwt(token)
        claims = jwt.decode(
            token,
            key.key,
            algorithms=["RS256"],
            issuer=issuer,
            audience=audience,
            options={"require": ["sub", "iss", "aud", "exp"]},
        )
    except jwt.PyJWKClientConnectionError as error:
        raise HTTPException(
            503, "Sign-in verification is temporarily unavailable."
        ) from error
    except jwt.PyJWTError as error:
        raise HTTPException(
            401, "Invalid access token.", headers={"WWW-Authenticate": "Bearer"}
        ) from error
    return f"{issuer}{claims['sub']}"


def session_hash(value):
    """Store only a one-way digest of the random session credential."""
    return hashlib.sha256(value.encode("ascii")).hexdigest()


def create_session(owner):
    """Create a fresh session only after validating an Auth0 access token."""
    secret = secrets.token_urlsafe(32)
    with engine.begin() as connection:
        row = one(
            connection,
            """INSERT INTO app_sessions (secret_hash, owner)
            VALUES (:digest, :owner) RETURNING id""",
            digest=session_hash(secret),
            owner=owner,
        )
        query(
            connection,
            """INSERT INTO session_events (session_id, owner, event)
            VALUES (:id, :owner, 'started')""",
            id=row["id"],
            owner=owner,
        )
    return secret


def check_session(owner, secret, *, touch=True, end=False):
    """Enforce 30-minute idle and 12-hour absolute limits transactionally."""
    if not secret or len(secret) != 43 or not secret.isascii():
        if end:
            return
        raise HTTPException(401, "Your workspace session has ended. Sign in again.")
    with engine.begin() as connection:
        row = one(
            connection,
            """SELECT id, ended_at,
            (last_activity <= now() - interval '30 minutes' OR
             created_at <= now() - interval '12 hours') AS expired
            FROM app_sessions WHERE secret_hash = :digest AND owner = :owner
            FOR UPDATE""",
            digest=session_hash(secret),
            owner=owner,
        )
        valid = bool(row and row["ended_at"] is None and not row["expired"])
        if row and row["ended_at"] is None and (row["expired"] or end):
            event = "expired" if row["expired"] else "signed_out"
            query(
                connection,
                "UPDATE app_sessions SET ended_at = now() WHERE id = :id",
                id=row["id"],
            )
            query(
                connection,
                """INSERT INTO session_events (session_id, owner, event)
                VALUES (:id, :owner, :event)""",
                id=row["id"],
                owner=owner,
                event=event,
            )
        elif valid and touch:
            query(
                connection,
                "UPDATE app_sessions SET last_activity = now() WHERE id = :id",
                id=row["id"],
            )
    if not valid and not end:
        raise HTTPException(401, "Your workspace session has ended. Sign in again.")


def current_owner(
    request: Request,
    owner: Annotated[str, Depends(verified_owner)],
    session_key: Annotated[str | None, Header(alias="X-Workspace-Session")] = None,
):
    """Require both identity and an active, owned workspace session."""
    # Polling a background job must not keep an unattended session alive.
    touch = not (
        request.method == "GET" and request.url.path.startswith("/api/v1/jobs/")
    )
    check_session(owner, session_key, touch=touch)
    return owner
