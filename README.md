# Grafana Sigil

<p align="center">
  <img src="./logo.png" alt="Grafana Sigil logo" width="280" />
</p>

Sigil is an OSS AI Observability project from Grafana.

Prompt-as-spell metaphor: you cast a sigil, then observe what happened.

## Bootstrap Architecture

- Grafana app plugin (`/apps/plugin`) for conversations, completions, traces, and settings.
- Go service (`/sigil`) for ingest and query:
  - OTLP gRPC `:4317`
  - OTLP HTTP `:4318/v1/traces`
  - Generation ingest and query APIs on `:8080`
- Tempo (docker compose) as trace storage.
- MySQL as default metadata and record-reference storage.
- Optional MinIO profile for object storage-backed payloads.
- SDKs (`/sdks`) with Go started first, Python/JS scaffolds present.

## Repository Layout

- `/apps/plugin`: Grafana app plugin and backend proxy layer.
- `/sigil`: Sigil ingest/query service skeleton.
- `/sdks/go`: Go SDK bootstrap.
- `/sdks/python`: Python SDK skeleton.
- `/sdks/js`: JS SDK skeleton.
- `/ARCHITECTURE.md`: canonical system architecture and contracts.
- `/docs/index.md`: canonical documentation catalog.

## Quickstart

```bash
mise trust
mise install
mise run doctor:go
mise run deps
mise run up
```

Grafana is available at [http://localhost:3000](http://localhost:3000).

To run with optional MinIO profile:

```bash
mise run up:object
```

## Toolchain Guardrails

The repository is pinned to Go `1.25.6` in `go.work` and all Go modules.

Run this after installing tools, or when your editor reports workspace load errors:

```bash
mise run doctor:go
```

If it reports a mismatch, apply the fix it prints (`go env -w GOTOOLCHAIN=go1.25.6+auto`) and restart your editor.

## Quality Checks (Local + CI)

Run the same quality gate used in GitHub Actions:

```bash
mise run deps
mise run ci
```

`mise run ci` runs:

- `format:check` (Go `gofmt` + plugin Prettier check)
- `lint` (Go + plugin lint)
- `typecheck` (plugin + JS SDK)

For full local validation including tests:

```bash
mise run check
```

## Current Scope

This repository is in bootstrap phase: contracts, folder structure, and dev stack are set up, while implementation logic remains intentionally minimal.
