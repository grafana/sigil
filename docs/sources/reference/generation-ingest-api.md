---
title: Generation ingest API
menuTitle: Explore generation ingest API
description: HTTP and gRPC contract for exporting generation data to Sigil.
keywords:
  - Sigil
  - API
  - generation
  - ingest
  - gRPC
  - HTTP
weight: 1
---

# Generation ingest API

The generation ingest API receives structured generation data from Sigil SDKs. It supports both HTTP and gRPC transports.

## Endpoints

| Transport | Endpoint |
|-----------|----------|
| HTTP | `POST /api/v1/generations:export` |
| gRPC | `sigil.v1.GenerationIngestService.ExportGenerations` |

## Authentication

The `X-Scope-OrgID` header identifies the tenant. When authentication is enabled (`SIGIL_AUTH_ENABLED=true`):

- HTTP requests without the header receive `401 Unauthorized`.
- gRPC requests without the header receive `Unauthenticated`.

When authentication is disabled, the server injects the fake tenant ID.

## Request body

Each request contains an array of generation objects. Key fields:

| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | Unique generation identifier (UUID). |
| `conversation_id` | Yes | Groups generations into a conversation thread. |
| `model.provider` | Yes | LLM provider name, for example, `openai`. |
| `model.name` | Yes | Model name, for example, `gpt-4o`. |
| `mode` | No | `SYNC` or `STREAM`. Default: `SYNC`. |
| `agent_name` | No | Agent identifier for catalog tracking. |
| `agent_version` | No | Informational version string. |
| `system_prompt` | No | System prompt text. |
| `input` | No | Array of input messages. |
| `output` | No | Array of output messages. |
| `tools` | No | Array of tool definitions. |
| `usage` | No | Token usage breakdown. |
| `timestamps` | No | Start, first token, and end timestamps. |
| `metadata` | No | Key-value metadata pairs. |
| `tags` | No | String tags for filtering. |
| `trace_id` | No | OpenTelemetry trace ID. |
| `span_id` | No | OpenTelemetry span ID. |

## Token usage fields

| Field | Description |
|-------|-------------|
| `input_tokens` | Tokens in the request. |
| `output_tokens` | Tokens in the response. |
| `cache_read_input_tokens` | Tokens served from cache. |
| `cache_creation_input_tokens` | Tokens written to cache. |
| `reasoning_tokens` | Tokens used for reasoning/thinking. |

## Tool definitions

| Field | Description |
|-------|-------------|
| `name` | Tool name. |
| `description` | Tool description. |
| `type` | Tool type. |
| `input_schema_json` | JSON schema for tool input. |
| `deferred` | Whether the tool is lazily loaded. |

## Response

The response contains per-generation results:

| Field | Description |
|-------|-------------|
| `generation_id` | The generation ID. |
| `accepted` | Whether the generation was accepted. |
| `error` | Error message if rejected. |

Partial success is supported — some generations may be accepted while others are rejected.

## Agent version computation

Sigil computes an effective agent version as `sha256:<hex>` from the canonical combination of `system_prompt` and `tools`. This version is used for agent catalog queries and doesn't modify the stored payload.
