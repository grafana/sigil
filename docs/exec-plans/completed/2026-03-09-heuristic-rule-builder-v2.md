---
owner: sigil-core
status: completed
last_reviewed: 2026-03-09
source_of_truth: true
audience: both
---

# Execution Plan: Heuristic Rule Builder v2

## Goal

Replace the rigid flat heuristic evaluator config with a versioned rule tree, and replace the clunky custom frontend editor with a more reliable builder UI.

## Scope

- versioned heuristic config AST in backend and plugin types
- recursive control-layer validation for heuristic configs
- recursive runtime evaluation for nested `and` / `or` groups
- predefined heuristic template migration to the new config shape
- plugin rule-builder UX replacement using `react-querybuilder`
- stories, docs, seeds, and regression test updates

## Checklist

- [x] Add shared heuristic config types and parsing in `sigil/internal/eval/heuristic_config.go`.
- [x] Enforce heuristic config validation through the API/control boundary.
- [x] Replace flat heuristic runtime logic with recursive rule-tree evaluation.
- [x] Migrate predefined heuristic templates to the v2 config shape.
- [x] Update seed loading to support nested `config.version` without colliding with evaluator version.
- [x] Replace the custom heuristic UI with a `react-querybuilder`-based builder.
- [x] Add frontend adapters between querybuilder state and the heuristic config AST.
- [x] Update evaluator/template/publish flows to serialize and validate the new heuristic config.
- [x] Update summaries, stories, examples, and user docs for the new rule-tree model.
- [x] Add regression tests for backend parsing/evaluation and the new frontend builder/validation path.
- [x] Verify with `mise run format`, `mise run lint`, `mise run check`, targeted Jest coverage, and Go coverage for `sigil/internal/eval/...`.

## Result

- Heuristic configs now use an explicit `version: "v2"` rule tree with nested groups and typed leaf rules.
- Validation lives at the API boundary; runtime evaluation assumes already-valid config and only executes the tree.
- The plugin no longer owns a fragile custom recursive editor for heuristics; it uses a stable nested builder with clearer add/remove/group behavior.
- Predefined templates, summaries, stories, docs, and seed examples now match the new heuristic model.
