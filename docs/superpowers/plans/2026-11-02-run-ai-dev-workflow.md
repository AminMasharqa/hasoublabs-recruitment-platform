# run-ai-dev-workflow Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a global Claude Code slash command `/run-ai-dev-workflow` that audits installed Claude capabilities, proposes any blocking config gaps, then chains brainstorming → plan → implement → verify using only existing proven skills.

**Architecture:** A single `SKILL.md` file at `~/.claude/skills/run-ai-dev-workflow/SKILL.md`. It uses the `!`command`` dynamic injection syntax to load project settings and CLAUDE.md at invocation time, so Phase 1 is pre-populated without extra tool calls. All phase logic is written as plain markdown instructions to Claude. Phases 4–8 delegate entirely to existing installed skills.

**Tech Stack:** Claude Code skill format (YAML frontmatter + markdown), `!`command`` dynamic context injection, existing skills: `superpowers:brainstorming`, `superpowers:writing-plans`, `superpowers:verification-before-completion`, `update-config`.

**Spec:** `docs/superpowers/specs/2026-11-02-run-ai-dev-workflow-design.md`

## Global Constraints

- Skill lives at `~/.claude/skills/run-ai-dev-workflow/SKILL.md` — global, not project-scoped.
- Skill file contains instructions for Claude only; no executable code.
- Phase 1–2 are read-only — no config changes before Phase 3 approval.
- Audit surfaces only blocking gaps (permission prompts, missing tools) — not every theoretical improvement.
- Phases 4–8 invoke existing skills via the `Skill` tool; no logic is duplicated from them.
- Fast path skips phases 4–5, keeps a lightweight Phase 6 gate; offered after Phase 1.
- Two approval checkpoints are intentional: brainstorming hard gate + Phase 6 plan gate.
- Interactive-only; no fallback for non-interactive invocation.

## Review Focus

- Phase 3 config gate: if the user approves some changes but rejects others, the skill must apply only the approved ones and still proceed — partial approval must not stall the workflow.
- Phase 6 fast-path gate: on the fast path, Phase 6 becomes "proceed?" not a full plan review — the skill must not ask for a full plan that doesn't exist.
- Skill invocation loop: invoking `superpowers:brainstorming` from inside this skill causes brainstorming's hard gate to block until its design doc is approved; Phase 6 must wait until after that gate clears, not before.
- Dynamic context injection: `!`cat CLAUDE.md`` runs relative to the working directory at invocation time — the skill must note this and not fail if CLAUDE.md is absent.
- Settings.json absent: both project and global settings files may not exist; the skill must handle missing files gracefully and treat absence as "no gaps from settings."

---

## File Structure

| Action | Path | Responsibility |
|--------|------|---------------|
| Create | `~/.claude/skills/run-ai-dev-workflow/SKILL.md` | The complete skill: frontmatter, dynamic context injection, all 8 phases |

---

### Task 1: Write the skill file

**Files:**
- Create: `~/.claude/skills/run-ai-dev-workflow/SKILL.md`

**Interfaces:**
- Produces: a global slash command `/run-ai-dev-workflow [task description]` recognized by Claude Code
- Consumes: existing skills `superpowers:brainstorming`, `superpowers:writing-plans`, `superpowers:verification-before-completion`, `update-config` (invoked via `Skill` tool at runtime, not imported)

- [ ] **Step 1: Create the skill directory**

```bash
mkdir -p ~/.claude/skills/run-ai-dev-workflow
```

Expected: directory exists at `~/.claude/skills/run-ai-dev-workflow/`

- [ ] **Step 2: Write `SKILL.md` with frontmatter and dynamic context**

File: `~/.claude/skills/run-ai-dev-workflow/SKILL.md`

Frontmatter (exact):
```yaml
---
name: run-ai-dev-workflow
description: "Entry point for every development task. Audits Claude capabilities against the task's needs, proposes blocking config gaps for approval, then chains brainstorming → plan → implement → verify using the best installed tools. Use when starting any meaningful development task: features, bug fixes, refactoring, architecture changes, UI/UX work, integrations."
argument-hint: <task description>
---
```

Dynamic context block (injected at invocation time — handles missing files gracefully):
```markdown
## Live Context (injected at invocation)

**Project settings:** !`cat .claude/settings.json 2>/dev/null || echo "(no project settings.json)"`

**Global settings:** !`cat ~/.claude/settings.json 2>/dev/null || echo "(no global settings.json)"`

**Project constraints (CLAUDE.md):** !`cat CLAUDE.md 2>/dev/null || echo "(no CLAUDE.md in working directory)"`
```

- [ ] **Step 3: Write Phase 0 — Initialization**

```markdown
## Phase 0 — Initialization

State the task as:
> **Task: Set Up the Best AI-Powered [task description from args]**

If no task description was provided in args, ask the user to describe the task in one sentence before continuing.
```

- [ ] **Step 4: Write Phase 1 — Capability Audit**

```markdown
## Phase 1 — Capability Audit (read-only)

The Live Context above is already injected. Now read the system-reminder in your current context and produce a brief inventory:

- **Skills available:** [list every skill named in the system-reminder]
- **Agent types available:** [list every agent type named in the system-reminder]
- **MCP servers available:** [list every MCP server named in the system-reminder]
- **Hooks configured:** [from injected settings.json files, or "none"]
- **Permission allowlists:** [from injected settings.json files, or "none"]
- **Project constraints:** [key rules from injected CLAUDE.md, or "none"]

Do not modify anything. Present the inventory to the user.

Then offer the fast path:
> "Is this task trivial enough to skip brainstorming and planning (phases 4–5) and go straight to implementation? Respond **fast** to skip, or anything else to continue the full workflow."
```

- [ ] **Step 5: Write Phase 2 — Gap Analysis**

```markdown
## Phase 2 — Gap Analysis

Using the inventory from Phase 1, identify ONLY gaps that would cause a blocking permission prompt or prevent a tool from being called mid-task:

- Missing permission allowlists for bash commands or file operations the task will likely need (e.g., `Bash(npm:*)`, `Bash(uv:*)`, `Bash(git commit:*)`)
- MCP servers or skills the task clearly requires that are absent from the system-reminder
- Hooks that would need to fire during this task but are not configured

Do NOT surface: every theoretical improvement, optional nice-to-haves, or capabilities the task doesn't need.

If no blocking gaps are found: state "No blocking gaps found — proceeding to Phase 4." Skip Phase 3.
```

- [ ] **Step 6: Write Phase 3 — Config Proposal**

```markdown
## Phase 3 — Config Proposal (only if Phase 2 found blocking gaps)

Present a prioritized list. For each gap:
- **What:** the specific change (e.g., "add `Bash(npm run:*)` to project allowlist")
- **Why:** which blocking issue it resolves
- **How:** use the `update-config` skill to apply it

Ask the user:
> **"Do you approve these configuration changes? You can approve all, approve specific items by number, or skip."**

Wait for explicit response. Apply only the approved items using the `update-config` skill. A partial approval is valid — apply what was approved and move on. Do not block on rejected items.
```

- [ ] **Step 7: Write Phase 4 — Task Understanding**

```markdown
## Phase 4 — Task Understanding

**Skip this phase if the user chose the fast path in Phase 1.**

Invoke the `superpowers:brainstorming` skill now. Follow it completely.

Its hard gate (design doc approval) must be satisfied before you continue to Phase 5. Do not proceed to Phase 5 until brainstorming's design doc has been approved by the user.
```

- [ ] **Step 8: Write Phase 5 — Implementation Plan**

```markdown
## Phase 5 — Implementation Plan

**Skip this phase if the user chose the fast path in Phase 1.**

Invoke the `superpowers:writing-plans` skill now. Use the design doc produced and approved in Phase 4 as the spec. Follow the writing-plans skill completely.
```

- [ ] **Step 9: Write Phase 6 — Approval Gate**

```markdown
## Phase 6 — Approval Gate

**If fast path:** Summarize in 3–5 bullet points what you plan to do, then ask:
> **"Proceed with implementation?"**

**If full path:** Present the implementation plan from Phase 5, then ask:
> **"Do you approve this implementation plan?"**

Wait for explicit approval in both cases. Until approved:
- Do not modify application source code
- Do not install new tools
- Read-only analysis is permitted
```

- [ ] **Step 10: Write Phase 7 — Autonomous Implementation**

```markdown
## Phase 7 — Autonomous Implementation

Execute the approved plan. Invoke skills using the `Skill` tool and specialized agents using the `Agent` tool. Choose the right skill for the task type:
- New features: consider `superpowers:test-driven-development`
- Bug fixes: consider `superpowers:systematic-debugging`
- Parallel independent work: consider `superpowers:dispatching-parallel-agents`
- Code review mid-implementation: consider `code-review`

Request additional approval ONLY for:
- Significant scope changes (more than ~20% beyond what was approved)
- Destructive or irreversible operations (deleting files/branches, dropping tables, force pushes)
- Production infrastructure or data changes
- Deployment
- Installing new external tools or services not already present

Do not stop to ask permission for normal implementation steps.
```

- [ ] **Step 11: Write Phase 8 — Verification**

```markdown
## Phase 8 — Verification

Invoke `superpowers:verification-before-completion`.

Additionally, run the relevant checks for this project type. For this repo (HasoubLabs):
- **Backend:** `cd backend && uv run ruff check . && uv run ruff format . && uv run mypy app/ && uv run pytest tests/unit`
- **Frontend:** `cd frontend && npm run typecheck && npm run lint && npm run test && npm run build`

Produce a final report:
- **Changes made:** summary of what was implemented
- **Files modified:** list with brief description of each change
- **Tests run:** commands executed and pass/fail results
- **Remaining issues:** known limitations, follow-up items, or open questions
```

- [ ] **Step 12: Verify the skill file is well-formed**

```bash
ls -la ~/.claude/skills/run-ai-dev-workflow/
```

Expected: `SKILL.md` present and non-empty.

```bash
head -10 ~/.claude/skills/run-ai-dev-workflow/SKILL.md
```

Expected: YAML frontmatter block starting with `---` and containing `name: run-ai-dev-workflow`.

- [ ] **Step 13: Commit the design doc and plan**

```bash
git add docs/superpowers/
git commit -m "docs: add run-ai-dev-workflow design doc and implementation plan"
```

---

### Task 2: Smoke-test the skill

**Files:**
- Read: `~/.claude/skills/run-ai-dev-workflow/SKILL.md` (verify readable)

**Interfaces:**
- Consumes: the skill file from Task 1

- [ ] **Step 1: Verify skill is listed in Claude Code**

In the next conversation turn, type `/run-ai-dev-workflow` with no args and confirm Claude recognizes it as a skill and asks for a task description (Phase 0 behavior).

- [ ] **Step 2: Verify Phase 1 output**

Invoke: `/run-ai-dev-workflow add a test button to the UI`

Expected: Claude prints the inventory (skills, agents, MCP servers, hooks, permissions, CLAUDE.md constraints) and offers the fast path prompt.

- [ ] **Step 3: Verify Phase 2 + Phase 3 fast-exit**

On a project with no blocking gaps, confirm Phase 2 states "No blocking gaps found" and Phase 3 is skipped.

- [ ] **Step 4: Verify approval gate holds**

On the full path, confirm no file edits occur before the user responds "Do you approve this implementation plan?" in Phase 6.
