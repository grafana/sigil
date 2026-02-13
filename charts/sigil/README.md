# Sigil Helm Chart

This chart deploys the Sigil API and can optionally deploy local backing services used by Sigil:

- MySQL (`mysql.enabled=true` by default)
- Tempo (`tempo.enabled=true` by default)
- MinIO (`minio.enabled=true` by default)

The chart deploys the `sigil` service only. Grafana and the Sigil plugin are intentionally out of scope for this chart.

## What Gets Installed

Always installed:

- Sigil `Deployment`
- Sigil `Service` with ports:
  - `http` (default `8080`)
  - `otlp-grpc` (default `4317`)
  - `otlp-http` (default `4318`)
- Optional `Ingress`
- Optional Helm test hook pod (`tests.enabled=true`)

Optional components:

- MySQL `Deployment` + `Service` + optional `PersistentVolumeClaim`
- Tempo `Deployment` + `Service` + `ConfigMap` + optional `PersistentVolumeClaim`
- MinIO `Deployment` + `Service` + optional `PersistentVolumeClaim`

## Prerequisites

- Kubernetes `>= 1.27`
- Helm `>= 3.10`
- A Sigil API container image available to your cluster

## Quick Start

1. Build/publish a Sigil image and choose the image tag.
2. Install the chart:

```bash
helm upgrade --install sigil ./charts/sigil \
  --namespace sigil \
  --create-namespace \
  --set image.repository=<your-image-repository> \
  --set image.tag=<your-image-tag>
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

Default chart values deploy Sigil + MySQL + Tempo + MinIO in the same namespace.

```bash
helm upgrade --install sigil ./charts/sigil \
  --set image.repository=<your-image-repository> \
  --set image.tag=<your-image-tag>
```

### 2) External MySQL/Tempo/Object Storage

Disable bundled dependencies and point Sigil to your managed services:

```bash
helm upgrade --install sigil ./charts/sigil \
  --set image.repository=<your-image-repository> \
  --set image.tag=<your-image-tag> \
  --set mysql.enabled=false \
  --set tempo.enabled=false \
  --set minio.enabled=false \
  --set sigil.storage.mysql.dsn='sigil:sigil@tcp(mysql.example:3306)/sigil?parseTime=true' \
  --set sigil.tempo.grpcEndpoint='tempo.example:4317' \
  --set sigil.tempo.httpEndpoint='tempo.example:4318' \
  --set sigil.objectStore.backend='s3' \
  --set sigil.objectStore.bucket='sigil' \
  --set sigil.objectStore.s3.endpoint='https://s3.example'
```

### 2b) Split mode with dedicated singleton catalog sync

This keeps API replicas focused on serving traffic and runs model-card refresh in a separate singleton deployment.

```bash
helm upgrade --install sigil ./charts/sigil \
  --set image.repository=<your-image-repository> \
  --set image.tag=<your-image-tag> \
  --set sigil.target=server \
  --set replicaCount=3 \
  --set catalogSync.enabled=true \
  --set catalogSync.replicaCount=1 \
  --set catalogSync.target=catalog-sync
```

Note:

- Model-card cache is in-memory per process.
- A dedicated `catalog-sync` pod does not propagate model-card data to separate API pods.
- If you want each API pod to keep a fresh in-memory catalog, keep `sigil.target=server` and let each pod refresh independently.

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
- `sigil.target`: runtime target (`all|server|querier|compactor|catalog-sync`)
- `sigil.auth.enabled`, `sigil.auth.fakeTenantID`: tenant/auth behavior
- `sigil.storage.backend`: storage backend (`mysql` or `memory`)
- `sigil.storage.mysql.dsn`: required for external MySQL when `mysql.enabled=false`
- `sigil.tempo.grpcEndpoint`, `sigil.tempo.httpEndpoint`: external Tempo endpoints
- `sigil.objectStore.backend`, `sigil.objectStore.bucket`: object store backend + shared bucket/container fallback
- `sigil.objectStore.s3.*`: S3/MinIO endpoint + auth (`accessKey`, `secretKey`, `useAWSSDKAuth`, `region`, `insecure`)
- `sigil.objectStore.gcs.*`: GCS bucket/service account/grpc toggle
- `sigil.objectStore.azure.*`: Azure container/account/auth/endpoint/create-container toggle
- `sigil.compactor.*`: compactor schedule/lease/shard/worker/claim/block-size tuning
- `sigil.modelCards.*`: model-card sync/freshness/bootstrap settings
- `catalogSync.enabled`, `catalogSync.replicaCount`, `catalogSync.target`: optional dedicated singleton model-card sync deployment
- `mysql.*`, `tempo.*`, `minio.*`: optional bundled dependency settings
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

## Operational Notes

- The default chart image repository is a placeholder (`ghcr.io/grafana/sigil`); override it for real deployments.
- The bundled MySQL/Tempo/MinIO workloads are aimed at simple deployments and development clusters.
- For production, use managed external services and override endpoints/credentials via values.
