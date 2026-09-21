# Task 28 (final checkpoint — full pipeline green): run results and blockers

Run date: 2026-09-22. Machine: Windows / PowerShell. All commands from `frontend/`
unless stated otherwise.

Last updated: 2026-09-22, after **Bugs 1 and 2 were fixed** (see those sections)
and the e2e suite was re-run. Bugs 3 and 4 are open. Three further backend
defects — Bugs 5, 6 and 7 — were found *because* those two fixes unblocked the
code paths that reach them; all three are recorded below.

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
$env:E2E_ADMIN_TOTP_SECRET = 'VMIUTCXXAOUEMRLBIU2U5UK6WGZR7ZZA'
```

### Seeded Admin (the precondition `e2e/README.md` describes)

`e2e-admin@example.com` already existed in the dev database, Approved, role
`ADMIN`, password `correct-horse-battery-staple` (the `SEED_ADMIN` default). Its
TOTP secret was unrecoverable (envelope-encrypted via OpenBao), so it was
re-enrolled: the account's `mfa_secret_enc` / `mfa_wrapped_key` /
`mfa_enrolled_at` columns were set to `NULL`, `POST /auth/mfa/enroll` was called
on the resulting un-enrolled session, and the secret was read out of the returned
`provisioning_uri`. **The secret above is live** — reuse it rather than
re-enrolling.

Account id: `b9ab10fc-e5e0-4610-9b61-49bb471ac952`.

The untracked `mfa_uri.txt` at the repo root held the *previous* provisioning URI
(secret `I7KGIJ3TJ6XCEQIYHEU3ICEMRXXVMRO3`). Only one secret is stored per
account, so re-enrolling invalidated it; that file has been updated to the current
secret rather than left as a stale trap.

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

## Bug 3 — `GET /admin/reports/activity` returns 500 (untyped NULL parameters)

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

---

## Bug 4 — MFA code step issues no second `/auth/login` request (frontend or journey helper)

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

## Bug 6 — failure audit entries are never written: the rollback path passes a masked password

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

---

## Bug 7 — `POST /jobs` returns 500: the ORM writes a trigger-owned `tsvector` column as varchar

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

## Suggested order of attack

1. ~~Bug 1 — add `app/modules/audit/tasks.py`, plus handlers for the orphaned
   schedules.~~ **Done.** The worker boots and serves 10 functions.
2. ~~Bug 2 — migration to align the enum columns with the models, plus a guard so
   the two representations cannot drift again silently.~~ **Done.** Migration
   `0010`, two `role[]` cast fixes, and
   `tests/integration/test_schema_enum_alignment.py`.
3. Bug 7 — exclude `search_tsv` from ORM persistence and type it `TSVECTOR`. Small,
   and it is the whole blocker for 9 tests, none of which depend on Bug 4.
4. Bug 4 — now the largest single item by a wide margin (~20 failures). Start with
   the one-line journey-helper fix, then look at `MfaCodeStep`.
5. Bug 3 — cast the timestamp parameters in the activity-report queries, and fix
   the `:jd_id::uuid` syntax error while in there.
6. Bug 6 — one line, `render_as_string(hide_password=False)`; unblocks R8 AC5
   failure auditing.
7. Bug 5 — needs the history decision recorded in its section before the code
   change is worth making.

Then re-run, in `frontend/`: `npm run typecheck; npm run lint; npm run verify:api;
npm run test; npm run build; npm run test:a11y; npm run test:e2e`.

## Environment left behind

- The dev database is at **`0010_enum_column_alignment` (head)**. All 19 columns
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
- `e2e-admin@example.com` is MFA-enrolled with the secret recorded above.
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
