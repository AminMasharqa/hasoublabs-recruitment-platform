# HasoubLabs Recruitment Platform — Security Model

This skill describes the platform's security architecture and invariants.
Reference it whenever reviewing code that touches auth, authorization, encryption, or data access.

---

## Stack

| Layer | Technology |
|---|---|
| Backend | Python / FastAPI (modular monolith, Gunicorn + Uvicorn) |
| Frontend | React 18 + TypeScript + Vite, Mantine, TanStack Query |
| Database | PostgreSQL 16+ (single source of truth) |
| Cache / Queue broker | Valkey (BSD-3, Linux Foundation) |
| Object storage | MinIO (AGPL-3.0, consumed as network service over S3 API) |
| KMS / Key custody | OpenBao (MPL 2.0) |
| Malware scanning | ClamAV (async, separate container) |
| Background jobs | ARQ (async-native, Valkey-backed) + APScheduler |
| Edge / TLS | Traefik or Caddy (Let's Encrypt, HTTPS-only) |

---

## Roles and Account Lifecycle

Three roles: `ADMIN`, `CANDIDATE`, `SENIOR`. A single account may hold `CANDIDATE`, `SENIOR`, or both. Admin may never be combined with another role — enforced by a PostgreSQL CHECK constraint, not only application code.

Account statuses: `PendingVerification → PendingApproval → ApprovedPendingMeeting → Approved`, plus `Rejected`, `Suspended`, `Deactivated`. Exactly one status at all times.

The **initial Admin account** is created by direct database insertion only — never through any registration flow (R1 AC6). Only an existing Admin session may create or revoke Admin accounts (R1 AC7).

---

## Authentication

- **Password hashing**: Argon2id via `passlib[argon2]`. Minimum 10 Unicode code points, maximum ≥64, breached-password screening via k-anonymity prefix check.
- **Admin MFA**: TOTP (pyotp + qrcode), mandatory for Admin in production. MFA secret stored as AES-256-GCM envelope-encrypted `mfa_secret_enc`.
- **JWT sessions**: Issued by `AuthService` via Authlib. Sessions slide for 30 minutes, tracked in Valkey.
- **Active role context**: Carried as a JWT claim (`act`). A context switch issues a **new token pair** and rotates the session record — no cached access from the prior context may survive.
- **Public endpoints** (no auth required): Candidate/Senior registration via Admin-generated signed link, verification-code entry, login, password reset. Everything else requires authentication. Job_Descriptions are never accessible unauthenticated (R3 AC8).

---

## Registration Links

Admin-generated, role-scoped, signed JWTs carrying `{role, issued_by, exp, jti}`. Single-role, reusable until expiry, revocable by `jti`. The role is **never a form field** — it is derived solely from the validated link token (R1 AC9).

---

## Authorization (RBAC)

Permissions derive from role set + active role context. No per-user overrides (R3 AC1).

Every FastAPI route declares an authorization dependency (`require(...)`). A Semgrep rule in CI fails the build on any `@router.<method>` without one. A runtime startup assertion refuses to boot if any operation lacks an auth dependency.

Authorization runs **before** any resource lookup. Where ownership matters, it is folded into the query as a `WHERE owner_id = :me` predicate — a missing row and an unowned row produce the identical empty result set. The only error type for both cases is `AuthorizationDenied` (403) with a fixed body (R3 AC6).

**Constant-time denial floor**: The denial handler awaits until `DENY_FLOOR_MS` (default 120 ms, measured from middleware entry with a monotonic clock) before responding. This eliminates the fast-path timing side-channel that would otherwise distinguish "row absent" from "row present but not authorized" (R3 AC6, design D-5).

Key access boundaries:
- Candidate context: own profile, own CV_Versions, own Applications, browsing Open JDs only (R3 AC3).
- Senior context: own JDs, all Open JDs, applicant list for own JDs (name + role title + status only), own submitted Reviews (R3 AC4, R3 AC5).
- Senior MUST NOT see: Candidate email, phone, national ID, residency proof, CV files, education, work experience, skills, languages, summary, LinkedIn URL (R3 AC5).
- Candidate MUST NOT access another Candidate's data (R3 AC7).
- Suspended/Deactivated: denied everything except the status notice route (R3 AC11).

---

## Sensitive Data Encryption

**National IDs and residency proofs** are encrypted application-side with AES-256-GCM envelope encryption. Data keys are wrapped by an OpenBao transit key. The `residency_proofs` table stores `value_enc bytea` (ciphertext) and `value_digest` (blind index for duplicate detection). Plaintext never reaches the database or appears in backups. Accessible only to Admin sessions (R2 AC15, design D-4).

**CV files** are encrypted at rest via MinIO SSE-KMS backed by OpenBao (R5 AC16).

**MFA secrets** are AES-256-GCM envelope-encrypted in `accounts.mfa_secret_enc`.

**Audit log sensitive columns** are stored as a digest in the `before`/`after` JSONB — never as plaintext. The redaction map lives in `platform/security` (design D-6).

**Verification codes**: Only an HMAC-SHA256 digest (keyed pepper from OpenBao) is stored in `email_verifications.code_hash`. The plaintext exists only in the outgoing email and is **never persisted** anywhere — not in the database, not in the outbox `payload` JSONB.

---

## File Handling Pipeline

Upload validation order (nothing is stored until all checks pass, R5 AC2):
1. Hard size cap on streaming request body (≤10 MB). Oversized uploads cut off, never buffered.
2. MIME check via python-magic on the **byte stream** (not file extension).
3. Structural integrity: pikepdf/pypdf for PDF; zipfile + OOXML part check for DOCX. Encrypted/unreadable files rejected.
4. SHA-256 computed over the full byte stream → stored in `cv_versions.sha256`.
5. PUT to MinIO quarantine bucket. Row inserted in `cv_versions` with `state = PendingScan`.
6. ClamAV scan job enqueued (async — never in the request path).
7. On clean scan: server-side copy to `cv` bucket, state promoted to `Available`, becomes active version.
8. On infected: stays quarantined, excluded from candidate-visible storage, Admin + Candidate notified.

A `PendingScan` version is **not downloadable** and **does not satisfy Application-Ready** (R4 AC7, R7 AC1).

MinIO buckets have versioning + object lock (compliance mode) for the retention period — even a compromised application credential cannot overwrite or delete a stored CV (R5 AC4, design D-10).

Object keys are server-generated UUIDs. No user-supplied filename appears in any storage path.

Presigned download URLs: short-lived (≤15 min), scoped to the requesting principal, include `response-content-disposition: attachment`, must not be cacheable by shared proxies.

---

## Audit Log

Append-only, tamper-evident hash chain (R8).

- Capture via SQLAlchemy `before_flush` listener — sees every ORM mutation automatically, never hand-written at call sites (design D-6).
- Each entry: `prev_hash`, `entry_hash = SHA256(canonical_json(entry) || prev_hash)`. Writer holds `pg_advisory_xact_lock(AUDIT_CHAIN_KEY)` before reading the tail.
- Application DB role: `INSERT` + `SELECT` on `audit_log` only — no `UPDATE` or `DELETE`. Enforced by a `BEFORE UPDATE OR DELETE` trigger that rejects the operation and records the attempt as a new entry (R8 AC3).
- Sensitive columns (national IDs, residency values, MFA secrets) are stored as digests in `before`/`after` JSONB, never as plaintext.
- Every authorization denial produces a separate audit entry written on a **separate DB connection** (never joins the potentially rolled-back request transaction) (R3 AC9).
- Failed multi-step operations: domain transaction is rolled back; a single failure entry is written on a separate short-lived connection keyed by `request_id` for idempotency (R8 AC5, design D-7).
- Retention ≥7 years. Candidate deletion anonymizes `audit_actor_identities` — never deletes or mutates hash-chained rows (R8 AC7).

---

## Background Jobs & Outbox

All mail goes through a **transactional outbox** (`outbox_emails` table). Domain transaction inserts the outbox row atomically with the state change that justifies it. Drainer uses `FOR UPDATE SKIP LOCKED`, retries with backoff, idempotent on `(idempotency_key)`.

Verification-code plaintext is rendered at send time from a short-lived value — **never persisted in `outbox_emails.payload`**.

ClamAV and SMTP are only touched by ARQ workers, never by the API process directly.

---

## Backup & Key Separation

- PostgreSQL: continuous archiving via `pgBackRest` with point-in-time recovery.
- MinIO: bucket replication with object lock preserved.
- OpenBao snapshots: stored **separately** from PostgreSQL backups. A backup containing both encrypted data and its unwrapping key defeats envelope encryption entirely.
- Restore drills verify the audit hash chain end-to-end after restore.

---

## Licensing Posture

Maximum-open-source. Rejected licenses: SSPL, BUSL, proprietary.
Permitted exceptions: MinIO (AGPL-3.0, consumed as a network service over the S3 API, does not extend AGPL obligations to application code).
