---
title: Use the agent catalog
menuTitle: Track agent versions
description: Monitor agent versions, track tool and prompt changes, and compare performance across agents in the Sigil agent catalog.
keywords:
  - Sigil
  - agent catalog
  - versioning
  - agents
weight: 3
---

# Use the agent catalog

The agent catalog automatically discovers and tracks your agents. It groups generations by agent name, computes versions based on prompt and tool changes, and shows usage patterns over time.

## Browse agents

Navigate to **Agents** in the Sigil plugin to see all discovered agents. Each agent card shows:

- Agent name and active model.
- Current version hash.
- Generation count and error rate.
- Last active timestamp.

## Understand agent versions

Sigil computes an agent version as a SHA-256 hash of the system prompt and tool definitions. When you change a prompt or add, remove, or modify a tool, Sigil detects a new version automatically.

The version history for each agent shows:

- When each version was first and last seen.
- Which models each version used.
- The tool and prompt footprint for each version.

## Compare versions

Use the agent catalog to compare metrics across versions:

- Token usage and cost trends.
- Error rates and latency distributions.
- Evaluation score changes.

This helps you determine whether a prompt change improved or degraded quality.

## Model cards

Sigil maintains model cards with metadata about each LLM model your agents use. Model cards show pricing tiers, context windows, and capabilities. The catalog syncs model card data periodically to keep information current.

## Next steps

- [Set up online evaluation](../evaluation/)
- [Optimize cost and performance](../cost-optimization/)
