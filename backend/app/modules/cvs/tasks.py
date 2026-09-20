"""ARQ background tasks for the CVs module.

Tasks registered here:
- ``scan_cv``: runs ClamAV on a newly uploaded CV version and either
  promotes it to Available or marks it Quarantined (R5 AC3).
- ``verify_cv_checksums``: nightly sweep that re-verifies stored CV
  checksums against their stored SHA-256 digests (R5 AC15).
"""

from __future__ import annotations

import logging
from uuid import UUID

from app.platform.jobs.registry import RetryPolicy, task
from app.platform.jobs.catalog import JobName

_LOG = logging.getLogger(__name__)


@task(
    JobName.SCAN_CV,
    retry=RetryPolicy(max_tries=3, base_delay_seconds=30),
    timeout_seconds=120,
)
async def scan_cv(ctx: dict, *, version_id: str, **_kwargs: object) -> dict:
    """Scan a newly uploaded CV version with ClamAV.

    On success: promotes the version to the available bucket (state = Available).
    On infection: keeps in quarantine (state = Quarantined).
    Notifies the candidate and all Admins either way.
    """
    from app.platform.db.unit_of_work import UnitOfWork  # noqa: PLC0415
    from app.platform.jobs.runtime import worker_session_factory  # noqa: PLC0415
    from app.config import get_settings  # noqa: PLC0415
    from app.platform.storage.minio_store import MinioObjectStore, MinioSettings, build_minio_client  # noqa: PLC0415
    from app.modules.cvs.service import CvUploadService  # noqa: PLC0415

    settings = get_settings()
    session_factory = worker_session_factory()
    uow_factory = lambda: UnitOfWork(session_factory)  # noqa: E731

    minio_settings = MinioSettings(
        endpoint=settings.minio_endpoint,
        access_key=settings.minio_access_key,
        secret_key=settings.minio_secret_key,
        secure=settings.minio_secure,
    )
    minio_client = build_minio_client(minio_settings)
    object_store = MinioObjectStore(minio_client)

    upload_service = CvUploadService(
        uow_factory,
        object_store=object_store,
        available_bucket=settings.minio_cv_bucket,
        quarantine_bucket=settings.minio_cv_quarantine_bucket,
        arq_queue=ctx.get("redis"),  # ARQ provides the redis pool in ctx
    )

    version_uuid = UUID(version_id)

    # Scan the file using pyclamd
    try:
        import pyclamd  # noqa: PLC0415
        from app.platform.db.unit_of_work import UnitOfWork as _UoW  # noqa: PLC0415
        from app.modules.cvs import repository as repo  # noqa: PLC0415

        async with uow_factory() as uow:
            version = await repo.get_version(uow.session, version_uuid)

        if version is None:
            _LOG.error("scan_cv: version %s not found", version_id)
            return {"status": "not_found", "version_id": version_id}

        # Get the file from quarantine bucket for scanning
        stream = await object_store.get_object(
            bucket=settings.minio_cv_quarantine_bucket,
            key=version.object_key,
            version_id=version.object_version_id,
        )
        async with stream as s:
            file_bytes = await s.read()

        # Connect to ClamAV and scan
        cd = pyclamd.ClamdNetworkSocket(
            host=settings.clamav_host,
            port=settings.clamav_port,
        )
        scan_result = cd.scan_stream(file_bytes)

        if scan_result is None:
            # Clean
            await upload_service.complete_scan(
                version_uuid,
                is_clean=True,
                scan_result="OK",
            )
            return {"status": "clean", "version_id": version_id}
        else:
            # Infected
            threat_name = str(scan_result)
            _LOG.warning(
                "scan_cv: version %s detected as infected: %s",
                version_id,
                threat_name,
            )
            await upload_service.complete_scan(
                version_uuid,
                is_clean=False,
                scan_result=threat_name,
            )
            return {"status": "quarantined", "version_id": version_id, "threat": threat_name}

    except ImportError:
        _LOG.warning("pyclamd not installed — treating scan as clean (dev mode)")
        await upload_service.complete_scan(
            version_uuid,
            is_clean=True,
            scan_result="SKIPPED (pyclamd not installed)",
        )
        return {"status": "skipped", "version_id": version_id}
    except Exception as exc:  # noqa: BLE001
        _LOG.error("scan_cv: unexpected error for version %s: %s", version_id, exc, exc_info=True)
        raise


@task(
    JobName.VERIFY_CV_CHECKSUMS,
    retry=RetryPolicy(max_tries=2, base_delay_seconds=300),
    timeout_seconds=3600,  # 1 hour for the nightly sweep
)
async def verify_cv_checksums(ctx: dict) -> dict:
    """Nightly sweep: re-verify every Available CV version's SHA-256 digest.

    Any mismatch raises a CV integrity alert notification to the candidate and
    all Admins.
    """
    from app.platform.db.unit_of_work import UnitOfWork  # noqa: PLC0415
    from app.platform.jobs.runtime import worker_session_factory  # noqa: PLC0415
    from app.config import get_settings  # noqa: PLC0415
    from app.platform.storage.minio_store import MinioObjectStore, MinioSettings, build_minio_client  # noqa: PLC0415
    from app.modules.cvs.service import CvIntegrityService  # noqa: PLC0415

    settings = get_settings()
    session_factory = worker_session_factory()
    uow_factory = lambda: UnitOfWork(session_factory)  # noqa: E731

    minio_settings = MinioSettings(
        endpoint=settings.minio_endpoint,
        access_key=settings.minio_access_key,
        secret_key=settings.minio_secret_key,
        secure=settings.minio_secure,
    )
    minio_client = build_minio_client(minio_settings)
    object_store = MinioObjectStore(minio_client)

    integrity_service = CvIntegrityService(uow_factory, object_store=object_store)
    summary = await integrity_service.run_nightly_sweep()
    return summary
