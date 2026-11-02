# Design: `/run-ai-dev-workflow` Global Slash Command

**Date:** 2026-11-02  
**Status:** Draft — pending user approval

---

## Intent and Why

A global Claude Code slash command that acts as the single entry point for every meaningful development task. Before any planning or code changes, it inventories the Claude environment (installed skills, agents, MCP servers, hooks, permissions) against what the task actually needs, proposes any configuration gaps for explicit approval, then executes the standard plan → approve → implement → verify cycle using the best already-installed tools.

The problem it solves: developers currently discover missing capabilities mid-task (wrong permissions, missing skills, unhelpful hooks), which causes interruptions and scope drift. This skill front-loads that discovery so the right tools are wired up before work begins.

---

## Goals

- Make `/run-ai-dev-workflow <task>` the single triggerable entry point for every development task (features, fixes, refactors, architecture changes, UI/UX work, integrations).
- Audit installed Claude capabilities against the task's needs before any planning starts.
- Propose Claude configuration changes (settings.json, skills, MCP, hooks) when gaps are found — prefer ready-made, secure, already-proven tools; never propose building custom ones.
- Two approval checkpoints: brainstorming's design-doc gate + Phase 6 implementation plan gate (both intentional — option A).
- Reuse and orchestrate existing installed skills rather than duplicating their logic.

## Non-goals

- Creating new custom skills, agents, MCP servers, or plugins as part of the workflow.
- Running automatically without explicit invocation (`/run-ai-dev-workflow`).
- Replacing individual skills (brainstorming, writing-plans, etc.) — it chains them.
- Handling deployment or production infrastructure changes.

## Anti-goals

- A workflow that asks for permission at every step mid-implementation.
- A workflow that invents capabilities it doesn't have or skips the approval gate.
- A workflow that installs new tools without the user's explicit consent.

---

## Constraints

- Must live at `~/.claude/skills/run-ai-dev-workflow.md` (global, not project-scoped).
- The capability audit is read-only — no config changes until the user explicitly approves them.
- The skill file is a markdown document with YAML frontmatter; it contains instructions for Claude, not executable code.
- Can only audit tools visible in the system-reminder at runtime; must not hardcode tool names.
- Prefers `update-config` (already installed) for all settings.json and hook changes.
- Interactive-only: this skill is for use in active chat sessions, not agent-to-agent or hook invocation.
- Two approval checkpoints are intentional: brainstorming design-doc approval + Phase 6 plan approval (option A, user-chosen).
- Additional approval only for destructive/irreversible ops, deployment, or scope changes mid-implementation.

---

## Approach

**Selected: Approach A — single global skill file at `~/.claude/skills/run-ai-dev-workflow.md`.**

Alternatives considered:
- Project-level `.claude/skills/` — rejected: the workflow applies universally, not to one repo.
- Global base + project override — rejected: adds complexity not yet needed; can be layered later.

The skill is a set of ordered phases written as instructions to Claude:

### Phase 0 — Initialization
Frame the task: `Task: Set Up the Best AI-Powered <task description>`.

### Phase 1 — Capability Audit (read-only)
Read the current system-reminder to list all available skills, agent types, and MCP servers. Read `.claude/settings.json` (project) and `~/.claude/settings.json` (global) for hooks, permission allowlists, and env vars. Do not modify anything.

### Phase 2 — Gap Analysis
Map the task's likely needs against available capabilities. Surface only gaps that would cause a blocking permission prompt or prevent a tool from being called mid-task. Identify:
- Missing permission allowlists that would generate repeated approval prompts during implementation.
- Missing or misconfigured hooks that would need to fire during the task.
- MCP servers or skills referenced by the plan that are not present in the system-reminder.
- Capabilities the task clearly requires that have no installed equivalent.

Do not surface every theoretical improvement — only blocking gaps.

### Phase 3 — Config Proposal (only if gaps exist)
Present a prioritized list of proposed configuration changes. Each entry states: what, why, which ready-made tool applies (prefer `update-config` skill), and estimated impact. Ask: **"Do you approve these configuration changes?"** Apply only approved changes using `update-config`. Skip this phase entirely if no gaps.

### Phase 4 — Task Understanding
Invoke `superpowers:brainstorming` to understand requirements, inspect the codebase, identify affected files, dependencies, risks, and constraints. No application code changes during this phase.

### Phase 5 — Consolidated Plan
Invoke `superpowers:writing-plans` to produce one complete implementation plan covering: requirements, affected components, selected skills/agents/tools, technical approach, implementation steps, risks, and test strategy.

### Phase 6 — Single Approval Gate
Present the plan. Ask: **"Do you approve this implementation plan?"** Wait for explicit approval. Until approved: no application code changes, no new tool installs.

### Phase 7 — Autonomous Implementation
Execute the approved plan. Use the `Skill` tool to invoke named skills (e.g., `superpowers:test-driven-development`, `code-review`, `run`). Invoke agents via the `Agent` tool. Request additional approval only for: significant scope changes, destructive/irreversible ops, production infrastructure, deployment, new external tool installs.

### Phase 8 — Verification
Invoke `superpowers:verification-before-completion`. Run tests, linting, type checks. Check for regressions. For frontend tasks, validate in browser. Produce a final report: changes made, files modified, test results, remaining issues.

---

## Fast Path (builder's call)

For trivial changes (a one-liner, a config tweak, a rename) where brainstorming and full planning would be pure overhead, the skill offers to skip phases 4–5 after Phase 1 completes (capability audit done, so the user has full information before deciding). Phase 6 is kept even on the fast path — it becomes a lightweight "proceed?" rather than a full plan review. The user opts in explicitly; the skill never auto-detects "trivial."

---

## Files to Create

| File | Purpose |
|------|---------|
| `~/.claude/skills/run-ai-dev-workflow.md` | The global slash command skill |

No project files are created. The design doc lives in `docs/superpowers/specs/` but is not part of the skill itself.

---

## Risks and Side Effects

| Risk | Mitigation |
|------|-----------|
| Skills in system-reminder vary per project/session | Audit reads the live system-reminder; no hardcoded tool list |
| `update-config` modifies settings.json | Only runs after explicit user approval in Phase 3 |
| Phase chaining adds friction for trivial tasks | Fast path option in Phase 4 |
| User approves plan then task scope grows | Re-approval required for significant scope changes (enforced in Phase 7) |

---

## Testing and Verification

1. Invoke `/run-ai-dev-workflow add a login button to the UI` — verify all 8 phases run in order.
2. Invoke with a task that has no capability gaps — verify Phase 3 is skipped cleanly.
3. Invoke with a task that needs a missing permission — verify Phase 3 surfaces the gap and waits for approval before touching settings.json.
4. Verify no application code changes occur before Phase 6 approval.
5. Verify fast path offer appears for a trivial task.

---

## Resolved Builder Calls

| Question | Decision |
|----------|----------|
| Auto-detect "trivial" tasks or always ask? | Always ask — never auto-skip. |
| Should Phase 1 read CLAUDE.md? | Yes — always read CLAUDE.md as part of the audit for project-specific constraints. |
| How does Phase 7 invoke other skills/agents? | Via the `Skill` tool for named skills; `Agent` tool for specialized agents. |
| Approval model for non-interactive use? | Skill is interactive-only; no fallback needed. |
| Audit threshold: what counts as a gap? | Only blocking gaps (would cause a prompt or prevent a tool call); not every theoretical improvement. |
| Double approval: brainstorming gate + Phase 6? | Both kept — option A, user-chosen. |
