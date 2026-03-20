---
title: Data handling and privacy
menuTitle: Understand data handling
description: Understand what data Sigil collects, how it's stored, and how to control data retention.
keywords:
  - Sigil
  - privacy
  - data handling
  - retention
weight: 1
---

# Data handling and privacy

Sigil captures generation data that your SDKs export. This article explains what data is collected, how it's stored, and how to control retention.

## What data Sigil collects

Sigil stores the generation data your SDK sends, including:

- Conversation IDs and generation IDs.
- Model provider and name.
- System prompts, input messages, and output messages.
- Tool definitions, tool calls, and tool results.
- Token usage and timing data.
- Agent names and computed version hashes.
- Metadata and tags you attach.
- Evaluation scores and feedback.

Sigil also receives OpenTelemetry traces and metrics from your agents via the collector.

## Data you control

You control what data Sigil receives by configuring your SDK:

- **Embedding capture** is off by default. Enable it only for debugging because it may include sensitive input data.
- **Raw artifacts** (full provider request/response) are off by default.
- **Metadata and tags** are application-defined — include only what's useful for observability.
- **System prompts and messages** are captured as-is. If your prompts contain sensitive data, consider filtering before export.

## Storage

Generation data is stored in two tiers:

- **Hot storage (MySQL)**: recent generation metadata and payloads for fast queries.
- **Cold storage (object storage)**: compacted, compressed payloads for long-term retention.

For self-hosted deployments, you control the storage infrastructure and retention policies. For Grafana Cloud, data handling follows Grafana Cloud's standard data processing agreements.

## Retention

Configure the compactor retention period to control how long hot data is kept before compaction. After compaction, data in object storage follows your storage lifecycle policies.

## Online evaluation privacy

When using LLM judge evaluators, generation content (messages, prompts, tool calls) is sent to the configured judge provider for scoring. The judge provider processes this data according to its own terms of service. Choose judge providers that meet your organization's data handling requirements.

## Next steps

- [Security and access controls](../security/)
