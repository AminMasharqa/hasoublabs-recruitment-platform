# Security Review Checklist — HasoubLabs Recruitment Platform

Walk through every applicable section below for each code change under review.
Each item maps to a requirement (R#) and/or a design decision (D#).
Skip sections that are clearly not touched by the change; call out any that are partially touched.

---

## 1. Authentication & Session

- [ ] Every endpoint except the public allowlist requires authentication (R3 AC8).
      Public allowlist: registration via Admin-generated signed link, code entry, login, password reset.
      Job_Descriptions must never be accessible unauthenticated.
- [ ] Passwords use Argon2id. No MD5, bcrypt, SHA-1, or unsalted SHA-256 anywhere.
- [ ] Password policy: min 10 Unicode code points, max ≥64, breached-password screening via k-anonymity.
- [ ] Admin routes enforce TOTP MFA verification in production.
- [ ] Context switch (role switch) issues a new token pair AND rotates the Valkey session record.
      No access from the prior context may survive the switch (R3 AC10).
- [ ] Rate limits are present on: login, both registration flows, code-entry, code-resend,
      CV upload, JD URL fetch, Application submission.

## 2. Admin Account Bootstrap (R1 AC6, AC7)

- [ ] No registration endpoint, form, or flow can produce an Admin-role account.
- [ ] The role is read exclusively from the validated registration link token — never from the request body, query string, or any user-supplied field.
- [ ] Admin account creation and role management are gated behind an existing Admin session.

## 3. Registration Link Tokens (R1 AC8, AC9)

- [ ] Tokens are validated for signature and expiry before the role is read from them.
- [ ] The `jti` claim is checked against the revocation list.
- [ ] The token is single-role; its role claim is not overridable by the requester.

## 4. Verification Code Security (R1 AC24, R2 AC5–AC10)

- [ ] Only the HMAC-SHA256 digest (keyed pepper from OpenBao) is stored — never the plaintext code.
- [ ] Plaintext code is never written to `outbox_emails.payload`, any log, or any database column.
- [ ] Codes are 6–8 digits, single-use, expire 72 hours after issue.
- [ ] Attempt counter is authoritative in PostgreSQL (not only Valkey) — a cache miss cannot reset it.
- [ ] Code entry locks after 5 consecutive failures; only a resend resets the counter.
- [ ] A resend invalidates any prior unexpired code.

## 5. Authorization & RBAC (R3)

- [ ] Every FastAPI route has an explicit `require(...)` authorization dependency.
- [ ] Authorization runs before any resource lookup. No 404-vs-403 distinction for
      authorization-relevant resources — `AuthorizationDenied` (403) is the only error (R3 AC6).
- [ ] Ownership checks are folded into the SQL query (`WHERE owner_id = :me`), not done after the fact.
- [ ] Candidate context cannot access another Candidate's data (R3 AC7).
- [ ] Senior context cannot access restricted Candidate fields: email, phone, national ID,
      residency proof, CV files, education, work experience, skills, languages, summary,
      LinkedIn URL. Only `full_name`, `applied_role_title`, `application_status` are permitted (R3 AC5).
- [ ] Suspended/Deactivated accounts are denied all requests except the status notice (R3 AC11).
- [ ] The guard checks both role AND `Account_Status`. A guard that checks role only is insufficient.
- [ ] Senior profile preferences (Contact_Channel_Preference, Contact_Scope_Preference,
      Company_Affiliation, Field_Of_Expertise) are visible/editable only by the Senior themselves
      and Admin (R4A AC14).

## 6. Constant-Time Denial (R3 AC6, design D-5)

- [ ] The denial handler awaits `DENY_FLOOR_MS` (measured from middleware entry, monotonic clock)
      before responding on every 403 path.
- [ ] No denial path short-circuits the floor (e.g., early returns before the floor await).
- [ ] The floor value is a tuned constant; jitter is deliberately not used (averaging defeats jitter).

## 7. Sensitive Data & Encryption (R2 AC15, design D-4)

- [ ] National IDs and residency-proof values are stored as AES-256-GCM ciphertext (`value_enc`).
      Data keys are wrapped by an OpenBao transit key.
- [ ] The blind index (`value_digest`) is used for duplicate detection — queries never decrypt inline.
- [ ] No query uses `value_enc` in a WHERE clause or returns it to a non-Admin caller.
- [ ] Every Pydantic response schema reachable by a Candidate or Senior context excludes:
      `value_enc`, `value_digest`, `proof_type`, and any residency field.
- [ ] CV files use MinIO SSE-KMS backed by OpenBao (SSE headers present on every PUT).
- [ ] `mfa_secret_enc` is AES-256-GCM envelope-encrypted; never stored or logged as plaintext.
- [ ] `before`/`after` JSONB in audit entries stores digests for sensitive columns, never plaintext.

## 8. Log & Telemetry Redaction (design: Observability)

- [ ] No `logger.*` call, exception handler, or OTel span attribute serializes a profile object,
      residency proof value, national ID, or plaintext verification code.
- [ ] GlitchTip/Sentry exception captures exclude national IDs, residency values, and codes
      from exception context and extra data.
- [ ] Unhandled exception (500) responses contain only `request_id` and a generic message —
      never exception text, stack frames, or file paths.
- [ ] Prometheus metric labels contain no user-supplied data (no PII in label values).

## 9. File Upload Security (R5)

- [ ] MIME check uses python-magic on the byte stream — not the file extension.
- [ ] Structural integrity check runs: pikepdf/pypdf for PDF; zipfile + OOXML parts for DOCX.
- [ ] Password-protected and unreadable files are rejected (R5 AC2).
- [ ] Request body is streamed with a hard size cap (≤10 MB); never fully buffered.
- [ ] Object key is a server-generated UUID — no user-supplied filename in any storage path.
- [ ] SHA-256 is computed over the byte stream at upload; stored in `cv_versions.sha256`.
- [ ] Download verifies the checksum by streaming; a mismatch aborts the transfer and alerts Admin (R5 AC15).
- [ ] `PendingScan` versions are not downloadable and do not satisfy Application-Ready.
- [ ] MinIO bucket has versioning + object lock (compliance mode) enabled.
- [ ] Presigned URLs are: short-lived (≤15 min), scoped to the requesting principal,
      include `response-content-disposition: attachment`, not cacheable by shared proxies.

## 10. Audit Log Integrity (R8)

- [ ] Audit entries are written by the `before_flush` SQLAlchemy listener — not hand-written
      at call sites.
- [ ] No code path bypasses the listener with a raw `UPDATE` or bulk SQL statement.
- [ ] The application DB role has INSERT + SELECT only on `audit_log` — no UPDATE/DELETE grant.
- [ ] The `BEFORE UPDATE OR DELETE` trigger exists on `audit_log` and raises an error.
- [ ] Every append holds `pg_advisory_xact_lock(AUDIT_CHAIN_KEY)` before reading the tail hash.
- [ ] Authorization denial audit entries use a separate DB connection (not the request transaction).
- [ ] Failure entries for rolled-back operations use a separate short-lived connection,
      keyed by `request_id` for idempotency (R8 AC5, design D-7).
- [ ] Sensitive columns in `before`/`after` JSONB are digested, not stored as plaintext.
- [ ] No deletion or anonymization path deletes or mutates hash-chained rows (R8 AC7).

## 11. SSRF & External Fetch (R6 AC1h, R4 AC12)

- [ ] JD URL extraction fetches run in the ARQ worker — never in the request path.
- [ ] SSRF guard: resolves hostname, rejects RFC 1918, loopback, 169.254/16, fc00::/7,
      100.64/10 (CGNAT), and 169.254.169.254 (metadata service) ranges.
- [ ] Re-validates on every redirect hop; pins connection to the validated IP (no TOCTOU).
- [ ] Fetch is capped: ≤2 MB response, ≤10 s total time.
- [ ] Email domain DNS validation (R4 AC12): 5-second hard timeout; positive cache 24h TTL,
      negative cache 5 min TTL in Valkey; PII is not stored alongside the cache entry.

## 12. SQL Injection & Input Validation

- [ ] All DB queries use parameterized queries or the SQLAlchemy ORM — no raw f-string SQL,
      no `text()` with unbound user values.
- [ ] Path traversal: no user-supplied filename or path component appears in a MinIO object key
      or any filesystem path.
- [ ] Field-length constraints from requirements exist at BOTH the Pydantic layer (error messages)
      and the PostgreSQL CHECK constraint layer (truth). A bound in only one layer is a finding.
- [ ] Enum-valued fields use PostgreSQL ENUM types, not free-text columns.
- [ ] Excel exports (R29): any Candidate-supplied string written to an `.xlsx` cell that starts
      with `=`, `+`, `-`, or `@` is prefixed or otherwise neutralized before XlsxWriter writes it.

## 13. Registration Rate Limiting

- [ ] Both registration endpoints (Candidate and Senior flows) have per-IP and per-email
      rate limits to prevent email enumeration and outbox flooding.
- [ ] The rate-limit counter for code-entry survives a Valkey restart (authoritative counter
      in PostgreSQL; Valkey is a hot-path cache only, not the source of truth).

## 14. Outbox & Email Security

- [ ] Verification-code plaintext is rendered at send time from a short-lived value.
      It is never written to `outbox_emails.payload` or any persistent store.
- [ ] Drainer uses `FOR UPDATE SKIP LOCKED` — no duplicate delivery under concurrent drainers.
- [ ] Outbox sends are idempotent on `(idempotency_key)`.

## 15. Backup & Infrastructure Security

- [ ] OpenBao snapshot backups are stored separately from PostgreSQL backups.
      They must never co-locate in the same backup destination.
- [ ] TLS is terminated at Traefik/Caddy; HSTS headers are present; no HTTP-only configuration.
- [ ] No infrastructure-as-code file (Docker Compose, Kubernetes manifest, Helm values)
      contains plaintext credentials committed to the repo.

## 16. Secrets & Configuration

- [ ] No secret (API key, DB password, MinIO credentials, JWT signing key, OpenBao token,
      pepper value) appears in source code or any committed config file.
- [ ] All secrets are injected via environment variables from a secrets manager.
- [ ] Python dependencies are pinned in `uv.lock`. No open-range specifiers (`>=`, `*`)
      added to `pyproject.toml` without a corresponding locked entry.

## 17. Dependency & License

- [ ] No new dependency introduces an SSPL, BUSL, or proprietary license.
- [ ] No new dependency has a known high/critical CVE (`pip-audit` / Trivy in CI).
- [ ] No dependency name looks like a typosquatting variant of a well-known package.
