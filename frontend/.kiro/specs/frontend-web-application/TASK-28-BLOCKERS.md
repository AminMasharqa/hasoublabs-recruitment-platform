# Task 28 (final checkpoint — full pipeline green): run results and blockers

Run date: 2026-09-22. Machine: Windows / PowerShell. All commands from `frontend/`
unless stated otherwise.

Last updated: 2026-09-22, after **Bugs 1 and 2 were fixed** (see those sections)
and the e2e suite was re-run. Bugs 3 and 4 are open. Three further backend
defects — Bugs 5, 6 and 7 — were found *because* those two fixes unblocked the
code paths that reach them; all three are recorded below.

Update 2026-10-05 (latest): **Bugs 3, 4 and most of Bug 10 fixed**, plus the
error-envelope wiring (field-level 422s now reach the client). A starter
Skill_Taxonomy is seeded (migration `0011`), and the apply endpoint no longer
500s. E2E is now **64 passed / 15 failed**. The remaining apply journeys are blocked
only by MinIO being unavailable (an apply needs a CV). See "Re-run after the
envelope fix" for the current attribution.

Update 2026-10-05 (earlier): **Bug 7 fixed and verified end to end.** The e2e run
also exposed two defects that were hiding behind "Bug 4": **Bug 8**, where the
journeys reload the page after signing in, and **Bug 9**, where the Route_Guard
hangs on its status read under StrictMode. Both are fixed. E2E went from 48
passed / 31 failed to **61 passed / 18 failed**; see the re-measured attribution.
Open: Bugs 3, 4 (narrowed to the admin MFA step), 5 and 6, plus the new
unattributed groups in that table.

## Summary

Seven of the eight pipeline gates are green. The one that is not — `test:e2e`, the
journey suite from task 27 — failed on **three backend defects** (Bugs 1–3) and
**one frontend/e2e defect** (Bug 4). Bugs 1 and 2 are now fixed; Bugs 3 and 4 are
open. None of the failures are in the unit, component, property, accessibility,
typecheck, lint, build or contract-verification gates.

| Gate | Command | Result |
| --- | --- | --- |
| Typecheck | `npm run typecheck` | pass (exit 0) |
| Lint | `npm run lint` | pass (exit 0, 3 pre-existing `only-export-components` warnings in `src/routing/routes.tsx`) |
| Unit / component / property | `npm run test` | **pass — 112 files, 1259 tests** |
| Build | `npm run build` | pass (`dist/` emitted; chunk-size warning only) |
| Contract drift | `npm run verify:api` | pass — committed `schema.d.ts` matches the live OpenAPI document |
| Accessibility gate | `npm run test:a11y` | **pass — 40/40 routes, no WCAG 2.1 AA violations** |
| E2E journeys | `npm run test:e2e` | **fail — 5 passed, 34 failed** (original run) → **48 passed, 31 failed** after the Bug 1 + Bug 2 fixes |

Task 28 is therefore left **not complete** in `tasks.md`.

Note on the two E2E numbers: `test:e2e` is a bare `playwright test`, so it runs
everything under `e2e/` — the 39 journey/locale tests *and* the 40 accessibility
tests. The re-run's 79 total is the honest count; the original run's 39 evidently
excluded the accessibility specs. Compared on journeys alone the movement is
**5 → 8 passed**, and much more of the change is in *why* the rest fail: the
`POST /verify/code` 500 that accounted for 31 of the 34 original failures appears
in none of them now. See the re-measured attribution table below.

## How the environment was brought up

Docker services were already running and healthy (`postgres`, `valkey`, `minio`,
`mailpit`, `clamav`, `openbao`). Two processes had to be started by hand:

```powershell
# backend/
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
.\.venv\Scripts\python.exe -m arq app.worker.WorkerSettings   # failed at the time
                                                              # of the run; fixed,
                                                              # see Bug 1
```

E2E environment used:

```powershell
$env:E2E_API_BASE_URL   = 'http://127.0.0.1:8000/api/v1'
$env:VITE_API_BASE_URL  = 'http://127.0.0.1:8000/api/v1'   # no dev-server proxy exists
$env:E2E_MAILPIT_BASE_URL = 'http://localhost:8025'
$env:E2E_ADMIN_TOTP_SECRET = '<your enrolled base32 secret>'
```

### Seeded Admin (the precondition `e2e/README.md` describes)

`e2e-admin@example.com` already existed in the dev database, Approved, role
`ADMIN`, password `correct-horse-battery-staple` (the `SEED_ADMIN` default). Its
TOTP secret was unrecoverable (envelope-encrypted via OpenBao), so it was
re-enrolled: the account's `mfa_secret_enc` / `mfa_wrapped_key` /
`mfa_enrolled_at` columns were set to `NULL`, `POST /auth/mfa/enroll` was called
on the resulting un-enrolled session, and the secret was read out of the returned
`provisioning_uri`. TOTP secrets are not committed: each developer re-enrols the
account this way and keeps the secret in their own environment.

Account id: `b9ab10fc-e5e0-4610-9b61-49bb471ac952`.

A `mfa_uri.txt` at the repo root once held a provisioning URI; it has been
removed and is now git-ignored. Only one secret is stored per account, so
re-enrolling invalidates any previously issued secret.

Note `POST /auth/mfa/verify` requires `account_id` in the body in addition to
`code` (not obvious from the enrolment response).

---

## Bug 1 — the ARQ worker cannot start: `app.modules.audit.tasks` does not exist — **FIXED 2026-09-22**

**Severity: blocked all asynchronous backend behaviour.** This is the upstream
cause of the first full-suite run (34 failures, every one of them
`No Verification_Code found ... Is Mailpit reachable?`).

### What was wrong

`backend/app/worker.py::_register_tasks` imported the module unconditionally:

```python
# backend/app/worker.py, line 47 (before the fix)
import app.modules.audit.tasks  # noqa: F401, PLC0415 - verify_audit_chain, create_audit_partition
```

`ModuleNotFoundError: No module named 'app.modules.audit.tasks'`. The only
`tasks.py` modules in the tree were:

```
app/modules/cvs/tasks.py
app/modules/identity/tasks.py
app/modules/jobs/tasks.py
app/modules/reporting/tasks.py
app/platform/mail/tasks.py
```

Because `WorkerSettings = build_settings()` runs at import time, the failure killed
the whole worker rather than degrading one task family. Consequences:

- `drain_email_outbox` never runs → no Verification_Code email is ever delivered.
  The dev database had **32 `outbox_emails` rows stuck in `Pending`** and Mailpit
  had received **0 messages** before this was worked around.
- `scan_cv` never runs → every `CvVersion` stays `PendingScan` forever.
- `generate_export` never runs → no Excel export ever reaches a terminal state.

**Confirmed, not inferred.** A throwaway entrypoint identical to
`build_settings()` minus that one import started cleanly, registered 7 functions,
and drained all 32 pending emails to `Sent` within ~20 seconds. That temporary
file has been deleted.

Related gaps found while doing that: `app/platform/jobs/catalog.py::SCHEDULES`
also schedules `verify_audit_chain`, `apply_retention_policy` and
`refresh_report_rollups`, and **none of those three had a registered handler**
either. Only `drain_email_outbox`, `expire_verification_codes`, `scan_cv`,
`verify_cv_checksums`, `extract_jd_from_url`, `extract_jd_from_text` and
`generate_export` existed.

### What was changed

**`backend/app/modules/audit/tasks.py` (new).** The module `worker.py` was
importing and that had never existed. It registers the two handlers the import
comment promised:

- `verify_audit_chain` — walks the chain through the existing
  `AuditChainVerifier`, resuming from a cursor in Valkey
  (`hasoub:audit:chain_verify_cursor`) so the table is not re-walked from
  genesis every hour. Losing the cursor costs a full re-walk, never a wrong
  answer. On mismatch the cursor is not advanced and nothing is repaired — a
  chain that can be repaired is not evidence of anything.
- `create_audit_partition` — `ensure_current_partition` +
  `ensure_next_partition`. This one mattered more than it looked: `audit_log` has
  no DEFAULT partition and `0002_audit_foundation` only pre-creates the current
  and next month, so **every audited write would have started failing in
  November 2026**. Scheduled daily rather than monthly, because the DDL is
  `CREATE TABLE IF NOT EXISTS` and a daily tick self-heals a missed run.

`JobName.CREATE_AUDIT_PARTITION` and its `Schedule` are new in
`app/platform/jobs/catalog.py`; the job was referenced by the `worker.py` comment
and by two docstrings but was in neither the enum nor the catalog.

**`backend/app/worker.py`.** `_register_tasks` now walks a `_TASK_MODULES` tuple,
imports each module independently, and returns the names that failed instead of
raising. That is the blast-radius half of the bug: one missing module took
`drain_email_outbox` down with it, which is the only reason 34 e2e tests failed
on a missing email. A new `_report_job_coverage` then checks that every
`Schedule` has a registered handler and reports any module that did not import —
warning in development, `RuntimeError` in production, the same shape as
`assert_all_routes_have_auth`.

**`backend/app/platform/jobs/scheduler.py`.** `_fire` skips a schedule whose job
has no registered handler, so an unhandled schedule no longer enqueues a job that
fails on every tick and buries real errors.

**`refresh_report_rollups`** now has a real handler in
`app/modules/reporting/tasks.py`: it refreshes every materialized view in the
application schema, discovered from `pg_matviews` rather than hard-coded, so it
reports zero today and needs no change when a rollup view is added.

**`apply_retention_policy` is deliberately still unregistered**, declared in a new
`UNIMPLEMENTED_JOBS` frozenset in `catalog.py` — the same idiom as
`PUBLIC_ROUTE_PATHS`, so the boot check can tell a known gap from a wiring
mistake. It needs the declarative
`(entity, retention_basis, minimum_period, action)` table from the design's Data
Retention Model, which no migration creates, and its actions anonymise candidate
data. That is a feature with a migration, not a wiring gap, and a handler that
silently did nothing would have been worse than an honest absence.

### Verification

Cold boot from committed code:

```
INFO:app.worker:Scheduled jobs with no handler yet (declared in UNIMPLEMENTED_JOBS,
not enqueued): apply_retention_policy
Starting worker for 10 functions: drain_email_outbox, verify_audit_chain,
create_audit_partition, expire_verification_codes, scan_cv, verify_cv_checksums,
extract_jd_from_url, extract_jd_from_text, generate_export, refresh_report_rollups
INFO:app.platform.jobs.scheduler:Scheduler started with 7 schedules (leader=True)
```

Ten functions, up from the seven the throwaway entrypoint managed. The three new
jobs were enqueued by hand rather than waiting for their cron windows:

```
create_audit_partition ● {'status': 'ensured'}
  audit: ensured partition audit_log_2026_09 [2026-09-01, 2026-10-01)
  audit: ensured partition audit_log_2026_10 [2026-10-01, 2026-11-01)
refresh_report_rollups ● {'status': 'ok', 'refreshed': [], 'skipped': []}
verify_audit_chain     ● walked ids 1–625  (see Bug 5 for what it found)
```

`drain_email_outbox` ticks every 10 s and returns
`{'claimed': 0, 'sent': 0, ...}` — the 32 stuck rows had already been drained by
the earlier workaround, so there is nothing left to send.

`ruff` (0.8.4, repo config) is clean on every file touched.
`app/modules/reporting/tasks.py` still reports its 5 pre-existing findings —
confirmed byte-identical at `HEAD`, so none are new. `pytest tests/unit` →
**259 passed**. `tests/integration/test_audit` errors at setup on a pre-existing
`ScopeMismatch` (the module-scoped `_run_audit_migration` fixture requests the
function-scoped `pg_engine`); it is test-side and unrelated. mypy is not
installed in `.venv`, so the strict typecheck was not run.

### Still open in this area

Secondary observation, same file family — `app/main.py` logs a boot-time
authorization assertion failure at every startup but continues anyway:

```
Boot-time authorization assertion FAILED.
The following routes lack an authorization dependency:
  - /api/openapi.json ['GET', 'HEAD']
  - /api/docs ['GET', 'HEAD']
  - /docs/oauth2-redirect ['GET', 'HEAD']
  - /api/redoc ['GET', 'HEAD']
```

The docs routes are presumably meant to be in `PUBLIC_ROUTE_PATHS`. Harmless in
development, but an assertion that "fails" and then proceeds is worth deciding
about.

---

## Bug 2 — schema/ORM enum mismatch: `POST /verify/code` returns 500 — **FIXED 2026-09-22**

**Severity: blocked 31 of the 34 e2e failures.** After Bug 1 was worked around and
mail started flowing, the suite's next wall was:

```
POST /verify/code -> 500 internal_server_error
```

### What was wrong

Backend traceback:

```
sqlalchemy.exc.ProgrammingError: <asyncpg.exceptions.UndefinedFunctionError>:
operator does not exist: character varying = account_status
HINT: No operator matches the given name and argument types.

[SQL: SELECT ... FROM accounts
      WHERE accounts.email_released IS false
        AND accounts.status = $1::account_status
        AND accounts.roles @> CAST($2::VARCHAR[] AS VARCHAR[])
      ORDER BY accounts.created_at]
[parameters: ('Approved', ['ADMIN'])]
```

Worth noting in hindsight: that SQL carries **two** type faults, not one. The
reported error is the `status` comparison, but `accounts.roles @> CAST($2::VARCHAR[]
AS VARCHAR[])` on the next line is the second — `accounts.roles` was correctly
typed `role[]` all along, and the operand is cast to `varchar[]`. PostgreSQL only
ever reports the first, so fixing the schema alone just moved the 500 one predicate
to the right. Both halves are covered under *What was changed*.

The ORM maps the column to the native PostgreSQL enum:

```python
# backend/app/modules/identity/models.py, line 73
status: Mapped[AccountStatus] = mapped_column(account_status_type, nullable=False)
```

…but migration `0003_identity.py` creates it as a plain string:

```python
# backend/alembic/versions/0003_identity.py, line 134
sa.Column("status", sa.String(50), nullable=False, server_default="PendingVerification"),
```

**This is systemic, not one column.** The migrations *do* create every enum type
(`account_status`, `role`, `jd_status`, …) and `accounts.roles` correctly uses
`_role`, but almost every other enum-valued column landed as `varchar`.

The authoritative list is **19 columns**, derived by walking `Base.metadata` for
every column whose ORM type is a named `sa.Enum` and comparing each against
`information_schema.columns`, rather than by reading the migrations:

```
accounts.status                        -> varchar   (should be account_status)
account_status_transitions.from_status -> varchar
account_status_transitions.to_status   -> varchar
email_verifications.state              -> varchar
residency_proofs.type                  -> varchar
registration_links.role                -> varchar
candidate_profiles.state               -> varchar
candidate_education.enrolment_status   -> varchar
senior_profiles.contact_channel_pref   -> varchar
senior_profiles.contact_scope_pref     -> varchar
cv_versions.state                      -> varchar
job_descriptions.work_model            -> varchar
job_descriptions.employment_type       -> varchar
job_descriptions.experience_level      -> varchar
job_descriptions.status                -> varchar
job_descriptions.application_channel   -> varchar
applications.status                    -> varchar
applications.routed_channel            -> varchar
report_exports.status                  -> varchar
```

Two corrections to the list as first recorded here: `registration_links.role` and
`residency_proofs.type` are affected and were missing, while
`application_status_transitions.from_status` / `to_status` are **not** — the ORM
maps those two as `String(50)`, so model and schema already agreed.

Only `accounts.roles` (`_role`), `outbox_emails.state` (`outbox_email_state`) and
`notifications.type` (`notification_type`) were correctly typed.

Any query that *compares* one of these columns to a bound enum parameter 500s.
Queries that only *select* the column are fine, which is why
`GET /me/status`, `GET /admin/accounts`, `GET /admin/audit` and
`GET /admin/skills/pending` all return 200 while `POST /verify/code` does not.

Why the backend's own test suite did not catch this — **checked, and it is not the
`create_all` explanation originally guessed here.**
`backend/tests/integration/conftest.py` does run `alembic upgrade head` against a
Postgres testcontainer, so the integration schema is the real migrated one. Three
things combined instead:

* No integration test ever *compares* an enum-valued column to a bound enum
  parameter — the only shape that fails.
* `Base.metadata` was incomplete (the taxonomy and reference models were never
  registered), so `compare_metadata` and `alembic revision --autogenerate` both
  raised `NoReferencedTableError` before emitting a single diff line. The drift was
  not merely unasserted, it was unobservable by the tool designed to find it.
* The whole `tests/integration/test_audit` module errors at setup on a fixture
  `ScopeMismatch` (see Bug 1's verification notes), so the one integration module
  that does exercise real schema behaviour never ran.

### What was changed

The `ALTER ... USING` direction was taken rather than retyping the models to
`sa.String`: it preserves the design's intent, and the enum types already exist.

**`backend/alembic/versions/0010_enum_column_alignment.py` (new).** Retypes all 19
columns, carrying each column's server default across with an enum cast
(`SET DEFAULT 'PendingVerification'::account_status`). The cast needed no data
audit beyond a check that every stored value was already a valid label of its
target enum — `USING col::enum` fails loudly on anything else rather than
coercing it.

One dependent object had to be rebuilt by hand:
`uq_applications_candidate_jd_non_terminal`, the R7 AC7 partial unique index.
PostgreSQL refuses to rebuild its varchar-era predicate over the new type —

```
InvalidObjectDefinitionError: functions in index predicate must be marked IMMUTABLE
```

— because the enum→text cast the old predicate carries is only STABLE. The
migration drops it, retypes the column, and recreates it with an enum predicate
(`WHERE status IN ('Submitted', 'Under Review')`), which is what the model
declares anyway. The `senior_profiles` scope CHECK constraint *does* survive the
rewrite, keeping its `(contact_channel_pref)::text = 'None'::text` form, which
stays correct against the enum; it is left alone rather than reproducing the
naming convention's truncated-and-hashed constraint name by hand.

**`backend/app/modules/identity/repository.py`.** The migration alone did not fix
the endpoint. It moved the 500 one predicate to the right, inside the very same
query:

```
asyncpg.exceptions.UndefinedFunctionError: operator does not exist:
role[] @> character varying[]
```

Two functions cast the operand of a `role[]` containment check to `varchar[]`:

```python
Account.roles.contains(cast([Role.ADMIN.value], PG_ARRAY(String)))
```

`get_all_admin_accounts` (the notification-target lookup `POST /verify/code`
performs) and `list_accounts`'s `?role=` filter. Same defect class as the schema
half — an enum compared against a varchar — but in application code.
`get_account_by_email` already had it right with `PG_ARRAY(role_type)`; the other
two now match it.

**`backend/app/platform/db/metadata.py`.** Registers
`app.platform.taxonomy.models` and `app.platform.reference.models`. This is a
prerequisite, not tidying: without `skills`, the `candidate_skills.skill_id`
foreign key cannot resolve, `Base.metadata.sorted_tables` raises
`NoReferencedTableError`, and **every** `compare_metadata`/autogenerate call dies
before producing a diff. That is a large part of the answer to why this drift went
unnoticed for seven migrations — nobody could run autogenerate against this
metadata at all.

**`backend/tests/integration/test_schema_enum_alignment.py` (new)** — the guard,
described under its own heading below.

### The guard

Three assertions, running against a database built by `alembic upgrade head` via
the existing `pg_engine` fixture:

1. the ORM actually declares enum columns at all (so a missing model registration
   in `metadata.py` fails loudly instead of making the next two vacuous);
2. every column the ORM maps to a named enum has that enum type in the schema;
3. every such type carries exactly the ORM's labels, in the same order —
   PostgreSQL orders by `enumsortorder`, and comparisons and `ORDER BY` on the
   column use that order, not the Python declaration order.

Deliberately narrow rather than a blanket `compare_metadata` diff. That full diff
returns dozens of benign entries on this schema — audit-log child partitions,
server defaults the models do not declare, column comments, expression indexes
Alembic cannot compare — so a total-drift assertion would be noise rather than a
signal, and would fail for reasons unrelated to the defect it is guarding.

### Verification

Negative control first, on a throwaway database: the guard reports **19
mismatches** at `0009b_mfa_wrapped_key` and **0** at head. `upgrade head` →
`downgrade -1` → `upgrade head` all succeed, and the index definition returns to
its exact original varchar form on the way down.

Then against the dev database, after applying the migration and restarting both
uvicorn and the ARQ worker (asyncpg caches type information per connection, so
pooled connections opened before the `ALTER` must be recycled): the full
`registerVerifiedApprovedAccount` sequence from `e2e/support/backend.ts`,
replicated over plain HTTP —

```
POST /admin/registration-links            -> 201
POST /register/candidate                  -> 201
(Verification_Code read from Mailpit)
POST /verify/code                         -> 200   status: PendingApproval
POST /admin/accounts/{id}:approve         -> 200   status: Approved
GET  /admin/accounts?role=CANDIDATE       -> 200   (the role[] cast fix)
GET  /admin/accounts?status=Approved      -> 200   (enum column filter)
```

The worker's `expire_verification_codes` now returns `{'expired': 0}` instead of
dead-lettering on `character varying = email_verification_state`.

`ruff` clean on both new files; `repository.py` is down to 3 findings, all in the
untouched top-of-file import block. `pytest tests/unit` → **259 passed**. The new
integration file → **3 passed**.

No regression from the type change in raw SQL: queries that compare these columns
to a plain string parameter (`WHERE to_status = :status`, `GROUP BY status`,
`'CANDIDATE' = ANY(roles)`) all still work — asyncpg types the parameter from the
column. The reporting failures in that area are Bug 3's untyped *date*
parameters, unchanged.

---

## Bug 3 — `GET /admin/reports/activity` returns 500 (untyped NULL parameters) — **FIXED 2026-10-05**

Independent of Bugs 1 and 2. Reproduced directly with an Admin bearer token.

```
sqlalchemy.exc.ProgrammingError: <asyncpg.exceptions.AmbiguousParameterError>:
could not determine data type of parameter $1

[SQL:
        SELECT count(*) FROM accounts
        WHERE 'CANDIDATE' = ANY(roles)
          AND ($1 IS NULL OR created_at >= $1)
          AND ($2   IS NULL OR created_at <= $2)
        ]
[parameters: (None, None)]
```

Raw SQL with an unfiltered date range gives asyncpg two bare `NULL`s it cannot
type. asyncpg has no implicit-cast fallback the way psycopg does. Fix is an
explicit cast (`$1::timestamptz`) or building the predicate conditionally instead
of the `($1 IS NULL OR …)` idiom.

**Correction to the first diagnosis here: this is not limited to the unfiltered
default view.** Calling the repository functions directly with real
`date_from`/`date_to` values fails identically — `AmbiguousParameterError` is
about the *statement shape* (`$1 IS NULL`), which asyncpg must type at Prepare
time before any value is bound. No input makes the activity report work. Every
one of `count_candidates_registered`, `count_candidates_by_status` and
`count_cv_versions_uploaded` fails this way.

`count_applications_by_status` additionally carries a plain syntax error —
`(:jd_id IS NULL OR jd_id = :jd_id::uuid)` yields
`PostgresSyntaxError: syntax error at or near ":"`.

This is what fails `e2e/journeys/reports.spec.ts` once the login blocker below is
cleared.

### What was changed

The defect was wider than the three functions named above, and it covered both
report endpoints. All of the raw SQL is in
`backend/app/modules/reporting/repository.py`:

- **Untyped NULL parameters**, in 7 predicates (activity counts, application
  counts and the applications export). They are now
  `CAST(:p AS timestamptz) IS NULL OR col >= CAST(:p AS timestamptz)`, so asyncpg
  can type the parameter at Prepare time.
- **`:name::type` inside `text()`**, at 5 sites. SQLAlchemy does not treat `:name`
  as a bind when `::` follows it, so the literal reached PostgreSQL. These are now
  `CAST(:name AS uuid)` / `CAST(:account_ids AS uuid[])`. One of them was in the
  candidate-progress **page query** itself, so `/admin/reports/candidate-progress`
  also returned 500 on every call, first page included.
- **The paging bug behind it.** `list_candidate_progress` fetched `limit + 1`
  rows to detect a next page, then returned only `limit` of them. The service's
  `len(rows) > limit` check could therefore never be true: `has_next` was always
  false, and nothing past the first page was reachable. Bug 3's 500s had hidden
  this. The repository now returns the extra row and the service trims it, which
  is the same contract as `jobs/repository.py::list_open_jds`.

No other module has either SQL pattern (checked across `backend/app`).

### Verification

- **`tests/integration/test_reporting_queries.py` (new)** runs every activity query
  and the applications export against `alembic upgrade head`, unfiltered and with
  a date window, for any JD and for one JD. It also pages candidate progress
  exactly the way `ReportService` does, using the extra row as the only
  `has_next` signal.
  - Before the fix: 4 × `AmbiguousParameterError` and 1 × the `:` syntax error.
  - With the over-fetch trimmed again, the paging test fails.
  - With the fix: 5 passed.
- **Live API:** `/admin/reports/activity` returns 200 unfiltered, with a date window
  and with a JD filter. `/candidate-progress` walks 6 pages (all 200) and reaches
  all 128 candidates in the dev database, with no duplicates.
  `candidates_registered` is 128, which agrees.
- **`e2e/journeys/reports.spec.ts`:** 2 passed.
- **Backend unit suite:** 263 passed.

---

## Bug 4 — MFA code step issues no second `/auth/login` request (frontend or journey helper) — **FIXED 2026-10-05: the journey helper**

**The one failure that is not clearly backend-side.**

**Revised blast radius (2026-09-22 re-run): far larger than the 3 journeys
recorded below.** With Bug 2 fixed, roughly 20 of the 31 remaining failures are
now UI-login failures — tests that time out waiting for an element on an
authenticated screen, or assert a destination and get `/login`. They span
`profile.spec.ts`, `cv.spec.ts`, `reviews.spec.ts`,
`jobs-applications.spec.ts`, `registration.spec.ts` (the gating test),
`auth-session.spec.ts` and most `tri-locale.spec.ts` variants, as well as the
three originally attributed here. They were previously failing earlier, at
`POST /verify/code`, which hid the fact that they never got past login either.
Whatever the root cause turns out to be, fixing it is now worth far more than the
2 failures the original attribution credited it with.

Originally observed on the 3 journeys that sign in as the Admin through the real
UI: `admin-accounts.spec.ts` (first test), `audit.spec.ts` (chain-verify test),
`reports.spec.ts`.

Symptom: after a correct credential submission the MFA step appears, the journey
helper fills `mfa-code-input` with a fresh TOTP code and clicks
`mfa-code-submit`, and the page stays on `/login`.

Uvicorn access log for the browser's whole login attempt — note there is **no
second POST**:

```
OPTIONS /api/v1/auth/login HTTP/1.1" 200 OK
POST    /api/v1/auth/login HTTP/1.1" 401 Unauthorized     <- mfa_required, correct
(nothing further)
```

Playwright page snapshot at failure time:

```
- heading "Two-step verification" [level=2]
- textbox "Authenticator code"          <- empty
- button "Verify and sign in" [disabled]
- alert: Enter your authenticator code to continue.
```

Reading that against `src/features/mfa/MfaCodeStep.tsx`: the alert text is
`auth:mfa.codeIncomplete`, which is only announced when
`validateMfaCodeValues(values)` returned violations — the early-return branch of
`submit()` that fires **before** `api.request` is called. So `submit()` did run,
and it saw `values.mfa_code` as empty or short.

That contradicts the click having been possible at all: the button's
`disabled={!isSubmittableMfaCode(values.mfa_code)}` reads the same state, and
Playwright waits for enabled before clicking. So state held a valid 6-digit code
at click time and an invalid one inside the handler. Something is resetting
`values` between the click and the handler — a remount of `MfaCodeStep`, or the
`autoFocus` / `useViolationFocus` interaction, are the obvious suspects.

Two things to rule out, in this order:

1. **The journey helper's race.** `loginAsAdminThroughUi` in
   `e2e/journeys/admin-accounts.spec.ts` gates on
   `await mfaStep.isVisible().catch(() => false)` immediately after clicking
   submit, with no wait. That is the standard Playwright anti-pattern and it may
   be interacting with the step mid-mount. Replacing it with
   `await expect(mfaStep).toBeVisible()` is the cheap first experiment.
2. **A genuine `MfaCodeStep` state reset.** If (1) does not fix it, the component
   is losing the controlled value across the submit. Note the component tests in
   `MfaCodeStep.test.tsx` drive the input with `userEvent.type` (per-character
   events) while Playwright's `fill` sets the value in one shot — a component that
   only tracks per-keystroke state would pass the former and fail the latter.

Ruled out already: TOTP correctness and code reuse. The same
`currentTotpCode(secret)` helper authenticates fine over plain `fetch`, and the
backend accepts the **same** code twice inside one 30-second window (verified:
two sequential `POST /auth/login` calls with an identical `mfa_code` both
returned 200), so nothing about single-use replay protection is involved.

### Resolution (2026-10-05): hypothesis 1, the helper's race

Note first that most of the ~20 failures once credited here were Bugs 8 and 9.
Candidate and senior sign-in has no MFA step at all. What was left was the
admin-only MFA step, and a Playwright trace of `admin-accounts.spec.ts` settles it:

```
 8049 ms  click   login-submit
 8171 ms  isVisible mfa-code-step  → false   (11 ms after the call)
          POST /auth/login → 401 mfa_required   (arrives after the check)
 8201 ms  expect toHaveURL /admin/accounts      (no code typed, no second POST)
```

`isVisible()` does not wait. It ran before the `mfa_required` response had
rendered the step, so the helper skipped the MFA branch entirely. `MfaCodeStep`
never lost state; hypothesis 2 was not needed.

**Fix.** The four sign-in sites now `await expect(mfaStep).toBeVisible()` and then
enter the code unconditionally:
- `admin-accounts.spec.ts` (`loginAsAdminThroughUi`)
- `audit.spec.ts` ×2
- `reports.spec.ts`

The seeded Admin is MFA-enrolled by precondition, so the step always follows the
credentials. The two other `isVisible().catch` uses, a pagination loop and an
export-ready check, run against already-rendered content and are unchanged.

**Verified.** Run alone, all five admin journeys now pass MFA and reach their
screens. Three of them then fail further on, for reasons that are not Bug 4:
- `reports`: Bug 3, with the exact signatures (`AmbiguousParameterError` on `$1`,
  and the `:jd_id::uuid` syntax error) on `/admin/reports/activity` and
  `/candidate-progress`.
- `audit`: the entry's action is `Account.updated`, but the test expects
  `/approve/i`.
- `admin-accounts` suspend: the account's card is not in the filtered list.

---

## Bug 5 — the audit hash chain fails verification on every entry (µs hashed, ms stored)

**Found by fixing Bug 1: the first real run of `verify_audit_chain` reported a
tamper.** It is not a tamper. It does mean R8 AC8's tamper detection is currently
useless, and that the scheduled job logs `CRITICAL` hourly (cron `minute: 5`).

It should not fail `audit.spec.ts` — that test asserts the chain-verify control
reports all four members "on every answer — intact or tampered", so a `false`
verdict still satisfies it. But `GET /admin/audit/chain/verify` runs the same
verifier, so the Admin UI will show the chain as broken once Bug 4 lets anyone
log in and look.

```
CRITICAL:app.modules.audit.service:AUDIT CHAIN TAMPER DETECTED: first bad entry id=1
verify_audit_chain ● {'status': 'tampered', 'first_bad_id': 1, 'from_id': 1,
                      'through_id': 625}
```

`append_audit_entry` hashes `ts = datetime.now(UTC)` at **microsecond** precision,
but `occurred_at` is `UtcTimestampMs` = `timestamptz(3)`, so Postgres stores
**milliseconds**. `verify_chain_window` then re-hashes the truncated value it reads
back, and gets a different digest. 999 of every 1000 entries will false-positive.

**Proven, not inferred, and read-only.** Brute-forcing the 1000 microsecond
offsets inside entry 1's stored millisecond reproduces the stored `entry_hash`
exactly at offset `073`:

```
id 1  occurred_at 2026-09-21T21:07:04.097000+00:00   prev_hash None
stored    c2ac60955e9e276a02af49fdcac527bdf3d3e75a7d7e2208dba4487c6c26b640
as-stored 8110c84f3549dcb74df3a0854b53ead877d0f04f43155533b6c47cdfaabdb727
microsecond offset reproducing the stored hash: 73
```

Nothing else about the row differs, so the truncation is the whole explanation.

Fix direction: round `ts` to milliseconds in `append_audit_entry` before it is
both hashed and inserted, so writer and verifier canonicalise the same value. The
open decision is history: rows written before the fix stay unverifiable whatever
happens, so someone has to choose between seeding
`hasoub:audit:chain_verify_cursor` past them and accepting a permanent reported
break at id 1. That is a tamper-evidence call, which is why the fix was not made
as a side effect of Bug 1.

---

## Bug 6 — failure audit entries are never written: the rollback path passes a masked password — **FIXED 2026-10-05**

**Also surfaced by the worker running.** R8 AC5 requires exactly one failure entry
per failed operation; none are being recorded.

```
ERROR:app.modules.audit.repository:audit: failed to write failure entry for
action='operation.failed' entity=Transaction/unknown
asyncpg.exceptions.InvalidPasswordError: password authentication failed for user "hasoub"
```

`UnitOfWork.__aexit__` builds the connection string for the separate-connection
write with `engine_url = str(engine.url)` (`app/platform/db/unit_of_work.py`,
~line 128). SQLAlchemy's `URL.__str__` renders the password as `***`, so
`append_failure_entry` opens an engine with a literal `***` password and cannot
connect. Its `except` swallows the failure by design — "losing a failure entry is
better than masking the original error" — which is why this has been silent.

Fix is one line: `engine.url.render_as_string(hide_password=False)`.

Note the entry this was trying to write was itself a consequence of Bug 2, so the
two appeared together in the worker log. With Bug 2 fixed nothing is failing, so
this is currently silent again rather than resolved.

### What was changed — **FIXED 2026-10-05**

- **Fix:** `UnitOfWork._write_failure_entry` now passes
  `engine.url.render_as_string(hide_password=False)`.
- **Guard:** `tests/unit/test_uow_failure_entry_url.py` rolls back a real
  `UnitOfWork` and captures the failure-entry write. It asserts exactly one entry,
  with the unmasked password. It **fails before the fix** (`'***'` in the URL)
  and passes after.
- **Live on the dev database:** rolling back a `UnitOfWork` took the
  `operation.failed` count from 0 to 1. That probe entry stays in the
  append-only log.
- **Suites:** backend unit and integration pass. The API and worker were
  restarted on the fix.
- **Not covered:** `tests/integration/test_audit` is still excluded because of
  its fixture ScopeMismatch, so the failure entry's chain linkage is not exercised
  there yet.

---

## Bug 7 — `POST /jobs` returns 500: the ORM writes a trigger-owned `tsvector` column as varchar — **FIXED 2026-10-05**

**Found by fixing Bug 2, and now the top blocker for 9 e2e tests.** Pre-existing,
not a regression — it was simply unreachable while `registerVerifiedApprovedAccount`
failed first.

```
asyncpg.exceptions.DatatypeMismatchError: column "search_tsv" is of type tsvector
but expression is of type character varying
HINT: You will need to rewrite or cast the expression.

[SQL: INSERT INTO job_descriptions (..., search_tsv, ...)
      VALUES (..., $15::VARCHAR, ...)]
```

Migration `0006_jobs.py` creates the column as `postgresql.TSVECTOR` and populates
it from a `BEFORE INSERT OR UPDATE` trigger (`trg_jd_search_tsv`). The model
declares it as `sa.Text` under a comment asserting the opposite of what SQLAlchemy
does:

```python
# backend/app/modules/jobs/models.py, line 83
# Not mapped with Mapped[] so SQLAlchemy never tries to write it directly.
search_tsv = sa.Column("search_tsv", sa.Text, nullable=True, comment=...)
```

A plain `sa.Column` on a declarative class is still a mapped, persisted column.
SQLAlchemy includes it in the INSERT with a NULL varchar, and PostgreSQL rejects
the statement. The column needs to be excluded from ORM persistence (and typed
`TSVECTOR` to match), not just commented as off-limits.

This is the same model-vs-migration family as Bug 2 with a different type, so it
is also the reason `job_descriptions.search_tsv` shows up as
`modify_type TSVECTOR -> Text` in a `compare_metadata` diff.

Related, same column: `backend/app/modules/jobs/repository.py` (~line 73) filters
with `func.to_tsvector("simple", JobDescription.search_tsv)` — calling
`to_tsvector` on a value that is *already* a `tsvector`. No such function
signature exists, so JD text search will fail the same way once it is reached. The
predicate should be `search_tsv @@ plainto_tsquery('simple', :search)`.

Blocks `createOpenJob` in `e2e/support/backend.ts`, hence all of
`jobs-applications.spec.ts` and the job-browsing, application-submission and
review variants of `tri-locale.spec.ts`.

### What was changed — **FIXED 2026-10-05**

The root cause is narrower than "a plain `sa.Column` is persisted". The ORM sends
an explicit `NULL` on INSERT for **every** nullable column that has no default
and was never set, whatever way it was declared. So the fix has to tell the
mapper the value is generated by the database, not just leave the column unset.

**`backend/app/modules/jobs/models.py`.** `search_tsv` is now
`mapped_column(TSVECTOR, server_default=FetchedValue(), server_onupdate=FetchedValue(), deferred=True)`.
- `FetchedValue` keeps the column out of the INSERT and lets the trigger fill it.
- An UPDATE only writes changed attributes, so the trigger owns it there too.
- `deferred` keeps the vector out of every `SELECT job_descriptions.*`, since only
  the search predicate reads it.
- The type now matches the migration, which also removes the
  `modify_type TSVECTOR -> Text` autogenerate diff.

**`backend/app/modules/jobs/repository.py`.** `list_open_jds` now matches the
column directly: `search_tsv @@ plainto_tsquery('simple', :search)`. That is the
same `simple` config the trigger builds the vector with.

### Verification

- **Unit tests,** `tests/unit/test_jobs_search_tsv.py` (new, 4 tests, no I/O). They
  check the column contract (TSVECTOR, `FetchedValue`, deferred), and that the
  compiled browse SQL uses `search_tsv @@ plainto_tsquery(`, has no `to_tsvector`,
  and doesn't select the vector. **All 4 fail against the pre-fix code and pass
  after it.**
- **Full backend unit suite:** 262 passed, 1 failed. The failure is the
  pre-existing `test_password.py::test_fresh_hash_never_needs_rehash`, flaky on
  slower machines because argon2 hashing exceeds Hypothesis's 200 ms deadline.
  It is unrelated to this change.
- **Integration test,** `tests/integration/test_jobs_search_tsv.py` (new). It runs
  against `alembic upgrade head`: an ORM INSERT, a check that the trigger
  populated the vector, then a search hit and a miss, and an UPDATE that
  re-triggers the vector. **Not yet run:** the machine used had no Docker, so it
  was skipped. Run it with `uv run pytest tests/integration/test_jobs_search_tsv.py`
  where Docker is available.
- **E2E: not re-run**, for the same reason. The 9 failures attributed to this bug
  in the table below are expected to clear. Confirm with `npm run test:e2e`
  against a live backend.
- **Later the same day, with Docker:**
  - The integration test passes. Against the pre-fix code it fails with exactly
    the `search_tsv` `DatatypeMismatchError` above.
  - On the live stack, `POST /api/v1/jobs` returned 201 on every call, with no 5xx
    anywhere in the run.
  - The 9 job tests then failed at a later step, which was Bugs 8 and 9.

---

## Bug 8 — the journeys reload the page after signing in, which signs them out — **FIXED 2026-10-05**

**The largest part of what was attributed to Bug 4.** The candidate and senior
journeys have no MFA step, yet they all ended on `/login`.

The Session_Manager keeps the session in memory only. `SessionManager.ts` says a
page reload "starts with no session", by design (Requirement 4 AC3, AC11). The
journeys signed in through the UI correctly; the `/jobs` URL assertion passed. They
then moved to the next screen with `page.goto('/candidate/profile')`, which is a
full page load. That discarded the session, and the Route_Guard sent the browser
back to `/login`. This is a test-suite defect, not an application one.

**Fix.**
- **New helper, `e2e/support/navigation.ts::navigateInApp`.** It pushes the target
  onto the history and fires `popstate`, which `createBrowserRouter` handles as a
  client-side navigation through the same guard. It first waits for a UI sign-in
  to leave `/login`.
- **27 post-sign-in `page.goto` calls** across 10 specs now use the helper.
- **Left as page loads on purpose:** `page.goto` stays for `/login`, for
  Registration_Links, and for the two assertions that a reload or a signed-out
  visit lands on `/login` (`auth-session.spec.ts`, `reports.spec.ts`).

## Bug 9 — the Route_Guard hangs on "Loading…" when its status read races an effect cleanup — **FIXED 2026-10-05**

**An application bug, exposed once Bug 8 was fixed.** Signed in and navigating
in-app, the guarded screens rendered "Loading…" forever. `GET /me/status` returned
200, and nothing after it was ever requested.

`useAccountStatusSync` (`src/routing/accountStatus.ts`) latched the in-flight read
in a ref and skipped any effect run whose key was already latched. React
StrictMode, which `main.tsx` uses, runs each effect, cleans it up, and runs it
again:
1. The first run issued the read and set the latch.
2. Its cleanup marked that run cancelled.
3. The second run saw the latch and returned without subscribing.
4. When the read resolved, its only subscriber was the cancelled run, so the result
   was discarded. Nothing ever re-ran the effect, so the guard waited forever.

The same deadlock happens in production whenever the effect's dependencies change
while the read is outstanding.

**Fix.**
- **Every effect run subscribes to the read.** `requestAccountStatus` already
  shares one in-flight read per account, so this never issues a second request.
- **The ref now records only a key whose read *failed*.** That keeps the
  "no automatic re-request after a failure" behaviour, and retry stays explicit.

**Guard.** A new `RouteGuard.test.tsx` case renders the guard under `<StrictMode>`.
It **fails before the fix and passes after**, and asserts that the read is still
issued exactly once. The full frontend unit suite has 1258 passing; the 2 failures
are the pre-existing `JobNewScreen.test.tsx` timeouts on slow machines.

## Bug 10 — candidate profile save: never `Complete`, in four layers — **partly fixed 2026-10-05**

Behind the 5 "candidate profile save" e2e failures (`profile`,
`jobs-applications` apply, `tri-locale` application ×3). Each layer, once fixed,
exposed the next.

1. **Fixed (test): the enrolment-status option locator hit the header.**
   `page.getByRole('option').first()` was meant to pick the first option of the
   Mantine `Select`. But the header's language picker is a native `<select>`, and
   its hidden `<option>`s matched first, so the click waited forever. The locator
   is now scoped to `getByRole('listbox')`, in 3 specs.
2. **Fixed (test): the profile phone was not E.164.** The journeys entered
   `0501234570`; R4 AC6 and AC11 require E.164, so the backend was right to reject
   it. The plausible-looking `+972501234570` is also invalid to `phonenumbers`,
   because the range is unallocated. The specs now use allocated numbers
   (`+97250234567x`). Residency-proof phones stay local-format, as R2 AC2
   specifies.
3. **Fixed (backend): the save evaluated and persisted completeness on stale
   data.** `CandidateProfileService.update` replaces the child collections, then
   re-reads the profile in the same session to evaluate AC6. Two things made that
   re-read stale:
   - The session has `autoflush=False`, so the newly added child rows were not
     yet written.
   - The identity map returned the already-loaded, pre-save collections.

   As a result the save returned `education: []` and **wrote `state = Draft` to
   the database** even for a profile meeting every AC6 condition. The fix is a
   flush before the re-read plus `populate_existing` on the relations fetch; both
   are needed (verified by removing each). The same pattern in the senior-profile
   update is fixed the same way.
   - Guard: `tests/integration/test_candidate_profile_update.py`, which **fails
     before the fix and passes after**.
   - Live: the save response now carries the saved education.
4. **Mitigated with option (a), 2026-10-05: skills not in the Skill_Taxonomy are dropped from
   the profile.**
   - **Done:** `alembic/versions/0011_seed_skill_taxonomy.py` seeds 55 common skills
     (en/ar/he names) and 16 aliases, using `ON CONFLICT DO NOTHING`.
   - **Downgrade:** removes only seeded skills that nothing references.
   - **C, C++ and C# are deliberately not seeded.** `normalize_skill_term` strips
     `+` and `#`, so all three normalise to `"c"` and would collide. That
     normaliser defect is still open.
   - **Guard:** `tests/unit/test_skill_taxonomy_seed.py`.
   - **The journeys now enter seeded skills** (`SQL`, `QA Automation`), and the
     `profile` journey passes.
   - **Option (b) is still open** for a team decision: an unknown skill still
     vanishes from the profile.

   The original analysis: The dev database's `skills` table is **empty**, and nothing in
   the repo seeds it. Every entered skill is therefore unmatched. `SkillResolver`
   records it in `unmatched_skill_terms` for Admin review (R4 AC3), but
   `CandidateProfileService.update` keeps only terms that resolve to a
   `skill_id`, and `candidate_skills.skill_id` is `NOT NULL`. So the candidate's
   profile has no skills and can never be `Complete` (R4 AC6 needs ≥ 1 skill).
   The options are:
   - **(a) Seed a starter Skill_Taxonomy** (a migration or seed script). This
     unblocks the common skills, but an unknown skill still vanishes from the
     profile.
   - **(b) Keep pending skills on the profile:** a nullable `skill_id` plus a link
     to the unmatched term, and decide whether a pending skill counts toward AC6.
     This is a schema change and a spec-interpretation call for R4 AC3/AC6.
5. **Fixed (backend): every apply returned 500.** `ApplicationService` was
   written against a provisional dict contract (`jd_data.get("status")`,
   `.get("external_careers_url")`). `JobsApi.get_jd` returns a Pydantic
   `JobDescriptionDTO`, so every apply raised `AttributeError`.
   - **Fix:** the service now uses the DTO's attributes (`status`,
     `application_channel`, `external_url`, `title`, `company`,
     `creator_account_id`). The module is mypy-clean.
   - **Guard:** `tests/unit/test_application_jd_contract.py`.
   - **Result:** the apply journeys now reach `POST /apply` and get a correct
     `422 application_not_ready` with `missing_fields: ["cv"]`.
   - **Still blocked by MinIO:** a CV version needs MinIO, which can't run in
     this environment. With a CV, these journeys are expected to pass.

### Related: field-level errors never reach the client — **FIXED 2026-10-05**

**Resolution.** Both halves were fixed, as decided (backend and frontend together):

- **Backend.** `app/main.py::_register_exception_handlers` now calls
  `register_error_handlers(app)`, then re-registers the more specific
  `AuthorizationDenied` / `AuthenticationRequired` handlers, keeping the
  fixed-latency denial. Every error now renders as
  `{error, message (localized), fields?, details?, request_id, retryable}`.
  - **Guard:** `tests/unit/test_error_envelope_wiring.py`, which fails 4/4
    before the fix and passes 4/4 after. It covers:
    - handler identity;
    - a domain 422's `fields` and `request_id`;
    - the request-body 422 (`validation_failed` with `fields`);
    - a 404 envelope.
- **Frontend.** `api/errors.ts::toFieldViolations` also reads the `fields` list
  of *any* 422 (Req 22 AC9). It never reads a domain error's `details`, which
  carries unrelated context.
  - **Guard:** a new case in `api/errors.test.ts`.
- **Verified live:** `POST /auth/login {}` → 422 `validation_failed` with
  `fields` for `email`, `password` and `role`, and a localized message.
  - **Profile e2e:** the "422 placed on the offending input" case passes.
- **Follow-up:** the backend `.po` catalogs lack entries for many domain error
  keys. `translate` falls back to the key itself, so those messages are still
  raw keys.

The original analysis:

Found while diagnosing layer 2: the 422 said `profile_validation_failed` with
`details: null`, so nothing could name the invalid field. Two causes:

- **Backend.** `app/main.py` registers its own `PlatformError` /
  `RequestValidationError` / `Exception` handlers. These drop
  `PlatformError.fields` and send the raw `message_key` instead of a localized
  message. The platform's real envelope, `platform/errors/handlers.py::register_error_handlers`,
  renders `fields` and localizes `message`, but **it is never called**. This
  breaks R4 AC11 ("a field-level error naming each invalid field") and, likely,
  every other domain 422 that carries fields.
- **Frontend.** `api/errors.ts::toFieldViolations` extracts violations only for
  the `validation_error` / `validation_failed` keys. Even with the backend fixed,
  a domain key such as `profile_validation_failed` would place nothing on its
  inputs.

Wiring the platform handlers changes the error body for the whole API, including
the `RequestValidationError` shape: `fields` replaces FastAPI's raw `details`
list. So it is left for a team decision rather than folded into a test fix.

---

## Failure attribution

### Original run — 34 failures

| Count | Blocker | Evidence |
| --- | --- | --- |
| 29 | Bug 2 | `POST /verify/code -> 500` raised from `registerVerifiedApprovedAccount` |
| 2 | Bug 2 (via UI) | `registration.spec.ts` — expected `/login`, got `/verify`; the verification submit 500s |
| 2 | Bug 4 | `admin-accounts.spec.ts` #1 → stuck on `/login`; `audit.spec.ts` chain-verify → `audit-chain-verify` not found |
| 1 | Bug 4, then Bug 3 | `reports.spec.ts` — `reports-screen` not found (still on `/login`); once login works, `GET /admin/reports/activity` 500s |

### Re-run after the Bug 1 and Bug 2 fixes — 31 failures

| Count | Blocker | Evidence |
| --- | --- | --- |
| ~20 | Bug 4 | Timeouts waiting for an element on an authenticated screen, or a destination assertion that resolves to `/login`. `profile`, `cv`, `reviews`, `auth-session`, `registration` (gating), `admin-accounts`, `audit`, and most `tri-locale` variants |
| 9 | Bug 7 | `POST /jobs -> 500` raised from `createOpenJob` — `jobs-applications.spec.ts` and the job-browsing / application-submission / review `tri-locale` variants |
| 1 | Bug 4, then Bug 3 | `reports.spec.ts` — still `reports-screen` not found; `GET /admin/reports/activity` 500s behind it |
| 0 | Bug 2 | **`POST /verify/code` appears in no failure.** `verify/code -> 200` throughout the uvicorn access log for the run |

Playwright artifacts (screenshots, page snapshots, per-failure
`error-context.md`) are left in `frontend/test-results/` as evidence; the
directory now holds the re-run's artifacts, not the original's.

The counts in the second table are read off the failure list and the backend log
rather than tallied per-assertion, so treat ~20 / 9 as the shape of the remaining
work rather than an exact split.

### Re-run 2026-10-05 after the Bug 7, 8 and 9 fixes — 61 passed, 18 failed

MinIO is not running in this environment; its public image is no longer available.
There were no 5xx responses in the whole run. Each failure is attributed from its
`error-context.md` page snapshot.

| Count | Blocker | Evidence |
| --- | --- | --- |
| 5 | Bug 4, now just the admin MFA step | `admin-accounts` ×2, `audit` ×2, `reports`: still on "Sign in" after the MFA code. Candidate and senior sign-in works. |
| 6 | Unattributed: candidate profile save | `profile`, `jobs-applications` (via `completeMinimalProfile`), `tri-locale` application ×3 and profile ×1. A click on the "My profile" screen times out. |
| 4 | Unattributed: review timeline | `reviews`, `tri-locale` review ×3. No `review-card-*` appears on "My reviews" after submitting. |
| 2 | Environment: MinIO | `cv` ×2. `setInputFiles` times out on the CV screen. |
| 1 | Unattributed | `jobs-applications` closed role: the closed job's card is not visible in the list. |
| 1 | Unattributed | `registration` gating: signing in as a not-yet-approved account is refused (`POST /auth/login` → 403) instead of landing on `/status`. |

### Re-run 2026-10-05 after the Bug 4 fix — 62 passed, 17 failed

| Count | Blocker | Evidence |
| --- | --- | --- |
| 5 | Unattributed: review timeline | `reviews` ×2, `tri-locale` review ×3. No `review-card-*` on "My reviews". |
| 5 | Unattributed: candidate profile save | `profile`, `jobs-applications` apply, `tri-locale` application ×3. A click on "My profile" times out. |
| 2 | Environment: MinIO | `cv` ×2 |
| 1 | Bug 3 (since fixed; `reports` passes) | `reports`: `GET /admin/reports/activity` and `/candidate-progress` → 500 with Bug 3's exact signatures |
| 1 | Unattributed: audit action naming | `audit`: the entry's action is `Account.updated`; the test expects `/approve/i`. |
| 1 | Unattributed | `admin-accounts` suspend: the account's card is not in the filtered list. |
| 1 | Unattributed | `jobs-applications` closed role: the card is not visible. |
| 1 | Unattributed | `registration` gating: `POST /auth/login` → 403 for a not-yet-approved account. |

Bug 4 accounts for none of these: every admin journey now passes the MFA step.
`reviews.spec.ts:63` passed in the previous run and failed in this one. Treat the
review group as possibly flaky until it is investigated.

### Re-run 2026-10-05 after Bug 10, the taxonomy seed, the apply fix and the envelope fix — 64 passed, 15 failed

| Count | Blocker | Evidence |
| --- | --- | --- |
| 5 | Unattributed: review timeline | `reviews` ×2, `tri-locale` review ×3. No `review-card-*` on "My reviews". |
| 4 | Environment: MinIO (an apply needs a CV) | `jobs-applications` apply, `tri-locale` application ×3: `422 application_not_ready`, `missing_fields: ["cv"]` |
| 2 | Environment: MinIO | `cv` ×2 |
| 1 | Unattributed: audit action naming | `audit`: action is `Account.updated`; the test expects `/approve/i`. |
| 1 | Unattributed | `admin-accounts` suspend: the account's card is not in the filtered list. |
| 1 | Unattributed | `jobs-applications` closed role: the card is not visible. |
| 1 | Unattributed | `registration` gating: `POST /auth/login` → 403 for a not-yet-approved account. |

`profile` and `reports` now pass.

The other suites:
- **Backend:** unit and integration pass. `test_audit` is excluded because of its
  fixture ScopeMismatch.
- **`verify:api` fails on Windows with `core.autocrlf=true`, but the contract
  has not drifted.**
  - The checkout writes `schema.d.ts` with CRLF line endings while `gen:api`
    emits LF, so the byte comparison fails at line 1.
  - The regenerated file is identical once CRLF is ignored.
  - **FIXED 2026-10-05:** `scripts/contract.ts::diffDeclarations` now compares
    with CRLF folded to LF.
    - **Guard:** `scripts/contract.test.ts`, which fails before the fix.
    - **Live:** `verify:api` now reports a match.
- **Frontend vitest:** 1148/1152 in the full run. The 4 failures are the known
  `JobNewScreen.test.tsx` timeouts under load; that file passes 5/5 on its own.

## Suggested order of attack

1. ~~Bug 1 — add `app/modules/audit/tasks.py`, plus handlers for the orphaned
   schedules.~~ **Done.** The worker boots and serves 10 functions.
2. ~~Bug 2 — migration to align the enum columns with the models, plus a guard so
   the two representations cannot drift again silently.~~ **Done.** Migration
   `0010`, two `role[]` cast fixes, and
   `tests/integration/test_schema_enum_alignment.py`.
3. ~~Bug 7 — exclude `search_tsv` from ORM persistence and type it `TSVECTOR`. Small,
   and it is the whole blocker for 9 tests, none of which depend on Bug 4.~~
   **Done** (2026-10-05). `FetchedValue` + deferred `TSVECTOR` mapping, direct
   `@@` match in `list_open_jds`, plus unit and integration guards. Verified e2e.
4. ~~Bug 4~~ **Done** (2026-10-05): the helper's `isVisible()` race; see its
   section. Previously: 5 failures, all on the admin MFA step (most of the original ~20 were
   Bugs 8 and 9, both done). Start with the one-line journey-helper fix, then look
   at `MfaCodeStep`. The state-reset or remount hypothesis in Bug 4's section is
   still unconfirmed.
5. ~~Bug 3 — cast the timestamp parameters in the activity-report queries, and fix
   the `:jd_id::uuid` syntax error while in there.~~ **Done** (2026-10-05), along
   with the candidate-progress `has_next` bug it was hiding. The `reports` e2e
   journey passes.
6. ~~Bug 6 — one line, `render_as_string(hide_password=False)`; unblocks R8 AC5
   failure auditing.~~ **Done** (2026-10-05), with a unit guard and a live check.
7. Bug 5 — needs the history decision recorded in its section before the code
   change is worth making.

Then re-run, in `frontend/`: `npm run typecheck; npm run lint; npm run verify:api;
npm run test; npm run build; npm run test:a11y; npm run test:e2e`.

## Environment left behind

- 2026-10-05: the dev database is at **`0011_seed_skill_taxonomy` (head)**.
  - **MinIO is not running.** Its public image is no longer pullable, so a
    replacement needs a team decision.
  - **OpenBao runs in dev mode and keeps nothing.** After a container restart,
    re-create the transit key and re-enrol the e2e admin's MFA. There is no
    bootstrap script yet.
- Earlier: the dev database was at **`0010_enum_column_alignment` (head)**. All 19 columns
  are their enum type and `uq_applications_candidate_jd_non_terminal` carries the
  enum predicate. Reversible with `alembic downgrade -1`.
- Uvicorn is running on `127.0.0.1:8000`, restarted after the migration.
  **Restarting it was necessary, not incidental**: asyncpg caches type
  information per connection, so a pool opened before the `ALTER` keeps serving
  the old types. Anyone applying this migration to another environment has to
  recycle the API and worker connections too.
- The ARQ worker is running, also restarted, serving 10 functions and driving 7
  schedules.
- The worker log is quiet now apart from Bug 5's hourly false tamper report.
  `expire_verification_codes` completes cleanly, so Bug 6 no longer appears
  behind it — silent again rather than fixed.
- `e2e-admin@example.com` is MFA-enrolled; the secret is not committed (re-enrol to obtain one).
- Docker services untouched. The throwaway `hasoub_drift` database used to
  validate the migration up/down/up has been dropped, and every probe script
  written along the way deleted.
- Backend files changed by the Bug 1 fix: `app/worker.py`,
  `app/modules/audit/tasks.py` (new), `app/modules/reporting/tasks.py`,
  `app/platform/jobs/catalog.py`, `app/platform/jobs/scheduler.py`.
- Backend files changed by the Bug 2 fix:
  `alembic/versions/0010_enum_column_alignment.py` (new),
  `app/modules/identity/repository.py`, `app/platform/db/metadata.py`,
  `tests/integration/test_schema_enum_alignment.py` (new).
- Nothing in `frontend/` has been modified by either fix.
