---
name: github-publishing
description: Safely prepare and publish a verified local portfolio to a candidate-owned GitHub repository, with privacy checks, explicit mutation approvals, README guidance, and publication evidence.
---

# GitHub Portfolio Publishing

## Entry conditions

- Local build and browser QA are complete.
- Security review found no unresolved high-risk issue.
- Candidate owns the GitHub account and approves publication.
- Repository name, description, and visibility are explicit.

## Procedure

1. Run `node .kiro/skills/github-publishing/scripts/publish-preflight.mjs`.
2. Apply `references/publication-checklist.md` and resolve every blocker.
3. Draft or review `README.md` using `templates/portfolio-readme.md`.
4. Show the candidate the exact GitHub owner, repository name, description, and visibility.
5. Ask for explicit approval before calling a GitHub write tool.
6. Create the repository through GitHub MCP. Prefer private visibility when the candidate has not chosen.
7. Publish the local Git history only after a second explicit approval. Never force-push.
8. Optionally create one issue named `Portfolio improvement backlog` from known gaps.
9. Verify repository URL, visibility, default branch, README rendering, and absence of sensitive files.
10. Complete `templates/publication-report.md`.

## Profile README

Treat the candidate's profile repository (`username/username`) as a separate task. Inspect it first and ask for separate approval before creating or changing it.
