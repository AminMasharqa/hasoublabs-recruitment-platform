"""The Background Job Catalog: job names and the cron-style schedules.

One enum of job names shared by producers and the worker, so an enqueue can
never reference a job the worker does not register (the failure mode of
stringly-typed queues). Every entry mirrors a row of the design's Background Job
Catalog table, including the requirement it serves.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Final


class JobName(StrEnum):
    """Every background job in Phase 1."""

    SEND_VERIFICATION_EMAIL = "send_verification_email"
    DRAIN_EMAIL_OUTBOX = "drain_email_outbox"
    EXPIRE_VERIFICATION_CODES = "expire_verification_codes"
    SCAN_CV = "scan_cv"
    VERIFY_CV_CHECKSUMS = "verify_cv_checksums"
    VERIFY_AUDIT_CHAIN = "verify_audit_chain"
    CREATE_AUDIT_PARTITION = "create_audit_partition"
    EXTRACT_JD_FROM_URL = "extract_jd_from_url"
    EXTRACT_JD_FROM_TEXT = "extract_jd_from_text"
    GENERATE_EXPORT = "generate_export"
    APPLY_RETENTION_POLICY = "apply_retention_policy"
    REFRESH_REPORT_ROLLUPS = "refresh_report_rollups"


@dataclass(frozen=True, slots=True)
class Schedule:
    """A recurring trigger for one job.

    Exactly one of ``interval_seconds`` or ``cron`` is set. ``granularity_seconds``
    is the width of the de-duplication slot: the scheduler derives the job's
    idempotency key from the current slot, so two nodes that briefly both believe
    they hold the leader lock still enqueue the *same* job id, and the queue
    collapses them.
    """

    job: JobName
    description: str
    requirement: str
    interval_seconds: int | None = None
    cron: dict[str, str | int] | None = None

    def __post_init__(self) -> None:
        if (self.interval_seconds is None) == (self.cron is None):
            msg = f"{self.job}: set exactly one of interval_seconds or cron"
            raise ValueError(msg)

    @property
    def granularity_seconds(self) -> int:
        return self.interval_seconds if self.interval_seconds is not None else 60


#: Cron-style schedules driven by APScheduler inside the worker process. Jobs not
#: listed here are event-triggered (upload, user request, outbox insert).
SCHEDULES: Final[tuple[Schedule, ...]] = (
    Schedule(
        job=JobName.DRAIN_EMAIL_OUTBOX,
        description="Claim and send pending outbox emails",
        requirement="Phase 1 Notifications, R7 AC12 (<=5 min)",
        interval_seconds=10,
    ),
    Schedule(
        job=JobName.EXPIRE_VERIFICATION_CODES,
        description="Expire verification codes past their 72-hour TTL",
        requirement="R1 AC17, R2 AC10",
        interval_seconds=300,
    ),
    Schedule(
        job=JobName.VERIFY_AUDIT_CHAIN,
        description="Walk a window of the audit hash chain and verify it",
        requirement="R8 AC8",
        cron={"minute": 5},
    ),
    Schedule(
        job=JobName.CREATE_AUDIT_PARTITION,
        # Daily rather than monthly: the DDL is idempotent, so a daily tick
        # self-heals a missed run instead of leaving audit_log without a
        # partition for the coming month — which would fail every insert.
        description="Ensure this month's and next month's audit_log partitions exist",
        requirement="R8 (audit_log monthly partitioning)",
        cron={"hour": 0, "minute": 10},
    ),
    Schedule(
        job=JobName.VERIFY_CV_CHECKSUMS,
        description="Nightly sweep re-hashing stored CV objects",
        requirement="R5 AC15",
        cron={"hour": 2, "minute": 15},
    ),
    Schedule(
        job=JobName.APPLY_RETENTION_POLICY,
        description="Apply the declarative retention policy table",
        requirement="Data Retention",
        cron={"hour": 3, "minute": 30},
    ),
    Schedule(
        job=JobName.REFRESH_REPORT_ROLLUPS,
        description="Refresh optional report materialized views",
        requirement="R28",
        cron={"minute": 20},
    ),
)

SCHEDULES_BY_JOB: Final[dict[JobName, Schedule]] = {
    schedule.job: schedule for schedule in SCHEDULES
}

#: Catalogued jobs that no module registers a handler for yet.
#:
#: This is the same idea as ``PUBLIC_ROUTE_PATHS`` in the security guards: the
#: gap is declared in one place so the boot-time check can tell a known gap from
#: a wiring mistake, and so the list of what is still missing is greppable.
#:
#: Two consequences for anything named here:
#:   * the worker reports it at boot but does not refuse to start;
#:   * the scheduler does not enqueue it — a job with no handler would otherwise
#:     fail on every tick and bury real errors in the worker log.
#:
#: Removing a name from this set is part of landing its handler.
#:
#: ``apply_retention_policy`` needs the declarative
#: ``(entity, retention_basis, minimum_period, action)`` policy table from the
#: design's Data Retention Model, which no migration creates yet. It is a
#: feature, not a wiring gap, and it anonymises candidate data — so it stays
#: unregistered rather than becoming a handler that silently does nothing.
UNIMPLEMENTED_JOBS: Final[frozenset[JobName]] = frozenset(
    {
        JobName.APPLY_RETENTION_POLICY,
    }
)
