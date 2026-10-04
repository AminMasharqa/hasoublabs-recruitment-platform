# HasoubLabs Recruitment Platform

This repository contains the recruitment platform backend and frontend:

- `backend/` - FastAPI backend, Alembic migrations, Python tests, and
  `docker-compose.yml` for local infrastructure services.
- `frontend/` - React + TypeScript application built with Vite.

## Backend

```powershell
cd backend
uv sync --extra dev
uv run pytest -q
```

Unit tests do not require Docker. Integration tests start their own PostgreSQL
container through Testcontainers, so Docker Desktop must be running, but the
compose services are not needed for them.

## Frontend

```powershell
cd frontend
npm install
npm run dev
```

## Local services

From the backend directory:

```powershell
cd backend
docker compose up -d
```
