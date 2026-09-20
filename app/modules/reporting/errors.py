"""Domain error types for the reporting module (R28, R29, Section 21)."""

from __future__ import annotations

from app.platform.errors.base import PlatformError


class UnsupportedEntityType(PlatformError):
    """422 — the requested export entity type is not supported."""

    error_key = "unsupported_entity_type"
    status_code = 422
    message_key = "error.unsupported_entity_type"

    def __init__(self, *, entity_type: str, **kwargs: object) -> None:
        super().__init__(details={"entity_type": entity_type}, **kwargs)  # type: ignore[arg-type]


class ExportNotReady(PlatformError):
    """202 — the export job is still processing; poll again later."""

    error_key = "export_not_ready"
    status_code = 202
    message_key = "error.export_not_ready"


class ExportFailed(PlatformError):
    """500 — the export job failed."""

    error_key = "export_failed"
    status_code = 500
    message_key = "error.export_failed"


__all__ = ["ExportFailed", "ExportNotReady", "UnsupportedEntityType"]
