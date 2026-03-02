# Sigil Helm Chart

This chart deploys the Sigil API and can optionally deploy local backing services used by Sigil:

- Alloy (`alloy.enabled=true` by default)
- MySQL (`mysql.enabled=true` by default)
- Tempo (`tempo.enabled=true` by default)
- Prometheus (`prometheus.enabled=true` by default)
- MinIO (`minio.enabled=true` by default)

The chart supports monolith (`SIGIL_TARGET=all`) and role-split deployments (ingester/querier/compactor/eval-worker/catalog-sync). Grafana and the Sigil plugin are intentionally out of scope for this chart.

## What Gets Installed

Installed when `api.enabled=true` (default):

- Sigil API `Deployment`
- Sigil API `Service` with ports:
  - `http` (default `8080`)
  - `otlp-grpc` (default `4317`, generation ingest gRPC contract)
- Optional `Ingress`
- Optional Helm test hook pod (`tests.enabled=true`)

Optional components:

- Role deployments:
  - `ingester` deployment + service (`ingester.enabled=true`)
  - `querier` deployment + service (`querier.enabled=true`)
  - `compactor` deployment (`compactor.enabled=true`)
  - `eval-worker` deployment (`evalWorker.enabled=true`)
  - `catalog-sync` deployment (`catalogSync.enabled=true`)
- Alloy `Deployment` + `Service` + `ConfigMap`
- MySQL `Deployment` + `Service` + optional `PersistentVolumeClaim`
- Tempo `Deployment` + `Service` + `ConfigMap` + optional `PersistentVolumeClaim`
- Prometheus `Deployment` + `Service` + `ConfigMap` + optional `PersistentVolumeClaim`
- MinIO `Deployment` + `Service` + optional `PersistentVolumeClaim`

## Prerequisites

- Kubernetes `>= 1.27`
- Helm `>= 3.10`
- A Sigil API container image available to your cluster

## Quick Start

1. Build/publish a Sigil image and choose the image tag.
   - Main-branch image publishing is automated by `.github/workflows/sigil-image-publish.yml`.
   - Published image tags on main are `ghcr.io/grafana/sigil:<git-sha>` and `ghcr.io/grafana/sigil:latest`.
2. Install the chart using defaults (`ghcr.io/grafana/sigil:latest`):

```bash
helm upgrade --install sigil ./charts/sigil \
  --namespace sigil \
  --create-namespace
```

To pin to an immutable published image from CI, override the tag:

```bash
helm upgrade --install sigil ./charts/sigil \
  --namespace sigil \
  --create-namespace \
  --set image.tag=<git-sha>
```

This works with object storage out of the box because MinIO is enabled by default.

3. Verify health endpoint:

```bash
kubectl -n sigil port-forward svc/sigil-sigil 8080:8080
curl http://127.0.0.1:8080/healthz
```

4. Run Helm test hook:

```bash
helm test sigil -n sigil
```

## Deployment Modes

### 1) Self-contained (default)

Default chart values deploy Sigil + Alloy + Tempo + Prometheus + MySQL + MinIO in the same namespace.

```bash
helm upgrade --install sigil ./charts/sigil \
  --set image.repository=<your-image-repository> \
  --set image.tag=<your-image-tag>
```

### 2) External dependencies

Disable bundled dependencies and point Sigil to your managed services:

```bash
helm upgrade --install sigil ./charts/sigil \
  --set image.repository=<your-image-repository> \
  --set image.tag=<your-image-tag> \
  --set mysql.enabled=false \
  --set alloy.enabled=false \
  --set tempo.enabled=false \
  --set prometheus.enabled=false \
  --set minio.enabled=false \
  --set sigil.storage.mysql.dsn='sigil:sigil@tcp(mysql.example:3306)/sigil?parseTime=true' \
  --set sigil.objectStore.backend='s3' \
  --set sigil.objectStore.bucket='sigil' \
  --set sigil.objectStore.s3.endpoint='https://s3.example'
```

### 2b) Split role deployments

This runs each Sigil runtime role as its own deployment in one release.

```bash
helm upgrade --install sigil ./charts/sigil \
  --set image.repository=<your-image-repository> \
  --set image.tag=<your-image-tag> \
  --set api.enabled=false \
  --set ingester.enabled=true \
  --set ingester.replicaCount=2 \
  --set querier.enabled=true \
  --set querier.replicaCount=3 \
  --set compactor.enabled=true \
  --set compactor.replicaCount=2 \
  --set evalWorker.enabled=true \
  --set evalWorker.replicaCount=2 \
  --set catalogSync.enabled=true \
  --set catalogSync.replicaCount=1
```

Note:

- The `querier` target runs query APIs and model-card sync loop.
- The `ingester` target runs generation ingest HTTP/gRPC plus eval enqueue dispatch.
- Model-card catalog state is shared through MySQL, so `catalog-sync` refreshes are visible to all queriers.

### 3) Disable MinIO (external object storage)

```bash
helm upgrade --install sigil ./charts/sigil \
  --set image.repository=<your-image-repository> \
  --set image.tag=<your-image-tag> \
  --set minio.enabled=false
```

When `minio.enabled=true` and `sigil.objectStore.s3.endpoint` is empty, the chart auto-wires Sigil to in-cluster MinIO.

### 4) Select cloud backend

Google Cloud Storage:

```bash
helm upgrade --install sigil ./charts/sigil \
  --set minio.enabled=false \
  --set sigil.objectStore.backend='gcs' \
  --set sigil.objectStore.bucket='sigil-gcs' \
  --set sigil.objectStore.gcs.bucket='sigil-gcs'
```

Azure Blob Storage:

```bash
helm upgrade --install sigil ./charts/sigil \
  --set minio.enabled=false \
  --set sigil.objectStore.backend='azure' \
  --set sigil.objectStore.bucket='sigil' \
  --set sigil.objectStore.azure.container='sigil' \
  --set sigil.objectStore.azure.storageAccountName='<account>' \
  --set sigil.objectStore.azure.storageAccountKey='<key>'
```

## Key Values

Use `helm show values ./charts/sigil` for the full configuration surface.

Important values:

- `image.repository`, `image.tag`: Sigil API image
- `api.enabled`, `replicaCount`, `sigil.target`: primary deployment toggle/count/target (`all|server|ingester|querier|compactor|catalog-sync|eval-worker`)
- `ingester.*`, `querier.*`, `compactor.*`, `evalWorker.*`, `catalogSync.*`: optional dedicated role deployments
- `sigil.auth.enabled`, `sigil.auth.fakeTenantID`: tenant/auth behavior
- `sigil.queryProxy.prometheusBaseURL`, `sigil.queryProxy.tempoBaseURL`, `sigil.queryProxy.timeout`: downstream query-proxy settings for Prometheus/Mimir and Tempo pass-through routes
- `sigil.grafana.url`, `sigil.grafana.serviceAccountToken`, `sigil.grafana.tempoDatasourceUID`: optional Grafana datasource-proxy settings for server-side Tempo queries
- `sigil.storage.backend`: storage backend (`mysql` only)
- `sigil.storage.mysql.dsn`: required for external MySQL when `mysql.enabled=false`
- `alloy.outputs.tempo.endpoint`: external Tempo OTLP gRPC endpoint for Alloy
- `alloy.outputs.prometheus.endpoint`: external Prometheus OTLP endpoint for Alloy
- `alloy.auth.*`: optional tenant/bearer header injection for Alloy exporters
- `sigil.objectStore.backend`, `sigil.objectStore.bucket`: object store backend + shared bucket/container fallback
- `sigil.objectStore.s3.*`: S3/MinIO endpoint + auth (`accessKey`, `secretKey`, `useAWSSDKAuth`, `region`, `insecure`)
- `sigil.objectStore.gcs.*`: GCS bucket/service account/grpc toggle
- `sigil.objectStore.azure.*`: Azure container/account/auth/endpoint/create-container toggle
- `sigil.compactor.*`: compactor schedule/lease/shard/worker/claim/block-size tuning
- `sigil.modelCards.*`: model-card sync/freshness/bootstrap settings
- `mysql.*`, `alloy.*`, `tempo.*`, `prometheus.*`, `minio.*`: optional bundled dependency settings
- `tests.enabled`: enable/disable Helm hook test pod

## Testing and Linting

Repository-level `mise` tasks are provided:

- `mise run lint:helm`
- `mise run test:helm`
- `mise run package:helm`

`test:helm` runs chart lint and template-render tests for:

- default bundled-dependency mode (includes MinIO)
- external-dependency mode (S3)
- external-dependency mode (GCS)
- external-dependency mode (Azure)
- explicit MinIO-enabled mode
- split role deployments (ingester + querier + compactor + eval-worker + catalog-sync)

## Operational Notes

- The chart defaults to `ghcr.io/grafana/sigil:latest`.
- For production, prefer pinning `image.tag` to a published commit SHA image instead of `latest`.
- The bundled Alloy/Tempo/Prometheus/MySQL/MinIO workloads are aimed at simple deployments and development clusters.
- For production, use managed external services and override endpoints/credentials via values.
