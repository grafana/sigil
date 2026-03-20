---
title: Use built-in dashboards
menuTitle: Monitor dashboards
description: Monitor agent activity, performance, cost, and quality using the Sigil analytics dashboards.
keywords:
  - Sigil
  - dashboards
  - analytics
  - metrics
  - observability
weight: 4
---

# Use built-in dashboards

Sigil includes pre-built analytics dashboards that visualize agent activity, performance, cost, and quality. The dashboards use Prometheus metrics and Sigil query APIs to surface actionable insights.

## Access dashboards

Navigate to **Analytics** in the Sigil plugin. The dashboards are organized into these areas:

- **Activity**: generation counts, conversation counts, and active agents over time.
- **Performance**: latency distributions, time to first token, and error rates.
- **Tokens and cost**: token usage by model and provider, cost breakdown, and cache efficiency.
- **Tools**: tool call frequency, tool execution duration, and tool error rates.
- **Quality**: evaluation scores, score distributions, and quality trends.

## Identify performance issues

Use the performance dashboard to spot problems:

- **High latency**: filter by agent or model to find slow generations. Drill into traces for specific conversations to identify bottlenecks.
- **Error spikes**: the error rate panel shows failures over time. Click through to conversations with errors to inspect the `call_error` payload.
- **Slow time to first token**: for streaming agents, the TTFT panel reveals which models or prompts have poor streaming performance.

## Optimize costs

The tokens and cost dashboard helps you find optimization opportunities:

- **Cost by model**: compare cost across models and providers. Consider switching expensive calls to cheaper models where quality is acceptable.
- **Cache efficiency**: the cache read ratio shows how effectively prompt caching reduces token usage. Low cache rates may indicate prompts that change too frequently.
- **Token usage trends**: spot unexpected increases in token usage that may indicate prompt regression or unnecessary verbosity.

## Track quality

The quality dashboard visualizes evaluation scores alongside operational metrics:

- **Score trends**: monitor if quality improves or degrades after agent version changes.
- **Score distributions**: identify if responses cluster around high or low scores.
- **Correlation**: compare quality scores with latency and cost to find the right balance.

## Use Prometheus metrics directly

If you need custom dashboards, query the Sigil OpenTelemetry metrics in Prometheus:

| Metric | Description |
|--------|-------------|
| `gen_ai_client_operation_duration` | LLM call duration histogram. |
| `gen_ai_client_token_usage` | Token consumption histogram. |
| `gen_ai_client_time_to_first_token` | Streaming TTFT histogram. |
| `gen_ai_client_tool_calls_per_operation` | Tool calls per generation. |

## Set up alerts

Create Grafana alerts on Sigil metrics to proactively catch issues:

- Alert on error rate exceeding a threshold.
- Alert on p95 latency exceeding SLO targets.
- Alert on cost per day exceeding budget.
- Alert on evaluation score drops below a quality threshold.

Configure alerts in Grafana using the standard alerting workflow with the Prometheus data source.

## Next steps

- [Optimize cost and performance](../cost-optimization/)
- [Browse conversations](../conversations/)
