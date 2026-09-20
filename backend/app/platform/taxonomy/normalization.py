"""Pure normalization of entered skill terms.

A candidate or JD may type a skill in any casing, spacing, or punctuation style
("React.js", " react ", "REACT"). Before it is compared against the
Skill_Taxonomy — or, on no match, stored linked to a normalized form for Admin
review (R4 AC2, AC3) — the raw term is reduced to a canonical *normalized* key
by :func:`normalize_skill_term`.

The transform is deliberately pure and side-effect-free so tests can hit it
directly, and it is **idempotent by construction**: ``normalize(normalize(x))``
equals ``normalize(x)`` for every input (Property 21). Ordering is what makes it
hold: **NFKC runs before case fold**. NFKC compatibility decomposition can
*produce* cased Latin letters from symbols (e.g. ``㋎`` → ``eV``, ``ℐ`` → ``I``),
so folding must happen *after* NFKC or those letters would be left un-folded and
a second pass would change them. Running it in this order, the output is a fixed
point: re-applying NFKC to already-NFKC-then-folded text is a no-op, folding
already-folded text is a no-op, the punctuation strip removes a fixed Unicode
category class the output no longer contains, and whitespace collapse leaves
single ASCII spaces a second pass cannot collapse further. Removing punctuation
and collapsing spaces never creates new composable sequences, so the string
stays NFKC-normalized after those steps.

TRILINGUAL SAFETY (critical)
----------------------------
The platform stores Arabic and Hebrew byte-identical and never transliterates
(design: Localization). This function therefore only removes punctuation and
whitespace and applies Unicode NFKC + case fold; it never strips, maps, or
transliterates letters of any script. ``str.casefold`` is a no-op for scripts
without case (Arabic, Hebrew), so a term written in those scripts survives
unchanged except for surrounding/duplicated whitespace and punctuation.

KNOWN LIMITATION — symbol-significant skill names (spec-literal behaviour)
-------------------------------------------------------------------------
Because step 3 strips *all* punctuation and symbols, names that differ only by a
symbol collapse to the same key: ``C``, ``C++`` and ``C#`` all normalize to
``"c"``, and ``.NET`` normalizes to ``"net"``. Since ``skills.normalized_name``
(and ``skill_aliases.normalized_alias``) are UNIQUE, such names cannot coexist as
distinct canonical skills keyed by their normalized form.

This is the design's specified normalization (NFKC, case fold, trim, punctuation
strip) applied literally, and is kept as-is by decision (2024, sprint Wave A):
the seed taxonomy (Task 7.2) does not yet need C/C++/C# as distinct entries. If
that changes, the fix is a curated allowlist of skill-significant symbols kept
during the strip step — a change to be signed off by the taxonomy/design owner,
not made ad hoc here.
"""

from __future__ import annotations

import unicodedata

__all__ = ["normalize_skill_term", "normalize_text"]

#: Unicode general-category prefixes treated as "punctuation or symbol" and
#: removed. ``P*`` is every punctuation category (``Pc Pd Pe Pf Pi Po Ps``) and
#: ``S*`` every symbol category (``Sc Sk Sm So``). Letters (``L*``), marks
#: (``M*`` — e.g. Arabic/Hebrew combining marks) and numbers (``N*``) are always
#: kept, so no letter of any script is ever dropped.
_STRIP_CATEGORY_PREFIXES: tuple[str, ...] = ("P", "S")


def _is_stripped_punctuation(char: str) -> bool:
    """Return whether a single character is punctuation/symbol to be removed."""
    return unicodedata.category(char).startswith(_STRIP_CATEGORY_PREFIXES)


def normalize_text(text: str) -> str:
    """Reduce arbitrary human text to its canonical normalized lookup key.

    The pure, script-safe, idempotent core transform shared by every normalized
    lookup on the platform (skill terms — :func:`normalize_skill_term` — and
    Israeli locality names in :mod:`app.platform.reference`). It applies, in
    order:

    1. **Unicode NFKC** — compatibility composition, so visually/​semantically
       equivalent code points (e.g. full-width forms, ligatures) collapse to one
       representation. Applied *before* case fold so any cased Latin letters it
       produces from compatibility symbols get folded (see module note).
    2. **Case fold** — aggressive lowercasing for caseless comparison; a no-op
       for scripts without case, so Arabic/Hebrew are untouched.
    3. **Punctuation strip** — every Unicode punctuation and symbol character is
       replaced by a space, so "React.js" and "react js" share a key while
       letters, combining marks, and digits of every script are preserved.
    4. **Trim** — surrounding whitespace stripped and internal whitespace runs
       collapsed to a single ASCII space.

    Args:
        text: The raw text as entered by any actor or produced by an extractor.

    Returns:
        The normalized key. Idempotent: applying it to its own output returns
        that output unchanged. May be the empty string if the input contained no
        letters, digits, or marks (e.g. ``"!!!"``).
    """
    # 1. NFKC compatibility composition (may expand symbols into cased letters).
    result = unicodedata.normalize("NFKC", text)

    # 2. Caseless folding, after NFKC so letters it produced are folded too
    #    (no-op for caseless scripts — Arabic/Hebrew safe).
    result = result.casefold()

    # 3. Replace punctuation/symbols with spaces (never touch letters/marks/digits).
    result = "".join(" " if _is_stripped_punctuation(ch) else ch for ch in result)

    # 4. Trim surrounding whitespace and collapse internal runs to one space.
    return " ".join(result.split())


def normalize_skill_term(term: str) -> str:
    """Reduce a raw skill term to its canonical normalized key.

    A thin, named alias over :func:`normalize_text` — skill lookup uses the
    shared core transform. Kept as its own name so call sites and the taxonomy's
    UNIQUE ``normalized_name`` semantics read in skill terms.

    Args:
        term: The raw term as entered by a Candidate, Senior, or extractor.

    Returns:
        The normalized key. Idempotent; may be the empty string if the input
        contained no letters, digits, or marks (e.g. ``"!!!"``).
    """
    return normalize_text(term)
