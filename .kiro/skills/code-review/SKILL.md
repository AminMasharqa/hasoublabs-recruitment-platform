---
name: code-review
description: Review the current portfolio diff for correctness, regressions, maintainability, accessibility implementation, and unnecessary complexity without editing.
---

# Code Review

1. Run `node .kiro/skills/code-review/scripts/collect-diff.mjs`.
2. Read the current diff and relevant surrounding code.
3. Apply `references/review-checklist.md`.
4. Prioritize reproducible defects over style opinions.
5. Complete `templates/code-review.md`.

For each finding include severity, file, evidence, failure scenario, and smallest correction. State when no material issue was found; do not claim the code is universally safe.
