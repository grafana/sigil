---
title: Helm chart reference
menuTitle: Explore Helm chart values
description: Configuration values for the Sigil Kubernetes Helm chart.
keywords:
  - Sigil
  - Helm
  - Kubernetes
  - chart
  - values
weight: 3
---

# Helm chart reference

The Sigil Helm chart deploys the Sigil API and optional bundled dependencies to Kubernetes.

## Core values

| Value | Default | Description |
|-------|---------|-------------|
| `replicaCount` | `1` | Number of Sigil API replicas. |
| `image.repository` | `ghcr.io/grafana/sigil` | Container image. |
| `image.tag` | `latest` | Image tag. |
| `image.pullPolicy` | `Always` | Image pull policy. |
| `api.enabled` | `true` | Enable the Sigil API deployment. |

## Service

| Value | Default | Description |
|-------|---------|-------------|
| `service.type` | `ClusterIP` | Service type. |
| `service.ports.http` | `8080` | HTTP port. |
| `service.ports.otlpGrpc` | `4317` | OTLP gRPC port. |

## Sigil configuration

| Value | Default | Description |
|-------|---------|-------------|
| `sigil.target` | `all` | Deployment role: `all`, `ingester`, `querier`, `compactor`, `eval-worker`, `catalog-sync`. |
| `sigil.auth.enabled` | `true` | Enable tenant authentication. |
| `sigil.auth.fakeTenantID` | `fake` | Fake tenant ID for auth-disabled mode. |

## Query proxy

| Value | Default | Description |
|-------|---------|-------------|
| `sigil.queryProxy.prometheusBaseURL` | `http://prometheus:9090` | Prometheus endpoint. |
| `sigil.queryProxy.tempoBaseURL` | `http://tempo:3200` | Tempo endpoint. |
| `sigil.queryProxy.timeout` | `30s` | Query timeout. |

## Storage

| Value | Default | Description |
|-------|---------|-------------|
| `sigil.storage.backend` | `mysql` | Storage backend. |
| `sigil.storage.mysql.dsn` | `""` | MySQL connection string. |

## Object storage

| Value | Default | Description |
|-------|---------|-------------|
| `sigil.objectStore.backend` | `s3` | Object storage backend: `s3`, `gcs`, `azure`. |
| `sigil.objectStore.bucket` | `sigil` | Bucket name. |
| `sigil.objectStore.s3.endpoint` | `""` | S3 endpoint. |
| `sigil.objectStore.s3.region` | `""` | AWS region. |
| `sigil.objectStore.s3.accessKey` | `""` | Access key. |
| `sigil.objectStore.s3.secretKey` | `""` | Secret key. |
| `sigil.objectStore.s3.insecure` | `true` | Use HTTP instead of HTTPS. |

## Compaction

| Value | Default | Description |
|-------|---------|-------------|
| `sigil.compactor.compactInterval` | `1m` | Compaction frequency. |
| `sigil.compactor.truncateInterval` | `5m` | Hot data cleanup frequency. |
| `sigil.compactor.retention` | `1h` | Hot data retention period. |
| `sigil.compactor.batchSize` | `1000` | Generations per compaction cycle. |
| `sigil.compactor.leaseTTL` | `30s` | Distributed claim lease duration. |
| `sigil.compactor.shardCount` | `8` | Per-tenant parallel shards. |

## Model cards

| Value | Default | Description |
|-------|---------|-------------|
| `sigil.modelCards.syncInterval` | `30m` | Sync frequency. |
| `sigil.modelCards.leaseTTL` | `2m` | Claim lease duration. |
| `sigil.modelCards.sourceTimeout` | `15s` | Upstream source timeout. |

## Bundled dependencies

| Value | Default | Description |
|-------|---------|-------------|
| `mysql.enabled` | `true` | Deploy bundled MySQL. |
| `alloy.enabled` | `true` | Deploy bundled Alloy collector. |
| `tempo.enabled` | `true` | Deploy bundled Tempo. |
| `prometheus.enabled` | `true` | Deploy bundled Prometheus. |
| `minio.enabled` | `true` | Deploy bundled MinIO. |

Set any of these to `false` and provide external service endpoints instead.

## Health probes

| Probe | Path | Default delay |
|-------|------|--------------|
| Liveness | `/healthz` | 10s initial, 10s period |
| Readiness | `/readyz` | 5s initial, 5s period |
