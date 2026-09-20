"""Declarative base and shared column conventions for the platform layer.

PROVISIONAL OWNERSHIP NOTE
--------------------------
``app/platform/db`` belongs to Section 2 (database, Unit of Work, migrations —
Khalid). This file is the *minimum* needed by the Section 5 platform tables
(``outbox_emails``, ``notifications``, ``job_dead_letters``) and is deliberately
tiny so Section 2 can replace it wholesale without touching any importer:
callers depend only on ``Base``, ``TimestampMixin``, ``UuidPkMixin``,
``UtcTimestampMs`` and ``utc_now``. ``alembic/env.py`` already expects
``app.platform.db.base.Base``, so the import path is the one Task 1 assumed.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
import uuid

from sqlalchemy import MetaData, Uuid, func, text
from sqlalchemy.dialects.postgresql import JSONB, TIMESTAMP
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

# Index/constraint naming per the coding standards: idx_/uq_/ck_/fk_/pk_.
NAMING_CONVENTION: dict[str, str] = {
    "ix": "idx_%(table_name)s_%(column_0_N_name)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}

#: All timestamps are UTC with millisecond precision (design: Data Models).
#: The PostgreSQL dialect type is used because the generic ``TIMESTAMP`` has no
#: precision argument, and ``timestamptz(3)`` is the column the design specifies.
UtcTimestampMs = TIMESTAMP(timezone=True, precision=3)


def utc_now() -> datetime:
    """Return the current UTC instant truncated to millisecond precision."""
    now = datetime.now(UTC)
    return now.replace(microsecond=(now.microsecond // 1000) * 1000)


class Base(DeclarativeBase):
    """Declarative base shared by every ORM model in the codebase."""

    metadata = MetaData(naming_convention=NAMING_CONVENTION)

    type_annotation_map = {
        datetime: UtcTimestampMs,
        uuid.UUID: Uuid(as_uuid=True),
        dict[str, Any]: JSONB,
    }


class UuidPkMixin:
    """UUID primary key generated in the database when not supplied."""

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True,
        default=uuid.uuid4,
        server_default=text("gen_random_uuid()"),
    )


class TimestampMixin:
    """``created_at`` / ``updated_at`` in UTC with millisecond precision."""

    created_at: Mapped[datetime] = mapped_column(
        default=utc_now,
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        default=utc_now,
        onupdate=utc_now,
        server_default=func.now(),
        nullable=False,
    )
