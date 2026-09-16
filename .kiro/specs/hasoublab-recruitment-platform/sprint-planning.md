# Sprint Planning: HasoubLabs Recruitment Platform (Phase 1)

> Companion to `requirements.md` and `tasks.md`. This document assigns owners, sequences
> the work to minimize cross-developer blocking, and lists the coordination rules that keep
> merge conflicts near zero. Task numbers below reference `tasks.md`.

## Team

| Member | Experience | Primary responsibility |
| --- | --- | --- |
| Karim | Existing | Shared foundation (co-lead) + `identity/` + RBAC |
| Fadi | Existing | `profiles/` (candidate + senior) + `cvs/` |
| Amin | Existing | `applications/` + `reviews/` |
| Salma | Existing | `reporting/` (R28, R29), last wave |
| Khalid | **New member (onboarding)** | Foundation pairing → `jobs/` |

## Guiding principles

1. **One owner per module directory.** No two people edit files inside the same
   `app/modules/<name>/` directory. This is the single biggest lever against merge conflicts.
2. **Front-load shared foundations.** The platform layer and audit foundation sit under every
   domain module. They are built first and co-owned so no single domain owner becomes the
   bottleneck.
3. **Interfaces before implementations.** Cross-module dependencies go through published
   contracts (`ProfilesApi`, `CvsApi`, `JobsApi`). Owners publish typed stubs early so consumers
   build against interfaces, not internals.
4. **Onboard Khalid on shared code first.** A new member gets the most codebase exposure and the
   least blocking risk by pairing on the foundation, then owning a well-bounded module (`jobs/`).

---

## Ownership map

| Module / Area | Requirements | tasks.md sections | Owner |
| --- | --- | --- | --- |
| Platform: db, security, RBAC, middleware, jobs, mail, notifications, i18n, storage, taxonomy | 2, 3, 8 (infra) | 2, 3, 4, 5, 6, 7 | **Karim + Khalid (pair)** |
| `audit/` | R8 | 9 | **Karim + Khalid (pair)** |
| `identity/` + RBAC guard | R1, R2, R3 | 4, 11, 12 | **Karim** |
| `profiles/` (candidate + senior) | R4, R4A | 15 | **Fadi** |
| `cvs/` | R5 | 14 | **Fadi** |
| `jobs/` | R6 | 17 | **Khalid** |
| `applications/` | R7 | 18 | **Amin** |
| `reviews/` | R9 | 20 | **Amin** |
| `reporting/` | R28, R29 | 21 | **Salma** |
| App wiring / integration | 3 | 22 | **Karim** (others add routers via small PRs) |

Rationale for changes from the original owner table:
- **R3 (RBAC) folded into Karim's foundation work** rather than treated separately — it is a
  platform-layer guard (Section 4) that every module's routes depend on.
- **R8 (audit) moved into the co-owned foundation phase.** Every mutation in every module writes
  to the audit log, so it cannot wait for a single domain owner's turn.
- **`jobs/` (R6) moved off Fadi to Khalid.** This shortens the Fadi→Amin dependency chain and
  gives Khalid a bounded, mostly self-contained module to own after onboarding.
- **`reporting/` (R28, R29) owned by Salma, scheduled last** — it reads from every domain and is
  naturally the final wave.

---

## Sequenced plan (waves)

Waves follow the dependency graph in `tasks.md`. A wave starts only when the previous wave's
blocking items are merged.

### Wave A — Foundation (co-owned: Karim + Khalid)
Unblocks everyone. Nothing customer-facing lands until this is in.
- Task 1 — project skeleton and tooling
- Section 2 — db, Unit of Work, migrations
- Section 3 — security primitives (hashing, encryption, JWT/sessions, MFA)
- Section 4 — RBAC guards and constant-time denial path
- Section 5 — middleware, jobs, mail/outbox, notifications, i18n, pagination
- Section 6 — object storage adapter
- Section 7 — skill taxonomy and reference data
- Section 8 — **checkpoint**
- Section 9 — audit (append-only, hash chain, capture listener, search API)
- Section 10 — **checkpoint**

Pairing note: Khalid pairs with Karim through Wave A to learn the shared infrastructure. Split
within the pair by sub-section (e.g., Karim on db/security/RBAC, Khalid on storage/taxonomy/
middleware) but review each other's work.

### Wave B — Domains in parallel (starts after Wave A merges)
- **Karim → `identity/`** — Sections 11, 12 (+ Section 13 checkpoint)
- **Fadi → `cvs/` then `profiles/`** — Sections 14, 15 (+ Section 16 checkpoint)
- **Khalid → `jobs/`** — Section 17 (needs a `ProfilesApi` stub from Fadi for contactable seniors)

### Wave C — Downstream domains
- **Amin → `applications/`** — Section 18 (needs `ProfilesApi` from Fadi + `JobsApi` from Khalid)
- **Amin → `reviews/`** — Section 20 (low coupling: identity + audit + candidate reference)
- Section 19 — **checkpoint**

### Wave D — Reporting + integration (last)
- **Salma → `reporting/`** — Section 21 (reads all domains; needs read models from identity,
  profiles, cvs, jobs, applications)
- **Karim → app wiring** — Section 22 (router registration, exception handlers, boot assertion)
- Section 23 — **final checkpoint**

---

## Dependency and blocking analysis

Blocking edges after this assignment:

- **Foundation → everyone.** Mitigated by co-owning it (Karim + Khalid) and finishing it first.
- **Fadi (`ProfilesApi`) → Khalid (`jobs` contactable seniors).** Read-only; mitigated by an early
  interface stub.
- **Fadi (`ProfilesApi`) + Khalid (`JobsApi`) → Amin (`applications`).** The one genuine cross-dev
  chain. Mitigated by publishing both interface contracts before implementation so Amin builds
  against stubs.
- **Reviews (Amin)** is nearly standalone — no blocking on Fadi or Khalid.
- **Reporting (Salma)** is intentionally last, so its upstream dependencies are already done. Its
  risk is the opposite of blocking: Salma has little to own until Wave D. See the mitigation in
  Open questions — she can pair on the foundation (Wave A) and pre-build the report aggregation
  queries and Excel export scaffolding against the interface contracts during Wave B/C.

No two developers own the same module directory, so file-level merge conflicts are confined to a
few shared files (see below).

---

## Conflict-avoidance rules

1. **Publish interfaces first.** Before Wave B implementation:
   - Fadi publishes `ProfilesApi` and `CvsApi` signatures (typed stubs).
   - Khalid publishes `JobsApi` signatures (typed stubs).
   Consumers (Amin especially) code against these contracts, not implementations.
2. **Shared enum types (Task 2.2)** are a hotspot — all native PostgreSQL ENUMs live in one place.
   Karim owns this file; others request additions via a small PR rather than editing directly.
3. **App wiring (Task 22.1)** — `main.py` / router registration is the other hotspot. Karim owns
   the wiring file; each module owner adds their router through a minimal, isolated change.
4. **Migrations** — one Alembic head at a time. Coordinate migration generation so two owners
   don't create divergent heads; rebase before generating.
5. **Stay in your directory.** All other work is inside `app/modules/<owner-module>/`, which is
   collision-free by construction.

---

## Test-task guidance (optional `*` tasks)

For MVP speed the `*` property/integration tests can be deferred, **except** keep these because
they encode security- and integrity-critical invariants:
- `identity/` verification + lifecycle properties (Section 12 tests)
- `audit/` hash-chain and append-only properties (Section 9 tests)
- `applications/` immutability, duplicate-prevention, and confirmation properties (Section 18 tests)
- RBAC authorization-matrix and denial-timing properties (Section 4 tests)

---

## Open questions for the team

- Is Karim comfortable co-leading the foundation in addition to owning `identity/`? If not, we can
  shift more of Wave A onto Khalid + Amin.
- Should Khalid pair on `identity/` instead of owning `jobs/`, if we'd rather keep him closer to a
  mentor through Wave B?
- `reporting/` (Salma) is last in the dependency graph, so Salma would otherwise sit idle through
  Waves A–C. Preferred plan: Salma pairs on the foundation in Wave A, then during Wave B/C builds
  the report aggregation queries and `.xlsx` export scaffolding against the published interface
  contracts, wiring to real data as each upstream module lands. Confirm this is acceptable, or
  reassign her to help on a Wave-B module and pick up `reporting/` at Wave D.
