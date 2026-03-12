---
name: ui-proof
description: Capture feature-level UI proof for app-touching tickets, save multiple screenshots or short recordings under output/playwright, and attach the evidence to the Linear workpad comment.
---

# UI Proof

Use this for app-touching tickets when the worker needs to prove the changed
feature actually works in the running Sigil UI.

Do not stop at a smoke screenshot. Capture the changed user flow.

## Goal

Produce visual proof that matches the ticketed feature:

- entry state
- changed interaction
- resulting state

Use as many screenshots as needed to make the flow legible. One image is rarely
enough for a non-trivial interaction.

## Workflow

1. Start with the `launch-app` skill to reuse or start the worktree-safe stack.
2. If the page needs data, start `mise run up:worktree:traffic-lite`.
3. Decide the proof path from the ticket, changed files, and acceptance
   criteria. Capture the exact feature path you changed, not a generic page.
4. Save artifacts under `output/playwright/`. Use names that describe the step:
   - `output/playwright/<ticket>-entry.png`
   - `output/playwright/<ticket>-filters-open.png`
   - `output/playwright/<ticket>-result.png`
5. Upload the artifacts with:
   ```bash
   pnpm --dir apps/plugin exec node ./scripts/upload-linear-assets.mjs output/playwright/<file>...
   ```
6. Embed the returned markdown image links into the Linear workpad comment.
   Keep the proof grouped in a short `## UI Proof` section with one caption per
   image.

## Browser execution

Prefer real browser automation so you can inspect the rendered result before
handoff.

- If browser tools are available in the session, use them interactively to
  navigate the changed flow and capture screenshots at the right moments.
- If you need an authenticated Playwright session, bootstrap it with:
  ```bash
  pnpm --dir apps/plugin exec node ./scripts/ensure-grafana-auth.mjs
  ```
  This writes `apps/plugin/playwright/.auth/admin.json`.
- Use `apps/plugin/scripts/capture-ui-proof.mjs` only as a smoke-check example,
  not as the default proof path for every ticket.

## Proof bar

- Show the feature state that changed, not just that Grafana loaded.
- If a click or form interaction matters, capture before and after.
- If the worker is unsure whether the UI matches expectations, inspect the
  screenshots before handoff and record the uncertainty in the workpad.
- If the feature spans several screens, upload several screenshots.
- Prefer screenshots over video by default. Use video only when motion or timing
  is the behavior under test.

## Linear handoff

The final workpad should include:

- brief description of the validated flow
- the image markdown returned by `upload-linear-assets.mjs`
- any limitation or missing runtime condition

Do not leave the proof only on disk. The evidence must be embedded in the
Linear workpad comment before moving the ticket to `Human Review`.
