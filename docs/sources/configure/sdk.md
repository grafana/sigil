---
title: Configure the Sigil SDK
menuTitle: Tune SDK settings
description: Tune generation export, authentication, batching, retry, and telemetry settings in your Sigil SDK client.
keywords:
  - Sigil
  - SDK
  - configuration
weight: 1
---

# Configure the Sigil SDK

All Sigil SDKs share the same configuration model. This article covers the available options for generation export, authentication, batching, and telemetry.

## Generation export

| Parameter | Default | Description |
|-----------|---------|-------------|
| `protocol` | `grpc` | Transport protocol. Options: `http`, `grpc`, `none` (instrumentation-only). |
| `endpoint` | varies by protocol | Sigil API address. HTTP default: `http://localhost:8080/api/v1/generations:export`. gRPC default: `localhost:4317`. |

## Authentication

| Mode | Required fields | Description |
|------|----------------|-------------|
| `none` | — | No authentication. Suitable for local development. |
| `tenant` | `tenantId` | Injects `X-Scope-OrgID` header. Use for self-hosted multi-tenant deployments. |
| `bearer` | `bearerToken` | Injects `Authorization: Bearer <token>` header. Use with proxy patterns. |
| `basic` | `tenantId`, `basicPassword` | Injects `Authorization: Basic` header. Recommended for Grafana Cloud. |

## Batching and retry

| Parameter | Default | Description |
|-----------|---------|-------------|
| `batchSize` | 100 | Maximum generations per export batch. |
| `flushInterval` | 1s | How often the SDK flushes queued generations. |
| `queueSize` | 2000 | Maximum number of queued generations before the SDK drops new ones. |
| `maxRetries` | 5 | Number of retry attempts for transient failures. |
| `initialBackoff` | 100ms | Initial retry delay. |
| `maxBackoff` | 5s | Maximum retry delay. |
| `payloadMaxBytes` | 16 MB | Maximum payload size per export request. |

## OpenTelemetry metrics

The SDK emits these OpenTelemetry metrics:

| Metric | Type | Description |
|--------|------|-------------|
| `gen_ai.client.operation.duration` | Histogram | LLM call duration. |
| `gen_ai.client.token.usage` | Histogram | Token consumption per call. |
| `gen_ai.client.time_to_first_token` | Histogram | Streaming time to first token. |
| `gen_ai.client.tool_calls_per_operation` | Histogram | Tool calls per generation. |

## Embedding capture

Embedding capture is off by default. Enable it for debugging only because it may expose sensitive data.

| Parameter | Default | Description |
|-----------|---------|-------------|
| `captureInput` | `false` | Capture embedding input content. |
| `maxInputItems` | 20 | Maximum embedding inputs to capture. |
| `maxTextLength` | 1024 | Maximum text length per input. |

## Raw artifacts

Raw artifacts capture the unprocessed provider request and response. Off by default.

Enable per-language:

- Go: `WithRawArtifacts()` option
- Python: `raw_artifacts=True`
- TypeScript: `rawArtifacts: true`
- Java: `.setRawArtifacts(true)`
- .NET: `.WithRawArtifacts()`

## Next steps

- [Configure deployment options](../deployment/)
- [Get started guides](../../get-started/)
