---
owner: sigil-core
status: active
last_reviewed: 2026-02-14
source_of_truth: true
audience: both
---

# Multi-Tenancy

Sigil uses a tenant boundary based on a request header, not full identity/authz.

- tenant header: `X-Scope-OrgID`
- tenant boundary applies to Sigil protected APIs (generation ingest + query/feedback)
- traces and metrics are OTLP telemetry and do not pass through Sigil auth middleware

## Quick Start

1. Run Sigil with auth enabled (default):

```bash
SIGIL_AUTH_ENABLED=true
```

2. Send tenant context on every protected request:

```bash
curl -i -X POST "http://localhost:8080/api/v1/generations:export" \
  -H "Content-Type: application/json" \
  -H "X-Scope-OrgID: team-a" \
  -d '{"generations":[{"id":"gen-1","model":{"provider":"openai","name":"gpt-5"}}]}'
```

3. For gRPC ingest, send the same value as gRPC metadata:

```bash
grpcurl -plaintext \
  -H "x-scope-orgid: team-a" \
  -d '{"generations":[{"id":"gen-1","model":{"provider":"openai","name":"gpt-5"}}]}' \
  localhost:4317 \
  sigil.v1.GenerationIngestService/ExportGenerations
```

## Runtime Modes

| Mode | Config | Behavior |
| --- | --- | --- |
| strict tenant mode | `SIGIL_AUTH_ENABLED=true` | Protected HTTP endpoints return `401` and protected gRPC methods return `Unauthenticated` when tenant is missing/invalid. |
| fake-tenant mode | `SIGIL_AUTH_ENABLED=false` + `SIGIL_FAKE_TENANT_ID` (default `fake`) | Sigil injects one local/dev tenant into request context. |

Notes:

- `SIGIL_AUTH_ENABLED` defaults to `true`.
- fake-tenant mode can be used for local/dev and simple single-tenant installs, but it is not production tenant isolation.
- current `docker-compose.yaml` runs Sigil with `SIGIL_AUTH_ENABLED=false` for local development.

### Helm setup patterns

Simple single-tenant install (no tenant header management):

```yaml
sigil:
  auth:
    enabled: false
    fakeTenantID: default
```

Strict tenant boundary (recommended for production):

```yaml
sigil:
  auth:
    enabled: true
```

## Where Tenant Enforcement Applies

Tenant extraction/enforcement is uniform for:

- generation ingest HTTP (`POST /api/v1/generations:export`)
- generation ingest gRPC (`GenerationIngestService.ExportGenerations`)
- Sigil query and feedback HTTP endpoints (conversations, ratings, annotations, completions, traces, model-cards)

Tenant enforcement does not apply in Sigil for:

- OTLP traces and OTLP metrics (handled by Alloy / OTel Collector pipeline)

Plugin boundary:

- Grafana plugin frontend should not implement tenant header logic directly.
- tenant headers should be applied/forwarded by backend proxy layers.

## Client and Deployment Configuration

### Direct to Sigil (no proxy)

Send `X-Scope-OrgID` from your client for generation/query requests.

If you use a Sigil SDK version with per-export auth helpers, configure generation export in `tenant` mode; otherwise set the header explicitly in transport headers.

### Bearer token via reverse proxy

Sigil does not validate bearer tokens in this phase. If you need token auth:

1. client sends `Authorization: Bearer <token>` to your proxy
2. proxy authenticates token
3. proxy forwards request to Sigil with `X-Scope-OrgID: <tenant>`

### Traces and metrics path

Configure tenant/auth headers on the OTLP pipeline (typically Alloy), not on Sigil:

```river
otelcol.exporter.otlp "tempo" {
  client {
    endpoint = "tempo:4317"
    headers = {
      "X-Scope-OrgID" = "team-a"
      # optional
      "Authorization" = "Bearer <token>"
    }
  }
}

otelcol.exporter.otlphttp "prometheus" {
  client {
    endpoint = "http://prometheus:9090/api/v1/otlp"
    headers = {
      "X-Scope-OrgID" = "team-a"
      # optional
      "Authorization" = "Bearer <token>"
    }
  }
}
```

In Helm deployments, this is exposed through `alloy.auth.*` values.

Example values:

```yaml
sigil:
  auth:
    enabled: true
    fakeTenantID: fake

alloy:
  auth:
    enabled: true
    tenantID: team-a
    bearerToken: ""
```

### Grafana Cloud note (traces and metrics)

Grafana Cloud ingestion docs currently show Basic auth patterns for telemetry pipelines:

- traces via `otelcol.exporter.otlphttp` + `otelcol.auth.basic`
- metrics via `prometheus.remote_write` + `basic_auth`

Example:

```river
otelcol.auth.basic "grafana_cloud" {
  username = sys.env("GRAFANA_CLOUD_ACCOUNT_ID")
  password = sys.env("GRAFANA_CLOUD_API_TOKEN")
}

otelcol.exporter.otlphttp "grafana_cloud_traces" {
  client {
    endpoint = sys.env("GRAFANA_CLOUD_TEMPO_OTLP_HTTP_ENDPOINT")
    auth     = otelcol.auth.basic.grafana_cloud.handler
  }
}

otelcol.exporter.prometheus "grafana_cloud_metrics" {
  forward_to = [prometheus.remote_write.grafana_cloud.receiver]
}

prometheus.remote_write "grafana_cloud" {
  endpoint {
    url = sys.env("GRAFANA_CLOUD_PROM_REMOTE_WRITE_ENDPOINT")
    basic_auth {
      username = sys.env("GRAFANA_CLOUD_METRICS_USER")
      password = sys.env("GRAFANA_CLOUD_API_TOKEN")
    }
  }
}
```

`Authorization: Bearer <token>` remains valid for gateways/proxies that are explicitly configured for bearer auth, but it is not the default Grafana Cloud OTLP setup shown in current Alloy docs.

## Current Limitations

1. Header-only tenant model: Sigil enforces tenant context, but does not provide user identity, token validation, or authorization policies by itself.
2. No native bearer validation in Sigil API: bearer is only supported through a proxy pattern.
3. Single-tenant request contract: Sigil endpoints use single-tenant extraction (`TenantID`), so multi-tenant query headers like `tenant-a|tenant-b` are not supported.
4. Fake-tenant mode collapses all traffic into one tenant and must not be used as isolation.
5. Traces/metrics tenant policy is externalized to collector/exporter config.
6. Helm convenience values `alloy.auth.*` inject `X-Scope-OrgID` and optional bearer header; Grafana Cloud Basic-auth topologies require customizing Alloy config.

## Tenant ID Rules

Sigil relies on `dskit/tenant` validation:

- max length: 150 characters
- allowed characters: `a-z`, `A-Z`, `0-9`, and `!-_.*'()`
- invalid values: `.` and `..`
- `|` is a tenant separator and cannot be used as part of a single tenant id
- `:` is reserved for subtenant semantics in dskit and should not be used in tenant IDs

## External References

- Grafana Alloy: OpenTelemetry to LGTM stack (Grafana Cloud auth examples): <https://grafana.com/docs/alloy/latest/collect/opentelemetry-to-lgtm-stack/>
- Grafana Cloud + Alloy OpenTelemetry guide: <https://grafana.com/docs/grafana-cloud/send-data/alloy/collect/opentelemetry-to-lgtm-stack/>
