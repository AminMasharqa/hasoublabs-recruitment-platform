# Sprint Planning: HasoubLabs Recruitment Platform (Phase 1)

> Companion to `requirements.md` and `tasks.md`. This document assigns owners, sequences
> the work to minimize cross-developer blocking, and lists the coordination rules that keep
> merge conflicts near zero. Task numbers below reference `tasks.md`.
>
> **Revision:** the split has been rebalanced so every member has meaningful work in every wave.
> The previous plan left Salma idle through Waves A–C and concentrated the foundation +
> `identity/` + RBAC + app-wiring on Karim. See "Load balancing" below for the before/after.

## Team

| Member | Experience | Primary responsibility |
| --- | --- | --- |
| Karim | Existing | Foundation (project skeleton, security, RBAC) + `identity/` |
| Fadi | Existing | Foundation (storage, taxonomy) + `cvs/` |
| Amin | Existing | Foundation (middleware/jobs/mail/notifications) + `applications/` |
| Salma | Existing | Foundation (db, Unit of Work, migrations + audit) + `reviews/` + `reporting/` |
| Khalid | **New member (onboarding)** | `profiles/` support → `jobs/` |

## Guiding principles

1. **One owner per module directory.** No two people edit files inside the same
   `app/modules/<name>/` directory. This is the single biggest lever against merge conflicts.
2. **Front-load shared foundations, and split them.** The platform layer and audit foundation sit
   under every domain module, so they are built first. Because they block everyone, they are
   split across the whole team by sub-package (each person owns distinct platform files) instead
   of parking most people while one pair builds them.
3. **Interfaces before implementations.** Cross-module dependencies go through published
   contracts (`ProfilesApi`, `CvsApi`, `JobsApi`). Owners publish typed stubs early so consumers
   build against interfaces, not internals.
4. **Onboard Khalid on shared code first.** A new member gets the most codebase exposure and the
   least blocking risk by pairing on the foundation, then supporting a mentored module
   (`profiles/` with Fadi) before owning a well-bounded module (`jobs/`).
5. **No one sits idle.** Every member has work in Wave A (foundation) and at least one owned
   domain module afterward. Load is measured in core (non-`*`) implementation sub-tasks.

---

## Load balancing (why the split changed)

Core implementation sub-tasks (the non-`*` items in `tasks.md`) counted per owner:

| Member | Previous plan | Rebalanced plan |
| --- | --- | --- |
| Karim | Foundation co-lead + identity (12) + RBAC (4) + wiring (22) → ~18 tasks | skeleton (1) + security (3) + RBAC (4) + identity (11,12) → 13 tasks |
| Fadi  | cvs (14) + profiles (15) → 11 tasks | storage (6) + taxonomy (7) + cvs (14) → 11 tasks |
| Amin  | applications (18) + reviews (20) → 7 tasks | middleware/jobs/mail (5) + applications (18) → 9 tasks |
| Salma | reporting (21) only → 3 tasks, **idle Waves A–C** | db/UoW/migrations (2) + audit (9) + reviews (20) + reporting (21) → 14 tasks |
| Khalid| foundation pair + jobs (17) → 5 tasks | profiles pairing (15) + jobs (17) → ~8 tasks |

Key moves:
- **Foundation is split across the team** by platform sub-package. Each person owns different
  files under `app/platform/`, so this parallelizes cleanly with no directory collisions. Salma
  owns the db/UoW/migrations foundation (Section 2) plus the audit layer that depends on it.
- **`audit/` moves to Salma** (was co-owned by Karim/Khalid). It is self-contained and lets Salma
  start delivering in Wave A instead of waiting until the final wave.
- **`reviews/` moves from Amin to Salma.** Reviews is nearly standalone (identity + audit +
  candidate reference), so Salma can own it in Wave C, which fills her gap before `reporting/`.
- **App wiring (Section 22) becomes a shared, thin task** coordinated by Karim, with each owner
  registering their own router — it is no longer a single person's workload.
- **Karim takes the project skeleton (Task 1)** as the anchor for the shared core he owns
  (security, RBAC), then continues into `identity/`.
- **Section 2 (db, Unit of Work, migrations) moves to Salma.** Khalid is not currently available,
  and Section 2 is the hard blocker for `audit/` (Section 9), which Salma already owns. Because
  `audit/` sits directly on the `UnitOfWork`, the shared enum types, and the migration harness,
  giving Section 2 to the same owner removes the cross-developer dependency entirely — Salma now
  builds the db foundation and the audit layer on top of it without waiting on anyone. Karim
  pair-reviews (unchanged from the prior plan).
- **Khalid** pairs with Fadi on `profiles/` before owning `jobs/`. His onboarding surface is now
  the mentored `profiles/` work rather than Section 2.

---

## Ownership map

| Module / Area | Requirements | tasks.md sections | Owner |
| --- | --- | --- | --- |
| Project skeleton + tooling | 3, 8 (infra) | 1 | **Karim** |
| Platform: db, Unit of Work, migrations | 8 | 2 | **Salma** (pair review: Karim) |
| Platform: security primitives (hashing, encryption, JWT/MFA) | 2, 3 | 3 | **Karim** |
| Platform: RBAC guards + constant-time denial | 3 | 4 | **Karim** |
| Platform: middleware, jobs, mail/outbox, notifications, i18n, pagination | 3, 8 | 5 | **Amin** |
| Platform: object storage adapter | 5 | 6 | **Fadi** |
| Platform: skill taxonomy + reference data | 4 | 7 | **Fadi** |
| `audit/` | R8 | 9 | **Salma** |
| `identity/` + RBAC integration | R1, R2, R3 | 11, 12 | **Karim** |
| `cvs/` | R5 | 14 | **Fadi** |
| `profiles/` (candidate + senior) | R4, R4A | 15 | **Khalid** (mentored by Fadi) |
| `jobs/` | R6 | 17 | **Khalid** |
| `applications/` | R7 | 18 | **Amin** |
| `reviews/` | R9 | 20 | **Salma** |
| `reporting/` | R28, R29 | 21 | **Salma** |
| App wiring / integration | 3 | 22 | **Karim** coordinates; each owner adds their own router |

Rationale for changes from the original owner table:
- **Foundation split by sub-package.** Karim bootstraps the skeleton (Task 1) and owns the
  security-critical core (security, RBAC); Salma owns db, Unit of Work, and migrations
  (Section 2) plus the audit layer that sits on top of it; Amin owns supporting infra
  (middleware, jobs, mail, notifications, i18n, pagination); Fadi owns storage + taxonomy.
  Different files, no collisions, everyone productive from day one.
- **`audit/` (R8) → Salma.** Every mutation writes to the audit log, so it is built in the
  foundation wave. Giving it to Salma turns her formerly idle early weeks into delivery.
- **Section 2 (db/UoW/migrations) → Salma.** Reassigned from Khalid because he is not currently
  available and Section 2 is the direct blocker for `audit/` (Section 9), which Salma owns.
  Consolidating both under one owner removes the Khalid → Salma cross-developer dependency: Salma
  builds the db foundation, the shared enum types, and the migration harness, then builds `audit/`
  on top without an inter-owner handoff. Karim continues to pair-review.
- **`profiles/` → Khalid (mentored by Fadi).** Fadi still owns `cvs/` and reviews `profiles/`
  through the `CvsApi` boundary the two share, but Khalid owns the `profiles/` directory. This
  keeps Khalid close to a mentor through Wave B. The mentored `profiles/` work is now his
  onboarding surface (previously Section 2).
- **`jobs/` → Khalid.** A bounded, mostly self-contained module for Khalid to own solo after the
  mentored `profiles/` work.
- **`reviews/` (R9) → Salma.** Low coupling; fits between audit (Wave A) and reporting (Wave D)
  so Salma is continuously busy.
- **`reporting/` (R28, R29) → Salma, scheduled last** — it reads from every domain and is
  naturally the final wave. Salma now arrives at it having already shipped audit and reviews.

---

## Sequenced plan (waves)

Waves follow the dependency graph in `tasks.md` (the `Task Dependency Graph` JSON at the end of
that file). A wave starts only when the previous wave's blocking items are merged.

### Wave A — Foundation (split across the whole team)
Unblocks everyone. Nothing customer-facing lands until this is in. Work in parallel by
sub-package:
- **Karim** — Task 1 (project skeleton and tooling), then Section 3 (security primitives) and
  Section 4 (RBAC guards + constant-time denial path).
- **Salma** — Section 2 (db, Unit of Work, migrations), then Section 9 (audit: append-only log,
  hash chain, capture listener, search API) built on top of it. Karim reviews.
- **Amin** — Section 5 (middleware, jobs, mail/outbox, notifications, i18n, pagination).
- **Fadi** — Section 6 (object storage adapter), Section 7 (skill taxonomy + reference data).
- Section 8 — **checkpoint** (platform layer).
- Section 10 — **checkpoint** (audit foundation).

Sequencing note: Karim lands Task 1 first so everyone has a package skeleton to build into, then
moves to security/RBAC. Salma's Section 2 depends on the skeleton, so she starts once Task 1 is
merged and pairs with Karim (who reviews the shared enum-types file in Task 2.2) through it. Salma
then continues straight into `audit/` (Section 9), which sits directly on the Section 2
`UnitOfWork`, enum types, and migration harness — so the two are built by the same owner with no
cross-developer handoff.

### Wave B — Core domains in parallel (starts after Wave A merges)
- **Karim → `identity/`** — Sections 11, 12 (+ Section 13 checkpoint).
- **Fadi → `cvs/`** — Section 14 (+ publishes `CvsApi` stub early).
- **Khalid → `profiles/` (mentored by Fadi)** — Section 15 (needs `CvsApi` from Fadi for the CV
  existence check; publishes `ProfilesApi` stub early). Section 16 checkpoint.

### Wave C — Downstream domains
- **Khalid → `jobs/`** — Section 17 (needs a `ProfilesApi` stub for contactable seniors — Khalid
  authored it, so no cross-dev block here).
- **Amin → `applications/`** — Section 18 (needs `ProfilesApi` from Khalid + `JobsApi` from
  Khalid; both published as stubs before implementation).
- **Salma → `reviews/`** — Section 20 (low coupling: identity + audit + candidate reference).
- Section 19 — **checkpoint** (jobs and applications).

### Wave D — Reporting + integration (last)
- **Salma → `reporting/`** — Section 21 (reads all domains; needs read models from identity,
  profiles, cvs, jobs, applications). Salma pre-builds aggregation queries and `.xlsx` export
  scaffolding against the published interface contracts during Wave C.
- **App wiring** — Section 22. Karim coordinates router registration, exception handlers, and the
  boot-time authorization assertion; each module owner contributes their own router in a small PR.
- Section 23 — **final checkpoint**.

---

## Dependency and blocking analysis

Blocking edges after this assignment:

- **Foundation → everyone.** Mitigated by splitting it across the team and finishing it in Wave A.
  The chain is Task 1 (Karim: skeleton) → Section 2 (Salma: db/UoW) → security + RBAC (Karim);
  storage, taxonomy, and supporting infra run alongside it. Because Salma owns both Section 2 and
  `audit/` (Section 9), the former db/UoW → audit cross-developer edge is now internal to one
  owner and no longer a blocking handoff.
- **Fadi (`CvsApi`) → Khalid (`profiles/` CV existence check).** Read-only; mitigated by Fadi
  publishing the `CvsApi` stub before Wave B implementation. Also mitigated by the mentoring pair
  (Fadi reviews `profiles/`), so the two coordinate directly.
- **Khalid (`ProfilesApi`, `JobsApi`) → Amin (`applications/`).** The one genuine cross-dev chain.
  Because Khalid owns both `profiles/` and `jobs/`, he publishes both contracts; Amin builds
  against the stubs before Khalid's implementations land.
- **Reviews (Salma)** is nearly standalone — no blocking on Fadi, Khalid, or Amin's domain work.
- **Reporting (Salma)** is intentionally last, so its upstream dependencies are already done.
  Salma is no longer idle earlier: she ships `audit/` in Wave A and `reviews/` in Wave C, then
  finishes with `reporting/`.

No two developers own the same module directory, so file-level merge conflicts are confined to a
few shared files (see below).

---

## Conflict-avoidance rules

1. **Publish interfaces first.** Before Wave B/C implementation:
   - Fadi publishes `CvsApi` signatures (typed stubs).
   - Khalid publishes `ProfilesApi` and `JobsApi` signatures (typed stubs).
   Consumers (Amin especially) code against these contracts, not implementations.
2. **Shared enum types (Task 2.2)** are a hotspot — all native PostgreSQL ENUMs live in one place.
   Salma owns this file as part of Section 2 (with Karim pairing/reviewing); others request
   additions via a small PR rather than editing directly.
3. **App wiring (Task 22.1)** — `main.py` / router registration is the other hotspot. Karim owns
   the wiring file; each module owner adds their router through a minimal, isolated change.
4. **Migrations** — one Alembic head at a time. Coordinate migration generation so two owners
   don't create divergent heads; rebase before generating. During Wave A, the foundation owners
   (Karim, Amin, Fadi) sequence their migrations through Salma's db harness (Section 2).
5. **Stay in your directory.** All other work is inside `app/platform/<sub-package>/` (Wave A) or
   `app/modules/<owner-module>/` (later waves), which is collision-free by construction.

---

## Test-task guidance (optional `*` tasks)

For MVP speed the `*` property/integration tests can be deferred, **except** keep these because
they encode security- and integrity-critical invariants:
- `identity/` verification + lifecycle properties (Section 12 tests) — Karim
- `audit/` hash-chain and append-only properties (Section 9 tests) — Salma
- `applications/` immutability, duplicate-prevention, and confirmation properties (Section 18 tests) — Amin
- RBAC authorization-matrix and denial-timing properties (Section 4 tests) — Karim

---

## Section 2 implementation status (Salma) — COMPLETE

Section 2 (db, Unit of Work, migrations) is **implemented and verified end-to-end against a real
PostgreSQL**. All three tasks (2.1, 2.2, 2.3) pass.

**Delivered and verified:**
- Task 2.1 — async engine + session factory (`app/platform/db/engine.py`), `UnitOfWork`
  context manager (`app/platform/db/unit_of_work.py`), FastAPI read-session dependency
  (`app/platform/db/session.py`), and the db package public surface (`app/platform/db/__init__.py`).
- Task 2.2 — the 15 shared PostgreSQL enum types + conventions (`app/platform/db/enums.py`),
  with `NON_TERMINAL_APPLICATION_STATUSES` defined once for the R7 AC7 index.
- Alembic harness — metadata aggregator (`app/platform/db/metadata.py`), `env.py` running
  migrations on **asyncpg** (the original psycopg2 swap was a defect and was removed; `env.py`
  also honours an explicit `sqlalchemy.url` override so tests migrate the exact database they
  connect to), and the baseline migration (`alembic/versions/0001_platform_baseline.py`).
- **Migration verified**: `upgrade head` creates the three platform tables (`outbox_emails`,
  `notifications`, `job_dead_letters`) + their two enum types; `downgrade base` drops them
  cleanly (0 tables, 0 enums); re-`upgrade head` restores them. Reversible and repeatable.
- **Task 2.3 verified**: `uv run pytest tests/integration/test_unit_of_work.py -v` →
  **4 passed**. Confirms a raised exception inside a `UnitOfWork` leaves the DB byte-identical
  (R8 AC5), a clean exit commits exactly the written rows, multi-write rollback persists none,
  and the session raises if used outside its context.
- Local dev stack added: `docker-compose.yml` (Postgres, Valkey, Mailpit, MinIO, ClamAV,
  OpenBao) + `.dockerignore`, credentials matching `.env`. This is the "local dev is one command"
  stack the design assumes; the team should adopt it as standard.

**Minor follow-ups (non-blocking, nice-to-have):**
1. **Baseline migration is hand-authored, not autogenerated.** tasks.md 2.1 mentions
   autogenerated migrations. The baseline was hand-written (no DB at authoring time) and has been
   proven to apply/reverse; optionally cross-check against `alembic revision --autogenerate`
   output once more models land, to confirm no column drifts.
2. **`env.py` loads full app settings** to read one URL (`get_settings()` requires all 7 env
   vars). Works fine with `.env` present; could later read only `database_url` so a migration
   does not need MinIO/OpenBao/SMTP credentials. Optional hardening.

**Cleanup:** temporary verification scratch files (`_verify_section2.txt`, `_verify_downup.txt`,
`_reup.txt`, `_t23.txt`, `_t23b.txt`, `_t23c.txt`) were created during verification and should be
deleted; they are not part of the deliverable.

Net effect on the plan: `audit/` (Section 9) is fully unblocked — the `UnitOfWork`, shared enums,
and migration harness it depends on all exist and are verified working.

---

## Open questions for the team

- Is Karim comfortable owning the skeleton (Task 1) plus the security-critical core (security,
  RBAC) plus `identity/`? This is the critical chain; if it's too much, Section 4 (RBAC) can move
  to Amin once his Section 5 infra lands.
- Section 2 (db, Unit of Work, migrations) has moved to Salma because Khalid is not currently
  available and Section 2 blocks Salma's `audit/` work. Karim still pair-reviews. Confirm this
  consolidation is acceptable, or reassign Section 2 once Khalid returns.
- Khalid owns `profiles/` and `jobs/`. The `profiles/` mentoring pair with Fadi is the safeguard
  for a new member. Confirm Fadi has review bandwidth, or move `profiles/` to Fadi and give Khalid
  only `jobs/`.
- Salma now owns Section 2 (db/UoW/migrations), `audit/` (Wave A), `reviews/` (Wave C), and
  `reporting/` (Wave D). This is a heavier load spanning the whole timeline and includes two
  security-/integrity-critical pieces (the Section 2 foundation and the audit hash chain). Confirm
  this is sustainable, or pair her with Karim on Sections 2 and 9, or hand Section 2 back to Khalid
  when he is available.
