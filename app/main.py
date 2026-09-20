"""HasoubLabs Recruitment Platform – FastAPI application factory.

Wiring rules (enforced by Semgrep in CI):
- Every APIRouter operation must declare an authorization dependency.
- Public allowlist: registration link fetch, registration, code entry, login,
  password reset.
- Platform layer never imports domain modules.
- Domain logic never imports fastapi outside router.py.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
import logging
import time
from typing import TYPE_CHECKING
import uuid

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import ORJSONResponse

from app.config import get_settings
from app.platform.security.errors import AuthenticationRequired, AuthorizationDenied
from app.platform.security.guards import (
    assert_all_routes_have_auth,
    authentication_required_handler,
    authorization_denied_handler,
)

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

_LOG = logging.getLogger(__name__)


async def _setup_services(application: FastAPI) -> None:
    """Instantiate and attach all domain services to app.state.

    Called once at startup. Services are reused for the lifetime of the process.
    """
    settings = get_settings()

    # ── Database / UoW ────────────────────────────────────────────────────────
    from app.platform.db.unit_of_work import UnitOfWork  # noqa: PLC0415
    from app.platform.db.engine import get_sessionmaker  # noqa: PLC0415

    session_factory = get_sessionmaker()
    application.state.session_factory = session_factory

    def uow_factory() -> UnitOfWork:
        return UnitOfWork(session_factory)

    application.state.uow_factory = uow_factory

    # ── Valkey ────────────────────────────────────────────────────────────────
    from redis.asyncio import Redis  # noqa: PLC0415

    valkey: Redis = Redis.from_url(str(settings.valkey_url), decode_responses=False)
    application.state.valkey = valkey

    # ── Session service (JWT) ─────────────────────────────────────────────────
    from app.platform.security.tokens import SessionService  # noqa: PLC0415

    session_service = SessionService(
        valkey=valkey,
        secret_key=settings.app_secret_key,
        algorithm=settings.jwt_algorithm,
        access_ttl_seconds=settings.jwt_access_token_ttl_seconds,
        refresh_ttl_seconds=settings.jwt_refresh_token_ttl_seconds,
    )
    application.state.session_service = session_service

    # ── OpenBao / Envelope encryption ─────────────────────────────────────────
    from app.platform.security.crypto import OpenBaoClient, EnvelopeEncryption  # noqa: PLC0415

    bao_client = OpenBaoClient(
        addr=settings.openbao_addr,
        token=settings.openbao_token,
        transit_key=settings.openbao_transit_key,
    )
    envelope_enc = EnvelopeEncryption(bao_client)
    application.state.envelope_enc = envelope_enc
    application.state.bao_client = bao_client

    # Blind-index pepper — in production this comes from OpenBao too; for now
    # derive it deterministically from the secret key to keep dev simple.
    import hashlib  # noqa: PLC0415
    blind_index_pepper = hashlib.sha256(
        (settings.app_secret_key + ":blind_index").encode()
    ).digest()
    application.state.blind_index_pepper = blind_index_pepper

    # ── Reference data service ────────────────────────────────────────────────
    from app.platform.reference.models import IsraeliLocality, IsraeliMobilePrefix  # noqa: PLC0415
    from app.platform.reference.repository import ReferenceDataRepository  # noqa: PLC0415
    from app.platform.reference.service import ReferenceDataService  # noqa: PLC0415

    reference_repo = ReferenceDataRepository(session_factory)
    reference_service = ReferenceDataService(reference_repo)
    application.state.reference_service = reference_service

    # ── Skill resolver ────────────────────────────────────────────────────────
    from app.platform.taxonomy.resolver import SkillResolver  # noqa: PLC0415
    from app.platform.taxonomy.repository import SkillRepository  # noqa: PLC0415

    skill_repo = SkillRepository(session_factory)
    skill_resolver = SkillResolver(skill_repo)
    application.state.skill_resolver = skill_resolver

    # ── Identity services ─────────────────────────────────────────────────────
    from app.modules.identity.service_residency import ResidencyValidator  # noqa: PLC0415
    from app.modules.identity.service import (  # noqa: PLC0415
        RegistrationLinkService,
        RegistrationService,
        VerificationService,
        AccountLifecycleService,
        AuthService,
    )

    residency_validator = ResidencyValidator(reference_service)
    application.state.residency_validator = residency_validator

    registration_link_service = RegistrationLinkService(
        uow_factory,
        ttl_seconds=settings.registration_link_ttl_seconds,
    )
    application.state.registration_link_service = registration_link_service

    registration_service = RegistrationService(
        uow_factory,
        residency_validator=residency_validator,
        envelope_enc=envelope_enc,
        blind_index_pepper=blind_index_pepper,
        verification_code_ttl_hours=settings.verification_code_ttl_hours,
    )
    application.state.registration_service = registration_service

    verification_service = VerificationService(
        uow_factory,
        pepper=blind_index_pepper,
        verification_code_ttl_hours=settings.verification_code_ttl_hours,
        max_attempts=settings.verification_code_max_attempts,
    )
    application.state.verification_service = verification_service

    account_lifecycle_service = AccountLifecycleService(uow_factory)
    application.state.account_lifecycle_service = account_lifecycle_service

    auth_service = AuthService(
        uow_factory,
        session_service=session_service,
        envelope_enc=envelope_enc,
        max_password_length=settings.password_max_length,
    )
    application.state.auth_service = auth_service

    # ── CV services ───────────────────────────────────────────────────────────
    from app.platform.storage.minio_store import MinioObjectStore, MinioSettings  # noqa: PLC0415
    from app.modules.cvs.service import (  # noqa: PLC0415
        CvVariantService,
        CvUploadService,
        CvIntegrityService,
    )

    minio_settings = MinioSettings(
        endpoint=settings.minio_endpoint,
        access_key=settings.minio_access_key,
        secret_key=settings.minio_secret_key,
        secure=settings.minio_secure,
    )
    from app.platform.storage.minio_store import build_minio_client  # noqa: PLC0415
    minio_client = build_minio_client(minio_settings)
    object_store = MinioObjectStore(minio_client)
    application.state.object_store = object_store

    cv_variant_service = CvVariantService(uow_factory)
    application.state.cv_variant_service = cv_variant_service

    # ARQ queue stub — the real ARQ context is available only in the worker;
    # in the web process we use a simple enqueue wrapper that dispatches via Valkey.
    import arq  # noqa: PLC0415

    arq_pool = await arq.create_pool(arq.connections.RedisSettings.from_dsn(str(settings.valkey_url)))
    application.state.arq_pool = arq_pool

    cv_upload_service = CvUploadService(
        uow_factory,
        object_store=object_store,
        available_bucket=settings.minio_cv_bucket,
        quarantine_bucket=settings.minio_cv_quarantine_bucket,
        arq_queue=arq_pool,
    )
    application.state.cv_upload_service = cv_upload_service

    cv_integrity_service = CvIntegrityService(uow_factory, object_store=object_store)
    application.state.cv_integrity_service = cv_integrity_service

    # Wire the CVs router (uses module-level service references).
    from app.modules.cvs.router import configure_router as configure_cvs_router  # noqa: PLC0415
    configure_cvs_router(
        variant_service=cv_variant_service,
        upload_service=cv_upload_service,
        integrity_service=cv_integrity_service,
        uow_factory=uow_factory,
        object_store=object_store,
    )

    # ── CvsApi (cross-module) ─────────────────────────────────────────────────
    from app.modules.cvs.api import DefaultCvsApi  # noqa: PLC0415

    cvs_api = DefaultCvsApi(uow_factory)
    application.state.cvs_api = cvs_api

    # ── Profile services ──────────────────────────────────────────────────────
    from app.modules.profiles.service import (  # noqa: PLC0415
        CandidateProfileService,
        SeniorProfileService,
    )

    candidate_profile_service = CandidateProfileService(
        uow_factory,
        skill_resolver=skill_resolver,
    )
    application.state.candidate_profile_service = candidate_profile_service

    senior_profile_service = SeniorProfileService(
        uow_factory,
        skill_resolver=skill_resolver,
    )
    application.state.senior_profile_service = senior_profile_service

    # ── ProfilesApi (cross-module) ────────────────────────────────────────────
    from app.modules.profiles.api import DefaultProfilesApi  # noqa: PLC0415

    profiles_api = DefaultProfilesApi(
        uow_factory,
        cvs_api=cvs_api,
        skill_resolver=skill_resolver,
    )
    application.state.profiles_api = profiles_api

    # ── IdentityApi (cross-module) ────────────────────────────────────────────
    from app.modules.identity.api import DefaultIdentityApi  # noqa: PLC0415

    identity_api = DefaultIdentityApi(uow_factory)
    application.state.identity_api = identity_api

    _LOG.info("All domain services initialised.")


async def _teardown_services(application: FastAPI) -> None:
    """Gracefully shut down resources held in app.state."""
    try:
        valkey = getattr(application.state, "valkey", None)
        if valkey is not None:
            await valkey.aclose()
    except Exception:  # noqa: BLE001
        _LOG.exception("Error closing Valkey connection")

    try:
        bao_client = getattr(application.state, "bao_client", None)
        if bao_client is not None:
            await bao_client.aclose()
    except Exception:  # noqa: BLE001
        _LOG.exception("Error closing OpenBao client")

    try:
        arq_pool = getattr(application.state, "arq_pool", None)
        if arq_pool is not None:
            await arq_pool.aclose()
    except Exception:  # noqa: BLE001
        _LOG.exception("Error closing ARQ pool")

    from app.platform.db.engine import dispose_engine  # noqa: PLC0415
    await dispose_engine()


@asynccontextmanager
async def lifespan(application: FastAPI) -> AsyncIterator[None]:
    """Application lifespan: startup → serve → shutdown."""
    await _setup_services(application)
    # Boot-time assertion: refuse to start if any non-public route lacks a guard.
    assert_all_routes_have_auth(application)
    yield
    await _teardown_services(application)


def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""
    settings = get_settings()

    app = FastAPI(
        title="HasoubLabs Recruitment Platform",
        version="0.1.0",
        docs_url="/api/docs" if not settings.is_production else None,
        redoc_url="/api/redoc" if not settings.is_production else None,
        openapi_url="/api/openapi.json" if not settings.is_production else None,
        default_response_class=ORJSONResponse,
        lifespan=lifespan,
    )

    # ── CORS ──────────────────────────────────────────────────────────────────
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"] if settings.is_development else [],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # ── Request-metadata middleware ───────────────────────────────────────────
    # Sets request.state.start_time (used by the denial-floor timer) and
    # request.state.request_id (propagated in every response and error body).
    @app.middleware("http")
    async def add_request_metadata(request: Request, call_next: object) -> Response:
        request.state.start_time = time.monotonic()
        request.state.request_id = str(uuid.uuid4())
        # Default locale until Amin wires i18n (Section 5).
        request.state.locale = (
            request.headers.get("Accept-Language", "en").split(",")[0].split("-")[0]
        )
        response: Response = await call_next(request)  # type: ignore[operator]
        response.headers["X-Request-ID"] = request.state.request_id
        return response

    # ── Exception handlers ────────────────────────────────────────────────────
    _register_exception_handlers(app)

    # ── Routers ───────────────────────────────────────────────────────────────
    _register_routers(app)

    return app


def _register_exception_handlers(app: FastAPI) -> None:
    """Register the one error-envelope exception handlers."""
    from fastapi import status  # noqa: PLC0415
    from fastapi.exceptions import RequestValidationError  # noqa: PLC0415
    from app.platform.errors.base import PlatformError  # noqa: PLC0415

    # Security errors — order matters: most specific first.
    app.add_exception_handler(AuthorizationDenied, authorization_denied_handler)
    app.add_exception_handler(AuthenticationRequired, authentication_required_handler)

    @app.exception_handler(PlatformError)
    async def platform_error_handler(
        request: Request, exc: PlatformError
    ) -> ORJSONResponse:
        return ORJSONResponse(
            status_code=exc.status_code,
            content={
                "error": exc.error_key,
                "message": exc.message_key,
                "details": exc.details if exc.details else None,
                "request_id": getattr(request.state, "request_id", None),
            },
            headers=dict(exc.headers) if exc.headers else None,
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(
        request: Request, exc: RequestValidationError
    ) -> ORJSONResponse:
        return ORJSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content={
                "error": "validation_error",
                "message": "Request validation failed",
                "details": exc.errors(),
                "request_id": getattr(request.state, "request_id", None),
            },
        )

    @app.exception_handler(Exception)
    async def unhandled_error_handler(
        request: Request, exc: Exception
    ) -> ORJSONResponse:
        logging.getLogger(__name__).exception("Unhandled error", exc_info=exc)
        return ORJSONResponse(
            status_code=500,
            content={
                "error": "internal_server_error",
                "message": "An unexpected error occurred",
                "request_id": getattr(request.state, "request_id", None),
            },
        )


def _register_routers(app: FastAPI) -> None:
    """Register module routers under /api/v1.

    Each module owner adds their router in their Wave PR.
    """
    from fastapi import APIRouter  # noqa: PLC0415

    # Health check — public, no auth required.
    health_router = APIRouter(tags=["health"])

    @health_router.get("/health", include_in_schema=False)
    async def health_check() -> dict[str, str]:
        return {"status": "ok"}

    app.include_router(health_router)

    # Wave B routers — identity, cvs, profiles
    from app.modules.identity.router import router as identity_router  # noqa: PLC0415
    app.include_router(identity_router, prefix="/api/v1")

    from app.modules.profiles.router import router as profiles_router  # noqa: PLC0415
    app.include_router(profiles_router, prefix="/api/v1")

    from app.modules.cvs.router import router as cvs_router  # noqa: PLC0415
    app.include_router(cvs_router, prefix="/api/v1")

    # Wave A audit router (already live)
    from app.modules.audit.router import router as audit_router  # noqa: PLC0415
    app.include_router(audit_router, prefix="/api/v1")

    # Wave C/D routers — uncomment as they land:
    # from app.modules.jobs.router import router as jobs_router
    # app.include_router(jobs_router, prefix="/api/v1")
    # from app.modules.applications.router import router as applications_router
    # app.include_router(applications_router, prefix="/api/v1")
    # from app.modules.reviews.router import router as reviews_router
    # app.include_router(reviews_router, prefix="/api/v1")
    # from app.modules.reporting.router import router as reporting_router
    # app.include_router(reporting_router, prefix="/api/v1")


app = create_app()
