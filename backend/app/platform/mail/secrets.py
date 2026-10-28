"""Short-lived secret store for values that must never reach the database.

A Verification_Code is the motivating case. The outbox row has to exist inside
the registration transaction (atomicity), but the code plaintext must not be
persisted: only an HMAC digest of it lives in ``email_verifications``, and a
plaintext copy sitting in an outbox payload would survive in backups long after
the code expired.

So the outbox stores a *reference*, the plaintext lives in Valkey under a TTL
slightly longer than the delivery SLA, and the renderer redeems the reference at
send time. Redemption is destructive (``GETDEL``): a second read cannot recover
the code, so a leaked outbox row is worthless on its own.
"""

from __future__ import annotations

from abc import abstractmethod
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
import secrets as pysecrets
from typing import TYPE_CHECKING, Final, Protocol, runtime_checkable

if TYPE_CHECKING:
    from redis.asyncio import Redis

#: Default lifetime: comfortably above the 60-second verification-code SLA and
#: the 5-minute application-confirmation SLA, short enough to be forgettable.
DEFAULT_SECRET_TTL: Final[timedelta] = timedelta(minutes=30)

_REF_BYTES: Final[int] = 16


@runtime_checkable
class ShortLivedSecretStore(Protocol):
    """Put-once, read-once store for send-time secrets."""

    @abstractmethod
    async def put(self, value: str, *, ttl: timedelta = DEFAULT_SECRET_TTL) -> str:
        """Store ``value`` and return an opaque reference."""
        ...

    @abstractmethod
    async def pop(self, ref: str) -> str | None:
        """Redeem and delete ``ref``; ``None`` when it expired or never existed."""
        ...


class ValkeySecretStore:
    """:class:`ShortLivedSecretStore` backed by Valkey."""

    def __init__(self, redis: Redis, *, key_prefix: str = "mailsecret") -> None:
        self._redis = redis
        self._prefix = key_prefix

    def _key(self, ref: str) -> str:
        return f"{self._prefix}:{ref}"

    async def put(self, value: str, *, ttl: timedelta = DEFAULT_SECRET_TTL) -> str:
        ref = pysecrets.token_urlsafe(_REF_BYTES)
        await self._redis.set(self._key(ref), value, px=max(1000, int(ttl.total_seconds() * 1000)))
        return ref

    async def pop(self, ref: str) -> str | None:
        raw = await self._redis.getdel(self._key(ref))
        if raw is None:
            return None
        return raw.decode("utf-8") if isinstance(raw, bytes | bytearray) else str(raw)


@dataclass
class InMemorySecretStore:
    """In-process :class:`ShortLivedSecretStore` for tests and local runs."""

    _values: dict[str, tuple[str, datetime]] = field(default_factory=dict)

    async def put(self, value: str, *, ttl: timedelta = DEFAULT_SECRET_TTL) -> str:
        ref = pysecrets.token_urlsafe(_REF_BYTES)
        self._values[ref] = (value, datetime.now(UTC) + ttl)
        return ref

    async def pop(self, ref: str) -> str | None:
        entry = self._values.pop(ref, None)
        if entry is None:
            return None
        value, expires_at = entry
        return None if datetime.now(UTC) > expires_at else value

    def clear(self) -> None:
        self._values.clear()
