---
owner: sigil-core
status: active
last_reviewed: 2026-02-12
source_of_truth: true
audience: contributors
---

# Helm Chart

This reference documents the Kubernetes Helm chart in `charts/sigil`.

## Scope

The chart deploys:

- Sigil API service
- optional bundled MySQL
- optional bundled Tempo
- optional bundled MinIO

The chart does not deploy Grafana or the Sigil plugin.

## Chart Location

- Chart root: `charts/sigil`
- Chart docs: `charts/sigil/README.md`

## Runtime Contract Mapping

The chart maps values into Sigil runtime env vars from `sigil/internal/config/config.go`:

- `SIGIL_HTTP_ADDR`
- `SIGIL_OTLP_GRPC_ADDR`
- `SIGIL_OTLP_HTTP_ADDR`
- `SIGIL_TARGET`
- `SIGIL_AUTH_ENABLED`
- `SIGIL_FAKE_TENANT_ID`
- `SIGIL_TEMPO_OTLP_GRPC_ENDPOINT`
- `SIGIL_TEMPO_OTLP_HTTP_ENDPOINT`
- `SIGIL_STORAGE_BACKEND`
- `SIGIL_MYSQL_DSN` (when backend is `mysql`)
- `SIGIL_OBJECT_STORE_ENDPOINT`
- `SIGIL_OBJECT_STORE_BUCKET`
- compactor settings (`SIGIL_COMPACTOR_*`)
- model-card settings (`SIGIL_MODEL_CARDS_*`)

## Deployment Modes

### Bundled dependencies

Default values run Sigil with in-cluster MySQL and Tempo.

### External dependencies

Disable bundled dependencies and set external endpoints/credentials:

- `mysql.enabled=false`
- `tempo.enabled=false`
- `minio.enabled=false`
- `sigil.storage.mysql.dsn`
- `sigil.tempo.grpcEndpoint`
- `sigil.tempo.httpEndpoint`
- `sigil.objectStore.endpoint`

### Split mode with singleton catalog sync

Optionally run API and catalog refresh as separate deployments while keeping the chart default backward-compatible:

- API deployment:
  - `sigil.target=server`
  - `replicaCount > 1`
- Singleton model-card sync deployment:
  - `catalogSync.enabled=true`
  - `catalogSync.replicaCount=1`
  - `catalogSync.target=catalog-sync`

## Testing and Packaging

`mise` tasks for chart workflows:

- `mise run lint:helm`: `helm lint` for `charts/sigil`
- `mise run test:helm`: lint + template-render checks for default/external/minio-enabled scenarios
- `mise run package:helm`: package chart archive to `dist/charts`

Helm hook smoke test is included in `templates/tests/test-healthz.yaml` and can be executed with:

```bash
helm test <release> -n <namespace>
```

## Production Guidance

For production use:

- use managed MySQL and Tempo where possible
- use external object storage for compacted payloads
- override dependency defaults and credentials via values/secrets
- pin `image.tag` to immutable build versions
