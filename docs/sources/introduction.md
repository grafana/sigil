---
title: Introduction to Grafana Sigil
menuTitle: Introduction
description: Understand Sigil's core concepts including generation capture, conversation tracing, agent versioning, online evaluation, and the observability data model.
keywords:
  - Sigil
  - AI observability
  - concepts
  - generations
  - conversations
  - evaluation
weight: 1
---

# Introduction to Grafana Sigil

Grafana Sigil is an open-source AI observability platform for teams that run LLM agents in production. It captures every generation your agents make, organizes them into conversations, tracks agent versions, and lets you evaluate quality continuously.

This article explains the core concepts you need to understand before you instrument your agents and deploy Sigil.

## Generations

A generation is the core unit of data in Sigil. Each time your agent calls an LLM provider, the SDK captures the request and response as a generation. A generation includes:

- The model provider and name, for example, `openai/gpt-4o`.
- Input messages (system prompt, user messages, tool results).
- Output messages (assistant responses, tool calls).
- Token usage (input, output, cache read, cache creation, reasoning).
- Timing data (request start, first token, completion).
- Optional metadata and tags.

Generations can be synchronous or streaming. The SDK handles both modes transparently.

## Conversations

Sigil groups generations by `conversation_id` into conversations. A conversation represents a full interaction thread between a user and one or more agents.

In the Sigil plugin, you can browse conversations, filter by time range, search by content, and drill into individual generations. Each conversation shows a timeline view with traces, token usage, cost breakdown, and quality scores.

## Framework integrations

Sigil provides framework integrations for LangChain, LangGraph, OpenAI Agents, LlamaIndex, Google ADK, and Vercel AI SDK. These integrations attach callbacks or hooks that capture generations automatically, so you don't need to instrument each LLM call manually.

Framework integrations are available for Python, TypeScript, Go, and Java. Refer to [Instrument agents with frameworks](../guides/instrument-agents/) for setup details.

## Agent catalog

Sigil automatically discovers and catalogs your agents. When you set an `agent_name` in your SDK calls, Sigil tracks that agent and computes versions based on the combination of system prompt and tool definitions.

The agent catalog shows all active agents, their versions, associated models, and usage patterns. When you change a system prompt or add a tool, Sigil detects a new version automatically.

## Online evaluation

Online evaluation lets you score live production traffic continuously. You configure rules that match specific generation patterns, then attach evaluators that run automatically.

Sigil supports four evaluator types:

- **LLM judge** uses a separate LLM to score responses based on criteria you define.
- **JSON schema** validates that responses match an expected structure.
- **Regex** checks responses against patterns.
- **Heuristic** applies rule trees (length checks, content checks, emptiness checks).

Evaluation results appear as scores on conversations and generations in the plugin UI.

## OpenTelemetry integration

Sigil is built on OpenTelemetry. The SDKs emit standard `gen_ai.*` semantic convention spans and metrics alongside generation data. This means your existing OTEL infrastructure (Alloy, collectors, Tempo, Prometheus) works with Sigil out of the box.

Key metrics emitted include operation duration, token usage, time to first token, and tool calls per operation.

## Data flow

Your application sends data to Sigil through two paths:

1. **Generation export**: The SDK sends structured generation data to the Sigil API over HTTP or gRPC.
2. **OTLP telemetry**: The SDK emits OpenTelemetry traces and metrics to your collector (Alloy), which forwards them to Tempo and Prometheus.

Sigil stores recent generation data in MySQL for fast queries and compacts older data to object storage (S3, GCS, Azure Blob, or MinIO) for long-term retention.

## Multi-tenancy

Sigil enforces tenant isolation using the `X-Scope-OrgID` header. Each tenant's data is fully separated. The SDK auth configuration determines how the tenant header is set.

## Plugin UI

The Grafana Sigil plugin provides these views:

- **Analytics**: Dashboards for activity, latency, errors, tokens, cost, and cache behavior.
- **Conversations**: Browse and search conversations with full generation drilldown.
- **Agents**: Agent catalog with version history and tool/prompt footprints.
- **Evaluation**: Configure and monitor online evaluation rules, evaluators, and scores.

## Next steps

- [Get started with Sigil](../get-started/)
- [Configure Sigil](../configure/)
- [Privacy and security](../privacy-and-security/)
