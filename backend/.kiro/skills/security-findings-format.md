# Security Review — Findings Format & Verdict Rules

Use this skill to format every security review produced by the Security Reviewer agent.
Apply it consistently so findings are machine-readable, navigable, and actionable.

---

## Severity Levels

| Level | When to use |
|---|---|
| **CRITICAL** | Exploitable without authentication, or allows privilege escalation to Admin, or exposes national IDs / residency proofs / plaintext credentials to any unauthorized party. Must block the merge immediately. |
| **HIGH** | Exploitable by an authenticated non-Admin user to access another user's data, bypass RBAC, or corrupt the audit log. Must be fixed before merge. |
| **MEDIUM** | Weakens a security control without immediate exploitability (e.g., missing rate limit, weak caching of sensitive data, missing constant-time floor on a low-traffic path). Should be fixed before merge; can be deferred with a tracked issue and explicit reviewer sign-off. |
| **LOW** | Defense-in-depth gap, missing hardening, or a pattern that is not exploitable today but could become one (e.g., open-range dependency, missing HSTS, formula injection in an Admin-only export). Should be fixed; acceptable to defer with a tracked issue. |
| **INFO** | Observation, style deviation, or question that does not represent a vulnerability but is worth noting. No merge impact. |

---

## Finding Format

Use this exact structure for every finding:

```
**[SEVERITY] Short descriptive title**
File: `path/to/file.py`, line(s) N–M
Requirement: R# AC# (omit if not directly tied to a requirement)
Design ref: D# (omit if not applicable)

Description:
What is wrong, why it is a security risk, and what an attacker or malicious
user could do by exploiting it. Be concrete — name the affected data, role,
or endpoint.

Recommendation:
The specific code change, configuration change, or architectural fix needed.
If there are multiple acceptable approaches, list them in order of preference.
```

---

## Summary Section

After all findings, always output a Summary in this format:

```
## Summary

| Severity | Count |
|---|---|
| CRITICAL | N |
| HIGH | N |
| MEDIUM | N |
| LOW | N |
| INFO | N |
| **Total** | **N** |

**Verdict: BLOCK / MERGE WITH FIXES / APPROVED**

Verdict rules:
- BLOCK: any CRITICAL or HIGH finding is present.
- MERGE WITH FIXES: only MEDIUM, LOW, or INFO findings; each MEDIUM must have
  a tracked issue number or explicit fix committed before merge.
- APPROVED: no findings of any severity, or only INFO findings.

Open questions (if any):
- List any ambiguities that require clarification from the author or tech lead
  before a final verdict can be given.
```

---

## Requirement Reference Quick Map

Use these when tagging findings:

| Code | What it governs |
|---|---|
| R1 | Registration, account lifecycle, Admin bootstrap |
| R2 | Residency validation, email verification, sensitive data encryption |
| R3 | RBAC, constant-time denial, unauthenticated access |
| R4 | Candidate profile, field validation, completeness |
| R4A | Senior profile, contact preferences |
| R5 | CV upload, versioning, integrity, malware scanning |
| R6 | Job Description creation, SSRF on URL fetch, extraction |
| R7 | Application submission, rate limiting, routing |
| R8 | Audit log, hash chain, tamper-evidence, retention |
| R9 | Review timeline, append-only, visibility |
| R28 | Admin reports — Admin-only access |
| R29 | Excel export — formula injection, Admin-only access |

---

## Examples

**[CRITICAL] Registration endpoint accepts role from request body**
File: `app/modules/identity/router.py`, line 42
Requirement: R1 AC9

Description:
The `/register/candidate` handler reads `role` from `request.body.role` and uses it
to assign the account role. Any unauthenticated user can POST `{"role": "ADMIN"}` and
create an Admin account, bypassing R1 AC6's requirement that Admin accounts are created
only by direct DB insertion or by an existing Admin session.

Recommendation:
Remove the `role` field from the registration request schema entirely. The role must be
read exclusively from the validated registration link token (`jti`-verified, signature-checked
JWT). The `RegistrationService` should call `link_service.resolve_role(link_token)` and
never accept a role from the request body.

---

**[HIGH] Audit denial entry shares the request transaction**
File: `app/platform/security/guards.py`, line 88
Requirement: R3 AC9, R8 AC5
Design ref: D-7

Description:
The authorization-denial audit entry is written inside the same SQLAlchemy session as
the (potentially failing) request transaction. If the request later raises an exception
that triggers a rollback, the denial entry is silently discarded. This violates R3 AC9
(every denial must be recorded) and R8 AC5 (the audit must be reliable even on failure).

Recommendation:
Write denial audit entries on a **separate short-lived DB connection** that is committed
independently of the request transaction. Use the `audit_deny_connection` helper in
`platform/db/audit_connections.py` (or create it if absent). The entry should be keyed
by `request_id` for idempotency so retries do not duplicate it.
