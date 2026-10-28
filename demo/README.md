# Demo guide

How to bring the platform up with demo data, and the flows to present, in order.
The flows follow the end-to-end journeys in `frontend/e2e/journeys/`, so each one
is covered by a passing test.

## 1. Prepare the environment

1. Start **Docker Desktop** and wait until the engine is running. `dev.sh` checks
   this and stops with "Docker is not running" otherwise.
2. From the repo root, in **Git Bash**:

   ```bash
   # Clean database + Admin + demo data (first time, or to reset before a demo).
   # The wipe drops the database, so stop dev.sh (Ctrl+C) first so the API and
   # worker aren't connected to it. Leave Docker running.
   backend/scripts/wipe_dev_db.sh --yes
   ./dev.sh --seed-admin --seed-demo

   # The demo data is already there: just start everything
   ./dev.sh
   ```

   The first run builds MinIO and waits for ClamAV, which takes a few minutes.
   Logs are in `.dev-logs/`. Ctrl+C stops the API, worker and web app, but the
   Docker containers keep running (`docker compose down` from `backend/` stops them).
3. Check that everything answers:

   | What | URL |
   | --- | --- |
   | Web app | http://localhost:5173 |
   | API docs | http://127.0.0.1:8000/api/docs |
   | Mailpit (all outgoing email, e.g. verification codes) | http://localhost:8025 |

### Accounts

- **Demo accounts:** listed in `.dev-secrets/demo-accounts.md`, with the shared
  password. On the login screen, pick the role you are logging in as.
- **Admin:** credentials in `.dev-secrets/admin.env.sh` (or `.ps1`). Admin login
  also asks for an MFA code: add the URI in `.dev-secrets/admin-mfa-uri.txt` to an
  authenticator app (most apps accept it pasted in, or turn it into a QR code).
  Every `--seed-admin` run creates a new secret, so remove the old authenticator
  entry and add the new one.

| Account | Roles | Used in |
| --- | --- | --- |
| Admin | ADMIN | Flows 1, 2, 6, 8, 9 |
| Omar Nasser | Candidate, awaiting approval | Flow 2 |
| Maya Saleh | Candidate, empty profile | Flow 3 |
| Layla Haddad (ليلى حداد), Daniel Cohen, Yael Avraham (יעל אברהם) | Candidates with a complete profile and a CV | Flows 4, 5 |
| Sara Levi, Khaled Mansour | Senior | Flow 6 |
| Nour Aziz | Senior + Candidate | Flow 7 |

`.dev-secrets/` is gitignored. Never commit it or show its contents on screen.

## 2. Demo flows

### Flow 1: Registration and verification

*Log in as the Admin, then use a private browser window for the new user.*

1. As Admin, create a **Registration_Link** for the Candidate role. The token is
   shown only once, as text you can copy.
   You can also use one of the unused links in `.dev-secrets/demo-accounts.md`.
2. Open the link in a private window. The form has the role already fixed.
   Register; the account is now waiting for verification.
3. Open Mailpit, copy the code and enter it. A wrong code keeps the form filled
   in (repeated wrong codes lock code entry).
4. After verification, the user sees only a **status notice**, not the app's
   screens, until an Admin approves the account.

**Point to make:** nobody can register without an invitation link, and new
accounts can't do anything until an Admin approves them.

### Flow 2: Admin approval and account control

*Log in as the Admin.*

1. Open the accounts list and approve **Omar Nasser** (or the account from Flow 1).
2. Suspend an approved account. The dialog asks for confirmation and a reason.

### Flow 3: Candidate profile completion

*Log in as **Maya Saleh** (Candidate).*

1. Her profile starts as **Draft**.
2. Fill in the core fields and save; it becomes **Complete**.
3. Enter an invalid value (e.g. a malformed phone number) and save. The error
   appears on that field, and the other values you typed are kept.

**Phone numbers:** use international format with a real number range, e.g.
`+972502345678`. Numbers like `+972501234570` are in an unallocated range and are
rejected.

**Skills:** enter skills in English. A skill that isn't in the skills list is
kept but shown as *pending*, and there is no Admin screen yet that resolves it.
Skills typed in Arabic or Hebrew are also treated as pending.

### Flow 4: CV upload

*Log in as any Candidate.*

1. Upload a PDF CV. It first shows as waiting for the virus scan, and its download
   button is disabled with the reason shown.
2. A few seconds later (ClamAV scans it in the background worker) it becomes
   **Available** and downloads under its original filename.

**Point to make:** files are encrypted at rest and quarantined until scanned.

### Flow 5: Jobs and applications

*Log in as **Layla**, **Daniel** or **Yael** (Candidates).*

1. Browse the open jobs and search or filter them.
2. Open a job and apply. The application appears in "my applications".
3. A closed job is marked as closed in the list and in its details, and can't be
   applied to.

### Flow 6: Reviews

A Review is a Senior's structured assessment of a **Candidate** (not of an
application): four ratings from 1 to 5 (Technical ability, Communication, Culture
fit, Overall impression), a written assessment of 1 to 2000 characters, and an
optional link to a job. Reviews are append-only.

**Before the demo: get the Candidate IDs.** The review screens ask for the
Candidate's account ID, and no screen shows it yet (the applicant list shows only
name, role and status). The IDs change on every wipe, so print them from Git Bash:

```bash
docker exec hasoub-postgres psql -U hasoub -d hasoub_db -c \
  "select email, id from accounts where email like 'demo-%' order by email;"
docker exec hasoub-postgres psql -U hasoub -d hasoub_db -c \
  "select title, id from job_descriptions order by title;"
```

The demo data already has one Review: **Khaled → Layla** (4/5/4/4, linked to
*QA Automation Engineer*).

*Log in as **Khaled Mansour** (Senior).*

1. Open **Reviews** in the menu ("My reviews"). Paste **Layla's** ID and click
   **Show reviews**. His existing Review is shown as review 1.
2. Click **Add a review**. Enter four ratings, an assessment, and optionally the
   job ID. Click **Submit review**; it appears on the timeline, oldest first.
   - To show validation: enter `6` as a rating, or leave the assessment empty.
     The error appears on that field and the other values are kept.
3. On a Review card, note there is **no Edit or Delete** button. Click
   **Submit a correction**. The form opens pre-filled with the original values;
   change the assessment and submit.
4. The timeline now shows both: the original marked *Corrected by review N*, and
   the new one marked *Correction* / *Corrects review N*. The original stays.

*Log in as **Sara Levi** (Senior)*, open **Reviews** and paste **Layla's** ID.
Sara sees **none** of Khaled's Reviews: a Senior sees only the Reviews they wrote.

*Log in as the Admin*, open **Reviews** and paste **Layla's** ID. The Admin sees
**every** Review of Layla, from all Seniors, and can filter by reviewer, job and
date range.

**Points to make:**
- Reviews can't be changed after submission, enforced three times: the UI has no
  control for it, the API has no endpoint for it, and a database trigger rejects
  any `UPDATE` or `DELETE` on the `reviews` table.
- A correction can only correct your own Review of the same Candidate.
- Seniors see only their own Reviews; only Admins see the full picture.
- Every Review is in the audit log (Flow 8).

### Flow 7: Switching context

*Log in as **Nour Aziz** (Senior + Candidate).*

1. Switch from the Senior context to the Candidate context. The menu and landing
   page change, and the session is replaced.
2. Admins don't get this control: the Admin role can't be combined with others.

### Flow 8: Audit log

*Log in as the Admin.*

1. Open the audit log and find the approval from Flow 2, with who did it, when,
   and which fields changed.
2. Click **Verify chain**. Every entry is hash-chained to the one before it, and
   the check reports `ok` (or the first entry that was tampered with).

**Point to make:** every change in the system is recorded in the same
transaction as the change itself, and sensitive values are redacted.

### Flow 9: Reports and Excel export

*Log in as the Admin.*

1. Open the activity report.
2. Start an export. It's produced by the background worker and becomes a
   downloadable Excel workbook.
3. Reports and exports aren't visible to anyone but Admins.

### Flow 10: Languages and right-to-left

*Any account.*

1. Switch between **Arabic**, **Hebrew** and **English** in the header. Arabic and
   Hebrew lay the whole app out right-to-left.
2. Names entered in Arabic and Hebrew (Layla, Yael) show exactly as they were typed.

## 3. Troubleshooting during the demo

| Symptom | Fix |
| --- | --- |
| `dev.sh` says Docker is not running | Start Docker Desktop and run it again. |
| Admin MFA code is refused | The authenticator entry is from an older seed. Re-add the URI from `.dev-secrets/admin-mfa-uri.txt`. |
| Admin login fails after Docker was restarted | OpenBao keeps nothing across restarts, so the stored MFA secret can't be decrypted. Run `./dev.sh --seed-admin` and re-add the URI. |
| No verification email | The worker isn't running. Check `.dev-logs/worker.log`. |
| A CV stays "waiting for scan" | ClamAV is still starting (about 2 minutes after the container starts), or the worker is down. Check `docker ps` and `.dev-logs/worker.log`. |
| An error shows a reference number | That's the request ID. Search for it in `.dev-logs/api.log`. |
| `--seed-demo` refuses to run | The demo accounts already exist. For fresh data, stop `dev.sh`, run `backend/scripts/wipe_dev_db.sh --yes`, then `./dev.sh --seed-admin --seed-demo`. |

Known open issues are tracked in
`frontend/.kiro/specs/frontend-web-application/TASK-28-BLOCKERS.md`. Read it before
a demo.
