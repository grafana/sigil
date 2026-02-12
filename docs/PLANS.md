---
owner: sigil-core
status: active
last_reviewed: 2026-02-12
source_of_truth: true
audience: agents
---

# Plans

Purpose: central entrypoint for active work, completed plans, and debt tracking.

Execution plan paths are cataloged in `docs/index.md`.

## Planning Rules

- Use `YYYY-MM-DD-<slug>.md` naming.
- Every execution plan must include: Goal, Scope, Tasks, Risks, Exit Criteria.

## Manual Governance (Current Phase)

- No automated docs CI checks in this phase.
- Review active plans and tech debt tracker at least once per sprint.
- Update `last_reviewed` in modified docs during pull requests.
- Keep `AGENTS.md` Docs Map synchronized with any docs move or rename.
- Keep Phase 2 implementation order aligned with SDK-first execution (Python parity before non-SDK tracks after TypeScript/JavaScript completion).
