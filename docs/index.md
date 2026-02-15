---
owner: sigil-core
status: active
last_reviewed: 2026-02-14
source_of_truth: true
audience: both
---

# Docs Index

This is the canonical navigation map for repository documentation.

## Core Sources

- `ARCHITECTURE.md`: canonical system architecture, data flow, and contracts.
- `AGENTS.md`: repository workflow guardrails and doc update triggers.
- `../sigil`: Sigil service source module.

## Domain Guides

- [`DESIGN.md`](DESIGN.md)
- [`FRONTEND.md`](FRONTEND.md)
- [`PLANS.md`](PLANS.md)
- [`PRODUCT_SENSE.md`](PRODUCT_SENSE.md)
- [`QUALITY_SCORE.md`](QUALITY_SCORE.md)
- [`RELIABILITY.md`](RELIABILITY.md)
- [`SECURITY.md`](SECURITY.md)

## Structured Collections

- Design docs: [`design-docs/index.md`](design-docs/index.md)
- Product specs: [`product-specs/index.md`](product-specs/index.md)
- SDK docs:
  - Java SDK README: `../sdks/java/README.md`
  - JS/TS SDK docs index: `../sdks/js/docs/index.md`
  - JS/TS SDK README: `../sdks/js/README.md`
  - .NET SDK README: `../sdks/dotnet/README.md`
  - Python SDK README: `../sdks/python/README.md`
  - Go SDK README: `../sdks/go/README.md`
- Execution plans:
  - Active: `exec-plans/active/`
  - Current implementation priority: query proxy, then hybrid storage/query behavior, then compaction scaling and cross-track consistency
  - Phase 2 umbrella coordinator: `exec-plans/active/2026-02-12-phase-2-delivery.md`
  - Phase 2 parallel tracks:
    - `exec-plans/active/2026-02-12-phase-2-query-proxy.md`
    - `exec-plans/active/2026-02-12-phase-2-hybrid-storage.md`
    - `exec-plans/active/2026-02-13-compaction-scaling.md`
  - Completed: `exec-plans/completed/`
    - `exec-plans/completed/2026-02-11-bootstrap-phase-1.md` (superseded)
    - `exec-plans/completed/2026-02-12-model-card-catalog-refresh.md`
    - `exec-plans/completed/2026-02-12-generation-first-ingest.md`
    - `exec-plans/completed/2026-02-12-agent-identity-fields.md`
    - `exec-plans/completed/2026-02-12-phase-2-sdk-parity-python.md`
    - `exec-plans/completed/2026-02-12-phase-2-sdk-parity-typescript-javascript.md`
    - `exec-plans/completed/2026-02-13-phase-2-sdk-parity-dotnet-csharp.md`
    - `exec-plans/completed/2026-02-12-phase-2-tenant-boundary.md`
    - `exec-plans/completed/2026-02-13-sdk-parity-java.md`
    - `exec-plans/completed/2026-02-13-openai-chat-responses-strict-parity.md`
    - `exec-plans/completed/2026-02-13-all-providers-strict-helper-mapper-parity.md`
    - `exec-plans/completed/2026-02-13-sdk-metrics-and-telemetry-pipeline.md`
  - Tech debt tracker: [`exec-plans/tech-debt-tracker.md`](exec-plans/tech-debt-tracker.md)
- Generated docs: [`generated/db-schema.md`](generated/db-schema.md)
- External references: [`references/index.md`](references/index.md)
  - Generation ingest contract: [`references/generation-ingest-contract.md`](references/generation-ingest-contract.md)
  - Grafana response shapes: [`references/grafana-query-response-shapes.md`](references/grafana-query-response-shapes.md)
  - Helm deployment chart: [`references/helm-chart.md`](references/helm-chart.md)
  - Model cards API shape: [`references/model-cards-api.md`](references/model-cards-api.md)
  - Multi-tenancy guide: [`references/multi-tenancy.md`](references/multi-tenancy.md)

## Redundancy Rule

- Keep path catalogs centralized here.
- Other docs should reference this file instead of repeating full navigation lists.
