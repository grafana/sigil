---
owner: sigil-core
status: active
last_reviewed: 2026-02-17
source_of_truth: true
audience: both
---

# AI Observability Competitive Benchmark

Single reference for competitor benchmarking and GenAI standards links.

## How To Use This Document

- Use this file before making decisions on:
  - instrumentation strategy
  - observability schema
  - prompt/eval/playground scope
  - gateway versus direct provider patterns
- Treat OTEL GenAI semantic conventions as the baseline contract.
- Treat competitor features as product benchmarking inputs, not schema authority.

## Competitor Snapshot

| Project | GitHub | Docs / Site | What It Is | Pros | Cons |
| --- | --- | --- | --- | --- | --- |
| Langfuse | <https://github.com/langfuse/langfuse> | <https://langfuse.com/docs> | Open-source LLM engineering platform: observability, evals, prompts, datasets, playground. | Mature full-stack workflow, OTEL ingestion path, strong product surface, self-host option. | Broader than pure observability, larger operational scope, some capabilities rely on platform-specific APIs. |
| OpenLIT | <https://github.com/openlit/openlit> | <https://docs.openlit.io> | OTEL-native AI observability platform with model + infra monitoring and eval features. | Fast setup, broad integration coverage, OTLP-first posture. | Convention and UI behavior can lag latest OTEL GenAI changes, payload capture defaults need careful policy. |
| OpenLLMetry (Traceloop) | <https://github.com/traceloop/openllmetry> | <https://www.traceloop.com/openllmetry> | OTel-based instrumentation/extensions for LLM apps and related frameworks. | Large instrumentation surface, destination-agnostic OTEL data, quick bootstrapping. | Wrapper/patch style can be brittle as provider SDKs change, wide surface raises maintenance overhead. |
| Helicone | <https://github.com/Helicone/helicone> | <https://docs.helicone.ai> | LLM gateway + observability platform with routing/fallback/cost controls. | One-line gateway integration, strong routing/cost controls, broad model access patterns. | Gateway-centric architecture adds proxy layer and potential lock-in to gateway semantics. |
| Arize Phoenix | <https://github.com/Arize-ai/phoenix> | <https://arize.com/docs/phoenix> | Open-source AI observability and evaluation platform. | Strong evaluation workflows, active OSS ecosystem, good local-first workflows. | License model is not Apache-style for all usage contexts; verify enterprise/legal fit. |
| OpenInference | <https://github.com/Arize-ai/openinference> | <https://arize-ai.github.io/openinference/> | Conventions + instrumentations for AI tracing, OTEL-compatible outputs. | Broad instrumentation ecosystem, practical integrations, works with OTEL collectors. | Separate convention layer from official OTEL GenAI can require mapping for strict OTEL-first schemas. |
| LangSmith | <https://github.com/langchain-ai/langsmith-sdk> | <https://docs.langchain.com/langsmith/home> | Managed platform for tracing, evals, prompt tooling, and deployment workflows. | Strong managed UX and integrated eval/tracing workflows. | Core platform is managed/proprietary; open-source surface is mainly SDKs/examples, not full product stack. |

## Embedding Observability Notes

| Product | Embedding Modeling Pattern | Sigil Takeaway |
| --- | --- | --- |
| LangSmith | Embeddings are represented as runs in the trace tree. | Trace-native modeling is proven and keeps schema simple. |
| Langfuse | Dedicated `embedding` observation type with usage/context fields. | Dedicated UI categorization is optional; core telemetry still maps cleanly to spans + metrics. |
| Arize Phoenix | Embedding calls flow through OTEL spans; quality analysis is downstream. | Keep call-level observability separate from retrieval quality analytics. |
| Helicone | Proxy captures embedding request/response telemetry. | Gateway capture is useful, but not required for SDK-side span instrumentation. |
| OpenLLMetry | Embeddings are modeled through OTEL GenAI conventions. | Aligning with OTel `gen_ai.operation.name=embeddings` is ecosystem-compatible. |

## OTEL GenAI Semantic Conventions (Primary References)

### Core

- Overview: <https://opentelemetry.io/docs/specs/semconv/gen-ai/>
- Spans: <https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/>
- Metrics: <https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-metrics/>
- Events: <https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-events/>
- GenAI attribute registry: <https://opentelemetry.io/docs/specs/semconv/registry/attributes/gen-ai/>

### Provider Extensions

- OpenAI extension: <https://opentelemetry.io/docs/specs/semconv/gen-ai/openai/>
- Azure AI Inference extension: <https://opentelemetry.io/docs/specs/semconv/gen-ai/azure-ai-inference/>

### Upstream Source Repositories

- Semantic conventions repo: <https://github.com/open-telemetry/semantic-conventions>
- GenAI docs directory in repo: <https://github.com/open-telemetry/semantic-conventions/tree/main/docs/gen-ai>

## Sigil Decision Rules (Agent Guidance)

- OTEL-first:
  - Default to official OTEL GenAI semantic conventions for attributes/events/metrics.
  - Use vendor-specific fields only when OTEL does not cover needed detail.
- Content safety:
  - Do not capture full messages by default.
  - Prefer truncation, filtering, and externalization with references for large/sensitive payloads.
- Compatibility:
  - If integrating with a competitor ecosystem, add explicit mapping boundaries in docs/code comments.
  - Do not let external platform naming replace Sigil core contracts.

## Maintenance

- Update this benchmark when:
  - we adopt a new integration pattern
  - OTEL GenAI conventions materially change
  - a competitor shift changes Sigil product/architecture decisions
- If this file changes in a way that impacts implementation choices, also update:
  - `AGENTS.md`
  - `ARCHITECTURE.md`
  - relevant docs under `docs/` (plans/specs/reliability/security)
