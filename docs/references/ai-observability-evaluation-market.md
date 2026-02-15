---
owner: sigil-core
status: active
last_reviewed: 2026-02-15
source_of_truth: false
audience: both
---

# AI Observability + Evaluation (Online + Offline): Market Survey (2026-02)

This document surveys the LLM/agent observability ("AI o11y") and evaluation market, with focus on two workflows:

- **online evaluation**: evaluators that run on production traffic as it arrives ("live evaluators")
- **offline evaluation**: dataset-based experiments, regression testing, and CI gates ("batch evaluators")

It is not exhaustive and will age quickly; treat it as a snapshot as of **2026-02-15**.

## Contents

- Definitions (AI o11y, evals, online vs offline, guardrails)
- Market patterns (online evaluation)
- Market patterns (offline evaluation)
- Capability map + feature matrix
- Deep dives (selected platforms)
- Offline eval libraries/CLIs (common building blocks)
- How this maps to Sigil (integration ideas)

## Definitions

### AI Observability (AI o11y)

For LLM apps and agents, "observability" usually means:

- capturing **traces** of multi-step runs (LLM calls, retrieval, tool calls, custom app logic)
- capturing **request/response payloads** (often with masking/redaction controls)
- tracking **latency, cost, token usage, errors** (and sometimes quality proxy metrics)
- enabling **debugging workflows**: drill-down from aggregates -> individual runs -> step timeline

Most tools implement this using:

- direct SDK instrumentation (app emits logs/traces to the vendor)
- OpenTelemetry-based spans (OTLP ingest, sometimes with GenAI semantic conventions)
- an LLM gateway/proxy that logs every request (adds routing/caching/guardrails)

### Evaluation (Evals)

An "evaluation" is a repeatable way to score behavior/outputs. In LLM systems this typically means one or more **scorers** that produce:

- numeric scores (e.g. `0..1` or `0..100`)
- boolean pass/fail checks (e.g. JSON schema valid)
- categorical labels (e.g. `SAFE|UNSAFE`)
- optional explanation / metadata (e.g. judge rationale, error category)

Common evaluator implementations:

- **LLM-as-a-judge** (rubric + prompt + judge model)
- deterministic code checks (schema validation, regex, linting, unit tests)
- retrieval/RAG metrics (faithfulness, relevance, context recall/precision)
- human review (annotation queues, rating fields, corrections)

### Online Evaluation (Live Evaluation)

Online evaluation (aka **live evaluation**, **production scoring**, **continuous evaluation**) means:

- runs on **production traces/logs** (not a fixed test set)
- is typically **asynchronous** (avoid adding latency to user requests)
- uses **filters + sampling** to control volume/cost (e.g. "only final responses", "10% sampling", "only tenant X")
- writes results back as **scores attached to a trace/span/generation** and aggregates into dashboards/alerts

In many tools, a **live evaluator** is simply the configuration object that makes an evaluator "online": it binds an evaluator implementation to (filters + sampling + scheduling + output attachment).

Online evaluation is distinct from:

- **offline evaluation** (dataset-based experiments, regression tests, CI gates)
- **guardrails** (synchronous checks that block/route/transform responses in the request path)

### Offline Evaluation (Experiments, Regression Tests, CI Gates)

Offline evaluation means:

- runs on a **fixed dataset** (a curated set of test cases) or a **frozen snapshot** of production logs
- is used to **compare versions** (prompt versions, model versions, agent/code changes) before or during rollout
- produces reproducible result sets: scores per item + aggregates (pass-rate, distributions, regressions)
- typically runs:
  - on developer machines (local runner that logs results to the platform), and/or
  - in CI (GitHub Actions, etc.), and/or
  - as a scheduled job (nightly regression)

Offline evaluation typically has two modes:

- **re-scoring**: run evaluators on *existing* stored outputs (cheap to implement, good for adding new metrics, not a true "new version" test)
- **replay/experiment**: re-run the *application task* (prompt + tools + retrieval + routing) on dataset inputs to generate new outputs, then score them

Offline evaluation is distinct from:

- **online evaluation** (continuous scoring on production traffic)
- **guardrails** (synchronous, request-path checks that can block/transform/route)

### Guardrails (Runtime Policy Enforcement)

Guardrails are checks applied **in the request path** that can:

- block or redact outputs
- route to a different model/tool
- enforce format/schema constraints
- trigger retries / fallbacks

Many vendors market “online evaluation” and “guardrails” together. The practical difference is whether the result can affect the user response synchronously.

### Online vs Offline vs Guardrails (Quick Comparison)

| Dimension | Offline evaluation | Online evaluation | Guardrails |
| --- | --- | --- | --- |
| Trigger | dataset run / replay | production traffic | in-request (sync) |
| Purpose | regressions, selection, CI gates | monitoring drift/bugs | policy enforcement (block/route/transform) |
| Latency impact | none | usually none (async) | yes (adds request-path work) |
| Volume control | dataset size + caching | filters + sampling | strict rules + timeouts |
| “Ground truth” | optional expected outputs + human labels | usually reference-free | rule/policy verdict |
| Best for | shipping safely | catching unknown unknowns | preventing bad outcomes |

### Evaluation Targets (Where Scores Attach)

Across platforms, scores attach to different “units of evaluation”:

- **generation/response** (one user-visible output)
- **step/span** (retrieval, tool call, intermediate LLM call)
- **trace/run** (one end-to-end workflow execution)
- **conversation/session/thread** (multi-turn experience)
- **dataset item / experiment run** (offline evaluation artifacts)

Choosing the unit is the most important design decision for both offline and online evaluation: it drives cost, debuggability, and how well scores map to user outcomes.

### Interoperability Standards (Why They Matter)

Several ecosystem conventions/specs show up across tools:

- OpenTelemetry **GenAI semantic conventions** (attributes/metrics for LLM operations).
- OpenInference (tracing conventions popular in the RAG/eval ecosystem).
- “Bring your own evaluator” patterns: compute scores in your infra, report them into the platform.

Sigil’s current SDK span/metric model already uses `gen_ai.*` attributes and `gen_ai.client.*` metrics (see `docs/references/generation-ingest-contract.md`), which is a strong compatibility story for both first-party and third-party tooling.

## What “Online Eval” Looks Like In Practice

Across vendors, the pattern is surprisingly consistent:

1. Ingest traces/logs for each run (via SDK / OTel / proxy).
2. Define evaluators:
   - implementation (LLM judge or code)
   - schema for outputs (score types)
3. Define rules:
   - which runs/spans to score (filters)
   - how often (sampling / schedules)
4. Execute asynchronously (queue + workers), store scores, show trends.
5. Use scores to:
   - alert on regressions
   - discover edge cases for new datasets
   - gate deployments (CI/CD) or prompt releases

## What “Offline Eval” Looks Like In Practice

Offline evaluation also converges on a common workflow:

1. Build a dataset:
   - golden test cases (hand-curated)
   - or “failure mining” from production traces/logs (then add expected outputs/labels)
2. Define the “task under test”:
   - run your application code (prompt + retrieval + tools) to generate outputs, or
   - reuse stored outputs (re-scoring mode)
3. Run an experiment:
   - execute the task across dataset items (often with concurrency limits)
   - optionally repeat runs to estimate non-determinism
4. Score results:
   - deterministic checks (schema/regex/unit tests)
   - LLM judges (rubrics) and/or RAG metrics
   - human review for ambiguous cases
5. Compare runs and gate changes:
   - compare metrics across versions (prompt/model/code)
   - fail CI if thresholds/regression budgets are exceeded
   - ship, then use online evaluation to catch drift and feed new edge cases back into the dataset

## Market Patterns: How Online Evaluation Is Implemented

“Online evaluation” tends to converge on the same mechanical primitives, even when the UI/terminology differs.

**Rule object (live evaluator)**

- Most products model online evaluation as an **automation rule**: evaluator implementation + (filters + sampling + optional backfill) + attachment target.
- In Braintrust this is explicit “scoring rules”; in LangSmith it’s “online evaluators”; in Langfuse it’s “evaluators” configured against live production targets.

**Trigger point**

- Common trigger: **when a span/run ends** (low staleness, straightforward enqueue).
- Alternative trigger: **when the trace completes** (more context, but slower/more expensive and can backlog).

**Filtering**

- Either a UI filter builder (attributes/tags/userId/sessionId) or a SQL-like filter clause.
- Some tools explicitly support **stacked filters** across levels: trace-level filters combined with observation/step-level filters.

**Sampling**

- First-class in production because LLM judges are expensive; common patterns are 1-10% for high volume, higher for low volume or critical flows.
- Sampling is usually applied after filtering: “eligible runs” then “sample fraction”.

**Backfill**

- Many tools let you apply a rule to historical runs/logs with a “backfill from” timestamp.
- Backfill is almost always a background job, with rule/evaluator logs to track progress.

**Attachment model**

- “Score objects” attached to a run/trace/observation (Langfuse-style).
- “Scoring span” inserted into the trace/log view (Braintrust-style).
- “Bring your own score” API that attaches scores to a request/run id (Helicone-style).

**Debuggability**

- Better systems provide a way to debug the evaluator itself:
  - evaluator execution is traced (so you can inspect judge prompts/token usage)
  - rule/evaluator logs show failures, retries, and filter matches

**Common pitfalls**

- If filtering runs at end-time, filters only see fields that are present at that moment; late updates won’t match.
- Trace-level evaluators are often too slow/expensive for always-on production monitoring; observation/step-level scoring is the usual path to scale.

**Mechanics comparison (selected tools)**

| Tool | Trigger | Target | Filtering | Sampling | Backfill | Attachment | Debuggability |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Braintrust | `span.end()` | spans | SQL filter clause | yes | yes | scoring span + score values | scoring span details; rule/scorer UX |
| Langfuse | run completion | traces + observations | trace + observation filters | yes | yes | score objects on trace/observation | evaluator execution traces; filter/mapping previews |
| LangSmith | automation on runs | runs/traces | UI filters (runs table) | yes | yes | evaluator results on runs | evaluator logs; backfill as background job |
| Helicone | external | requests | by request id | external | external | request score API | evaluator lives outside; Helicone analytics |

## Market Patterns: How Offline Evaluation Is Implemented

Offline evaluation is less about “automations” and more about **reproducible experiments**.

**Dataset as the central object**

- Most platforms model a dataset as a list of items where each item is roughly:
  - `input`: the test scenario (single-turn prompt, conversation history, or agent task spec)
  - optional `expected` / `reference` output
  - `metadata`: tags, difficulty, product area, language, tenant, etc.
- Many platforms emphasize building datasets from **production traces** (“failure mining”) and then adding expected outputs/labels.

**Dataset versioning / snapshots**

- Reproducibility requires versioning:
  - timestamp-based dataset versions (common)
  - explicit “snapshot” objects (common)
  - tagging/labels for “release candidates” (common)
- Subtle but important: some systems version *items* but not schemas; others snapshot everything.

**Key design choices (and tradeoffs)**

- Dataset item granularity:
  - single-turn items are cheap and easy to debug, but miss end-to-end outcomes
  - multi-turn items capture conversational quality, but require boundary rules and larger context
  - trajectory/agent-run items capture real task success, but are harder to replay and score (tool environments, branching)
- “Re-scoring” vs “replay”:
  - re-scoring is fast to implement and great for adding metrics retroactively, but does not measure a candidate version
  - replay is the true regression test, but needs a harness that can run your app/agent with realistic secrets/env/tools
- Deterministic checks vs LLM judges:
  - deterministic checks are stable and cheap but narrow (format/schema/safety rules)
  - judges are flexible but expensive and noisy; you need pinning/versioning to avoid drift
- Gating strategy:
  - absolute thresholds (`pass_rate >= X`) are simple but brittle across distribution shifts
  - delta-based gates (“no worse than baseline by > Y”) require stable baselines and repeatability
  - regression budgets (“allow <= N new failures”) are often the most operationally friendly

**Experiment runner (where code executes)**

- Two dominant execution modes:
  - **local execution + remote logging**: you run evals in your infra/CI, but results are pushed to the platform UI
  - **hosted execution**: platform runs your tasks/evaluators (less common for complex agents due to secrets/env needs)
- Mature runners add:
  - concurrency controls (`max_concurrency` / worker pools)
  - retries and timeouts
  - per-run metadata (model/prompt version, git SHA, temperature)
  - optional caching to reduce cost and stabilize CI

**Nondeterminism management**

LLM systems are stochastic. Offline tooling compensates via:

- `num_repetitions` / repeated runs and reporting variance
- caching recorded outputs (or model responses) for stable CI
- isolating “judge models” and pinning judge prompts/versions to reduce evaluator drift

**Scorer taxonomy**

Offline evaluation usually mixes:

- deterministic code checks (schema validation, regex, unit tests)
- reference-based metrics (exact match, similarity, BLEU-like, embedding similarity)
- reference-free metrics (LLM judge rubrics, “helpfulness”, “policy compliance”)
- RAG-specific metrics (faithfulness, relevance, groundedness)
- pairwise evaluators (A vs B preference) for prompt/model selection
- human review queues (ground truth and “hard cases”)

**Comparison UX**

Strong products make it easy to answer:

- “Did version B improve overall, and where did it regress?”
- “Which slices got worse?” (language, tenant, topic, agent/tool path)
- “Show me the worst N failures with full trace context.”

**CI gates**

Common patterns:

- fail the pipeline if a metric drops below threshold
- allow a regression budget (e.g. `<= 2` new failures, or `p95 score >= X`)
- nightly regression runs to detect drift (especially when models/providers change)

**Failure modes to watch**

- Overfitting to the dataset (good scores, bad real-world behavior).
- Judge drift (your “measurement” changes because the judge model/prompt changes).
- Leakage/contamination (test cases end up in training data or prompts).
- Privacy: datasets built from production require strong redaction and retention discipline.

## Capability Map (What These Platforms Compete On)

**Instrumentation + ingest**

- SDKs and framework integrations (OpenAI SDK, LangChain/LlamaIndex, Vercel AI SDK, agent frameworks)
- OpenTelemetry / OTLP ingest and GenAI semantic conventions
- proxy/gateway options (central control plane, caching, retries, routing)

**Data model + storage**

- trace/span model (hierarchical)
- session/conversation model (multi-turn)
- join keys (request_id, generation_id, trace_id/span_id)
- retention, masking/redaction, multi-tenancy, RBAC/audit logs

**Online evaluation**

- live evaluator rules (filtering + sampling)
- async execution and backpressure handling
- evaluation attachments as score objects and (sometimes) “evaluation spans”
- alerting/notifications on score trends

**Offline evaluation**

- datasets: creation from prod traces, CSV upload, versioning
- experiments: run app code across dataset items, compare versions
- CI integration: evaluate on PRs / prompt updates

**Prompt & release workflows**

- prompt registry/versioning
- A/B testing / canary / gradual rollouts
- replay from traces into a playground (debug -> change -> re-run)

**Exports & interoperability**

- export to blob storage / data warehouse
- APIs for query and score ingestion
- “bring your own evaluator” (compute outside, report scores in)

## Feature Matrix (Condensed)

This is intentionally coarse; details change fast.

| Tool | OSS/self-host | OTel ingest | Gateway/proxy option | Online eval built-in | Offline eval + datasets | Prompt registry |
| --- | --- | --- | --- | --- | --- | --- |
| Langfuse | Yes | Yes | Optional | Yes | Yes | Yes |
| Braintrust | SaaS-first | Yes | Optional | Yes | Yes | Partial |
| Portkey | Gateway OSS | Partial | Yes (core) | Guardrails-centric | Partial | Partial |
| LangSmith | SaaS-first | Partial | Optional | Yes | Yes | Partial |
| Phoenix | Yes | Yes | No | Yes | Yes | Partial |
| W&B Weave | SaaS-first | Yes | No | Emerging | Yes | Partial |
| Helicone | Yes | Partial | Yes (common) | Mostly “bring scores” | Partial | No |
| PromptLayer | SaaS-first | Partial | No | Limited | Yes | Yes (core) |
| Humanloop (sunset) | SaaS-first | Partial | No | Yes | Yes | Yes |
| HoneyHive | SaaS-first | Partial | No | Yes | Yes | Partial |

Note: Humanloop’s public docs indicate the “Humanloop Platform” was sunset on **2025-09-08**; keep it here as a reference for product patterns, not as a current recommendation.

## Deep Dives: Selected Platforms

The following sections focus on the tools you listed plus other widely-used players in AI o11y + evaluation.

### Langfuse (langfuse.com)

**Positioning**

- Open-source LLM engineering platform: tracing, prompt management, evaluation (online + offline), dashboards.
- Strong emphasis on OpenTelemetry compatibility and avoiding lock-in.

**How it works (high level)**

- Instrument app via Langfuse SDKs / integrations / OpenTelemetry.
- Capture traces of runs; support sessions/users/tags/metadata.
- Define evaluators (including LLM-as-a-judge) and attach results as “scores” (trace-level and observation/step-level).
- Run evaluators on:
  - live production data (online evaluation)
  - experiments/datasets (offline evaluation)
- Ingest custom scores via SDK/API (bring your own evaluator, report back scores).
  - Scores can be attached at trace level and (optionally) observation level.

**Online eval mechanics**

- Targets:
  - **Observations** (individual operations/steps, including LLM calls and tool calls)
  - **Traces** (complete workflows)
  - (Offline) **Experiments** (dataset-driven)
- Filtering + sampling:
  - supports combined filtering across observation attributes (type/name/metadata) and trace attributes (user/session/tags/version)
  - supports sampling percentage for cost/throughput control
- Backfill and validation UX:
  - can run on new traces only or include existing traces (backfill)
  - shows previews of matched production examples from a recent time window to validate filters/mappings
- Evaluator debuggability:
  - evaluator runs (LLM-as-judge) generate their own traces for introspection (prompt, model output, token usage).

**Offline eval mechanics**

- Core objects:
  - **Datasets** (items with `input` and optional `expectedOutput`)
  - **Experiments** (a task function executed on each dataset item) + **evaluation methods** that emit scores
- Dataset construction patterns:
  - create items manually or import via CSV
  - “failure mining” from production: add an item from a trace/observation, or batch-add from an observations table with **field mapping** (including JSONPath extraction and building custom objects)
  - link dataset items back to `source_trace_id` / `source_observation_id` for debuggability
- Dataset governance:
  - dataset items are **versioned**; every add/update/delete/archive produces a new timestamped dataset version, and you can fetch a dataset at a specific version timestamp
  - dataset schema validation (JSON schema) can enforce structure on `input` and/or `expectedOutput`
- Experiment execution:
  - experiments can run via SDK with async tasks/evaluators and concurrency controls (e.g. `max_concurrency`)
  - experiments can be used inside test runners (Pytest/Vitest) to implement CI gates by asserting on aggregate scores
  - UI “prompt experiments” run prompt/model variants against a dataset and compare side-by-side; evaluators can target experiment runs

**Strengths**

- OSS + self-host options; integrated prompt/version/eval workflow.
- Clear conceptual separation: traces/observations + scores + datasets/experiments.
- Very close to Sigil’s “generation-first + trace-first” worldview.

**Tradeoffs / gaps to watch**

- If your org already has a full OTel stack (Tempo/Prometheus/etc), decide whether Langfuse becomes “the trace store” vs a layer on top of existing stores.
- Evaluation compute costs and data privacy: LLM-as-judge is powerful but expensive and requires careful redaction/retention.
- Trace-level evaluators are often slower/costlier than observation-level; many teams migrate to observation-level for production-scale monitoring.

### Portkey (portkey.ai)

**Positioning**

- AI gateway plus “control plane” features: universal API across providers, routing/fallbacks/retries, caching, canary testing, budget/rate limits.
- Observability/logs and guardrails (deterministic + LLM-based + partner integrations).

**How it works (high level)**

- Route LLM calls through the Portkey Gateway (open-source gateway exists; hosted control plane optional).
- Gateway configs orchestrate routing/caching/fallback and apply guardrails.
- Observability is strongly tied to gateway logs (request/response, routing actions, costs/latency).
- Exposes feedback and analytics; supports “do not track” style content suppression (metrics-only logging).

**Online eval angle**

- Portkey leans heavily into **guardrails** (sync or async) that can deny/route/retry or log results.
- In practice this covers many “online eval” needs when the goal is to *act* (block/route) rather than simply monitor.

**Strengths**

- Best-in-class gateway pattern for model routing/caching/resiliency.
- Production-friendly operations knobs (budgets, rate limits, circuit breakers, canary testing).
- Works well as the “front door” for multi-provider workloads.

**Tradeoffs / gaps to watch**

- Proxy/gateway coupling: if the gateway is the ingestion point, you only see what flows through it (unless combined with separate tracing for app logic).
- “Evaluation” may be more “policy/guardrail verdicts” than dataset/experiment workflows, depending on org needs.

### Braintrust (braintrust.dev)

**Positioning**

- Evaluation + observability platform with strong emphasis on closing the loop: logs -> scorers -> dashboards -> datasets -> experiments.
- Explicit product feature for **online scoring** of production traces.

**How it works (high level)**

- Instrument traces via SDK/wrappers/integrations (and/or via their proxy for certain flows).
- Author scorers (LLM judge or code), publish them to the platform.
- Configure **online scoring rules** (automation rules) with:
  - sampling rate
  - SQL filter clause over span fields (input/output/metadata)
  - apply-to selection (root spans and/or specific span names)
- Execute async; attach results back into the log/trace UI as scoring spans and score values.

**Online eval mechanics**

- Trigger model:
  - scoring triggers when `span.end()` is called (with helper wrappers in some SDKs)
  - SQL filter evaluates the data present at end-time; late updates won’t affect matching
- Rule parameters (typical):
  - name/description/project
  - scorer selection (built-in library and/or custom scorers shared across projects)
  - sampling percentage
  - SQL filter
  - root spans vs explicit span names
- Results:
  - scores appear automatically on production logs
  - each scored item shows a dedicated “scoring span” with evaluation details

**Offline eval mechanics**

- Datasets:
  - datasets are typically structured as `{ input, expected?, metadata? }` records
  - common workflow: create datasets from real logs and feedback, then add expected outputs and edge-case labels over time
- Running evaluations:
  - an evaluation run produces an **experiment** (a versioned run artifact you can compare)
  - supports a Python SDK entrypoint (`Eval(...)`) and a CLI runner (`braintrust eval`) for CI-friendly execution
  - CLI supports “watch” style execution and an option to avoid sending logs (useful for local debugging vs remote result publishing)
- Scorers:
  - built-in “autoevals”, LLM-as-judge scorers, and custom code scorers
  - scorer outputs are normalized (commonly `0..1`) and can be composed into higher-level metrics
- CI/CD:
  - explicit CI integration patterns including a GitHub Action for running evals and reporting results

**Strengths**

- Very clear production workflow: build scorers -> attach rules -> see scores on live traffic -> alert/dashboards.
- Strong “log -> rule” iteration loop (create rules from filtered logs, pre-populated filters).
- Treats online scoring as a core product, not an add-on.

**Tradeoffs / gaps to watch**

- SQL filter language and span model require buy-in; portability depends on how much you lean into platform-specific constructs.
- Be deliberate about what is evaluated at span end time (data completeness and update semantics matter).
- SQL filter dialect constraints can be non-obvious (for example, some operators may not be supported and need idiomatic alternatives).

### EvalAI (eval.ai)

**Positioning**

- A platform for **benchmark challenges and leaderboards**, not an LLM o11y tool.
- Strong for community/public evaluation, competitions, reproducibility of research benchmarks.

**How it works (high level)**

- Organizers define evaluation protocols, phases, splits.
- Participants submit predictions or docker images; workers evaluate at scale and update leaderboards.
- Supports remote evaluation clusters and evaluation inside environments (for agent/RL-like benchmarks).

**Online eval angle**

- “Online” here mostly means **remote evaluation** (server-side evaluation infrastructure), not production/live scoring.
- Useful if Sigil wants to host standardized benchmarks for agents/workflows, but not a direct competitor in production o11y.

### LangSmith (LangChain) (docs.langchain.com / langchain.com)

**Positioning**

- LangChain ecosystem’s observability + evaluation platform, broadly used even outside LangChain.
- Strong support for evaluator types, datasets, annotation queues, and online evaluators.

**How it works (high level)**

- Send runs/traces to LangSmith via SDK/integrations.
- Create datasets (often by saving production traces).
- Define evaluators (LLM-as-judge, heuristic/code, pairwise, composite).
- Run offline evals for regression testing and online evals for monitoring/anomaly detection.

**Online eval mechanics**

- Online evaluators are configured as automation-style rules on production runs/traces:
  - define a filter (same filtering model as trace/runs views)
  - common UX: build the filter by inspecting runs; filters applied in the runs table mirror into the evaluator config
  - optional sampling rate (e.g. score 10% of matching traces)
  - optional backfill (“apply to past runs” with a backfill-from date, processed as a background job)
  - bind an evaluator (LLM-as-judge or other evaluator type)
- Operational visibility:
  - evaluator/rule logs to inspect execution progress and backfill status
- Feedback loop:
  - online evaluation results can be used to identify test cases and populate datasets for offline regression

**Offline eval mechanics**

- Datasets are a first-class object; many teams build them directly from saved production runs.
- Experiment configuration commonly includes:
  - repetitions (run the same item multiple times to estimate variance)
  - concurrency controls (avoid rate limits and runaway spend)
  - caching of LLM calls/results for stable CI runs (disk cache is a common pattern)
- Evaluators span:
  - reference-based (requires expected outputs)
  - reference-free (LLM judges and heuristics)
  - multi-turn / trajectory evaluators for agentic workflows

**Strengths**

- Mature evaluator taxonomy and docs; strong “offline + online” story.
- Deep integration with agent workflows (trajectory/step-level evaluation patterns are first-class in their ecosystem).

**Tradeoffs / gaps to watch**

- Ecosystem gravity: it’s easiest if you’re already using LangChain/LangGraph, though it works beyond it.
- Platform is SaaS-first (self-host/BYOC exists but typically enterprise).

### Arize Phoenix (arize.com/docs/phoenix)

**Positioning**

- Open-source observability + evaluation workflow, built on OpenTelemetry and OpenInference instrumentation.
- Strong interoperability: integrates with evaluation libs like Ragas/DeepEval and supports human annotations.

**How it works (high level)**

- OTLP ingest for traces; auto-instrumentation for popular frameworks/providers.
- Evals can be LLM-based, code-based, or human labels.
- Datasets and experiments support systematic comparison.

**Offline eval mechanics**

- Datasets can be created from files (CSV/JSONL), dataframes, spans/traces, or synthetic generation.
- Experiments run “tasks” across dataset items and apply evaluators; dataset-attached evaluators can auto-run for UI-triggered experiments.
- Integrates with common evaluation libraries (RAG metrics, LLM judges) rather than forcing a single vendor-native evaluator format.

**Online eval mechanics**

- Phoenix supports applying evaluators to incoming traces/spans for monitoring, usually as async workflows so production latency is unaffected.

**Strengths**

- OSS + OTel-first; strong as a “vendor-neutral” workflow layer.
- Integrates with existing evaluation ecosystems rather than trying to replace them.

**Tradeoffs / gaps to watch**

- If you need fully-managed enterprise ops (audit, strict RBAC, multi-region), Phoenix OSS may require additional work or Phoenix Cloud.

## General-Purpose APM Vendors Adding “LLM Observability”

Datadog, New Relic, and others increasingly offer LLM-specific observability surfaces (logs/cost/latency instrumentation and dashboards). These are usually:

- strong for fleet-wide ops (service health, error rates, infra correlation)
- weaker for eval workflows (datasets, scorers, online evaluator rules), unless paired with separate eval tooling

### Weights & Biases Weave (wandb.ai)

**Positioning**

- W&B’s AI application observability + evaluation product: traces, evaluations, datasets, playgrounds.
- Strong lineage/reproducibility story (code + dataset + scorer versioning).

**How it works (high level)**

- Instrument to capture trace trees; cost/latency aggregation.
- Evaluation framework uses datasets + scorers to run comparisons and produce leaderboards.
- Supports OpenTelemetry trace ingestion (send OTel directly).
- “Online evals” exist (at least as preview in some materials): score live traces for monitoring without impacting prod.

**Offline eval mechanics**

- Weave provides a dataset + evaluation runner abstraction where you define:
  - a dataset (often derived from logged calls)
  - a “model” or task function that produces outputs
  - scorers that grade outputs
- Strong emphasis on lineage: tying scores back to the exact dataset/task/scorer versions that produced them.

**Strengths**

- If your org already uses W&B for ML experimentation, Weave fits naturally into governance and reporting workflows.
- Strong comparative UI for experiments and eval result lineage.

**Tradeoffs / gaps to watch**

- Depending on your needs, Weave can be “another data silo” next to existing Grafana/Tempo/Prometheus stacks.
- Online eval maturity may vary by plan/preview status.

### Helicone (helicone.ai / docs.helicone.ai)

**Positioning**

- Open-source LLM observability, largely via proxy/gateway patterns.
- Explicitly not an evaluation framework, but supports reporting and analyzing eval scores (and some “online evaluator” style features via integrations/partners).

**How it works (high level)**

- Route requests via Helicone gateway/proxy or instrument with a “bring your own keys” mode depending on setup.
- Every request gets a request id; you can attach scores later via an API like `POST /v1/request/{requestId}/score` with a JSON `scores` object.
- Practical detail: many teams normalize score outputs to integers (often `0..100`) before attaching.
- Provides dashboards for cost/latency/errors and score analytics.
- Supports integration patterns (for example, webhooks) to trigger external evaluators when requests complete, then report scores back.
- Supports dataset curation/export workflows so offline evaluators can be run externally on selected production traffic.

**Strengths**

- Very fast to adopt if you’re comfortable with gateway-based coupling.
- Clean separation: compute eval anywhere, report scores into a unified analytics layer.

**Tradeoffs / gaps to watch**

- Proxy coupling and reliability/latency considerations (you introduce another hop).
- Without additional app-level tracing, you may miss non-LLM spans (retrieval/tools/business logic).

### PromptLayer (promptlayer.com)

**Positioning**

- Prompt registry/CMS + evaluation workflows + observability.
- Strong emphasis on workflows that include non-engineers (visual editor, Excel-like eval builder, CI for prompt changes).

**How it works (high level)**

- Maintain prompts in a registry; version and deploy without code redeploys.
- Observe request history and metadata.
- Run batch evaluations:
  - golden datasets
  - backtests on historical logs
  - regression tests and CI integration

**Offline eval mechanics**

- Evaluation workflows are typically modeled as pipelines (dataset + prompt/model + evaluators) that can be:
  - configured in UI, and/or
  - created and run programmatically via API (then polled or consumed via webhooks)
- Strong “prompt CI” narrative: run evals on prompt changes, publish scorecards, and gate releases on regressions.

**Online eval angle**

- Many teams use PromptLayer’s evaluation tooling primarily for offline/backtesting + CI gating, with production monitoring handled via observability + feedback.

**Strengths**

- Best-in-class “prompt ops” workflow for cross-functional iteration.
- “Backtesting on production logs” is a practical bridge between o11y and evals.

**Tradeoffs / gaps to watch**

- If you need low-level distributed tracing across complex agent stacks, ensure their OTel/span support covers the depth you need.

## Notable Other Players (More Specific Notes)

These are less central to the specific list you gave, but show up frequently in the same buying decisions.

### Humanloop

- Humanloop historically marketed a clear split between:
  - **offline**: dataset evaluation and CI gating
  - **online**: monitoring/evaluation on production logs
- Note: Humanloop’s public docs indicate the “Humanloop Platform” was sunset on **2025-09-08** (useful as a reference for patterns, but not necessarily a current market option).

### HoneyHive

- Dataset + experiments workflow:
  - datasets are structured records with `input` and optional `expected`
  - SDK-driven experiments can run with concurrency controls (typical `max_workers` style knobs)
- Online evaluation workflow:
  - evaluators run asynchronously on production traces (often with sampling) to keep runtime latency low
  - results attach back to traces and can be used for alerts and dataset curation (“add failing cases to datasets” loop)

### Lunary

- Exposes API primitives for offline evaluation workflows:
  - dataset “version snapshot” creation (freeze dataset state)
  - evaluation runs triggered via API against a dataset/version
- Emphasizes CI/CD evaluation runs and comparisons across model/prompt versions.

### Laminar (lmnr.ai)

- Agent-centric tracing + evaluation (OSS), typically combining:
  - datasets (including from production)
  - programmatic evaluation runners
  - human evaluation/annotation workflows
  - monitors for “online evaluation” style continuous scoring

### Opper

- Emphasizes built-in “quality scoring” with fast turnaround for each completion, plus dataset evals and custom metrics.

### Traceloop

- OpenTelemetry-first tracing (OpenLLMetry) with an “eval loop” story:
  - offline evals in CI to prevent regressions
  - online monitors/evaluators to detect drift on production traffic

### LangWatch

- Online evaluation:
  - “monitors” can trigger when a message arrives; evaluators can run on incoming traces/logs and attach `EvaluationResult` objects
- Offline evaluation:
  - SDK-driven “experiments” can run LLM evaluations and agent simulations against datasets
  - supports CI-style execution patterns (print summaries and exit non-zero on regression thresholds)

## Offline Eval Libraries and CLIs (Common Building Blocks)

These tools are frequently used:

- standalone (teams run evals in CI and only ship aggregate metrics somewhere), or
- embedded inside evaluation platforms (“bring your own evaluator”), or
- as the execution engine for dataset experiments.

### Promptfoo

- Config-first offline evaluation runner for prompts/models with:
  - assertions, scorers, and LLM-rubric graders
  - multi-turn conversation test cases
  - CI-friendly execution (including GitHub Action patterns)
- Good fit when you want “evals as code” with minimal platform coupling.

### DeepEval

- Python-first evaluation framework with a test runner model (often integrated with `pytest`):
  - define test cases (single-turn or multi-turn)
  - run metric suites (LLM judges, custom metrics)
  - produce pass/fail outcomes suitable for CI gating
- Commonly used as an offline regression layer for RAG and agent workflows.

### Ragas

- Offline evaluation toolkit focused on RAG quality:
  - faithfulness / groundedness style metrics
  - relevance, context precision/recall
- Often used inside larger platforms (Phoenix, custom pipelines) rather than as a full eval control plane.

### TruLens

- Evaluation library built around “feedback functions” that compute metrics on logged records/traces.
- Useful for both:
  - offline scoring of stored traces (“re-scoring”), and
  - continuous monitoring when paired with an ingestion pipeline.

### Giskard

- Test-suite oriented evaluation for LLM apps with a focus on risk and robustness:
  - dataset test suites
  - vulnerability scanning / failure mode discovery
  - guardrail validation workflows

### OpenAI Evals (open-source)

- Harness for writing evals and running them against models; historically popular for model/prompt benchmarking.
- Practical use today is often “reference implementation patterns” more than a full platform.

### Guardrails Evaluation Tools

- Some guardrail frameworks ship dedicated offline evaluation commands (evaluate a guardrail configuration against a dataset and report precision/recall style outputs).
- Useful when the “evaluator” is itself a policy/guardrail you want to tune.

### Model Benchmark Harnesses (Less App-Centric)

- `lm-evaluation-harness` (EleutherAI) and similar tools focus on **model benchmarking** on standard datasets.
- Useful for choosing base models, less useful for end-to-end agent/app correctness.

## What Each Does Well (And Where They Commonly Fall Short)

This is a pragmatic comparison, not an endorsement.

**Gateway-centric stacks (Portkey, Helicone, some Braintrust usage)**

- Do well: centralized routing/caching/retries, consistent logging across providers, easy adoption when all LLM traffic can be proxied.
- Fall short: partial visibility into the full app workflow unless you add separate tracing (tools, retrieval, business logic).

**OTel-first / open instrumentation (Sigil, Phoenix, Langfuse, Traceloop/OpenLLMetry, Weave OTel ingest)**

- Do well: full workflow visibility across services and languages; avoids “one vendor SDK everywhere”.
- Fall short: the eval “control plane” is not free. You still need evaluation rules, workers, and a data model for scores.

**Evaluation-first platforms (Braintrust, LangSmith, HoneyHive, Humanloop)**

- Do well: evaluator lifecycle (author -> test -> deploy online rules -> dashboards/alerts), strong dataset/experiment loops.
- Fall short: can become an additional observability stack unless you integrate tightly with existing OTel backends.

**Prompt-CMS-first (PromptLayer, Langfuse prompt mgmt, LangSmith prompt tooling, Weave playgrounds)**

- Do well: unlock SMEs to iterate, versioning/release workflows, backtesting.
- Fall short: prompt CMS alone does not solve distributed tracing, multi-service debugging, or deeper agent telemetry.

## How This Maps To Sigil (Integration Ideas)

Sigil already has two key building blocks:

- **OTel traces + metrics** live in the standard stack (Collector/Alloy -> Tempo + Prometheus).
- **Generation-first ingest** stores normalized generation records in Sigil (MySQL + object store compaction).

That makes Sigil well-positioned to add evaluation (online + offline) without replacing the existing observability stack.

### Choosing Unit of Evaluation (Online + Offline): Generation vs Conversation vs Step vs Trajectory

In Sigil, “what should an evaluator attach to?” is the first design choice for both online and offline evaluation. The market uses all of these units; the right answer depends on what you’re trying to detect, how you want to debug it, and whether you need step-level or end-to-end outcomes.

Sigil’s current architecture nudges toward **generation-scoped** evaluation for the MVP because generations are the **native ingest object** and already carry the primary join keys (`generation_id`, `conversation_id`, `trace_id`, `span_id`). Conversation-scoped and step-scoped evals are still valuable, but usually come after you have a basic scoring pipeline in place.

#### Generation-scoped evaluators (per turn)

Best for: output correctness/format, safety, instruction following, “answer quality” proxies, and quick time-series monitoring per model/agent.

Pros:

- **Strong identity and joins**: `generation_id` is a stable primary key, and Sigil already stores the normalized request/output/usage needed by most scorers.
- **Low latency to score**: you can enqueue evaluation as soon as the generation completes (good for “live” scoring).
- **Good debugging ergonomics**: a bad score points to one generation and its trace/span linkage for deeper investigation.
- **Scales predictably**: cardinality is “one eval per user-visible LLM response” (plus optional sampling).

Cons:

- **Misses end-to-end outcomes**: a single turn can look good while the overall task fails (or vice versa).
- **Context window ambiguity**: what context do you pass into the scorer (just this turn vs previous turns)? More context improves judge accuracy but increases cost and privacy risk.
- **Agent trajectories**: if an agent makes multiple internal LLM calls before a final user response, generation-only eval may not pinpoint the failing step unless you also score internal steps.

#### Conversation-scoped evaluators (multi-turn/session)

Best for: user satisfaction, multi-turn coherence, “did we solve the user’s task?”, and aggregate experience metrics.

Pros:

- **Closer to user outcome**: many “quality” questions are inherently multi-turn (helpfulness across back-and-forth).
- **Lower item volume** (sometimes): if you score “per conversation” you may run fewer expensive judge calls than per turn.
- **Works well with human feedback**: Sigil already has `conversation_ratings` and `conversation_annotations` projections, which align naturally with conversation-scoped review workflows.

Cons:

- **Hard to define boundaries**: conversations can include multiple intents and long gaps; you need a windowing rule (idle timeout, “task id”, last-turn marker).
- **Harder debugging**: “conversation score is bad” still requires localization to the responsible generation(s) or step(s).
- **Higher context exposure**: judges may need substantial conversation history; this increases PII leakage surface and redaction complexity.

Practical pattern:

- Keep **human ratings/annotations** at conversation scope (already in Sigil).
- Compute **conversation score rollups** from generation scores (e.g. `min`, `mean`, `last`, weighted by recency) plus optional “conversation judge” for end-to-end success.

#### Step-scoped evaluators (tool call, retrieval, internal LLM call)

Best for: pinpointing *why* something went wrong in an agentic workflow (retrieval relevance, tool correctness, planner quality, policy violations at intermediate steps).

Pros:

- **Root-cause resolution**: evaluates the component that actually failed (retrieval step, tool output, intermediate reasoning).
- **Aligns with agent architectures**: many “failures” happen before the final generation (bad doc retrieval, tool error, wrong tool chosen).
- **Better guardrail integration**: some step-level checks can become synchronous guardrails later (block/route/retry).

Cons:

- **Requires step telemetry**: Sigil does not sit in the trace pipeline; step data lives in OTel traces (Tempo) and is not necessarily duplicated in generation payloads.
- **High cardinality and cost**: a single user request can contain many steps; scoring everything without sampling can explode compute and spend.
- **Attribution complexity**: step scores need clear joins to user-visible outcomes (e.g. map step spans back to `generation_id`/`trace_id`).

Sigil-friendly approach:

- Phase 1: implement generation scoring only.
- Phase 2: add step scoring by querying Tempo spans (via Sigil query proxy) and/or emitting “evaluation spans” via OTLP so scores appear in the trace tree.

#### Multi-step / “trajectory” evaluators (episode-level)

Best for: “did the agent complete the task?” across multiple steps and tool calls, including retries and branching.

Conversation is not always a good “episode” boundary (one conversation can contain multiple tasks), so trajectory evals often anchor on:

- a root trace/span representing a single agent run, or
- an explicit `task_id`/`run_id` propagated across steps

Sigil implication: if you want reliable episode-level evals, consider standardizing a stable run identifier (trace root is a good default if available) and using generation-level + step-level signals as inputs to an episode score.

### Minimal “Online Eval” MVP (Fastest Path)

Goal: enable “live evaluator” style scoring on incoming generations without changing the trace pipeline.

- Add an **evaluation worker** (async) that consumes new generations (or a queue fed by generation ingest).
- Add a minimal “rule” surface:
  - filter by generation fields (agent/model/tags/error category) and tenant
  - sampling rate to manage judge costs
  - optional backfill-from timestamp for scoring historical generations
- Support a small set of evaluator types:
  - deterministic checks: JSON schema, regex, length, PII detectors
  - LLM-as-a-judge (rubric prompt + judge model config)
- Persist results as:
  - new `generation_scores` table keyed by `(tenant_id, generation_id, evaluator_name, created_at)`
  - or, reuse `conversation_ratings` / `conversation_annotations` with `source=auto` and well-defined metadata (good for bootstrapping, but you’ll likely outgrow it)
- Expose query endpoints to fetch scores alongside generations.
- In Grafana plugin UI:
  - show score badges in generation list/detail
  - filter “bad” scores and build drilldowns from score -> trace -> generation payload

### Production-Grade Online Evaluation (Matches Market Leaders)

Goal: match Braintrust/Langfuse/LangSmith style online evaluators.

- Add **evaluator registry**:
  - evaluator definition (type, prompt template or code package, versioning)
  - input mapping (which generation/span fields to pass)
  - output schema (numeric/boolean/categorical)
- Add **online scoring rules**:
  - filters over generation fields and/or trace/span attributes (agent/model/tags/env, error category)
  - sampling rates and rate limits
  - per-evaluator concurrency/cost controls
  - explicit backfill behavior (new-only vs include historical, with background job semantics)
- Add an execution backend:
  - queue + workers
  - rule/evaluator logs: per-run execution status, errors, retries, and throughput visibility
  - optional “evaluation spans” exported via OTLP so scores appear in Tempo as child spans (Braintrust-style)
  - Prometheus metrics for time series dashboards/alerts (e.g. pass-rate, score distributions)
- Data governance:
  - masking/redaction policies for judge inputs/outputs
  - retention controls (scores may be kept longer than raw payloads, or vice versa)

### Offline Evals + Experiments (Proposed Roadmap)

Offline evaluation is a bigger surface area than online evaluation because it needs **datasets**, **reproducibility**, and (eventually) a **replay harness**.

Sigil can stage this in a few increments, matching what the market converges on.

#### Phase 1: Offline “Re-Scoring” of Stored Generations (No Replay Yet)

Goal: enable dataset-style regression checks by scoring existing generations in bulk.

- Select items via:
  - saved filters/queries (e.g. “agent=X, model=Y, route=Z, last 7d, failures only”), or
  - explicit lists of `generation_id`
- Run evaluators asynchronously (same worker infrastructure as online evaluation), but triggered by:
  - manual run (ad-hoc analysis)
  - scheduled job (nightly)
  - CI (run against a fixed snapshot of stored data)
- Persist results with enough structure to compare runs:
  - `eval_run` (name, git SHA, evaluator versions, dataset snapshot id)
  - `eval_item_result` (generation_id/trace_id, per-item outputs and errors)
  - `eval_scores` (per evaluator)

This doesn’t test “new prompt/model behavior”, but it is extremely useful for:

- adding new quality/safety metrics retroactively
- measuring drift and slice performance
- validating evaluator changes (judge prompt/version updates)

#### Phase 2: First-Class Datasets (Versioned, With Provenance)

Goal: build and maintain datasets from production, with reproducibility and debugging links.

- Dataset items should support:
  - `input` (frozen input snapshot; may include conversation history or task spec)
  - optional `expected` / labels / human annotations
  - metadata/tags (language, persona, product area, tenant, difficulty)
  - provenance pointers back to Sigil objects:
    - `source_generation_id` and/or `trace_id`/`span_id`
- Add dataset versioning (snapshot semantics) so experiments are reproducible:
  - “version = timestamp” or explicit snapshot ids both work; the key is “freeze the set of items”
- Optional schema validation for dataset items (JSON schema) to keep experiments from failing due to malformed items.

#### Phase 3: Replay Experiments (True Offline Regression Tests)

Goal: re-run candidate versions on dataset inputs and compare to a baseline.

This requires a “task under test” abstraction that is realistic for agent stacks:

- simplest: a user-provided function/container/HTTP endpoint that takes a dataset item and returns an output (Sigil only orchestrates + scores)
- later: integrate with a Sigil-native prompt registry and model connections so “prompt version X” is runnable inside Sigil

Key design constraints:

- support multi-step agents (tool calls, retrieval) and capture the resulting traces
- support concurrency/timeouts/retries and cost controls
- store outputs as first-class artifacts so you can:
  - diff runs
  - debug failures by drilling into the trace tree

#### CI Integration Patterns

Most vendors converge on a simple interface:

- “run eval” + “print summary” + “exit non-zero if thresholds regress”

Sigil can support this via:

- a CLI that triggers an offline eval run and blocks until completion, then fails on regression budgets, or
- a GitHub Action wrapper around the CLI/API.

## Source Links (Starting Points)

**Platforms (online + offline evaluation)**

- Langfuse docs: https://langfuse.com/docs
  - Core concepts (offline vs online): https://langfuse.com/docs/evaluation/core-concepts
  - Datasets (versioning, add-from-trace): https://langfuse.com/docs/evaluation/experiments/datasets
  - Experiments via SDK (CI examples): https://langfuse.com/docs/evaluation/experiments/experiments-via-sdk
  - Experiments via UI (prompt experiments): https://langfuse.com/docs/evaluation/experiments/experiments-via-ui
  - LLM-as-a-judge: https://langfuse.com/docs/evaluation/evaluation-methods/llm-as-a-judge
  - Custom scores via SDK/API: https://langfuse.com/docs/evaluation/evaluation-methods/scores-via-sdk
- Portkey docs (gateway/observability/guardrails): https://portkey.ai/docs
- Braintrust docs:
  - Online scoring: https://www.braintrust.dev/docs/observe/score-online
  - Run evaluations (offline): https://braintrust.dev/docs/evaluate/run-evaluations
  - Write scorers: https://braintrust.dev/docs/evaluate/write-scorers
  - Datasets: https://braintrust.dev/docs/annotate/datasets
  - AutoEvals library: https://github.com/braintrustdata/autoevals
  - GitHub Action: https://github.com/braintrustdata/eval-action
- EvalAI repo (challenge/leaderboard platform): https://github.com/Cloud-CV/EvalAI
- LangSmith docs:
  - Evaluation concepts: https://docs.langchain.com/langsmith/evaluation-concepts
  - Offline evaluation: https://docs.langchain.com/langsmith/evaluation
  - Datasets: https://docs.langchain.com/langsmith/manage-datasets
  - Experiment configuration: https://docs.langchain.com/langsmith/experiment-configuration
  - Online evaluators: https://docs.langchain.com/langsmith/online-evaluations-llm-as-a-judge
- Arize Phoenix docs:
  - Datasets overview: https://arize.com/docs/phoenix/datasets-and-experiments/overview-datasets
  - Run experiments: https://arize.com/docs/phoenix/datasets-and-experiments/how-to-experiments/run-experiments
  - Dataset evaluators: https://arize.com/docs/phoenix/datasets-and-experiments/how-to-experiments/how-to-dataset-evaluators
  - Agent evaluation: https://arize.com/docs/phoenix/agents/evaluate-agent
- W&B Weave docs:
  - Evaluations: https://docs.wandb.ai/weave/guides/core-types/evaluations
  - Datasets: https://docs.wandb.ai/weave/guides/core-types/datasets
- PromptLayer docs:
  - Evaluations overview: https://docs.promptlayer.com/features/evaluations/overview
  - Programmatic evaluations: https://docs.promptlayer.com/features/evaluations/programmatic
  - Continuous integration: https://docs.promptlayer.com/features/evaluations/continuous-integration
- Helicone docs:
  - Scores API (bring your own evaluator): https://docs.helicone.ai/features/advanced-usage/scores
  - Datasets: https://docs.helicone.ai/features/datasets
- HoneyHive docs:
  - Datasets: https://docs.honeyhive.ai/datasets/introduction
  - Python experiments: https://docs.honeyhive.ai/sdk-reference/python-experiments-ref
  - Online evals: https://docs.honeyhive.ai/monitoring/onlineevals
- Lunary docs:
  - Dataset version snapshots: https://docs.lunary.ai/api/datasets-v2/create-dataset-version-snapshot
  - Run evaluation: https://docs.lunary.ai/api/evals/run-the-evaluation
- LangWatch docs:
  - Overview (online + offline): https://docs.langwatch.ai/evaluation/overview
  - Experiments via SDK: https://docs.langwatch.ai/evaluation/experiments-via-sdk
  - Monitors (online evaluation): https://docs.langwatch.ai/evaluation/monitors

**Offline evaluation libraries and CLIs**

- Promptfoo docs: https://promptfoo.dev/docs/intro
- DeepEval docs (test runs): https://deepeval.com/docs/evaluation-introduction/test-runs
- Ragas docs: https://docs.ragas.io/
- TruLens docs: https://www.trulens.org/
- Giskard docs: https://docs.giskard.ai/en/latest/
- OpenAI Evals (repo): https://github.com/openai/evals
- Guardrails "evaluate": https://www.guardrailsai.com/docs/examples/evaluate_guardrail
- EleutherAI lm-evaluation-harness: https://github.com/EleutherAI/lm-evaluation-harness

**Standards + conventions**

- OpenTelemetry GenAI semantic conventions: https://opentelemetry.io/docs/specs/semconv/attributes-registry/gen-ai/
- OpenInference (tracing conventions): https://github.com/Arize-ai/openinference

**General-purpose APM vendors**

- Datadog LLM Observability docs: https://docs.datadoghq.com/llm_observability/
- New Relic AI monitoring/LLM observability docs: https://docs.newrelic.com/docs/ai-monitoring/
