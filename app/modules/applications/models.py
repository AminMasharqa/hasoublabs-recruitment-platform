"""ORM models for the applications module (R7, Section 18).

Tables:
- applications:                    One application per Candidate+JD pair (non-terminal)
- application_status_transitions:  Append-only status history (audit trail R7 AC14)
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship, validates

from app.platform.db.base import Base, TimestampMixin, UuidPkMixin, utc_now
from app.platform.db.enums import (
    ApplicationChannel,
    ApplicationStatus,
    application_channel_type,
    application_status_type,
)

if TYPE_CHECKING:
    pass


# ── Application ──────────────────────────────────────────────────────────────


#: The cv_version_id field is immutable after initial INSERT.  The @validates
#: decorator enforces this in the ORM layer; a BEFORE UPDATE trigger (declared
#: in the migration) enforces it at the database level (R7 AC5).
_IMMUTABLE_FIELDS = frozenset({"cv_version_id"})


class Application(Base, UuidPkMixin, TimestampMixin):
    """One application submitted by a Candidate for a Job_Description (R7).

    Invariants:
    - At most one non-terminal (Submitted or Under Review) application per
      (candidate_id, jd_id) pair. Enforced by a partial unique index (R7 AC7).
    - cv_version_id is immutable after the initial INSERT (R7 AC4, AC5).
    - routed_channel records the channel that was active at submission time and
      is never updated (R7 AC3).
    """

    __tablename__ = "applications"

    #: The applying candidate's account UUID.  String-ref FK; the FK constraint
    #: is declared here as a string so SQLAlchemy resolves it after all models
    #: are loaded, avoiding circular import issues between modules.
    candidate_id: Mapped[uuid.UUID] = mapped_column(
        nullable=False,
        index=True,
    )

    #: The target Job_Description UUID.
    jd_id: Mapped[uuid.UUID] = mapped_column(
        nullable=False,
        index=True,
    )

    #: The CV version that was attached at submission time — immutable (R7 AC4).
    cv_version_id: Mapped[uuid.UUID] = mapped_column(
        nullable=False,
    )

    #: Workflow status (R7 AC6): Submitted → Under Review → Forwarded to Recruiter
    #:                           Any non-terminal → Closed (via JD close cascade)
    status: Mapped[ApplicationStatus] = mapped_column(
        application_status_type,
        nullable=False,
        default=ApplicationStatus.SUBMITTED,
    )

    #: The channel resolved from the JD at submission time (R7 AC3).
    routed_channel: Mapped[ApplicationChannel] = mapped_column(
        application_channel_type,
        nullable=False,
    )

    #: UTC timestamp of initial submission.
    submitted_at: Mapped[datetime] = mapped_column(
        nullable=False,
        default=utc_now,
    )

    # ── Relationships ──────────────────────────────────────────────────────
    status_transitions: Mapped[list[ApplicationStatusTransition]] = relationship(
        "ApplicationStatusTransition",
        back_populates="application",
        lazy="select",
        order_by="ApplicationStatusTransition.occurred_at",
    )

    # ── Table constraints and indexes ──────────────────────────────────────
    __table_args__ = (
        # R7 AC7: prevents duplicate non-terminal applications for the same
        # (candidate, jd) pair. A partial unique index scoped to non-terminal
        # statuses allows a new application after a previous one is Closed.
        # NOTE: UniqueConstraint does not support postgresql_where; we must use
        # Index with unique=True and the postgresql_where clause.
        Index(
            "uq_applications_candidate_jd_non_terminal",
            "candidate_id",
            "jd_id",
            unique=True,
            postgresql_where=(
                "status IN ('Submitted', 'Under Review')"
            ),
        ),
        # Efficiently list all applicants for a JD filtered by status.
        Index(
            "idx_applications_jd_id_status",
            "jd_id",
            "status",
        ),
        # Support the 24-hour rate-limit window query (R7 AC13).
        Index(
            "idx_applications_candidate_id_submitted_at",
            "candidate_id",
            "submitted_at",
        ),
    )

    # ── Immutability guard (Python-level) ──────────────────────────────────

    @validates(*_IMMUTABLE_FIELDS)
    def _guard_immutable(self, key: str, value: object) -> object:
        """Raise ValueError if an immutable field is modified after initial set.

        The @validates decorator runs on every attribute assignment, including
        the initial INSERT. We use SQLAlchemy's instance inspection to
        distinguish new (transient/pending) from persisted (persistent/detached)
        instances so the first write is always allowed.
        """
        from sqlalchemy import inspect  # noqa: PLC0415

        current = getattr(self, key, None)
        state = inspect(self)
        if not state.transient and not state.pending:
            # Object is already persisted; reject any change to an immutable field.
            if current is not None and current != value:
                msg = (
                    f"Application.{key} is immutable once set; "
                    f"attempted to change {current!r} → {value!r}"
                )
                raise ValueError(msg)
        return value

    def __repr__(self) -> str:  # pragma: no cover
        return (
            f"<Application {self.id} candidate={self.candidate_id} "
            f"jd={self.jd_id} status={self.status}>"
        )


# ── ApplicationStatusTransition ───────────────────────────────────────────────


class ApplicationStatusTransition(Base, UuidPkMixin):
    """Append-only status-history entry for one Application (R7 AC14).

    Every status change — whether triggered by an Admin action or a JD close
    cascade — records who did it, when, and why. actor_account_id is stored
    as a plain UUID rather than a FK so deleted actor rows do not break the
    history.
    """

    __tablename__ = "application_status_transitions"

    application_id: Mapped[uuid.UUID] = mapped_column(
        nullable=False,
        index=True,
    )

    #: The status before the transition; None for the initial Submitted entry.
    from_status: Mapped[str | None] = mapped_column(String(50), default=None)

    #: The status after the transition.
    to_status: Mapped[str] = mapped_column(String(50), nullable=False)

    #: Who performed the action. Nullable (system cascade has no interactive actor).
    actor_account_id: Mapped[uuid.UUID | None] = mapped_column(default=None)

    #: Optional human-readable justification (e.g. rejection reason).
    reason: Mapped[str | None] = mapped_column(Text, default=None)

    #: UTC timestamp of the transition — set to utc_now() on creation.
    occurred_at: Mapped[datetime] = mapped_column(
        nullable=False,
        default=utc_now,
    )

    # ── Relationships ──────────────────────────────────────────────────────
    application: Mapped[Application] = relationship(
        "Application",
        back_populates="status_transitions",
        lazy="select",
    )

    def __repr__(self) -> str:  # pragma: no cover
        return (
            f"<ApplicationStatusTransition {self.id} "
            f"app={self.application_id} {self.from_status!r}→{self.to_status!r}>"
        )


__all__ = ["Application", "ApplicationStatusTransition"]
