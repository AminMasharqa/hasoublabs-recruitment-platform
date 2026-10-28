"""Application configuration loaded from environment variables."""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field, PostgresDsn, RedisDsn, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """All settings are read from environment variables or .env file."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── Application ───────────────────────────────────────────────────────────
    app_env: Literal["development", "staging", "production"] = "development"
    app_secret_key: str = Field(min_length=32)
    app_debug: bool = False

    # ── Database ──────────────────────────────────────────────────────────────
    database_url: PostgresDsn
    database_pool_size: int = 10
    database_max_overflow: int = 20

    # ── Valkey / Redis ────────────────────────────────────────────────────────
    valkey_url: RedisDsn
    session_ttl_seconds: int = 1800

    # ── MinIO / S3 ────────────────────────────────────────────────────────────
    minio_endpoint: str
    minio_access_key: str
    minio_secret_key: str
    minio_secure: bool = False
    minio_cv_bucket: str = "cvs"
    minio_cv_quarantine_bucket: str = "cvs-quarantine"

    # ── OpenBao ───────────────────────────────────────────────────────────────
    openbao_addr: str = "http://localhost:8200"
    openbao_token: str
    openbao_transit_key: str = "hasoub-data-key"

    # ── SMTP ──────────────────────────────────────────────────────────────────
    smtp_host: str = "localhost"
    smtp_port: int = 1025
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_from_address: str = "noreply@hasoublabs.com"
    smtp_from_name: str = "HasoubLabs"

    # ── Security ──────────────────────────────────────────────────────────────
    jwt_algorithm: str = "HS256"
    jwt_access_token_ttl_seconds: int = 1800
    jwt_refresh_token_ttl_seconds: int = 604800
    mfa_issuer: str = "HasoubLabs"
    deny_floor_ms: int = 120
    password_min_length: int = 10
    password_max_length: int = 128

    # ── ClamAV ────────────────────────────────────────────────────────────────
    clamav_host: str = "localhost"
    clamav_port: int = 3310

    # ── Observability ─────────────────────────────────────────────────────────
    otel_exporter_otlp_endpoint: str = "http://localhost:4317"
    otel_service_name: str = "hasoublabs-recruitment-platform"
    log_level: str = "INFO"

    # ── Rate Limiting ─────────────────────────────────────────────────────────
    rate_limit_requests_per_minute: int = 60
    rate_limit_cv_uploads_per_hour: int = 10
    rate_limit_applications_per_24h: int = 20

    # ── Registration ──────────────────────────────────────────────────────────
    registration_link_ttl_seconds: int = 86400
    verification_code_ttl_hours: int = 72
    verification_code_max_attempts: int = 5

    @field_validator("app_secret_key")
    @classmethod
    def secret_key_strength(cls, v: str) -> str:
        if len(v) < 32:  # noqa: PLR2004
            msg = "APP_SECRET_KEY must be at least 32 characters"
            raise ValueError(msg)
        return v

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"

    @property
    def is_development(self) -> bool:
        return self.app_env == "development"


@lru_cache
def get_settings() -> Settings:
    """Return the cached settings singleton."""
    return Settings()  # type: ignore[call-arg]
