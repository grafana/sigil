# Sigil Helm Chart

This chart deploys the Sigil API and can optionally deploy local backing services used by Sigil:

- MySQL (`mysql.enabled=true` by default)
- Tempo (`tempo.enabled=true` by default)
- MinIO (`minio.enabled=false` by default)

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

Default chart values deploy Sigil + MySQL + Tempo in the same namespace.

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
  --set sigil.objectStore.endpoint='https://object-store.example'
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

### 3) Enable MinIO for object storage

```bash
helm upgrade --install sigil ./charts/sigil \
  --set image.repository=<your-image-repository> \
  --set image.tag=<your-image-tag> \
  --set minio.enabled=true
```

When `minio.enabled=true` and `sigil.objectStore.endpoint` is empty, the chart auto-wires Sigil to in-cluster MinIO.

## Key Values

Use `helm show values ./charts/sigil` for the full configuration surface.

Important values:

- `image.repository`, `image.tag`: Sigil API image
- `sigil.target`: runtime target (`all|server|querier|compactor|catalog-sync`)
- `sigil.auth.enabled`, `sigil.auth.fakeTenantID`: tenant/auth behavior
- `sigil.storage.backend`: storage backend (`mysql` or `memory`)
- `sigil.storage.mysql.dsn`: required for external MySQL when `mysql.enabled=false`
- `sigil.tempo.grpcEndpoint`, `sigil.tempo.httpEndpoint`: external Tempo endpoints
- `sigil.objectStore.endpoint`, `sigil.objectStore.bucket`: object storage config
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

- default bundled-dependency mode
- external-dependency mode
- MinIO-enabled mode

## Operational Notes

- The default chart image repository is a placeholder (`ghcr.io/grafana/sigil`); override it for real deployments.
- The bundled MySQL/Tempo/MinIO workloads are aimed at simple deployments and development clusters.
- For production, use managed external services and override endpoints/credentials via values.
