"""Platform database layer (Section 2).

Owned by Section 2 (Salma): async engine, session factory, ``UnitOfWork``, the
shared domain enum types, and the Alembic harness. This package is the one-way
foundation every domain module imports; ``platform/*`` never imports a domain
module in return.

Public surface:

* ``Base`` / mixins / ``utc_now`` / ``UtcTimestampMs`` — declarative base and the
  shared column conventions (``base.py``).
* ``get_engine`` / ``get_sessionmaker`` / ``dispose_engine`` — the async engine
  and session factory singletons (``engine.py``).
* ``UnitOfWork`` — one-transaction-per-operation boundary (``unit_of_work.py``).
* ``get_session`` — request-scoped read session dependency for FastAPI
  (``session.py``).
* The shared domain enums and their prebuilt SQLAlchemy types (``enums.py``).
"""

from app.platform.db.base import (
    Base,
    TimestampMixin,
    UtcTimestampMs,
    UuidPkMixin,
    utc_now,
)
from app.platform.db.engine import dispose_engine, get_engine, get_sessionmaker
from app.platform.db.enums import (
    NON_TERMINAL_APPLICATION_STATUSES,
    AccountStatus,
    ApplicationChannel,
    ApplicationStatus,
    ContactChannelPref,
    ContactScopePref,
    CvVersionState,
    EmailVerificationState,
    EmploymentType,
    EnrolmentStatus,
    ExperienceLevel,
    JdStatus,
    ProfileState,
    ResidencyProofType,
    Role,
    WorkModel,
)
from app.platform.db.session import get_session
from app.platform.db.unit_of_work import UnitOfWork

__all__ = [
    # base
    "Base",
    "TimestampMixin",
    "UtcTimestampMs",
    "UuidPkMixin",
    "utc_now",
    # engine / session
    "dispose_engine",
    "get_engine",
    "get_session",
    "get_sessionmaker",
    # unit of work
    "UnitOfWork",
    # shared enums
    "NON_TERMINAL_APPLICATION_STATUSES",
    "AccountStatus",
    "ApplicationChannel",
    "ApplicationStatus",
    "ContactChannelPref",
    "ContactScopePref",
    "CvVersionState",
    "EmailVerificationState",
    "EmploymentType",
    "EnrolmentStatus",
    "ExperienceLevel",
    "JdStatus",
    "ProfileState",
    "ResidencyProofType",
    "Role",
    "WorkModel",
]
