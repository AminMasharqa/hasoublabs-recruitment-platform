"""Babel message catalogs for API error strings, emails, and notifications.

The ``.po`` files under ``messages/`` are the source of truth and are read
directly with Babel at first use, so there is no ``.mo`` build step to forget in
CI or in a container image. Message ids are *stable machine keys*
(``error.rate_limited``, ``email.verification_code.subject``), never English
prose: the API contract carries the key and the localized message side by side,
so a translation change can never alter the contract (design: One Error
Envelope).
"""

from __future__ import annotations

from functools import lru_cache
import logging
from pathlib import Path
from typing import TYPE_CHECKING, Final

from babel.messages.pofile import read_po

from app.platform.i18n.locales import DEFAULT_LOCALE, fallback_chain

if TYPE_CHECKING:
    from collections.abc import Mapping

_LOG = logging.getLogger(__name__)

MESSAGES_DIR: Final[Path] = Path(__file__).parent / "messages"


@lru_cache(maxsize=len(("en", "ar", "he")) * 2)
def _catalog(locale: str) -> Mapping[str, str]:
    """Load and cache the message map for one locale."""
    path = MESSAGES_DIR / f"{locale}.po"
    if not path.exists():
        _LOG.warning("No message catalog for locale %s at %s", locale, path)
        return {}
    with path.open("rb") as handle:
        catalog = read_po(handle, locale=locale)
    return {
        str(message.id): str(message.string)
        for message in catalog
        if message.id and message.string
    }


def reload_catalogs() -> None:
    """Drop the in-process catalog cache (used by tests and by SIGHUP reloads)."""
    _catalog.cache_clear()


def has_message(key: str, locale: str | None = None) -> bool:
    """Return whether ``key`` resolves in ``locale`` or in the English fallback."""
    return any(key in _catalog(candidate) for candidate in fallback_chain(locale))


def translate(key: str, locale: str | None = None, /, **params: object) -> str:
    """Return the localized message for ``key``.

    Falls back to English and then to the key itself: a missing translation
    degrades to a machine-readable string rather than an empty response body or
    an exception on an error path.
    """
    template: str | None = None
    for candidate in fallback_chain(locale):
        template = _catalog(candidate).get(key)
        if template is not None:
            break
    if template is None:
        _LOG.warning("Missing message key %r (locale=%s)", key, locale or DEFAULT_LOCALE)
        return key
    if not params:
        return template
    try:
        return template.format(**params)
    except (KeyError, IndexError, ValueError):
        _LOG.warning("Message %r could not be formatted with %s", key, sorted(params))
        return template


def known_keys(locale: str = DEFAULT_LOCALE) -> frozenset[str]:
    """Return every message key defined for ``locale`` (used by catalog tests)."""
    return frozenset(_catalog(locale))
