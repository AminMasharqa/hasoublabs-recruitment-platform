"""Seed a believable demo dataset through the running API. Development only.

Everything goes through the public API, the way a real user's actions would, so
the audit trail, the hash chain and the notification emails are all genuine.
Run it against a freshly migrated database that already has the Admin from
``seed_admin.py`` (``./dev.sh --seed-admin --seed-demo`` does both, and
``scripts/wipe_dev_db.sh`` gives you the clean database):

    uv run python scripts/seed_demo.py

Needs the API, the worker (verification emails, CV scans), Mailpit and ClamAV
running. CVs only become Available once ClamAV has scanned them, so the script
waits for that (up to ``--scan-timeout`` seconds).

What it creates (every account shares one password, written to
``.dev-secrets/demo-accounts.md``, which is gitignored):

* 3 Seniors with 4 Open jobs between them. One of the three also holds the
  Candidate role, for the context switch.
* 3 Approved Candidates with a Complete profile and an Available CV. They have
  4 applications between them, and one application's candidate has a Review.
* 1 Approved Candidate whose profile is still empty (to demo profile completion),
  and 1 verified Candidate waiting for Admin approval (to demo the approval step).
* 1 unused Registration_Link for each role (the tokens are in the summary file).

It refuses to run if the first demo account already exists.
"""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import re
import sys
import time
from typing import Any

import httpx
import pyotp

from app.config import get_settings

DEFAULT_API = "http://127.0.0.1:8000/api/v1"
DEFAULT_MAILPIT = "http://localhost:8025"
PASSWORD = "Correct-Horse-Battery-Staple-9"  # noqa: S105 - local demo accounts only
SECRETS_DIR = Path(__file__).resolve().parents[2] / ".dev-secrets"
EMAIL_DOMAIN = "example.com"

# A phone the residency validator accepts: look-alike sequences are rejected.
RESIDENCY_PHONE = "0502345678"


class SeedError(RuntimeError):
    """A step failed in a way the run cannot recover from."""


def _check(response: httpx.Response, what: str) -> Any:  # noqa: ANN401 - JSON of any shape
    if response.is_success:
        return response.json() if response.content else None
    try:
        envelope = response.json()
    except ValueError:
        envelope = {}
    raise SeedError(
        f"{what}: {response.status_code} {envelope.get('error', 'unknown_error')} "
        f"(request_id={envelope.get('request_id', 'none')})"
    )


def _minimal_pdf(marker: str) -> bytes:
    """A one-page PDF with a valid cross-reference table (pikepdf must open it)."""
    objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>",
        f"<< /Title ({marker}) >>",
    ]
    body = "%PDF-1.4\n"
    offsets: list[int] = []
    for index, obj in enumerate(objects, start=1):
        offsets.append(len(body.encode("latin1")))
        body += f"{index} 0 obj\n{obj}\nendobj\n"
    xref = len(body.encode("latin1"))
    body += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n"
    body += "".join(f"{offset:010d} 00000 n \n" for offset in offsets)
    body += (
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R /Info 4 0 R >>\n"
        f"startxref\n{xref}\n%%EOF\n"
    )
    return body.encode("latin1")


def _load_admin_env() -> None:
    """Fill E2E_* from .dev-secrets/admin.env.sh when the shell has not exported them."""
    path = SECRETS_DIR / "admin.env.sh"
    if os.environ.get("E2E_ADMIN_TOTP_SECRET") or not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        match = re.fullmatch(r"export (E2E_\w+)='(.*)'", line.strip())
        if match:
            os.environ.setdefault(match.group(1), match.group(2))


# ── The dataset ───────────────────────────────────────────────────────────────

CANDIDATES: list[dict[str, Any]] = [
    {
        "key": "layla",
        "full_name": "ليلى حداد",
        "language": "ar",
        "city": "Haifa",
        "phone": "+972502345671",
        "summary": "QA engineer moving into test automation.",
        "education": ("University of Haifa", "B.Sc. Information Systems", 2017, 2021),
        "skills": ["QA Automation", "Selenium", "SQL"],
        "state": "complete",
    },
    {
        "key": "daniel",
        "full_name": "Daniel Cohen",
        "language": "en",
        "city": "Tel Aviv",
        "phone": "+972502345672",
        "summary": "Backend developer, five years in fintech.",
        "education": ("Technion", "B.Sc. Computer Science", 2014, 2018),
        "skills": ["Python", "PostgreSQL", "Docker"],
        "state": "complete",
    },
    {
        "key": "yael",
        "full_name": "יעל אברהם",
        "language": "he",
        "city": "Jerusalem",
        "phone": "+972502345673",
        "summary": "Data analyst with a BI background.",
        "education": ("Hebrew University", "M.A. Statistics", 2018, 2020),
        "skills": ["Data Analysis", "Power BI", "SQL"],
        "state": "complete",
    },
    {"key": "maya", "full_name": "Maya Saleh", "language": "en", "state": "empty"},
    {"key": "omar", "full_name": "Omar Nasser", "language": "ar", "state": "pending"},
]

SENIORS: list[dict[str, Any]] = [
    {
        "key": "sara",
        "full_name": "Sara Levi",
        "company": "Nimbus Analytics",
        "job_title": "Engineering Manager",
        "skills": ["Python", "AWS"],
    },
    {
        "key": "khaled",
        "full_name": "Khaled Mansour",
        "company": "Carmel Software",
        "job_title": "Head of QA",
        "skills": ["QA Automation", "Selenium"],
    },
    {
        "key": "nour",
        "full_name": "Nour Aziz",
        "company": "Galil Systems",
        "job_title": "Tech Lead",
        "skills": ["Python", "Docker"],
        "also_candidate": True,
    },
]

JOBS: list[dict[str, Any]] = [
    {
        "owner": "sara",
        "title": "Backend Developer (Python)",
        "company": "Nimbus Analytics",
        "location": "Tel Aviv",
        "work_model": "Hybrid",
        "employment_type": "Full-time",
        "experience_level": "Mid-level",
        "description": "Build and run the services behind our analytics platform.",
        "skills": ["Python", "PostgreSQL", "Docker"],
    },
    {
        "owner": "sara",
        "title": "Data Analyst",
        "company": "Nimbus Analytics",
        "location": "Remote",
        "work_model": "Remote",
        "employment_type": "Full-time",
        "experience_level": "Junior-level",
        "description": "Turn product usage data into decisions.",
        "skills": ["SQL", "Data Analysis", "Power BI"],
    },
    {
        "owner": "khaled",
        "title": "QA Automation Engineer",
        "company": "Carmel Software",
        "location": "Haifa",
        "work_model": "Onsite",
        "employment_type": "Full-time",
        "experience_level": "Mid-level",
        "description": "Own the end-to-end test suite for our hiring products.",
        "skills": ["QA Automation", "Selenium", "SQL"],
    },
    {
        "owner": "nour",
        "title": "DevOps Engineer",
        "company": "Galil Systems",
        "location": "Jerusalem",
        "work_model": "Hybrid",
        "employment_type": "Contract",
        "experience_level": "Senior-level",
        "description": "Run our Kubernetes platform and CI/CD pipelines.",
        "skills": ["Docker", "Kubernetes", "AWS"],
    },
]

# (candidate, job title) pairs that apply, and the one review to write.
APPLICATIONS = [
    ("layla", "QA Automation Engineer"),
    ("layla", "Data Analyst"),
    ("daniel", "Backend Developer (Python)"),
    ("yael", "Data Analyst"),
]
REVIEW = {
    "reviewer": "khaled",
    "candidate": "layla",
    "job": "QA Automation Engineer",
    "ratings": (4, 5, 4, 4),
    "assessment": (
        "Strong automation fundamentals and clear communication. Needs more depth "
        "on CI integration, which she is already working on."
    ),
}


class Seeder:
    def __init__(self, api: str, mailpit: str, scan_timeout: int) -> None:
        self.http = httpx.Client(base_url=api, timeout=60)
        self.mailpit = mailpit
        self.scan_timeout = scan_timeout
        self.admin_token = ""
        self.accounts: dict[str, dict[str, str]] = {}
        self.tokens: dict[str, str] = {}
        self.jobs: dict[str, str] = {}
        self.variants: dict[str, str] = {}

    @staticmethod
    def auth(token: str) -> dict[str, str]:
        return {"Authorization": f"Bearer {token}"}

    @staticmethod
    def email(key: str) -> str:
        return f"demo-{key}@{EMAIL_DOMAIN}"

    # ── Admin ────────────────────────────────────────────────────────────────

    def sign_in_admin(self) -> None:
        email = os.environ.get("E2E_ADMIN_EMAIL", "e2e-admin@example.com")
        password = os.environ.get("E2E_ADMIN_PASSWORD", "correct-horse-battery-staple")
        secret = os.environ.get("E2E_ADMIN_TOTP_SECRET")
        if not secret:
            raise SeedError("E2E_ADMIN_TOTP_SECRET is not set; run seed_admin.py first")
        body = {
            "email": email,
            "password": password,
            "role": "ADMIN",
            "mfa_code": pyotp.TOTP(secret).now(),
        }
        login = _check(self.http.post("/auth/login", json=body), "admin login")
        self.admin_token = login["access_token"]

    def admin_post(self, path: str, body: dict[str, Any], what: str) -> Any:  # noqa: ANN401
        return _check(self.http.post(path, json=body, headers=self.auth(self.admin_token)), what)

    # ── Accounts ─────────────────────────────────────────────────────────────

    def _verification_code(self, email: str, timeout: float = 30) -> str:
        deadline = time.monotonic() + timeout
        while True:
            found = httpx.get(
                f"{self.mailpit}/api/v1/search", params={"query": f"to:{email}"}, timeout=10
            )
            messages = found.json().get("messages", []) if found.is_success else []
            if messages:
                message = httpx.get(
                    f"{self.mailpit}/api/v1/message/{messages[0]['ID']}", timeout=10
                )
                payload = message.json()
                text = f"{payload.get('Text', '')} {payload.get('HTML', '')}"
                match = re.search(r"\b(\d{6})\b", text)
                if match:
                    return match.group(1)
            if time.monotonic() > deadline:
                raise SeedError(f"no verification code for {email}; is the worker running?")
            time.sleep(1)

    def register(self, key: str, full_name: str, role: str, language: str, approve: bool) -> None:
        email = self.email(key)
        link = self.admin_post("/admin/registration-links", {"role": role}, f"link for {key}")
        path = "/register/candidate" if role == "CANDIDATE" else "/register/senior"
        account = _check(
            self.http.post(
                path,
                json={
                    "role": role,
                    "full_name": full_name,
                    "email": email,
                    "password": PASSWORD,
                    "language_preference": language,
                    "residency_proof_type": "MobilePhone",
                    "residency_proof_value": RESIDENCY_PHONE,
                    "link_token": link["token"],
                },
            ),
            f"register {key}",
        )
        code = self._verification_code(email)
        _check(
            self.http.post("/verify/code", json={"account_id": account["id"], "code": code}),
            f"verify {key}",
        )
        if approve:
            self.admin_post(
                f"/admin/accounts/{account['id']}:approve", {"fast_track": True}, f"approve {key}"
            )
        self.accounts[key] = {
            "id": account["id"],
            "email": email,
            "role": role,
            "name": full_name,
            "state": "Approved" if approve else "Awaiting approval",
        }

    def sign_in(self, key: str, role: str) -> str:
        login = _check(
            self.http.post(
                "/auth/login",
                json={"email": self.accounts[key]["email"], "password": PASSWORD, "role": role},
            ),
            f"sign in {key}",
        )
        self.tokens[f"{key}:{role}"] = login["access_token"]
        return login["access_token"]

    # ── Profiles, CVs, jobs, applications, reviews ───────────────────────────

    def complete_candidate_profile(self, spec: dict[str, Any]) -> None:
        token = self.sign_in(spec["key"], "CANDIDATE")
        institution, degree, start, end = spec["education"]
        _check(
            self.http.put(
                "/me/profile",
                headers=self.auth(token),
                json={
                    "full_name": spec["full_name"],
                    "email": self.email(spec["key"]),
                    "phone": spec["phone"],
                    "city": spec["city"],
                    "summary": spec["summary"],
                    "education": [
                        {
                            "institution": institution,
                            "degree": degree,
                            "enrolment_status": "Graduated",
                            "start_year": start,
                            "end_year": end,
                        }
                    ],
                    "skills": [{"term": term, "years_experience": 3} for term in spec["skills"]],
                    "languages": [{"language_code": "en", "proficiency": "Fluent"}],
                },
            ),
            f"profile of {spec['key']}",
        )

    def upload_cv(self, key: str) -> None:
        token = self.tokens[f"{key}:CANDIDATE"]
        variant = _check(
            self.http.post(
                "/me/cv-variants",
                headers=self.auth(token),
                json={"name": "General CV", "description": "Default CV"},
            ),
            f"CV variant for {key}",
        )
        self.variants[key] = variant["id"]
        _check(
            self.http.post(
                f"/me/cv-variants/{variant['id']}/versions",
                headers=self.auth(token),
                files={"file": (f"{key}-cv.pdf", _minimal_pdf(f"demo-{key}"), "application/pdf")},
            ),
            f"CV upload for {key}",
        )

    def wait_for_cvs(self, keys: list[str]) -> None:
        deadline = time.monotonic() + self.scan_timeout
        pending = set(keys)
        while pending:
            for key in sorted(pending):
                versions = _check(
                    self.http.get(
                        f"/me/cv-variants/{self.variants[key]}/versions",
                        headers=self.auth(self.tokens[f"{key}:CANDIDATE"]),
                    ),
                    f"CV versions of {key}",
                )
                states = {version["state"] for version in versions}
                if "Quarantined" in states:
                    raise SeedError(f"the demo CV of {key} was quarantined by ClamAV")
                if "Available" in states:
                    pending.discard(key)
            if pending:
                if time.monotonic() > deadline:
                    raise SeedError(
                        f"CVs still PendingScan after {self.scan_timeout}s: {sorted(pending)}. "
                        "Is ClamAV healthy and the worker running?"
                    )
                time.sleep(3)

    def complete_senior_profile(self, spec: dict[str, Any]) -> None:
        token = self.sign_in(spec["key"], "SENIOR")
        _check(
            self.http.put(
                "/me/senior-profile",
                headers=self.auth(token),
                json={
                    "full_name": spec["full_name"],
                    "company_affiliation": spec["company"],
                    "job_title": spec["job_title"],
                    "contact_channel_pref": "Email",
                    "contact_scope_pref": "OwnPostingsOnly",
                    "expertise_skills": spec["skills"],
                },
            ),
            f"senior profile of {spec['key']}",
        )

    def create_job(self, spec: dict[str, Any]) -> None:
        token = self.tokens[f"{spec['owner']}:SENIOR"]
        created = _check(
            self.http.post(
                "/jobs",
                headers=self.auth(token),
                json={
                    "title": spec["title"],
                    "company": spec["company"],
                    "location": spec["location"],
                    "work_model": spec["work_model"],
                    "employment_type": spec["employment_type"],
                    "experience_level": spec["experience_level"],
                    "description": spec["description"],
                    "application_channel": "Senior_Dashboard",
                    "required_skill_terms": spec["skills"],
                },
            ),
            f"job {spec['title']}",
        )
        _check(
            self.http.post(f"/jobs/{created['id']}:publish", headers=self.auth(token), json={}),
            f"publish {spec['title']}",
        )
        self.jobs[spec["title"]] = created["id"]

    def apply(self, key: str, title: str) -> None:
        _check(
            self.http.post(
                f"/jobs/{self.jobs[title]}/apply",
                headers=self.auth(self.tokens[f"{key}:CANDIDATE"]),
                json={"cv_variant_id": self.variants[key]},
            ),
            f"{key} applying to {title}",
        )

    def review(self) -> None:
        token = self.tokens[f"{REVIEW['reviewer']}:SENIOR"]
        technical, communication, culture, overall = REVIEW["ratings"]
        candidate_id = self.accounts[str(REVIEW["candidate"])]["id"]
        _check(
            self.http.post(
                f"/candidates/{candidate_id}/reviews",
                headers=self.auth(token),
                json={
                    "rating_technical": technical,
                    "rating_communication": communication,
                    "rating_culture_fit": culture,
                    "rating_overall": overall,
                    "assessment": REVIEW["assessment"],
                    "jd_id": self.jobs[str(REVIEW["job"])],
                },
            ),
            "review",
        )

    def spare_links(self) -> dict[str, str]:
        return {
            role: self.admin_post("/admin/registration-links", {"role": role}, f"spare {role}")[
                "token"
            ]
            for role in ("CANDIDATE", "SENIOR")
        }


def say(message: str) -> None:
    print(f"==> {message}", flush=True)


def write_summary(seeder: Seeder, links: dict[str, str]) -> Path:
    lines = [
        "# Demo accounts",
        "",
        f"Shared password: `{PASSWORD}`",
        "",
        "| Name | Email | Roles | State |",
        "| --- | --- | --- | --- |",
    ]
    dual = {spec["key"] for spec in SENIORS if spec.get("also_candidate")}
    for key, account in seeder.accounts.items():
        roles = account["role"] + (" + CANDIDATE" if key in dual else "")
        lines.append(f"| {account['name']} | {account['email']} | {roles} | {account['state']} |")
    lines += [
        "",
        "Admin: see `.dev-secrets/admin.env.sh` (E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD, "
        "E2E_ADMIN_TOTP_SECRET).",
        "",
        "Unused Registration_Links, for a live registration:",
        f"- Candidate: `{links['CANDIDATE']}`",
        f"- Senior: `{links['SENIOR']}`",
        "",
        "Jobs: " + ", ".join(seeder.jobs),
        "",
    ]
    SECRETS_DIR.mkdir(exist_ok=True)
    path = SECRETS_DIR / "demo-accounts.md"
    path.write_text("\n".join(lines), encoding="utf-8")
    return path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--api", default=os.environ.get("E2E_API_BASE_URL", DEFAULT_API))
    parser.add_argument(
        "--mailpit", default=os.environ.get("E2E_MAILPIT_BASE_URL", DEFAULT_MAILPIT)
    )
    parser.add_argument("--scan-timeout", type=int, default=240)
    args = parser.parse_args()

    if get_settings().is_production:
        sys.exit("refusing to seed demo data when APP_ENV=production")
    _load_admin_env()
    seeder = Seeder(args.api, args.mailpit, args.scan_timeout)

    try:
        seeder.sign_in_admin()
        probe = seeder.http.post(
            "/auth/login",
            json={
                "email": seeder.email(str(CANDIDATES[0]["key"])),
                "password": PASSWORD,
                "role": "CANDIDATE",
            },
        )
        if probe.is_success:
            sys.exit("demo accounts already exist; run scripts/wipe_dev_db.sh first")

        say("Registering, verifying and approving accounts")
        for spec in SENIORS:
            seeder.register(spec["key"], spec["full_name"], "SENIOR", "en", approve=True)
        for spec in CANDIDATES:
            seeder.register(
                spec["key"],
                spec["full_name"],
                "CANDIDATE",
                spec["language"],
                approve=spec["state"] != "pending",
            )

        say("Granting the Candidate role to the dual-role Senior")
        for spec in SENIORS:
            if spec.get("also_candidate"):
                _check(
                    seeder.http.put(
                        f"/admin/accounts/{seeder.accounts[spec['key']]['id']}/roles",
                        json={"roles": ["SENIOR", "CANDIDATE"]},
                        headers=seeder.auth(seeder.admin_token),
                    ),
                    f"roles of {spec['key']}",
                )

        say("Completing profiles and uploading CVs")
        for spec in SENIORS:
            seeder.complete_senior_profile(spec)
        complete = [spec for spec in CANDIDATES if spec["state"] == "complete"]
        for spec in complete:
            seeder.complete_candidate_profile(spec)
            seeder.upload_cv(spec["key"])

        say("Publishing jobs")
        for job in JOBS:
            seeder.create_job(job)

        say(f"Waiting for ClamAV to clear {len(complete)} CVs (up to {args.scan_timeout}s)")
        seeder.wait_for_cvs([spec["key"] for spec in complete])

        say("Applying and reviewing")
        for key, title in APPLICATIONS:
            seeder.apply(key, title)
        seeder.review()

        links = seeder.spare_links()
    except SeedError as error:
        sys.exit(f"seed failed: {error}")

    path = write_summary(seeder, links)
    say(
        f"Done: {len(seeder.accounts)} accounts, {len(seeder.jobs)} jobs, "
        f"{len(APPLICATIONS)} applications, 1 review. Summary: {path}"
    )


if __name__ == "__main__":
    main()
