"""Create (or reset) a local Admin account and enrol its MFA. Development only.

The Backend_Api cannot create the first Admin: every account starts from a
Registration_Link, which only an Admin can mint. This script inserts an Approved
Admin through the ORM and a UnitOfWork (so the audit trail records it), then
enrols MFA through the running API, because the MFA secret is encrypted with
OpenBao's transit key and only the API holds that path.

Run from backend/, with the API running (``./dev.sh`` starts it):

    uv run python scripts/seed_admin.py
    uv run python scripts/seed_admin.py --email me@example.com --password '...'

Re-running resets the account's MFA and enrols a new secret, which is what is
needed after OpenBao (dev mode) is restarted and its transit key is recreated.

The TOTP secret is never printed. It is written to the gitignored
``.dev-secrets/`` folder at the repository root:

* ``admin.env.sh`` / ``admin.env.ps1``: the E2E_* variables the Playwright suite
  reads. Load them with ``source .dev-secrets/admin.env.sh`` (bash) or
  ``. .dev-secrets/admin.env.ps1`` (PowerShell).
* ``admin-mfa-uri.txt``: the otpauth:// URI, to add the account to an
  authenticator app.
"""

from __future__ import annotations

import argparse
import asyncio
import os
from pathlib import Path
import sys
from urllib.parse import parse_qs, urlparse

import httpx
import pyotp
from sqlalchemy import func, select

from app.config import get_settings
from app.modules.identity.models import Account
from app.platform.db.engine import get_sessionmaker
from app.platform.db.enums import AccountStatus, Role
from app.platform.db.unit_of_work import UnitOfWork
from app.platform.security.password import hash_password

# The defaults match the e2e suite's own (frontend/e2e/support/backend.ts).
DEFAULT_EMAIL = "e2e-admin@example.com"
DEFAULT_PASSWORD = "correct-horse-battery-staple"  # noqa: S105 - local dev account only
DEFAULT_API = "http://127.0.0.1:8000/api/v1"
DEFAULT_MAILPIT = "http://localhost:8025"

SECRETS_DIR = Path(__file__).resolve().parents[2] / ".dev-secrets"


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--email", default=os.environ.get("E2E_ADMIN_EMAIL", DEFAULT_EMAIL))
    parser.add_argument(
        "--password", default=os.environ.get("E2E_ADMIN_PASSWORD", DEFAULT_PASSWORD)
    )
    parser.add_argument("--api", default=os.environ.get("E2E_API_BASE_URL", DEFAULT_API))
    return parser.parse_args()


async def ensure_account(email: str, password: str) -> None:
    """Create the Approved Admin, or clear an existing one's MFA for re-enrolment."""
    async with UnitOfWork(get_sessionmaker()) as uow:
        account = await uow.session.scalar(
            select(Account).where(
                func.lower(Account.email) == email.lower(),
                Account.email_released.is_(False),
            )
        )
        if account is None:
            uow.session.add(
                Account(
                    email=email,
                    roles=[Role.ADMIN],
                    status=AccountStatus.APPROVED,
                    password_hash=hash_password(password),
                )
            )
            print(f"account {email}: created")
            return
        if Role.ADMIN not in account.roles or account.status != AccountStatus.APPROVED:
            sys.exit(f"account {email} exists but is not an Approved Admin; refusing to change it")
        account.password_hash = hash_password(password)
        account.mfa_secret_enc = None
        account.mfa_wrapped_key = None
        account.mfa_enrolled_at = None
        print(f"account {email}: exists; password set, MFA reset")


async def enrol_mfa(api: str, email: str, password: str) -> str:
    """Enrol MFA through the API and prove a code works. Returns the provisioning URI."""
    credentials = {"email": email, "password": password, "role": "ADMIN"}
    async with httpx.AsyncClient(base_url=api, timeout=30) as http:
        login = await http.post("/auth/login", json=credentials)
        login.raise_for_status()
        token = login.json()["access_token"]

        enrolled = await http.post("/auth/mfa/enroll", headers={"Authorization": f"Bearer {token}"})
        enrolled.raise_for_status()
        uri: str = enrolled.json()["provisioning_uri"]

        secret = parse_qs(urlparse(uri).query)["secret"][0]
        check = await http.post(
            "/auth/login", json={**credentials, "mfa_code": pyotp.TOTP(secret).now()}
        )
        check.raise_for_status()
        print("MFA enrolled; a sign-in with a TOTP code succeeds")
    return uri


def write_secrets(api: str, email: str, password: str, uri: str) -> None:
    secret = parse_qs(urlparse(uri).query)["secret"][0]
    values = {
        "E2E_API_BASE_URL": api,
        "E2E_MAILPIT_BASE_URL": os.environ.get("E2E_MAILPIT_BASE_URL", DEFAULT_MAILPIT),
        "E2E_ADMIN_EMAIL": email,
        "E2E_ADMIN_PASSWORD": password,
        "E2E_ADMIN_TOTP_SECRET": secret,
    }
    SECRETS_DIR.mkdir(exist_ok=True)
    (SECRETS_DIR / "admin.env.sh").write_text(
        "".join(f"export {key}='{value}'\n" for key, value in values.items()), encoding="utf-8"
    )
    (SECRETS_DIR / "admin.env.ps1").write_text(
        "".join(f"$env:{key} = '{value}'\n" for key, value in values.items()), encoding="utf-8"
    )
    (SECRETS_DIR / "admin-mfa-uri.txt").write_text(uri + "\n", encoding="utf-8")
    print(f"credentials and TOTP secret written to {SECRETS_DIR} (gitignored)")


async def main() -> None:
    args = _parse_args()
    if get_settings().is_production:
        sys.exit("refusing to seed an Admin when APP_ENV=production")

    await ensure_account(args.email, args.password)
    try:
        uri = await enrol_mfa(args.api, args.email, args.password)
    except httpx.ConnectError:
        sys.exit(f"the API is not reachable at {args.api}; start it first (./dev.sh)")
    write_secrets(args.api, args.email, args.password, uri)


if __name__ == "__main__":
    asyncio.run(main())
