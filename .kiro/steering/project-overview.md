# HasoubLabs Recruitment Platform - Project Overview

This document provides an overview of the HasoubLabs Recruitment Platform project, including its purpose, scope, and key constraints.

## Project Purpose

The HasoubLabs Recruitment Platform is a greenfield web application designed to help the Hasoub Labs recruitment team efficiently discover, understand, manage, match, and support Arab students and graduates throughout their journey toward employment in Israel's high-tech industry.

## Key Outcomes

- Reduce recruiter manual effort per candidate while improving decision quality
- Give candidates self-service access to AI-powered profile improvement tools
- Give seniors a lightweight way to post job openings and connect with suitable candidates
- Provide a full audit trail of every candidate's journey — CVs, reviews, notes, communications — so no context is ever lost

## Project Phases

### Phase 1 (Current Scope)

**Requirements**: 1-4, 4A, 5-9, 28, 29

This is the foundational phase focusing on:

- User registration and role assignment (Admin, Candidate, Senior)
- Geographic (Residency) Verification
- Role-Based Access Control (RBAC)
- Candidate and Senior Profile Management
- CV Management (variants, versions, upload)
- Job Descriptions and Applications
- Review Timeline
- Administrative Reports and Excel Export

### Phase 2 (Deferred)

**Requirements**: 10-21

This phase will add AI-powered features including:

- AI_Engine integration (JD extraction, scoring, CV improvement)
- Notes system
- Recruiter handoff
- In-app chat
- Email/WhatsApp notifications
- Advanced matching

## Technical Stack

### Backend
- **Framework**: FastAPI (Python)
- **Database**: PostgreSQL 16+
- **Caching/Queues**: Valkey (formerly Redis)
- **Storage**: MinIO (S3-compatible)
- **Key Management**: OpenBao ( HashiCorp Vault alternative)

### Frontend
- **Framework**: React 18 + TypeScript + Vite
- **UI Library**: Mantine (with full RTL support)
- **State Management**: TanStack Query
- **Internationalization**: i18next

### DevOps & Infrastructure
- **Container Orchestration**: Kubernetes
- **CI/CD**: GitHub Actions
- **Observability**: OpenTelemetry, Prometheus, Grafana

## Architectural Constraints

### Modular Monolith

The platform is built as a modular monolith with explicit interfaces between modules:

```
app/
├── platform/       # Shared infrastructure (never imports domain)
└── modules/        # Domain modules (may import platform, not each other directly)
    ├── identity/
    ├── profiles/
    ├── cvs/
    ├── jobs/
    ├── applications/
    ├── reviews/
    ├── audit/
    └── reporting/
```

### Key Architectural Drivers

1. **Atomic Operations**: Multi-step operations must roll back completely with no intermediate state persisted
2. **Tamper-Evident Audit**: Every entity mutation must be reconstructable from field-level before/after diffs
3. **Constant-Time Authorization**: Authorization denials must be indistinguishable whether or not the resource exists

## Development Workflow

### Branching Strategy

- `main` - Production-ready code
- `develop` - Integration branch for upcoming release
- Feature branches - Named `feature/issue-number-description`
- Hotfix branches - Named `hotfix/issue-number-description`

### Pull Request Process

1. Create PR from feature branch to develop (or main for hotfixes)
2. Run all tests locally before pushing
3. Ensure CI passes (build, tests, lint, security checks)
4. Request review from at least one team member
5. Merge using squash merge to maintain clean history

### Code Review Checklist

- Does the code follow the project's coding standards?
- Are there appropriate tests for the changes?
- Are there any security concerns?
- Is the code maintainable and readable?
- Does the code handle edge cases?

## Security Constraints

### Password Policy
- Minimum 10 code points
- Configurable maximum (at least 64)
- Breached-password screening via k-anonymity hash prefix check
- Argon2id hashing with recorded parameters for rehash-on-login

### Session Management
- JWT with 30-minute sliding expiry
- Session store in Valkey
- MFA required for Admin accounts in production
- Context switching invalidates prior session state

### Data Encryption
- National IDs and residency proofs: AES-256-GCM envelope encryption
- CV files: SSE-KMS with OpenBao-wrapped data keys
- Passwords: Argon2id hashing

## Localization

The platform supports three languages: Arabic, Hebrew, and English. Two of these are RTL, making RTL support a first-class requirement.

- Frontend uses Mantine's DirectionProvider with dir on `<html>`
- Backend uses Babel message catalogs
- Content submitted in Arabic or Hebrew is stored byte-identical
- Tests run the full journey in all three locales

## Deployment

### Environment Stages
1. **Development** - Local development with Mailpit for email capture
2. **Staging** - Full environment matching production for QA
3. **Production** - Live environment with full monitoring

### Deployment Process
1. Merge to develop or main
2. CI builds Docker image and pushes to registry
3. CD deploys to target environment
4. Smoke tests verify deployment success

## Monitoring & Observability

### Metrics
- Request rate, latency, and error rates
- Database connection pool utilization
- Cache hit/miss rates
- Background job queue lengths

### Logs
- Centralized logging via OpenTelemetry Collector
- Structured JSON logs with request IDs
- Correlation of traces, metrics, and logs

### Alerts
- Error rate thresholds
- Database connection failures
- Background job failures
- Security events (failed logins, authorization denials)

## Compliance & Retention

### Data Retention
- Candidate data: ≥5 years from last activity
- Audit Log: ≥7 years (exempt from deletion path)
- CV objects: Held under MinIO object lock for retention period

### Deletion Requests
- Admin-actioned, audited, and anonymizes rather than hard-deletes
- Scrubs audit_actor_identities while leaving hash-chained audit rows intact
