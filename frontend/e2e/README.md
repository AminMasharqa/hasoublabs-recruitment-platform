# End-to-end journeys (task 27.1)

This directory holds two Playwright suites that share one `playwright.config.ts`:

- `a11y/` — the accessibility gate (`npm run test:a11y`), against a **mocked**
  Backend_Api. See that directory's own module docs.
- `journeys/` and `locale/` — the full end-to-end journey suite of this task
  (`npm run test:e2e`), against a **running** Backend_Api. This is what task 27
  ("Wire end-to-end journeys against a running Backend_Api") is about.

## What the journey suite needs to run

Unlike the accessibility gate, this suite makes real HTTP requests to a real
Backend_Api and expects real side effects (an emailed Verification_Code, a
scanned CV_Version, an exported Excel workbook). Bring up the backend's stack
first:

```powershell
cd backend
docker compose up -d
uv run alembic upgrade head
uv run uvicorn app.main:app --reload
```

Then, from `frontend/`:

```powershell
$env:E2E_API_BASE_URL = "http://localhost:8000/api/v1"
npm run test:e2e
```

### The one thing docker-compose cannot start for you: a seeded Admin

Every Registration_Link is minted by `POST /admin/registration-links`, which
requires an Admin session — and the Backend_Api has no endpoint, environment
variable or CLI command that creates the *first* Admin account (see
`backend/app/modules/identity/router.py` and `backend/.env.example`). That is a
deliberate backend-side omission this frontend spec does not reach, so the
journey suite cannot provision it itself.

Before running `test:e2e` against a fresh database, create one Admin account by
whatever means your environment provides (a one-off SQL insert, a backend
management command if one is added later, or a manual walk through the Web_Client
against a database seeded with a Registration_Link inserted by hand) and enrol
its multi-factor secret once. Then point the suite at it:

```powershell
$env:E2E_ADMIN_EMAIL = "admin@example.test"
$env:E2E_ADMIN_PASSWORD = "<the account's password>"
$env:E2E_ADMIN_TOTP_SECRET = "<the base32 secret it was enrolled with>"
```

`e2e/support/backend.ts` documents this precondition in full next to the code
that depends on it.

### Mail capture

Registration and verification need to read the emailed 6-digit code back out.
The suite reads it from Mailpit's HTTP API (`docker-compose.yml`'s `mailpit`
service), the same inbox a real registrant's email client would show:

```powershell
$env:E2E_MAILPIT_BASE_URL = "http://localhost:8025"   # default; override if needed
```

### CV scanning

The CV upload/download journey (`journeys/cv.spec.ts`) uploads a file and then
waits for its `CvVersion` to leave `PendingScan`. That transition is driven by
the Backend_Api's ClamAV integration (`clamav` in `docker-compose.yml`), which
needs a couple of minutes after first start to download its virus definitions
before it answers scans. The journey's own wait accounts for this; if ClamAV is
not reachable at all, that one journey fails at the scan-completion assertion
and the failure names ClamAV as the reason, rather than hanging indefinitely
under Playwright's own test timeout.

## What could not be run in this workspace

This suite was authored and statically verified (`npm run typecheck`,
`npm run lint`) without a running Backend_Api available in the authoring
environment — there is no Docker daemon reachable here, so none of
`postgres` / `valkey` / `mailpit` / `minio` / `clamav` / `openbao` could be
started, and no Admin account could be seeded to satisfy the precondition
above. `npm run test:e2e` was not executed end-to-end as a result; see the
task's own completion notes for what was verified instead.
