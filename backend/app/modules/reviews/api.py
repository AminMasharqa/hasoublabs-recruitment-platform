"""ReviewsApi — minimal cross-module contract for the reviews module (R9, Section 20).

No cross-module interface is required for Wave C. This stub defines the Protocol
for forward compatibility with Wave D (reporting), which will need to query
aggregate review data.

Other modules must import only from this file (``api.py``) or ``schemas.py``.
Never import ``models.py``, ``repository.py``, or ``service.py`` directly.
"""

from __future__ import annotations

from typing import Any, Protocol, runtime_checkable


@runtime_checkable
class ReviewsApi(Protocol):
    """Cross-module interface for the reviews domain.

    Reserved for Wave D (reporting). Currently a no-op Protocol stub.
    """

    # Reserved for Wave D (reporting integration).
    # Methods will be added here when the reporting module needs review aggregates.


class DefaultReviewsApi:
    """Default implementation of :class:`ReviewsApi`.

    Injected via ``app.state.reviews_api`` during application startup.

    Args:
        uow_factory: Zero-argument callable that returns a new UnitOfWork.
                     Reserved for Wave D methods.
    """

    def __init__(self, uow_factory: Any) -> None:  # noqa: ANN401
        self._uow_factory = uow_factory


__all__ = ["DefaultReviewsApi", "ReviewsApi"]
