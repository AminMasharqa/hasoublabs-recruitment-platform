"""Localization: Babel catalogs, locale negotiation, and text direction.

Public surface used by the rest of the platform and by domain modules:

    from app.platform.i18n import translate, negotiate_locale, text_direction
"""

from app.platform.i18n.catalog import (
    has_message,
    known_keys,
    reload_catalogs,
    translate,
)
from app.platform.i18n.locales import (
    DEFAULT_LOCALE,
    RTL_LOCALES,
    SUPPORTED_LOCALES,
    TextDirection,
    is_supported,
    negotiate_locale,
    normalize_locale,
    parse_accept_language,
    text_direction,
)

__all__ = [
    "DEFAULT_LOCALE",
    "RTL_LOCALES",
    "SUPPORTED_LOCALES",
    "TextDirection",
    "has_message",
    "is_supported",
    "known_keys",
    "negotiate_locale",
    "normalize_locale",
    "parse_accept_language",
    "reload_catalogs",
    "text_direction",
    "translate",
]
