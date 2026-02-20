---
owner: sigil-core
status: completed
last_reviewed: 2026-02-20
source_of_truth: true
audience: both
---

# SDK LangChain and LangGraph Integrations (Python + TypeScript/JavaScript)

## Problem statement

Sigil SDKs provide core recorder APIs and provider wrappers, but there is no first-class framework integration for LangChain or LangGraph lifecycles. Teams must manually wire recorder calls around framework execution, which is inconsistent and easy to get wrong.

Local Docker `sdk-traffic` emits multi-language synthetic traffic, but it does not provide deterministic one-shot assertions that all SDK emitters produce queryable generations. Framework-specific regressions can pass unnoticed.

## Decision summary

1. Add LangChain and LangGraph as first-class, module-based integrations (not core SDK APIs).
2. Scope framework modules to official LangChain/LangGraph OSS languages: Python and TypeScript/JavaScript.
3. Keep provider coverage aligned with current SDK parity target: OpenAI, Anthropic, Gemini.
4. Keep Go/Java/.NET framework integrations out of scope for this phase.
5. Add deterministic compose one-shot assertions for all five SDK emitters.
6. Add first-class framework assertions for LangChain and LangGraph in Python and TypeScript/JavaScript.
7. Keep generation ingest contracts unchanged (`ExportGenerations` gRPC and `/api/v1/generations:export` HTTP parity).
8. Defer OpenAI Agents SDK, LlamaIndex, and Google ADK framework integrations to follow-up phases.

## Goals

- Deliver ergonomic LangChain and LangGraph handlers in Python and TypeScript/JavaScript.
- Map framework run lifecycle events to Sigil generation recorder lifecycle with stable semantics.
- Preserve OpenAI/Anthropic/Gemini mapping parity in both frameworks.
- Add compose assertions that validate all SDK traffic plus framework-origin traffic.
- Document integration usage, limits, and provider mapping behavior.

## Non-goals

- Framework integrations for Go, Java, or .NET.
- Framework integrations for OpenAI Agents SDK, LlamaIndex, and Google ADK in this phase.
- Changes to Sigil ingest/query API schemas.
- Framework-specific logic in SDK core runtime packages.
- Plugin UI framework-specific surfacing.

## Execution status

Execution for this design is tracked in:

- `docs/exec-plans/completed/2026-02-20-sdk-langchain-langgraph-integrations.md`

## Architecture and packaging decisions

### Boundary rule

- Core SDKs remain framework-agnostic.
- Framework modules depend on SDK core, never the reverse.

### Python packages

- LangChain package path: `sdks/python-frameworks/langchain/`
  - distribution: `sigil-sdk-langchain`
  - import: `sigil_sdk_langchain`
- LangGraph package path: `sdks/python-frameworks/langgraph/`
  - distribution: `sigil-sdk-langgraph`
  - import: `sigil_sdk_langgraph`
- dependency model:
  - hard dependency: `sigil-sdk`
  - framework dependencies declared per module (`langchain-core` for LangChain module, LangGraph dependency for LangGraph module)

### TypeScript/JavaScript modules

- LangChain source path: `sdks/js/src/frameworks/langchain/`
  - public import: `@grafana/sigil-sdk-js/langchain`
- LangGraph source path: `sdks/js/src/frameworks/langgraph/`
  - public import: `@grafana/sigil-sdk-js/langgraph`
- dependency model:
  - hard dependency: `@grafana/sigil-sdk-js` core
  - framework deps: `@langchain/core` and LangGraph JS package

## Public interfaces and types

### Python

```python
from sigil_sdk_langchain import SigilLangChainHandler
from sigil_sdk_langgraph import SigilLangGraphHandler

chain_handler = SigilLangChainHandler(client=sigil_client, provider_resolver="auto")
graph_handler = SigilLangGraphHandler(client=sigil_client, provider_resolver="auto")
```

Required handler surfaces:

- `SigilLangChainHandler` + async variant
- `SigilLangGraphHandler` + async variant
- options parity across handlers:
  - `agent_name`
  - `agent_version`
  - `provider_resolver`
  - `provider` (explicit mode)
  - `capture_inputs`
  - `capture_outputs`
  - `extra_tags`
  - `extra_metadata`

### TypeScript/JavaScript

```ts
import { SigilLangChainHandler } from "@grafana/sigil-sdk-js/langchain";
import { SigilLangGraphHandler } from "@grafana/sigil-sdk-js/langgraph";

const chainHandler = new SigilLangChainHandler(client, { providerResolver: "auto" });
const graphHandler = new SigilLangGraphHandler(client, { providerResolver: "auto" });
```

Required handler surfaces:

- `SigilLangChainHandler`
- `SigilLangGraphHandler`
- shared options shape with Python parity

## Lifecycle mapping contract

LangChain/LangGraph lifecycle events map to the same Sigil recorder semantics:

| Framework event | Sigil behavior |
|---|---|
| run start | create `StartGeneration` or `StartStreamingGeneration` recorder |
| first streamed token/chunk | set first-token timestamp for TTFT |
| run end | map output/usage/finish_reason and `End()` |
| run error | `SetCallError(err)` then `End()` |
| tool event (when structured) | map tool execution recorder lifecycle |

Mode mapping:

- non-stream framework call -> `SYNC`
- stream framework call -> `STREAM`

## Provider mapping contract

Provider coverage required in v1 framework modules:

- `openai`
- `anthropic`
- `gemini`

Resolver behavior:

1. Use explicit provider metadata from framework model objects when available.
2. Fallback model-name inference:
   - `gpt-`, `o1`, `o3`, `o4` -> `openai`
   - `claude-` -> `anthropic`
   - `gemini-` -> `gemini`
3. If unresolved -> `custom`.

## Record tagging and metadata contract

Framework records must include:

- `tags["sigil.framework.name"] = "langchain"` or `"langgraph"`
- `tags["sigil.framework.source"] = "handler"`
- `tags["sigil.framework.language"] = "python"` or `"javascript"`
- `metadata["sigil.framework.run_id"] = <framework run id>`

These keys drive compose assertions and framework queryability.

## Docker verification design

### One-shot runner behavior

Extend `sdk-traffic` to support deterministic one-shot mode:

- set bounded cycles (`SIGIL_TRAFFIC_MAX_CYCLES`)
- wait for emitters to complete
- execute API assertion script
- exit non-zero on any missing expected condition

### Assertion requirements

All-SDK assertions:

- Go, JS, Python, Java, .NET each produce queryable generations.

Framework assertions:

- Python LangChain and LangGraph paths both produce queryable generations.
- JS LangChain and LangGraph paths both produce queryable generations.
- Retrieved records include expected framework tags.

## Testing strategy

### Unit tests

Python:

- LangChain handler lifecycle mapping (sync/async/stream)
- LangGraph handler lifecycle mapping (sync/async/stream)
- provider resolver parity (OpenAI/Anthropic/Gemini + fallback)
- framework tags/metadata injection

JS:

- LangChain handler lifecycle mapping (sync/stream)
- LangGraph handler lifecycle mapping (sync/stream)
- provider resolver parity
- framework tags/metadata injection

### Integration-style tests

- provider-shaped framework executions for OpenAI/Anthropic/Gemini in both languages and both frameworks.

### Compose tests

- one-shot all-SDK query assertions
- one-shot LangChain/LangGraph query assertions for Python + JS

## Risks and mitigations

- LangChain/LangGraph callback API drift: isolate adapters and pin tested ranges.
- Framework dependency churn: keep resolver/mapping logic modular and tested.
- Compose race conditions: bounded retries and deterministic one-shot cycle sizing.
- Metadata key drift: centralize framework tag constants.

## Rollout plan

1. Implement Python and JS LangChain modules with tests.
2. Implement Python and JS LangGraph modules with tests.
3. Update docs for both frameworks.
4. Add compose one-shot assertions for all SDK emitters and framework records.

## Follow-up phases (deferred)

- OpenAI Agents SDK integration modules.
- LlamaIndex integration modules.
- Google ADK integration modules.

## Acceptance criteria

- Python and JS expose stable LangChain and LangGraph modules without core SDK API changes.
- OpenAI/Anthropic/Gemini mappings pass in LangChain and LangGraph modules.
- Compose one-shot verification fails if any SDK emitter is not queryable.
- Compose one-shot verification asserts LangChain and LangGraph tags for Python and JS runs.
- Docs/index/architecture references remain synchronized.

## Explicit assumptions and defaults

- "All SDK" verification means current `sdk-traffic` emitters: Go, JS, Python, Java, .NET.
- Framework integrations are optional modules.
- Core runtime behavior and ingest contracts are unchanged.
- Assertions use Sigil APIs as source of truth, not logs.
