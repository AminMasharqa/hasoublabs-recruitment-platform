# HasoubLabs Recruitment Platform - Testing Standards

This document outlines the testing strategy, requirements, and standards for the HasoubLabs Recruitment Platform.

## Testing Strategy

The platform uses a multi-layered testing approach with clear separation of concerns:

```
tests/
├── unit/              # Unit tests (no I/O, mocked dependencies)
├── integration/       # Integration tests (real DB, external services)
└── e2e/               # End-to-end tests (full request lifecycle)
```

### Test Pyramid

```
                /\
               /  \      E2E Tests (fewer, critical paths)
              /____\
             /      \     Integration Tests (many, critical paths)
            /________\
           /          \   Unit Tests (most, comprehensive coverage)
          /____________\
```

## Test Categories

### Unit Tests

**Purpose**: Test individual functions, classes, and pure logic in isolation.

**Characteristics**:
- No I/O operations (database, file system, network)
- Mocked dependencies
- Fast execution (<100ms per test)
- High coverage targets (≥80%)

**When to Use**:
- Pure business logic (completeness evaluation, residency validation)
- Data transformation and validation
- Error handling and edge cases
- Algorithm correctness

**Examples**:
```python
# tests/unit/test_completeness_evaluator.py
def test_profile_completeness_all_fields_present():
    profile = CandidateProfile(
        full_name="John Doe",
        email="john@example.com",
        phone="+972-50-1234567",
        education=[EducationEntry(...)],
        skills=[Skill(name="Python")]
    )
    result = completeness_evaluator.evaluate(profile)
    assert result.state == "Complete"
    assert result.missing_fields == []

# tests/unit/test_residency_validator.py
def test_israeli_national_id_valid_check_digit():
    validator = ResidencyValidator()
    is_valid = validator.validate_national_id("123456789")
    assert is_valid is True
```

### Integration Tests

**Purpose**: Test component interactions with real infrastructure.

**Characteristics**:
- Real database (PostgreSQL)
- Real external services (Valkey, MinIO, ClamAV)
- Testcontainers for ephemeral infrastructure
- Moderate execution time (1-10s per test)

**When to Use**:
- Database queries and transactions
- API endpoint behavior
- Service integration
- Event flow and message handling

**Examples**:
```python
# tests/integration/test_registration.py
@pytest.mark.asyncio
async def test_candidate_registration_success(db: AsyncSession):
    registration_data = {
        "full_name": "Ahmed Hassan",
        "email": "ahmed@example.com",
        "password": "SecurePass123!",
        "role": "CANDIDATE",
        "residency_proof": {
            "type": "MobilePhone",
            "value": "+972-50-1234567"
        }
    }
    result = await registration_service.register(registration_data)
    
    assert result.status == AccountStatus.PENDING_VERIFICATION
    assert result.email_verification.state == "PendingCode"
    assert len(result.audit_entries) == 1

@pytest.mark.asyncio
async def test_job_application_flow(client: AsyncClient, db: AsyncSession):
    # Given: Candidate with complete profile and CV
    candidate = await create_candidate_with_profile_and_cv(db)
    jd = await create_open_job_description(db)
    
    # When: Candidate submits application
    response = await client.post(
        f"/api/v1/jobs/{jd.id}/apply",
        headers={"Authorization": f"Bearer {candidate.token}"},
        json={}
    )
    
    # Then
    assert response.status_code == 201
    assert response.json()["status"] == "Submitted"
    
    # Verify in-app notification created
    notifications = await db.execute(
        select(Notification).where(Notification.account_id == candidate.id)
    )
    assert len(notifications.scalars().all()) == 1
```

### E2E Tests

**Purpose**: Test complete user journeys across the entire stack.

**Characteristics**:
- Full request/response cycle
- Real browser or API client
- Test with all roles and locales
- Slow execution (10-60s per test)

**When to Use**:
- User registration and onboarding
- Critical business flows (apply for job, submit review)
- Multi-role workflows (Admin approval flow)
- Localization validation

**Examples**:
```python
# tests/e2e/test_registration_journey.py
@pytest.mark.parametrize("locale", ["ar", "he", "en"])
async def test_full_registration_journey(playwright_page, locale):
    # Navigate to registration
    await playwright_page.goto(f"/register/candidate?locale={locale}")
    await playwright_page.wait_for_selector("#full-name")
    
    # Fill registration form
    await playwright_page.fill("#full-name", " Fatima Al-Rashid")
    await playwright_page.fill("#email", "fatima@example.com")
    await playwright_page.fill("#password", "SecurePass123!")
    await playwright_page.fill("#phone", "+972-52-9876543")
    await playwright_page.fill("#city", "Tel Aviv")
    
    # Submit and verify
    await playwright_page.click("#submit")
    await playwright_page.wait_for_url("**/verify**")
    
    # Verify email received
    email = await mailtrap_client.get_latest_email("fatima@example.com")
    assert "Verification Code" in email.subject
    
    # Enter code and complete
    code = extract_verification_code(email.body)
    await playwright_page.fill("#code", code)
    await playwright_page.click("#verify")
    await playwright_page.wait_for_url("**/status**")
    
    # Verify registration completed
    assert "Registration Verified" in await playwright_page.content()
```

## Test Framework

### Tools

- **pytest**: Testing framework
- **pytest-asyncio**: Async test support
- **hypothesis**: Property-based testing
- **factory-boy**: Test data factories
- **faker**: Fake data generation (with Arabic/Hebrew locales)
- **testcontainers**: Ephemeral infrastructure for integration tests

### Conventions

```python
# pytest configuration
@pytest.fixture(scope="session")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()

@pytest.fixture(scope="function")
async def db_session() -> AsyncSession:
    async with TestingDatabase() as db:
        yield db
        await db.rollback()

@pytest.fixture
def candidate_factory():
    return CandidateFactory()

@pytest.fixture
def faker_ar():
    return Faker("ar_JO")
```

## Property-Based Testing

Use Hypothesis for comprehensive input space coverage:

### Key Properties

1. **Property 1**: Legal role sets only
   - Validates: Requirements 1.3, 1.5

2. **Property 2**: Authorization matrix soundness and completeness
   - Validates: Requirements 1.4, 1.7, 1.12, 1.14, 1.21, 2.12, 3.1, 3.2, 3.3, 3.4, 3.7, 3.11, 4.4, 4A.14, 6.5, 6.11, 9.1, 28.1, 28.6, 29.5

3. **Property 4**: Indistinguishable authorization denial
   - Validates: Requirements 3.6

4. **Property 12**: Verification-code lifecycle
   - Validates: Requirements 1.24, 1.25, 2.5, 2.6, 2.7, 2.8, 2.9

5. **Property 15**: No persisted residency proof ever fails validation
   - Validates: Requirements 2.4, 2.13, 2.14

6. **Property 16**: Encryption round-trip with no plaintext at rest
   - Validates: Requirements 2.15

### Example Property Test

```python
# tests/unit/test_residency_validation.py
@given(
    st.one_of(
        st.text(min_size=9, max_size=9, alphabet=st.characters(blacklist_categories=["L"])),
        st.text(min_size=10, max_size=10, alphabet=st.characters(blacklist_categories=["L"])),
    )
)
def test_national_id_invalid_length_rejected(code):
    validator = ResidencyValidator()
    assert validator.validate_national_id(code) is False

@given(
    st.text(min_size=9, max_size=9, alphabet=st.characters(blacklist_categories=["L"])),
    st.integers(min_value=0, max_value=9),
)
def test_national_id_check_digit_verification(code, wrong_digit):
    # Generate valid ID
    valid_id = generate_valid_national_id()
    # Mutate one digit
    invalid_id = valid_id[:-1] + str(wrong_digit)
    
    validator = ResidencyValidator()
    assert validator.validate_national_id(invalid_id) is False
    assert validator.validate_national_id(valid_id) is True
```

## Database Testing

### Test Database

Use a dedicated test database with ephemeral lifecycle:

```python
# tests/conftest.py
class TestingDatabase:
    def __init__(self):
        self.engine = create_async_engine(
            "postgresql+asyncpg://test:test@localhost:5432/test_db",
            pool_size=1,
            max_overflow=0
        )
        self.SessionLocal = sessionmaker(
            self.engine,
            class_=AsyncSession,
            expire_on_commit=False
        )
    
    async def __aenter__(self) -> AsyncSession:
        async with self.SessionLocal() as session:
            yield session
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.engine.dispose()
```

### Transaction Rollback

Each test runs in a transaction that is rolled back:

```python
@pytest.mark.asyncio
async def test_unit_of_work_rollback(db: AsyncSession):
    # Given: Account exists
    account = await create_account(db, status="Approved")
    
    # When: Operation fails
    with pytest.raises(InvalidStateTransition):
        await account_service.transition_status(
            account.id,
            from_status="Approved",
            to_status="Rejected",  # Invalid transition
            reason="Test rejection"
        )
    
    # Then: Database unchanged
    result = await db.execute(select(Account).where(Account.id == account.id))
    updated_account = result.scalar_one()
    assert updated_account.status == "Approved"  # Not rejected
```

## Mocking External Services

### Services to Mock

- **SMTP**: Mailpit/Mailtrap for email testing
- **ClamAV**: Mock antivirus scanner responses
- **Valkey**: Use in-memory store for session testing
- **MinIO**: Use local S3-compatible storage

### Example Mock

```python
# tests/integration/test_cv_upload.py
@pytest.mark.asyncio
async def test_cv_upload_with_malware_detection(
    db: AsyncSession,
    minio_client: MinIO,
    clamav_mock: ClamAVMock
):
    clamav_mock.set_result("EICAR-Test-Signature")  # Malware
    
    # Upload CV
    with open("tests/fixtures/eicar_test.virus", "rb") as f:
        response = await client.post(
            f"/api/v1/cv-variants/{variant_id}/versions",
            files={"file": ("test.pdf", f, "application/pdf")},
            headers={"Authorization": f"Bearer {candidate.token}"}
        )
    
    assert response.status_code == 202  # Accepted for scanning
    
    # Verify quarantine (not in available bucket)
    objects = await minio_client.list_objects("cv")
    assert len(objects) == 0  # Quarantined object not counted
    
    # Verify quarantine bucket has file
    objects = await minio_client.list_objects("cv-quarantine")
    assert len(objects) == 1
```

## Coverage Requirements

### Unit Tests
- ≥80% code coverage
- ≥90% for security-critical modules
- All edge cases covered

### Integration Tests
- All domain modules tested
- All API endpoints tested
- All business flows tested

### E2E Tests
- All critical user journeys tested
- All locales tested
- All role combinations tested

## CI Pipeline

### Pre-Commit

```bash
# .gitlab-ci.yml
pre-commit:
  stage: test
  script:
    - pip install pre-commit
    - pre-commit run --all-files
```

### CI Pipeline

```bash
# .gitlab-ci.yml
test:
  stage: test
  services:
    - postgres:16
    - valkey:7
    - minio:latest
  script:
    - uv sync
    - uv run pytest tests/unit --cov=app --cov-report=xml
    - uv run pytest tests/integration --cov=app --cov-report=xml
    - uv run pytest tests/e2e
  coverage:
    - '/TOTAL.*\s+(\d+%)/'
  artifacts:
    reports:
      - junit.xml
      - coverage.xml
```

## Test Data Factories

```python
# tests/factories.py
class CandidateProfileFactory(factory.Factory):
    class Meta:
        model = CandidateProfile
    
    full_name = factory.Faker("name", locale="ar_JO")
    email = factory.LazyAttribute(lambda o: f"{o.full_name.replace(' ', '.')}@example.com")
    phone = factory.LazyAttribute(lambda o: f"+972-5{random.randint(0,9)}-{random.randint(1000000, 9999999)}")
    residency_proof_type = "MobilePhone"
    residency_proof_value = factory.LazyAttribute(lambda o: f"+972-5{random.randint(0,9)}-{random.randint(1000000, 9999999)}")
```

## Security Testing

### Authentication Tests

- Invalid JWT rejected
- Expired JWT rejected
- Token tampering detected
- Session hijacking prevented

### Authorization Tests

- Role-based access control enforced
- Resource scoping enforced
- Status gates enforced
- Context switching enforced

### Input Validation Tests

- SQL injection prevented
- XSS prevented
- Path traversal prevented
- Rate limiting enforced

## Performance Testing

### Response Time SLAs

| Endpoint Type | SLA |
|---------------|-----|
| User registration | <3s |
| Login | <1s |
| Profile update | <1s |
| CV upload | <3s |
| Application submit | <2s |
| Job list (20/page) | <1s |
| Audit log search | <3s |

### Load Testing

- 500 concurrent users
- 50 RPS sustained
- Error rate <0.1%

## Accessibility Testing

### Automated Checks

- WCAG 2.1 AA compliance
- Color contrast ratio ≥4.5:1
- Keyboard navigation
- Screen reader support

### Manual Checks

- RTL layout validation
- Arabic/Hebrew text rendering
- Form labels and instructions

## Regression Testing

### Test Maintenance

- Update tests when requirements change
- Remove obsolete tests
- Update fixtures when data models change
- Review flaky tests weekly

### Regression Suite

Run before every release:

```bash
# run_regression.sh
#!/bin/bash
uv run pytest tests/integration tests/e2e -v
```
