---
name: browser-qa
description: Verify a local portfolio through Playwright at desktop, tablet, and mobile viewports with keyboard, navigation, overflow, console, and reduced-motion evidence.
---

# Browser QA

## Inputs

- Local URL
- Approved requirement IDs
- Expected primary links and interaction outcomes

## Procedure

Use `references/viewport-matrix.md` and `references/accessibility-checklist.md`. Start from a clean browser context. At every viewport, record the primary message, overflow, navigation, project content, and console errors. Use keyboard-only navigation. Test reduced motion if animations exist. Capture screenshots only to prove a visible result.

Complete `templates/qa-report.md`. Use only `Pass`, `Fail`, or `Blocked`, and never fix code during review.
