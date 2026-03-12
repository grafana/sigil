---
name: ui-proof
description: Capture feature-level UI proof for UI/UX-facing or app-touching tickets, save multiple screenshots or short recordings under output/playwright, and attach the evidence to the Linear workpad comment.
---

# UI Proof

Use this for UI/UX-facing or app-touching tickets when the worker needs to
prove the changed feature actually works in the running Sigil UI or when visual
evidence materially improves the handoff.

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
5. Upload the artifacts to Linear.
   Preferred unattended path: use the `linear_graphql` tool, request a
   `fileUpload`, `PUT` the bytes to the returned `uploadUrl`, then embed the
   `assetUrl` in the workpad as markdown.
   ```graphql
   mutation FileUpload($filename: String!, $contentType: String!, $size: Int!) {
     fileUpload(filename: $filename, contentType: $contentType, size: $size, makePublic: true) {
       success
       uploadFile {
         uploadUrl
         assetUrl
         headers { key value }
       }
     }
   }
   ```
   Use the repo-local script only as a fallback when env-based Linear auth is
   already available:
   ```bash
   pnpm --dir apps/plugin exec node ./scripts/upload-linear-assets.mjs output/playwright/<file>...
   ```
6. Embed the uploaded markdown image links into the Linear workpad comment.
   Keep the proof grouped in a short `## UI Proof` section with one caption per
   image.
7. If a GitHub PR already exists for the branch, mirror the same proof in the
   PR body or a top-level PR comment so reviewers do not have to switch back to
   Linear to see the screenshots.

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
- the uploaded image markdown or direct `assetUrl` embeds
- any limitation or missing runtime condition

If a PR exists, include at least one of the same screenshots in the PR body or
top-level PR comments as reviewer-facing evidence.

Do not leave the proof only on disk. The evidence must be embedded in the
Linear workpad comment before moving the ticket to `Human Review`.
