"""ReportingApi — minimal cross-module contract for the reporting domain (R28, R29).

No other module currently consumes reporting data, so the Protocol is a stub
reserved for future integrations (e.g. a dashboard widget that embeds a
summary metric).
"""

from __future__ import annotations

from typing import Any, Protocol, runtime_checkable


@runtime_checkable
class ReportingApi(Protocol):
    """Cross-module interface for the reporting domain.

    Currently a no-op Protocol stub — no other Wave C/D module consumes
    reporting data.  Methods will be added here if reporting aggregates are
    ever needed by other modules.
    """


class DefaultReportingApi:
    """Default implementation of :class:`ReportingApi`.

    Injected via ``app.state.reporting_api`` during application startup.

    Args:
        uow_factory: Zero-argument callable returning a new UnitOfWork.
                     Reserved for future methods.
    """

    def __init__(self, uow_factory: Any) -> None:  # noqa: ANN401
        self._uow_factory = uow_factory


__all__ = ["DefaultReportingApi", "ReportingApi"]
