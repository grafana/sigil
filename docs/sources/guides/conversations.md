---
title: Browse and debug conversations
menuTitle: Browse conversations
description: Search, filter, and drill into conversations to understand what your agents did, where they failed, and how they performed.
keywords:
  - Sigil
  - conversations
  - debugging
  - traces
weight: 1
---

# Browse and debug conversations

The Conversations view in the Sigil plugin lets you search, filter, and inspect full conversation threads. Use it to understand what happened during an agent interaction, identify failures, and analyze performance.

## Search conversations

Navigate to **Conversations** in the Sigil plugin. Use the search bar and filters to find conversations by:

- Time range.
- Agent name or version.
- Model provider or name.
- Conversation content.
- Error status.
- Tags or metadata values.

Conversations display a summary showing the agent, model, token count, cost, duration, and any evaluation scores.

## Inspect a conversation

Click a conversation to open the detail view. The conversation detail shows:

- A timeline of all generations in the conversation.
- Each generation's input messages, output messages, tool calls, and tool results.
- Token usage breakdown (input, output, cache read, cache creation, reasoning).
- Timing data (start, first token, end).
- Evaluation scores attached to each generation.

## Trace drilldown

Each generation links to its OpenTelemetry trace. Click the trace link to open the trace view in Tempo, where you can see the full span tree including:

- LLM call duration and error status.
- Tool execution spans.
- Nested agent invocations.

Use trace drilldown to identify latency bottlenecks, understand tool call sequences, and diagnose timeout or error scenarios.

## Provide feedback

If you have the Sigil Feedback Writer role, you can rate conversations with thumbs up or thumbs down and add annotations explaining what worked or failed. Feedback data appears in evaluation dashboards and helps track quality trends.

## Next steps

- [Use the agent catalog](../agent-catalog/)
- [Use built-in dashboards](../dashboards/)
