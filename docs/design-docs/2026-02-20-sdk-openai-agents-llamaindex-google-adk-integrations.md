---
owner: sigil-core
status: completed
last_reviewed: 2026-02-20
source_of_truth: true
audience: both
---

# SDK OpenAI Agents, LlamaIndex, and Google ADK Integrations (Conversation-First)

## Problem statement

Sigil has first-class core SDK runtimes and provider wrappers, plus active first-class framework integration work for LangChain/LangGraph. Teams using OpenAI Agents, LlamaIndex, and Google ADK still need custom callback wiring to map framework events to Sigil generation records and trace spans.

Without a first-class integration contract, teams produce inconsistent `conversation_id` mapping, inconsistent framework metadata keys, and uneven span attributes across languages.

## Decision summary

1. Add first-class framework integrations for OpenAI Agents, LlamaIndex, and Google ADK.
2. Keep Sigil mapping conversation-first: `conversation_id` is the primary identity in Sigil query/grouping.
3. Preserve framework lineage IDs (run/thread/parent/event IDs) only as optional supporting metadata/span attributes when they are meaningful and available.
4. Keep core SDK runtimes framework-agnostic; framework integrations are separate modules/packages.
5. Keep generation ingest/query contracts unchanged (`ExportGenerations` gRPC and `POST /api/v1/generations:export` HTTP parity).
6. Ship comprehensive docs and examples for each framework/language integration, with parity to existing framework docs quality.
7. Ship deterministic tests: unit, integration-style, and compose one-shot framework assertions.

## Goals

- Deliver official integration modules for the selected frameworks and languages.
- Ensure conversation continuity across framework-originated generations via deterministic `conversation_id` mapping.
- Preserve useful framework lineage in metadata/span attributes without forcing all frameworks into a run/thread-only model.
- Keep OpenAI/Anthropic/Gemini provider mapping parity where framework model resolution requires fallback.
- Provide operator-grade docs, usage snippets, and troubleshooting guidance.

## Non-goals

- Core Sigil API/proto changes for framework-specific payload schemas.
- Plugin UI framework-specific rendering changes in this phase.
- Forcing every framework to emit `run_id` and `thread_id` as mandatory fields.
- Adding unsupported language bindings beyond framework-official language surfaces.

## Framework and language scope

| Framework | Language scope in this phase | Notes |
|---|---|---|
| OpenAI Agents | Python, TypeScript/JavaScript | Official Agents SDKs are Python + TS/JS. |
| LlamaIndex | Python, TypeScript/JavaScript | LlamaIndex docs and packages support Python + TS. |
| Google ADK | Python, TypeScript/JavaScript, Go, Java | ADK docs and SDK references cover these languages. |

References:

- OpenAI Agents Python docs: <https://openai.github.io/openai-agents-python/>
- OpenAI Agents TypeScript docs: <https://openai.github.io/openai-agents-js/>
- LlamaIndex docs: <https://docs.llamaindex.ai/>
- Google ADK docs: <https://google.github.io/adk-docs/>

## Architecture and packaging decisions

### Boundary rule

- Core SDK packages remain framework-agnostic.
- Framework modules depend on SDK core runtime, never the reverse.

### Package/module layout

#### Python

- `sdks/python-frameworks/openai-agents/`
  - distribution: `sigil-sdk-openai-agents`
  - import: `sigil_sdk_openai_agents`
- `sdks/python-frameworks/llamaindex/`
  - distribution: `sigil-sdk-llamaindex`
  - import: `sigil_sdk_llamaindex`
- `sdks/python-frameworks/google-adk/`
  - distribution: `sigil-sdk-google-adk`
  - import: `sigil_sdk_google_adk`

#### TypeScript/JavaScript

- `sdks/js/src/frameworks/openai-agents/`
  - public import: `@grafana/sigil-sdk-js/openai-agents`
- `sdks/js/src/frameworks/llamaindex/`
  - public import: `@grafana/sigil-sdk-js/llamaindex`
- `sdks/js/src/frameworks/google-adk/`
  - public import: `@grafana/sigil-sdk-js/google-adk`

#### Go

- `sdks/go-frameworks/google-adk/`
  - package import follows Go module path conventions under repository module roots.

#### Java

- `sdks/java/frameworks/google-adk/`
  - package namespace under `com.grafana.sigil.sdk.frameworks.googleadk`.

## Public integration interface contract

Each framework integration exposes a handler/adapter surface with explicit options:

- `client` (required)
- `agent_name` (optional)
- `agent_version` (optional)
- `provider_resolver` or explicit `provider` override
- `capture_inputs` (default `true`)
- `capture_outputs` (default `true`)
- `extra_tags` (optional)
- `extra_metadata` (optional)

### Python usage shape (representative)

```python
from sigil_sdk import Client
from sigil_sdk_openai_agents import SigilOpenAIAgentsHandler

client = Client(...)
handler = SigilOpenAIAgentsHandler(
    client=client,
    agent_name="planner",
    provider_resolver="auto",
    capture_inputs=True,
    capture_outputs=True,
)

# framework runner wiring omitted for brevity
# handler maps framework lifecycle to Sigil generation recorder lifecycle
```

### TypeScript/JavaScript usage shape (representative)

```ts
import { SigilClient } from '@grafana/sigil-sdk-js';
import { SigilLlamaIndexHandler } from '@grafana/sigil-sdk-js/llamaindex';

const client = new SigilClient(config);
const handler = new SigilLlamaIndexHandler(client, {
  agentName: 'planner',
  providerResolver: 'auto',
  captureInputs: true,
  captureOutputs: true,
});

// framework runner wiring omitted for brevity
```

### Go usage shape (Google ADK representative)

```go
client := sigil.NewClient(cfg)
adapter := googleadk.NewSigilAdapter(client, googleadk.Options{
    AgentName:      "planner",
    CaptureInputs:  true,
    CaptureOutputs: true,
})

// Wire adapter hooks/interceptors into ADK runtime.
```

### Java usage shape (Google ADK representative)

```java
SigilClient client = new SigilClient(config);
SigilGoogleAdkAdapter adapter = SigilGoogleAdkAdapter.builder()
    .client(client)
    .agentName("planner")
    .captureInputs(true)
    .captureOutputs(true)
    .build();

// Wire adapter callbacks/interceptors into ADK runtime.
```

## Usage snippets by framework (documentation baseline)

The implementation docs for each module must include framework-specific snippets. Representative baseline snippets are below and should be adapted to real package APIs during implementation.

### OpenAI Agents (Python)

```python
from sigil_sdk import Client
from sigil_sdk_openai_agents import SigilOpenAIAgentsHandler

sigil = Client(...)
handler = SigilOpenAIAgentsHandler(
    client=sigil,
    agent_name="assistant",
    agent_version="2026.02",
    capture_inputs=True,
    capture_outputs=True,
)

# Attach handler into OpenAI Agents runner/callback stack.
# conversation_id is resolved from framework session/group context first.
```

### OpenAI Agents (TypeScript/JavaScript)

```ts
import { SigilClient } from '@grafana/sigil-sdk-js';
import { SigilOpenAIAgentsHandler } from '@grafana/sigil-sdk-js/openai-agents';

const sigil = new SigilClient(config);
const handler = new SigilOpenAIAgentsHandler(sigil, {
  agentName: 'assistant',
  agentVersion: '2026.02',
  captureInputs: true,
  captureOutputs: true,
});

// Attach handler to OpenAI Agents event hooks.
```

### LlamaIndex (Python)

```python
from sigil_sdk import Client
from sigil_sdk_llamaindex import SigilLlamaIndexHandler

sigil = Client(...)
handler = SigilLlamaIndexHandler(
    client=sigil,
    provider_resolver="auto",
    extra_metadata={"team": "eval"},
)

# Register callback/observer with LlamaIndex workflow.
# conversation_id follows session/workflow context, with deterministic fallback.
```

### LlamaIndex (TypeScript/JavaScript)

```ts
import { SigilClient } from '@grafana/sigil-sdk-js';
import { SigilLlamaIndexHandler } from '@grafana/sigil-sdk-js/llamaindex';

const sigil = new SigilClient(config);
const handler = new SigilLlamaIndexHandler(sigil, {
  providerResolver: 'auto',
  extraMetadata: { team: 'eval' },
});

// Register handler with LlamaIndex TS workflow callbacks.
```

### Google ADK (Python)

```python
from sigil_sdk import Client
from sigil_sdk_google_adk import SigilGoogleAdkHandler

sigil = Client(...)
handler = SigilGoogleAdkHandler(client=sigil)

# Bind handler to ADK invocation/session callbacks.
# ADK session identity is mapped to Sigil conversation_id.
```

### Google ADK (TypeScript/JavaScript)

```ts
import { SigilClient } from '@grafana/sigil-sdk-js';
import { SigilGoogleAdkHandler } from '@grafana/sigil-sdk-js/google-adk';

const sigil = new SigilClient(config);
const handler = new SigilGoogleAdkHandler(sigil);

// Bind handler to ADK JS runtime events.
```

### Google ADK (Go)

```go
client := sigil.NewClient(cfg)
adapter := googleadk.NewSigilAdapter(client, googleadk.Options{})

// Register adapter with ADK runtime middleware/hooks.
```

### Google ADK (Java)

```java
SigilClient client = new SigilClient(config);
SigilGoogleAdkAdapter adapter = SigilGoogleAdkAdapter.builder()
    .client(client)
    .build();

// Register adapter with ADK Java callbacks/interceptors.
```

## Conversation-first mapping contract

`conversation_id` is the primary identity that Sigil uses for grouping and query hydration.

### Global precedence rule

For every framework/language integration:

1. Use a framework-native conversation/session identifier when available.
2. Else use the most stable grouping identifier exposed by framework runtime context.
3. Else use deterministic synthetic conversation ID derived from stable top-level execution scope.

### Deterministic synthetic fallback

When no stable conversation/session key exists, generate:

- `sigil:framework:<framework_name>:<hash(stable_scope_fields)>`

Where `stable_scope_fields` are framework-specific but deterministic for a single logical conversation/session context (for example top-level workflow scope plus caller-supplied context keys).

Default hash algorithm across SDK languages: SHA-256 hex truncated to 32 chars.

## Framework lineage metadata and span attributes

Run/thread/parent/event IDs are optional supporting signals.

- Include them when available and meaningful.
- Do not block export when they are absent.
- Do not promote unbounded or high-cardinality payloads into span attributes.

### Required generation tags

- `sigil.framework.name`
- `sigil.framework.source=handler`
- `sigil.framework.language`

### Required metadata

- `sigil.framework.run_type`

### Optional metadata/span attributes

- `sigil.framework.run_id`
- `sigil.framework.thread_id`
- `sigil.framework.parent_run_id`
- `sigil.framework.component_name`
- `sigil.framework.retry_attempt`
- `sigil.framework.event_id`

## Canonical key registry

The following key names are canonical and shared across all framework integrations:

- `sigil.framework.name`
- `sigil.framework.source`
- `sigil.framework.language`
- `sigil.framework.run_id`
- `sigil.framework.thread_id`
- `sigil.framework.parent_run_id`
- `sigil.framework.component_name`
- `sigil.framework.run_type`
- `sigil.framework.retry_attempt`
- `sigil.framework.event_id`

Implement per-language constants in shared framework utility modules to prevent key drift.

## Framework-specific mapping tables

### OpenAI Agents

| Source signal | Sigil field | Rule |
|---|---|---|
| Session/group identity | `conversation_id` | Preferred when present. |
| Run identity | `metadata["sigil.framework.run_id"]` | Optional supporting lineage. |
| Parent run identity | `metadata["sigil.framework.parent_run_id"]` | Optional. |
| Thread identity (if exposed by runtime context) | `metadata["sigil.framework.thread_id"]` | Optional. |
| Tool/agent component name | `metadata["sigil.framework.component_name"]` | Optional. |

### LlamaIndex

| Source signal | Sigil field | Rule |
|---|---|---|
| Workflow/session/chat context ID | `conversation_id` | Preferred when stable. |
| Callback run ID | `metadata["sigil.framework.run_id"]` | Optional lineage. |
| Callback parent ID | `metadata["sigil.framework.parent_run_id"]` | Optional lineage. |
| Event type / node label | `metadata["sigil.framework.run_type"]` / `component_name` | Keep high-signal only. |

### Google ADK

| Source signal | Sigil field | Rule |
|---|---|---|
| ADK session/conversation identity | `conversation_id` | Primary source. |
| Invocation ID | `metadata["sigil.framework.run_id"]` | Optional lineage. |
| Parent invocation ID | `metadata["sigil.framework.parent_run_id"]` | Optional lineage. |
| Thread/session detail | `metadata["sigil.framework.thread_id"]` | Optional when distinct and useful. |
| Event ID / step ID | `metadata["sigil.framework.event_id"]` | Optional lineage/debugging signal. |

## Lifecycle mapping contract

Framework lifecycle maps to Sigil recorder lifecycle:

| Framework event | Sigil action |
|---|---|
| run/chat/model start | `start_generation(...)` or `start_streaming_generation(...)` |
| first streamed token/chunk | `set_first_token_at(...)` |
| run completion | `set_result(...)`, `end()` |
| run error | `set_call_error(...)`, `end()` |
| tool start/end/error | tool recorder lifecycle (`start_tool_execution`, `end`) |

Mode mapping:

- non-stream call -> `SYNC`
- stream call -> `STREAM`

## Provider resolver contract

Resolver precedence:

1. explicit provider option if set by caller
2. framework-native provider/model metadata
3. model-name prefix inference
4. fallback `custom`

Required inference prefixes:

- `gpt-`, `o1`, `o3`, `o4` -> `openai`
- `claude-` -> `anthropic`
- `gemini-` -> `gemini`

## Error and span semantics

- Framework callback/adapter errors set:
  - `error.type=framework_error`
  - `error.category=sdk_error`
- Provider call failures keep existing provider error mapping semantics.
- Framework non-generation spans should include:
  - `gen_ai.operation.name` as framework operation label
  - framework identity attributes from canonical key registry

## Documentation deliverables

Each framework/language integration must include docs with the following sections and snippets.

### Required sections

1. Quickstart
2. Streaming integration
3. Conversation ID mapping behavior
4. Metadata and lineage fields
5. Provider resolver behavior
6. Error behavior and troubleshooting
7. Version compatibility notes

### Required snippets

Per framework/language docs must include runnable snippets for:

- minimal setup
- callback/handler wiring
- conversation mapping override where applicable
- inspecting emitted metadata/tags in tests

## Testing strategy

### Unit tests

- conversation ID precedence and fallback determinism
- optional run/thread/parent metadata emission
- lifecycle mapping (sync/stream/error)
- tool lifecycle mapping where framework supports tool events
- provider resolver precedence

### Integration-style tests

- provider-shaped framework runs (OpenAI/Anthropic/Gemini where relevant)
- nested runs/workflows with parent-child lineage
- stream token and finish reason mapping

### Compose one-shot assertions

- every framework-language path emits queryable generations
- expected framework tags are present
- conversation grouping works with mapped `conversation_id`
- optional lineage keys are present when fixture provides source values

## Local validation contract

Execution must add/update `mise` tasks covering:

- framework unit tests per language
- framework integration-style tests per language
- compose one-shot framework assertions

Baseline local verification commands after implementation:

- `mise run test:sdk:all`
- `mise run test:sdk:compose-one-shot`
- any new framework-specific `mise` task entries introduced by this work

## Risks and mitigations

- Framework API churn:
  - isolate framework adapters per package/module
  - pin and test supported version ranges
- Metadata key drift:
  - shared constants and cross-language conformance tests
- Cardinality blowups:
  - strict span attribute allowlist
  - keep opaque payloads in generation metadata only
- One-shot flakiness:
  - deterministic emitter cycles and bounded retries

## Rollout and compatibility

- Implement by framework track with independent task gates.
- Keep changes additive; no breaking changes to core SDK APIs.
- Maintain compatibility with existing LangChain/LangGraph framework patterns.

## Execution status

Execution for this design is tracked in:

- `docs/exec-plans/completed/2026-02-20-sdk-openai-agents-llamaindex-google-adk-integrations.md`
