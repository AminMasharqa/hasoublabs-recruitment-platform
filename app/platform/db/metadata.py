"""Metadata aggregator for Alembic autogenerate (Task 2.1).

``Base.metadata`` only knows about a table once the module defining that table
has been imported. Alembic's ``env.py`` reads ``Base.metadata`` to diff the
schema, so it must import *every* model module first — otherwise autogenerate
sees an empty schema and would "helpfully" generate a migration that drops every
table.

This module is the single place that imports all ORM models. ``env.py`` imports
``target_metadata`` from here; each module owner adds their model import to the
appropriate list below in their own PR. Keeping the list here (rather than in
``env.py``) means migration wiring changes stay in the ``platform/db`` directory
that Section 2 owns, and the imports are available to tests and tooling too.

The imports are grouped and ordered platform-first, then domain modules in
dependency order, matching the build order in ``tasks.md``. Import order does not
affect autogenerate correctness (Alembic resolves foreign-key ordering itself),
but it documents the dependency structure.
"""

from __future__ import annotations

# ── Domain module tables (added as each module lands) ─────────────────────────
# Section 9 (Salma) — audit tables registered.
from app.modules.audit import models as _audit_models  # noqa: F401
from app.platform.db.base import Base

# ── Platform tables (Section 5, 6, 7) ─────────────────────────────────────────
# These are already implemented and merged; importing them registers their
# tables on Base.metadata.
from app.platform.jobs import models as _jobs_models  # noqa: F401
from app.platform.mail import models as _mail_models  # noqa: F401
from app.platform.notifications import models as _notifications_models  # noqa: F401

# Wave B domain modules (Sections 11, 14, 15) — uncommented as they land:
from app.modules.identity import models as _identity_models  # noqa: F401  (Section 11)
from app.modules.cvs import models as _cvs_models  # noqa: F401  (Section 14)
from app.modules.profiles import models as _profiles_models  # noqa: F401  (Section 15)
# Wave C modules (Sections 17, 18, 20)
from app.modules.jobs import models as _jobs_domain_models          # noqa: F401  (Section 17)
from app.modules.applications import models as _apps_models         # noqa: F401  (Section 18)
from app.modules.reviews import models as _reviews_models           # noqa: F401  (Section 20)
# Wave D module (Section 21)
from app.modules.reporting import models as _reporting_models  # noqa: F401  (Section 21)

#: The metadata object Alembic diffs against. Importing this module has the side
#: effect of registering every imported model's table on it.
target_metadata = Base.metadata


__all__ = ["target_metadata"]
