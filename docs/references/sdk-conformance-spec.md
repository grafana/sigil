---
owner: sigil-core
status: active
last_reviewed: 2026-03-12
source_of_truth: true
audience: both
---

# SDK Conformance Spec

Language-neutral specification of scenarios every Sigil SDK conformance runner must implement. Each scenario specifies the SDK actions, the expected generation proto fields, expected span attributes, and expected metric recordings.

Reference implementation: Go (`sdks/go/sigil/conformance_test.go`, `package sigil_test`).

Related docs:
- Semantic conventions: `docs/references/semantic-conventions.md`
- Generation ingest contract: `docs/references/generation-ingest-contract.md`
- Design doc: `docs/design-docs/2026-03-12-sdk-conformance-harness.md`

## Test infrastructure

Each SDK conformance runner must provide:

1. **Fake generation ingest server** (gRPC or HTTP) that captures the full `ExportGenerationsRequest` protobuf (or equivalent JSON).
2. **Span capture** using the SDK's OTel test infrastructure (e.g. `SpanRecorder` in Go, `InMemorySpanExporter` in Python/JS).
3. **Metric capture** using the SDK's OTel metric test infrastructure (e.g. `ManualReader` in Go).
4. **Fake rating HTTP server** that captures the HTTP request.

The SDK client must be configured to point at these local receivers. All tests run without Docker or external services.

## Assertion conventions

- "Assert proto field X = Y" means the captured `Generation` protobuf (or equivalent JSON) has field X with value Y.
- "Assert span attr X = Y" means the captured span has attribute key X with value Y.
- "Assert span attr X absent" means the captured span does NOT have attribute key X.
- "Assert metric M has data" means the named histogram has at least one data point.
- "Assert metric M absent" means the named histogram has zero data points (or is not emitted).

---

## Scenario 1: Full generation roundtrip

### Setup

Create a **sync** generation with all fields populated:

- `conversation_id`: `"conv-roundtrip"`
- `conversation_title`: `"Roundtrip Test"`
- `user_id`: `"user-42"`
- `agent_name`: `"test-agent"`
- `agent_version`: `"1.0.0"`
- `model.provider`: `"test-provider"`
- `model.name`: `"test-model"`
- `system_prompt`: `"You are a test assistant."`
- `tools`: one tool definition with name, description, type, input schema, deferred=true
- `max_tokens`: 1024
- `temperature`: 0.7
- `top_p`: 0.9
- `tool_choice`: `"auto"`
- `thinking_enabled`: true
- `tags`: `{"env": "conformance", "suite": "roundtrip"}`
- `metadata`: `{"custom_key": "custom_value"}`

Set result with:
- `input`: user text message + tool result message
- `output`: assistant message with text part, thinking part, and tool call part
- `response_id`: `"resp-1"`
- `response_model`: `"test-model-v2"`
- `usage`: all six token fields non-zero (input, output, cache_read, cache_write, cache_creation, reasoning)
- `stop_reason`: `"end_turn"`
- `artifacts`: one request artifact, one response artifact

Shutdown the client to flush.

### Expected generation proto

- All identity fields match input values.
- `mode` = `GENERATION_MODE_SYNC`.
- `metadata["sigil.sdk.name"]` = SDK name (e.g. `"sdk-go"`).
- `metadata["sigil.conversation.title"]` = `"Roundtrip Test"`.
- `metadata["sigil.user.id"]` = `"user-42"`.
- `trace_id` and `span_id` are non-empty and match the captured OTLP span.
- All message parts round-trip: text content, thinking content, tool call (id, name, input_json), tool result (tool_call_id, content).
- Tool definition includes `deferred = true`.
- All usage fields match.
- Both artifacts present.

### Expected span attributes

| Attribute | Value |
|---|---|
| `gen_ai.operation.name` | `"generateText"` |
| `sigil.generation.id` | matches generation ID |
| `gen_ai.conversation.id` | `"conv-roundtrip"` |
| `sigil.conversation.title` | `"Roundtrip Test"` |
| `user.id` | `"user-42"` |
| `gen_ai.agent.name` | `"test-agent"` |
| `gen_ai.agent.version` | `"1.0.0"` |
| `gen_ai.provider.name` | `"test-provider"` |
| `gen_ai.request.model` | `"test-model"` |
| `gen_ai.request.max_tokens` | 1024 |
| `gen_ai.request.temperature` | 0.7 |
| `gen_ai.request.top_p` | 0.9 |
| `sigil.gen_ai.request.tool_choice` | `"auto"` |
| `sigil.gen_ai.request.thinking.enabled` | true |
| `gen_ai.response.id` | `"resp-1"` |
| `gen_ai.response.model` | `"test-model-v2"` |
| `gen_ai.response.finish_reasons` | `["end_turn"]` |
| `gen_ai.usage.input_tokens` | matches |
| `gen_ai.usage.output_tokens` | matches |
| `gen_ai.usage.cache_read_input_tokens` | matches |
| `gen_ai.usage.cache_write_input_tokens` | matches |
| `gen_ai.usage.reasoning_tokens` | matches |
| `sigil.sdk.name` | SDK name |

Span kind: CLIENT. Span status: OK.

### Expected metrics

| Metric | Expected |
|---|---|
| `gen_ai.client.operation.duration` | has data point with `gen_ai.operation.name=generateText`, `gen_ai.provider.name=test-provider`, `gen_ai.request.model=test-model` |
| `gen_ai.client.token.usage` | has data points for token types: input, output, cache_read, cache_write, cache_creation, reasoning |
| `gen_ai.client.time_to_first_token` | **absent** (sync mode) |

---

## Scenario 2: Conversation title semantics

### Sub-cases

| Case | GenerationStart.ConversationTitle | Context title | Metadata `sigil.conversation.title` | Expected |
|---|---|---|---|---|
| explicit wins | `"Explicit"` | `"Context"` | -- | `"Explicit"` |
| context fallback | `""` | `"Context"` | -- | `"Context"` |
| metadata fallback | `""` | -- | `"Meta"` | `"Meta"` |
| whitespace omitted | `"   "` | -- | -- | absent |

### Expected (per sub-case)

- Proto `conversation_title` = expected value (or empty).
- Proto `metadata["sigil.conversation.title"]` = expected value (or absent when empty).
- Span attr `sigil.conversation.title` = expected value (or absent when empty).

---

## Scenario 3: User ID semantics

### Sub-cases

| Case | GenerationStart.UserID | Context user ID | Metadata `sigil.user.id` | Metadata `user.id` | Expected |
|---|---|---|---|---|---|
| explicit wins | `"explicit"` | `"ctx"` | `"meta"` | `"legacy"` | `"explicit"` |
| context fallback | `""` | `"ctx"` | -- | -- | `"ctx"` |
| canonical metadata | `""` | -- | `"canonical"` | -- | `"canonical"` |
| legacy metadata | `""` | -- | -- | `"legacy"` | `"legacy"` |
| canonical beats legacy | `""` | -- | `"canonical"` | `"legacy"` | `"canonical"` |
| whitespace trimmed | `"  padded  "` | -- | -- | -- | `"padded"` |

### Expected (per sub-case)

- Proto `user_id` = expected value.
- Proto `metadata["sigil.user.id"]` = expected value (when non-empty).
- Span attr `user.id` = expected value.

---

## Scenario 4: Agent identity semantics

### Sub-cases

| Case | Start agent_name | Start agent_version | Context name | Context version | Result agent_name | Expected name | Expected version |
|---|---|---|---|---|---|---|---|
| explicit | `"agent-x"` | `"2.0"` | -- | -- | -- | `"agent-x"` | `"2.0"` |
| context fallback | `""` | `""` | `"ctx-agent"` | `"ctx-v"` | -- | `"ctx-agent"` | `"ctx-v"` |
| result override | `"seed-agent"` | `"seed-v"` | -- | -- | `"override"` | `"override"` | `"seed-v"` |
| empty omitted | `""` | `""` | -- | -- | -- | absent | absent |

### Expected (per sub-case)

- Proto `agent_name` and `agent_version` = expected values.
- Span attr `gen_ai.agent.name` and `gen_ai.agent.version` = expected values (or absent).

---

## Scenario 5: SDK identity protection

### Setup

Create a generation with `Metadata: {"sigil.sdk.name": "evil"}`.

### Expected

- Proto `metadata["sigil.sdk.name"]` = SDK name (e.g. `"sdk-go"`), NOT `"evil"`.
- Span attr `sigil.sdk.name` = SDK name.

---

## Scenario 6: Tags and metadata merge

### Setup

Start with `Tags: {"env": "start", "start-only": "a"}` and `Metadata: {"env": "start", "start-only": 1}`.
Result with `Tags: {"env": "result", "result-only": "b"}` and `Metadata: {"env": "result", "result-only": 2}`.

### Expected

- Proto tags: `env=result`, `start-only=a`, `result-only=b` (result wins on conflict, union on disjoint).
- Proto metadata: `env=result`, `start-only=1`, `result-only=2` (same merge rule).

---

## Scenario 7: Resource attributes on OTLP

### Setup

Configure OTel resource with `service.name=conformance-svc`, `service.namespace=conformance-ns`, `deployment.environment.name=test`.
Run one generation, one tool execution, one embedding.

### Expected

- All three OTLP spans include the resource attributes.
- Generation proto links to traces via `trace_id`/`span_id` but does not contain resource attributes.

---

## Scenario 8: Streaming mode

### Setup

Use the SDK's streaming generation API. Record `first_token_at` timestamp. Set result and end.

### Expected

- Proto `mode` = `GENERATION_MODE_STREAM`.
- Span attr `gen_ai.operation.name` = `"streamText"`.
- Metric `gen_ai.client.time_to_first_token` has a data point.
- A companion sync generation in the same test produces no TTFT metric data point.

---

## Scenario 9: Tool execution

### Setup

Start a generation with conversation ID, title, agent name, agent version. Within that context, start a tool execution with tool name, call ID, type, description, and `include_content=true`. Set arguments and result on the tool recorder.

### Expected

- Tool span: `gen_ai.operation.name=execute_tool`, `gen_ai.tool.name`, `gen_ai.tool.call.id`, `gen_ai.tool.type`, `gen_ai.tool.description`. Span kind: INTERNAL.
- Context propagation: tool span has `gen_ai.conversation.id`, `sigil.conversation.title`, `gen_ai.agent.name`, `gen_ai.agent.version`.
- Content capture: `gen_ai.tool.call.arguments` and `gen_ai.tool.call.result` present.
- `sigil.sdk.name` present on tool span.
- Metric `gen_ai.client.operation.duration` recorded for tool execution.

---

## Scenario 10: Embedding

### Setup

Start an embedding with model provider/name and agent name. Set result with input count, input tokens, dimensions.

### Expected

- Span: `gen_ai.operation.name=embeddings`, `gen_ai.embeddings.input_count`, `gen_ai.embeddings.dimension.count`, `gen_ai.provider.name`, `gen_ai.request.model`. Span kind: CLIENT.
- `sigil.sdk.name` present.
- Metrics: `gen_ai.client.operation.duration` and `gen_ai.client.token.usage` (input type) have data.
- **No generation export** -- the fake ingest server receives zero requests.

---

## Scenario 11: Validation and error semantics

### Sub-case A: Invalid generation

Create a generation with no model (empty provider and name). Call `SetResult` + `End`.

**Expected**: `Err()` wraps the SDK's validation error. Fake ingest server receives zero requests.

### Sub-case B: Provider call error

Create a valid generation. Call `SetCallError` with an error containing `"429"` or a rate-limit signal. Call `SetResult` (with partial/empty generation) + `End`.

**Expected**:
- Span attr `error.type` = `"provider_call_error"`.
- Span attr `error.category` = `"rate_limit"`.
- Span status: ERROR.
- Metric `gen_ai.client.operation.duration` includes error labels.

---

## Scenario 12: Rating helper

### Setup

Configure SDK with custom headers (e.g. `{"X-Custom": "test"}`). Submit a conversation rating for `"conv-rated"` with rating ID, good value, comment, and metadata.

### Expected

- HTTP request method: POST.
- HTTP request path: `/api/v1/conversations/conv-rated/ratings`.
- Custom header `X-Custom: test` present.
- Request body deserializes to valid rating input JSON with all fields.
- SDK parses the response into its rating response type.

---

## Scenario 13: Shutdown flushes pending

### Setup

Create and end a valid generation. Immediately call `Shutdown` (do not call `Flush` separately).

### Expected

- Fake ingest server received exactly one generation matching the input.

---

---

## Provider wrapper conformance (Phase B)

_To be added._ Provider conformance scenarios validate that each provider mapper (openai, anthropic, gemini) correctly transforms provider-specific request/response objects into the normalized `Generation` shape.

Planned scenario areas per provider:
- Sync request/response mapping (all fields)
- Streaming mapping (accumulated output, mode=STREAM)
- Thinking/reasoning content mapping
- Tool call mapping
- Usage mapping (all token types including provider-specific)
- Stop reason mapping
- Error response mapping
- Artifact capture (opt-in)
- Embedding mapping

---

## Framework adapter conformance (Phase C)

_To be added._ Framework conformance scenarios validate that each framework adapter (langchain, langgraph, openai-agents, llamaindex, google-adk, vercel-ai-sdk) correctly produces spans with framework attributes and triggers generation recording.

Planned scenario areas per framework:
- Span creation with `sigil.framework.name`, `sigil.framework.language`, `sigil.framework.source`
- Generation triggering through framework LLM calls
- Span hierarchy (framework span as parent of generation/tool spans)
- Framework-specific metadata attributes
- Generation tags include framework identity

---

## Adding new scenarios

When a new SDK feature is added:

1. Add a scenario to this spec with setup, expected proto, expected span attrs, and expected metrics.
2. Implement the scenario in the Go reference runner.
3. Each other SDK adds the scenario to its own runner.
4. Update `semantic-conventions.md` if new span attributes or metrics are involved.

When a new provider or framework is added:

1. Add the provider/framework to the conformance matrix in the design doc.
2. Add conformance scenarios to the relevant section of this spec.
3. Implement in the Go reference runner, then other languages.
