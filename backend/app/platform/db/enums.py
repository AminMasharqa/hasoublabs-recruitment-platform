"""Shared domain enumerations (Task 2.2).

Every native PostgreSQL ``ENUM`` used by more than one domain module lives here,
in one place, so the type is declared once and referenced everywhere (design:
Data Models → Enumerations). This is the file the conflict-avoidance rules call a
"hotspot": other owners request additions via a small PR rather than editing it
in parallel.

Two conventions apply to every enum below:

* The Python member **values** are the exact strings the design specifies, and
  ``pg_enum(...)`` uses ``values_callable`` so PostgreSQL stores those values
  (e.g. ``'Pending'``), never the Python member *names* (``PENDING``). This keeps
  the database rows readable and matches the design's tables verbatim.
* Each enum is exposed both as a ``StrEnum`` (for use in Pydantic schemas, service
  logic, and comparisons) and as a prebuilt SQLAlchemy ``Enum`` instance named
  ``<enum>_type`` (for use in ``mapped_column``). Models import the ``_type``
  instance so the same native type object is reused rather than re-declared.

Platform-internal enums (e.g. ``outbox_email_state``, ``notification_type``) are
intentionally *not* here — they are declared with the single table that uses
them, per the note in ``mail/models.py`` and ``notifications/models.py``.
"""

from __future__ import annotations

from enum import StrEnum

from sqlalchemy import Enum as SaEnum


def pg_enum(enum_cls: type[StrEnum], name: str) -> SaEnum:
    """Build a native PostgreSQL ``ENUM`` that stores member *values*.

    Using ``values_callable`` (rather than SQLAlchemy's default of storing the
    member *names*) makes the stored value equal to ``member.value`` — the string
    the design specifies.
    """
    return SaEnum(
        enum_cls,
        name=name,
        values_callable=lambda enum: [member.value for member in enum],
    )


# ── Identity, roles, and account lifecycle (R1, R2, R3) ───────────────────────


class Role(StrEnum):
    """The three platform roles (R1 AC1)."""

    ADMIN = "ADMIN"
    CANDIDATE = "CANDIDATE"
    SENIOR = "SENIOR"


class AccountStatus(StrEnum):
    """The single lifecycle state an account holds at all times (R1 AC18)."""

    PENDING_VERIFICATION = "PendingVerification"
    PENDING_APPROVAL = "PendingApproval"
    APPROVED_PENDING_MEETING = "ApprovedPendingMeeting"
    APPROVED = "Approved"
    REJECTED = "Rejected"
    SUSPENDED = "Suspended"
    DEACTIVATED = "Deactivated"


class EmailVerificationState(StrEnum):
    """State of an account's email-verification record (R2)."""

    PENDING_CODE = "PendingCode"
    VERIFIED = "Verified"
    EXPIRED = "Expired"


class ResidencyProofType(StrEnum):
    """The kind of residency proof stored for an account (R2 AC2)."""

    MOBILE_PHONE = "MobilePhone"
    NATIONAL_ID = "NationalId"
    ADDRESS = "Address"


# ── Candidate profile (R4) ────────────────────────────────────────────────────


class EnrolmentStatus(StrEnum):
    """Education-entry enrolment status (R4 AC1)."""

    ENROLLED = "Enrolled"
    GRADUATED = "Graduated"


class ProfileState(StrEnum):
    """Candidate profile completeness classification (R4 AC6)."""

    DRAFT = "Draft"
    COMPLETE = "Complete"


# ── Senior profile / contact preferences (R4A) ────────────────────────────────


class ContactChannelPref(StrEnum):
    """How, if at all, a Senior may be contacted about jobs (R4A AC1)."""

    CHAT = "Chat"
    EMAIL = "Email"
    BOTH = "Both"
    NONE = "None"


class ContactScopePref(StrEnum):
    """Which Job_Descriptions a Senior is contactable for (R4A AC2)."""

    OWN_POSTINGS_ONLY = "OwnPostingsOnly"
    SAME_COMPANY = "SameCompany"
    FIELD_OF_EXPERTISE = "FieldOfExpertise"


# ── CV variants and versions (R5) ─────────────────────────────────────────────


class CvVersionState(StrEnum):
    """Availability state of a stored CV version (R5 AC3)."""

    PENDING_SCAN = "PendingScan"
    AVAILABLE = "Available"
    QUARANTINED = "Quarantined"


# ── Job descriptions (R6) ─────────────────────────────────────────────────────


class JdStatus(StrEnum):
    """One-way Job_Description lifecycle (R6 AC2)."""

    DRAFT = "Draft"
    OPEN = "Open"
    CLOSED = "Closed"


class WorkModel(StrEnum):
    """Job_Description work model (R6 AC1)."""

    ONSITE = "Onsite"
    HYBRID = "Hybrid"
    REMOTE = "Remote"


class EmploymentType(StrEnum):
    """Job_Description employment type (R6 AC1)."""

    FULL_TIME = "Full-time"
    PART_TIME = "Part-time"
    CONTRACT = "Contract"
    FREELANCE = "Freelance"
    INTERNSHIP = "Internship"


class ExperienceLevel(StrEnum):
    """Job_Description experience band (R6 AC1)."""

    JUNIOR = "Junior-level"
    MID = "Mid-level"
    SENIOR = "Senior-level"
    LEAD = "Lead"


class ApplicationChannel(StrEnum):
    """Routing configured on a Job_Description for applications (R6 AC15)."""

    SENIOR_DASHBOARD = "Senior_Dashboard"
    ADMIN_DASHBOARD = "Admin_Dashboard"
    EXTERNAL_CAREERS_URL = "External_Careers_URL"


# ── Applications (R7) ─────────────────────────────────────────────────────────


class ApplicationStatus(StrEnum):
    """Status of an in-platform Application (R7 AC6)."""

    SUBMITTED = "Submitted"
    UNDER_REVIEW = "Under Review"
    FORWARDED_TO_RECRUITER = "Forwarded to Recruiter"
    CLOSED = "Closed"


#: The non-terminal Application statuses, defined **once** here so the same set
#: backs the duplicate-prevention partial unique index predicate
#: ``WHERE status IN ('Submitted','Under Review')`` (R7 AC7) and any service-layer
#: check. Defining it in two places is how the two silently drift apart.
NON_TERMINAL_APPLICATION_STATUSES: frozenset[ApplicationStatus] = frozenset(
    {ApplicationStatus.SUBMITTED, ApplicationStatus.UNDER_REVIEW}
)


# ── Prebuilt SQLAlchemy ENUM instances ────────────────────────────────────────
# Models import these so every table reuses the same native type object.

role_type = pg_enum(Role, "role")
account_status_type = pg_enum(AccountStatus, "account_status")
email_verification_state_type = pg_enum(EmailVerificationState, "email_verification_state")
residency_proof_type_type = pg_enum(ResidencyProofType, "residency_proof_type")
enrolment_status_type = pg_enum(EnrolmentStatus, "enrolment_status")
profile_state_type = pg_enum(ProfileState, "profile_state")
contact_channel_pref_type = pg_enum(ContactChannelPref, "contact_channel_pref")
contact_scope_pref_type = pg_enum(ContactScopePref, "contact_scope_pref")
cv_version_state_type = pg_enum(CvVersionState, "cv_version_state")
jd_status_type = pg_enum(JdStatus, "jd_status")
work_model_type = pg_enum(WorkModel, "work_model")
employment_type_type = pg_enum(EmploymentType, "employment_type")
experience_level_type = pg_enum(ExperienceLevel, "experience_level")
application_channel_type = pg_enum(ApplicationChannel, "application_channel")
application_status_type = pg_enum(ApplicationStatus, "application_status")


__all__ = [
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
    "account_status_type",
    "application_channel_type",
    "application_status_type",
    "contact_channel_pref_type",
    "contact_scope_pref_type",
    "cv_version_state_type",
    "email_verification_state_type",
    "employment_type_type",
    "enrolment_status_type",
    "experience_level_type",
    "jd_status_type",
    "pg_enum",
    "profile_state_type",
    "residency_proof_type_type",
    "role_type",
    "work_model_type",
]
