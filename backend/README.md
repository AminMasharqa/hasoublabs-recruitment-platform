# Backend

The backend is a FastAPI application managed with `uv`.

Run backend commands from this directory so Python imports, Alembic paths, and
the local `.env` file resolve correctly.

```powershell
cd backend
uv sync --extra dev
uv run pytest -q
uv run alembic upgrade head
```

The test suite is under `tests/`. Unit tests do not require Docker; integration
tests use Testcontainers and require Docker Desktop to be running.