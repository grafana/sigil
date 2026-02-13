---
owner: sigil-core
status: draft
last_reviewed: 2026-02-13
source_of_truth: true
audience: both
---

# AI Observability Roadmap (Inference-First)

## Purpose

Define the product roadmap for AI observability capabilities in Sigil and Grafana Cloud, from baseline telemetry to closed-loop quality and cost optimization.

## Scope

- In scope: inference observability for LLM and agent workflows.
- Out of scope: model training observability and model-training pipelines.

## Current Baseline

- Level 1 capabilities are partially available through OTEL/OpenLIT ingestion and LGTM dashboards.
- The largest gap is Level 2 conversation-first debugging: teams can inspect spans but cannot reliably inspect end-to-end conversations and user feedback in one workflow.

## Maturity Model

| Level | Stage | Operator Question | Core Capabilities | Sigil/Grafana Target Value |
| --- | --- | --- | --- | --- |
| 1 | Telemetry | "Are calls succeeding, how fast, and how expensive?" | Token in/out, latency, error rates, cost metrics, request metadata, basic dashboards | OTEL-native ingestion and prebuilt dashboards for quick setup |
| 2 | Tracing + Conversation Debug | "What happened in this conversation and where did it break?" | Conversation timeline, step-level trace drilldown, user-facing vs raw I/O split, thumbs up/down feedback, cache hit diagnostics | Purpose-built conversation debug UX integrated with trace context |
| 3 | Pattern Analysis + Classification | "Which interaction patterns are failing repeatedly?" | Annotation workflows, clustering, anomaly detection by interaction type, version/session slicing, PII-aware handling | Aggregate pattern insights without requiring full re-evaluation of all traffic |
| 4 | Evaluation | "Did this prompt/model change improve quality?" | Offline eval on test sets, online eval on live traffic, LLM-as-judge hooks, experiment/run comparison, regression detection | Pluggable eval pipeline where customers run locally and publish results |
| 5 | Optimization | "How do we improve quality per dollar continuously?" | Prompt versioning, provider comparison playground, A/B testing, cost/quality trade-off reporting, prompt-to-metric linkage | Closed-loop optimization across prompt, model, and runtime behavior |

## Roadmap Phases

### Phase 1: Conversation Debug Foundation (Primary 2026 focus)

Goal: deliver Level 2 as the default troubleshooting workflow.

- Conversation-level debug UI that links conversation turns to trace steps.
- Feedback capture (`thumbs_up`, `thumbs_down`, optional reason tags) as triage signal.
- Cache/prefix efficiency diagnostics for token and latency optimization.
- Clear separation between user-visible response and raw provider artifacts.

Exit signal:

- Operators can move from failing user report to root-cause trace within a single workflow.

### Phase 2: Pattern Intelligence

Goal: move from one-off debugging to systematic quality understanding (Level 3).

- Conversation/session annotation APIs and SDK helpers.
- Pattern clustering and failure-mode taxonomy views.
- Agent/prompt version comparison at session and cohort level.
- PII-aware storage/query policies for annotations and sampled payloads.

Exit signal:

- Teams can identify top recurring failure classes and quantify impact by cohort.

### Phase 3: Pluggable Evaluation Platform

Goal: make quality regressions measurable before and after deployment (Level 4).

- Evaluation result ingest schema and query surfaces.
- Offline test run comparison and online quality score tracking.
- Experiment metadata model (prompt version, model, provider, runtime settings).
- Regression alerts tied to quality dimensions and cost deltas.

Exit signal:

- Teams can block or roll back changes based on explicit quality regression criteria.

### Phase 4: Optimization Loop

Goal: connect quality signals to prompt/model decisions (Level 5).

- Prompt management with version lineage and linked quality/cost metrics.
- Multi-provider playground with side-by-side response + metric comparison.
- Cost/quality recommendation layer for routing and prompt strategy.
- Continuous improvement workflow from production signal to release decision.

Exit signal:

- Teams can run repeatable prompt/provider optimization cycles with measurable ROI.

## Product Principles

- Build on OTEL conventions and existing LGTM data pipelines.
- Prioritize debug depth before automation breadth.
- Treat user feedback as triage input first, evaluation truth later.
- Keep evaluation pluggable and honest about multi-model comparability limits.

## Risks and Constraints

- Multi-model evaluation remains an industry-wide unsolved hard problem; compare trends carefully and avoid overclaiming precision.
- Payload capture depth must stay privacy-aware and policy-driven.
- Feature parity with established platforms is table stakes; differentiation must come from integrated observability workflows and operator UX.

## Dependencies and Cross-Links

- Competitive context: `docs/references/competitive-benchmark.md`
- Generation ingest contract: `docs/references/generation-ingest-contract.md`
- Plugin UI/proxy constraints: `docs/FRONTEND.md`
- System architecture baseline: `ARCHITECTURE.md`

## Execution Handoff

When implementation starts for a phase, create:

- a design doc in `docs/design-docs/`
- a matching execution plan in `docs/exec-plans/active/`

This roadmap is strategy-level direction and does not replace phase execution plans.
