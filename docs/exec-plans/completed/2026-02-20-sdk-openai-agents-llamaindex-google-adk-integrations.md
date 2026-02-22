---
owner: sigil-core
status: completed
last_reviewed: 2026-02-20
source_of_truth: true
audience: both
---

# SDK Integrations Delivery: OpenAI Agents, LlamaIndex, Google ADK

## Goal

Deliver first-class framework integrations for OpenAI Agents, LlamaIndex, and Google ADK with conversation-first mapping, comprehensive docs/snippets, and deterministic test coverage.

## Source design doc

- `docs/design-docs/2026-02-20-sdk-openai-agents-llamaindex-google-adk-integrations.md`

## Completion policy

- A checkbox moves to `[x]` only when code/tests/docs for that item are complete in the working branch.
- Checklist status is updated in-branch as implementation progresses.
- When all exit criteria are met, move this plan to `docs/exec-plans/completed/`.

## Scope

- OpenAI Agents integrations for Python and TypeScript/JavaScript.
- LlamaIndex integrations for Python and TypeScript/JavaScript.
- Google ADK integrations for Python, TypeScript/JavaScript, Go, and Java.
- Conversation-first data mapping contract with optional lineage metadata.
- Framework docs with usage snippets and troubleshooting sections.
- Unit/integration/compose test coverage and `mise` task wiring.

## Out of scope

- .NET integration modules for these frameworks.
- Sigil ingest/query API schema changes.
- Plugin UI framework-specific rendering.

## Track A: Shared framework contract and utilities

- [x] Add per-language shared constants for canonical framework keys (`sigil.framework.*`).
- [x] Add per-language conversation ID resolver helpers with deterministic fallback behavior.
- [x] Add per-language metadata normalization helpers (JSON-safe, bounded, stable key naming).
- [x] Add per-language span attribute allowlist helpers to prevent high-cardinality drift.
- [x] Add cross-language conformance tests to verify canonical key names and required tags.

## Track B: OpenAI Agents integrations

### Python

- [x] Create `sdks/python-frameworks/openai-agents/` package scaffolding.
- [x] Implement adapter/handler lifecycle mapping (sync/stream/error/tool).
- [x] Map framework context to Sigil `conversation_id` first.
- [x] Propagate optional lineage metadata (`run_id`, `thread_id`, `parent_run_id`) when available.
- [x] Add unit tests for lifecycle, conversation mapping, and optional lineage behavior.
- [x] Add integration-style tests with provider-shaped OpenAI Agents flows.
- [x] Add module README with quickstart + streaming + troubleshooting snippets.

### TypeScript/JavaScript

- [x] Create `sdks/js/src/frameworks/openai-agents/` module.
- [x] Add package subpath export `@grafana/sigil-sdk-js/openai-agents`.
- [x] Implement adapter lifecycle mapping and conversation-first mapping.
- [x] Add optional lineage metadata propagation logic.
- [x] Add unit tests for callback mapping and metadata/tag emission.
- [x] Add integration-style tests for representative framework flows.
- [x] Add docs page with usage and troubleshooting snippets.

## Track C: LlamaIndex integrations

### Python

- [x] Create `sdks/python-frameworks/llamaindex/` package scaffolding.
- [x] Implement callback/workflow adapter lifecycle mapping.
- [x] Map workflow/session context to `conversation_id` using precedence contract.
- [x] Propagate optional lineage metadata when provided by runtime callbacks.
- [x] Add unit tests for mapping, fallback, and stream/error behavior.
- [x] Add integration-style tests for workflow and agent-style runs.
- [x] Add module README with quickstart + streaming + troubleshooting snippets.

### TypeScript/JavaScript

- [x] Create `sdks/js/src/frameworks/llamaindex/` module.
- [x] Add package subpath export `@grafana/sigil-sdk-js/llamaindex`.
- [x] Implement adapter lifecycle mapping and conversation-first mapping.
- [x] Add optional lineage metadata mapping from callback/workflow events.
- [x] Add unit tests for mapping fidelity and error handling.
- [x] Add integration-style tests for representative LlamaIndex TS flows.
- [x] Add docs page with usage and troubleshooting snippets.

## Track D: Google ADK integrations

### Python

- [x] Create `sdks/python-frameworks/google-adk/` package scaffolding.
- [x] Implement adapter lifecycle mapping and conversation-first mapping.
- [x] Map ADK session identity to `conversation_id`.
- [x] Keep invocation/event IDs as optional lineage metadata.
- [x] Add unit and integration-style tests.
- [x] Add module README with snippets and troubleshooting.

### TypeScript/JavaScript

- [x] Create `sdks/js/src/frameworks/google-adk/` module.
- [x] Add package subpath export `@grafana/sigil-sdk-js/google-adk`.
- [x] Implement adapter mapping and optional lineage propagation.
- [x] Add unit and integration-style tests.
- [x] Add docs page with snippets and troubleshooting.

### Go

- [x] Create `sdks/go-frameworks/google-adk/` package scaffolding.
- [x] Implement interceptor/hook adapter with conversation-first mapping.
- [x] Propagate optional lineage fields and framework tags.
- [x] Add unit tests and representative integration-style mapping tests.
- [x] Add package README with usage snippets.

### Java

- [x] Create `sdks/java/frameworks/google-adk/` package scaffolding.
- [x] Implement callback/interceptor adapter with conversation-first mapping.
- [x] Propagate optional lineage fields and framework tags.
- [x] Add unit tests and representative integration-style mapping tests.
- [x] Add package README with usage snippets.

## Track E: Documentation and snippet parity

- [x] Add docs pages for all framework/language modules with required sections.
- [x] Update `sdks/python/README.md` with links/examples for new framework modules.
- [x] Update `sdks/js/README.md` with links/examples for new framework modules.
- [x] Update Go/Java SDK docs to link Google ADK integration modules.
- [x] Ensure each new doc includes:
  - quickstart snippet
  - streaming snippet (if framework/language supports streaming hooks)
  - conversation mapping snippet
  - metadata/lineage snippet
  - troubleshooting section

## Track F: Test and quality wiring

- [x] Add/update `mise` tasks for all new framework unit tests.
- [x] Add/update `mise` tasks for framework integration-style tests.
- [x] Extend compose one-shot emitters with framework scenarios.
- [x] Add compose assertion coverage for framework tags and conversation grouping.
- [x] Verify aggregate SDK + framework test command contracts are documented.

## Track G: Governance sync

- [x] Update `ARCHITECTURE.md` with active framework integration contract direction.
- [x] Update docs indexes:
  - `docs/index.md`
  - `docs/design-docs/index.md`
- [x] Keep `last_reviewed` current in touched source-of-truth docs.
- [x] Keep this plan status/checklist synchronized during implementation.

## Required tests

- Unit tests per framework/language adapter for:
  - lifecycle mapping (sync/stream/error/tool)
  - conversation ID precedence and deterministic fallback
  - optional lineage metadata propagation
  - required framework tag emission
- Integration-style tests per framework/language for representative callback/event payloads.
- Compose one-shot assertions confirming:
  - all Python/JS framework paths produce queryable generations
  - `sigil.framework.name/source/language` tags are present
  - conversation grouping remains stable using mapped `conversation_id`

## Validation commands (target)

- `mise run test:sdk:all`
- `mise run test:sdk:compose-one-shot`
- framework-specific `mise` tasks introduced by this work

## Risks

- Framework callback/runtime APIs may change across versions.
- Cross-language metadata key drift may break query assertions.
- One-shot compose validation can become flaky under timing variance.
- Excessive framework payload mapping can increase cardinality if span allowlists are not enforced.

## Exit criteria

- All scoped framework-language integration modules are implemented and documented.
- Conversation-first mapping contract is enforced by tests.
- Optional lineage metadata behavior is consistent and non-blocking.
- One-shot compose assertions cover all new framework paths.
- Governance/index/architecture docs are updated and coherent.

## Explicit assumptions and defaults

- `conversation_id` is primary identity; lineage IDs are optional support signals.
- When framework-native conversation/session IDs are absent, deterministic synthetic fallback is used.
- Core SDK runtime APIs remain framework-agnostic.
- Existing LangChain/LangGraph integration behavior remains backward-compatible.
