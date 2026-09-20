---
name: security-review
description: Perform a read-only frontend security and privacy review of a portfolio site and current diff, supported by a local static scanner.
---

# Security and Privacy Review

1. Run `node .kiro/skills/security-review/scripts/scan-static-site.mjs`.
2. Manually inspect each scanner hit; regex output is not a confirmed vulnerability.
3. Apply `references/frontend-threat-model.md`.
4. Review the diff for new dependencies, scripts, network calls, analytics, and personal data.
5. Report with `templates/security-report.md`.

Never output a discovered secret value. Report only category, file, line, and safe remediation.
