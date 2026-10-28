"""Every error the API can raise has a message in all three catalogs.

The envelope's ``message`` is ``translate(error.message_key, locale)``. A key
missing from a catalog falls back to English and then to the key itself, so 27
domain errors (``error.mfa_required``, ``error.application_not_ready``, ...)
reached users as raw keys in every locale. The catalogs are documented as kept
key-for-key in sync; this enforces it for error keys.
"""

from __future__ import annotations

import importlib
import pkgutil

from babel.messages.pofile import read_po
import pytest

import app.modules
import app.platform
from app.platform.errors.base import PlatformError
from app.platform.i18n.catalog import MESSAGES_DIR

pytestmark = pytest.mark.unit

LOCALES = ("en", "ar", "he")


def _error_classes() -> list[type[PlatformError]]:
    for package in (app.modules, app.platform):
        for module in pkgutil.walk_packages(package.__path__, f"{package.__name__}."):
            if module.name.rsplit(".", 1)[-1] in {"errors", "base"}:
                importlib.import_module(module.name)

    found: list[type[PlatformError]] = []
    pending = [PlatformError]
    while pending:
        for subclass in pending.pop().__subclasses__():
            found.append(subclass)
            pending.append(subclass)
    return found


def _catalog_keys(locale: str) -> set[str]:
    with (MESSAGES_DIR / f"{locale}.po").open("rb") as handle:
        return {str(message.id) for message in read_po(handle) if message.id and message.string}


ERROR_KEYS = sorted({cls.message_key for cls in _error_classes()})


def test_the_error_classes_were_discovered() -> None:
    # Guards the guard: an import failure must not make the parity check vacuous.
    assert len(ERROR_KEYS) >= 30


@pytest.mark.parametrize("locale", LOCALES)
def test_every_error_key_has_a_message(locale: str) -> None:
    missing = [key for key in ERROR_KEYS if key not in _catalog_keys(locale)]
    assert missing == [], f"{locale}.po has no message for {missing}"
