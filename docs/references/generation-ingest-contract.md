---
owner: sigil-core
status: active
last_reviewed: 2026-03-04
source_of_truth: true
audience: both
---

# Generation Ingest Contract (`sigil.v1`)

## Sources

- Proto: `sigil/proto/sigil/v1/generation_ingest.proto`
- API generated stubs: `sigil/internal/gen/sigil/v1/`
- SDK generated stubs: `sdks/go/sigil/internal/gen/sigil/v1/`

## Transports

- gRPC:
  - service: `sigil.v1.GenerationIngestService`
  - method: `ExportGenerations(ExportGenerationsRequest) returns ExportGenerationsResponse`
- HTTP parity:
  - `POST /api/v1/generations:export`
  - JSON schema mirrors protobuf request/response.
- Implementation rule:
  - Both transport handlers call the same internal `Export` path to keep validation/persistence behavior identical.

## Auth Boundary

- Tenant header is `X-Scope-OrgID`.
- Auth-enabled mode (`SIGIL_AUTH_ENABLED=true`, default):
  - protected generation ingest endpoints require tenant context
  - HTTP missing tenant: `401 Unauthorized`
  - gRPC missing tenant metadata: `Unauthenticated`
- Auth-disabled mode (`SIGIL_AUTH_ENABLED=false`):
  - API injects `SIGIL_FAKE_TENANT_ID` (default `fake`) for local/dev workflows
- Health endpoints are always unauthenticated.
- Current phase does not perform bearer-token authentication in Sigil API.

## Deployment Topologies

- Grafana Cloud:
  - SDK generation export uses `basic` auth mode.
  - `Authorization: Basic <base64(instance_id:api_key)>` is the standard Grafana Cloud credential format.
- Direct generation-to-Sigil (self-hosted):
  - SDK generation export uses `tenant` auth mode and sends `X-Scope-OrgID`.
- Split path (generation direct, traces via collector/alloy):
  - generation export auth is configured in SDKs.
  - trace export/auth is configured in the application's OTEL SDK setup.
- Enterprise proxy pattern:
  - SDK can send bearer auth
  - proxy authenticates bearer and translates upstream to `X-Scope-OrgID`
  - Sigil API enforces tenant header only.

## Request

- `ExportGenerationsRequest.generations[]`
- Each `Generation` includes:
  - identity: `id`, `conversation_id`, `agent_name`, `agent_version`, `trace_id`, `span_id`
  - mode: `GENERATION_MODE_SYNC` or `GENERATION_MODE_STREAM`
  - model: `provider`, `name`
  - request controls: `max_tokens`, `temperature`, `top_p`, `tool_choice`, `thinking_enabled`
  - prompts/messages/tools/usage/metadata/timestamps/tags
  - optional `raw_artifacts[]` for debug payloads
- `Generation.tools[]` entries include:
  - `name`, `description`, `type`, `input_schema_json`
  - `deferred` (`false` by default when omitted)

## Agent Version Projection Semantics

- Ingest accepts producer-provided `agent_name` and `agent_version` as-is.
- Sigil computes an internal **effective version** for catalog/query projection when writing MySQL agent metadata:
  - format: `sha256:<hex>`
  - hash input: canonicalized `system_prompt + tools`
- Effective version is projection-only:
  - generation payload stored in `generations.payload` is **not** rewritten
  - producer `agent_version` remains informational metadata
- Agent catalog endpoints (`/api/v1/agents`, `/api/v1/agents:lookup`) use effective version as lookup identity.

## Response

- `ExportGenerationsResponse.results[]`
- Per generation:
  - `generation_id`
  - `accepted` (`true|false`)
  - `error` (non-empty when rejected)

## Validation Semantics

- Ingest is per-item, not all-or-nothing.
- Partial success is expected and represented in `results[]`.
- Invalid items are rejected with deterministic error text.

## Transport Test Expectations

- HTTP and gRPC handlers must preserve request payload fidelity.
- Keep two layers of tests:
  - API handler transport tests (direct HTTP/gRPC request roundtrip).
  - SDK transport tests (SDK -> HTTP/gRPC server roundtrip).
- SDK tests must assert key GenAI span attributes and generation transport behavior.

## SDK Expectations

- Go SDK defaults generation export protocol to gRPC.
- SDK batches asynchronously and retries in background.
- Use `StartGeneration` for non-stream calls and `StartStreamingGeneration` for streaming calls.
- `rec.Err()` surfaces validation/enqueue failures only.
- Call `Shutdown(ctx)` on application exit to flush queued generations.
- All SDKs stamp SDK identity into every normalized generation metadata map:
  - `sigil.sdk.name`
  - this reserved key is SDK-owned and overwrites conflicting caller-provided values
- SDK generation-export auth uses strict modes:
  - `none`
  - `tenant` (requires tenant id)
  - `bearer` (requires bearer token)
  - `basic` (requires password + user or tenant id; standard for Grafana Cloud)
- Explicit transport headers override SDK-injected `Authorization` and `X-Scope-OrgID`.

## Span Shape Emitted by SDKs

- Generation span name format: `<gen_ai.operation.name> <gen_ai.request.model>`.
- Default operations are mode-aware:
  - `SYNC` -> `generateText` (span example: `generateText <model>`)
  - `STREAM` -> `streamText` (span example: `streamText <model>`)
- `mode` is persisted on generation payloads but is not emitted as a span attribute.

### Generation span attributes

- Always present:
  - `gen_ai.operation.name`
  - `sigil.sdk.name`
- Conditionally present when value exists:
  - `sigil.generation.id`
  - `gen_ai.conversation.id`
  - `sigil.conversation.title` (Sigil extension)
  - `user.id`
  - `gen_ai.agent.name`
  - `gen_ai.agent.version` (Sigil extension; OTel-style naming)
  - `gen_ai.provider.name`
  - `gen_ai.request.model`
  - `gen_ai.request.max_tokens`
  - `gen_ai.request.temperature`
  - `gen_ai.request.top_p`
  - `sigil.gen_ai.request.tool_choice` (Sigil extension)
  - `sigil.gen_ai.request.thinking.enabled` (Sigil extension)
  - `sigil.gen_ai.request.thinking.budget_tokens` (Sigil extension; provider-specific)
  - `gen_ai.response.id`
  - `gen_ai.response.model`
  - `gen_ai.response.finish_reasons` (string array)
  - `gen_ai.usage.input_tokens`
  - `gen_ai.usage.output_tokens`
  - `gen_ai.usage.cache_read_input_tokens`
  - `gen_ai.usage.cache_creation_input_tokens`
  - `gen_ai.usage.reasoning_tokens`
  - `gen_ai.usage.cache_write_input_tokens`
  - `error.type` (`provider_call_error|mapping_error|validation_error|enqueue_error`)
  - `error.category` (`rate_limit|server_error|auth_error|timeout|client_error|sdk_error`)

### Example generation span

```json
{
  "name": "generateText claude-sonnet-4-5",
  "kind": "SPAN_KIND_CLIENT",
  "attributes": {
    "sigil.generation.id": "gen_01K2...",
    "gen_ai.conversation.id": "conv-7",
    "sigil.conversation.title": "Weather follow-up",
    "user.id": "user-42",
    "gen_ai.agent.name": "assistant-anthropic",
    "gen_ai.agent.version": "1.0.0",
    "gen_ai.operation.name": "generateText",
    "gen_ai.provider.name": "anthropic",
    "gen_ai.request.model": "claude-sonnet-4-5",
    "gen_ai.request.max_tokens": 1024,
    "gen_ai.request.temperature": 0.7,
    "gen_ai.request.top_p": 0.9,
    "sigil.gen_ai.request.tool_choice": "auto",
    "sigil.gen_ai.request.thinking.enabled": true,
    "sigil.gen_ai.request.thinking.budget_tokens": 2048,
    "gen_ai.response.id": "msg_1",
    "gen_ai.response.model": "claude-sonnet-4-5",
    "gen_ai.response.finish_reasons": [
      "end_turn"
    ],
    "gen_ai.usage.input_tokens": 120,
    "gen_ai.usage.output_tokens": 42,
    "gen_ai.usage.cache_read_input_tokens": 30,
    "gen_ai.usage.cache_creation_input_tokens": 4,
    "gen_ai.usage.reasoning_tokens": 9
  }
}
```

### Provider-specific metadata extensions

The normalized payload keeps provider-only details in `metadata` with a stable Sigil prefix. Current extensions:

- `sigil.sdk.name`: SDK identity marker (`sdk-go`, `sdk-js`, `sdk-python`, `sdk-java`, `sdk-dotnet`).
- `sigil.user.id`: end-user ID mirrored from typed SDK generation fields when set.
- `sigil.gen_ai.request.thinking.budget_tokens`: provider thinking budget (request side).
- `sigil.gen_ai.request.thinking.level`: provider thinking level when available (Gemini).
- `sigil.gen_ai.usage.tool_use_prompt_tokens`: Gemini `toolUsePromptTokenCount`.
- `sigil.gen_ai.usage.server_tool_use.web_search_requests`: Anthropic server-side web-search count.
- `sigil.gen_ai.usage.server_tool_use.web_fetch_requests`: Anthropic server-side web-fetch count when provided.
- `sigil.gen_ai.usage.server_tool_use.total_requests`: derived total from available server tool-use counters.

### Tool execution span attributes

- Span name format: `execute_tool <tool_name>`.
- Attributes:
  - `gen_ai.operation.name` (`execute_tool`)
  - `sigil.sdk.name`
  - `gen_ai.tool.name`
  - `gen_ai.tool.call.id` (if set)
  - `gen_ai.tool.type` (if set)
  - `gen_ai.tool.description` (if set)
  - `gen_ai.conversation.id` (if set)
  - `sigil.conversation.title` (if set)
  - `gen_ai.agent.name` (if set)
  - `gen_ai.agent.version` (if set)
  - `gen_ai.tool.call.arguments` and `gen_ai.tool.call.result` only when content capture is enabled

Full canonical tables covering all span attributes, metrics, span naming, span kind, and framework attributes: [`semantic-conventions.md`](semantic-conventions.md).

## Generation Payload Shape (What SDK Sends)

- SDK internal mode values: `SYNC|STREAM`.
- On protobuf/HTTP export, mode is encoded as:
  - `GENERATION_MODE_SYNC`
  - `GENERATION_MODE_STREAM`
- Raw artifacts are empty by default and only populated with explicit provider opt-in.

### OpenAI sync example (normalized generation)

```json
{
  "conversation_id": "conv-9b2f",
  "agent_name": "assistant-openai",
  "agent_version": "1.0.0",
  "mode": "GENERATION_MODE_SYNC",
  "model": {
    "provider": "openai",
    "name": "gpt-4o-mini"
  },
  "response_id": "chatcmpl_1",
  "response_model": "gpt-4o-mini",
  "system_prompt": "You are concise.",
  "input": [
    {
      "role": "MESSAGE_ROLE_USER",
      "parts": [
        {
          "text": "What is the weather in Paris?"
        }
      ]
    },
    {
      "role": "MESSAGE_ROLE_TOOL",
      "parts": [
        {
          "tool_result": {
            "tool_call_id": "call_weather",
            "content": "{\"temp_c\":18}"
          }
        }
      ]
    }
  ],
  "output": [
    {
      "role": "MESSAGE_ROLE_ASSISTANT",
      "parts": [
        {
          "tool_call": {
            "id": "call_weather",
            "name": "weather",
            "input_json": "{\"city\":\"Paris\"}"
          }
        }
      ]
    }
  ],
  "stop_reason": "tool_calls",
  "usage": {
    "input_tokens": 120,
    "output_tokens": 42,
    "total_tokens": 162
  },
  "raw_artifacts": []
}
```

### Anthropic stream example (normalized generation)

Correlation note:
- `tool_result.tool_call_id` is the preferred link to a prior `tool_call`.
- When a provider SDK does not expose a stable call ID, normalized payloads may omit `tool_call_id` and instead preserve `tool_result.name` as the fallback correlation key.

```json
{
  "conversation_id": "conv-stream",
  "agent_name": "assistant-anthropic",
  "agent_version": "1.0.0",
  "mode": "GENERATION_MODE_STREAM",
  "model": {
    "provider": "anthropic",
    "name": "claude-sonnet-4-5"
  },
  "response_id": "msg_stream_1",
  "response_model": "claude-sonnet-4-5",
  "output": [
    {
      "role": "MESSAGE_ROLE_ASSISTANT",
      "parts": [
        {
          "thinking": "look up tool"
        },
        {
          "tool_call": {
            "id": "toolu_2",
            "name": "weather",
            "input_json": "{\"city\":\"Paris\"}"
          }
        },
        {
          "text": "It's 18C and sunny."
        }
      ]
    }
  ],
  "stop_reason": "end_turn",
  "usage": {
    "input_tokens": 80,
    "output_tokens": 25,
    "total_tokens": 105
  },
  "raw_artifacts": []
}
```

### Gemini sync example (normalized generation)

```json
{
  "conversation_id": "conv-9b2f",
  "agent_name": "assistant-gemini",
  "agent_version": "1.0.0",
  "mode": "GENERATION_MODE_SYNC",
  "model": {
    "provider": "gemini",
    "name": "gemini-2.5-pro"
  },
  "response_id": "resp_1",
  "response_model": "gemini-2.5-pro-001",
  "system_prompt": "Be concise.",
  "output": [
    {
      "role": "MESSAGE_ROLE_ASSISTANT",
      "parts": [
        {
          "tool_call": {
            "id": "call_weather",
            "name": "weather",
            "input_json": "{\"city\":\"Paris\"}"
          }
        },
        {
          "text": "It is 18C and sunny."
        }
      ]
    }
  ],
  "stop_reason": "STOP",
  "usage": {
    "input_tokens": 120,
    "output_tokens": 40,
    "total_tokens": 170,
    "cache_read_input_tokens": 12,
    "reasoning_tokens": 10
  },
  "metadata": {
    "model_version": "gemini-2.5-pro-001"
  },
  "raw_artifacts": []
}
```
