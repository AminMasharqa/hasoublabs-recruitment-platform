"""Supported locales, Accept-Language negotiation, and text direction.

Two of the three supported locales are RTL, so direction is a first-class
attribute of a locale rather than a special case (Localization constraint).
"""

from __future__ import annotations

from typing import Final, Literal

from babel.core import negotiate_locale as _babel_negotiate

#: Locale codes the platform serves. Order is the fallback order.
SUPPORTED_LOCALES: Final[tuple[str, ...]] = ("en", "ar", "he")

#: Used whenever nothing better can be negotiated.
DEFAULT_LOCALE: Final[str] = "en"

#: Right-to-left locales (Arabic, Hebrew).
RTL_LOCALES: Final[frozenset[str]] = frozenset({"ar", "he"})

TextDirection = Literal["ltr", "rtl"]

_MAX_ACCEPT_LANGUAGE_LENGTH: Final[int] = 512
_DEFAULT_QUALITY: Final[float] = 1.0


def is_supported(locale: str | None) -> bool:
    """Return whether ``locale`` is one of the served locales."""
    return locale is not None and locale.lower() in SUPPORTED_LOCALES


def normalize_locale(locale: str | None) -> str | None:
    """Reduce a language tag such as ``he-IL`` or ``ar_JO`` to a served locale.

    Returns ``None`` when the tag cannot be served.
    """
    if not locale:
        return None
    tag = locale.strip().replace("_", "-").lower()
    if not tag:
        return None
    primary = tag.split("-", 1)[0]
    return primary if primary in SUPPORTED_LOCALES else None


def parse_accept_language(header: str | None) -> list[str]:
    """Parse an ``Accept-Language`` header into tags ordered by descending ``q``.

    Malformed segments are skipped rather than raising: a bad header must never
    fail a request, it just means we fall back to the default locale.
    """
    if not header:
        return []
    # Bound the work an untrusted header can cause.
    header = header[:_MAX_ACCEPT_LANGUAGE_LENGTH]
    scored: list[tuple[float, int, str]] = []
    for index, part in enumerate(header.split(",")):
        segment = part.strip()
        if not segment:
            continue
        tag, _, params = segment.partition(";")
        tag = tag.strip()
        if not tag:
            continue
        quality = _DEFAULT_QUALITY
        for param in params.split(";"):
            key, _, value = param.partition("=")
            if key.strip().lower() != "q":
                continue
            try:
                quality = float(value.strip())
            except ValueError:
                quality = _DEFAULT_QUALITY
        if quality <= 0:
            continue  # q=0 means "explicitly not acceptable"
        scored.append((quality, -index, tag))
    scored.sort(reverse=True)
    return [tag for _, _, tag in scored]


def negotiate_locale(
    accept_language: str | None = None,
    account_preference: str | None = None,
) -> str:
    """Resolve the response locale.

    Precedence (design: One Error Envelope): the account's stored language
    preference, then ``Accept-Language``, then English.
    """
    preferred = normalize_locale(account_preference)
    if preferred is not None:
        return preferred

    candidates = parse_accept_language(accept_language)
    if candidates:
        matched = _babel_negotiate(
            [tag.replace("-", "_") for tag in candidates],
            list(SUPPORTED_LOCALES),
            sep="_",
        )
        normalized = normalize_locale(matched)
        if normalized is not None:
            return normalized
        # Fall back to a primary-subtag match (e.g. "he-IL" → "he").
        for tag in candidates:
            normalized = normalize_locale(tag)
            if normalized is not None:
                return normalized

    return DEFAULT_LOCALE


def text_direction(locale: str | None) -> TextDirection:
    """Return the writing direction for ``locale``."""
    return "rtl" if normalize_locale(locale) in RTL_LOCALES else "ltr"


def fallback_chain(locale: str | None) -> tuple[str, ...]:
    """Return the lookup order for a message: requested locale, then English."""
    normalized = normalize_locale(locale)
    if normalized is None or normalized == DEFAULT_LOCALE:
        return (DEFAULT_LOCALE,)
    return (normalized, DEFAULT_LOCALE)
