# HasoubLabs Recruitment Platform

This repository contains the recruitment platform backend and frontend:

- `backend/` - FastAPI backend, Alembic migrations, Python tests, and
  `docker-compose.yml` for local infrastructure services.
- `frontend/` - React + TypeScript application built with Vite.

## Run everything locally

From the repository root, in Git Bash (Windows), macOS or Linux, with Docker
running and `uv` and `npm` installed:

```bash
./dev.sh
```

It starts the compose services, recreates the OpenBao transit key if OpenBao was
restarted, installs dependencies, migrates the database, and runs the API, the
ARQ worker and the Vite dev server. It prints the URLs when ready, and Ctrl+C
stops the three app processes. Run `./dev.sh --help` for options. Logs are in
`.dev-logs/`.

The API cannot create the first Admin, so seed one with `./dev.sh --seed-admin`
(or `uv run python scripts/seed_admin.py` from `backend/` while the API runs).
It defaults to `e2e-admin@example.com` / `correct-horse-battery-staple`, and
writes the TOTP secret to the gitignored `.dev-secrets/`. Add
`.dev-secrets/admin-mfa-uri.txt` to an authenticator app to sign in by hand, or
`source .dev-secrets/admin.env.sh` before running the e2e suite. Re-run it after
OpenBao restarts, because the old MFA secret can no longer be decrypted.

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
