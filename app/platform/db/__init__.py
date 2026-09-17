"""Platform database layer.

Owned by Section 2 (Khalid): async engine, session factory, ``UnitOfWork``,
Alembic harness. Section 5 added only ``base.py`` (declarative ``Base``) because
the platform tables it ships need somewhere to hang their metadata.
"""

from app.platform.db.base import (
    Base,
    TimestampMixin,
    UtcTimestampMs,
    UuidPkMixin,
    utc_now,
)

__all__ = ["Base", "TimestampMixin", "UtcTimestampMs", "UuidPkMixin", "utc_now"]
