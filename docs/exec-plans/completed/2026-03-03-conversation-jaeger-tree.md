---
owner: sigil-core
status: completed
last_reviewed: 2026-03-03
source_of_truth: true
audience: both
---

# Conversation Details: Jaeger-Style Tree Port

## Goal

Replace the conversation details span tree with the Grafana/Jaeger-style tree behavior and visuals while keeping the data flow and selection semantics unchanged.

## Scope

- Replace `SigilSpanTree` rendering in conversation details.
- Keep the existing conversation filters/search and span selection URL behavior.
- Add plugin-owned customization hooks for future per-node rendering.

## Decisions Locked In Implementation

- Use a local plugin implementation (no Grafana internal deep-imports).
- Keep tree replacement scoped to conversation details only.
- Use virtualized row rendering with fixed row height.
- Keep `onSelectSpan` and `selectedSpanSelectionID` contract unchanged.
- Expose `renderNode` callback for custom node content.

## Checklist

- [x] Add local tree adapter for flattening and Jaeger-like row metadata.
- [x] Add collapse/expand parity helpers (`expand +1`, `collapse +1`, `expand all`, `collapse all`).
- [x] Replace `SigilSpanTree` UI with Jaeger-style header + tree rows + virtualization.
- [x] Add `renderNode` customization API and exported render context type.
- [x] Add regression tests for adapter/collapse behavior.
- [x] Update `SigilSpanTree` tests for new default-expanded behavior and controls.
- [x] Update Storybook stories with default + custom renderer variants.
- [x] Update frontend documentation to capture new tree component responsibilities.

## Validation

- `cd apps/plugin && pnpm test:ci -- SigilSpanTree.test.tsx ConversationGenerations.test.tsx jaegerTree/adapter.test.ts jaegerTree/collapseState.test.ts`
- `cd apps/plugin && pnpm typecheck`
- `cd apps/plugin && pnpm lint`

## Notes

- No design doc was added for this change because it is a direct UI implementation update within an existing architecture boundary.
