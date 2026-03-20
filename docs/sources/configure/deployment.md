---
title: Configure Sigil deployment
menuTitle: Tune deployment settings
description: Configure server-side settings for Sigil including storage, compaction, object storage, and service roles.
keywords:
  - Sigil
  - deployment
  - configuration
  - Helm
  - environment variables
weight: 2
---

# Configure Sigil deployment

This article covers server-side configuration for Sigil, including environment variables and Helm chart values.

## Service target

The `SIGIL_TARGET` environment variable (or `sigil.target` Helm value) controls which roles the Sigil process runs. The default is `all`.

| Target | Description |
|--------|-------------|
| `all` | Runs all roles in a single process. |
| `ingester` | Generation ingest (HTTP and gRPC) and eval enqueue. |
| `querier` | Query APIs, proxy endpoints, model cards, and eval control plane. |
| `compactor` | Data compaction and retention enforcement. |
| `eval-worker` | Evaluation execution. |
| `catalog-sync` | Model card refresh. |

## Network

| Variable | Default | Description |
|----------|---------|-------------|
| `SIGIL_HTTP_ADDR` | `:8080` | HTTP listen address. |
| `SIGIL_OTLP_GRPC_ADDR` | `:4317` | gRPC listen address for OTLP and generation ingest. |

## Authentication

| Variable | Default | Description |
|----------|---------|-------------|
| `SIGIL_AUTH_ENABLED` | `true` | Enforce tenant authentication. |
| `SIGIL_FAKE_TENANT_ID` | `fake` | Tenant ID injected when auth is disabled (development only). |

## MySQL storage

| Variable | Description |
|----------|-------------|
| `SIGIL_STORAGE_BACKEND` | Storage backend. Must be `mysql`. |
| `SIGIL_MYSQL_DSN` | MySQL connection string. |

## Object storage

| Variable | Description |
|----------|-------------|
| `SIGIL_OBJECT_STORE_BACKEND` | Backend type: `s3`, `gcs`, `azure`. |
| `SIGIL_OBJECT_STORE_BUCKET` | Bucket name. |
| `SIGIL_OBJECT_STORE_ENDPOINT` | S3-compatible endpoint. |
| `SIGIL_OBJECT_STORE_S3_REGION` | AWS region. |
| `SIGIL_OBJECT_STORE_ACCESS_KEY` | S3 access key. |
| `SIGIL_OBJECT_STORE_SECRET_KEY` | S3 secret key. |
| `SIGIL_OBJECT_STORE_INSECURE` | Use HTTP instead of HTTPS. |

GCS and Azure have equivalent `_GCS_*` and `_AZURE_*` variables.

## Compaction

| Variable | Default | Description |
|----------|---------|-------------|
| `SIGIL_COMPACTOR_COMPACT_INTERVAL` | `1m` | How often compaction runs. |
| `SIGIL_COMPACTOR_TRUNCATE_INTERVAL` | `5m` | How often truncation (hot cleanup) runs. |
| `SIGIL_COMPACTOR_RETENTION` | `1h` | How long hot data is kept before compaction. |
| `SIGIL_COMPACTOR_BATCH_SIZE` | `1000` | Generations processed per compaction cycle. |
| `SIGIL_COMPACTOR_LEASE_TTL` | `30s` | Claim lease duration for distributed compaction. |
| `SIGIL_COMPACTOR_SHARD_COUNT` | `8` | Number of shards per tenant for parallel compaction. |

## Query proxy

| Variable | Default | Description |
|----------|---------|-------------|
| `SIGIL_QUERY_PROXY_PROMETHEUS_BASE_URL` | `http://prometheus:9090` | Prometheus endpoint for metric queries. |
| `SIGIL_QUERY_PROXY_TEMPO_BASE_URL` | `http://tempo:3200` | Tempo endpoint for trace queries. |
| `SIGIL_QUERY_PROXY_TIMEOUT` | `30s` | Query proxy timeout. |

## Model cards

| Variable | Default | Description |
|----------|---------|-------------|
| `SIGIL_MODEL_CARDS_SYNC_INTERVAL` | `30m` | How often model card data refreshes. |
| `SIGIL_MODEL_CARDS_LEASE_TTL` | `2m` | Claim lease for sync coordination. |
| `SIGIL_MODEL_CARDS_SOURCE_TIMEOUT` | `15s` | Timeout for upstream model card sources. |

## Health endpoints

- `GET /healthz` — liveness probe.
- `GET /readyz` — readiness probe.

Both are unauthenticated.

## Next steps

- [Configure online evaluation](../evaluation/)
- [Helm chart reference](../../reference/helm-chart/)
