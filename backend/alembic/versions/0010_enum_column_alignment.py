"""Align enum-valued columns with the native enum types the ORM maps them to.

Revision ID: 0010_enum_column_alignment
Revises: 0009b_mfa_wrapped_key
Create Date: 2026-09-22

Migrations 0003–0009 created every native enum type the design specifies
(``account_status``, ``role``, ``jd_status``, …) but declared the *columns* that
hold those values as ``VARCHAR``. The ORM maps the same columns to the enum type
(``mapped_column(account_status_type)``), so the two representations disagreed on
19 columns.

That is not cosmetic. asyncpg sends a bound enum parameter as ``$1::account_status``
and PostgreSQL has no ``character varying = account_status`` operator, so every
query that *compares* one of these columns to a bound parameter failed with::

    asyncpg.exceptions.UndefinedFunctionError: operator does not exist:
    character varying = account_status

``POST /verify/code`` returned 500 for exactly this reason, and so did the
``expire_verification_codes`` background job. Queries that only *select* an
affected column were unharmed, which is why most endpoints looked fine.

Two dependent objects need handling rather than a bare ``ALTER``:

* ``uq_applications_candidate_jd_non_terminal`` — a partial unique index whose
  predicate was built against ``varchar`` (``(status)::text = ANY (...)``).
  PostgreSQL refuses to rebuild it over the new type ("functions in index
  predicate must be marked IMMUTABLE", because the enum→text cast is only
  STABLE), so the index is dropped first and recreated with an enum predicate.
* ``ck_senior_profiles_…scope_required…`` — a CHECK constraint that compares
  ``contact_channel_pref`` to text. PostgreSQL *does* rebuild this one, keeping
  its ``(contact_channel_pref)::text = 'None'::text`` form, which stays correct
  against the enum. It is left alone deliberately: recreating it would mean
  reproducing the naming convention's truncated-and-hashed constraint name by
  hand for no behavioural gain.

The cast direction is safe without a data audit: every stored value in every
affected column was already a valid label of its target enum (verified against
the development database before writing this), and ``USING col::enum`` fails loudly
on any row that is not, rather than coercing it.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Final

from alembic import op

if TYPE_CHECKING:
    from collections.abc import Sequence

revision: str = "0010_enum_column_alignment"
down_revision: str | None = "0009b_mfa_wrapped_key"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


#: ``(table, column, enum_type, varchar_length, server_default)`` for every column
#: the ORM maps to a native enum but earlier migrations created as ``VARCHAR``.
#:
#: ``varchar_length`` and ``server_default`` are the values the column had before
#: this migration, recorded so :func:`downgrade` restores the column exactly as
#: 0003–0009 left it.
_COLUMNS: Final[tuple[tuple[str, str, str, int, str | None], ...]] = (
    ("accounts", "status", "account_status", 50, "PendingVerification"),
    ("account_status_transitions", "from_status", "account_status", 50, None),
    ("account_status_transitions", "to_status", "account_status", 50, None),
    ("email_verifications", "state", "email_verification_state", 30, "PendingCode"),
    ("residency_proofs", "type", "residency_proof_type", 30, None),
    ("registration_links", "role", "role", 20, None),
    ("candidate_profiles", "state", "profile_state", 20, "Draft"),
    ("candidate_education", "enrolment_status", "enrolment_status", 20, None),
    ("senior_profiles", "contact_channel_pref", "contact_channel_pref", 10, "None"),
    ("senior_profiles", "contact_scope_pref", "contact_scope_pref", 30, None),
    ("cv_versions", "state", "cv_version_state", 30, "PendingScan"),
    ("job_descriptions", "work_model", "work_model", 20, None),
    ("job_descriptions", "employment_type", "employment_type", 20, None),
    ("job_descriptions", "experience_level", "experience_level", 20, None),
    ("job_descriptions", "status", "jd_status", 10, "Draft"),
    ("job_descriptions", "application_channel", "application_channel", 30, None),
    ("applications", "status", "application_status", 50, "Submitted"),
    ("applications", "routed_channel", "application_channel", 30, None),
    ("report_exports", "status", "export_status", 10, "pending"),
)

#: The partial unique index that has to be rebuilt by hand (R7 AC7).
_APPLICATIONS_UNIQUE_INDEX: Final[str] = "uq_applications_candidate_jd_non_terminal"


def _retype(table: str, column: str, target_type: str, default: str | None) -> None:
    """Change one column's type, carrying its server default across."""
    if default is not None:
        # The old default is a varchar literal; it cannot survive the type change.
        op.execute(f'ALTER TABLE {table} ALTER COLUMN "{column}" DROP DEFAULT')
    op.execute(
        f'ALTER TABLE {table} ALTER COLUMN "{column}" TYPE {target_type}'
        f' USING "{column}"::{target_type}'
    )
    if default is not None:
        op.execute(
            f'ALTER TABLE {table} ALTER COLUMN "{column}"'
            f" SET DEFAULT '{default}'::{target_type}"
        )


def upgrade() -> None:
    # R7 AC7's partial unique index blocks the applications.status rewrite.
    op.execute(f"DROP INDEX {_APPLICATIONS_UNIQUE_INDEX}")

    for table, column, target_type, _length, default in _COLUMNS:
        _retype(table, column, target_type, default)

    # Recreated with an enum-typed predicate. Same semantics as before: at most one
    # non-terminal application per (candidate, jd) pair.
    op.execute(
        f"CREATE UNIQUE INDEX {_APPLICATIONS_UNIQUE_INDEX}"
        " ON applications (candidate_id, jd_id)"
        " WHERE status IN ('Submitted', 'Under Review')"
    )


def downgrade() -> None:
    op.execute(f"DROP INDEX {_APPLICATIONS_UNIQUE_INDEX}")

    for table, column, _target_type, length, default in _COLUMNS:
        if default is not None:
            op.execute(f'ALTER TABLE {table} ALTER COLUMN "{column}" DROP DEFAULT')
        op.execute(
            f'ALTER TABLE {table} ALTER COLUMN "{column}" TYPE VARCHAR({length})'
            f' USING "{column}"::text'
        )
        if default is not None:
            op.execute(
                f'ALTER TABLE {table} ALTER COLUMN "{column}" SET DEFAULT \'{default}\''
            )

    op.execute(
        f"CREATE UNIQUE INDEX {_APPLICATIONS_UNIQUE_INDEX}"
        " ON applications (candidate_id, jd_id)"
        " WHERE status IN ('Submitted', 'Under Review')"
    )
