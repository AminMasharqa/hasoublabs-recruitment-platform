"""CV domain services (R5, Task 14.3).

Three services:

* ``CvVariantService`` — variant CRUD, primary flag management, archiving.
* ``CvUploadService``  — validated upload pipeline: size/MIME/structure checks,
  SHA-256, quarantine PUT, version row creation, ARQ scan job enqueue.
* ``CvIntegrityService`` — per-download checksum verification and nightly sweep.
"""

from __future__ import annotations

import hashlib
import io
import logging
import zipfile
from typing import TYPE_CHECKING
from uuid import UUID

from app.platform.db.enums import CvVersionState
from app.platform.errors.base import ConflictingState, IntegrityViolation
from app.platform.notifications.models import NotificationType
from app.platform.security.errors import AuthorizationDenied

from app.modules.cvs import repository as repo
from app.modules.cvs.errors import (
    CvIntegrityError,
    CvLimitExceeded,
    CvUploadValidationFailed,
    LastVariantError,
)
from app.modules.cvs.schemas import CvUploadResponse, CvVariantDTO, CvVersionDTO

if TYPE_CHECKING:
    from app.platform.db.uow import UnitOfWork
    from app.platform.jobs.queue import TaskQueue
    from app.platform.storage.base import ObjectStore
    from app.modules.cvs.models import CvVariant, CvVersion

_LOG = logging.getLogger(__name__)


# ── Helpers ───────────────────────────────────────────────────────────────────


def _variant_to_dto(variant: CvVariant, version_count: int = 0) -> CvVariantDTO:
    return CvVariantDTO(
        id=variant.id,
        name=variant.name,
        description=variant.description,
        is_primary=variant.is_primary,
        is_archived=variant.is_archived,
        created_at=variant.created_at,
        version_count=version_count,
    )


def _version_to_dto(version: CvVersion) -> CvVersionDTO:
    return CvVersionDTO(
        id=version.id,
        variant_id=version.variant_id,
        version_number=version.version_number,
        state=version.state.value,
        mime_type=version.mime_type,
        original_filename=version.original_filename,
        size_bytes=version.size_bytes,
        created_at=version.created_at,
    )


def _validate_pdf(data: bytes) -> bool:
    """Return True if ``data`` is a valid, non-encrypted PDF."""
    try:
        import pikepdf  # noqa: PLC0415

        with pikepdf.open(io.BytesIO(data)):
            return True
    except Exception:  # noqa: BLE001
        return False


def _validate_docx(data: bytes) -> bool:
    """Return True if ``data`` is a valid OOXML .docx file."""
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            return "word/document.xml" in z.namelist()
    except Exception:  # noqa: BLE001
        return False


# ── CvVariantService ──────────────────────────────────────────────────────────


class CvVariantService:
    """Manages CRUD operations on CvVariant rows (R5 AC1)."""

    MAX_VARIANTS: int = 5

    def __init__(self, uow_factory: type[UnitOfWork]) -> None:
        self._uow_factory = uow_factory

    async def create_variant(
        self,
        account_id: UUID,
        name: str,
        description: str | None = None,
    ) -> CvVariantDTO:
        """Create a new variant.

        Raises:
            CvLimitExceeded: If the account already has MAX_VARIANTS active variants.
            ConflictingState: If a non-archived variant with the same name exists.
        """
        async with self._uow_factory() as uow:
            count = await repo.count_active_variants(uow.session, account_id)
            if count >= self.MAX_VARIANTS:
                raise CvLimitExceeded(
                    log_message=(
                        f"Account {account_id} already has {count} active variants "
                        f"(limit={self.MAX_VARIANTS})"
                    )
                )

            # Check name uniqueness among active variants
            existing = await repo.list_variants(uow.session, account_id)
            if any(v.name.lower() == name.lower() for v in existing):
                raise ConflictingState(
                    log_message=f"Active variant named {name!r} already exists for {account_id}"
                )

            variant = await repo.create_variant(
                uow.session,
                account_id=account_id,
                name=name,
                description=description,
            )
            # First variant becomes primary automatically
            if count == 0:
                await repo.set_primary_variant(uow.session, account_id, variant.id)
                variant.is_primary = True

            return _variant_to_dto(variant, version_count=0)

    async def list_variants(self, account_id: UUID) -> list[CvVariantDTO]:
        """Return all active variants with their version counts."""
        async with self._uow_factory() as uow:
            variants = await repo.list_variants(uow.session, account_id)
            result = []
            for variant in variants:
                versions = await repo.list_versions(uow.session, variant.id)
                result.append(_variant_to_dto(variant, version_count=len(versions)))
            return result

    async def update_variant(
        self,
        variant_id: UUID,
        account_id: UUID,
        *,
        name: str | None,
        description: str | None,
    ) -> CvVariantDTO:
        """Update mutable fields on a variant.

        Raises:
            AuthorizationDenied: If the variant does not belong to the account.
            ConflictingState: If the new name collides with an existing active variant.
        """
        async with self._uow_factory() as uow:
            variant = await repo.get_variant(
                uow.session, variant_id, account_id=account_id
            )
            if variant is None or variant.is_archived:
                raise AuthorizationDenied()

            if name is not None and name.lower() != variant.name.lower():
                # Check name uniqueness
                existing = await repo.list_variants(uow.session, account_id)
                if any(
                    v.id != variant_id and v.name.lower() == name.lower()
                    for v in existing
                ):
                    raise ConflictingState(
                        log_message=f"Active variant named {name!r} already exists for {account_id}"
                    )

            await repo.update_variant(uow.session, variant, name=name, description=description)
            versions = await repo.list_versions(uow.session, variant.id)
            return _variant_to_dto(variant, version_count=len(versions))

    async def set_primary(self, variant_id: UUID, account_id: UUID) -> CvVariantDTO:
        """Designate a variant as primary, clearing the flag on all others.

        Raises:
            AuthorizationDenied: If the variant does not belong to the account.
        """
        async with self._uow_factory() as uow:
            variant = await repo.get_variant(
                uow.session, variant_id, account_id=account_id
            )
            if variant is None or variant.is_archived:
                raise AuthorizationDenied()

            await repo.set_primary_variant(uow.session, account_id, variant_id)
            variant.is_primary = True
            versions = await repo.list_versions(uow.session, variant.id)
            return _variant_to_dto(variant, version_count=len(versions))

    async def archive_variant(self, variant_id: UUID, account_id: UUID) -> None:
        """Archive a variant, reassigning primary if necessary.

        Raises:
            AuthorizationDenied: If the variant does not belong to the account.
            LastVariantError: If this is the account's only active variant.
        """
        async with self._uow_factory() as uow:
            variant = await repo.get_variant(
                uow.session, variant_id, account_id=account_id
            )
            if variant is None or variant.is_archived:
                raise AuthorizationDenied()

            count = await repo.count_active_variants(uow.session, account_id)
            if count <= 1:
                raise LastVariantError(
                    log_message=(
                        f"Cannot archive the last active variant {variant_id} "
                        f"for account {account_id}"
                    )
                )

            # If this was the primary, promote a replacement
            if variant.is_primary:
                replacement = await repo._find_replacement_primary(
                    uow.session, account_id, exclude_variant_id=variant_id
                )
                if replacement is not None:
                    await repo.set_primary_variant(
                        uow.session, account_id, replacement.id
                    )

            await repo.archive_variant(uow.session, variant)


# ── CvUploadService ───────────────────────────────────────────────────────────


class CvUploadService:
    """Handles the validated CV upload pipeline (R5 AC2, AC3).

    Upload pipeline:
    1. Validate size ≤ 10 MB.
    2. Detect MIME type via libmagic (content-based, not extension).
    3. Validate structural integrity (PDF or DOCX).
    4. Compute SHA-256.
    5. Verify variant ownership.
    6. Allocate version number (SELECT … FOR UPDATE).
    7. PUT to quarantine bucket.
    8. INSERT cv_versions row (state=PendingScan).
    9. Enqueue scan_cv ARQ job.
    10. Return 202-style response DTO.
    """

    MAX_SIZE_BYTES: int = 10 * 1024 * 1024  # 10 MB

    ALLOWED_MIME_TYPES: frozenset[str] = frozenset(
        {
            "application/pdf",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        }
    )

    def __init__(
        self,
        uow_factory: type[UnitOfWork],
        *,
        object_store: ObjectStore,
        available_bucket: str,
        quarantine_bucket: str,
        arq_queue: TaskQueue,
    ) -> None:
        self._uow_factory = uow_factory
        self._object_store = object_store
        self._available_bucket = available_bucket
        self._quarantine_bucket = quarantine_bucket
        self._arq_queue = arq_queue

    # ── Upload ─────────────────────────────────────────────────────────────

    async def upload(
        self,
        account_id: UUID,
        variant_id: UUID,
        *,
        filename: str,
        content_type: str,
        data: bytes,
    ) -> CvUploadResponse:
        """Validate, store, and enqueue a CV upload.

        Args:
            account_id: The uploading candidate's account UUID.
            variant_id: Target variant UUID.
            filename: Original client filename (stored for display).
            content_type: MIME type from the request Content-Type header.
            data: Raw file bytes.

        Returns:
            A ``CvUploadResponse`` with the new version DTO and a status message.

        Raises:
            CvUploadValidationFailed: On any validation failure.
            AuthorizationDenied: If the variant does not belong to the account.
        """
        # ── Step 1: Size check (before any I/O) ────────────────────────────
        if len(data) > self.MAX_SIZE_BYTES:
            raise CvUploadValidationFailed(
                log_message=(
                    f"Upload size {len(data)} bytes exceeds limit "
                    f"{self.MAX_SIZE_BYTES} bytes"
                )
            )

        # ── Step 2: MIME detection (content-based) ─────────────────────────
        try:
            import magic  # noqa: PLC0415

            detected_mime = magic.from_buffer(data, mime=True)
        except Exception as exc:  # noqa: BLE001
            raise CvUploadValidationFailed(
                log_message=f"MIME detection failed: {exc}"
            ) from exc

        if detected_mime not in self.ALLOWED_MIME_TYPES:
            raise CvUploadValidationFailed(
                log_message=(
                    f"Detected MIME {detected_mime!r} is not in the allowed set; "
                    f"filename={filename!r}"
                )
            )

        # ── Step 3: Structural integrity check ─────────────────────────────
        if detected_mime == "application/pdf":
            if not _validate_pdf(data):
                raise CvUploadValidationFailed(
                    log_message=f"PDF structural validation failed for {filename!r}"
                )
        else:
            # DOCX
            if not _validate_docx(data):
                raise CvUploadValidationFailed(
                    log_message=f"DOCX structural validation failed for {filename!r}"
                )

        # ── Step 4: SHA-256 digest ──────────────────────────────────────────
        sha256_digest = hashlib.sha256(data).digest()

        # ── Steps 5-9: Transactional pipeline ─────────────────────────────
        async with self._uow_factory() as uow:
            # Step 5: Verify variant ownership
            variant = await repo.get_variant(
                uow.session, variant_id, account_id=account_id
            )
            if variant is None or variant.is_archived:
                raise AuthorizationDenied()

            # Step 6: Allocate version number (serialised via FOR UPDATE)
            version_number = await repo.allocate_version_number(
                uow.session, variant_id
            )

            # Step 7: PUT to quarantine bucket
            object_key = (
                f"cv/{account_id}/{variant_id}/v{version_number}/{filename}"
            )
            try:
                put_result = await self._object_store.put_object(
                    bucket=self._quarantine_bucket,
                    key=object_key,
                    data=data,
                    content_type=detected_mime,
                )
            except Exception as exc:  # noqa: BLE001
                _LOG.error(
                    "Object store PUT failed for %s: %s",
                    object_key,
                    exc,
                    exc_info=True,
                )
                raise

            # Step 8: INSERT cv_versions row
            version = await repo.create_version(
                uow.session,
                variant_id=variant_id,
                version_number=version_number,
                object_key=object_key,
                object_version_id=put_result.version_id or None,
                bucket=self._quarantine_bucket,
                sha256_digest=sha256_digest,
                size_bytes=len(data),
                mime_type=detected_mime,
                original_filename=filename,
            )
            version_id = version.id

            # Step 9: Enqueue ARQ scan job
            from app.platform.jobs.catalog import JobName  # noqa: PLC0415

            await self._arq_queue.enqueue(
                JobName.SCAN_CV,
                version_id=str(version_id),
                idempotency_key=f"scan_cv:{version_id}",
            )

            return CvUploadResponse(version=_version_to_dto(version))

    # ── Scan completion ─────────────────────────────────────────────────────

    async def complete_scan(
        self,
        version_id: UUID,
        *,
        is_clean: bool,
        scan_result: str,
    ) -> None:
        """Process the ClamAV scan result for a version (R5 AC3).

        If clean: copy quarantine → available bucket, set state=Available.
        If infected: keep in quarantine, set state=Quarantined.
        Either way: push an in-app notification to the candidate and all admins.

        Args:
            version_id: The UUID of the CvVersion being completed.
            is_clean: True if the scan found no threats.
            scan_result: The raw ClamAV result string (e.g. "OK" or threat name).
        """
        from app.platform.db.base import utc_now as _utc_now  # noqa: PLC0415
        from app.platform.notifications.service import push  # noqa: PLC0415

        async with self._uow_factory() as uow:
            version = await repo.get_version(uow.session, version_id)
            if version is None:
                _LOG.error("complete_scan: version %s not found", version_id)
                return

            # Load variant to retrieve account_id for notification
            variant = await repo.get_variant(uow.session, version.variant_id)
            if variant is None:
                _LOG.error(
                    "complete_scan: variant %s not found for version %s",
                    version.variant_id,
                    version_id,
                )
                return

            account_id = variant.account_id
            scanned_at = _utc_now()

            if is_clean:
                # Promote: server-side copy quarantine → available
                dest_key = version.object_key  # same key, different bucket
                try:
                    await self._object_store.copy_object(
                        source_bucket=self._quarantine_bucket,
                        source_key=version.object_key,
                        dest_bucket=self._available_bucket,
                        dest_key=dest_key,
                        source_version_id=version.object_version_id,
                    )
                except Exception as exc:  # noqa: BLE001
                    _LOG.error(
                        "Quarantine→available copy failed for version %s: %s",
                        version_id,
                        exc,
                        exc_info=True,
                    )
                    raise

                await repo.update_version_scan(
                    uow.session,
                    version,
                    state=CvVersionState.AVAILABLE,
                    scan_result=scan_result,
                    scanned_at=scanned_at,
                )
                # Bucket update (not covered by update_version_scan)
                await repo.promote_version(
                    uow.session,
                    version,
                    object_key=dest_key,
                    bucket=self._available_bucket,
                )
            else:
                await repo.update_version_scan(
                    uow.session,
                    version,
                    state=CvVersionState.QUARANTINED,
                    scan_result=scan_result,
                    scanned_at=scanned_at,
                )

            # Push in-app notification to candidate
            push(
                uow.session,
                recipient_account_id=account_id,
                notification_type=NotificationType.CV_INTEGRITY_ISSUE
                if not is_clean
                else NotificationType.CV_INTEGRITY_ISSUE,  # same type; candidate sees scan status
                entity_type="CvVersion",
                entity_id=version_id,
            )


# ── CvIntegrityService ────────────────────────────────────────────────────────


class CvIntegrityService:
    """CV file integrity verification (R5 AC15).

    Two entry points:
    * ``verify_download_integrity`` — called on each download to confirm the
      streamed bytes match the stored SHA-256 digest.
    * ``run_nightly_sweep`` — background task that re-hashes every Available
      version and raises an alert for any mismatch.
    """

    def __init__(
        self,
        uow_factory: type[UnitOfWork],
        *,
        object_store: ObjectStore,
    ) -> None:
        self._uow_factory = uow_factory
        self._object_store = object_store

    async def verify_download_integrity(
        self,
        version: CvVersion,
        data: bytes,
    ) -> bool:
        """Return True if the SHA-256 of ``data`` matches the stored digest.

        Args:
            version: The CvVersion row whose digest is the expected value.
            data: The bytes retrieved from the object store.
        """
        computed = hashlib.sha256(data).digest()
        return computed == version.sha256_digest

    async def run_nightly_sweep(self) -> dict[str, int]:
        """Verify every Available CV version and push alerts for mismatches.

        Returns a summary dict suitable for logging.
        """
        from app.platform.notifications.service import push  # noqa: PLC0415

        checked = 0
        ok = 0
        failed = 0

        async with self._uow_factory() as uow:
            pairs = await repo.list_all_available_versions(uow.session)
            for version, account_id in pairs:
                checked += 1
                try:
                    stream = await self._object_store.get_object(
                        bucket=version.bucket,
                        key=version.object_key,
                        version_id=version.object_version_id,
                    )
                    async with stream as s:
                        data = await s.read()
                except Exception as exc:  # noqa: BLE001
                    _LOG.error(
                        "Nightly sweep: could not retrieve version %s: %s",
                        version.id,
                        exc,
                    )
                    failed += 1
                    push(
                        uow.session,
                        recipient_account_id=account_id,
                        notification_type=NotificationType.CV_INTEGRITY_ISSUE,
                        entity_type="CvVersion",
                        entity_id=version.id,
                    )
                    continue

                if hashlib.sha256(data).digest() != version.sha256_digest:
                    _LOG.error(
                        "Nightly sweep: checksum mismatch for version %s "
                        "(account=%s, key=%s)",
                        version.id,
                        account_id,
                        version.object_key,
                    )
                    failed += 1
                    push(
                        uow.session,
                        recipient_account_id=account_id,
                        notification_type=NotificationType.CV_INTEGRITY_ISSUE,
                        entity_type="CvVersion",
                        entity_id=version.id,
                    )
                else:
                    ok += 1

        summary = {"checked": checked, "ok": ok, "failed": failed}
        _LOG.info("CV nightly sweep complete: %s", summary)
        return summary
