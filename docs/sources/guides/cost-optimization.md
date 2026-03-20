---
title: Optimize cost and performance
menuTitle: Optimize costs
description: Use Sigil observability data to reduce LLM costs, improve cache efficiency, and tune agent performance.
keywords:
  - Sigil
  - cost
  - optimization
  - cache
  - performance
weight: 6
---

# Optimize cost and performance

Sigil captures detailed token usage, cost, and cache data for every generation. Use this data to find optimization opportunities and reduce your AI spending.

## Analyze token usage

Open **Analytics** and review the tokens and cost dashboard. Look for:

- **High-token agents**: agents that consistently use more tokens than expected may have verbose prompts or unnecessary context.
- **Model selection**: some calls may use expensive models where a cheaper alternative would produce equivalent results.
- **Reasoning tokens**: if reasoning tokens are high, check whether thinking mode is enabled unnecessarily.

## Improve cache efficiency

Prompt caching reduces costs by reusing previously processed prompt prefixes. Sigil tracks cache read and cache creation tokens for each generation.

To improve cache rates:

- Keep the system prompt stable. Changing the system prompt frequently invalidates the cache.
- Place static content (system prompt, tool definitions) at the beginning of the message sequence.
- Minimize dynamic content that changes between requests.

Monitor cache efficiency in the analytics dashboard. A healthy cache read ratio means you're reusing processed prompt prefixes effectively.

## Reduce tool call overhead

The tools analytics page shows tool call frequency and duration. Look for:

- **Unused tools**: tools that are defined but never called add prompt tokens without value. Consider removing them.
- **Slow tools**: tools with high execution time may benefit from timeouts or caching.
- **Excessive tool calls**: agents that call too many tools per turn may need prompt adjustments.

## Compare agent versions

When you change prompts or tools, use the agent catalog to compare the new version's cost and performance against the previous version. Check whether the change improved quality without significantly increasing cost, or vice versa.

## Next steps

- [Use built-in dashboards](../dashboards/)
- [Set up online evaluation](../evaluation/)
