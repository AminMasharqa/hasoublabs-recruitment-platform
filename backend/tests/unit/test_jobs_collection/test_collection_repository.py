"""Structural tests for collection_repository module."""

from __future__ import annotations

import inspect

from app.modules.jobs import collection_repository as repo


def test_all_functions_are_coroutines() -> None:
    """Verify that all key functions are async coroutines."""
    fns = [
        repo.create_source,
        repo.get_source,
        repo.list_sources,
        repo.list_sources_due_for_poll,
        repo.create_run,
        repo.finish_run,
        repo.create_flag,
        repo.list_flags,
        repo.resolve_flag,
        repo.external_url_exists,
    ]
    for fn in fns:
        assert inspect.iscoroutinefunction(fn), f"{fn.__name__} must be async"


def test_external_url_exists_is_exported() -> None:
    """Verify that external_url_exists function is exported."""
    assert hasattr(repo, "external_url_exists")


def test_list_sources_due_for_poll_is_exported() -> None:
    """Verify that list_sources_due_for_poll is exported."""
    assert hasattr(repo, "list_sources_due_for_poll")
