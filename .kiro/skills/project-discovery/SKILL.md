---
name: project-discovery
description: Establish a read-only baseline for an unfamiliar portfolio project. Use before planning or editing to identify its stack, commands, entry files, repository state, and constraints.
---

# Project Discovery

## Procedure

1. Run `node .kiro/skills/project-discovery/scripts/detect-project.mjs`.
2. Read the manifest, README, entry page, global styles, routing, and content sources it identifies.
3. Record the current Git state without changing it.
4. Identify how the site starts, builds, lints, and tests from existing scripts only.
5. Separate observed facts, inferences, and questions.
6. Save the result using `templates/baseline-report.md`.

Do not install dependencies, start a deployment, or rewrite the project during discovery.

## Stop conditions

Stop and ask when the project contains multiple apps, the active entry point is unclear, or secrets appear required.
