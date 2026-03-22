---
title: Configure the Sigil plugin
menuTitle: Tune plugin settings
description: Configure plugin settings, RBAC roles, and data source connections in the Grafana Sigil plugin.
keywords:
  - Sigil
  - plugin
  - Grafana
  - RBAC
  - configuration
weight: 4
---

# Configure the Sigil plugin

The Grafana Sigil plugin provides the UI for browsing conversations, managing agents, configuring evaluation, and viewing dashboards. This article covers plugin configuration and access control.

## Plugin roles

Sigil defines four plugin roles that control access to features:

| Role | Permissions |
|------|------------|
| Sigil Viewer | Landing page and tutorial. |
| Sigil Reader | Dashboards, conversations, traces, model cards, and evaluation results. |
| Sigil Feedback Writer | Write conversation feedback (ratings and annotations). |
| Sigil Admin | Full access including feedback, evaluation configuration, and data source settings. |

## Assign roles

Assign Sigil roles to Grafana roles or teams using RBAC:

1. Navigate to **Administration** > **Users and access** > **Roles**.
1. Find or create the role you want to assign Sigil permissions to.
1. Add the appropriate `grafana-sigil-app.*` permissions.

## Connect data sources

The Sigil plugin queries Prometheus (metrics), Tempo (traces), and the Sigil API (generations). In **Configuration**, set:

- The Sigil API endpoint.
- The Prometheus data source for metrics dashboards.
- The Tempo data source for trace drilldown.

For Grafana Cloud deployments, data sources are configured automatically.

## Plugin pages

| Page | Path | Description |
|------|------|-------------|
| Analytics | `/a/grafana-sigil-app/analytics` | Activity, latency, error, token, and cost dashboards. |
| Conversations | `/a/grafana-sigil-app/conversations` | Browse and search conversations. |
| Tools | `/a/grafana-sigil-app/analytics/tools` | Tool usage analytics. |
| Agents | `/a/grafana-sigil-app/agents` | Agent catalog with version history. |
| Evaluation | `/a/grafana-sigil-app/evaluation` | Evaluation rules, evaluators, and scores. |
| Configuration | `/plugins/grafana-sigil-app` | Plugin settings (Admin only). |

## Next steps

- [Use built-in dashboards](../../guides/dashboards/)
- [Browse conversations](../../guides/conversations/)
