"""Keyset (cursor) pagination helpers — never ``OFFSET``.

``OFFSET`` makes deep pages cost O(offset) and, worse, silently skips or repeats
rows when the underlying set changes between requests. Both matter here: the
job list must stay inside the 3-second budget at any depth (R6 AC9) and the
audit search walks a 7-year table (R8 AC4).

Constraints callers must respect:

* The **last** sort key has to be unique (an id), otherwise ties make the
  boundary ambiguous and rows can be skipped.
* Sort columns must be ``NOT NULL`` for the rows being paged. Postgres orders
  NULLs at one end and the row-comparison predicate cannot express that
  positionally; page over a filtered set (e.g. only published jobs) instead.
"""

from __future__ import annotations

import base64
import binascii
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING, Any, Final, Generic, Literal, TypeVar
import uuid

import orjson
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import and_, or_

from app.platform.errors.base import FieldViolation, ValidationFailed

if TYPE_CHECKING:
    from collections.abc import Sequence

    from sqlalchemy import ColumnElement, Select, UnaryExpression
    from sqlalchemy.ext.asyncio import AsyncSession
    from sqlalchemy.orm import InstrumentedAttribute

T = TypeVar("T")

SortDirection = Literal["asc", "desc"]

DEFAULT_PAGE_SIZE: Final[int] = 20
MAX_PAGE_SIZE: Final[int] = 100


@dataclass(frozen=True, slots=True)
class SortKey:
    """One component of the sort order, and therefore of the cursor."""

    column: InstrumentedAttribute[Any]
    direction: SortDirection = "desc"

    @property
    def attribute_name(self) -> str:
        return str(self.column.key)


class PageRequest(BaseModel):
    """Cursor pagination query parameters.

    ``after`` walks forward in the declared sort order, ``before`` walks
    backward. Supplying both is a client error.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    after: str | None = None
    before: str | None = None
    page_size: int = Field(default=DEFAULT_PAGE_SIZE, ge=1, le=MAX_PAGE_SIZE)

    @property
    def backwards(self) -> bool:
        return self.before is not None

    @property
    def cursor_token(self) -> str | None:
        return self.before if self.backwards else self.after

    def validated(self) -> PageRequest:
        """Reject the ambiguous both-cursors case with a field-level error."""
        if self.after is not None and self.before is not None:
            raise ValidationFailed(
                fields=[FieldViolation(path="query.before", code="mutually_exclusive")]
            )
        return self


class PageMeta(BaseModel):
    """Pagination metadata returned alongside ``data``."""

    model_config = ConfigDict(frozen=True)

    page_size: int
    has_next: bool = False
    has_prev: bool = False
    next_cursor: str | None = None
    prev_cursor: str | None = None


@dataclass(frozen=True, slots=True)
class Page(Generic[T]):
    """One page of results plus its cursors."""

    items: tuple[T, ...]
    meta: PageMeta


# ── Cursor codec ──────────────────────────────────────────────────────────────
#
# A cursor is an opaque base64url payload of type-tagged sort-key values. It is
# opaque, not secret: it carries only values the caller already received. It is
# not signed, so a tampered cursor can only move the caller's own window inside
# a result set they are already authorized to read.

_TAG_STR: Final[str] = "s"
_TAG_INT: Final[str] = "i"
_TAG_FLOAT: Final[str] = "f"
_TAG_BOOL: Final[str] = "b"
_TAG_NONE: Final[str] = "z"
_TAG_DATETIME: Final[str] = "dt"
_TAG_UUID: Final[str] = "u"
_TAG_DECIMAL: Final[str] = "d"


def _encode_value(value: object) -> list[object]:
    if value is None:
        return [_TAG_NONE, None]
    if isinstance(value, bool):
        return [_TAG_BOOL, value]
    if isinstance(value, datetime):
        return [_TAG_DATETIME, value.isoformat()]
    if isinstance(value, uuid.UUID):
        return [_TAG_UUID, str(value)]
    if isinstance(value, Decimal):
        return [_TAG_DECIMAL, str(value)]
    if isinstance(value, int):
        return [_TAG_INT, value]
    if isinstance(value, float):
        return [_TAG_FLOAT, value]
    if isinstance(value, str):
        return [_TAG_STR, value]
    msg = f"Unsupported cursor value type: {type(value).__name__}"
    raise TypeError(msg)


def _decode_value(pair: Sequence[Any]) -> object:
    tag, raw = pair[0], pair[1]
    if tag == _TAG_NONE:
        return None
    if tag == _TAG_BOOL:
        return bool(raw)
    if tag == _TAG_DATETIME:
        return datetime.fromisoformat(str(raw))
    if tag == _TAG_UUID:
        return uuid.UUID(str(raw))
    if tag == _TAG_DECIMAL:
        return Decimal(str(raw))
    if tag == _TAG_INT:
        return int(raw)
    if tag == _TAG_FLOAT:
        return float(raw)
    if tag == _TAG_STR:
        return str(raw)
    msg = f"Unknown cursor tag: {tag!r}"
    raise ValueError(msg)


def encode_cursor(values: Sequence[Any]) -> str:
    """Encode sort-key values into an opaque cursor token."""
    payload = orjson.dumps([_encode_value(value) for value in values])
    return base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")


def decode_cursor(token: str, *, field_path: str = "query.after") -> tuple[Any, ...]:
    """Decode a cursor token, or raise :class:`ValidationFailed`."""
    try:
        padding = "=" * (-len(token) % 4)
        payload = base64.urlsafe_b64decode(token + padding)
        decoded = orjson.loads(payload)
        if not isinstance(decoded, list):
            raise TypeError(type(decoded).__name__)  # noqa: TRY301
        return tuple(_decode_value(pair) for pair in decoded)
    except (binascii.Error, orjson.JSONDecodeError, TypeError, ValueError, IndexError) as exc:
        raise ValidationFailed(
            fields=[FieldViolation(path=field_path, code="invalid_cursor")]
        ) from exc


def cursor_for(entity: object, keys: Sequence[SortKey]) -> str:
    """Build the cursor that points at ``entity`` in the given sort order."""
    return encode_cursor([getattr(entity, key.attribute_name) for key in keys])


# ── Statement construction ────────────────────────────────────────────────────


def _ordering(keys: Sequence[SortKey], *, backwards: bool) -> list[UnaryExpression[Any]]:
    clauses: list[UnaryExpression[Any]] = []
    for key in keys:
        descending = (key.direction == "desc") != backwards
        clauses.append(key.column.desc() if descending else key.column.asc())
    return clauses


def _boundary_predicate(
    keys: Sequence[SortKey],
    values: Sequence[Any],
    *,
    backwards: bool,
) -> ColumnElement[bool]:
    """Row-comparison predicate for "strictly past the cursor".

    Expanded as an OR of ANDs rather than a SQL row constructor because the sort
    directions may be mixed, which ``(a, b) > (:a, :b)`` cannot express.
    """
    if len(values) != len(keys):
        raise ValidationFailed(
            fields=[FieldViolation(path="query.after", code="invalid_cursor")]
        )
    alternatives: list[Any] = []
    for index, key in enumerate(keys):
        equalities = [
            keys[earlier].column == values[earlier] for earlier in range(index)
        ]
        descending = (key.direction == "desc") != backwards
        comparison = (
            key.column < values[index] if descending else key.column > values[index]
        )
        alternatives.append(and_(*equalities, comparison) if equalities else comparison)
    return or_(*alternatives)


def apply_keyset(
    stmt: Select[tuple[T]],
    keys: Sequence[SortKey],
    page: PageRequest,
) -> Select[tuple[T]]:
    """Apply the cursor predicate, ordering, and ``LIMIT n + 1`` to ``stmt``.

    One extra row is fetched so ``has_next`` is known without a second query.
    """
    if not keys:
        msg = "Keyset pagination requires at least one sort key"
        raise ValueError(msg)

    page = page.validated()
    token = page.cursor_token
    if token is not None:
        field_path = "query.before" if page.backwards else "query.after"
        values = decode_cursor(token, field_path=field_path)
        stmt = stmt.where(_boundary_predicate(keys, values, backwards=page.backwards))

    return stmt.order_by(*_ordering(keys, backwards=page.backwards)).limit(page.page_size + 1)


async def paginate(
    session: AsyncSession,
    stmt: Select[tuple[T]],
    keys: Sequence[SortKey],
    page: PageRequest,
) -> Page[T]:
    """Execute ``stmt`` as one keyset page of ORM entities."""
    page = page.validated()
    rows = list((await session.scalars(apply_keyset(stmt, keys, page))).all())

    has_more = len(rows) > page.page_size
    if has_more:
        rows = rows[: page.page_size]
    if page.backwards:
        rows.reverse()

    has_next = has_more if not page.backwards else page.before is not None
    has_prev = page.after is not None if not page.backwards else has_more

    return Page(
        items=tuple(rows),
        meta=PageMeta(
            page_size=page.page_size,
            has_next=has_next,
            has_prev=has_prev,
            next_cursor=cursor_for(rows[-1], keys) if rows and has_next else None,
            prev_cursor=cursor_for(rows[0], keys) if rows and has_prev else None,
        ),
    )
