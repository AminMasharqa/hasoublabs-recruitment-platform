# HasoubLabs Recruitment Platform

This repository contains the recruitment platform backend and frontend:

- `backend/` - FastAPI backend, Alembic migrations, and Python tests.
- `frontend/` - React + TypeScript application built with Vite.
- `docker-compose.yml` - Local infrastructure services.

## Backend

```powershell
cd backend
uv sync --extra dev
uv run pytest -q
```

Start PostgreSQL and run the integration tests with Docker:

```powershell
docker compose up -d postgres
cd backend
uv run pytest -q
```

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
