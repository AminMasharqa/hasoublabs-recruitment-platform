# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

HasoubLabs Recruitment Platform. The repo has two independent projects and no shared tooling at the root:

- `backend/`: a FastAPI **modular monolith** (Python 3.12, SQLAlchemy 2 async + asyncpg, Pydantic v2, ARQ workers on Valkey, MinIO, OpenBao). It also holds `docker-compose.yml`, `.env.example`, Alembic, the Semgrep rules, and the backend Kiro spec.
- `frontend/`: React 19 + TypeScript 6 + Vite 8, built with Mantine 9 (RTL), TanStack Query 5, react-router 7, i18next, and `openapi-fetch` typed from the backend's OpenAPI document.

Specs are written in Kiro format, and code comments cite them by requirement and acceptance-criterion numbers (e.g. "R6 AC2", "Requirement 3 AC7") and by task numbers:
- Backend: `backend/.kiro/specs/hasoublab-recruitment-platform/` (`requirements.md`, `design.md`, `tasks.md`), plus conventions in `backend/.kiro/steering/`. Phase 1 covers R1–4, 4A, 5–9, 28, 29, delivered in "Waves" A–D.
- Frontend: `frontend/.kiro/specs/frontend-web-application/`. **`TASK-28-BLOCKERS.md` there is the live defect list**: the full-pipeline run, which bugs are fixed and which are open, root-cause analysis for each, and a suggested order. Read it before any bug-fixing work, and mark bugs FIXED in it as they land.

## Commands

### Backend: run everything from `backend/`

Imports, Alembic paths, the compose file and `.env` all resolve from `backend/`.

```bash
uv sync --extra dev --extra lint
docker compose up -d                          # postgres valkey mailpit minio clamav openbao (ClamAV needs ~2 min on first boot)
cp .env.example .env
uv run alembic upgrade head
uv run uvicorn app.main:app --reload          # API docs at /api/docs (non-production only)
uv run arq app.worker.WorkerSettings          # background worker; email, CV scanning and exports need it running

uv run ruff check . && uv run ruff format .
uv run mypy app/                               # strict mode
uvx semgrep --config semgrep/ app/             # architectural rules; semgrep is NOT in the venv (OTel pin conflict)

uv run pytest tests/unit
uv run pytest tests/integration                # needs Docker running (Testcontainers starts its own postgres:16)
uv run pytest tests/unit/test_security/test_guards.py::test_name
uv run pytest -m security                      # markers: unit, integration, e2e, property, security, slow (--strict-markers)
uv run alembic revision --autogenerate -m "..."
```

After a migration that changes column types, **restart both uvicorn and the worker**. asyncpg caches type information per connection, so a pool opened before the `ALTER` keeps using the old types.

Coverage floor is 80% overall, with higher per-package floors: `app.platform.security` 90, `app.modules.identity` 85, `app.modules.audit` 85.

### Frontend: run everything from `frontend/`

```bash
npm install                    # .npmrc: save-exact, legacy-peer-deps (openapi-typescript peer vs TS 6)
npm run dev                    # Vite on :5173; set VITE_API_BASE_URL=http://127.0.0.1:8000/api/v1 (no dev proxy exists)
npm run typecheck              # tsc -b --noEmit
npm run lint                   # oxlint (.oxlintrc.json; no-console is an error under src/api/)
npm run test                   # vitest run (jsdom); covers src/** and scripts/**
npx vitest run src/session/SessionManager.test.ts
npx vitest run -t "name of test"
npm run build                  # tsc -b && vite build
npm run gen:api                # regenerate src/api/generated/schema.d.ts from the backend's /api/openapi.json
npm run verify:api             # fail if the committed schema.d.ts has drifted from the live backend
npm run test:a11y              # Playwright + axe, tagged @a11y, against a MOCKED backend (e2e/a11y/mockBackend.ts)
npm run test:e2e               # all of e2e/ (journeys + locale + a11y) against a LIVE backend
```

`gen:api` and `verify:api` run `.ts` files directly with `node`, so they need a Node version with built-in type stripping. They read `BACKEND_ORIGIN` or `OPENAPI_URL` (see `frontend/.env.example`).

**E2E preconditions** (details in `frontend/e2e/README.md`): the backend API and the ARQ worker must both be running. The database needs a seeded Approved Admin with enrolled MFA, because the API has no way to create the first Admin: `backend/scripts/seed_admin.py` (or `./dev.sh --seed-admin`) creates one and writes the `E2E_*` variables to the gitignored `.dev-secrets/admin.env.{sh,ps1}`. Otherwise set `E2E_API_BASE_URL`, `E2E_ADMIN_EMAIL`, `E2E_ADMIN_PASSWORD` and `E2E_ADMIN_TOTP_SECRET`, plus `E2E_MAILPIT_BASE_URL` if it isn't the default. TOTP secrets are never committed.

**Local stack:** `./dev.sh` at the repo root starts the compose services, recreates OpenBao's transit key if needed, migrates, and runs the API, worker and Vite (logs in `.dev-logs/`). Playwright starts the dev server itself unless `E2E_BASE_URL` is set.

The full pipeline gate, in order: `npm run typecheck; npm run lint; npm run verify:api; npm run test; npm run build; npm run test:a11y; npm run test:e2e`.

## Backend architecture

All paths in this section are relative to `backend/`.

### Layering (enforced by `semgrep/module-boundaries.yml`)

- `app/platform/*` holds shared infrastructure (db, security, storage, mail, jobs, i18n, taxonomy, pagination, reference data, notifications, the audit hook). It **never imports `app.modules`**.
- `app/modules/<name>/` holds the domain modules: identity, profiles, cvs, jobs, applications, reviews, audit, reporting. Each has the same files: `router.py` (HTTP only), `api.py` (a Protocol plus a `Default*Api` implementation that other modules use), `service.py`, `repository.py`, `models.py`, `schemas.py`, `errors.py`, and optionally `tasks.py`.
- A module may import another module **only** through its `api.py` or `schemas.py`.
- `fastapi` may be imported only in `router.py` (and in `app/main.py`). Services stay transport-agnostic.
- `app/main.py` and `app/worker.py` are the only composition roots allowed to import everything.

### Wiring

- `app/main.py::_setup_services` (run from lifespan) builds every service and cross-module `*Api` by hand and stores each on `app.state`. Routers read services from `request.app.state`. The exception is `cvs/router.py`, which is wired through `configure_router(...)`. Any new service or cross-module dependency must be added in `_setup_services`.
- Routers are mounted under `/api/v1` in `_register_routers`.
- **Background jobs:**
  - Every job name is in the `JobName` enum in `app/platform/jobs/catalog.py`, and recurring jobs have a `Schedule` in `SCHEDULES`.
  - Handlers register with the `@task` decorator (`platform/jobs/registry.py`), which applies the system actor context, exponential backoff and dead-lettering.
  - A new `tasks` module must be added to `_TASK_MODULES` in `app/worker.py`. Each module is imported separately, so one broken import can't take the whole worker down.
  - At boot, `_report_job_coverage` checks that every schedule has a handler. A schedule that intentionally has none must be listed in `UNIMPLEMENTED_JOBS`. Otherwise boot warns in development and raises in production, and the scheduler skips the job.
- **ORM models:** every model module must be imported in `app/platform/db/metadata.py`. If one is missing, Alembic autogenerate breaks (`NoReferencedTableError`) or generates migrations that drop tables.
- **Migrations:** files are `alembic/versions/NNNN_<topic>.py`, and letter suffixes (`0004a`, `0009b`) insert migrations between existing ones.
- **Enum columns** must be native PG enums in both the migration and the model. `tests/integration/test_schema_enum_alignment.py` guards this. When comparing an enum-array column, cast the operand to the enum array type (e.g. `PG_ARRAY(role_type)`), not to `String`.

### Transactions and audit

- Every service operation runs inside exactly one `UnitOfWork` (`async with uow_factory() as uow: ... uow.session`). It commits on clean exit and rolls back on any exception. Services never call `commit()` or `rollback()` themselves.
- `app/platform/db/unit_of_work.py` is the real UoW. `app/platform/db/uow.py` is an older mock that parts of the `cvs` module still import; prefer `unit_of_work`.
- The UoW installs a SQLAlchemy `before_flush` hook (`platform/audit/hook.py`). The hook writes field-level before/after diffs into a hash-chained, monthly-partitioned audit log in the same transaction, and redacts sensitive columns. On rollback, exactly one failure entry is written on a separate connection. Never bypass the session for mutations, because that skips the audit trail.

### Security model

- Every route must have an auth guard: either `principal: Principal = Depends(require(roles=..., context=..., statuses=...))` or `dependencies=[...]` (`platform/security/guards.py`). Public routes are listed in `PUBLIC_ROUTE_PATHS`. `assert_all_routes_have_auth` runs at boot: it raises in production and only logs a warning in development, so check the startup log.
- `require()` defaults to `statuses={APPROVED}`. Roles are ADMIN, CANDIDATE and SENIOR, and ADMIN cannot be combined with the others. A Candidate+Senior account switches its active context (the `act` JWT claim), and a context switch rotates the session.
- `AuthorizationDenied` is the single error for both "forbidden" and "not found". Its handler pads the response to a fixed latency floor (`DENY_FLOOR_MS`) so a caller can't tell whether a resource exists. Never raise a distinct not-found error for a resource the caller isn't authorized to see. Scope owned-resource queries to `principal.account_id`.
- National IDs, residency proofs and MFA secrets use AES-256-GCM envelope encryption via OpenBao transit (`platform/security/crypto.py`), with blind indexes for lookup. CVs are stored in MinIO with SSE, in quarantine and available buckets, and are scanned by ClamAV in a worker task.

### Errors

Domain errors subclass `PlatformError` (`platform/errors/base.py`) and carry a stable `error_key`, an HTTP status and an i18n `message_key`. They all render through one envelope, `platform/errors/handlers.py::register_error_handlers` (wired in `app/main.py`): `{error, message (localized), fields?, details?, request_id, retryable}`. Field-level violations go in `fields` (`FieldViolation(path, code)`), never in `details`. The security handlers for `AuthorizationDenied` and `AuthenticationRequired` are registered after the envelope and override it. A domain error key with no `.po` entry is rendered as the raw key. The `X-Request-ID` response header is the support reference. Class names match the design's error table with no `Error` suffix (N818 is waived in `errors.py` files).

## Frontend architecture

All paths in this section are relative to `frontend/src/`.

- **Composition:** `main.tsx` → `App.tsx` → `shell/AppShell.tsx` (the providers, chrome and router; it also initializes i18next at module scope). `shell/appRuntime.ts` builds the runtime with no JSX or React state, so it can be unit-tested: the QueryClient, the Api_Client, the Session_Manager and the router, which depend on each other in a cycle broken by closures. Features get the Api_Client and the cache reset from `shell/appServices.ts` hooks (`useApiClient`, `useClearServerState`), never by importing an instance.
- **`api/client.ts` is the only HTTP layer.** No other module calls `fetch`. The client attaches the Bearer token and `Accept-Language`, enforces a 30 s timeout, retries reads at most twice and never retries mutations (`lib/retry.ts`), and records `X-Request-ID` as the support reference. On a 401 it refreshes and replays through the Session_Manager. On a 403 it does not refresh. Error envelopes are decoded in `api/errors.ts`. Request and response types come from `api/generated/schema.d.ts`, which is generated and committed; regenerate it with `npm run gen:api` and never hand-edit it. Secret values must never reach the console.
- **Session:** `session/SessionManager.ts` owns tokens, refresh, logout and context switching. Logout, a refused refresh and a context switch all clear the whole TanStack cache through one shared reset function.
- **Routing:** route access is declared once in `routing/routeAccess.ts` presets (roles, required context, `Approved` status) and shared by the route tree (`routes.tsx`) and the menu (`destinations.ts`), so the menu only shows routes the guard would admit. `RouteGuard` checks `GET /me/status`, and accounts that aren't `Approved` see only the onboarding screens.
- **Features:** `features/<area>/` holds one vertical slice per backend module plus `auth`, `mfa`, `onboarding` and `diagnostics`. A slice usually contains screens, `*Api.ts` request functions, `*Queries.ts` TanStack hooks, pure rule modules, and colocated tests.
- **i18n:** `i18n/locales/{ar,en,he}/<namespace>.json` has one namespace per feature area, and every key must exist in all three locales. `i18n/DirectionProvider.tsx` sets the RTL/LTR direction.
- **Shared code:** form validators and violation mapping are in `forms/`. Error presentation and the recovery boundary are in `errors/`.
- **Tests:** tests are colocated as `*.test.ts(x)`. Property tests are named `*.property.test.ts` and use fast-check. Component tests use Testing Library, and `src/test/setup.ts` stubs `matchMedia` for Mantine. Collaborators (fetch, timers, session) are injected rather than module-mocked.

## Backend conventions

- Ruff runs with line length 100, `force-sort-within-sections` isort, and the `ANN`, `S` and `TCH` rule sets. Type-only imports go under `TYPE_CHECKING`, **except** annotations evaluated at runtime by SQLAlchemy `Base` models or Pydantic `BaseModel`s, which must stay as real imports.
- Composition roots import lazily inside functions with `# noqa: PLC0415`.
- Use keyset pagination (`platform/pagination/keyset.py`), never OFFSET.
- Bounds are validated twice: in Pydantic and in a DB constraint or trigger.
- Native PG enums are defined in `platform/db/enums.py`. Primary keys are UUIDs. Timestamps are UTC `timestamptz(3)`, i.e. millisecond precision. Anything hashed or compared against a stored timestamp must use the same precision.
- Raw SQL runs on asyncpg, which cannot infer the type of a bare NULL parameter. Write explicit casts (`CAST(:p AS timestamptz)`), and don't mix `:param::type` with SQLAlchemy `text()` binds.
- i18n catalogs (ar/he/en) are in `app/platform/i18n/messages/*.po`. Arabic and Hebrew are RTL, and submitted text must be stored byte-identical.
- Domain guarantees are tested as numbered Hypothesis "Correctness Properties" from `design.md`, with the property number and requirement IDs annotated in the test.
- Code marked `PROVISIONAL` or `MOCK` is a stand-in for another section owner's work. Keep its public surface stable.
