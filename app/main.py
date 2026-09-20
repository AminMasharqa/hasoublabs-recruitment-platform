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


@asynccontextmanager
async def lifespan(application: FastAPI) -> AsyncIterator[None]:
    """Application lifespan: startup → serve → shutdown."""
    # Boot-time assertion: refuse to start if any non-public route lacks a guard.
    assert_all_routes_have_auth(application)
    yield
    # Shutdown: connection pool teardown goes here (wired by Khalid, Section 2).


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

    # Security errors — order matters: most specific first.
    app.add_exception_handler(AuthorizationDenied, authorization_denied_handler)
    app.add_exception_handler(AuthenticationRequired, authentication_required_handler)

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
        import logging  # noqa: PLC0415

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

    # Module routers — uncomment as each Wave lands the module.
    # from app.modules.identity.router import router as identity_router
    # app.include_router(identity_router, prefix="/api/v1")

    # from app.modules.profiles.router import router as profiles_router
    # app.include_router(profiles_router, prefix="/api/v1")

    # from app.modules.cvs.router import router as cvs_router
    # app.include_router(cvs_router, prefix="/api/v1")

    # from app.modules.jobs.router import router as jobs_router
    # app.include_router(jobs_router, prefix="/api/v1")

    # from app.modules.applications.router import router as applications_router
    # app.include_router(applications_router, prefix="/api/v1")

    # from app.modules.reviews.router import router as reviews_router
    # app.include_router(reviews_router, prefix="/api/v1")

    from app.modules.audit.router import router as audit_router  # noqa: PLC0415
    app.include_router(audit_router, prefix="/api/v1")

    # from app.modules.reporting.router import router as reporting_router
    # app.include_router(reporting_router, prefix="/api/v1")


app = create_app()
