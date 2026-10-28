"""Errors raised by the skill taxonomy.

The resolver is *total* for any term that denotes a skill — it always either
resolves the term or stores and flags it (Property 21). The only rejected input
is one that normalizes to nothing (no letters, digits, or marks), which cannot
be a skill at all; that is surfaced as a field-level :class:`ValidationFailed`
so it renders through the one error envelope like every other input error.
"""

from __future__ import annotations

from app.platform.errors.base import FieldViolation, ValidationFailed

__all__ = ["EmptySkillTerm"]


class EmptySkillTerm(ValidationFailed):  # noqa: N818 - taxonomy input error
    """A skill term that normalized to the empty string was submitted."""

    def __init__(self, raw_term: str, *, field_path: str = "skill") -> None:
        """Create the error.

        Args:
            raw_term: The offending term as entered (logged, never serialized).
            field_path: JSON-pointer-style path to attach the violation to.
        """
        super().__init__(
            fields=[FieldViolation(path=field_path, code="empty_skill_term")],
            log_message=f"skill term normalized to empty: {raw_term!r}",
        )
