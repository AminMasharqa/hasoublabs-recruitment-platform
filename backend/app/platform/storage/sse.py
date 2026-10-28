"""Server-side-encryption wiring for CV objects (Task 6.2, R5 AC16).

Design decision (design, "Encryption at rest", R5 AC16): CV *objects* are
encrypted at rest with **MinIO SSE-KMS backed by OpenBao**. This is server-side
encryption — MinIO encrypts each object under a per-object key that it in turn
wraps with an External Key held by the KMS; OpenBao is that KMS. The application
never sees plaintext data keys and never performs the encryption itself.

That is a deliberately different mechanism from the *application-level*
AES-256-GCM envelope encryption used for national IDs and residency proofs
(R2 AC15), which lives under ``app/platform/security`` and is out of scope here.
The only thing this module owns is the two app-side responsibilities of SSE-KMS:

1. Name the correct KMS External Key id, and
2. Request SSE-KMS on the CV write paths.

Both are expressed through the storage seam's opaque :class:`SseSpec`
(``app.platform.storage.base``); translating an :class:`SseSpec` into the
concrete ``minio`` SDK object happens in :mod:`app.platform.storage.minio_store`,
so this file stays free of any SDK import and callers in ``cvs/`` get "the CV
encryption key" without knowing OpenBao exists.

OpenBao seam
------------
Because SSE-KMS is server-side, MinIO — not this application — talks to OpenBao
to resolve the External Key; that binding is deployment/infra configuration
(the MinIO server's KES/KMS settings), not app code. The app-side contract is
therefore just "reference the key id and ask for encryption", which is fully
satisfied here with no OpenBao client call.

The one app-side interaction that *could* exist is asserting the External Key
already exists in OpenBao at startup. A read-only client for that is not yet
available (Section 3's OpenBao access lands with Karim's work), so
:func:`ensure_cv_kms_key` is a contract-faithful seam that documents the check
and no-ops until an ``OpenBaoKmsProbe`` is injected — the same "thread the shape,
don't block on the dependency" approach Task 6.1 used for the ``sse`` argument.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Protocol, runtime_checkable

from app.platform.storage.base import SseSpec

if TYPE_CHECKING:
    from app.config import Settings

__all__ = [
    "OpenBaoKmsProbe",
    "cv_sse_spec",
    "cv_sse_spec_from_config",
    "ensure_cv_kms_key",
]


def cv_sse_spec(*, kms_key_id: str) -> SseSpec:
    """Build the SSE-KMS request for CV objects under ``kms_key_id``.

    Kept separate from the config reader so callers holding only a key id (for
    example a test, or a future per-bucket key scheme) can construct the spec
    directly.

    Args:
        kms_key_id: The KMS External Key id MinIO should encrypt the object
            under. Empty or blank is a programming error, not a runtime input.

    Returns:
        An :class:`SseSpec` naming the key with no extra encryption context. No
        per-object context is set: CV objects share one External Key, and the
        object key already scopes the ciphertext, so an encryption context would
        add key-management surface without a security gain here.

    Raises:
        ValueError: If ``kms_key_id`` is empty or whitespace.
    """
    if not kms_key_id or not kms_key_id.strip():
        msg = "kms_key_id must be a non-empty KMS key identifier"
        raise ValueError(msg)
    return SseSpec(kms_key_id=kms_key_id)


def cv_sse_spec_from_config(settings: Settings) -> SseSpec:
    """Build the default CV :class:`SseSpec` from application config.

    The CV External Key id is :attr:`Settings.openbao_transit_key`
    (``"hasoub-data-key"`` by default). Reusing that setting keeps a single
    source of truth for "the OpenBao key custody identity" and means the ``cvs/``
    module asks for encryption without ever importing an OpenBao detail
    (R5 AC16, design "Encryption at rest").

    Args:
        settings: The application settings singleton.

    Returns:
        The :class:`SseSpec` every CV write should carry.
    """
    return cv_sse_spec(kms_key_id=settings.openbao_transit_key)


@runtime_checkable
class OpenBaoKmsProbe(Protocol):
    """Minimal read-only probe for the CV External Key's existence in OpenBao.

    A contract-faithful seam (Task 6.2). SSE-KMS is server-side, so the
    application does not encrypt or fetch keys; the only useful app-side check is
    a startup assertion that the External Key MinIO will reference actually
    exists, turning a later per-upload KMS failure into a loud boot failure.

    OpenBao client access is not yet wired (Section 3), so this Protocol defines
    the shape without binding an implementation. Inject a conforming probe once
    available; until then :func:`ensure_cv_kms_key` no-ops.
    """

    def key_exists(self, key_id: str) -> bool:
        """Return whether an External Key named ``key_id`` exists in OpenBao."""
        ...


async def ensure_cv_kms_key(
    settings: Settings,
    *,
    probe: OpenBaoKmsProbe | None = None,
) -> None:
    """Assert the CV SSE-KMS External Key exists, when a probe is available.

    App-side responsibility for SSE-KMS is only naming the key and requesting
    encryption; MinIO resolves the key against OpenBao itself. This optional
    startup assertion exists so a missing/misnamed key fails at boot rather than
    on the first candidate upload.

    With no ``probe`` injected (the current state — Section 3's OpenBao access is
    not yet available) this is a deliberate no-op seam, not a silent skip: the
    key id is still the single value threaded onto every CV write.

    Args:
        settings: The application settings singleton (source of the key id).
        probe: A read-only OpenBao probe. ``None`` no-ops (seam not yet wired).

    Raises:
        ValueError: If the probe reports the configured External Key is missing.
    """
    if probe is None:
        # TODO(section-3): inject an OpenBaoKmsProbe once OpenBao client access
        # lands so a missing CV External Key fails loudly at startup (R5 AC16).
        return
    key_id = settings.openbao_transit_key
    if not probe.key_exists(key_id):
        msg = f"CV SSE-KMS External Key {key_id!r} not found in OpenBao"
        raise ValueError(msg)
