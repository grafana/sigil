---
owner: sigil-core
status: active
last_reviewed: 2026-02-20
source_of_truth: true
audience: both
---

# SDK LangChain and LangGraph Integrations Delivery

## Goal

Deliver first-class, module-based LangChain and LangGraph integrations for official framework languages (Python and TypeScript/JavaScript), preserve provider parity (OpenAI, Anthropic, Gemini), and add deterministic compose one-shot assertions for all SDK emitters plus framework-specific coverage.

## Scope

- Python LangChain module package (`sigil-sdk-langchain` / `sigil_sdk_langchain`).
- Python LangGraph module package (`sigil-sdk-langgraph` / `sigil_sdk_langgraph`).
- JS LangChain module export (`@grafana/sigil-sdk-js/langchain`).
- JS LangGraph module export (`@grafana/sigil-sdk-js/langgraph`).
- OpenAI/Anthropic/Gemini mapping parity across both frameworks.
- Docker `sdk-traffic` one-shot assertion flow for all SDK emitters.
- LangChain and LangGraph assertions for Python and JS framework records.
- SDK/docs/architecture governance updates.

## Source design doc

- `docs/design-docs/2026-02-20-sdk-langchain-langgraph-integrations.md`

## Completion policy

- A checkbox moves to `[x]` only when code/tests/docs for that item are complete in the working branch.
- Plan checklist status is updated in-branch as implementation progresses.
- When all exit criteria are met, move this plan to `docs/exec-plans/completed/`.

## Implementation phases

### Phase A: Python framework modules

- [ ] Create `sdks/python-frameworks/langchain/` package scaffolding.
- [ ] Create `sdks/python-frameworks/langgraph/` package scaffolding.
- [ ] Add LangChain handler APIs (sync + async).
- [ ] Add LangGraph handler APIs (sync + async).
- [ ] Map lifecycle events to recorder lifecycle (sync/stream/error) for both frameworks.
- [ ] Add provider resolver parity (OpenAI/Anthropic/Gemini + fallback) for both frameworks.
- [ ] Inject framework tags/metadata (`sigil.framework.*`) for both frameworks.
- [ ] Add unit tests for lifecycle, resolver behavior, errors, and tags.
- [ ] Add integration-style tests with provider-shaped framework flows.

### Phase B: TypeScript/JavaScript framework modules

- [ ] Add `sdks/js/src/frameworks/langchain/`.
- [ ] Add `sdks/js/src/frameworks/langgraph/`.
- [ ] Expose subpath exports `@grafana/sigil-sdk-js/langchain` and `@grafana/sigil-sdk-js/langgraph`.
- [ ] Add LangChain handler implementation.
- [ ] Add LangGraph handler implementation.
- [ ] Add lifecycle mapping and resolver parity for both frameworks.
- [ ] Add framework tags/metadata parity with Python.
- [ ] Add unit tests for both framework handlers.
- [ ] Add integration-style tests for provider-shaped framework flows.

### Phase C: SDK docs

- [ ] Update `sdks/python/README.md` with LangChain and LangGraph module usage.
- [ ] Update `sdks/js/README.md` with LangChain and LangGraph module usage.
- [ ] Add dedicated module README/docs for Python/JS LangChain and LangGraph modules.
- [ ] Document provider mapping behavior and stream/non-stream semantics.

### Phase D: Compose one-shot assertion harness

- [ ] Add one-shot mode wiring to `.config/devex/sdk-traffic/run-all.sh`.
- [ ] Add assertion script(s) that query Sigil APIs and fail fast on missing expected records.
- [ ] Assert generation visibility for all SDK emitters (Go, JS, Python, Java, .NET).
- [ ] Assert framework tags for Python/JS LangChain records.
- [ ] Assert framework tags for Python/JS LangGraph records.
- [ ] Add `mise` task entrypoint(s) for one-shot verification.

### Phase E: Test and quality wiring

- [ ] Add/update Python framework module test tasks in `mise.toml`.
- [ ] Add/update JS framework module test tasks in `mise.toml`.
- [ ] Add compose one-shot verification task in `mise.toml`.
- [ ] Document local validation flow (`test:sdk:all` + compose one-shot verification).

### Phase F: Architecture and docs governance sync

- [ ] Update `ARCHITECTURE.md` SDK runtime contracts to state first-class LangChain and LangGraph module direction.
- [ ] Update `docs/index.md`, `docs/design-docs/index.md`, and active plan references.
- [ ] Keep `last_reviewed` current in touched source-of-truth docs.

## Required tests

- Python:
  - LangChain handler unit tests (sync/async/stream, resolver, errors, tags)
  - LangGraph handler unit tests (sync/async/stream, resolver, errors, tags)
- JS:
  - LangChain handler unit tests (sync/stream, resolver, errors, tags)
  - LangGraph handler unit tests (sync/stream, resolver, errors, tags)
- Integration-style framework tests:
  - OpenAI/Anthropic/Gemini coverage for LangChain and LangGraph in Python and JS
- Compose one-shot assertions:
  - all five SDK emitters queryable
  - Python/JS LangChain records include `sigil.framework.name=langchain`
  - Python/JS LangGraph records include `sigil.framework.name=langgraph`

## Risks

- LangChain/LangGraph API drift can break handlers.
- Framework dependency/version churn across Python and JS ecosystems.
- Compose one-shot race conditions and timing flakiness.
- Assertion brittleness if framework metadata keys are duplicated/inconsistent.

## Exit criteria

- Python and JS LangChain modules are implemented, documented, and tested.
- Python and JS LangGraph modules are implemented, documented, and tested.
- OpenAI/Anthropic/Gemini mappings validated for both frameworks.
- Compose one-shot assertions verify all SDK emitters and framework-specific records.
- Docs and architecture references are synchronized.

## Out of scope

- LangChain/LangGraph modules for Go, Java, or .NET.
- OpenAI Agents SDK framework integrations.
- LlamaIndex framework integrations.
- Google ADK framework integrations.
- Sigil API/proto changes for framework-specific payload schemas.
- Plugin UI changes for framework-specific rendering.

## Explicit assumptions and defaults

- Official first-class framework scope in this phase is Python and TypeScript/JavaScript.
- Core SDK packages remain framework-agnostic.
- Provider parity target remains OpenAI/Anthropic/Gemini.
- Compose assertions use Sigil API data as source of truth.
