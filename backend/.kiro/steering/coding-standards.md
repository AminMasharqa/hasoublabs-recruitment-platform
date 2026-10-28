# HasoubLabs Recruitment Platform - Coding Standards

This document outlines the coding standards and technical conventions for the HasoubLabs Recruitment Platform.

## File Organization

### Module Structure

Each domain module follows this structure:

```
app/modules/<module>/
├── router.py       # FastAPI routes; HTTP concerns only; auth dependencies
├── api.py          # Public interface exposed to other modules (protocol + impl)
├── service.py      # Domain logic, transaction orchestration
├── repository.py   # SQLAlchemy queries; module-private
├── models.py       # ORM models; module-private
├── schemas.py      # Pydantic v2 request/response + cross-module DTOs
└── errors.py       # Domain error types
```

### Platform Structure

```
app/platform/
├── db/             # Database, Unit of Work, migrations
├── security/       # JWT, guards, crypto, rate limiting
├── storage/        # ObjectStore adapter
├── mail/           # Transactional outbox, email sending
├── jobs/           # ARQ app, task registry, APScheduler
├── i18n/           # Localization, Babel
├── taxonomy/       # Skill canonicalization
└── pagination/     # Keyset pagination helpers
```

## Import Rules

### Module Boundaries

1. A module may import another module **only** through that module's `api.py` or `schemas.py`
2. `platform/*` must never import from any domain module (one-way dependency)
3. No domain module may import `fastapi` outside its `router.py`

### Import Examples

```python
# CORRECT - import through api.py
from app.modules.profiles.api import ProfilesApi

# CORRECT - import DTOs from schemas
from app.modules.profiles.schemas import CandidateProfileDTO

# WRONG - importing models directly
from app.modules.profiles.models import CandidateProfile

# WRONG - importing service implementation
from app.modules.profiles.service import CandidateProfileService

# WRONG - fastapi import outside router.py
from fastapi import Depends  # Only in router.py
```

## Code Style

### Python (PEP 8 with exceptions)

- Use 4 spaces for indentation (no tabs)
- Line length: 100 characters
- Type hints required for all function signatures
- Use `isort` with profile=black for import sorting
- Use `ruff` for linting with the project's custom rules

### Type Hints

```python
# Function signatures must include type hints
async def get_candidate_profile(
    account_id: UUID,
    profiles_api: ProfilesApi,
) -> CandidateProfileDTO:
    ...

# Use Protocol for interfaces
class ProfilesApi(Protocol):
    async def get_completeness(
        self, account_id: UUID
    ) -> Completeness: ...

# Use List, Dict, Optional for collections
from typing import List, Dict, Optional

# Use UUID for identifiers
from uuid import UUID
```

### Naming Conventions

| Element | Style | Example |
|---------|-------|---------|
| Classes | PascalCase | `CandidateProfileService` |
| Functions | snake_case | `get_candidate_profile` |
| Variables | snake_case | `candidate_profile` |
| Constants | UPPER_SNAKE_CASE | `MAX.CV_SIZE_MB` |
| Enums | PascalCase with values in UPPER_CASE | `Role.ADMIN` |
| Modules | snake_case | `candidate_profile_service.py` |

## Database Conventions

### Naming

- Tables: snake_case plural (`candidate_profiles`, `job_descriptions`)
- Columns: snake_case (`full_name`, `created_at`)
- Primary Keys: `id` (UUID, not auto-increment)
- Foreign Keys: `{model}_id` (`candidate_id`, `jd_id`)
- Indexes: `idx_{table}_{columns}`
- Unique Constraints: `uq_{table}_{columns}`

### PostgreSQL Features

- Use native ENUM types for status fields
- Use JSONB for flexible/optional data
- Use `citext` for case-insensitive text (emails)
- Use `uuid_generate_v4()` for IDs
- All timestamps in UTC with millisecond precision

### ORM Conventions

```python
# Use SQLAlchemy 2.x async style
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import mapped_column, Mapped
from sqlalchemy import Enum, String, DateTime, func

class Account(Base):
    __tablename__ = "accounts"
    
    id: Mapped[UUID] = mapped_column(
        primary_key=True,
        default=uuid_generate_v4
    )
    
    email: Mapped[str] = mapped_column(
        String(255),
        unique=True,
        index=True
    )
    
    status: Mapped[AccountStatus] = mapped_column(
        Enum(AccountStatus),
        nullable=False
    )
    
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(3)
    )
```

## API Design

### HTTP Methods

| Method | Use Case | Idempotent |
|--------|----------|------------|
| GET | Retrieve resources | Yes |
| POST | Create resources | No |
| PUT | Replace resource | Yes |
| PATCH | Partial update | No |
| DELETE | Remove resource | Yes |

### Response Format

```python
# Success (2xx)
{
    "data": {...},  # Actual resource data
    "meta": {        # Pagination, counts, etc.
        "page": 1,
        "page_size": 20,
        "total": 100
    }
}

# Error (4xx, 5xx)
{
    "error": "error_key",  # Stable machine key
    "message": "Localized message",
    "details": {
        "field": "field_name",  # Optional field path
        "code": "error_code"     # Machine-readable sub-code
    },
    "request_id": "uuid"     # For debugging
}
```

### Pagination

Always use keyset pagination, never OFFSET:

```python
# GET /api/v1/jobs?after=2024-01-01T00:00:00Z&page_size=20
class PaginationParams:
    after: datetime | None = None
    before: datetime | None = None
    page_size: int = Field(default=20, le=100)

# Response includes next/previous cursors
{
    "data": [...],
    "meta": {
        "has_next": true,
        "has_prev": false,
        "next_cursor": "2024-01-01T12:00:00Z"
    }
}
```

### Idempotency

All mutating endpoints accept an `Idempotency-Key` header:

```python
@router.post("/jobs", dependencies=[Depends(require_roles([Role.SENIOR]))])
async def create_job(
    request: Request,
    job_data: JobCreateSchema,
    principal: Principal = Depends(current_principal),
):
    idempotency_key = request.headers.get("Idempotency-Key")
    # Use idempotency_key to prevent duplicate creation
    ...
```

## Authentication & Authorization

### JWT Claims

```json
{
  "sub": "account-uuid",
  "exp": 1234567890,
  "iat": 1234567800,
  "act": "SENIOR",  // active role context
  "roles": ["SENIOR", "CANDIDATE"],
  "session_id": "session-uuid"
}
```

### Authorization Guard

```python
from app.platform.security.guards import require, current_principal

@router.get("/candidates/{id}/reviews")
async def list_reviews(
    candidate_id: UUID,
    principal: Principal = Depends(
        require(
            roles=frozenset({Role.ADMIN, Role.SENIOR}),
            context=Role.SENIOR,  # Optional - for dual-role accounts
            statuses=frozenset({AccountStatus.APPROVED})
        )
    )
):
    ...
```

### Constant-Time Denial

Authorization denials must use a fixed-latency response path:

```python
# Use fixed deny floor (default 120ms)
DENY_FLOOR_MS = 120

# Measure from middleware entry to denial
elapsed = time.monotonic() - middleware_entry_time
if elapsed < DENY_FLOOR_MS:
    await asyncio.sleep(DENY_FLOOR_MS - elapsed)
```

## Data Validation

### Dual-Layer Validation

Every schema bound must be enforced at both Pydantic and database levels:

```python
# Pydantic (user-facing validation)
class CandidateProfileCreate(BaseModel):
    full_name: str = Field(..., min_length=1, max_length=100)
    email: EmailStr
    phone: str  # Validated with phonenumbers library

# Database (truth layer - constraint trigger)
CREATE OR REPLACE FUNCTION enforce_candidate_profile_bounds()
RETURNS TRIGGER AS $$
BEGIN
    IF LENGTH(NEW.full_name) < 1 OR LENGTH(NEW.full_name) > 100 THEN
        RAISE EXCEPTION 'full_name must be 1-100 characters';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

### Validation Order

1. Request body parsing (FastAPI/Pydantic)
2. Field-level constraints (Pydantic validators)
3. Cross-field constraints (Pydantic model validators)
4. Database constraints (CHECK constraints, triggers)
5. Domain logic validation (service layer)

## Error Handling

### Error Types

```python
# Define domain errors
class DomainError(Exception):
    """Base class for domain errors"""
    pass

class AuthorizationDenied(DomainError):
    """User is not authorized for the requested action"""
    pass

class InvalidStateTransition(DomainError):
    """An illegal state transition was attempted"""
    pass

class ValidationFailed(DomainError):
    """Input validation failed"""
    def __init__(self, errors: list[ErrorDetail]):
        self.errors = errors
```

### Error Response Structure

```python
# Single error type for authorization denials
class AuthorizationDenied(DomainError):
    pass

# Error handler produces byte-identical response
@app.exception_handler(AuthorizationDenied)
async def authorization_denied_handler(
    request: Request, exc: AuthorizationDenied
):
    return JSONResponse(
        status_code=403,
        content={
            "error": "not_authorized",
            "message": i18n.get("error.not_authorized"),
            "request_id": request.state.request_id
        }
    )
```

## Testing

### Test Structure

```
tests/
├── unit/           # Unit tests (no I/O, mocked dependencies)
├── integration/    # Integration tests (real DB, external services)
└── e2e/            # End-to-end tests (full request lifecycle)
```

### Testing Conventions

```python
# Unit tests
def test_candidate_profile_completeness():
    # Given
    profile = CandidateProfile(...)
    
    # When
    result = completeness_evaluator.evaluate(profile)
    
    # Then
    assert result.state == "Complete"
    assert result.missing_fields == []

# Integration tests with test database
@pytest.mark.asyncio
async def test_candidate_registration(db: AsyncSession):
    # Given
    registration_data = {...}
    
    # When
    result = await registration_service.register(registration_data)
    
    # Then
    assert result.status == AccountStatus.PENDING_VERIFICATION

# Property-based tests with Hypothesis
@given(st.text(min_size=1, max_size=100))
def test_full_name_validation(name):
    profile = CandidateProfile(full_name=name)
    assert 1 <= len(profile.full_name) <= 100
```

## Security

### Password Security

```python
# Password hashing
from passlib.context import CryptContext

pwd_context = CryptContext(
    schemes=["argon2"],
    deprecated="auto",
    argon2__rounds=10,  # Equivalent to bcrypt cost 12
    argon2__memory_cost=102400,
    argon2__time_cost=10,
    argon2__parallelism=8
)

# Breached-password screening
def check_breached_password(password: str) -> bool:
    # Use k-anonymity API, check only prefix
    prefix = hash_password(password)[:5]
    return prefix in breached_prefix_set
```

### Encryption

```python
# AES-256-GCM envelope encryption
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

def encrypt_sensitive_data(data: bytes, key: bytes) -> tuple[bytes, bytes]:
    nonce = os.urandom(12)
    cipher = AESGCM(key)
    ciphertext = cipher.encrypt(nonce, data, None)
    return nonce + ciphertext

def decrypt_sensitive_data(data: bytes, key: bytes) -> bytes:
    nonce, ciphertext = data[:12], data[12:]
    cipher = AESGCM(key)
    return cipher.decrypt(nonce, ciphertext, None)
```

## Documentation

### Docstrings

Use Google-style docstrings:

```python
def get_candidate_profile(
    account_id: UUID,
    profiles_api: ProfilesApi,
) -> CandidateProfileDTO:
    """Retrieve a candidate's profile.
    
    Args:
        account_id: The UUID of the candidate's account
        profiles_api: The profiles API service
        
    Returns:
        The candidate's profile DTO
        
    Raises:
        AuthorizationDenied: If the requesting principal
            is not authorized to view the profile
        EntityNotFound: If no candidate exists for the
            given account_id
    """
    ...
```

### API Documentation

- OpenAPI documentation auto-generated from FastAPI
- Document all request/response schemas in OpenAPI
- Include example requests and responses
- Document error responses with example payloads

## Continuous Integration

### Pre-commit Hooks

```yaml
# .pre-commit-config.yaml
repos:
  - repo: https://github.com/pre-commit/pre-commit-hooks
    rev: v4.5.0
    hooks:
      - id: trailing-whitespace
      - id: end-of-file-fixer
      - id: check-yaml
      - id: check-added-large-files

  - repo: https://github.com/psf/black
    rev: 23.12.1
    hooks:
      - id: black

  - repo: https://github.com/pycqa/isort
    rev: 5.13.2
    hooks:
      - id: isort
        args: ["--profile", "black"]
```

### CI Pipeline

1. Install dependencies (`uv sync`)
2. Lint (`ruff check .`)
3. Type check (`mypy app/`)
4. Run tests (`pytest tests/`)
5. Build Docker image
6. Push to registry
