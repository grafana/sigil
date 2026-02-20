---
owner: sigil-core
status: active
last_reviewed: 2026-02-20
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
  - Drafts: `design-docs/drafts/`
- Product specs: [`product-specs/index.md`](product-specs/index.md)
- SDK docs:
  - Java SDK README: `../sdks/java/README.md`
  - JS/TS SDK docs index: `../sdks/js/docs/index.md`
  - JS/TS SDK README: `../sdks/js/README.md`
  - JS LangChain framework guide: `../sdks/js/docs/frameworks/langchain.md`
  - JS LangGraph framework guide: `../sdks/js/docs/frameworks/langgraph.md`
  - .NET SDK README: `../sdks/dotnet/README.md`
  - Python SDK README: `../sdks/python/README.md`
  - Python LangChain module README: `../sdks/python-frameworks/langchain/README.md`
  - Python LangGraph module README: `../sdks/python-frameworks/langgraph/README.md`
  - Go SDK README: `../sdks/go/README.md`
- Execution plans:
  - Active: `exec-plans/active/`
    - Drafts: `exec-plans/active/drafts/`
  - Current implementation priority: cross-track consistency and tracked tech debt follow-up (CI scope expansion, ingestion-log evolution)
  - Phase 2 umbrella coordinator: `exec-plans/active/2026-02-12-phase-2-delivery.md`
  - LangChain/LangGraph framework integration delivery: `exec-plans/completed/2026-02-20-sdk-langchain-langgraph-integrations.md`
  - Completed: `exec-plans/completed/`
    - `exec-plans/completed/2026-02-11-bootstrap-phase-1.md` (superseded)
    - `exec-plans/completed/2026-02-12-model-card-catalog-refresh.md`
    - `exec-plans/completed/2026-02-12-generation-first-ingest.md`
    - `exec-plans/completed/2026-02-12-agent-identity-fields.md`
    - `exec-plans/completed/2026-02-12-phase-2-hybrid-storage.md`
    - `exec-plans/completed/2026-02-12-phase-2-sdk-parity-python.md`
    - `exec-plans/completed/2026-02-12-phase-2-sdk-parity-typescript-javascript.md`
    - `exec-plans/completed/2026-02-13-compaction-scaling.md`
    - `exec-plans/completed/2026-02-13-phase-2-sdk-parity-dotnet-csharp.md`
    - `exec-plans/completed/2026-02-12-phase-2-tenant-boundary.md`
    - `exec-plans/completed/2026-02-12-phase-2-query-proxy.md`
    - `exec-plans/completed/2026-02-13-sdk-parity-java.md`
    - `exec-plans/completed/2026-02-13-openai-chat-responses-strict-parity.md`
    - `exec-plans/completed/2026-02-13-all-providers-strict-helper-mapper-parity.md`
    - `exec-plans/completed/2026-02-13-sdk-metrics-and-telemetry-pipeline.md`
    - `exec-plans/completed/2026-02-15-conversation-query-path.md`
    - `exec-plans/completed/2026-02-17-online-evaluation.md`
    - `exec-plans/completed/2026-02-17-embedding-call-observability.md`
    - `exec-plans/completed/2026-02-20-sdk-langchain-langgraph-integrations.md`
  - Tech debt tracker: [`exec-plans/tech-debt-tracker.md`](exec-plans/tech-debt-tracker.md)
- Generated docs: [`generated/db-schema.md`](generated/db-schema.md)
- External references: [`references/index.md`](references/index.md)
  - Online evaluation user guide: [`references/online-evaluation-user-guide.md`](references/online-evaluation-user-guide.md)
  - Storage benchmark baselines: [`references/storage-benchmarks.md`](references/storage-benchmarks.md)
  - Generation ingest contract: [`references/generation-ingest-contract.md`](references/generation-ingest-contract.md)
  - Score ingest contract: [`references/score-ingest-contract.md`](references/score-ingest-contract.md)
  - Evaluation control plane API: [`references/eval-control-plane.md`](references/eval-control-plane.md)
  - AI o11y + evaluation market survey (online + offline): [`references/ai-observability-evaluation-market.md`](references/ai-observability-evaluation-market.md)
  - Grafana response shapes: [`references/grafana-query-response-shapes.md`](references/grafana-query-response-shapes.md)
  - Helm deployment chart: [`references/helm-chart.md`](references/helm-chart.md)
  - Model cards API shape: [`references/model-cards-api.md`](references/model-cards-api.md)
  - Multi-tenancy guide: [`references/multi-tenancy.md`](references/multi-tenancy.md)

## Redundancy Rule

- Keep path catalogs centralized here.
- Other docs should reference this file instead of repeating full navigation lists.
