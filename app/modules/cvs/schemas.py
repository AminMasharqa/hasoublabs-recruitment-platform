"""Pydantic v2 schemas for the CVs module (R5, Task 14.4)."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


# ── DTOs (response shapes) ────────────────────────────────────────────────────


class CvVariantDTO(BaseModel):
    """Public representation of a CV variant."""

    id: UUID
    name: str
    description: str | None
    is_primary: bool
    is_archived: bool
    created_at: datetime
    version_count: int = 0

    model_config = {"from_attributes": True}


class CvVersionDTO(BaseModel):
    """Public representation of a CV version."""

    id: UUID
    variant_id: UUID
    version_number: int
    state: str
    mime_type: str
    original_filename: str
    size_bytes: int
    created_at: datetime

    model_config = {"from_attributes": True}


class CvUploadResponse(BaseModel):
    """Response returned by the upload endpoint (202 Accepted)."""

    version: CvVersionDTO
    message: str = "Upload accepted, scan pending"


# ── Cross-module DTO ──────────────────────────────────────────────────────────


class CvVersionRef(BaseModel):
    """Minimal reference used by other modules to locate a CV version.

    Callers (e.g. the applications module) ask the CvsApi for a candidate's
    active version and receive this DTO so they can record the reference without
    importing the CVs models directly.
    """

    version_id: UUID
    variant_id: UUID
    account_id: UUID
    object_key: str
    bucket: str

    model_config = {"from_attributes": True}


# ── Request bodies ────────────────────────────────────────────────────────────


class CreateVariantRequest(BaseModel):
    """Body for POST /me/cv-variants."""

    name: str = Field(..., min_length=1, max_length=100)
    description: str | None = Field(None, max_length=300)


class UpdateVariantRequest(BaseModel):
    """Body for PATCH /me/cv-variants/{variant_id}."""

    name: str | None = Field(None, min_length=1, max_length=100)
    description: str | None = Field(None, max_length=300)
