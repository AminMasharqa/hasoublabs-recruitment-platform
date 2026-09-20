---
name: recruiter-review
description: Review portfolio content as a technical recruiter, testing clarity, credibility, project evidence, role fit, and contact friction while preventing invented claims.
---

# Recruiter Portfolio Review

1. Run `node .kiro/skills/recruiter-review/scripts/scan-claims.mjs` as a prompt for manual verification.
2. Perform a 30-second scan: identity, role, proof, projects, action.
3. Perform a three-minute scan using `references/recruiter-rubric.md`.
4. Apply the integrity rules in `references/content-integrity.md`.
5. Complete `templates/recruiter-report.md`.

The script flags candidate claims; it does not decide whether they are true. Ask the candidate for evidence.
