---
title: Security and access controls
menuTitle: Control access
description: Understand tenant isolation, authentication modes, RBAC roles, and the plugin proxy boundary in Sigil.
keywords:
  - Sigil
  - security
  - authentication
  - RBAC
  - multi-tenancy
weight: 2
---

# Security and access controls

Sigil enforces security at multiple layers: tenant isolation at the API level, authentication on SDK connections, RBAC in the Grafana plugin, and a proxy boundary between the plugin and the Sigil backend.

## Tenant isolation

Every API request requires a tenant identifier in the `X-Scope-OrgID` header. Sigil enforces strict tenant boundaries:

- Generation data is scoped to the tenant that exported it.
- Query APIs return only data for the authenticated tenant.
- Evaluation rules and scores are tenant-scoped.
- There is no cross-tenant data access.

When `SIGIL_AUTH_ENABLED` is `true` (the default), requests without a tenant header are rejected with `401 Unauthorized` (HTTP) or `Unauthenticated` (gRPC).

## SDK authentication modes

SDKs authenticate using one of four modes:

| Mode | Use case |
|------|----------|
| `none` | Local development only — no authentication. |
| `tenant` | Self-hosted with tenant header injection. |
| `bearer` | Proxy-based authentication with bearer tokens. |
| `basic` | Grafana Cloud with instance ID and API key. |

For production deployments, use `basic` (Grafana Cloud) or `bearer` (custom proxy) mode.

## Plugin RBAC

The Grafana Sigil plugin defines four roles with increasing permissions:

| Role | Access |
|------|--------|
| Sigil Viewer | Landing page and tutorial. |
| Sigil Reader | Conversations, dashboards, traces, agents, evaluation results. |
| Sigil Feedback Writer | All Reader permissions plus feedback writing. |
| Sigil Admin | Full access including evaluation configuration and settings. |

Assign these roles through Grafana's RBAC system to control who can view, annotate, and configure Sigil.

## Plugin proxy boundary

The Grafana plugin communicates with the Sigil backend through a proxy that:

- Injects the tenant header from the Grafana user's organization context.
- Forwards only allowed API paths.
- Enforces plugin-level RBAC before proxying requests.
- Doesn't expose the Sigil API directly to end users.

## Health endpoints

The `/healthz` and `/readyz` endpoints are unauthenticated and don't expose tenant data. They return only service health status.

## Next steps

- [Data handling and privacy](../privacy/)
- [Configure the Sigil plugin](../../configure/plugin/)
