---
owner: sigil-core
status: active
last_reviewed: 2026-02-14
source_of_truth: true
audience: contributors
---

# Helm Chart

This reference documents the Kubernetes Helm chart in `charts/sigil`.

## Scope

The chart deploys:

- Sigil API service
- optional bundled Alloy
- optional bundled MySQL
- optional bundled Tempo
- optional bundled Prometheus
- bundled MinIO (enabled by default)

The chart does not deploy Grafana or the Sigil plugin.

## Chart Location

- Chart root: `charts/sigil`
- Chart docs: `charts/sigil/README.md`

## Runtime Contract Mapping

The chart maps values into Sigil runtime env vars from `sigil/internal/config/config.go`:

- `SIGIL_HTTP_ADDR`
- `SIGIL_OTLP_GRPC_ADDR`
- `SIGIL_TARGET`
- `SIGIL_AUTH_ENABLED`
- `SIGIL_FAKE_TENANT_ID`
- `SIGIL_QUERY_PROXY_PROMETHEUS_BASE_URL`
- `SIGIL_QUERY_PROXY_TEMPO_BASE_URL`
- `SIGIL_QUERY_PROXY_TIMEOUT`
- `SIGIL_STORAGE_BACKEND`
- `SIGIL_MYSQL_DSN` (when backend is `mysql`)
- `SIGIL_OBJECT_STORE_BACKEND`
- `SIGIL_OBJECT_STORE_ENDPOINT`
- `SIGIL_OBJECT_STORE_BUCKET`
- `SIGIL_OBJECT_STORE_ACCESS_KEY`
- `SIGIL_OBJECT_STORE_SECRET_KEY`
- `SIGIL_OBJECT_STORE_INSECURE`
- `SIGIL_OBJECT_STORE_S3_REGION`
- `SIGIL_OBJECT_STORE_S3_AWS_SDK_AUTH`
- `SIGIL_OBJECT_STORE_GCS_BUCKET`
- `SIGIL_OBJECT_STORE_GCS_SERVICE_ACCOUNT`
- `SIGIL_OBJECT_STORE_GCS_USE_GRPC`
- `SIGIL_OBJECT_STORE_AZURE_CONTAINER`
- `SIGIL_OBJECT_STORE_AZURE_STORAGE_ACCOUNT`
- `SIGIL_OBJECT_STORE_AZURE_STORAGE_ACCOUNT_KEY`
- `SIGIL_OBJECT_STORE_AZURE_STORAGE_CONNECTION_STRING`
- `SIGIL_OBJECT_STORE_AZURE_ENDPOINT`
- `SIGIL_OBJECT_STORE_AZURE_CREATE_CONTAINER`
- `SIGIL_COMPACTOR_COMPACT_INTERVAL`
- `SIGIL_COMPACTOR_TRUNCATE_INTERVAL`
- `SIGIL_COMPACTOR_RETENTION`
- `SIGIL_COMPACTOR_BATCH_SIZE`
- `SIGIL_COMPACTOR_LEASE_TTL`
- `SIGIL_COMPACTOR_SHARD_COUNT`
- `SIGIL_COMPACTOR_SHARD_WINDOW_SECONDS`
- `SIGIL_COMPACTOR_WORKERS`
- `SIGIL_COMPACTOR_CYCLE_BUDGET`
- `SIGIL_COMPACTOR_CLAIM_TTL`
- `SIGIL_COMPACTOR_TARGET_BLOCK_BYTES`
- model-card settings (`SIGIL_MODEL_CARDS_*`)

## Deployment Modes

### Bundled dependencies

Default values run Sigil with in-cluster Alloy, Tempo, Prometheus, MySQL, and MinIO.

### External dependencies

Disable bundled dependencies and set external endpoints/credentials:

- `mysql.enabled=false`
- `alloy.enabled=false`
- `tempo.enabled=false`
- `prometheus.enabled=false`
- `minio.enabled=false`
- `sigil.storage.mysql.dsn`
- `alloy.outputs.tempo.endpoint`
- `alloy.outputs.prometheus.endpoint`
- `sigil.objectStore.backend`
- `sigil.objectStore.bucket`
- provider-specific values under `sigil.objectStore.s3.*`, `sigil.objectStore.gcs.*`, or `sigil.objectStore.azure.*`

### Split mode with singleton catalog sync

Optionally run API and catalog refresh as separate deployments while keeping the chart default backward-compatible:

- API deployment:
  - `sigil.target=server`
  - `replicaCount > 1`
- Singleton model-card sync deployment:
  - `catalogSync.enabled=true`
  - `catalogSync.replicaCount=1`
  - `catalogSync.target=catalog-sync`

Note:

- Model-card cache is in-memory per process.
- `catalog-sync` does not replicate catalog state into API pods.
- If you want API pods to self-refresh in-memory cache, keep `sigil.target=server` and rely on each pod refresh loop.

## Testing and Packaging

`mise` tasks for chart workflows:

- `mise run lint:helm`: `helm lint` for `charts/sigil`
- `mise run test:helm`: lint + template-render checks for default + external (S3/GCS/Azure) + minio-enabled scenarios
- `mise run package:helm`: package chart archive to `dist/charts`

Helm hook smoke test is included in `templates/tests/test-healthz.yaml` and can be executed with:

```bash
helm test <release> -n <namespace>
```

## Production Guidance

For production use:

- use managed MySQL and Tempo where possible
- use managed collector + Tempo + Prometheus where possible
- use external object storage for compacted payloads
- override dependency defaults and credentials via values/secrets
- pin `image.tag` to immutable build versions
