---
owner: sigil-core
status: completed
last_reviewed: 2026-03-07
source_of_truth: true
audience: both
---

# Execution Plan: LLM Judge Prompt Context Refresh

## Goal

Replace the old lossy `{{input}}` / `{{output}}` prompt surface for `llm_judge` with developer-facing variables derived from Sigil's typed generation telemetry, while keeping prompt authoring simple and frontend rendering consistent.

## Scope

- backend `llm_judge` variable resolution and rendering
- predefined LLM-judge template prompts
- evaluation UI prompt help, summaries, and detail views
- documentation for variable semantics and rendering rules
- regression tests for backend rendering and frontend fallback behavior

## Checklist

- [x] Redefine the default `llm_judge` prompt surface around typed generation-derived variables.
- [x] Add developer-facing primary variables:
  - [x] `latest_user_message`
  - [x] `user_history`
  - [x] `assistant_response`
  - [x] `assistant_thinking`
  - [x] `assistant_sequence`
  - [x] `tool_calls`
  - [x] `tool_results`
  - [x] `tools`
  - [x] `stop_reason`
  - [x] `call_error`
- [x] Keep compatibility aliases:
  - [x] `input` -> `latest_user_message`
  - [x] `output` -> `assistant_response`
  - [x] `error` -> `call_error`
- [x] Render simple variables as plain text and structured variables as compact tagged fragments with stable ordering.
- [x] Render empty variables as empty strings instead of empty wrapper tags or sentinel text.
- [x] Preserve ordered assistant output blocks for mixed-block providers through `assistant_sequence`.
- [x] Update predefined templates to use explicit metric-specific `system_prompt` values and richer `user_prompt` context where needed.
- [x] Align frontend prompt forms and summary/detail views on shared default-prompt fallback behavior.
- [x] Refresh Storybook examples to match the new prompt wording and variable model.
- [x] Add regression tests for backend prompt rendering, predefined templates, frontend default prompt fallback, and prompt editor examples.
- [x] Update architecture/design/reference/frontend docs.

## Decisions Applied

- `input` and `output` remain supported, but now alias to `latest_user_message` and `assistant_response`.
- Hidden reasoning stays separate from user-visible assistant text.
- Structured prompt context uses tagged plain text, not raw JSON, as the default rendering format.
- Advanced prompt targeting is handled by built-in variables, not a template-side query DSL.
- `tools` stays supported as a compact inventory because tool availability is part of many production evaluator prompts.

## Verification

- `go test ./sigil/internal/eval/evaluators ./sigil/internal/eval/predefined`
- `pnpm --filter @grafana/sigil-plugin exec jest src/evaluation/types.test.ts src/components/evaluation/PromptTemplateTextarea.test.tsx src/components/evaluation/EvaluatorForm.test.tsx src/components/evaluation/TemplateForm.test.tsx src/components/evaluation/EvaluatorDetail.test.tsx src/components/evaluation/TemplateConfigSummary.test.tsx --runInBand`

## Docs Updated

- `ARCHITECTURE.md`
- `docs/design-docs/2026-02-17-online-evaluation.md`
- `docs/references/online-evaluation-user-guide.md`
- `docs/FRONTEND.md`
- `docs/index.md`
