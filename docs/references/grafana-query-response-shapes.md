---
owner: sigil-core
status: active
last_reviewed: 2026-03-04
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

### Conversation search payload

`POST /query/conversations/search` returns JSON rows (not Grafana frames) with:

- `conversation_id` (required)
- `conversation_title` (optional, derived from latest matching span `sigil.conversation.title`)
- `generation_count`, `first_generation_at`, `last_generation_at`
- `models`, `model_providers`, `agents`
- `error_count`, `has_errors`
- `trace_ids`
- `rating_summary`, `annotation_count`, `eval_summary`
- `selected` (optional map of requested select keys to aggregated values)

## Plugin Proxy Contract

All query traffic from Sigil frontend routes through plugin backend resources.

Current query endpoints:

- plugin frontend endpoints:
  - `POST /api/plugins/grafana-sigil-app/resources/query/conversations/search`
  - `GET /api/plugins/grafana-sigil-app/resources/query/conversations`
  - `GET /api/plugins/grafana-sigil-app/resources/query/conversations/{conversation_id}`
  - `GET /api/plugins/grafana-sigil-app/resources/query/generations/{generation_id}`
  - `GET /api/plugins/grafana-sigil-app/resources/query/search/tags`
  - `GET /api/plugins/grafana-sigil-app/resources/query/search/tag/{tag}/values`
  - `GET /api/plugins/grafana-sigil-app/resources/query/conversations/{conversation_id}/ratings`
  - `POST /api/plugins/grafana-sigil-app/resources/query/conversations/{conversation_id}/ratings`
  - `GET /api/plugins/grafana-sigil-app/resources/query/conversations/{conversation_id}/annotations`
  - `POST /api/plugins/grafana-sigil-app/resources/query/conversations/{conversation_id}/annotations`
  - `/api/plugins/grafana-sigil-app/resources/query/proxy/prometheus/...`
  - `/api/plugins/grafana-sigil-app/resources/query/proxy/tempo/...`
- plugin backend forwards to Sigil API:
  - `POST /api/v1/conversations:batch-metadata` (search hydration only)
  - `GET /api/v1/conversations`
  - `GET /api/v1/conversations/{conversation_id}`
  - `GET /api/v1/generations/{generation_id}`
  - `GET /api/v1/conversations/{conversation_id}/ratings`
  - `POST /api/v1/conversations/{conversation_id}/ratings`
  - `GET /api/v1/conversations/{conversation_id}/annotations`
  - `POST /api/v1/conversations/{conversation_id}/annotations`

Conversation search and tag discovery are plugin-owned flows that call Tempo through Grafana datasource proxy APIs and then hydrate rows via Sigil `POST /api/v1/conversations:batch-metadata`.

Plugin integration for these Sigil routes is now implemented through plugin resource proxy prefixes.

Removed placeholders:

- `GET /api/v1/completions`
- `GET /api/v1/traces/{trace_id}`

Frontend must not call Sigil API query endpoints directly.

## Validation Checklist

- response envelope keys map to query refIds
- every frame contains consistent field lengths
- trace frames include required trace-view fields and metadata
- metrics frames are directly plottable in graph/table panels
- nested span frames use valid nested frame typing
- plugin proxy path is the only frontend query path
