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
| Salma | Existing | Foundation (audit) + `reviews/` + `reporting/` |
| Khalid | **New member (onboarding)** | Foundation (db, Unit of Work, migrations) → `profiles/` support → `jobs/` |

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
| Salma | reporting (21) only → 3 tasks, **idle Waves A–C** | audit (9) + reviews (20) + reporting (21) → 11 tasks |
| Khalid| foundation pair + jobs (17) → 5 tasks | db/UoW/migrations (2) + profiles pairing (15) + jobs (17) → ~12 tasks |

Key moves:
- **Foundation is now split five ways** by platform sub-package. Each person owns different files
  under `app/platform/`, so this parallelizes cleanly with no directory collisions.
- **`audit/` moves to Salma** (was co-owned by Karim/Khalid). It is self-contained and lets Salma
  start delivering in Wave A instead of waiting until the final wave.
- **`reviews/` moves from Amin to Salma.** Reviews is nearly standalone (identity + audit +
  candidate reference), so Salma can own it in Wave C, which fills her gap before `reporting/`.
- **App wiring (Section 22) becomes a shared, thin task** coordinated by Karim, with each owner
  registering their own router — it is no longer a single person's workload.
- **Karim takes the project skeleton (Task 1)** as the anchor for the shared core he owns
  (security, RBAC), then continues into `identity/`.
- **Khalid takes db, Unit of Work, and migrations (Section 2)** — a bounded, self-contained
  platform piece and a good onboarding surface — then pairs with Fadi on `profiles/` before
  owning `jobs/`. He builds Section 2 alongside Karim, who owns the shared enum-types file.

---

## Ownership map

| Module / Area | Requirements | tasks.md sections | Owner |
| --- | --- | --- | --- |
| Project skeleton + tooling | 3, 8 (infra) | 1 | **Karim** |
| Platform: db, Unit of Work, migrations | 8 | 2 | **Khalid** (pair review: Karim) |
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
  security-critical core (security, RBAC); Khalid owns db, Unit of Work, and migrations
  (Section 2); Amin owns supporting infra (middleware, jobs, mail, notifications, i18n,
  pagination); Fadi owns storage + taxonomy; Salma owns audit. Different files, no collisions,
  everyone productive from day one.
- **`audit/` (R8) → Salma.** Every mutation writes to the audit log, so it is built in the
  foundation wave. Giving it to Salma turns her formerly idle early weeks into delivery.
- **`profiles/` → Khalid (mentored by Fadi).** Fadi still owns `cvs/` and reviews `profiles/`
  through the `CvsApi` boundary the two share, but Khalid owns the `profiles/` directory. This
  keeps Khalid close to a mentor through Wave B and balances Fadi's previously double load.
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
- **Khalid** — Section 2 (db, Unit of Work, migrations). Karim reviews.
- **Amin** — Section 5 (middleware, jobs, mail/outbox, notifications, i18n, pagination).
- **Fadi** — Section 6 (object storage adapter), Section 7 (skill taxonomy + reference data).
- **Salma** — Section 9 (audit: append-only log, hash chain, capture listener, search API).
- Section 8 — **checkpoint** (platform layer).
- Section 10 — **checkpoint** (audit foundation).

Sequencing note: Karim lands Task 1 first so everyone has a package skeleton to build into, then
moves to security/RBAC. Khalid's Section 2 depends on the skeleton, so he starts once Task 1 is
merged and pairs with Karim (who owns the shared enum-types file in Task 2.2) through it — a
strong onboarding path into the shared core before he takes domain work.

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

- **Foundation → everyone.** Mitigated by splitting it five ways and finishing it in Wave A. The
  chain is Task 1 (Karim: skeleton) → Section 2 (Khalid: db/UoW) → security + RBAC (Karim);
  storage, taxonomy, supporting infra, and audit run alongside it.
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
   Khalid owns this file as part of Section 2 (with Karim pairing/reviewing); others request
   additions via a small PR rather than editing directly.
3. **App wiring (Task 22.1)** — `main.py` / router registration is the other hotspot. Karim owns
   the wiring file; each module owner adds their router through a minimal, isolated change.
4. **Migrations** — one Alembic head at a time. Coordinate migration generation so two owners
   don't create divergent heads; rebase before generating. During Wave A, the foundation owners
   (Karim, Amin, Fadi, Salma) sequence their migrations through Khalid's db harness (Section 2).
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

## Open questions for the team

- Is Karim comfortable owning the skeleton (Task 1) plus the security-critical core (security,
  RBAC) plus `identity/`? This is the critical chain; if it's too much, Section 4 (RBAC) can move
  to Amin once his Section 5 infra lands.
- Section 2 (db, Unit of Work, migrations) is now Khalid's onboarding piece, gated behind Karim's
  Task 1 skeleton and paired/reviewed by Karim. Confirm this is a good first-task fit, or keep it
  with Karim and give Khalid a different Wave-A slice.
- Khalid owns `profiles/`, `jobs/`, and the project skeleton. That is a full load for a new member
  — the `profiles/` mentoring pair with Fadi is the safeguard. Confirm Fadi has review bandwidth,
  or move `profiles/` to Fadi and give Khalid only `jobs/` + skeleton.
- Salma now owns `audit/` (Wave A), `reviews/` (Wave C), and `reporting/` (Wave D). This keeps her
  continuously busy but spans the whole timeline. Confirm the audit hash-chain work (security
  critical) is a good fit, or pair her with Karim on Section 9.
