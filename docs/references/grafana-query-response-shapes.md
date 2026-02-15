---
owner: sigil-core
status: active
last_reviewed: 2026-02-13
source_of_truth: true
audience: contributors
---

# Grafana Query Response Shapes Reference

## Purpose

Define the response envelope and data frame shapes Sigil query APIs must follow so plugin-proxied metrics and traces can be consumed by Grafana panel pipelines without custom adapters.

## Canonical Upstream Shapes

### Grafana frontend types

- `DataQueryResponse` and `DataQueryResponseData`:
  - <https://github.com/grafana/grafana/blob/main/packages/grafana-data/src/types/datasource.ts>
- `QueryResultMeta` and `preferredVisualisationType`:
  - <https://github.com/grafana/grafana/blob/main/packages/grafana-data/src/types/data.ts>
- Field and frame types (`FieldType`, including `nestedFrames`):
  - <https://github.com/grafana/grafana/blob/main/packages/grafana-data/src/types/dataFrame.ts>
- Trace row shape expectations:
  - <https://github.com/grafana/grafana/blob/main/packages/grafana-data/src/types/trace.ts>

### Grafana plugin SDK (Go backend)

- `backend.QueryDataResponse`, `backend.DataResponse`, and `data.FrameMeta`:
  - <https://pkg.go.dev/github.com/grafana/grafana-plugin-sdk-go/backend>
  - <https://pkg.go.dev/github.com/grafana/grafana-plugin-sdk-go/data>

### Datasource behavior references

- Tempo frame transformation and trace/search table conventions:
  - <https://github.com/grafana/grafana/blob/main/public/app/plugins/datasource/tempo/resultTransformer.ts>
- Prometheus result transformer conventions:
  - <https://github.com/grafana/grafana/blob/main/packages/grafana-prometheus/src/result_transformer.ts>

## Sigil Envelope Contract

Sigil query responses use Grafana datasource envelope semantics:

```json
{
  "results": {
    "A": {
      "frames": [
        {
          "schema": {
            "name": "Traces",
            "refId": "A",
            "meta": {
              "preferredVisualisationType": "table"
            },
            "fields": []
          },
          "data": {
            "values": []
          }
        }
      ]
    }
  }
}
```

Contract notes:

- top-level map key must be query refId (`A`, `B`, ...)
- each refId maps to `frames`
- frame metadata must set visualization hints where needed

## Sigil Frame Contracts

### Metrics frames

- include time + numeric value fields
- include labels/dimensions as string fields or labels metadata
- set frame metadata suitable for graph/table rendering

### Trace detail frames

- include trace row fields expected by Grafana trace view (`traceID`, `spanID`, `parentSpanID`, `operationName`, `serviceName`, `startTime`, `duration`, and tag/log/reference fields)
- set `meta.preferredVisualisationType` to `trace`

### Trace search frames

- default table fields follow Tempo conventions:
  - `traceID`, `startTime`, `traceService`, `traceName`, `traceDuration`
- nested span lists use `FieldType.nestedFrames` when returning span drill-down data

## Plugin Proxy Contract

All query traffic from Sigil frontend routes through plugin backend resources.

Current bootstrap endpoints on `main`:

- plugin frontend endpoints:
  - `GET /api/plugins/grafana-sigil-app/resources/query/conversations`
  - `GET /api/plugins/grafana-sigil-app/resources/query/conversations/{conversation_id}`
  - `GET /api/plugins/grafana-sigil-app/resources/query/conversations/{conversation_id}/ratings`
  - `POST /api/plugins/grafana-sigil-app/resources/query/conversations/{conversation_id}/ratings`
  - `GET /api/plugins/grafana-sigil-app/resources/query/conversations/{conversation_id}/annotations`
  - `POST /api/plugins/grafana-sigil-app/resources/query/conversations/{conversation_id}/annotations`
  - `GET /api/plugins/grafana-sigil-app/resources/query/completions`
  - `/api/plugins/grafana-sigil-app/resources/query/proxy/prometheus/...`
  - `/api/plugins/grafana-sigil-app/resources/query/proxy/tempo/...`
- plugin backend forwards to Sigil API:
  - `GET /api/v1/conversations`
  - `GET /api/v1/conversations/{conversation_id}`
  - `GET /api/v1/conversations/{conversation_id}/ratings`
  - `POST /api/v1/conversations/{conversation_id}/ratings`
  - `GET /api/v1/conversations/{conversation_id}/annotations`
  - `POST /api/v1/conversations/{conversation_id}/annotations`
  - `GET /api/v1/completions`
  - `/api/v1/proxy/prometheus/...`
  - `/api/v1/proxy/tempo/...`

Sigil now also exposes backend query pass-through routes for downstream data sources:

- `/api/v1/proxy/prometheus/...` (Prometheus/Mimir allowlisted query/read paths)
- `/api/v1/proxy/tempo/...` (Tempo allowlisted search/trace/TraceQL-metrics paths)

Plugin integration for these Sigil routes is now implemented through plugin resource proxy prefixes.

Phase 2 target contract:

- plugin frontend endpoint:
  - `POST /api/plugins/grafana-sigil-app/resources/query`
- plugin backend forwards to Sigil API:
  - `POST /api/v1/query`

Frontend must not call Sigil API query endpoints directly.

## Validation Checklist

- response envelope keys map to query refIds
- every frame contains consistent field lengths
- trace frames include required trace-view fields and metadata
- metrics frames are directly plottable in graph/table panels
- nested span frames use valid nested frame typing
- plugin proxy path is the only frontend query path
