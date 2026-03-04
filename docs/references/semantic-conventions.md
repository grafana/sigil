---
owner: sigil-core
status: active
last_reviewed: 2026-03-04
source_of_truth: true
audience: both
---

# Semantic Conventions Reference

Canonical reference for all OTel span attributes, metrics, span naming, and events emitted by Sigil SDKs. Follows [OTel GenAI Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/) as the baseline; Sigil extensions use the `sigil.*` prefix.

## Span Attributes

### Core Identity

| Attribute | Type | Condition |
|---|---|---|
| `sigil.generation.id` | string | when generation has an ID |
| `sigil.sdk.name` | string | always (`sdk-go`, `sdk-js`, `sdk-python`, `sdk-java`, `sdk-dotnet`) |
| `gen_ai.operation.name` | string | always (`generateText`, `streamText`, `embeddings`, `execute_tool`) |
| `gen_ai.provider.name` | string | when non-empty |
| `gen_ai.conversation.id` | string | when present |
| `sigil.conversation.title` | string | when present |
| `gen_ai.agent.name` | string | when present |
| `gen_ai.agent.version` | string | when present |

### Request

| Attribute | Type | Condition |
|---|---|---|
| `gen_ai.request.model` | string | when non-empty |
| `gen_ai.request.max_tokens` | int | when set |
| `gen_ai.request.temperature` | float | when set |
| `gen_ai.request.top_p` | float | when set |
| `gen_ai.request.encoding_formats` | string[] | embeddings only |
| `sigil.gen_ai.request.tool_choice` | string | when set |
| `sigil.gen_ai.request.thinking.enabled` | bool | when set |
| `sigil.gen_ai.request.thinking.budget_tokens` | int | when set |

### Response

| Attribute | Type | Condition |
|---|---|---|
| `gen_ai.response.id` | string | when present |
| `gen_ai.response.model` | string | when present |
| `gen_ai.response.finish_reasons` | string[] | when present |

### Token Usage

| Attribute | Type | Condition |
|---|---|---|
| `gen_ai.usage.input_tokens` | int | when > 0 |
| `gen_ai.usage.output_tokens` | int | when > 0 |
| `gen_ai.usage.cache_read_input_tokens` | int | when > 0 |
| `gen_ai.usage.cache_write_input_tokens` | int | when > 0 |
| `gen_ai.usage.cache_creation_input_tokens` | int | when > 0 |
| `gen_ai.usage.reasoning_tokens` | int | when > 0 |

### Embeddings

| Attribute | Type | Condition |
|---|---|---|
| `gen_ai.embeddings.input_count` | int | embeddings only |
| `gen_ai.embeddings.input_texts` | string[] | embeddings only, truncated per SDK config (default varies by SDK) |
| `gen_ai.embeddings.dimension.count` | int | embeddings only |

### Tool Execution

| Attribute | Type | Condition |
|---|---|---|
| `gen_ai.tool.name` | string | execute_tool spans |
| `gen_ai.tool.call.id` | string | when present |
| `gen_ai.tool.type` | string | when present |
| `gen_ai.tool.description` | string | when present |
| `gen_ai.tool.call.arguments` | string (JSON) | when present, max ~2000 chars |
| `gen_ai.tool.call.result` | string (JSON) | when present, max ~2000 chars |

### Error

| Attribute | Type | Condition |
|---|---|---|
| `error.type` | string | on error |
| `error.category` | string | on error |

`error.type` values: `provider_call_error`, `mapping_error`, `validation_error`, `enqueue_error`, `tool_execution_error`, `framework_error`.

`error.category` values: `rate_limit`, `server_error`, `auth_error`, `timeout`, `client_error`, `sdk_error`.

### Framework (Python/JS handlers)

| Attribute | Type | Condition |
|---|---|---|
| `sigil.framework.name` | string | framework handler spans |
| `sigil.framework.source` | string | `"handler"` |
| `sigil.framework.language` | string | `"python"` or `"javascript"` |
| `sigil.framework.run_id` | string | when present |
| `sigil.framework.thread_id` | string | when present |
| `sigil.framework.parent_run_id` | string | when present |
| `sigil.framework.component_name` | string | when present |
| `sigil.framework.run_type` | string | when present |
| `sigil.framework.retry_attempt` | int | when present |
| `sigil.framework.langgraph.node` | string | when present |
| `sigil.framework.event_id` | string | when present |
| `sigil.framework.tags` | string[] | when present (LangChain/LangGraph callback tags) |
| `sigil.framework.step_type` | string | Vercel AI SDK only (`initial`, `continue`, `tool-result`) |
| `sigil.framework.reasoning_text` | string | Vercel AI SDK only, reasoning/thinking text |

### Provider-Specific Metadata Extensions

The normalized generation payload keeps provider-only details in `metadata` with a stable Sigil prefix.

| Key | Description |
|---|---|
| `sigil.sdk.name` | SDK identity marker (`sdk-go`, `sdk-js`, `sdk-python`, `sdk-java`, `sdk-dotnet`) |
| `sigil.gen_ai.request.thinking.budget_tokens` | provider thinking budget (request side) |
| `sigil.gen_ai.request.thinking.level` | provider thinking level when available (Gemini) |
| `sigil.gen_ai.usage.tool_use_prompt_tokens` | Gemini `toolUsePromptTokenCount` |
| `sigil.gen_ai.usage.server_tool_use.web_search_requests` | Anthropic server-side web-search count |
| `sigil.gen_ai.usage.server_tool_use.web_fetch_requests` | Anthropic server-side web-fetch count when provided |
| `sigil.gen_ai.usage.server_tool_use.total_requests` | derived total from available server tool-use counters |

---

## Metrics

| Instrument | Type | Unit | Per-recording Attributes |
|---|---|---|---|
| `gen_ai.client.operation.duration` | Histogram | `s` | `gen_ai.operation.name`, `gen_ai.provider.name`, `gen_ai.request.model`, `gen_ai.agent.name`, `error.type`, `error.category` |
| `gen_ai.client.token.usage` | Histogram | `token` | `gen_ai.operation.name`, `gen_ai.provider.name`, `gen_ai.request.model`, `gen_ai.agent.name`, `gen_ai.token.type` |
| `gen_ai.client.time_to_first_token` | Histogram | `s` | `gen_ai.provider.name`, `gen_ai.request.model`, `gen_ai.agent.name` |
| `gen_ai.client.tool_calls_per_operation` | Histogram | `count` | `gen_ai.provider.name`, `gen_ai.request.model`, `gen_ai.agent.name` |

`gen_ai.token.type` values: `input`, `output`, `cache_read`, `cache_write`, `cache_creation`, `reasoning`.

For `execute_tool` operations, `gen_ai.client.operation.duration` records `gen_ai.request.model` as the tool name and `gen_ai.provider.name` as empty since there is no model or provider context for tool execution.

---

## Span Naming

| Operation | Pattern | Example |
|---|---|---|
| Text generation | `{operation} {model}` | `generateText gpt-4o` |
| Streaming | `{operation} {model}` | `streamText claude-3` |
| Embeddings | `embeddings {model}` | `embeddings text-embedding-3-small` |
| Tool execution | `execute_tool {tool_name}` | `execute_tool search` |
| Framework chain | `{framework}.chain {component_name}` | `langchain.chain ChatOpenAI` |
| Framework retriever | `{framework}.retriever {component_name}` | `langchain.retriever MyRetriever` |

When model, tool name, or component name is empty, the trailing segment is omitted (e.g. `generateText`, `execute_tool unknown`, `langchain.chain`).

## Span Kind

| Span type | Kind |
|---|---|
| Generation (`generateText`, `streamText`) | `CLIENT` |
| Embedding (`embeddings`) | `CLIENT` |
| Tool execution (`execute_tool`) | `INTERNAL` |
| Framework chain/retriever | `INTERNAL` |

---

## Span Events

None. Errors are recorded via `span.recordException()` but no custom named events are emitted.

---

## Resource Attributes

None set by the SDK itself — relies on standard OTEL auto-detection and user-provided resource configuration.

---

## Upstream References

- [OTel GenAI Overview](https://opentelemetry.io/docs/specs/semconv/gen-ai/)
- [OTel GenAI Spans](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/)
- [OTel GenAI Metrics](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-metrics/)
- [OTel GenAI Events](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-events/)
- [OTel GenAI Attribute Registry](https://opentelemetry.io/docs/specs/semconv/registry/attributes/gen-ai/)
