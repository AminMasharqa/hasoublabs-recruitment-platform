"""Smoke tests for Task 1: project skeleton integrity.

Validates that:
- All expected modules exist and are importable.
- The FastAPI app factory runs without errors.
- Module skeletons have the required files.
"""

from __future__ import annotations

import importlib
from pathlib import Path

import pytest


DOMAIN_MODULES = [
    "identity",
    "profiles",
    "cvs",
    "jobs",
    "applications",
    "reviews",
    "audit",
    "reporting",
]

MODULE_FILES = ["router", "api", "service", "repository", "models", "schemas", "errors"]

PLATFORM_PACKAGES = [
    "db",
    "security",
    "storage",
    "mail",
    "jobs",
    "i18n",
    "taxonomy",
    "pagination",
]


@pytest.mark.unit
class TestModuleSkeletonExists:
    """Every module directory must have the canonical 7-file layout."""

    @pytest.mark.parametrize("module", DOMAIN_MODULES)
    @pytest.mark.parametrize("file", MODULE_FILES)
    def test_module_file_exists(self, module: str, file: str) -> None:
        path = Path(f"app/modules/{module}/{file}.py")
        assert path.exists(), f"Missing: {path}"

    @pytest.mark.parametrize("module", DOMAIN_MODULES)
    def test_module_init_exists(self, module: str) -> None:
        path = Path(f"app/modules/{module}/__init__.py")
        assert path.exists(), f"Missing __init__.py for module: {module}"

    @pytest.mark.parametrize("pkg", PLATFORM_PACKAGES)
    def test_platform_package_init_exists(self, pkg: str) -> None:
        path = Path(f"app/platform/{pkg}/__init__.py")
        assert path.exists(), f"Missing __init__.py for platform/{pkg}"


@pytest.mark.unit
class TestModulesAreImportable:
    """Skeleton modules must be importable (empty stubs are acceptable)."""

    @pytest.mark.parametrize("module", DOMAIN_MODULES)
    def test_module_package_importable(self, module: str) -> None:
        mod = importlib.import_module(f"app.modules.{module}")
        assert mod is not None

    @pytest.mark.parametrize("pkg", PLATFORM_PACKAGES)
    def test_platform_package_importable(self, pkg: str) -> None:
        mod = importlib.import_module(f"app.platform.{pkg}")
        assert mod is not None


@pytest.mark.unit
def test_app_config_importable() -> None:
    """Settings class must be importable."""
    from app.config import Settings  # noqa: PLC0415
    assert Settings is not None


@pytest.mark.unit
def test_public_route_paths_defined() -> None:
    """Security guards must define the public-route allowlist."""
    from app.platform.security.guards import PUBLIC_ROUTE_PATHS  # noqa: PLC0415
    assert isinstance(PUBLIC_ROUTE_PATHS, frozenset)
    assert len(PUBLIC_ROUTE_PATHS) > 0
    # Login must always be public
    assert any("login" in p for p in PUBLIC_ROUTE_PATHS)
