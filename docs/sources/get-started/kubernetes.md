---
title: Deploy Sigil on Kubernetes
menuTitle: Deploy to Kubernetes
description: Install Sigil on Kubernetes using the Helm chart with bundled or external dependencies.
keywords:
  - Sigil
  - Kubernetes
  - Helm
  - deployment
  - self-hosted
weight: 11
---

# Deploy Sigil on Kubernetes

This guide shows you how to deploy Sigil on Kubernetes using the Helm chart. The chart includes bundled dependencies (MySQL, Tempo, Prometheus, Alloy, MinIO) for quick setup, or you can point to external services.

## Before you begin

- A Kubernetes cluster (1.26 or later).
- Helm 3 installed.
- `kubectl` configured to access your cluster.

## Install the default stack

The default chart installs Sigil with all bundled dependencies:

```bash
helm upgrade --install sigil ./charts/sigil \
  --namespace sigil \
  --create-namespace
```

This creates a self-contained stack with:

- Sigil API (ports `8080` HTTP, `4317` OTLP gRPC)
- MySQL for generation storage
- Tempo for distributed traces
- Prometheus for metrics
- Alloy as the OpenTelemetry collector
- MinIO for object storage

## Configure external dependencies

For production, use external services instead of bundled ones. Disable bundled services and provide connection details:

```yaml
# values-production.yaml
mysql:
  enabled: false
tempo:
  enabled: false
prometheus:
  enabled: false
minio:
  enabled: false

sigil:
  storage:
    mysql:
      dsn: "<MYSQL_DSN>"
  objectStore:
    backend: s3
    bucket: sigil-data
    s3:
      endpoint: "<S3_ENDPOINT>"
      region: "<AWS_REGION>"
      accessKey: "<ACCESS_KEY>"
      secretKey: "<SECRET_KEY>"
  queryProxy:
    prometheusBaseURL: "<PROMETHEUS_URL>"
    tempoBaseURL: "<TEMPO_URL>"
```

Apply with:

```bash
helm upgrade --install sigil ./charts/sigil \
  --namespace sigil \
  --create-namespace \
  -f values-production.yaml
```

## Split role deployment

For high-throughput environments, run Sigil components as separate deployments. Set `sigil.target` to a specific role:

| Target | Role |
|--------|------|
| `all` | All-in-one (default) |
| `ingester` | Generation ingest (HTTP/gRPC) and eval enqueue |
| `querier` | Query APIs, proxy, model cards, eval control plane |
| `compactor` | Data compaction and retention |
| `eval-worker` | Evaluation execution |
| `catalog-sync` | Model card refresh |

Example for running ingester and querier separately:

```bash
helm upgrade --install sigil-ingester ./charts/sigil \
  --set sigil.target=ingester \
  --set replicaCount=3 \
  --namespace sigil

helm upgrade --install sigil-querier ./charts/sigil \
  --set sigil.target=querier \
  --set replicaCount=2 \
  --namespace sigil
```

## Configure object storage

Sigil supports multiple object storage backends for compacted generation data:

| Backend | Config key |
|---------|-----------|
| AWS S3 | `sigil.objectStore.backend: s3` |
| Google Cloud Storage | `sigil.objectStore.backend: gcs` |
| Azure Blob Storage | `sigil.objectStore.backend: azure` |
| MinIO | `sigil.objectStore.backend: s3` with MinIO endpoint |

## Enable authentication

Authentication is enabled by default. For production deployments, ensure `sigil.auth.enabled` is `true`:

```yaml
sigil:
  auth:
    enabled: true
```

## Verify the deployment

Check that all pods are running:

```bash
kubectl get pods -n sigil
```

Port-forward the Sigil API to verify:

```bash
kubectl port-forward -n sigil svc/sigil 8080:8080
curl http://localhost:8080/healthz
```

## Next steps

- [Configure deployment options](../../configure/deployment/)
- [Configure online evaluation](../../configure/evaluation/)
- [Use built-in dashboards](../../guides/dashboards/)
