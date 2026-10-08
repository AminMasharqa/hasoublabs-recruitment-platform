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

### Signing in as the local Admin

The API cannot create the first Admin, so **every teammate seeds their own**,
once per local database:

```bash
./dev.sh --seed-admin
# or, from backend/ while the API runs:
uv run python scripts/seed_admin.py
```

This creates (or resets) `e2e-admin@example.com` with password
`correct-horse-battery-staple` (both overridable with `--email` and `--password`),
enrols its MFA, and writes the credentials and TOTP secret to `.dev-secrets/` at
the repository root, next to `backend/` and `frontend/`:

- `admin.env.sh` / `admin.env.ps1`: the `E2E_*` variables, including
  `E2E_ADMIN_TOTP_SECRET`
- `admin-mfa-uri.txt`: the same secret as an `otpauth://` link

That folder is gitignored, so it is not on GitHub and only exists on your
machine after you seed. Open it by path or with `Ctrl+P` in VS Code.

The sign-in screen then asks for a 6-digit MFA code. Either:

- **Print one** (from the repository root, in Git Bash). It shows only the code,
  which is valid for about 30 seconds:

  ```bash
  source .dev-secrets/admin.env.sh
  cd backend && uv run python -c "import os, pyotp; print(pyotp.TOTP(os.environ['E2E_ADMIN_TOTP_SECRET']).now())"
  ```

- **Or add it to an authenticator app** (Google Authenticator, Microsoft
  Authenticator, Authy): choose *Add account → Enter a setup key*, paste the
  value of `E2E_ADMIN_TOTP_SECRET` from `admin.env.sh` (without the quotes), and
  pick *Time-based*.

Keep in mind:

- **Each seed enrols a new secret.** After re-seeding, print a new code or
  replace the authenticator entry.
- **Re-seed after OpenBao restarts.** It runs in dev mode and loses the key the
  old MFA secret was encrypted with; `dev.sh` warns when this happens.
- **If valid-looking codes are refused,** sync your computer's clock (Windows:
  Settings → Time & language → Sync now).
- **For the e2e suite,** `source .dev-secrets/admin.env.sh` (or
  `. .dev-secrets/admin.env.ps1` in PowerShell) first.

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
