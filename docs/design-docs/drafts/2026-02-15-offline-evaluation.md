---
owner: sigil-core
status: draft
last_reviewed: 2026-02-15
source_of_truth: false
audience: both
---

# Offline Evaluation (Datasets + Experiments + CI Gates)

## Summary

Add **offline evaluation** to Sigil: dataset-backed experiments and regression gates that produce reproducible scorecards and deep debugging links (scores -> generations -> traces).

This doc is intentionally opinionated:

- Offline eval should be **debug-first**, not “just a leaderboard”.
- The “unit of debugging” is still the **generation** (and its trace), even when the experiment is dataset-driven.
- Users should be able to run evals **locally or in CI** and optionally publish results into Sigil for analysis.

Online evaluation is covered separately in `docs/design-docs/drafts/2026-02-15-online-evaluation.md`.

## Background / Research

See the reference docs catalog in `docs/references/index.md` for adjacent implementation material.

Industry convergence:

- datasets are versioned snapshots
- evaluators are versioned
- runs are compared (baseline vs candidate)
- “prompt CI” is a top workflow (fail PR if quality regresses)
- the best tooling bridges **production failure mining** -> **dataset** -> **offline gating** -> **online monitoring**

## Problem Statement

Teams need to answer:

- “Did this prompt/model/agent change improve quality on our known hard cases?”
- “What exactly regressed, and can I click to debug it?”
- “Can we block rollouts when quality regresses beyond a budget?”

Today Sigil has:

- a strong debugging substrate (trace + normalized generation payload)
- feedback signals (ratings and annotations)

It lacks:

- datasets (curated test cases with provenance)
- reproducible run artifacts (run metadata, per-case results, comparisons)
- a CI-friendly runner story (exit non-zero on regression budgets)

## Goals

### MVP goals (Phase 1)

- Define a **dataset** and **run** model that is stable and portable.
- Support **re-scoring** of stored generations (cheap first step):
  - score production snapshots without replaying the app
  - add new evaluators over existing outputs
- Support **publishable offline runs**:
  - store run metadata + scores so the plugin can compare runs and link failures to traces/generations
- Provide a CI-friendly workflow:
  - “run eval” -> print summary -> exit non-zero if regression budgets exceeded

### Phase 2 goals (Replay experiments)

- Support “true offline regression tests” by replaying a task under test on dataset inputs:
  - run candidate code/prompt/model against dataset
  - generate new outputs
  - score + compare to baseline

### Phase 3 goals (Closed loop)

- Mine failures from online evals and ratings/annotations into datasets automatically.
- Add slice exploration: “which cohorts regressed?” (language, topic tag, tenant, agent version).

## Non-Goals (Initial)

- A full hosted evaluation compute platform that runs arbitrary user code in Sigil.
- A universal agent sandbox that can replay tool environments (browser, DB, etc.).
- A full prompt registry and release workflow system.

## Opinionated Definitions

- **Dataset**: a versioned list of **items**.
- **Dataset item**: the minimal reproducible test scenario:
  - `input` (required)
  - optional `expected` (for reference-based checks)
  - optional `metadata` (tags/slices)
  - optional provenance pointers (`source_generation_id`, `source_trace_id`, etc.)
- **Run**: execution of a task under test and/or evaluators over a dataset snapshot.
- **Run item result**: the result for one dataset item (including generation ids and scores).

## Design Principles

1. **Local-first execution; remote-first analysis**
   - Users should be able to run evals anywhere (laptop/CI) and optionally push results to Sigil.
2. **Reproducibility over cleverness**
   - Everything that can drift must be versioned: dataset snapshot, evaluator version, judge model config.
3. **Debuggability is the differentiator**
   - Every failure should link back to:
     - candidate generation payload
     - trace timeline
     - evaluator explanation (when safe)
4. **Avoid a heavyweight control plane**
   - Start config-first. Add UI-managed dataset tooling only when it materially improves workflows.

## Core Objects

### 1) Dataset

Dataset identity:

- `dataset_id` (stable name)
- `dataset_version` (snapshot id or timestamp)

Dataset item:

```json
{
  "item_id": "it_00042",
  "input": {
    "messages": [
      { "role": "user", "content": "Summarize this incident report..." }
    ]
  },
  "expected": {
    "json_schema": { "type": "object", "required": ["summary"] }
  },
  "metadata": {
    "slice": "incident_summaries",
    "language": "en",
    "difficulty": "hard",
    "source": "prod_failure_mining"
  },
  "provenance": {
    "source_generation_id": "gen_01K...",
    "source_conversation_id": "conv-123",
    "source_trace_id": "....",
    "source_span_id": "....",
    "captured_at": "2026-02-01T00:00:00Z"
  }
}
```

### 2) Run (offline evaluation run)

Run identity and metadata should be explicit:

- `run_id` (idempotent; provided by caller)
- `name` (human label)
- `kind`:
  - `RESCORE` (evaluate stored generations)
  - `REPLAY` (execute task under test and generate new outputs)
- `dataset_id`, `dataset_version`
- `candidate` metadata:
  - `git_sha`, `prompt_version`, `agent_version`, `model`
- `baseline_run_id` (optional)
- `started_at`, `finished_at`, `status`

Run item results should include:

- `item_id`
- `generation_id`(s) produced or referenced
- per-item score list + errors

## Two Offline Modes (Explicitly Separated)

### Mode A: Re-scoring stored generations (MVP)

Use cases:

- add a new evaluator (rubric) over last week’s production outputs
- compute quality drift and slice breakdowns without replay
- validate evaluator changes (judge prompt tweak) on historical outputs

Mechanics:

1. Select a dataset of `generation_id`s (or build a dataset from a saved query).
2. For each generation:
   - load payload from Sigil
   - run evaluator(s)
   - export scores with `run_id`
3. Compare run to baseline run (if provided).

Limitations:

- not a true “candidate vs baseline” test of your app change
- but extremely valuable and cheap to implement early

### Mode B: Replay experiments (Phase 2+)

Use cases:

- prompt CI: run dataset against candidate code/prompt and gate merges
- model selection: compare candidate models/prompt versions

Key constraint:

- a replay requires a task under test that can run with real secrets, tools, and environment.

We should support replay via **user-owned execution** (Sigil orchestrates, user runs compute) rather than hosted execution.

## Where Computation Runs (Bring Compute, Sigil Stores Results)

This is the core strategic choice.

### Option 1 (recommended): user runs evals, Sigil ingests results

- Users run a runner locally/CI that:
  - reads a dataset snapshot
  - executes the task under test (optional for rescore mode)
  - runs evaluators
  - exports scores + run metadata to Sigil APIs
- Sigil stores results and provides UI for analysis/comparison.

Pros:

- simplest OSS/self-host story
- keeps secrets and tool environments in user infra
- aligns with “Sigil is not a hosted execution platform”

Cons:

- requires a runner story (CLI and/or SDK patterns)

### Option 2: Sigil-hosted execution (not recommended initially)

Pros:

- “one-click run” in UI

Cons:

- huge surface: sandboxing, secrets, tool environments, concurrency/rate limits

Recommendation: do not build this early.

## APIs (Proposed)

Offline eval needs two API families:

1. **Scores** (already required for online evaluation):
   - `POST /api/v1/scores:export`
2. **Runs** (offline grouping + comparisons):
   - `POST /api/v1/eval/runs` (create/update run metadata)
   - `POST /api/v1/eval/runs/{run_id}/items` (optional: per-item run record, if we don’t infer from scores)
   - `GET /api/v1/eval/runs?dataset_id=...`
   - `GET /api/v1/eval/runs/{run_id}`
   - `GET /api/v1/eval/runs/{run_id}/compare?baseline=...`

Opinionated MVP: store run metadata explicitly, but infer per-item results from scores and generation ids when possible.

## Storage Design (MySQL)

Offline eval requires run metadata even if scores are stored in `generation_scores`.

Proposed tables:

- `eval_runs`
- `eval_run_items` (optional, if we want an explicit mapping from dataset item -> generation id(s))
- reuse `generation_scores` with `run_id` populated

### `eval_runs` schema (draft)

```sql
CREATE TABLE eval_runs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id VARCHAR(128) NOT NULL,
  run_id VARCHAR(255) NOT NULL,

  name VARCHAR(255) NOT NULL,
  kind VARCHAR(16) NOT NULL, -- RESCORE|REPLAY
  dataset_id VARCHAR(255) NOT NULL,
  dataset_version VARCHAR(64) NOT NULL,

  baseline_run_id VARCHAR(255) NULL,
  candidate_json JSON NOT NULL,

  status VARCHAR(16) NOT NULL, -- running|success|failed
  started_at DATETIME(6) NOT NULL,
  finished_at DATETIME(6) NULL,
  error_summary TEXT NULL,

  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),

  UNIQUE KEY ux_eval_runs_tenant_run (tenant_id, run_id),
  KEY idx_eval_runs_tenant_dataset_time (tenant_id, dataset_id, started_at)
);
```

### Dataset storage (two alternatives)

#### Alternative A (recommended MVP): datasets live in git/object storage; Sigil stores references

- dataset files are JSONL/YAML checked into a repo or stored in blob storage
- Sigil stores:
  - dataset id
  - version id
  - item count
  - URI/path metadata (optional)

Pros: simplest; GitOps friendly; avoids dataset management UI early.

#### Alternative B: datasets are first-class objects in Sigil

- Sigil stores dataset items in MySQL + object storage
- UI supports:
  - add from production conversation/generation
  - upload CSV/JSONL
  - version snapshots

Pros: best UX and closes the loop.

Cons: more schema and UI surface.

Recommendation: start with Alternative A but design schemas with a migration path to B.

## Runner Story (Most Important UX Decision)

Offline evaluation lives or dies by the runner workflow. We should provide **at least one** path that is:

- simple to understand
- language-agnostic enough for most users
- CI-friendly

### Runner Option 1: Sigil CLI (`sigil eval ...`) orchestrates, user provides target

CLI responsibilities:

- read dataset snapshot (JSONL/YAML)
- execute task under test via:
  - `command:` (run a binary/script)
  - `http:` (call a service endpoint)
  - `container:` (docker run)
- run built-in evaluators (deterministic + optional LLM judge)
- export run metadata + scores to Sigil
- enforce regression budgets and exit non-zero

Pros:

- one canonical workflow
- CI integration is trivial

Cons:

- replaying complex agent/tool environments may be awkward without deeper integration

### Runner Option 2: SDK-native “eval loop” (like Braintrust/Langfuse experiments via SDK)

Users write evaluation code in their language using Sigil SDK + score export:

- they can call app code directly
- they can control tool environments

Pros:

- best fidelity; easiest for complex apps

Cons:

- fragmented UX across languages unless we provide strong templates and docs

### Runner Option 3: Integrate existing OSS runners (Promptfoo/DeepEval/Ragas) via a Sigil reporter

Sigil provides a small “reporter” library/CLI that:

- maps external runner outputs to Sigil `scores:export` + `eval_runs`
- pushes results so UI can compare runs

Pros:

- meet users where they are; minimal reinvention

Cons:

- mapping semantics can be lossy; runners differ in schema; less coherent “Sigil-native” story

Recommendation:

- Start with Option 3 + Option 2:
  - ship a stable Sigil results ingestion model (`scores:export` + `eval_runs`)
  - publish templates for at least one runner (Promptfoo is config-first and popular for prompt CI)
  - provide SDK-native examples in Go/TS/Python
- Add a Sigil CLI later if we see strong demand for a canonical runner.

## Configuration Examples

### Dataset JSONL (minimal)

`evals/datasets/support_smoke.jsonl`

```jsonl
{"item_id":"it_0001","input":{"messages":[{"role":"user","content":"Reset my password"}]},"metadata":{"slice":"support","language":"en"}}
{"item_id":"it_0002","input":{"messages":[{"role":"user","content":"Summarize this: ..."}]},"metadata":{"slice":"summaries","language":"en"}}
```

### Eval spec YAML (runner-agnostic)

`evals/sigil-eval.yaml`

```yaml
run:
  id: "run_${GIT_SHA}"
  name: "PR ${GIT_SHA}"
  kind: REPLAY
  dataset:
    id: support_smoke
    version: "2026-02-15"
    path: evals/datasets/support_smoke.jsonl
  candidate:
    git_sha: "${GIT_SHA}"
    agent_version: "2.3.1"
    model:
      provider: openai
      name: gpt-5-mini

target:
  type: http
  endpoint: "http://localhost:8081/eval"
  timeout_ms: 30000
  concurrency: 10

evaluators:
  - id: rubric.helpfulness.v1
    version: "2026-02-15"
    kind: llm_judge
    judge:
      provider: openai
      model: gpt-5-mini
      temperature: 0
      max_tokens: 300
    output:
      keys:
        - key: helpfulness
          type: number
          unit: score_0_1
          pass_if: ">= 0.7"
  - id: format.json_response.v1
    version: "2026-02-15"
    kind: json_schema
    output:
      keys:
        - key: json.valid
          type: bool
          pass_if: "= true"
    schema:
      type: object
      required: ["answer"]

gate:
  budgets:
    - key: helpfulness.mean
      no_worse_than_baseline_by: 0.02
    - key: json.valid.pass_rate
      min: 0.98
  allow_new_failures: 2
```

## Plugin UX Integration

Offline evaluation should feel like “debugging runs”, not a separate MLOps product.

### Pages (proposed)

1. **Evaluation -> Runs**
   - list runs (name, dataset, kind, started_at, status)
   - quick compare dropdown: baseline vs candidate
   - show headline deltas:
     - mean helpfulness delta
     - pass-rate delta
     - # new failures
2. **Run detail**
   - per-slice breakdown (group by `metadata.slice`, `language`, `difficulty`)
   - failure table:
     - item_id
     - score keys that failed
     - link to generation detail (and trace)
   - evaluator versions and config fingerprints (rubric hash)
3. **Dataset detail (Phase 2)**
   - version list
   - add items from production (from conversation/generation pages)
   - tags and slicing fields

### “Make it simple” UX constraints

- Always show a “one-number” headline per evaluator (mean score, pass-rate).
- Provide a single canonical comparison:
  - baseline run vs candidate run
- Avoid an Excel-like evaluator builder early.

## SDK Snippets (Publishing Results)

Offline runners need two calls:

1. create/update run metadata
2. export scores (grouped by run id)

### Example (TypeScript)

```ts
import { SigilClient } from "@grafana/sigil-sdk-js";

const client = new SigilClient({
  generationExport: {
    protocol: "http",
    endpoint: "http://localhost:8080/api/v1/generations:export",
    auth: { mode: "tenant", tenantId: "dev-tenant" },
  },
  api: { endpoint: "http://localhost:8080" },
});

await client.createEvalRun({
  runId: `run_${process.env.GIT_SHA}`,
  name: `PR ${process.env.GIT_SHA}`,
  kind: "REPLAY",
  datasetId: "support_smoke",
  datasetVersion: "2026-02-15",
  candidate: { gitSha: process.env.GIT_SHA },
});

// For each dataset item:
// - run your app, producing a Sigil generation_id via normal instrumentation
// - compute evaluators
// - export scores with runId set

await client.submitGenerationScore("gen_01K...", {
  scoreId: "sc_01K...",
  runId: `run_${process.env.GIT_SHA}`,
  evaluatorId: "rubric.helpfulness.v1",
  evaluatorVersion: "2026-02-15",
  key: "helpfulness",
  value: { number: 0.81 },
  passed: true,
  metadata: { itemId: "it_0001" },
});
```

## Alternatives (Explicit Tradeoffs)

### Offline result target: generation-only vs dataset-item scores

- Generation-only (recommended):
  - Pros: best debuggability; consistent with Sigil’s core model; clickable trace links.
  - Cons: requires the runner to produce generations (instrumented execution).
- Dataset-item-only:
  - Pros: lower friction; can evaluate pure text outputs without instrumentation.
  - Cons: weak debugging; disconnected from trace workflow; less differentiated.

Recommendation: require generation ids for “first-class runs”; optionally support dataset-item-only as a degraded mode later.

### Dataset management: files vs Sigil-first-class

- Files:
  - Pros: GitOps friendly; simplest.
  - Cons: weaker UX for failure mining and collaboration.
- Sigil-first-class:
  - Pros: best loop closure; can add-from-prod in UI.
  - Cons: more schema + UI; requires careful privacy policy.

Recommendation: start with files + references, design migration path to first-class.

### Runner ownership: Sigil CLI vs SDK loop vs external runner integration

See “Runner story” section; recommendation is to start by making Sigil a great **result store + analysis UI**, then decide on a canonical runner once we see adoption patterns.

## Security, Privacy, and Reproducibility

- Dataset provenance:
  - store links to source generation/trace so debugging is possible
  - redact/mask at dataset creation time (especially if mined from prod)
- Judge drift:
  - evaluator versioning must include judge model + prompt hash + decoding params
- Nondeterminism:
  - support `repetitions` and record variance (future)
  - caching recommended for CI stability (future)

## Open Questions

1. Should we standardize on one dataset item schema (messages + expected + metadata), or allow per-dataset schemas with JSON schema enforcement?
2. Should offline runs always create a synthetic `conversation_id` namespace like `eval:<run_id>:<item_id>` to keep navigation consistent?
3. How much of “dataset from production” should be in the plugin vs a CLI export tool first?
