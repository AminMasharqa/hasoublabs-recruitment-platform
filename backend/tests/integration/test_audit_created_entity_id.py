"""A ``<Entity>.created`` audit entry names the entity it created (R8 AC2, AC4, AC6).

The audit hook runs in ``before_flush``. A pending row's primary key comes from
``UuidPkMixin``'s Python-side ``default=uuid.uuid4``, which SQLAlchemy applies only
*during* the flush; and the hook read the id from ``InstanceState.identity``, which
is ``None`` for every pending object. Every ``*.created`` entry was therefore
written with ``entity_id = 'unknown'`` — 100% of them in the dev database — so a
creation could not be found by entity identifier, nor an entity's history replayed
from its first entry.

Runs against ``alembic upgrade head`` through the real ``UnitOfWork``.
"""

from __future__ import annotations

from typing import TYPE_CHECKING
import uuid

import pytest
from sqlalchemy import text

from app.platform.db.unit_of_work import UnitOfWork
from app.platform.taxonomy.models import Skill

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

pytestmark = pytest.mark.integration

_CREATED = text(
    "SELECT entity_id, after FROM audit_log "
    "WHERE action = 'Skill.created' AND after ->> 'normalized_name' = :norm"
)


async def _created_entries(
    sessionmaker: async_sessionmaker[AsyncSession], norm: str
) -> list[tuple[str, dict[str, object]]]:
    async with sessionmaker() as session:
        rows = (await session.execute(_CREATED, {"norm": norm})).all()
    return [(row.entity_id, row.after) for row in rows]


async def test_created_entry_carries_the_generated_primary_key(
    pg_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    norm = f"audit-pk-{uuid.uuid4().hex[:10]}"

    async with UnitOfWork(pg_sessionmaker) as uow:
        skill = Skill(name={"en": "Audit PK"}, normalized_name=norm)
        uow.session.add(skill)
    created_id = str(skill.id)

    entries = await _created_entries(pg_sessionmaker, norm)
    assert [entity_id for entity_id, _ in entries] == [created_id]
    # The snapshot carries the same identifier, so replay can start from it (AC6).
    assert entries[0][1]["id"] == created_id


async def test_created_entry_carries_an_explicitly_assigned_primary_key(
    pg_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    norm = f"audit-pk-{uuid.uuid4().hex[:10]}"
    explicit = uuid.uuid4()

    async with UnitOfWork(pg_sessionmaker) as uow:
        uow.session.add(Skill(id=explicit, name={"en": "Audit PK"}, normalized_name=norm))

    entries = await _created_entries(pg_sessionmaker, norm)
    assert [entity_id for entity_id, _ in entries] == [str(explicit)]
