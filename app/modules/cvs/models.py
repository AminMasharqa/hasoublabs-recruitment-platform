"""ORM models for the CVs module (R5, Task 14.1).

Tables:
- cv_variants: named variant containers per Candidate account
- cv_versions: immutable uploaded-file records per variant
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    BigInteger,
    Boolean,
    Index,
    Integer,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
    event,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship, validates

from app.platform.db.base import Base, TimestampMixin, UuidPkMixin, utc_now
from app.platform.db.enums import CvVersionState, cv_version_state_type

if TYPE_CHECKING:
    pass

# ── CvVariant ────────────────────────────────────────────────────────────────


class CvVariant(Base, UuidPkMixin, TimestampMixin):
    """A named CV variant container owned by one Candidate account (R5 AC1).

    A Candidate may hold up to five non-archived variants, each with a distinct
    name among the active (non-archived) set.

    The UniqueConstraint on (account_id, name) is a hard DB constraint; the
    service layer additionally enforces uniqueness among *active* variants and
    raises ConflictingState before the DB can fire the constraint.
    """

    __tablename__ = "cv_variants"

    account_id: Mapped[uuid.UUID] = mapped_column(
        nullable=False,
        index=True,
    )

    name: Mapped[str] = mapped_column(String(100), nullable=False)

    description: Mapped[str | None] = mapped_column(String(300), default=None)

    is_primary: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    is_archived: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # ── Relationships ──────────────────────────────────────────────────────
    versions: Mapped[list[CvVersion]] = relationship(
        "CvVersion",
        back_populates="variant",
        lazy="select",
        order_by="CvVersion.version_number",
    )

    # ── Table constraints and indexes ──────────────────────────────────────
    __table_args__ = (
        # Soft unique: the service layer enforces name uniqueness among active
        # variants; this hard constraint prevents duplicate names at the DB level.
        UniqueConstraint("account_id", "name", name="uq_cv_variants_account_id_name"),
        # Fast lookup of the primary active variant for an account (download,
        # application submission). Only one row per account can satisfy this,
        # enforced by set_primary_variant.
        Index(
            "idx_cv_variants_account_id_is_primary",
            "account_id",
            "is_primary",
            postgresql_where="is_primary = TRUE AND is_archived = FALSE",
        ),
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<CvVariant {self.id} account={self.account_id} name={self.name!r}>"


# ── CvVersion ─────────────────────────────────────────────────────────────────


#: Fields that must never change after initial write.  The DB trigger (in the
#: migration) enforces this at the database level; the @validates decorator
#: below enforces it in Python so tests catch violations without a live DB.
_IMMUTABLE_FIELDS = frozenset(
    {"object_key", "sha256_digest", "size_bytes", "version_number", "variant_id"}
)


class CvVersion(Base, UuidPkMixin):
    """An immutable uploaded-file record belonging to one CvVariant (R5 AC2).

    Once a row is inserted, the fields listed in ``_IMMUTABLE_FIELDS`` must
    never be modified.  Two enforcement layers exist:

    1. ``@validates`` (Python-level) — catches changes inside the ORM session.
    2. A BEFORE UPDATE trigger (DB-level) — catches any direct SQL UPDATE.

    Mutable fields are limited to ``state``, ``scan_result``, ``scanned_at``
    and ``bucket`` (bucket changes when a scan-clean version is promoted from
    quarantine to available).
    """

    __tablename__ = "cv_versions"

    variant_id: Mapped[uuid.UUID] = mapped_column(
        nullable=False,
        index=True,
    )

    version_number: Mapped[int] = mapped_column(Integer, nullable=False)

    object_key: Mapped[str] = mapped_column(String(512), nullable=False)

    object_version_id: Mapped[str | None] = mapped_column(String(255), default=None)

    bucket: Mapped[str] = mapped_column(String(100), nullable=False)

    sha256_digest: Mapped[bytes] = mapped_column(LargeBinary(32), nullable=False)

    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)

    mime_type: Mapped[str] = mapped_column(String(100), nullable=False)

    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)

    state: Mapped[CvVersionState] = mapped_column(
        cv_version_state_type,
        default=CvVersionState.PENDING_SCAN,
        nullable=False,
    )

    scan_result: Mapped[str | None] = mapped_column(Text, default=None)

    scanned_at: Mapped[datetime | None] = mapped_column(default=None)

    created_at: Mapped[datetime] = mapped_column(
        default=utc_now,
        nullable=False,
    )

    # ── Relationships ──────────────────────────────────────────────────────
    variant: Mapped[CvVariant] = relationship(
        "CvVariant",
        back_populates="versions",
        lazy="select",
    )

    # ── Table constraints ──────────────────────────────────────────────────
    __table_args__ = (
        # Hard constraint: each version_number is used exactly once per variant.
        UniqueConstraint(
            "variant_id",
            "version_number",
            name="uq_cv_versions_variant_id_version_number",
        ),
    )

    # ── Immutability guard (Python-level) ──────────────────────────────────

    @validates(*_IMMUTABLE_FIELDS)
    def _guard_immutable(self, key: str, value: object) -> object:
        """Raise if an immutable field is changed after the initial INSERT."""
        current = getattr(self, key, None)
        # Allow the first assignment (current is None / 0 for default-less fields).
        # We use SQLAlchemy's instance state to distinguish new vs. persistent.
        from sqlalchemy import inspect  # noqa: PLC0415

        state = inspect(self)
        if not state.transient and not state.pending:
            # The object is already in the session (persistent or detached).
            if current is not None and current != value:
                msg = (
                    f"CvVersion.{key} is immutable once set; "
                    f"attempted to change {current!r} → {value!r}"
                )
                raise ValueError(msg)
        return value

    def __repr__(self) -> str:  # pragma: no cover
        return (
            f"<CvVersion {self.id} variant={self.variant_id} "
            f"v{self.version_number} state={self.state}>"
        )
