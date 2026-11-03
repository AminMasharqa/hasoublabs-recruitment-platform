"""Platform-wide constants."""

from __future__ import annotations

from typing import Final
import uuid

SYSTEM_ACCOUNT_ID: Final[uuid.UUID] = uuid.UUID("00000000-0000-0000-0000-000000000001")
#: The UUID of the synthetic system account, used as the actor when no real
#: principal is acting (e.g., background jobs).
