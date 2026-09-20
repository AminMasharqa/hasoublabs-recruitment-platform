"""JWT issue/refresh and Valkey session management.

Task 3.3 (partial) — Requirements: 1.4, 3.10, Security constraints (session expiry).

JWT claims:
  {
    "sub": "<account-uuid>",
    "exp": <unix-timestamp>,
    "iat": <unix-timestamp>,
    "act": "<ADMIN|CANDIDATE|SENIOR>",   # active role context
    "roles": ["CANDIDATE", "SENIOR"],    # all roles the account holds
    "session_id": "<uuid>"               # key into Valkey session store
  }

Valkey session record (JSON at key "session:{session_id}"):
  {
    "account_id": "<uuid>",
    "roles": ["CANDIDATE", "SENIOR"],
    "active_context": "<role>",
    "session_id": "<uuid>",
    "status": "<AccountStatus>",
    "exp": <unix-timestamp>
  }

Session behavior:
  - 30-minute sliding expiry: every successful validation extends the TTL.
  - Logout: delete the session key from Valkey.
  - Context switch: delete the old session key, create a new one with the
    updated active_context, issue a new token pair.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
import json
import logging
from typing import TYPE_CHECKING, Any
import uuid

from jose import JWTError, jwt  # type: ignore[import-untyped]

from app.platform.security.errors import AuthenticationRequired
from app.platform.security.types import AccountStatus, Role

if TYPE_CHECKING:
    from redis.asyncio import Redis  # Valkey is API-compatible with Redis client

logger = logging.getLogger(__name__)

# ── Session constants ──────────────────────────────────────────────────────
SESSION_KEY_PREFIX = "session:"
DEFAULT_SESSION_TTL_SECONDS = 1800  # 30 minutes sliding


# ── Token pair ─────────────────────────────────────────────────────────────

class TokenPair:
    """Issued access + refresh token pair."""

    __slots__ = ("access_token", "refresh_token", "token_type", "expires_in")

    def __init__(
        self,
        *,
        access_token: str,
        refresh_token: str,
        expires_in: int = DEFAULT_SESSION_TTL_SECONDS,
    ) -> None:
        self.access_token = access_token
        self.refresh_token = refresh_token
        self.token_type = "bearer"  # noqa: S105 — not a password, standard OAuth2 token type
        self.expires_in = expires_in


# ── Session service ─────────────────────────────────────────────────────────

class SessionService:
    """Manages JWT issuance and Valkey session lifecycle.

    A session is created on login and destroyed on logout or context switch.
    The JWT contains only claims needed for request routing; the Valkey record
    is the authoritative state for liveness checks.
    """

    def __init__(
        self,
        *,
        valkey: Redis[str],
        secret_key: str,
        algorithm: str = "HS256",
        access_ttl_seconds: int = DEFAULT_SESSION_TTL_SECONDS,
        refresh_ttl_seconds: int = 7 * 24 * 3600,
    ) -> None:
        self._valkey = valkey
        self._secret_key = secret_key
        self._algorithm = algorithm
        self._access_ttl = access_ttl_seconds
        self._refresh_ttl = refresh_ttl_seconds

    # ── Issue ──────────────────────────────────────────────────────────────

    async def issue(
        self,
        *,
        account_id: uuid.UUID,
        roles: frozenset[Role],
        active_context: Role,
        status: AccountStatus,
    ) -> TokenPair:
        """Create a new session and return an access+refresh token pair."""
        session_id = str(uuid.uuid4())
        now = datetime.now(UTC)

        access_payload = self._build_access_payload(
            account_id=account_id,
            roles=roles,
            active_context=active_context,
            session_id=session_id,
            now=now,
            ttl=self._access_ttl,
        )
        refresh_payload = self._build_refresh_payload(
            session_id=session_id,
            now=now,
            ttl=self._refresh_ttl,
        )

        access_token = jwt.encode(
            access_payload, self._secret_key, algorithm=self._algorithm
        )
        refresh_token = jwt.encode(
            refresh_payload, self._secret_key, algorithm=self._algorithm
        )

        await self._store_session(
            session_id=session_id,
            account_id=account_id,
            roles=roles,
            active_context=active_context,
            status=status,
            exp=int(access_payload["exp"]),
        )

        return TokenPair(
            access_token=access_token,
            refresh_token=refresh_token,
            expires_in=self._access_ttl,
        )

    # ── Validate (used by current_principal) ──────────────────────────────

    async def validate_access_token(self, token: str) -> dict[str, Any]:
        """Decode and validate an access JWT; extend the session TTL.

        Returns the decoded payload dict.
        Raises AuthenticationRequired on any failure.
        """
        try:
            payload = jwt.decode(
                token,
                self._secret_key,
                algorithms=[self._algorithm],
            )
        except JWTError as exc:
            raise AuthenticationRequired(f"Invalid token: {exc}") from exc

        session_id: str | None = payload.get("session_id")
        if not session_id:
            raise AuthenticationRequired("Token missing session_id claim")

        session_data = await self._load_and_refresh_session(session_id)
        if session_data is None:
            raise AuthenticationRequired("Session not found or expired")

        return payload

    # ── Refresh ────────────────────────────────────────────────────────────

    async def refresh(self, refresh_token: str) -> TokenPair:
        """Issue a new token pair using a valid refresh token.

        Raises AuthenticationRequired if the refresh token is invalid.
        """
        try:
            payload = jwt.decode(
                refresh_token,
                self._secret_key,
                algorithms=[self._algorithm],
            )
        except JWTError as exc:
            raise AuthenticationRequired(f"Invalid refresh token: {exc}") from exc

        if payload.get("type") != "refresh":
            raise AuthenticationRequired("Token is not a refresh token")

        session_id: str = payload.get("session_id", "")
        session_data = await self._load_session(session_id)
        if session_data is None:
            raise AuthenticationRequired("Session not found or expired")

        return await self.issue(
            account_id=uuid.UUID(session_data["account_id"]),
            roles=frozenset(Role(r) for r in session_data["roles"]),
            active_context=Role(session_data["active_context"]),
            status=AccountStatus(session_data["status"]),
        )

    # ── Context switch ─────────────────────────────────────────────────────

    async def switch_context(
        self,
        *,
        old_session_id: str,
        new_context: Role,
    ) -> TokenPair:
        """Switch active role context and rotate the session.

        R3 AC10: No authorization state from the old context survives.
        Raises AuthenticationRequired if the old session is missing.
        """
        session_data = await self._load_session(old_session_id)
        if session_data is None:
            raise AuthenticationRequired("Session not found or expired")

        roles = frozenset(Role(r) for r in session_data["roles"])
        if new_context not in roles:
            from app.platform.security.errors import AuthorizationDenied  # noqa: PLC0415
            raise AuthorizationDenied(
                f"Account does not hold the {new_context} role"
            )

        # Invalidate the old session before issuing a new one.
        await self._delete_session(old_session_id)

        return await self.issue(
            account_id=uuid.UUID(session_data["account_id"]),
            roles=roles,
            active_context=new_context,
            status=AccountStatus(session_data["status"]),
        )

    # ── Logout ─────────────────────────────────────────────────────────────

    async def revoke(self, session_id: str) -> None:
        """Invalidate a session (logout). Idempotent."""
        await self._delete_session(session_id)

    # ── Internal helpers ───────────────────────────────────────────────────

    def _build_access_payload(
        self,
        *,
        account_id: uuid.UUID,
        roles: frozenset[Role],
        active_context: Role,
        session_id: str,
        now: datetime,
        ttl: int,
    ) -> dict[str, Any]:
        return {
            "sub": str(account_id),
            "iat": int(now.timestamp()),
            "exp": int((now + timedelta(seconds=ttl)).timestamp()),
            "act": active_context.value,
            "roles": [r.value for r in sorted(roles)],
            "session_id": session_id,
            "type": "access",
        }

    def _build_refresh_payload(
        self,
        *,
        session_id: str,
        now: datetime,
        ttl: int,
    ) -> dict[str, Any]:
        return {
            "iat": int(now.timestamp()),
            "exp": int((now + timedelta(seconds=ttl)).timestamp()),
            "session_id": session_id,
            "type": "refresh",
        }

    async def _store_session(
        self,
        *,
        session_id: str,
        account_id: uuid.UUID,
        roles: frozenset[Role],
        active_context: Role,
        status: AccountStatus,
        exp: int,
    ) -> None:
        record = {
            "account_id": str(account_id),
            "roles": [r.value for r in sorted(roles)],
            "active_context": active_context.value,
            "session_id": session_id,
            "status": status.value,
            "exp": exp,
        }
        key = f"{SESSION_KEY_PREFIX}{session_id}"
        await self._valkey.set(
            key,
            json.dumps(record),
            ex=self._access_ttl,
        )

    async def _load_and_refresh_session(
        self, session_id: str
    ) -> dict[str, Any] | None:
        """Load session and extend its TTL (sliding expiry)."""
        key = f"{SESSION_KEY_PREFIX}{session_id}"
        raw = await self._valkey.getex(key, ex=self._access_ttl)
        if raw is None:
            return None
        return json.loads(raw)  # type: ignore[no-any-return]

    async def _load_session(self, session_id: str) -> dict[str, Any] | None:
        key = f"{SESSION_KEY_PREFIX}{session_id}"
        raw = await self._valkey.get(key)
        if raw is None:
            return None
        return json.loads(raw)  # type: ignore[no-any-return]

    async def _delete_session(self, session_id: str) -> None:
        key = f"{SESSION_KEY_PREFIX}{session_id}"
        await self._valkey.delete(key)
